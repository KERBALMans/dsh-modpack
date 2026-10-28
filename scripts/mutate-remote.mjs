/**
 * Mutation-tests `scripts/check-remote.mjs`.
 *
 * A green test proves nothing unless it can go red for the right reason. This
 * runner breaks one behaviour at a time in `index.js`, runs the check, and
 * demands that it fail — and, more importantly, that it fail on an assertion
 * rather than a syntax error. An earlier attempt at this used PowerShell's
 * `-replace` + `Set-Content`, which silently re-encoded the file as GBK and
 * turned every "killed" result into a syntax error. Hence: the edit and the
 * restore both happen in Node, with explicit utf8.
 *
 * Run:  node scripts/mutate-remote.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const target = join(root, 'index.js')
const backup = join(root, 'index.js.mutation-backup')

const MUTATIONS = [
  {
    // Keeps the folder path honest: a package with no `directory` must not be
    // allowed through to read the repository's front page.
    label: 'monorepo guard removed',
    from: 'if (!scoped && !repoMatchesPackage(meta.repo, name)) {',
    to: 'if (!scoped && false) {',
    expect: /does not inherit the repository description/i,
  },
  {
    label: 'evidence tiers reordered (keywords before topics)',
    from: "    { evidence: 'topics', hit: (sig) => topics.some((topic) => sig.tags.includes(topic)) },\n    { evidence: 'keywords', hit: (sig) => keywords.some((word) => sig.tags.includes(word)) },",
    to: "    { evidence: 'keywords', hit: (sig) => keywords.some((word) => sig.tags.includes(word)) },\n    { evidence: 'topics', hit: (sig) => topics.some((topic) => sig.tags.includes(topic)) },",
    expect: /outrank|topics/i,
  },
  {
    label: 'a confident plugin gets looked up anyway',
    from: 'const targets = rows.filter((row) => Boolean(row.name) && needsRemote(verdicts.get(row.key)))',
    to: 'const targets = rows.filter((row) => Boolean(row.name))',
    expect: /keyword verdict was never looked up/i,
  },
  {
    label: 'online lookup no longer opt-in',
    from: 'if (body.online === true) {',
    to: 'if (true) {',
    expect: /offline preview makes no network call|never sent anywhere/i,
  },
  {
    label: 'failed requests get cached as "no signal"',
    from: "      stats.failed++\n      trails.set(row.key, { stages: (meta && meta.trail) || [], failed: true })\n      return",
    to: "      stats.failed++\n      trails.set(row.key, { stages: (meta && meta.trail) || [], failed: true })",
    expect: /not cached as "no signal"/i,
  },
  {
    label: 'cache never consulted',
    from: 'if (entry && now - entry.at < ttl) {',
    to: 'if (false) {',
    expect: /cached preview asks the network nothing/i,
  },
  {
    label: 'package name no longer encoded for the registry',
    from: 'return String(name).replace(\'/\', \'%2F\')',
    to: 'return String(name)',
    expect: /looked up|registry/i,
  },
  {
    // The other side of the monorepo rule: not "is the guard too loose" but
    // "does dropping the folder make a package unclassifiable". Without this,
    // the folder could be read from the repository root and nothing would say so.
    label: 'repository.directory ignored',
    from: "const dir = typeof repository.directory === 'string' ? repository.directory.trim() : ''",
    to: "const dir = ''",
    expect: /own folder is read|scoped verdict/i,
  },
]

const original = readFileSync(target, 'utf8')
copyFileSync(target, backup)

const results = []
try {
  for (const mutation of MUTATIONS) {
    if (!original.includes(mutation.from)) {
      results.push({ label: mutation.label, outcome: 'PATTERN-MISSING' })
      continue
    }
    const mutated = original.replace(mutation.from, mutation.to)
    if (mutated === original) {
      results.push({ label: mutation.label, outcome: 'NO-OP' })
      continue
    }
    writeFileSync(target, mutated, 'utf8')

    // Guard against the earlier failure mode: a mutation that does not parse is
    // not a test of behaviour, so it must never be counted as a kill.
    try {
      execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
    } catch {
      results.push({ label: mutation.label, outcome: 'SYNTAX-ERROR (not a real kill)' })
      continue
    }

    let output = ''
    let code = 0
    try {
      output = execFileSync(process.execPath, [join(here, 'check-remote.mjs')], {
        stdio: 'pipe',
        cwd: root,
        encoding: 'utf8',
      })
    } catch (err) {
      code = err.status || 1
      output = `${err.stdout || ''}${err.stderr || ''}`
    }

    if (code === 0) {
      results.push({ label: mutation.label, outcome: 'SURVIVED' })
    } else if (!mutation.expect.test(output)) {
      results.push({
        label: mutation.label,
        outcome: `killed, but for the wrong reason: ${output.split('\n').filter((l) => l.trim().startsWith('- ')).join(' | ') || output.slice(0, 160)}`,
      })
    } else {
      results.push({ label: mutation.label, outcome: 'killed' })
    }
  }
} finally {
  writeFileSync(target, original, 'utf8')
  try { unlinkSync(backup) } catch { /* already gone */ }
}

const bad = results.filter((r) => r.outcome !== 'killed')
for (const r of results) console.log(`${r.outcome === 'killed' ? 'killed  ' : 'PROBLEM '} ${r.label} — ${r.outcome}`)

if (bad.length > 0) {
  console.error(`\nFAIL: ${bad.length} mutation(s) did not fail on the intended assertion`)
  process.exit(1)
}
console.log(`\nPASS: all ${results.length} mutations were caught by the intended assertion`)
