/**
 * mutate-eol.mjs — shipped test tool.
 *
 * Proves `check-eol.mjs` can actually fail. That check exists because the
 * 0.9.0 suite passed on Linux and failed on Windows for a reason that had
 * nothing to do with the plugin: a CRLF checkout stopped the scripts' LF
 * patterns from matching. A regression guard for an environment bug is worth
 * nothing unless it is itself shown to go red.
 *
 * Two guards are broken here, and they are independent:
 *
 *   - `.gitattributes` is renamed away. This is what a contributor deleting an
 *     unfamiliar file at the repository root would do.
 *   - `normalizeEol` is turned into a no-op. This is the subtler one: the
 *     attributes file still exists, so a text search would stay green, and only
 *     the CRLF sandbox run catches it.
 *
 * The original bytes are restored after every mutation, including on failure.
 *
 *   node scripts/mutate-eol.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeEol } from './source-text.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ATTRIBUTES = join(ROOT, '.gitattributes')
const SOURCE_TEXT = join(ROOT, 'scripts', 'source-text.mjs')

const MUTATIONS = [
  {
    name: 'the repository stops pinning LF',
    why: 'a fresh Windows clone goes CRLF again, and every Windows contributor sees a red suite the maintainer cannot reproduce',
    apply() {
      renameSync(ATTRIBUTES, `${ATTRIBUTES}.mutation-backup`)
      return () => renameSync(`${ATTRIBUTES}.mutation-backup`, ATTRIBUTES)
    },
  },
  {
    name: 'normalisation becomes a no-op',
    why: 'the attributes file only covers what git produces; a ZIP export or a tarball unpacked on Windows would go back to failing',
    apply() {
      const raw = readFileSync(SOURCE_TEXT, 'utf8')
      const original = normalizeEol(raw)
      const from = "  return text.replace(/\\r\\n/g, '\\n')"
      const hits = original.split(from).length - 1
      if (hits !== 1) return { skip: `pattern matched ${hits} times, expected exactly 1` }
      writeFileSync(SOURCE_TEXT, original.replace(from, '  return text'), 'utf8')
      return () => writeFileSync(SOURCE_TEXT, raw, 'utf8')
    },
  },
]

let survived = 0

for (const mutation of MUTATIONS) {
  const undo = mutation.apply()
  if (typeof undo === 'object' && undo && undo.skip) {
    console.log(`SKIP  ${mutation.name}`)
    console.log(`      ${undo.skip}`)
    survived += 1
    continue
  }

  let failed = false
  let output = ''
  try {
    execFileSync(process.execPath, [join(HERE, 'check-eol.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    failed = true
    output = String((err.stdout || '') + (err.stderr || ''))
  } finally {
    undo()
  }

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

if (survived > 0) {
  console.error(`\nFAIL: ${survived}/${MUTATIONS.length} mutation(s) were not caught by check-eol.mjs`)
  process.exit(1)
}
console.log(`\nPASS: all ${MUTATIONS.length} mutations were caught by check-eol.mjs`)
