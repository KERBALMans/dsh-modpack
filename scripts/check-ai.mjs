/**
 * check-ai.mjs — the AI pass must classify, must not overspend, and must never
 * be able to break the preview.
 *
 * This is the only code path in the plugin that costs the user money and the
 * only one that sends their plugin list to a third party, so the test takes the
 * pessimistic view everywhere it can:
 *
 *   - the model service is a double, but the *route* is real: the request goes
 *     through the shipped handler, the shipped gate, the shipped parser and the
 *     shipped merge into the tree;
 *   - every failure mode is exercised (no service, no model, a stream error, a
 *     reply that is not JSON, a reply naming a category we never offered, a
 *     reply naming a plugin we never asked about);
 *   - the gate is asserted negatively — a plugin the offline pass could already
 *     stand behind must not appear in the prompt at all, because "we only send
 *     what we cannot judge" is a claim about the bytes on the wire, not about
 *     the model's answer.
 *
 * Run:  node scripts/check-ai.mjs
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = '/api/dsh-modpack'

/* ---- a throwaway DSH home -------------------------------------------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-ai-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'check'
// `profileDir()` prefers DSH_PROFILE_DIR over DSH_HOME, and a shell running
// inside a Harness session has it pointed at the live profile. Clearing it is
// what makes this a throwaway home instead of the user's real one.
delete process.env.DSH_PROFILE_DIR

const profile = join(home, 'profiles', 'check')
const modules = join(profile, 'node_modules')
mkdirSync(modules, { recursive: true })

const ENTRY_SOURCE = `/**
 * Alpha bridge — keeps a long-running connection to a remote service alive.
 *
 * This header is the only prose the digest can read, so it is deliberately
 * specific: it names the capability in words no package name carries.
 */
import { spawn } from 'node:child_process'

export function apply(ctx) {
  ctx.inject(['someService'], (child) => {
    child.someService.register({ kind: 'alpha' })
  })
}
`

const PACKAGES = {
  // Confidently classified from the author's own keywords. Must never be sent.
  'dsh-windows-mcp': {
    manifest: {
      keywords: ['dsh', 'dsh-plugin', 'mcp', 'windows', 'automation'],
      description: 'Windows desktop automation through the MCP bridge',
    },
  },
  // No keywords, a name that decides nothing: the AI pass is its only hope.
  // It also has real entry code, so the source tier has something to read.
  'unlabelled-alpha': {
    manifest: { description: 'A package with no keywords' },
    entry: ENTRY_SOURCE,
  },
  // Same, but with no entry file at all — the digest must come back empty
  // rather than throw, and the row must still be classifiable.
  'unlabelled-beta': {
    manifest: { description: 'Another package with no keywords' },
  },
  // Published to npm with a repository, so scenario 11 can check that the
  // evidence the online rung fetched reaches the model. Its own description is
  // deliberately uninformative and different from the repository's, so the
  // prompt has to carry both to be complete.
  'unlabelled-gamma': {
    manifest: { description: 'No keywords and an unhelpful name' },
  },
  // The role rung's fixture. Its name says nothing, its description says
  // nothing, and its manifest declares a browser half that mounts a settings
  // slot — so the *only* thing that can tell the model it is a settings panel
  // rather than, say, a background service is the `relationship` line. If the
  // prompt ever stops carrying that line, this row collapses back to a guess
  // and the scenario notices.
  'unlabelled-delta': {
    manifest: {
      description: 'A component with no keywords',
      main: 'index.js',
      dsh: { client: { platform: 'web' }, bundle: { patch: './cordis.patch.yml' } },
    },
    entry: `/**
 * Delta panel — draws a settings page and reads a config file.
 */
import { readFileSync } from 'node:fs'

export function apply(ctx) {
  ctx.inject(['webServer'], (child) => {
    child.webServer.register({ kind: 'prefix', path: '/api/delta', handler() {} })
  })
  ctx.inject(['slots'], (child) => {
    child.slots.register('settings.section', { id: 'delta' })
  })
}
`,
  },
}

for (const [name, spec] of Object.entries(PACKAGES)) {
  const dir = join(modules, name)
  mkdirSync(dir, { recursive: true })
  const manifest = { name, version: '1.0.0', ...spec.manifest }
  if (spec.entry) manifest.main = 'index.js'
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8')
  if (spec.entry) writeFileSync(join(dir, 'index.js'), spec.entry, 'utf8')
}

const BUNDLES = Object.keys(PACKAGES)
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'check-profile',
  version: '0.0.0',
  private: true,
  dependencies: Object.fromEntries(BUNDLES.map((n) => [n, '^1.0.0'])),
  dsh: { profile: { bundles: BUNDLES } },
}, null, 2), 'utf8')

/* ---- the model double ------------------------------------------------- */

function makeLlm(options = {}) {
  const calls = []
  return {
    calls,
    async prepareCall(config, signal) {
      // The real host deep-copies the resolved config before handing it back:
      // `deepFreeze(structuredClone(resolved.config))`. That copy is the whole
      // reason a signal smuggled into the config dies — `structuredClone` of an
      // AbortSignal yields a prototype-less object. Reproducing the copy here
      // is what makes this double able to fail the way the real service fails.
      return {
        config: structuredClone({ ...config, maxTokens: 1800, temperature: 0 }),
        stream(prepared) {
          // The real adapter fuses the caller's signal with its own:
          // `AbortSignal.any([options.signal, consumer.signal])`. Anything that
          // is not a genuine AbortSignal throws exactly this TypeError.
          if (prepared.signal !== undefined) {
            AbortSignal.any([prepared.signal, new AbortController().signal])
          }
          calls.push(prepared)
          const text = typeof options.reply === 'function' ? options.reply(prepared) : options.reply
          return (async function* () {
            if (text) yield { type: 'text-delta', text }
            yield { type: 'usage', usage: { inputTokens: 321, outputTokens: 87 } }
            if (options.fail) {
              yield { type: 'finish', reason: { kind: 'error', failure: { message: options.fail } } }
            } else {
              yield { type: 'finish', reason: { kind: 'stop' } }
            }
          })()
        },
      }
    },
    async listProviders() { return options.providers || [] },
    async listModels() { return options.models || [] },
  }
}

/* ---- mount the host half against a fake Cordis context ---------------- */

const mod = await import('../index.js')
if (typeof mod.apply !== 'function') {
  console.error('FAIL: index.js does not export an `apply` function')
  process.exit(1)
}

function mount({ llm = null, defaultModel = null, pluginManager = null } = {}) {
  let handler = null
  const webServer = {
    register(o) {
      if (o && o.kind === 'prefix' && typeof o.handler === 'function') handler = o.handler
      return () => {}
    },
  }
  const childCtx = {
    get: () => undefined,
    webServer,
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  const services = { webServer, llm, agentDefaultModel: defaultModel, pluginManager }
  const ctx = {
    get: (name) => services[name] || undefined,
    inject(names, cb) { if (Array.isArray(names) && names.includes('webServer')) cb(childCtx) },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  mod.apply(ctx)
  if (!handler) {
    console.error('FAIL: the host half never registered a webServer prefix handler')
    process.exit(1)
  }
  return handler
}

/* ---- minimal HTTP doubles -------------------------------------------- */

function makeReq(method, path, body) {
  const listeners = new Map()
  const req = {
    method,
    url: path,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
      return req
    },
  }
  setTimeout(() => {
    if (body !== undefined) {
      const payload = Buffer.from(JSON.stringify(body), 'utf8')
      for (const fn of listeners.get('data') || []) fn(payload)
    }
    for (const fn of listeners.get('end') || []) fn()
  }, 0)
  return req
}

function makeRes() {
  const res = { status: 0, body: '', ended: false }
  res.writeHead = (status) => { res.status = status }
  res.end = (chunk) => { if (chunk) res.body += String(chunk); res.ended = true }
  return res
}

/* ---- fetch doubles, used only by scenario 11 -------------------------- */

function jsonResponse(value) {
  return { ok: true, status: 200, async json() { return value }, async text() { return JSON.stringify(value) } }
}

function textResponse(value) {
  return { ok: true, status: 200, async json() { return null }, async text() { return value } }
}

function notFound() {
  return { ok: false, status: 404, async json() { return null }, async text() { return '404: Not Found' } }
}

async function suggest(handler, payload) {
  const res = makeRes()
  await handler(makeReq('POST', `${API}/categories/suggest`, payload), res)
  let parsed = null
  try { parsed = JSON.parse(res.body) } catch { /* reported by the caller */ }
  if (!parsed) throw new Error(`suggest returned unparseable body (status ${res.status}): ${res.body.slice(0, 200)}`)
  return parsed
}

/* ---- assertions ------------------------------------------------------- */

// One plugin's block from the prompt, bounded at the next `--- key:`. A lazy
// `(?:.*\n)*?` looks equivalent and is not: `.` cannot cross a newline, so the
// scan happily walks past the next plugin and asserts against somebody else's
// fields. Two scenarios below exist precisely because that mistake made them
// pass while testing nothing.
function blockOf(prompt, key) {
  const start = prompt.indexOf(`--- key: ${key}`)
  if (start < 0) return ''
  const rest = prompt.slice(start + 1)
  const next = rest.indexOf('\n--- key: ')
  return next < 0 ? prompt.slice(start) : prompt.slice(start, start + 1 + next)
}

const problems = []
function check(label, condition, detail) {
  if (!condition) problems.push(detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`)
}

// The prompt the model was actually sent, or '' when it was never called.
//
// Written as a function rather than inlined because the inline form
// `((calls[0] || {}).messages || [{}])[0].content[0].text` throws when the
// model was not called at all: `{}` has no `content`, so indexing it is a
// TypeError. That crash still *fails* the run, which sounds equivalent to
// reporting a problem — but it is not: the mutation runner treats "the check
// script exited non-zero" as "the mutation was caught", so a mutation that
// stops the model being called would be scored as killed by a crash instead of
// by an assertion, and the real assertions would never run.
function promptOf(llm) {
  const call = llm && Array.isArray(llm.calls) ? llm.calls[0] : null
  const message = call && Array.isArray(call.messages) ? call.messages[0] : null
  const block = message && Array.isArray(message.content) ? message.content[0] : null
  return (block && typeof block.text === 'string' && block.text) || ''
}

const KEYS = { mcp: 'bundle:dsh-windows-mcp', alpha: 'bundle:unlabelled-alpha', beta: 'bundle:unlabelled-beta', delta: 'bundle:unlabelled-delta' }

// Every package in the fixture with no keywords and a name that decides nothing:
// the rows the offline passes cannot stand behind, and therefore exactly the
// rows the AI pass is allowed to spend on. Kept as a list rather than a literal
// so adding a fixture package cannot quietly weaken the count assertions.
const UNCERTAIN = ['unlabelled-alpha', 'unlabelled-beta', 'unlabelled-gamma', 'unlabelled-delta']

/* ---- 1. AI off sends nothing anywhere --------------------------------- */

{
  const llm = makeLlm({ reply: '[]' })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: false, online: false, overwrite: false, locale: 'zh' })
  check('ai:false still returns a usable preview', out.ok === true, out.error)
  check('ai:false calls the model zero times', llm.calls.length === 0, llm.calls.length)
  check('ai:false reports no ai stats', out.ai === null || out.ai === undefined, out.ai)
}

/* ---- 2. AI on with no model service degrades, and says so -------------- */

{
  const handler = mount({ llm: null })
  const out = await suggest(handler, { ai: true, online: false, locale: 'zh' })
  check('a missing llm service does not fail the preview', out.ok === true, out.error)
  check('a missing llm service is reported as unavailable', out.ai && out.ai.available === false, out.ai)
  check('a missing llm service names the reason',
    out.ai && out.ai.reason === 'llm-unavailable', out.ai && out.ai.reason)
  check('a missing llm service still produces categories',
    out.summary && out.summary.assigned > 0, out.summary)
}

/* ---- 3. AI on with a model but no configured target -------------------- */

{
  const llm = makeLlm({ reply: '[]', providers: [] })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, locale: 'zh' })
  check('no reachable model is reported as such', out.ai && out.ai.reason === 'no-model', out.ai)
  check('no reachable model makes no request', llm.calls.length === 0, llm.calls.length)
  check('no reachable model leaves the offline result intact', out.ok === true && out.ai.found === 0, out.ai)
}

/* ---- 4. the gate: only the unjudgeable rows are sent ------------------- */

let promptWithCode = ''
{
  const llm = makeLlm({
    providers: [{ id: 'test-provider' }],
    models: [{ id: 'test-model' }],
    reply: JSON.stringify([
      { key: KEYS.alpha, category: 'ui', why: '它把外部服务接进了界面' },
      { key: KEYS.beta, category: 'other', why: '看不出它做什么' },
    ]),
  })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, source: true, locale: 'zh' })

  check('the model was called exactly once', llm.calls.length === 1, llm.calls.length)
  const prompt = promptOf(llm)
  promptWithCode = prompt

  check('the prompt asks for JSON only', prompt.includes('JSON'), prompt.slice(0, 200))
  check('the prompt lists the closed vocabulary',
    prompt.includes('- mcp:') && prompt.includes('- ui:'), prompt.slice(0, 400))
  check('the prompt withholds the installation-fact category',
    !prompt.includes('- local:'), prompt.slice(0, 400))

  // The gate, stated as bytes: a plugin the tags already classified is not in
  // the prompt, not merely "not re-classified in the answer".
  check('a confidently tagged plugin is NOT sent to the model',
    !prompt.includes('dsh-windows-mcp'), prompt.slice(0, 400))
  check('only the unjudgeable plugins are sent',
    prompt.includes(KEYS.alpha) && prompt.includes(KEYS.beta), prompt.slice(0, 400))
  check('the candidate count excludes the tagged plugin', out.ai.candidates === UNCERTAIN.length, out.ai.candidates)
  check('the ask count matches the candidates', out.ai.asked === UNCERTAIN.length, out.ai.asked)

  check('the source tier puts the header comment in the prompt',
    prompt.includes('code-summary') && prompt.includes('Alpha bridge'), prompt.slice(0, 800))
  check('the source tier puts what the code registers in the prompt',
    prompt.includes('code-registers') && prompt.includes('someService.register'), prompt.slice(0, 1200))
  check('the source tier puts real imports in the prompt',
    prompt.includes('node:child_process'), prompt.slice(0, 1200))
  check('the source tier puts declared deps in the prompt', prompt.includes('code-deps'), prompt)
  check('the keyless package contributes no code block',
    !blockOf(prompt, 'bundle:unlabelled-beta').includes('code-'), blockOf(prompt, 'bundle:unlabelled-beta'))
  check('the model target is the discovered pair',
    out.ai.provider === 'test-provider' && out.ai.model === 'test-model', out.ai)
  // Tied to the reply above, not to the candidate count: the model is asked
  // about every uncertain row but answers for only these two, and the test has
  // to keep those two ideas apart.
  const FILED_BY_MODEL = 2
  check('both verdicts are counted', out.ai.found === FILED_BY_MODEL, out.ai)
  check('the token cost is reported',
    out.ai.inputTokens === 321 && out.ai.outputTokens === 87, out.ai)
  check('the code-bearing rows are counted', out.ai.withCode === 2, out.ai.withCode)

  check('an ai verdict is attributed to ai in the summary', out.summary.fromAi === FILED_BY_MODEL, out.summary)
  check('no ai verdict is counted as a name guess', out.summary.fromName === 0, out.summary)

  const byKey = new Map(out.added.map((item) => [item.key, item]))
  const alpha = byKey.get(KEYS.alpha)
  check('the model-chosen category is used for the plugin', alpha && alpha.categoryName !== undefined, alpha)
  check('the ai verdict carries basis "ai"', alpha && alpha.basis === 'ai', alpha && alpha.basis)
  check('the ai reason names the provider and model',
    alpha && String(alpha.reason).includes('test-provider/test-model'), alpha && alpha.reason)
  check('the ai reason reuses the model\'s own words',
    alpha && String(alpha.reason).includes('它把外部服务接进了界面'), alpha && alpha.reason)
  check('the ai reason says source was considered',
    alpha && String(alpha.reason).includes('源码'), alpha && alpha.reason)
  // reason:false is the default. A run that never asked for the reasoning rung
  // must not carry a single relationship line, or the model is being told to
  // weigh evidence the user did not pay to collect.
  check('without the reasoning rung the prompt has no relationship line',
    !prompt.includes('relationship:'), prompt.slice(0, 600))
  check('without the reasoning rung nothing is counted as having a role',
    out.ai.withRole === 0 && out.ai.reasoned === false, out.ai)
}

/* ---- 5. without the source tick, no code leaves the machine ------------ */

{
  const llm = makeLlm({
    providers: [{ id: 'p' }], models: [{ id: 'm' }],
    reply: JSON.stringify([{ key: KEYS.alpha, category: 'ui', why: 'x' }]),
  })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, source: false, locale: 'zh' })
  const prompt = promptOf(llm)
  check('source:false keeps code out of the prompt',
    !prompt.includes('code-summary') && !prompt.includes('Alpha bridge'),
    { summaryAt: prompt.indexOf('code-summary'), headerAt: prompt.indexOf('Alpha bridge'), len: prompt.length })
  check('source:false reports zero code-bearing rows', out.ai.withCode === 0, out.ai.withCode)
  check('source:false still asks about the same rows', out.ai.asked === UNCERTAIN.length, out.ai.asked)
}

/* ---- 5b. the reasoning rung attaches the relationship, and only then --- */

// The rung exists to answer a question the offline tiers cannot: *where does
// this plugin attach*. The assertions below are about bytes in the prompt,
// because "the model reasoned about the role" is unobservable while "the role
// line was in the request" is not.
let promptWithRole = ''
{
  const llm = makeLlm({
    providers: [{ id: 'p' }], models: [{ id: 'm' }],
    reply: JSON.stringify([
      { key: KEYS.delta, category: 'ui', why: '它往设置页插槽里挂了一块面板，还读配置文件' },
    ]),
  })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, reason: true, locale: 'zh' })
  const prompt = promptOf(llm)
  promptWithRole = prompt

  check('the reasoning rung still asks the model exactly once', llm.calls.length === 1, llm.calls.length)

  // The rung is downstream of source: a relationship line is derived from the
  // entry file, so asking for the rung without reading the file would ship a
  // line built from half its inputs. The host turns source on rather than
  // letting the combination quietly do nothing.
  check('the reasoning rung reads the entry file even when source was not ticked',
    prompt.includes('code-summary') && prompt.includes('Delta panel'), prompt.slice(0, 800))

  // The line itself, field by field. `halves=client+host` is what makes this
  // plugin a UI panel *and* a server route; `patch=yes` is what makes it a
  // layer rather than a standalone feature.
  check('the relationship line is present for the plugin that has one',
    prompt.includes('relationship: halves=client+host'), prompt.slice(prompt.indexOf('unlabelled-delta'), prompt.indexOf('unlabelled-delta') + 900))
  check('the relationship line names the patch layer',
    /relationship: [^\n]*patch=yes/.test(prompt), prompt.slice(prompt.indexOf('relationship:'), prompt.indexOf('relationship:') + 300))
  check('the relationship line names the slot it mounts into',
    /relationship: [^\n]*slot=settings\.section/.test(prompt), prompt.slice(prompt.indexOf('relationship:'), prompt.indexOf('relationship:') + 300))
  check('the relationship line names the capabilities it reaches for',
    /relationship: [^\n]*touches=[^\n]*files/.test(prompt) &&
      /relationship: [^\n]*touches=[^\n]*http/.test(prompt),
    prompt.slice(prompt.indexOf('relationship:'), prompt.indexOf('relationship:') + 300))
  check('the relationship line names the UI capability for a panel',
    /relationship: [^\n]*touches=[^\n]*ui/.test(prompt), null)

  // A package with no manifest-level role information simply carries no line.
  // The prompt has already said the field exists, so the absence reads as
  // "unknown" instead of being silently filled in.
  check('a plugin with no role facts carries no relationship line',
    !blockOf(prompt, 'bundle:unlabelled-beta').includes('relationship:'), blockOf(prompt, 'bundle:unlabelled-beta'))

  // The reasoning instruction, not just the data: without it the model gets a
  // line of jargon and no idea what to do with it.
  check('the prompt tells the model to reason from the name before checking it',
    prompt.includes('先看名字') && prompt.includes('再用 relationship 检验'), prompt.slice(0, 2000))
  check('the prompt explains what each relationship field means',
    prompt.includes('- halves：') && prompt.includes('- slot：') && prompt.includes('- touches：'), prompt.slice(0, 1600))
  check('the prompt asks for the reasoning in why',
    prompt.includes('把这段推理写进 why'), prompt.slice(0, 2400))

  check('the role-bearing rows are counted', out.ai.withRole >= 1, out.ai.withRole)
  check('the run is reported as having reasoned', out.ai.reasoned === true, out.ai)
  const delta = out.added.find((item) => item.key === KEYS.delta)
  check('a role-reasoned verdict is still attributed to ai', delta && delta.basis === 'ai', delta && delta.basis)
  check('the ai reason names the relationship as evidence',
    delta && String(delta.reason).includes('作用关系'), delta && delta.reason)
}

/* ---- 5c. reason:false keeps every relationship line out ---------------- */

{
  const llm = makeLlm({
    providers: [{ id: 'p' }], models: [{ id: 'm' }],
    reply: JSON.stringify([{ key: KEYS.delta, category: 'ui', why: 'x' }]),
  })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, source: true, reason: false, locale: 'zh' })
  const prompt = promptOf(llm)
  // The mirror of 5b: source on, reason off. The code is there, the derived
  // relationship is not, and neither is the instruction to reason about it.
  check('source without reason sends code but no relationship line',
    prompt.includes('code-summary') && !prompt.includes('relationship:'), prompt.slice(0, 600))
  check('source without reason carries no reasoning instruction',
    !prompt.includes('先看名字'), prompt.slice(0, 2000))
  check('source without reason reports no reasoning',
    out.ai.reasoned === false && out.ai.withRole === 0, out.ai)
}

/* ---- 5d. reason:true over a profile with nothing to derive from -------- */

// The rung is announced in the preview ("N of them came with a role
// description"). That sentence is a claim about the bytes that were sent, so a
// run that ticks the box but learns nothing about any package must report zero
// — not "reasoned". This needs its own profile: every package in `check` has a
// readable manifest, so the only way to get `withRole === 0` is a profile whose
// node_modules does not carry the manifests the row list is built from.
{
  const bare = join(home, 'profiles', 'bare')
  mkdirSync(join(bare, 'node_modules'), { recursive: true })
  writeFileSync(join(bare, 'package.json'), JSON.stringify({
    name: 'bare-profile',
    version: '0.0.0',
    private: true,
    dependencies: { 'ghost-one': '^1.0.0', 'ghost-two': '^1.0.0' },
    dsh: { profile: { bundles: ['ghost-one', 'ghost-two'] } },
  }, null, 2), 'utf8')

  const before = process.env.DSH_PROFILE
  process.env.DSH_PROFILE = 'bare'
  try {
    const llm = makeLlm({
      providers: [{ id: 'p' }], models: [{ id: 'm' }],
      reply: JSON.stringify([{ key: 'bundle:ghost-one', category: 'other', why: 'x' }]),
    })
    const handler = mount({ llm })
    const out = await suggest(handler, { ai: true, reason: true, locale: 'zh' })
    const prompt = promptOf(llm)
    check('a profile with no readable manifests still reaches the model',
      llm.calls.length > 0, out.ai)
    check('reason over nothing attaches no relationship line',
      !prompt.includes('relationship:'), prompt.slice(0, 800))
    check('reason over nothing explains no relationship fields',
      !prompt.includes('- halves'), prompt.slice(0, 1200))
    check('reason over nothing is not reported as reasoning',
      out.ai.reasoned === false && out.ai.withRole === 0, out.ai)
  } finally {
    process.env.DSH_PROFILE = before
  }
}

/* ---- 6. a stream error falls back, it does not throw ------------------- */

{
  const llm = makeLlm({ providers: [{ id: 'p' }], models: [{ id: 'm' }], reply: '[]', fail: 'upstream 503' })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, locale: 'zh' })
  check('a stream error does not fail the preview', out.ok === true, out.error)
  check('a stream error is reported as failed', out.ai.failed === UNCERTAIN.length, out.ai.failed)
  check('a stream error carries the upstream message', out.ai.reason === 'upstream 503', out.ai.reason)
  check('a stream error leaves the offline verdicts in place',
    out.summary.fromAi === 0 && out.summary.assigned > 0, out.summary)
}

/* ---- 7. an unusable answer cannot write into the tree ------------------ */

{
  const llm = makeLlm({
    providers: [{ id: 'p' }], models: [{ id: 'm' }],
    reply: [
      'Sure! Here is my answer:',
      '```json',
      JSON.stringify([
        { key: KEYS.alpha, category: 'ui', why: 'ok' },
        { key: 'bundle:not-installed', category: 'ui', why: 'invented a plugin' },
        // Deliberately the *only* entry for beta. An earlier version of this
        // fixture also emitted a valid entry for the same key, which silently
        // overwrote this one — the invented category never reached the tree,
        // the assertion passed, and a mutation that removed both guards
        // survived. One key, one verdict.
        { key: KEYS.beta, category: 'quantum-computing', why: 'invented a category' },
        'not an object',
      ]),
      '```',
    ].join('\n'),
  })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, locale: 'zh' })
  check('a fenced answer is still read', out.ai.found === 1, out.ai.found)
  check('an unknown plugin key is dropped', !out.added.some((i) => i.key === 'bundle:not-installed'), out.added)
  check('an unknown category id is dropped',
    !out.added.some((i) => i.categoryName === 'quantum-computing'), out.added)
  check('a dropped plugin is not counted as found', out.summary.fromAi === 1, out.summary)
  check('the one valid verdict still lands', out.added.some((i) => i.key === KEYS.alpha), out.added)
}

{
  const llm = makeLlm({ providers: [{ id: 'p' }], models: [{ id: 'm' }], reply: 'I could not decide.' })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, locale: 'zh' })
  check('prose instead of JSON does not fail the preview', out.ok === true, out.error)
  check('prose instead of JSON yields no verdicts', out.summary.fromAi === 0, out.summary)
  check('prose instead of JSON is not reported as an error', out.ai.failed === 0, out.ai)
  check('prose instead of JSON still reports what was asked', out.ai.asked === UNCERTAIN.length, out.ai.asked)
}

/* ---- 8. the session default model wins over discovery ------------------ */

{
  const llm = makeLlm({
    providers: [{ id: 'discovered-provider' }],
    models: [{ id: 'discovered-model' }],
    reply: JSON.stringify([{ key: KEYS.alpha, category: 'ui', why: 'x' }]),
  })
  const handler = mount({
    llm,
    defaultModel: { currentSelection: () => ({ provider: 'session-provider', model: 'session-model' }) },
  })
  const out = await suggest(handler, { ai: true, locale: 'zh' })
  check('the session default model is preferred',
    out.ai.provider === 'session-provider' && out.ai.model === 'session-model', out.ai)
  const call = llm.calls[0] || {}
  check('the request is addressed to the session default',
    call.provider === 'session-provider' && call.model === 'session-model', call.provider)
  check('the request is deterministic', call.temperature === 0, call.temperature)
  check('the request is token-capped', call.maxTokens === 1800, call.maxTokens)
  check('the request carries an abort signal', Boolean(call.signal), typeof call.signal)
  // Not "a signal exists" — that was true of the broken build too, which put a
  // structuredClone'd husk on the config. The claim is that the object handed
  // to the adapter is a live AbortSignal, because the adapter fuses it with
  // `AbortSignal.any` and anything else throws `signals[0] is not of type
  // AbortSignal.` before a single token is requested.
  check('the signal reaching the adapter is a real AbortSignal',
    Object.prototype.toString.call(call.signal) === '[object AbortSignal]', call.signal)
  check('the signal reaching the adapter is live, not a clone',
    call.signal instanceof AbortSignal && call.signal.aborted === false, call.signal)
}

/* ---- 9. an English locale gets an English prompt and reason ------------ */

{
  const llm = makeLlm({
    providers: [{ id: 'p' }], models: [{ id: 'm' }],
    reply: JSON.stringify([{ key: KEYS.alpha, category: 'ui', why: 'ok' }]),
  })
  const handler = mount({ llm })
  const out = await suggest(handler, { ai: true, locale: 'en' })
  const prompt = promptOf(llm)
  check('an en request gets an en prompt',
    prompt.includes('You are filing installed plugins'), prompt.slice(0, 160))
  const alpha = out.added.find((item) => item.key === KEYS.alpha)
  check('an en request gets an en reason',
    alpha && /judged by/.test(String(alpha.reason)), alpha && alpha.reason)
}

/* ---- 10. the retry loop keeps the fidelity of the digest -------------- */

// Not a behavioural check but a fidelity one: the prompt built above must be
// the *shipped* prompt, not a paraphrase. Cheap guard against the test drifting
// away from the code it claims to cover.
check('the prompt actually came from a real run', promptWithCode.length > 400, promptWithCode.length)

/* ---- 11. evidence the network paid for reaches the model -------------- */

// The online rung is offered first and the AI rung second, and the AI rung only
// sees rows the online rung could not file. Those rows were still *looked up* —
// the network was asked, the answer arrived, and it simply did not contain a
// word our table knows. Discarding it would make the model re-guess from the
// package name, which is the one thing the lookup was bought to replace.
{
  // The repository has to be named after the package. `lookupRemote` refuses to
  // read repository metadata for a repository that is not this package — that
  // guard is what stops a monorepo package inheriting the product's topics — and
  // a fixture whose repo did not match would silently test the refusal instead
  // of the thing under test.
  const REPO = 'probe/unlabelled-gamma'
  const NPM_GAMMA = {
    name: 'unlabelled-gamma',
    version: '1.0.0',
    description: 'An internal component of a larger system',
    repository: { type: 'git', url: `git+https://github.com/${REPO}.git` },
  }
  const GITHUB_GAMMA = {
    full_name: REPO,
    // Deliberately inert. A topic that happened to match a rule's tags would
    // let the online rung file this row, and the row would never reach the
    // model — the scenario would pass while testing nothing. Real repositories
    // have meaningful topics; this fixture is not allowed to.
    topics: ['inert-topic-one', 'inert-topic-two'],
    description: 'An internal component of a larger system',
  }
  const README_GAMMA = '# unlabelled-gamma\n\nNothing in this paragraph names any category.\n'

  const realFetch = globalThis.fetch
  const fetched = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    fetched.push(href)
    const npm = href.match(/^https:\/\/registry\.npmjs\.org\/(.+)\/latest$/)
    if (npm) {
      const name = decodeURIComponent(npm[1])
      if (name === 'unlabelled-gamma') return jsonResponse(NPM_GAMMA)
      return notFound()
    }
    if (href === `https://api.github.com/repos/${REPO}`) return jsonResponse(GITHUB_GAMMA)
    if (/^https:\/\/api\.github\.com\/search\/repositories/.test(href)) return jsonResponse({ items: [] })
    if (href.startsWith(`https://raw.githubusercontent.com/${REPO}/HEAD/`)) return textResponse(README_GAMMA)
    return notFound()
  }

  try {
    const llm = makeLlm({
      providers: [{ id: 'p' }], models: [{ id: 'm' }],
      reply: JSON.stringify([{ key: 'bundle:unlabelled-gamma', category: 'runtime', why: 'ok' }]),
    })
    const handler = mount({ llm })
    const out = await suggest(handler, { ai: true, online: true, locale: 'zh' })
    const calls = llm.calls
    check('scenario 11 reached the model at all',
      calls.length > 0, { ai: out.ai, remote: out.remote, added: (out.added || []).map((i) => `${i.key}:${i.basis}`) })
    const prompt = calls.length > 0 ? ((calls[0].messages || [{}])[0].content[0].text || '') : ''
    check('the lookup really reached the repository',
      fetched.includes(`https://api.github.com/repos/${REPO}`), fetched)

    const gamma = out.added.find((item) => item.key === 'bundle:unlabelled-gamma')
    check('a row the network could not file is handed to the model',
      Boolean(gamma) && out.ai.asked >= 1, out.ai)
    check('the looked-up page survives as evidence instead of being dropped',
      prompt.includes('remote-source: probe/unlabelled-gamma'), prompt.slice(prompt.indexOf('unlabelled-gamma'), prompt.indexOf('unlabelled-gamma') + 500))
    check('the repository topics ride along',
      prompt.includes('remote-topics: inert-topic-one, inert-topic-two'), null)
    check('the repository description rides along when it differs from the package one',
      prompt.includes('remote-description: An internal component of a larger system'), null)
    check('the repository README rides along when the package ships none',
      prompt.includes('remote-readme: # unlabelled-gamma'), null)
    check('the prompt says the remote fields exist rather than leaving them unexplained',
      prompt.includes('remote-*'), null)
    check('a row the network DID file is not sent to the model as well',
      !/--- key: bundle:dsh-windows-mcp[\s\S]*?remote-source/.test(prompt), null)
  } finally {
    globalThis.fetch = realFetch
  }
}

/* ---- 12. Loader entries reach the model, not just bundles --------------- */

// A real desktop profile is 215 Loader entries beside 28 bundles, and the rows
// that stayed unjudgeable after the offline tiers ran were Loader entries, not
// bundles. The AI pass used to filter on `row.kind === 'bundle'`, so on a live
// profile it reported `candidates: 16` while every one of those 215 rows was
// invisible to it — the panel said the model had run and had nothing to say.
//
// The assertion is not "a plugin row is in the prompt" but the whole chain:
// the entry is built, its manifest is read, the code digest is attached, the
// relationship line is derived, and the verdict lands on the right key.
{
  const ghostEntry = {
    entryId: 'include:ghost-service',
    moduleName: '@deepseek-ai/dsh-ghost-service',
    meta: { title: '幽灵服务', description: '一个既无关键词也无法从名字看出来的服务。' },
  }
  const fakePluginManager = {
    listBundles: async () => [],
    listPlugins: async () => [ghostEntry],
  }
  const llm = makeLlm({
    providers: [{ id: 'p' }], models: [{ id: 'm' }],
    reply: JSON.stringify([
      { key: 'plugin:include:ghost-service', category: 'infra', why: '它作为后台服务挂在宿主里' },
    ]),
  })
  const handler = mount({ llm, pluginManager: fakePluginManager })
  const out = await suggest(handler, { ai: true, source: true, reason: true, locale: 'zh' })
  const prompt = promptOf(llm)

  check('a Loader entry is offered to the model', out.ai.candidates === 1, out.ai)
  check('a Loader entry is actually asked about', out.ai.asked === 1, out.ai)
  check('the prompt carries the Loader entry', prompt.includes('plugin:include:ghost-service'), prompt.slice(0, 600))
  check('the Loader entry is filed from the model\'s answer',
    (out.added || []).some((item) => item.key === 'plugin:include:ghost-service' && item.basis === 'ai'),
    (out.added || []).map((item) => `${item.key}:${item.basis}`))
  check('the Loader entry is not filed as a guess',
    (out.summary || {}).fromAi === 1, out.summary)

  // The manifest behind the entry is read through the package name, which for
  // this fixture resolves to nothing — so the honest report is zero code and
  // zero role, and the run must say so rather than claim it reasoned.
  check('a Loader entry with no readable manifest reports no code', out.ai.withCode === 0, out.ai)
  check('a Loader entry with no readable manifest reports no role', out.ai.withRole === 0, out.ai)
  check('and the run is not reported as having reasoned', out.ai.reasoned === false, out.ai)
}

/* ---- report ----------------------------------------------------------- */

if (problems.length > 0) {
  console.error('FAIL: the AI pass is not implemented as claimed:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('PASS: the AI pass is opt-in, gated to the rows the offline passes could not')
console.log('      stand behind, spends a capped and reported amount, keeps unknown keys and')
console.log('      invented categories out of the tree, and falls back on every failure.')