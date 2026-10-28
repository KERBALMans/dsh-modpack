/**
 * check-compat.mjs — the plugin must survive Harness versions other than this one.
 *
 * "Adapt to the current client and to future clients" is the requirement this
 * file exists to make testable. Version numbers cannot be the test: a future
 * build may add, rename or drop a `pluginManager` method without touching the
 * number, and an rc build may already carry a method its number does not
 * promise. So the plugin probes for methods and degrades feature by feature —
 * and this script mounts the host half against five different runtimes to prove
 * each degradation is graceful rather than fatal:
 *
 *   full      every method present            -> inventory + plan + apply work
 *   old       no listPlugins/setPluginEnabled -> still lists, warns, installs
 *   minimal   only listBundles/installBundle  -> no toggles, no requestId
 *   bare      no pluginManager at all         -> file-based inventory, no install
 *   hostile   every method throws             -> errors surfaced, never crashes
 *
 * Run:  node scripts/check-compat.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mod = await import('../index.js')

const failures = []
const fail = (message) => failures.push(message)

/* ---- fake profile ---------------------------------------------------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-compat-'))
const profile = join(home, 'profiles', 'desktop')
mkdirSync(profile, { recursive: true })
// Both variables must be pinned: `DSH_PROFILE_DIR` is set in a real DSH shell
// and takes precedence over `DSH_HOME`, so overriding only the latter would
// silently point this test at the live profile and make it assert against
// whatever the developer happens to have installed.
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'desktop'
process.env.DSH_PROFILE_DIR = profile

writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-desktop',
  private: true,
  dependencies: { 'some-plugin': '^1.0.0' },
  dsh: { profile: { bundles: ['some-plugin'] } },
}), 'utf8')

/* ---- fake runtimes --------------------------------------------------- */

function bundle(name, enabled) {
  return { name, official: false, availability: 'profile', enabled, installed: true, optional: false, removable: true, rows: [], overrides: [] }
}

/** Build a `pluginManager` with exactly the named methods, recording calls. */
function makeManager(methods) {
  const calls = []
  const all = {
    listBundles: async () => [bundle('some-plugin', true), bundle('other-plugin', false)],
    listPlugins: async () => [{ entryId: 'e1', moduleName: 'some-plugin', enabled: true, fiberPhase: 'active' }],
    installBundle: async (spec, options) => {
      calls.push({ method: 'installBundle', spec, options })
      return { changed: true, application: 'applied', stage: 'install', target: spec }
    },
    removeBundle: async () => ({ changed: true, application: 'applied', stage: 'remove', target: 'x' }),
    setBundleEnabled: async (name, enabled) => {
      calls.push({ method: 'setBundleEnabled', name, enabled })
      return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
    },
    setPluginEnabled: async (id, enabled) => {
      calls.push({ method: 'setPluginEnabled', id, enabled })
      return { changed: true, application: 'applied', stage: 'enable', target: id, enabled }
    },
    registries: async () => ({ registry: null, fallbackRegistries: [], resolved: null }),
    inspect: async () => ({ status: 'refused', problem: 'x', reason: 'x' }),
    waitForInstall: async () => null,
    cancelInstall: async () => ({ cancelled: false }),
    listVersionExemptions: () => ({ exemptions: {}, warnings: [] }),
    setVersionExemption: async () => ({ changed: false, application: 'applied', stage: 'install', target: 'x' }),
  }
  const manager = {}
  for (const name of methods) manager[name] = all[name]
  return { manager, calls }
}

function makeCtx(manager, extras) {
  // The plugin's only outward surface is its HTTP routes, so the fake context
  // captures the handler `webServer.register` receives and the test drives it
  // exactly as the UI does. Going through the routes (rather than calling
  // internals) keeps this honest: it exercises auth, body parsing and the
  // capability wiring in the same order production does.
  const state = { handler: null }
  const services = extras || {}
  const ctx = {
    get(name) {
      if (name === 'pluginManager') return manager
      if (name in services) return services[name]
      if (name === 'webServer') {
        return {
          register(options) {
            state.handler = options.handler
            return () => { state.handler = null }
          },
        }
      }
      return undefined
    },
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  }
  return { ctx, state }
}

/** Drive the captured route handler with a fake request/response pair. */
function call(state, method, path, body) {
  if (!state.handler) return Promise.reject(new Error('the plugin never registered a route handler'))
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
  const req = {
    method,
    url: path,
    on(event, listener) {
      if (event === 'data' && payload) listener(payload)
      if (event === 'end') listener()
      return req
    },
  }
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      body: '',
      writeHead(status) { this.statusCode = status; return this },
      end(chunk) {
        this.body = chunk || ''
        try {
          resolve({ status: this.statusCode, json: JSON.parse(this.body) })
        } catch {
          reject(new Error(`route returned non-JSON (${this.statusCode}): ${this.body.slice(0, 200)}`))
        }
      },
    }
    Promise.resolve(state.handler(req, res)).catch(reject)
  })
}

const API = '/api/dsh-modpack'

const PACK = {
  format: 'dsh-modpack',
  formatVersion: 1,
  name: 'compat-pack',
  plugins: [
    { kind: 'bundle', name: 'some-plugin', enabled: true },
    { kind: 'bundle', name: 'brand-new-plugin', spec: 'brand-new-plugin@^2.0.0', enabled: false },
  ],
}

/* ---- scenarios ------------------------------------------------------- */

const FULL = ['listBundles', 'listPlugins', 'installBundle', 'removeBundle', 'setBundleEnabled',
  'setPluginEnabled', 'registries', 'inspect', 'waitForInstall', 'cancelInstall',
  'listVersionExemptions', 'setVersionExemption']

async function scenario(label, methods, assertions) {
  const { manager, calls } = makeManager(methods)
  const { ctx, state } = makeCtx(manager)
  mod.apply(ctx)
  try {
    await assertions({ ctx, state, calls })
  } catch (err) {
    fail(`${label}: threw — ${(err && err.message) || String(err)}`)
  }
}

/* 1. full runtime: nothing degraded, requestId passed through. */
await scenario('full', FULL, async ({ state, calls }) => {
  const inventory = (await call(state, 'GET', `${API}/inventory`)).json
  if (!inventory.ok) fail(`full: inventory not ok — ${inventory.reason}`)
  if (inventory.degraded) fail('full: inventory reported degraded')
  if (!inventory.bundles || inventory.bundles.length !== 2) {
    fail(`full: expected 2 bundles, got ${inventory.bundles ? inventory.bundles.length : 'none'}`)
  }

  const plan = (await call(state, 'POST', `${API}/plan`, { modpack: PACK })).json
  if (!plan.ok) fail(`full: plan not ok — ${plan.error}`)
  const install = (plan.actions || []).find((a) => a.type === 'install' && a.name === 'brand-new-plugin')
  if (!install) fail('full: the missing bundle was not planned for install')

  const applied = (await call(state, 'POST', `${API}/apply`, { modpack: PACK })).json
  if (!applied.ok) fail(`full: apply not ok — ${applied.error}`)
  const installCall = calls.find((c) => c.method === 'installBundle')
  if (!installCall) fail('full: installBundle was never called')
  else if (!installCall.options || !installCall.options.requestId) {
    fail('full: requestId was not passed on a runtime that supports it')
  }

  const diag = (await call(state, 'GET', `${API}/diag`)).json
  if (!diag.capabilities) fail('full: diag did not report capabilities')
  else if (diag.capabilities.installBundle !== true) {
    fail(`full: diag misreported installBundle — ${JSON.stringify(diag.capabilities)}`)
  }
})

/* 2. older runtime: no listPlugins, no setPluginEnabled, no wait/cancel. */
await scenario('old', ['listBundles', 'installBundle', 'removeBundle', 'setBundleEnabled'], async ({ state, calls }) => {
  const inventory = (await call(state, 'GET', `${API}/inventory`)).json
  if (!inventory.ok) fail(`old: inventory not ok — ${inventory.reason}`)
  if (!inventory.bundles || inventory.bundles.length !== 2) {
    fail('old: bundles were not listed')
  }
  // Dropping listPlugins must be *reported*, not silently rendered as "no
  // plugins installed" — that reads as data loss to the user.
  const mentioned = (inventory.warnings || []).some((w) => String(w).includes('listPlugins'))
  if (!mentioned) fail(`old: no warning explained the missing listPlugins (got ${JSON.stringify(inventory.warnings)})`)

  const applied = (await call(state, 'POST', `${API}/apply`, { modpack: PACK })).json
  if (!applied.ok) fail(`old: apply not ok — ${applied.error}`)
  const installCall = calls.find((c) => c.method === 'installBundle')
  if (!installCall) fail('old: installBundle was never called')
  // requestId is meaningless without wait/cancel — sending it anyway would be
  // harmless today but is exactly the kind of thing a stricter build rejects.
  else if (installCall.options && installCall.options.requestId) {
    fail('old: requestId was sent to a runtime without waitForInstall/cancelInstall')
  }
})

/* 3. minimal runtime: no setBundleEnabled either — toggles must be reported
 *    as unsupported, and installs must still go through. */
await scenario('minimal', ['listBundles', 'installBundle'], async ({ state, calls }) => {
  const applied = (await call(state, 'POST', `${API}/apply`, {
    modpack: {
      format: 'dsh-modpack',
      formatVersion: 1,
      name: 'toggle-pack',
      plugins: [
        { kind: 'bundle', name: 'some-plugin', enabled: false },
        { kind: 'bundle', name: 'brand-new-plugin', spec: 'brand-new-plugin@^2.0.0', enabled: true },
      ],
    },
  })).json
  if (!applied.ok) fail(`minimal: apply not ok — ${applied.error}`)
  const unsupported = (applied.results || []).filter((r) => r.outcome === 'unsupported')
  if (unsupported.length !== 1) {
    fail(`minimal: expected 1 unsupported toggle, got ${unsupported.length} (${JSON.stringify((applied.results || []).map((r) => r.outcome))})`)
  }
  if (!calls.some((c) => c.method === 'installBundle')) {
    fail('minimal: installs stopped working just because toggling was unavailable')
  }
})

/* 4. bare runtime: no pluginManager at all. The inventory must still be
 *    readable from the profile files, and install must refuse *with a reason*
 *    rather than throwing. */
await scenario('bare', [], async ({ state }) => {
  const inventory = (await call(state, 'GET', `${API}/inventory`)).json
  if (!inventory.ok) fail(`bare: inventory not ok — ${inventory.reason}`)
  if (!inventory.degraded) fail('bare: inventory should report itself degraded without pluginManager')
  if (!inventory.bundles || inventory.bundles.length !== 1) {
    fail(`bare: expected 1 bundle read from package.json, got ${inventory.bundles ? inventory.bundles.length : 'none'}`)
  }
  const applied = (await call(state, 'POST', `${API}/apply`, { modpack: PACK })).json
  if (applied.ok) fail('bare: apply should refuse without pluginManager')
  else if (!applied.error) fail('bare: refusal carried no explanation')
})

/* 5. hostile runtime: every method present but throwing. The plugin must
 *    surface errors instead of crashing the whole apply pass. */
await scenario('hostile', FULL, async () => {
  const broken = {}
  for (const name of FULL) broken[name] = () => { throw new Error(`${name} exploded`) }
  const { ctx, state } = makeCtx(broken)
  mod.apply(ctx)
  const inventory = (await call(state, 'GET', `${API}/inventory`)).json
  if (!inventory.ok && !inventory.degraded) {
    fail('hostile: inventory neither succeeded nor reported degraded')
  }
  const applied = (await call(state, 'POST', `${API}/apply`, { modpack: PACK })).json
  if (!applied || typeof applied.ok !== 'boolean') fail('hostile: apply returned nothing usable')
})

/* 6-10. The model service is a much newer surface than pluginManager, so a
 *       future client may rename a method, move it, or hand back a differently
 *       shaped prepared call. Every one of those must end as "the offline
 *       answer stands, and here is why" — never as a thrown error, never as a
 *       silently empty classification that looks like a real result. */
async function llmScenario(label, llm, assertions) {
  const { manager, calls } = makeManager(FULL)
  const extras = llm
    ? { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }) } }
    : {}
  const { ctx, state } = makeCtx(manager, extras)
  mod.apply(ctx)
  try {
    await assertions({ ctx, state, calls })
  } catch (err) {
    fail(`${label}: threw — ${(err && err.message) || String(err)}`)
  }
}

async function suggestWithAi(state) {
  const inventory = (await call(state, 'GET', `${API}/inventory`)).json
  if (!inventory.ok) return { broken: `inventory not ok — ${inventory.reason}` }
  // The route spreads the suggestion at the top level (`{ ok, ...suggestion,
  // remote, ai }`), so the assignment list and the AI report sit beside `ok`.
  const body = (await call(state, 'POST', `${API}/categories/suggest`, { ai: true })).json
  if (!body || body.ok !== true) return { broken: `suggest not ok — ${body && body.error}` }
  if (!Array.isArray(body.added) || body.added.length === 0) {
    return { broken: 'the AI pass produced no assignment at all' }
  }
  return { ai: body.ai }
}

const WORKING_REPLY = {
  async prepareCall(config) {
    return {
      config: { ...config, maxTokens: 1800, temperature: 0 },
      stream() {
        return (async function* () {
          yield { type: 'text-delta', text: '{"verdicts":[]}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
  },
  async listProviders() { return [] },
  async listModels() { return [] },
}

await llmScenario('llm-absent', null, async ({ state }) => {
  const out = await suggestWithAi(state)
  if (out.broken) fail(`llm-absent: ${out.broken}`)
  else if (!out.ai) fail('llm-absent: no AI section explaining what happened')
  else if (out.ai.available !== false) fail('llm-absent: reported the model service as available')
  else if (out.ai.reason !== 'llm-unavailable') {
    fail(`llm-absent: reason was ${JSON.stringify(out.ai.reason)}`)
  }
})

await llmScenario('llm-shape-renamed', {}, async ({ state }) => {
  const out = await suggestWithAi(state)
  if (out.broken) fail(`llm-shape-renamed: ${out.broken}`)
  else if (!out.ai || out.ai.available !== false || out.ai.reason !== 'llm-unavailable') {
    fail(`llm-shape-renamed: a service without prepareCall was not reported as unavailable — ${JSON.stringify(out.ai)}`)
  }
})

await llmScenario('llm-prepare-throws', {
  async prepareCall() { throw new Error('prepareCall exploded') },
  async listProviders() { return [] },
  async listModels() { return [] },
}, async ({ state }) => {
  const out = await suggestWithAi(state)
  if (out.broken) fail(`llm-prepare-throws: ${out.broken}`)
  else if (!out.ai || out.ai.available !== true) fail('llm-prepare-throws: the service was not seen as available')
  else if (!(out.ai.failed > 0)) fail('llm-prepare-throws: a throwing prepareCall was not reported as a failure')
})

await llmScenario('llm-stream-not-iterable', {
  async prepareCall(config) { return { config, stream: () => 42 } },
  async listProviders() { return [] },
  async listModels() { return [] },
}, async ({ state }) => {
  const out = await suggestWithAi(state)
  if (out.broken) fail(`llm-stream-not-iterable: ${out.broken}`)
  else if (!out.ai || !(out.ai.failed > 0)) {
    fail('llm-stream-not-iterable: a stream that cannot be iterated was not reported as a failure')
  }
})

await llmScenario('llm-finish-error', {
  ...WORKING_REPLY,
  async prepareCall(config) {
    return {
      config,
      stream() {
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'model unavailable' } } }
        })()
      },
    }
  },
}, async ({ state }) => {
  const out = await suggestWithAi(state)
  if (out.broken) fail(`llm-finish-error: ${out.broken}`)
  else if (!out.ai || !(out.ai.failed > 0)) fail('llm-finish-error: an errored completion was counted as success')
})

/* ---- report ---------------------------------------------------------- */

rmSync(home, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} problem(s)\n`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}
console.log('PASS: full, old, minimal, bare, hostile and 5 model-service shapes all degrade gracefully')