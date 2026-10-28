/**
 * Proves the classifier looks in the profile the host actually launched, not in
 * the one an environment variable happens to name.
 *
 * ## What went wrong
 *
 * `profileDir()` used to be `DSH_PROFILE_DIR || <home>/profiles/<DSH_PROFILE>`
 * with `'default'` as the last resort. On the desktop client the host is given
 * the profile directory as a *command-line argument*, and neither variable is
 * exported into the plugin's process — they are injected into shell calls, not
 * into the host. So the fallback resolved to `<home>/profiles/default`, which
 * does not exist, and every profile-installed package silently became
 * unreadable while the asar-resident official ones still resolved. The symptom
 * was not "nothing is found"; it was "the plugins I installed myself are all
 * 无法判断", which reads like a classifier problem and is a path problem.
 *
 * ## The shape of the test
 *
 * The fixture is deliberately hostile: `DSH_PROFILE` names a profile directory
 * that exists and is empty, while the fake `profileContext.dir` names the one
 * holding the packages. If `apply` ignores the context, the package is
 * unreachable and the row can only be guessed — which is exactly the bug. If it
 * honours the context, the row is filed from the description inside that
 * package's own `package.json`.
 *
 * A second half checks the fallback still works: with no profile context at all
 * (the way the other tests mount the plugin, and the way a plain `node` host
 * runs), the environment must still decide. Without that half this test would
 * pass on a change that made the plugin depend on a service it cannot require.
 *
 * Run:  node scripts/check-profileroot.mjs
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = '/api/dsh-modpack'

/* ---- a throwaway DSH home with two profiles -------------------------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-profileroot-'))
process.env.DSH_HOME = home
// The decoy: this is what the environment claims, and it is empty on purpose.
process.env.DSH_PROFILE = 'decoy'
delete process.env.DSH_PROFILE_DIR

const decoy = join(home, 'profiles', 'decoy')
mkdirSync(join(decoy, 'node_modules'), { recursive: true })
writeFileSync(join(decoy, 'package.json'), JSON.stringify({
  name: 'decoy-profile',
  version: '0.0.0',
  private: true,
}, null, 2), 'utf8')

// The real one: holds the package that must be found.
const real = join(home, 'profiles', 'launched-by-argument')
const PKG = 'my-own-plugin'
const pkgDir = join(real, 'node_modules', PKG)
mkdirSync(pkgDir, { recursive: true })
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
  name: PKG,
  version: '1.0.0',
  description: 'Streams terminal sessions over a websocket.',
}, null, 2), 'utf8')
writeFileSync(join(real, 'package.json'), JSON.stringify({
  name: 'launched-profile',
  version: '0.0.0',
  private: true,
  dependencies: { [PKG]: '1.0.0' },
  dsh: { profile: { bundles: [PKG] } },
}, null, 2), 'utf8')

/* ---- mount the host half --------------------------------------------- */

function mount(profileContext) {
  let handler = null
  const fakeWebServer = {
    register(options) {
      if (options && options.kind === 'prefix' && typeof options.handler === 'function') handler = options.handler
      return () => {}
    },
  }
  const childCtx = {
    get: (name) => (name === 'webServer' ? fakeWebServer : undefined),
    webServer: fakeWebServer,
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  const services = new Map()
  if (profileContext) services.set('profileContext', profileContext)
  const ctx = {
    get: (name) => (name === 'webServer' ? fakeWebServer : services.get(name)),
    inject(names, cb) { if (Array.isArray(names) && names.includes('webServer')) cb(childCtx) },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  return { ctx, handler: () => handler }
}

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
  const res = { status: 0, headers: null, body: '', ended: false }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.end = (chunk) => { if (chunk) res.body += String(chunk); res.ended = true }
  return res
}

async function call(handler, method, path, body) {
  const res = makeRes()
  await handler(makeReq(method, path, body), res)
  let json = null
  try { json = res.body ? JSON.parse(res.body) : null } catch { /* non-JSON */ }
  return { status: res.status, json }
}

/* ---- assertions ------------------------------------------------------ */

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const KEY = `bundle:${PKG}`

/* 1. the profile context wins over the environment --------------------- */
{
  const { ctx, handler } = mount({ dir: real, name: 'launched-by-argument' })
  const mod = await import(`../index.js?profileroot=context`)
  mod.apply(ctx)
  const h = handler()
  check('the host half registered a handler', typeof h === 'function')

  const diag = await call(h, 'GET', `${API}/diag`)
  check('diag reports the launched profile directory',
    diag.json?.profileDir === real,
    `profileDir was ${JSON.stringify(diag.json?.profileDir)}`)

  const suggest = await call(h, 'POST', `${API}/categories/suggest`, { locale: 'zh' })
  const row = new Map((suggest.json?.added || []).map((item) => [item.key, item])).get(KEY)
  check('the package installed in the launched profile is seen', Boolean(row),
    `added keys were ${(suggest.json?.added || []).map((item) => item.key).join(', ')}`)
  check('and it is filed from its own description, not guessed',
    row?.basis === 'desc',
    `basis was ${row?.basis} — a name or none here means the profile directory was wrong`)
  check('the category is the one the description points at',
    row?.categoryId === 'auto-terminal',
    `category was ${row?.categoryId}`)
}

/* 2. with no profile context, the environment still decides ------------- */
{
  const { ctx, handler } = mount(null)
  // Point the environment at the real profile for this half, so the fallback has
  // something correct to fall back *to*: the assertion is that it is still read.
  process.env.DSH_PROFILE_DIR = real
  const mod = await import(`../index.js?profileroot=env`)
  mod.apply(ctx)
  const h = handler()
  const diag = await call(h, 'GET', `${API}/diag`)
  check('diag falls back to the environment when there is no context',
    diag.json?.profileDir === real,
    `profileDir was ${JSON.stringify(diag.json?.profileDir)}`)
  delete process.env.DSH_PROFILE_DIR
}

/* ---- report ---------------------------------------------------------- */

if (failures.length === 0) {
  console.log('PASS: the classifier reads the profile the host launched,')
  console.log('      and still falls back to the environment when there is no profile context')
  process.exit(0)
}
console.error(`FAIL: ${failures.length} check(s) failed`)
for (const line of failures) console.error(`  - ${line}`)
process.exit(1)
