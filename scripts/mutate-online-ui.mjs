/**
 * mutate-online-ui.mjs — shipped test tool.
 *
 * Proves the UI test can actually fail. A test written alongside the code it
 * checks tends to encode the same misunderstanding twice; the only defence is
 * to break the behaviour on purpose and watch the test notice.
 *
 * Every mutation is applied to a copy, the test is run, and the original bytes
 * are restored — a mutation that survives is reported as a failure of the test,
 * not of the code.
 *
 *   node scripts/mutate-online-ui.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeEol } from './source-text.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const TARGET = join(ROOT, 'client.js')
const BACKUP = join(ROOT, 'client.js.mutbak')

// Each entry names the behaviour it breaks and rewrites exactly one span.
const MUTATIONS = [
  {
    name: 'opening the options starts the run immediately',
    why: 'the whole point of the options step is that conditions are chosen before anything happens',
    from: "            onClick: () => setPhase('options'),\n          }, `✨ ${t('autoOpen')}`),",
    to: "            onClick: run,\n          }, `✨ ${t('autoOpen')}`),",
  },
  {
    name: 'the source switch is enabled while AI is off',
    why: 'a tick that is accepted and then ignored is the bug class this plugin keeps hitting',
    from: "            ai ? t('autoOptSourceHint') : t('autoOptNeedAi'), !ai),",
    to: "            ai ? t('autoOptSourceHint') : t('autoOptNeedAi'), false),",
  },
  {
    name: 'switching AI off leaves the source tick standing',
    why: 'the request would then claim to use source the run never reads',
    from: '              if (!value) {\n                setSource(false)\n                setReason(false)\n              }',
    to: '              if (false) {\n                setSource(false)\n                setReason(false)\n              }',
  },
  {
    name: 'the ai flag is dropped from the request',
    why: 'the exact defect this test file was created for, one field over',
    from: 'call(\'/categories/suggest\', { overwrite, locale, online, source, ai, reason })',
    to: 'call(\'/categories/suggest\', { overwrite, locale, online, source, reason })',
  },
  {
    name: 'the reasoning rung is dropped from the request',
    why: 'the panel would offer the rung, tick it, and then ask the host for a plain AI pass',
    from: 'call(\'/categories/suggest\', { overwrite, locale, online, source, ai, reason })',
    to: 'call(\'/categories/suggest\', { overwrite, locale, online, source, ai })',
  },
  {
    name: 'the reasoning rung is ticked without the source it is built from',
    why: 'the host would be asked to reason about an entry file the same request told it not to read',
    from: '            if (value) setSource(true)',
    to: '            if (false) setSource(true)',
  },
  {
    name: 'an AI run with nothing to judge reports nothing at all',
    why: 'a ticked box that renders no line is indistinguishable from a broken button, and it is the normal outcome on a healthy profile',
    from: "        else aiLine = t('autoAiNothing')",
    to: '        else aiLine = null',
  },
]

copyFileSync(TARGET, BACKUP)
// Patterns are LF on every platform; `raw` is what goes back on disk. See
// scripts/source-text.mjs.
const raw = readFileSync(TARGET, 'utf8')
const original = normalizeEol(raw)

let survived = 0
try {
  for (const mutation of MUTATIONS) {
    const hits = original.split(mutation.from).length - 1
    if (hits !== 1) {
      console.log(`SKIP  ${mutation.name}`)
      console.log(`      pattern matched ${hits} times, expected exactly 1`)
      survived += 1
      continue
    }
    writeFileSync(TARGET, original.replace(mutation.from, mutation.to), 'utf8')

    let failed = false
    let output = ''
    try {
      // stderr is captured rather than inherited: check-online-ui writes its
      // failure report there, and inheriting it printed every expected failure
      // as if the run had gone wrong.
      execFileSync(process.execPath, [join(HERE, 'check-online-ui.mjs')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      failed = true
      output = String((err.stdout || '') + (err.stderr || ''))
    }

    // Put the real file back before anything else can read it.
    writeFileSync(TARGET, raw, 'utf8')

    if (failed) {
      const lines = output.split('\n').filter((line) => line.trim().startsWith('- '))
      console.log(`KILLED ${mutation.name}`)
      for (const line of lines.slice(0, 3)) console.log(`      ${line.trim()}`)
    } else {
      console.log(`SURVIVED ${mutation.name}`)
      console.log(`      why it matters: ${mutation.why}`)
      survived += 1
    }
  }
} finally {
  writeFileSync(TARGET, raw, 'utf8')
  rmSync(BACKUP, { force: true })
}

if (survived > 0) {
  console.error(`\nFAIL: ${survived}/${MUTATIONS.length} mutation(s) were not caught by check-online-ui.mjs`)
  process.exit(1)
}
console.log(`\nPASS: all ${MUTATIONS.length} mutations were caught by check-online-ui.mjs`)