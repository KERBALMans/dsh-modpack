/**
 * mutate-compat.mjs — shipped test tool.
 *
 * Proves `check-compat.mjs` can actually fail. That test exists because a newer
 * client may reshape the services this plugin borrows, and its whole value is
 * the claim "none of those shapes break the preview". A test written alongside
 * the code tends to encode the same misunderstanding twice, so each claim is
 * broken on purpose here and the run fails if the test does not notice.
 *
 * Note what these mutations target: not the plugin's features, but its
 * *defensive* edges. A guard that is quietly redundant is indistinguishable
 * from a guard that works, until someone removes the thing it guards.
 *
 * The original bytes are restored after every mutation, including on failure.
 *
 *   node scripts/mutate-compat.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeEol } from './source-text.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const TARGET = join(ROOT, 'index.js')

const MUTATIONS = [
  {
    name: 'a model service without prepareCall is treated as usable',
    why: 'a renamed or moved method would be called blindly and throw mid-preview instead of degrading',
    edits: [[
      "  if (!llm || typeof llm.prepareCall !== 'function') {",
      '  if (!llm) {',
    ]],
  },
  {
    name: 'the configured default model is no longer preferred',
    why: 'the AI pass would fall back to discovery, so a runtime whose model exists but is not listed first would look like a model failure',
    edits: [[
      '      if (provider && model) return { provider, model }',
      '      if (provider && model) return null',
    ]],
  },
]

// `raw` is the on-disk text and what gets restored; `original` has CRLF
// collapsed, because the patterns below are authored in LF. See
// scripts/source-text.mjs.
const raw = readFileSync(TARGET, 'utf8')
const original = normalizeEol(raw)
let survived = 0

try {
  for (const mutation of MUTATIONS) {
    let next = original
    let ok = true
    for (const [from, to] of mutation.edits) {
      const hits = next.split(from).length - 1
      if (hits !== 1) {
        console.log(`SKIP  ${mutation.name}`)
        console.log(`      pattern matched ${hits} times, expected exactly 1:`)
        console.log(`      ${from.split('\n')[0].slice(0, 90)}`)
        ok = false
        survived += 1
        break
      }
      next = next.replace(from, to)
    }
    if (!ok) continue

    writeFileSync(TARGET, next, 'utf8')

    let failed = false
    let output = ''
    try {
      execFileSync(process.execPath, [join(HERE, 'check-compat.mjs')], { encoding: 'utf8' })
    } catch (err) {
      failed = true
      output = String((err.stdout || '') + (err.stderr || ''))
    }

    writeFileSync(TARGET, raw, 'utf8')

    if (failed) {
      const lines = output.split('\n').filter((line) => line.trim().startsWith('- '))
      console.log(`KILLED ${mutation.name}`)
      for (const line of lines.slice(0, 2)) console.log(`      ${line.trim()}`)
    } else {
      console.log(`SURVIVED ${mutation.name}`)
      console.log(`      why it matters: ${mutation.why}`)
      survived += 1
    }
  }
} finally {
  writeFileSync(TARGET, raw, 'utf8')
  rmSync(join(ROOT, 'index.js.mutbak'), { force: true })
}

if (survived > 0) {
  console.error(`\nFAIL: ${survived}/${MUTATIONS.length} mutation(s) were not caught by check-compat.mjs`)
  process.exit(1)
}
console.log(`\nPASS: all ${MUTATIONS.length} mutations were caught by check-compat.mjs`)