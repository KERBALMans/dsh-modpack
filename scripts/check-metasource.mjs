/**
 * Proves that a bundle's own `package.json` is found even when the package is
 * not in the profile's `node_modules` — the case that made seven of sixteen real
 * rows unanswerable.
 *
 * The packages this matters for are the official `@deepseek-ai/*` bundles. They
 * ship inside the runtime, which in the desktop build is a single `app.asar`
 * archive, so `profile/node_modules/<name>/package.json` does not exist for
 * them. Before `packageMetaRoots` grew the archive roots, the classifier could
 * only read their *names* — and a name is a guess, which is what the user saw as
 * a pile of "无法判断".
 *
 * ## Why this test builds its own archive
 *
 * Plain Node cannot open `app.asar`: the transparency is Electron's own `fs`
 * patch, and a normal `readFileSync('.../app.asar/...')` fails with ENOENT. A
 * test running under `node` therefore cannot read the real archive to check the
 * real answer.
 *
 * So this test reproduces the *layout* instead: `<resources>/app.asar/dsh/
 * node_modules/<pkg>/package.json`, the exact path shape `packageMetaRoots`
 * derives from `process.resourcesPath`. What that proves is the part this plugin
 * owns — that the root is built, tried, and consumed. What it cannot prove is
 * Electron's asar patch, which is a property of the host, not of this code; the
 * live client is where that half is settled.
 *
 * ## The A/B
 *
 * `packageMetaRoots()` re-reads `process.resourcesPath` on every call, so the
 * two halves run in one process against the same fixture: with the archive root
 * removed the row must stay a guess, with it present the same row must be filed
 * from the description. A test that only checked the second half would pass even
 * if the description tier were reading the profile instead.
 *
 * Run:  node scripts/check-metasource.mjs
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = '/api/dsh-modpack'

/* ---- a throwaway DSH home -------------------------------------------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-metasource-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'check'
// `profileDir()` prefers DSH_PROFILE_DIR, and a shell running inside a Harness
// session has it pointed at the real profile. Clearing it is what keeps this
// off the live installation.
delete process.env.DSH_PROFILE_DIR

const profile = join(home, 'profiles', 'check')
mkdirSync(join(profile, 'node_modules'), { recursive: true })

/**
 * A fake `<install>/resources`, holding an archive whose members look exactly
 * like the shipped ones: no `keywords`, and a description that says what the
 * package does.
 */
const resources = join(home, 'fake-install', 'resources')
const archived = join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-archivist')
mkdirSync(archived, { recursive: true })
writeFileSync(join(archived, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh-archivist',
  version: '0.2.1-rc.3',
  // Deliberately absent: this is what the official bundles actually ship, and it
  // is why the earlier keyword-only classifier could not see them at all.
  description: 'Context compression for long conversations.',
}, null, 2), 'utf8')

/**
 * The control. It exists in no root at all, so it must stay a guess in both
 * halves — which is what stops the assertions below from passing on a bug that
 * simply classifies everything.
 */
const CONTROL = 'mystery-plugin'

const BUNDLES = ['@deepseek-ai/dsh-archivist', CONTROL]
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'check-profile',
  version: '0.0.0',
  private: true,
  dependencies: Object.fromEntries(BUNDLES.map((n) => [n, '1.0.0'])),
  dsh: { profile: { bundles: BUNDLES } },
}, null, 2), 'utf8')

/* ---- mount the host half against a fake Cordis context --------------- */

let handler = null

const fakeWebServer = {
  register(options) {
    if (options && options.kind === 'prefix' && typeof options.handler === 'function') handler = options.handler
    return () => {}
  },
}

const childCtx = {
  get: () => undefined,
  webServer: fakeWebServer,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
}

const ctx = {
  get: (name) => (name === 'webServer' ? fakeWebServer : undefined),
  inject(names, cb) { if (Array.isArray(names) && names.includes('webServer')) cb(childCtx) },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
}

// A plain Node host has no such property; adding it here is how this test stands
// in for Electron, which sets it to `<install>/resources`.
process.resourcesPath = undefined

const mod = await import('../index.js')
if (typeof mod.apply !== 'function') {
  console.error('FAIL: index.js does not export an `apply` function')
  process.exit(1)
}
mod.apply(ctx)

if (!handler) {
  console.error('FAIL: the host half never registered a webServer prefix handler')
  process.exit(1)
}

/* ---- minimal HTTP doubles ------------------------------------------- */

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

async function call(method, path, body) {
  const res = makeRes()
  await handler(makeReq(method, path, body), res)
  let json = null
  try { json = res.body ? JSON.parse(res.body) : null } catch { /* non-JSON */ }
  return { status: res.status, json }
}

/** One offline proposal, keyed by row. Offline on purpose: nothing here should
 *  need the network, and a network call would make this depend on GitHub. */
async function propose() {
  const r = await call('POST', `${API}/categories/suggest`, { locale: 'zh' })
  if (r.json?.ok !== true) {
    console.error(`FAIL: suggest did not answer ok — ${JSON.stringify(r.json?.error)}`)
    process.exit(1)
  }
  return new Map((r.json.added || []).map((item) => [item.key, item]))
}

/* ---- assertions ------------------------------------------------------ */

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const ARCHIVED_KEY = 'bundle:@deepseek-ai/dsh-archivist'
const CONTROL_KEY = `bundle:${CONTROL}`

/* 1. without the archive root, the packaged bundle is only a guess --------- */
{
  process.resourcesPath = undefined
  const byKey = await propose()

  const archivedRow = byKey.get(ARCHIVED_KEY)
  check('the archived bundle is present in the proposal', Boolean(archivedRow),
    `keys were ${[...byKey.keys()].join(', ')}`)
  check(
    'with no archive root the packaged bundle can only be guessed',
    archivedRow?.basis === 'none' || archivedRow?.basis === 'name',
    `basis was ${archivedRow?.basis} — if this is 'desc' the test is reading a root it should not have`,
  )
  check('the guess is not filed as if it were evidence', archivedRow?.basis !== 'desc',
    `basis was ${archivedRow?.basis}`)
}

/* 2. with the archive root, the same row is filed from its description ----- */
{
  process.resourcesPath = resources
  const byKey = await propose()

  const archivedRow = byKey.get(ARCHIVED_KEY)
  check('the archived bundle is still present with the archive root', Boolean(archivedRow))
  check(
    'the packaged bundle is filed from its own description',
    archivedRow?.basis === 'desc',
    `basis was ${archivedRow?.basis} (category ${archivedRow?.categoryName})`,
  )
  check(
    "the description puts it in the context category",
    archivedRow?.categoryName === '上下文与记忆',
    `got ${archivedRow?.categoryName}`,
  )
  // The reason has to name the source the basis claims, or the panel would show
  // "the plugin's own package.json description says" over a guess.
  check(
    'the stated reason matches the basis',
    typeof archivedRow?.reason === 'string' && archivedRow.reason.includes('package.json'),
    `reason was ${JSON.stringify(archivedRow?.reason)}`,
  )
  // Nothing about this should have been sent anywhere: the whole point of the
  // local description tier is that it costs no network call.
  const stats = (await call('POST', `${API}/categories/suggest`, { locale: 'zh' })).json?.remote
  check('no remote lookup was attempted', (stats?.asked ?? 0) === 0, JSON.stringify(stats))
}

/* 3. a package that exists nowhere must not be invented ------------------- */
{
  for (const [label, root] of [['without', undefined], ['with', resources]]) {
    process.resourcesPath = root
    const byKey = await propose()
    const control = byKey.get(CONTROL_KEY)
    check(`a package in no root stays a guess ${label} the archive root`, control?.basis !== 'desc',
      `basis was ${control?.basis}`)
  }
}

/* ---- report ---------------------------------------------------------- */

if (failures.length) {
  console.error(`\ncheck-metasource: ${failures.length} failed`)
  for (const line of failures) console.error(`  ✗ ${line}`)
  process.exit(1)
}

console.log('check-metasource: all assertions passed')
console.log('  - a packaged bundle in no profile node_modules is guessed without the archive root')
console.log('  - the same bundle is filed from its own description once the archive root is present')
console.log('  - a package in no root at all stays a guess in both')
console.log('  - the local description tier performs no network call')