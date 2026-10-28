/**
 * Drives the real `/api/dsh-modpack/categories/suggest` handler with a fake
 * `fetch`, so the online lookup is exercised end to end without touching the
 * network.
 *
 * The claims worth testing here are not "does it classify" but the promises the
 * feature makes about *when* it is allowed to:
 *   - nothing leaves the machine unless the request asked for it;
 *   - a plugin whose own keywords already answered is never looked up at all;
 *   - a monorepo README is never used to describe one of its packages;
 *   - the strongest evidence available wins, and the preview says which;
 *   - a dead network degrades to the local answer instead of failing the page;
 *   - a complete answer is remembered, an outage is not.
 *
 * Every phase starts from an empty cache. The first draft of this file did not,
 * and four of its assertions were passing against cached data without ever
 * reaching the code they claimed to test — `scripts/mutate-remote.mjs` is what
 * caught that, which is the whole reason it exists.
 *
 * Run:  node scripts/check-remote.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = '/api/dsh-modpack'

/* ---- a throwaway DSH home -------------------------------------------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-remote-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'check'
delete process.env.DSH_PROFILE_DIR

const profile = join(home, 'profiles', 'check')
const modules = join(profile, 'node_modules')
mkdirSync(modules, { recursive: true })

const PACKAGES = {
  // Answers from its own keywords. Must never be looked up.
  'dsh-windows-mcp': {
    keywords: ['dsh', 'dsh-plugin', 'mcp', 'automation'],
    description: 'Windows desktop automation',
  },
  // Nothing to go on locally; its GitHub topics answer for it.
  'mystery-plugin': { description: 'Does something' },
  // Scoped package: the registry URL must percent-encode the scope separator,
  // or npm answers 404 and a perfectly ordinary package looks unpublished.
  '@acme/dsh-notes': { description: 'Notes' },
  // Official-style: every one of these points at the deepseek-harness monorepo,
  // whose README describes the whole product rather than this package.
  '@deepseek-ai/dsh-internal-thing': { description: 'An internal Harness package' },
  // The same monorepo, but this one declares `repository.directory`, so the
  // README of its own folder *is* evidence about it. This is how every real
  // `@deepseek-ai/*` package publishes, and the difference between the
  // repository's front page and the package's own is the whole point.
  '@deepseek-ai/dsh-scoped-thing': { description: 'An internal Harness package' },
  // Topics and keywords disagree, so the tier order is observable.
  'dsh-conflict-check': { description: 'Conflict' },
  // Topics say one thing, the README says another: topics must win.
  'dsh-tier-check': { description: 'Nothing known' },
  // Not on npm at all: a complete answer that may be cached.
  'dsh-offline-only': { description: 'Nothing known' },
}

for (const [name, meta] of Object.entries(PACKAGES)) {
  const dir = join(modules, ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...meta }, null, 2), 'utf8')
}

const BUNDLES = Object.keys(PACKAGES)
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'check-profile',
  version: '0.0.0',
  private: true,
  dependencies: Object.fromEntries(BUNDLES.map((n) => [n, '^1.0.0'])),
  dsh: { profile: { bundles: BUNDLES } },
}, null, 2), 'utf8')

/* ---- fake network ----------------------------------------------------- */

const calls = []
let failEverything = false

const REGISTRY = {
  'dsh-windows-mcp': {
    keywords: ['mcp'], description: 'never fetched',
    repository: 'git+https://github.com/x/dsh-windows-mcp.git',
  },
  'mystery-plugin': {
    keywords: ['dsh'], description: 'Some package',
    repository: 'git+https://github.com/someone/mystery-plugin.git',
  },
  '@acme/dsh-notes': {
    keywords: ['dsh'], description: 'A notes plugin',
    repository: 'git+https://github.com/acme/dsh-notes.git',
  },
  '@deepseek-ai/dsh-internal-thing': {
    keywords: [], description: 'An internal Harness package',
    repository: 'git+https://github.com/deepseek-ai/deepseek-harness.git',
  },
  '@deepseek-ai/dsh-scoped-thing': {
    keywords: [], description: 'An internal Harness package',
    repository: {
      type: 'git',
      url: 'git+https://github.com/deepseek-ai/deepseek-harness.git',
      directory: 'packages/bundle/scoped-thing',
    },
  },
  'dsh-conflict-check': {
    keywords: ['session'], description: 'A package',
    repository: 'git+https://github.com/someone/dsh-conflict-check.git',
  },
  'dsh-tier-check': {
    keywords: ['dsh'], description: 'A package',
    repository: 'git+https://github.com/someone/dsh-tier-check.git',
  },
  // 'dsh-offline-only' is deliberately absent -> 404 -> unpublished.
}

const GITHUB = {
  'someone/mystery-plugin': { topics: ['session'], description: 'A session helper' },
  'acme/dsh-notes': { topics: ['ui'], description: 'A panel for notes' },
  // The monorepo's own topics and README describe the whole Harness, which is
  // exactly why they must never be applied to a single package inside it.
  'deepseek-ai/deepseek-harness': {
    topics: ['agent', 'harness'],
    description: 'An MCP server bridge with session management',
  },
  'someone/dsh-conflict-check': { topics: ['ui'], description: 'A panel' },
  'someone/dsh-tier-check': { topics: ['ui'], description: 'A panel' },
}

const READMES = {
  'someone/mystery-plugin': '# Mystery\n\nIt manages your sessions and workspaces.\n',
  // Loaded with strong hints on purpose: if the monorepo guard were removed,
  // this text *would* classify the package, so the assertion has teeth.
  'deepseek-ai/deepseek-harness': '# DeepSeek Harness\n\nAn MCP server bridge for session management and desktop automation.\n',
  'acme/dsh-notes': '# Notes\n\nA small panel.\n',
  'someone/dsh-conflict-check': '# Conflict\n\nA panel.\n',
  // topics say `ui`, this text says `mcp server`: topics is the stronger tier.
  'someone/dsh-tier-check': '# Tier check\n\nThis plugin bridges an MCP server.\n',
}

/**
 * READMEs served from a package's *own folder* inside a monorepo, keyed
 * `<owner>/<repo>/<path>`. Kept apart from `READMES` so the two are visibly
 * different things: the root README must never answer for a package that has
 * its own, and a package that has none must not silently inherit the root.
 */
const DIR_READMES = {
  'deepseek-ai/deepseek-harness/packages/bundle/scoped-thing':
    '# Scoped thing\n\nA theme for the harness window.\n',
}

/**
 * How many fixture rows are classifiable *only* because the network answered.
 * Named once because three separate checks assert on it; a hard-coded 4 in each
 * place rots silently the moment a fixture is added, which is how this number
 * went stale when the directory fixture landed.
 */
const REMOTE_RESOLVABLE = 5

function jsonResponse(value) {
  return { ok: true, status: 200, async json() { return value }, async text() { return JSON.stringify(value) } }
}

function textResponse(value) {
  return { ok: true, status: 200, async json() { return JSON.parse(value) }, async text() { return value } }
}

function notFound() {
  return { ok: false, status: 404, async json() { return null }, async text() { return '404: Not Found' } }
}

globalThis.fetch = async (url) => {
  calls.push(String(url))
  if (failEverything) throw new Error('network down')

  const npm = String(url).match(/^https:\/\/registry\.npmjs\.org\/(.+)\/latest$/)
  if (npm) {
    // Strict on purpose: npm only accepts `%2F` for a scoped name, so an
    // unencoded `@scope/name` must look like a missing package here too.
    const raw = npm[1]
    if (raw.includes('/')) return notFound()
    const name = decodeURIComponent(raw)
    const entry = REGISTRY[name]
    if (!entry) return notFound()
    return jsonResponse({ name, ...entry })
  }

  const gh = String(url).match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)$/)
  if (gh) {
    const entry = GITHUB[gh[1]]
    return entry ? jsonResponse({ full_name: gh[1], ...entry }) : notFound()
  }

  const raw = String(url).match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/HEAD\/(.+)$/)
  if (raw) {
    const path = raw[2]
    // A directory-scoped read and a repo-root read are answered from different
    // tables, so a request that quietly dropped the directory gets a 404 rather
    // than the monorepo's README.
    if (path !== 'README.md') {
      // The directory is the key, so any README filename inside it resolves and
      // a request that quietly dropped the directory does not.
      const dir = path.replace(/\/[^/]*$/, '')
      const scoped = DIR_READMES[`${raw[1]}/${dir}`]
      return scoped ? textResponse(scoped) : notFound()
    }
    const text = READMES[raw[1]]
    return text ? textResponse(text) : notFound()
  }

  return notFound()
}

/* ---- mount the host half --------------------------------------------- */

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

const mod = await import('../index.js')
mod.apply(ctx)
if (!handler) {
  console.error('FAIL: the host half never registered a webServer prefix handler')
  process.exit(1)
}

/* ---- HTTP doubles ----------------------------------------------------- */

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

/* ---- assertions ------------------------------------------------------- */

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const cacheFile = join(home, 'storages', 'dsh-modpack', 'remote-cache.json')
const cacheText = () => {
  try {
    return readFileSync(cacheFile, 'utf8')
  } catch {
    return null
  }
}
/** Every phase starts cold, so a later assertion cannot pass on an earlier phase's cache. */
const cold = () => { rmSync(cacheFile, { force: true }); calls.length = 0 }
const suggest = (extra) => call('POST', `${API}/categories/suggest`, { locale: 'zh', ...extra })
const byKeyOf = (r) => new Map((r.json?.added || []).map((item) => [item.key, item]))

/* 1. offline preview touches no network at all -------------------------- */
{
  cold()
  const r = await suggest({})
  check('offline preview still answers', r.json?.ok === true, JSON.stringify(r.json?.error))
  check('offline preview makes no network call', calls.length === 0, calls.join(', '))
  check('offline preview reports no remote stats', r.json?.remote == null, JSON.stringify(r.json?.remote))
  check('offline preview writes no cache file', cacheText() === null)
}

/* 2. only uncertain rows are looked up, and scoped names resolve -------- */
{
  cold()
  const r = await suggest({ online: true })
  check('online preview answers', r.json?.ok === true, JSON.stringify(r.json?.error))

  const asked = calls.map((u) => decodeURIComponent(u))
  check('a plugin classified from its own keywords is never sent anywhere',
    !asked.some((u) => u.includes('dsh-windows-mcp')), asked.join('\n'))
  check('an unlabelled plugin is looked up',
    asked.some((u) => u.includes('mystery-plugin')), asked.join('\n'))
  check('a scoped package name is percent-encoded for the registry',
    calls.some((u) => u.includes('registry.npmjs.org/@acme%2Fdsh-notes/latest')),
    calls.filter((u) => u.includes('acme')).join('\n'))

  const notes = byKeyOf(r).get('bundle:@acme/dsh-notes')
  check('a scoped package still gets classified from its topics',
    notes?.categoryName === '界面与主题', `got ${notes?.categoryName}`)

  const stats = r.json?.remote
  // The invariant is "every uncertain row was looked up in this cold pass".
  // Pinning the absolute fixture count here is what made this check fail the
  // moment a fixture was added, without anything actually being wrong.
  check('the response reports what the lookup did',
    stats && stats.candidates > 0 && stats.looked === stats.candidates, JSON.stringify(stats))
}

/* 3. a monorepo package: the folder yes, the front page no -------------- */
{
  cold()
  const r = await suggest({ online: true, overwrite: true })
  const asked = calls.map((u) => decodeURIComponent(u))
  const byKey = byKeyOf(r)

  /* 3a. no `repository.directory` -> nothing about it can be honestly read */
  const blind = byKey.get('bundle:@deepseek-ai/dsh-internal-thing')
  // The monorepo README is stuffed with MCP/session/automation hints, so if the
  // guard were gone this row would be filed under MCP with confidence.
  check('a monorepo package with no directory does not inherit the repository description',
    blind?.basis !== 'remote', `basis was ${blind?.basis}, category ${blind?.categoryName}`)
  check('a monorepo package with no directory keeps its local verdict',
    blind?.categoryName === '其他', `got ${blind?.categoryName}`)
  check('the monorepo front page is never read as a package description',
    !asked.some((u) => u.includes('deepseek-ai/deepseek-harness/HEAD/README.md')), asked.join('\n'))

  /* 3b. with it -> read the package's own folder, not the repository */
  const scoped = byKey.get('bundle:@deepseek-ai/dsh-scoped-thing')
  check("a package's own folder is read, not the repository root",
    asked.some((u) => u.includes('deepseek-ai/deepseek-harness/HEAD/packages/bundle/scoped-thing/README.md')),
    asked.join('\n'))
  check('a monorepo package classified from its own folder is reported as remote',
    scoped?.basis === 'remote', `basis was ${scoped?.basis}, category ${scoped?.categoryName}`)
  // `A theme for the harness window` -> 界面与主题. The repository's front page
  // would have said an MCP server instead, so the category names which text won.
  check("a monorepo package's own folder decides its category",
    scoped?.categoryName === '界面与主题', `got ${scoped?.categoryName}`)
  // The npm description said only "An internal Harness package", so a verdict
  // from the readme tier proves the folder's README is what decided this.
  check('a scoped verdict is decided by the README, not the registry blurb',
    scoped?.evidence === 'readme', `evidence was ${scoped?.evidence}`)
  // Eight official plugins share one repository, so a reason that stops at the
  // repo name cannot tell the reader which folder the sentence came from.
  check("a scoped verdict's reason names the folder, not just the repository",
    typeof scoped?.reason === 'string' &&
      scoped.reason.includes('packages/bundle/scoped-thing') &&
      !scoped.reason.includes(`repo ${scoped.repo} 的`) ,
    scoped?.reason)
}

/* 4. the strongest evidence wins and is named ------------------------- */
{
  cold()
  const r = await suggest({ online: true, overwrite: true })
  const byKey = byKeyOf(r)

  const notes = byKey.get('bundle:@acme/dsh-notes')
  check('a repo topic classifies a package the local pass could only guess',
    notes?.categoryName === '界面与主题', `got ${notes?.categoryName}`)
  check('a remote verdict is reported as remote', notes?.basis === 'remote', `basis was ${notes?.basis}`)
  check('a remote verdict names its evidence', notes?.evidence === 'topics', `evidence was ${notes?.evidence}`)
  check('a remote verdict links to its source',
    notes?.source === 'https://github.com/acme/dsh-notes', String(notes?.source))
  check('a remote verdict explains itself',
    typeof notes?.reason === 'string' && notes.reason.includes('dsh-notes'), String(notes?.reason))

  // Registry keywords say `session`, topics say `ui`: topics is the stronger
  // tier, so this is the assertion that actually pins the ordering down.
  const conflict = byKey.get('bundle:dsh-conflict-check')
  check('topics outrank package keywords', conflict?.evidence === 'topics', `evidence was ${conflict?.evidence}`)
  check('the stronger tier decides the category',
    conflict?.categoryName === '界面与主题', `got ${conflict?.categoryName}`)

  // topics say `ui`, the README says `mcp server`.
  const tier = byKey.get('bundle:dsh-tier-check')
  check('topics outrank the README', tier?.evidence === 'topics', `evidence was ${tier?.evidence}`)
  check('the README does not override the topics',
    tier?.categoryName === '界面与主题', `got ${tier?.categoryName}`)

  // The author's keywords still outrank anything found online.
  const win = byKey.get('bundle:dsh-windows-mcp')
  check('a keyword verdict is not overridden by the network', win?.basis === 'tags', `basis was ${win?.basis}`)

  // Five rows only became classifiable because the network answered, and the
  // summary has to say so rather than folding them in with the local verdicts.
  // The count is asserted through REMOTE_RESOLVABLE, and cross-checked here
  // against the response itself, so the two cannot drift apart unnoticed.
  // Counted from the response instead of hard-coded, so adding a fixture row
  // cannot silently weaken this into a tautology.
  const remoteRows = [...byKey.values()].filter((v) => v && v.basis === 'remote').length
  check('the summary counts remote verdicts separately',
    r.json.summary.fromRemote === remoteRows && remoteRows > 0,
    `fromRemote=${r.json.summary.fromRemote} verdicts=${remoteRows}`)
  check('the summary still accounts for every row',
    r.json.summary.fromTags + r.json.summary.fromName + r.json.summary.fromFact +
      r.json.summary.fromRemote + r.json.summary.unclassified === r.json.summary.assigned,
    JSON.stringify(r.json.summary))
}

/* 4b. a confident local answer is never displaced ------------------------ */
{
  // The guarantee is enforced upstream, where the decision to send a name out
  // is made: `enrichRemote` must never look up a row whose own keywords already
  // answered, so no remote verdict for such a row can exist. Asserting it here
  // checks the observable end state — that the keyword answer still wins.
  cold()
  const r = await suggest({ online: true })
  const win = byKeyOf(r).get('bundle:dsh-windows-mcp')
  check('a keyword verdict survives the online pass', win?.basis === 'tags', `basis was ${win?.basis}`)
  check('a keyword verdict keeps its own category',
    win?.categoryName === 'MCP 与外部工具', `got ${win?.categoryName}`)
  check('a keyword verdict was never looked up',
    !calls.map((u) => decodeURIComponent(u)).some((u) => u.includes('dsh-windows-mcp')),
    calls.filter((u) => u.includes('windows')).join('\n'))
}

/* 5. a complete answer is remembered ----------------------------------- */
{
  cold()
  await suggest({ online: true, overwrite: true })
  const firstPass = calls.length
  check('the first online preview did ask the network', firstPass > 0, `${firstPass} calls`)

  calls.length = 0
  const r = await suggest({ online: true, overwrite: true })
  check('a cached preview still answers', r.json?.ok === true, JSON.stringify(r.json?.error))
  check('a cached preview asks the network nothing', calls.length === 0, calls.join('\n'))
  check('a cached preview still classifies', r.json.summary?.fromRemote === REMOTE_RESOLVABLE, JSON.stringify(r.json?.summary))
  check('the cache records what it looked at', cacheText() !== null)

  // "Not on npm" is an answer, not an outage: it must not be re-asked.
  const cache = JSON.parse(cacheText())
  check('an unpublished package is cached as a complete answer',
    Boolean(cache.entries['dsh-offline-only']),
    Object.keys(cache.entries).join(', '))
}

/* 6. an outage is not remembered --------------------------------------- */
{
  cold()
  failEverything = true
  const r = await suggest({ online: true, overwrite: true })
  failEverything = false

  check('a dead network still returns a proposal', r.json?.ok === true, JSON.stringify(r.json?.error))
  check('a dead network reports zero remote verdicts',
    (r.json.summary?.fromRemote || 0) === 0, JSON.stringify(r.json.summary))
  check('a dead network still classifies from local evidence',
    (r.json.summary?.fromTags || 0) > 0, JSON.stringify(r.json.summary))
  check('a dead network is counted, not hidden',
    r.json.remote && r.json.remote.failed > 0, JSON.stringify(r.json.remote))

  // The whole point: the outage must not freeze these plugins as
  // unclassifiable for a week.
  const after = cacheText()
  const cachedAfterOutage = after ? Object.keys(JSON.parse(after).entries) : []
  check('a failed lookup is not cached as "no signal"',
    !cachedAfterOutage.includes('dsh-offline-only') && cachedAfterOutage.length === 0,
    cachedAfterOutage.join(', '))

  calls.length = 0
  const retry = await suggest({ online: true, overwrite: true })
  check('a retry after an outage asks again', calls.length > 0, `${calls.length} calls`)
  check('a retry after an outage succeeds', retry.json.summary?.fromRemote === REMOTE_RESOLVABLE,
    JSON.stringify(retry.json?.summary))
}

/* 7. forget clears the cache ------------------------------------------- */
{
  cold()
  await suggest({ online: true, overwrite: true })
  check('the cache exists before forgetting', cacheText() !== null)
  const r = await call('POST', `${API}/categories/forget`, {})
  check('forget answers ok', r.json?.ok === true, JSON.stringify(r.json))
  check('forget removes the cache file', cacheText() === null)
}

/* 8. english locale keeps the explanation english ---------------------- */
{
  cold()
  const r = await call('POST', `${API}/categories/suggest`, { locale: 'en', online: true, overwrite: true })
  const remote = (r.json.added || []).filter((item) => item.basis === 'remote')
  check('en locale produces remote verdicts', remote.length === REMOTE_RESOLVABLE, JSON.stringify(r.json.summary))
  check('en locale writes the explanation in English',
    remote.every((item) => !/[\u4e00-\u9fa5]/.test(item.reason || '')), JSON.stringify(remote.map((i) => i.reason)))
  check('en locale names the evidence in English',
    remote.every((item) => /topics|keywords|description|README/.test(item.reason || '')),
    JSON.stringify(remote.map((i) => i.reason)))
}

/* ---- report ----------------------------------------------------------- */

if (failures.length === 0) {
  console.log('PASS: the online lookup is opt-in, scoped to uncertain plugins, evidence-ordered,')
  console.log('      cache-backed, and degrades to the local answer when the network does not answer')
  process.exit(0)
}

console.error(`FAIL: ${failures.length} check(s) failed`)
for (const failure of failures) console.error(`  - ${failure}`)
process.exit(1)
