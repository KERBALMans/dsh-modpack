/**
 * check-future.mjs — the plugin must survive Harness versions other than this one,
 * on the *client* side as well as the host side.
 *
 * `check-compat.mjs` covers the host half: it mounts the plugin against six
 * synthetic `pluginManager`/`llm` shapes and proves each degradation is
 * graceful. That leaves the half the user actually looks at, and the two
 * failure modes that only exist because this plugin is *two* files loaded from
 * two different places:
 *
 *  1. **The halves can be different versions.** The host half is read when the
 *     plugin is applied; the client half is fetched by the browser, which may
 *     serve yesterday's copy from its cache. Nothing about that combination is
 *     a bug in the plugin, but every request the stale page makes is answered
 *     by a route that may have moved on. `API_VERSION` is the handshake that
 *     turns that into one sentence the user can act on ("reload"), instead of a
 *     scatter of "the button does nothing".
 *
 *  2. **The page bootstrap is not a contract.** `window.__ModuleLoader__`,
 *     `ctx.slots.inject` and the slot key names are Harness implementation
 *     details. A future build that renames any of them must cost this plugin
 *     its settings tab — not take the whole Settings dialog down with an
 *     uncaught TypeError at module scope, and not lose the *other* seat when
 *     only one of the two keys moved.
 *
 * Like the other client checks this evaluates the shipped source rather than a
 * copy: a re-implementation here would only prove the copy works.
 *
 *   node scripts/check-future.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOST = join(ROOT, 'index.js')
const CLIENT = join(ROOT, 'client.js')

const problems = []
function check(label, condition, detail) {
  if (!condition) problems.push(detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`)
}

const hostSource = readFileSync(HOST, 'utf8')
const clientSource = readFileSync(CLIENT, 'utf8')

/** The body of a `name(...) { ... }` declaration, braces balanced. */
function sliceFunction(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) return null
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

/* ---- 1. the two halves must agree on the route version ---------------- */

function versionOf(source, file) {
  const match = /const API_VERSION = (\d+)/.exec(source)
  if (!match) {
    console.error(`FAIL: ${file} has no \`const API_VERSION = <n>\``)
    process.exit(1)
  }
  return Number(match[1])
}

const hostApi = versionOf(hostSource, 'index.js')
const clientApi = versionOf(clientSource, 'client.js')
check('the host and client halves declare the same API_VERSION', hostApi === clientApi,
  { host: hostApi, client: clientApi })

check('the host half reports apiVersion on /diag',
  /apiVersion: API_VERSION,/.test(hostSource))

/* ---- 2. only a stated disagreement is a mismatch ---------------------- */

const mismatchSource = sliceFunction(clientSource, 'function apiMismatchOf(')
check('client.js still has `apiMismatchOf`', Boolean(mismatchSource))
if (mismatchSource) {
  const apiMismatchOf = new Function(`${mismatchSource}; return apiMismatchOf;`)()

  check('an older host that reports no number is NOT a mismatch',
    apiMismatchOf({ ok: true }, 2) === null,
    apiMismatchOf({ ok: true }, 2))
  check('a host that reports a non-number is NOT a mismatch',
    apiMismatchOf({ ok: true, apiVersion: '2' }, 2) === null,
    apiMismatchOf({ ok: true, apiVersion: '2' }, 2))
  check('a failed probe is NOT a mismatch',
    apiMismatchOf({ ok: false }, 2) === null,
    apiMismatchOf({ ok: false }, 2))
  check('a missing probe answer is NOT a mismatch',
    apiMismatchOf(null, 2) === null, apiMismatchOf(null, 2))
  check('the same number is NOT a mismatch',
    apiMismatchOf({ ok: true, apiVersion: 2 }, 2) === null,
    apiMismatchOf({ ok: true, apiVersion: 2 }, 2))
  const stale = apiMismatchOf({ ok: true, apiVersion: 1 }, 2)
  check('a different number IS a mismatch, carrying both sides',
    Boolean(stale) && stale.host === 1 && stale.self === 2, stale)
}

// A verdict function nobody consults is a comment. The probe's answer has to
// reach the state the banner reads from.
check('the probe result is stored in the mismatch state',
  /setApiMismatch\(apiMismatchOf\(diag, API_VERSION\)\)/.test(clientSource))

/* ---- 3. transport failures must say what they are --------------------- */

const callSource = sliceFunction(clientSource, 'async function call(')
check('client.js still has `call`', Boolean(callSource))
if (callSource) {
  const makeCall = (fetchImpl) => new Function('API', 'fetch',
    `${callSource}; return call;`)('/api/dsh-modpack', fetchImpl)

  const offline = makeCall(async () => { throw new Error('ECONNREFUSED') })
  let offlineError = null
  try { await offline('/diag') } catch (err) { offlineError = err }
  check('a refused connection names the host half, not "Failed to fetch"',
    offlineError && /cannot reach the host half/.test(offlineError.message)
      && /连不上后台插件/.test(offlineError.message),
    offlineError && offlineError.message)

  const missing = makeCall(async () => ({ status: 404, ok: false }))
  let missingError = null
  try { await missing('/diag') } catch (err) { missingError = err }
  check('a 404 names the route and blames an older host half',
    missingError && /no such route/.test(missingError.message)
      && missingError.message.includes('/api/dsh-modpack/diag'),
    missingError && missingError.message)
  check('a 404 says the same thing in Chinese, not a generic failure',
    missingError && /没有这个接口/.test(missingError.message)
      && /旧版本/.test(missingError.message),
    missingError && missingError.message)

  const html = makeCall(async () => ({
    status: 200,
    ok: true,
    json: async () => { throw new SyntaxError('Unexpected token <') },
  }))
  let htmlError = null
  try { await html('/diag') } catch (err) { htmlError = err }
  check('a non-JSON reply says so instead of surfacing a parse error',
    htmlError && /not JSON/.test(htmlError.message),
    htmlError && htmlError.message)

  const good = makeCall(async () => ({ status: 200, ok: true, json: async () => ({ ok: true, apiVersion: 2 }) }))
  const answer = await good('/diag')
  check('a healthy reply is returned unchanged', answer && answer.apiVersion === 2, answer)
}

/* ---- 4. the client module must attach, or not, without throwing ------- */

/** Evaluate the shipped client module against a synthetic `window`. */
function loadClient(windowLike) {
  const run = new Function('window', clientSource)
  return run(windowLike)
}

let loaderThrew = null
let loaderCalls = 0
try {
  loadClient({})
  loadClient({ __ModuleLoader__: {} }) // present but not a function
  loadClient({ __ModuleLoader__: { load() { loaderCalls += 1 } } })
} catch (err) {
  loaderThrew = err
}
check('a missing or reshaped `window.__ModuleLoader__` never throws', loaderThrew === null,
  loaderThrew && loaderThrew.message)
check('a working loader is still called exactly once', loaderCalls === 1, loaderCalls)

/* ---- 5. one moved slot key must not cost the other seat ---------------- */

const factoryAt = clientSource.indexOf('factory(require) {')
check('client.js still registers through a factory', factoryAt > 0)

/** Build the plugin object the factory returns, with a fake React + document. */
function makePlugin() {
  let depth = 0
  let end = -1
  for (let i = clientSource.indexOf('{', factoryAt); i < clientSource.length; i += 1) {
    if (clientSource[i] === '{') depth += 1
    else if (clientSource[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  const inner = clientSource.slice(clientSource.indexOf('{', factoryAt) + 1, end)
  const factory = new Function('require', inner)
  return factory((name) => {
    if (name === 'react') return { createElement: () => null }
    throw new Error(`unexpected require(${name})`)
  })
}

const doc = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
  head: { appendChild() {} },
  documentElement: { getAttribute: () => 'zh' },
}

function mountPlugin(slots) {
  const registered = []
  const ctx = {
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    slots: slots === undefined ? undefined : {
      inject(key, cb) { return slots.inject(key, cb) },
      register(def) { registered.push(def.name); return () => {} },
    },
  }
  const previous = globalThis.document
  // The client half reports every slot it could not attach to. That report is
  // the behaviour under test, not noise to read, so it is captured here and
  // asserted separately rather than printed into the pass line.
  const warned = []
  const realWarn = console.warn
  console.warn = (...args) => warned.push(args.join(' '))
  globalThis.document = doc
  let error = null
  try {
    makePlugin().apply(ctx)
  } catch (err) {
    error = err
  } finally {
    console.warn = realWarn
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
  return { error, registered, warned }
}

const healthy = mountPlugin({ inject: (_key, cb) => cb() })
check('both seats register on a healthy build',
  healthy.error === null && healthy.registered.length === 2, healthy.registered)
check('a healthy build warns about nothing', healthy.warned.length === 0, healthy.warned)

const moved = mountPlugin({
  inject(key, cb) {
    if (key === 'settings.section') throw new Error(`unknown slot ${key}`)
    return cb()
  },
})
check('one renamed slot key does not stop the other seat',
  moved.error === null && moved.registered.length === 1
    && moved.registered[0] === 'settings.plugins.tab',
  { error: moved.error && moved.error.message, registered: moved.registered })
check('a renamed slot key is reported, naming the key',
  moved.warned.length === 1 && moved.warned[0].includes('settings.section'), moved.warned)

const noSlots = mountPlugin(undefined)
check('a build without a `slots` service does not throw out of apply',
  noSlots.error === null, noSlots.error && noSlots.error.message)
check('a build without a `slots` service says so once per seat',
  noSlots.warned.length === 2, noSlots.warned)

/* ---- 6. the host half still answers on a build without `inject` ------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-future-'))
const profile = join(home, 'profiles', 'desktop')
mkdirSync(profile, { recursive: true })
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'desktop'
process.env.DSH_PROFILE_DIR = profile
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
}), 'utf8')

const mod = await import('../index.js')

function mountHost({ withInject }) {
  const state = { handler: null }
  const webServer = { register(options) { state.handler = options.handler; return () => { state.handler = null } } }
  const manager = { listBundles: async () => [] }
  const ctx = {
    get(name) {
      if (name === 'pluginManager') return manager
      if (name === 'webServer') return webServer
      return undefined
    },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  if (withInject) {
    ctx.inject = (names, cb) => {
      const service = ctx.get(names[0])
      if (!service) return
      cb({
        get: (n) => ctx.get(n),
        effect: (fn) => ctx.effect(fn),
        [names[0]]: service,
      })
    }
  }
  let error = null
  try { mod.apply(ctx) } catch (err) { error = err }
  return { error, state }
}

const modern = mountHost({ withInject: true })
check('a modern build registers the route', modern.error === null && Boolean(modern.state.handler),
  modern.error && modern.error.message)

const legacy = mountHost({ withInject: false })
check('a runtime without `ctx.inject` falls back instead of throwing',
  legacy.error === null && Boolean(legacy.state.handler),
  legacy.error && legacy.error.message)

function callHost(state, path) {
  // No route is a result, not a crash: the assertion below reports it as the
  // failure it is, and the rest of the run still reaches the report line.
  if (typeof state.handler !== 'function') {
    return Promise.resolve({ status: 0, json: { ok: false, error: 'no route registered' } })
  }
  const req = { method: 'GET', url: path, on(event, listener) { if (event === 'end') listener(); return req } }
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      writeHead(status) { this.statusCode = status; return this },
      end(chunk) {
        try { resolve({ status: this.statusCode, json: JSON.parse(chunk || '{}') }); }
        catch { reject(new Error(`non-JSON reply: ${String(chunk).slice(0, 120)}`)) }
      },
    }
    Promise.resolve(state.handler(req, res)).catch(reject)
  })
}

const diag = await callHost(legacy.state, '/api/dsh-modpack/diag')
check('an old-runtime mount still answers /diag', diag.status === 200 && diag.json.ok === true, diag.status)
check('/diag carries the route version the client compares against',
  diag.json.apiVersion === hostApi, { got: diag.json.apiVersion, expected: hostApi })
check('/diag still carries capabilities', Boolean(diag.json.capabilities)
  && diag.json.capabilities.installBundle === false,
  diag.json.capabilities)

rmSync(home, { recursive: true, force: true })

/* ---- report ----------------------------------------------------------- */

if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('PASS: the halves hand-shake, a stale page says so, and a reshaped shell')
console.log('      costs one seat at most — never the Settings page')
