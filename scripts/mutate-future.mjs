/**
 * mutate-future.mjs — shipped test tool.
 *
 * Proves `check-future.mjs` can actually fail. That test makes three promises
 * about a Harness this plugin has never been run against:
 *
 *   - the two halves agree on the route version, and only a *stated*
 *     disagreement turns into a warning;
 *   - a browser holding a stale client half is told to reload, rather than
 *     watching buttons do nothing;
 *   - a renamed slot key or a missing `slots` service costs one seat at most.
 *
 * Every one of those is a guard, and a guard is invisible in the passing run.
 * Each is removed on purpose here; if the check still passes, it was not
 * testing the guard — it was testing the code around it.
 *
 * The original bytes are restored after every mutation, including on failure.
 *
 *   node scripts/mutate-future.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeEol } from './source-text.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const HOST = join(ROOT, 'index.js')
const CLIENT = join(ROOT, 'client.js')

const MUTATIONS = [
  {
    name: 'the client half stops checking the route version at all',
    file: CLIENT,
    why: 'a stale page would go on calling routes that moved, and the user would see buttons that do nothing with no explanation',
    edits: [[
      '      setApiMismatch(apiMismatchOf(diag, API_VERSION))',
      '      setApiMismatch(null)',
    ]],
  },
  {
    name: 'an unreported version counts as a mismatch',
    file: CLIENT,
    why: 'every install whose host half predates the handshake would show a red "versions disagree" banner while working perfectly',
    edits: [[
      "      if (typeof host !== 'number' || !Number.isFinite(host)) return null",
      '      if (typeof host !== \'number\' || !Number.isFinite(host)) return { host: null, self }',
    ]],
  },
  {
    name: 'a failed probe counts as a mismatch',
    file: CLIENT,
    why: 'one network hiccup would permanently label the page as incompatible instead of leaving the question open',
    edits: [[
      "      if (!diag || diag.ok !== true) return null",
      "      if (!diag || diag.ok !== true) return { host: null, self }",
    ]],
  },
  {
    name: 'the client half stops naming the host half on a refused connection',
    file: CLIENT,
    why: 'the user gets "Failed to fetch", which names neither the missing half nor anything they can do about it',
    edits: [[
      '        throw new Error(`连不上后台插件',
      '        throw new Error(`网络错误',
    ]],
  },
  {
    name: 'a 404 is reported as a generic failure',
    file: CLIENT,
    why: 'the one diagnosis that is actually actionable — "the host half is older than this page" — would be lost',
    edits: [[
      "      if (response.status === 404) {\n        throw new Error(`后台插件没有这个接口",
      "      if (response.status === 404) {\n        throw new Error(`请求失败",
    ]],
  },
  {
    name: 'one unregistrable seat aborts the other',
    file: CLIENT,
    why: 'a build that renamed one slot key would lose the whole settings tab, though the other seat was still valid',
    edits: [[
      '          } catch (err) {\n            console.warn(`[dsh-modpack] 无法挂到插槽',
      '          } catch (err) {\n            throw err\n            console.warn(`[dsh-modpack] 无法挂到插槽',
    ]],
  },
  {
    name: 'the two halves drift apart on the route version',
    file: HOST,
    why: 'nothing would detect a host half that grew a route the page does not know how to call',
    edits: [[
      'const API_VERSION = 2',
      'const API_VERSION = 3',
    ]],
  },
  {
    name: '/diag stops reporting the route version',
    file: HOST,
    why: 'the client would have to assume agreement, so a real mismatch would be silent',
    edits: [[
      '          apiVersion: API_VERSION,',
      '          apiVersion: undefined,',
    ]],
  },
  {
    name: 'a runtime without ctx.inject is treated as having no webServer',
    file: HOST,
    why: 'on an older runtime the whole HTTP half would silently never register, and every request would 404',
    edits: [[
      "  if (typeof ctx.inject === 'function') {",
      '  if (true) {',
    ]],
  },
]

// `raws` is the on-disk text and what gets restored; `originals` is the same
// text with CRLF collapsed, because the patterns below are authored in LF.
// See scripts/source-text.mjs.
const raws = new Map()
const originals = new Map()

let survived = 0

try {
  for (const mutation of MUTATIONS) {
    if (!originals.has(mutation.file)) {
      const raw = readFileSync(mutation.file, 'utf8')
      raws.set(mutation.file, raw)
      originals.set(mutation.file, normalizeEol(raw))
    }
    const original = originals.get(mutation.file)

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

    writeFileSync(mutation.file, next, 'utf8')

    let failed = false
    let output = ''
    try {
      execFileSync(process.execPath, [join(HERE, 'check-future.mjs')], { encoding: 'utf8' })
    } catch (err) {
      failed = true
      output = String((err.stdout || '') + (err.stderr || ''))
    }

    writeFileSync(mutation.file, raws.get(mutation.file), 'utf8')

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
  for (const [file, raw] of raws) writeFileSync(file, raw, 'utf8')
  rmSync(join(ROOT, 'index.js.mutbak'), { force: true })
  rmSync(join(ROOT, 'client.js.mutbak'), { force: true })
}

if (survived > 0) {
  console.error(`\nFAIL: ${survived}/${MUTATIONS.length} mutation(s) were not caught by check-future.mjs`)
  process.exit(1)
}
console.log(`\nPASS: all ${MUTATIONS.length} mutations were caught by check-future.mjs`)
