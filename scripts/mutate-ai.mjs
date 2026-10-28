/**
 * mutate-ai.mjs — shipped test tool.
 *
 * Proves `check-ai.mjs` can actually fail. The AI pass is the one place in this
 * plugin that spends the user's money, and its two promises — "only the plugins
 * we cannot judge are sent" and "a lying model cannot write into your tree" —
 * are exactly the kind of claim a test written alongside the code will happily
 * agree with. So each promise is broken on purpose here, and the run fails if
 * the test does not notice.
 *
 * A mutation may carry several edits. That is not a convenience: some
 * properties are enforced at two points on purpose, and removing either one
 * alone still leaves the behaviour correct — which would report a surviving
 * mutation that no code change could ever have caused. Breaking the property
 * means breaking every place it is enforced.
 *
 * The original bytes are restored after every mutation, including on failure.
 *
 *   node scripts/mutate-ai.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeEol } from './source-text.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const TARGET = join(ROOT, 'index.js')

const VERDICT_GUARD = '    if (!key || !category || !allowedKeys.has(key) || !RULE_BY_ID.has(category)) continue'

const MUTATIONS = [
  {
    name: 'every row is sent to the model, not just the unjudgeable ones',
    why: 'the plugin list would leave the machine for plugins the author already labelled',
    edits: [[
      '  const targets = rows.filter((row) => Boolean(row.name) && needsRemote(verdicts.get(row.key)))\n  stats.candidates = targets.length\n  if (targets.length === 0) return { byKey, stats }\n\n  const slice = targets.slice(0, AI_MAX_ROWS)',
      '  const targets = rows.filter((row) => Boolean(row.name))\n  stats.candidates = targets.length\n  if (targets.length === 0) return { byKey, stats }\n\n  const slice = targets.slice(0, AI_MAX_ROWS)',
    ]],
  },
  {
    name: 'the source switch is ignored on the host side',
    why: 'source would be read and shipped even when the user left that box unticked',
    edits: [[
      '            source: body.source === true || body.reason === true,',
      '            source: true,',
    ]],
  },
  {
    name: 'the ai switch is ignored on the host side',
    why: 'tokens would be spent on every preview, including the purely offline one',
    edits: [['        if (body.ai === true) {', '        if (true) {']],
  },
  {
    name: 'a verdict about a plugin we never asked about is accepted',
    why: 'a model could then write rows into a tree it was never given',
    edits: [[VERDICT_GUARD, '    if (!key || !category || !RULE_BY_ID.has(category)) continue']],
  },
  {
    name: 'a category the prompt never offered is accepted',
    why: 'a model could invent "quantum-computing" and it would become a real category',
    edits: [
      [VERDICT_GUARD, '    if (!key || !category || !allowedKeys.has(key)) continue'],
      [
        '    const rule = RULE_BY_ID.get(verdict.category)\n    if (!rule) continue',
        '    const rule = RULE_BY_ID.get(verdict.category) || { id: verdict.category, name: { zh: verdict.category }, why: { zh: \'\' } }',
      ],
    ],
  },
  {
    name: 'a stream error is treated as a successful empty answer',
    why: 'the panel would report a clean run after the provider failed',
    edits: [['  if (answer.failure) {', '  if (false) {']],
  },
  {
    name: 'the token cost is not reported back',
    why: 'the user pays for a run the panel then claims was free',
    edits: [[
      '  stats.inputTokens = answer.inputTokens || null\n  stats.outputTokens = answer.outputTokens || null',
      '  stats.inputTokens = null\n  stats.outputTokens = null',
    ]],
  },
  {
    name: 'a package with no readable source counts as having been read',
    why: 'the panel would claim source excerpts were included when none exist',
    edits: [[
      '  return Boolean(digest.head) || digest.signals.length > 0 || digest.imports.length > 0',
      '  return true',
    ]],
  },
  {
    name: 'discovery is preferred over the model the user actually configured',
    why: 'quota would be spent on a provider the user never chose',
    edits: [['      if (provider && model) return { provider, model }', '      if (false && provider && model) return { provider, model }']],
  },
  {
    name: 'the evidence the network was paid for is dropped before the model sees it',
    why: 'the model would judge an official bundle from its package name, having already paid for the repository description',
    edits: [[
      '    const remote = o.remoteEvidence instanceof Map ? o.remoteEvidence.get(row.key) : null',
      '    const remote = null',
    ]],
  },
  {
    name: 'the prompt names code fields even when no code is attached',
    why: 'the model would read the absence of evidence as evidence about the plugin',
    edits: [[
      '  const anyCode = entries.some((entry) => entry.digest && digestHasCode(entry.digest))',
      '  const anyCode = true',
    ]],
  },
  {
    name: 'the relationship line is attached whether or not the rung was asked for',
    why: 'every preview would ship role facts the user never opted into collecting, and the prompt would then describe evidence it does not have',
    edits: [
      // The property is enforced on both sides on purpose: the collector does
      // not build role facts unless asked, and the prompt does not print them
      // unless asked. Breaking one alone leaves the behaviour intact, so a
      // mutation that broke one alone would report a survival no code change
      // could ever have caused.
      ['    if (o.reason === true) {', '    if (true) {'],
      ['    if (o.reason === true && entry.role) {', '    if (entry.role) {'],
    ],
  },
  {
    name: 'the reasoning rung is announced even when no role facts were attached',
    why: 'the panel would claim the model reasoned about a relationship that was never sent to it',
    edits: [[
      '  stats.reasoned = o.reason === true && stats.withRole > 0',
      '  stats.reasoned = o.reason === true',
    ]],
  },
  {
    name: 'the reasoning instruction is left out while the data goes in',
    why: 'the model would receive a line of jargon with no instruction to weigh it, which is not the rung the user ticked',
    edits: [[
      '  if (anyRole) {',
      '  if (false) {',
    ]],
  },
  {
    name: 'an empty role line is attached as if it were a fact',
    why: 'a package we learned nothing about would be described as touching nothing, which nobody claimed',
    edits: [[
      '  const learned = halves !== \'unknown\' || slots.length > 0 || surfaces.length > 0\n  if (!learned) return null',
      '  const learned = true\n  if (!learned) return null',
    ]],
  },
  {
    name: 'the reasoning rung stops reading the entry file it derives from',
    why: 'the relationship would be built from a digest that was never produced, so the rung would silently attach nothing',
    edits: [[
      '            source: body.source === true || body.reason === true,',
      '            source: body.source === true,',
    ]],
  },
  {
    name: 'the abort signal is passed inside the config, where the host clones it',
    why: 'structuredClone of an AbortSignal is a prototype-less object, so the adapter\'s AbortSignal.any throws "signals[0] is not of type AbortSignal." and every AI run fails before the first token',
    edits: [
      ['    maxTokens: AI_MAX_TOKENS,\n    temperature: 0,\n  }\n  const prepared = await llm.prepareCall(base, signal)',
        '    maxTokens: AI_MAX_TOKENS,\n    temperature: 0,\n    signal,\n  }\n  const prepared = await llm.prepareCall(base)'],
      ['  const options = { ...resolved }\n  delete options.signal\n  if (signal !== undefined) options.signal = signal',
        '  const options = { ...resolved }'],
    ],
  },
  {
    name: 'the live signal is never re-attached to the dispatch options',
    why: 'the request would be un-cancellable: the timeout that stops a runaway model would never reach the adapter',
    edits: [[
      '  if (signal !== undefined) options.signal = signal',
      '  if (false) options.signal = signal',
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
      execFileSync(process.execPath, [join(HERE, 'check-ai.mjs')], { encoding: 'utf8' })
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
  console.error(`\nFAIL: ${survived}/${MUTATIONS.length} mutation(s) were not caught by check-ai.mjs`)
  process.exit(1)
}
console.log(`\nPASS: all ${MUTATIONS.length} mutations were caught by check-ai.mjs`)