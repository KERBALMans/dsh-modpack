/**
 * Drives the real `/api/dsh-modpack/categories/suggest` handler against a
 * throwaway DSH home that has *real* `package.json` files with real keywords
 * in `node_modules`, then checks what the classifier proposes.
 *
 * The interesting question is not "does it return something" but "is the
 * proposal honest": does it use the author's own tags when they exist, does it
 * say so when it fell back to guessing from the name, does it refuse to
 * overwrite manual work, and does the preview leave the stored tree untouched
 * until the user applies it. Those four are the whole contract, so every one
 * of them is asserted below.
 *
 * Run:  node scripts/check-autocat.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = '/api/dsh-modpack'

/* ---- a throwaway DSH home with real package metadata ----------------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-autocat-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'check'
// `profileDir()` prefers DSH_PROFILE_DIR over DSH_HOME, and a shell that is
// itself running inside a Harness session has it set to the real profile.
// Clearing it is what makes this a throwaway home rather than the live one.
delete process.env.DSH_PROFILE_DIR

const profile = join(home, 'profiles', 'check')
const modules = join(profile, 'node_modules')
mkdirSync(modules, { recursive: true })

/**
 * Each package below is shaped like a real DSH plugin: `keywords` is the
 * field the ecosystem actually uses, and these are the tags real packages
 * carry (verified against installed plugins on the dev machine).
 */
const PACKAGES = {
  'dsh-windows-mcp': {
    keywords: ['dsh', 'dsh-plugin', 'deepseek-harness', 'mcp', 'windows', 'automation'],
    description: 'Windows desktop automation through the MCP bridge',
  },
  'billion-context': {
    keywords: ['context', 'compression', 'acp', 'agent'],
    description: 'Context compression',
  },
  'dsh-session-manager': {
    keywords: ['dsh', 'dsh-plugin', 'session', 'workspace', 'archive'],
    description: 'Session and workspace manager',
  },
  'dsh-connect-workbuddy': {
    keywords: ['dsh-plugin', 'model-provider', 'credits'],
    description: 'Model provider bridge',
  },
  'dsh-grill-me': {
    keywords: ['dsh', 'dsh-plugin', 'skill', 'grill'],
    description: 'Socratic questioning skill',
  },
  'dsh-modpack': {
    keywords: ['dsh', 'dsh-plugin', 'modpack', 'plugin-manager'],
    description: 'Modpack builder',
  },
  // No keywords at all — the classifier must fall back to the name and admit it.
  //
  // It ships a README whose *body* mentions a plugin manager and keeping shell
  // processes alive, and whose lede says nothing. All three sentences are real:
  // `dsh-windows-mcp` really does say "DSH's own plugin manager" while telling
  // you how to install it, and `dsh-aliyun-coupon` really does note that its
  // Host half needs a toggle in the plugin manager. They describe installing and
  // developing a plugin, not what it does, so reading a whole README filed those
  // two under plugin management and filed `@deepseek-ai/dsh-subagent-codex`
  // under terminals (its body says "the complete terminal result" — *final*).
  'some-unlabelled-thing': {
    description: 'A package with no keywords',
    readme: [
      '# some-unlabelled-thing',
      '',
      'A small helper.',
      '',
      '## Install',
      '',
      "Install it with DSH's own plugin manager.",
      '',
      '## Usage',
      '',
      'Keeps shell processes alive across tool calls.',
    ].join('\n'),
  },
  // Has keywords, but none of them say "desktop/automation"; only the *name*
  // does. This is the case that separates "the author said so" from "we
  // guessed": it must be reported as a guess even though the package does
  // carry keywords, which is exactly the distinction the first classifier
  // version got wrong.
  'dsh-windows-legacy': {
    keywords: ['dsh', 'dsh-plugin'],
    description: 'Tagged only as a plugin',
  },
}

for (const [name, meta] of Object.entries(PACKAGES)) {
  const dir = join(modules, name)
  mkdirSync(dir, { recursive: true })
  const { readme, ...manifest } = meta
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }, null, 2), 'utf8')
  if (readme) writeFileSync(join(dir, 'README.md'), readme, 'utf8')
}

const BUNDLES = Object.keys(PACKAGES)
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'check-profile',
  version: '0.0.0',
  private: true,
  dependencies: Object.fromEntries(BUNDLES.map((n) => [n, '^1.0.0'])),
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

// A live profile lists ~200 Loader entries beside the bundles, and the Loader
// names them after the module it loaded — `@scope/pkg` for a package entry and
// `@scope/pkg/sub` for a subpath entry. Those rows carry the author's own
// title/description (the `dsh.meta` block the package registers), which is
// exactly the evidence the description tier is meant to read. Before this was
// wired up, every plugin row had no `name` at all and the whole profile — 215
// rows on the dev machine — landed in 其他.
const PLUGIN_ENTRIES = [
  {
    entryId: 'include:user-questions',
    moduleName: '@deepseek-ai/dsh-user-questions',
    meta: { title: '用户提问服务', description: '让运行中的 AI 向用户提问并等待回答。' },
  },
  {
    // A subpath entry: the package behind it is the part before the second
    // slash, and the classifier must not treat the subpath as a package name.
    entryId: 'include:plugin-manager-tools',
    moduleName: '@deepseek-ai/dsh-plugin-manager/tools',
    meta: { title: '插件管理工具', description: '列出、安装和启用插件。' },
  },
  {
    // The Loader's own pseudo-module: no package, no description, no signal.
    entryId: 'include',
    moduleName: 'cordis:include',
    meta: null,
  },
]

const fakePluginManager = {
  listBundles: async () => BUNDLES.map((name) => ({
    name,
    installTarget: { spec: name, version: '1.0.0' },
    enabled: true,
    installed: true,
    official: false,
    optional: false,
    removable: true,
    availability: 'installed',
    source: null,
    rows: [],
    readOnlyReason: null,
    error: null,
    overrides: [],
  })),
  listPlugins: async () => PLUGIN_ENTRIES.map((entry) => ({
    entryId: entry.entryId,
    moduleName: entry.moduleName,
    enabled: true,
    fiberPhase: 'active',
    meta: entry.meta,
    readOnlyReason: null,
    patchId: null,
  })),
}

const ctx = {
  get: (name) => {
    if (name === 'webServer') return fakeWebServer
    if (name === 'pluginManager') return fakePluginManager
    return undefined
  },
  inject(names, cb) { if (Array.isArray(names) && names.includes('webServer')) cb(childCtx) },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
}

// Bundles plus every Loader entry: one row per thing the user can tick.
const TOTAL_ROWS = BUNDLES.length + PLUGIN_ENTRIES.length

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

/* ---- assertions ------------------------------------------------------ */

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const categoriesFile = join(home, 'storages', 'dsh-modpack', 'categories.json')

function readStored() {
  try {
    return JSON.parse(readFileSync(categoriesFile, 'utf8'))
  } catch {
    return null
  }
}

/* 1. the proposal is a preview and writes nothing ---------------------- */
{
  const before = readStored()
  const r = await call('POST', `${API}/categories/suggest`, { locale: 'zh' })
  check('suggest answers ok', r.json?.ok === true, JSON.stringify(r.json?.error))
  check('preview wrote no categories file', readStored() === before, 'the preview must not touch disk')

  const doc = r.json?.doc
  check('proposal carries a tree', Array.isArray(doc?.nodes) && doc.nodes.length > 0)
  check('proposal assigns every row', Object.keys(doc?.assignments || {}).length === TOTAL_ROWS,
    `assigned ${Object.keys(doc?.assignments || {}).length} of ${TOTAL_ROWS}`)
}

/* 2. tag-based classification puts packages where their tags say ------- */
{
  const r = await call('POST', `${API}/categories/suggest`, { locale: 'zh' })
  const byKey = new Map((r.json.added || []).map((item) => [item.key, item]))

  const expect = {
    'bundle:dsh-windows-mcp': 'MCP 与外部工具',
    'bundle:billion-context': '上下文与记忆',
    'bundle:dsh-session-manager': '会话与工作区',
    'bundle:dsh-connect-workbuddy': '模型接入',
    'bundle:dsh-grill-me': '技能与提示词',
    'bundle:dsh-modpack': '插件管理',
  }
  for (const [key, want] of Object.entries(expect)) {
    const got = byKey.get(key)
    check(`${key} lands in ${want}`, got?.categoryName === want, `got ${got?.categoryName}`)
    check(`${key} is classified from its tags`, got?.basis === 'tags', `basis was ${got?.basis}`)
    check(`${key} carries a reason`, typeof got?.reason === 'string' && got.reason.length > 0)
  }

  // Name matched, keywords present but silent: must be a guess, not a claim.
  const legacy = byKey.get('bundle:dsh-windows-legacy')
  check('a name-only match on a tagged package lands in the name category',
    legacy?.categoryName === '桌面与自动化', `got ${legacy?.categoryName}`)
  check('a name-only match is reported as a guess even when the package has keywords',
    legacy?.basis === 'name', `basis was ${legacy?.basis}`)
}

/* 3. a package with no keywords is admitted as unclassified ------------- */
{
  const r = await call('POST', `${API}/categories/suggest`, { locale: 'zh' })
  const item = (r.json.added || []).find((row) => row.key === 'bundle:some-unlabelled-thing')
  check('an untagged package still gets filed', Boolean(item), 'it was dropped instead of filed')
  // 'none', not 'name': the package has no keywords and its name means nothing,
  // so the honest answer is "no signal" rather than a fabricated guess.
  check('an untagged package is marked as unclassified', item?.basis === 'none', `basis was ${item?.basis}`)
  check('an untagged package lands in 其他', item?.categoryName === '其他', `got ${item?.categoryName}`)
  // Its README does mention a plugin manager and shell processes, but only
  // below the lede, so neither may be used as evidence. Reading the whole file
  // would have filed this under 插件管理 with basis 'readme'.
  check('a signal found only below the README lede does not count as evidence',
    item?.basis === 'none' && item?.categoryName === '其他',
    `basis=${item?.basis} category=${item?.categoryName}`)
  check('the summary separates tags, guesses and unclassified',
    r.json.summary.fromTags === 6 && r.json.summary.fromName === 1 && r.json.summary.unclassified === 2,
    `fromTags=${r.json.summary.fromTags} fromName=${r.json.summary.fromName} unclassified=${r.json.summary.unclassified}`)
}

/* 3c. Loader entries are classified too, not dumped into 其他 ------------ */
{
  // The classifier reads `row.name` to find a package on disk, so the inventory
  // has to put the *package* there — not the module path the Loader happened to
  // load and not nothing at all. Both mistakes still let the description tier
  // work (it reads the registered title/description), which is why this is
  // asserted on the inventory rather than on the proposal: a wrong or missing
  // name silently disables the README tier and the manifest lookup.
  const inv = await call('GET', `${API}/inventory`)
  const rows = new Map((inv.json?.plugins || []).map((row) => [row.entryId, row]))
  check('inventory lists the Loader entries', rows.size === PLUGIN_ENTRIES.length,
    `listed ${rows.size} of ${PLUGIN_ENTRIES.length}`)
  check('a Loader entry carries the package behind it',
    rows.get('include:user-questions')?.name === '@deepseek-ai/dsh-user-questions',
    `name was ${JSON.stringify(rows.get('include:user-questions')?.name)}`)
  check('a subpath entry is named after its package, not its subpath',
    rows.get('include:plugin-manager-tools')?.name === '@deepseek-ai/dsh-plugin-manager',
    `name was ${JSON.stringify(rows.get('include:plugin-manager-tools')?.name)}`)
  check('a pseudo-module has no package name',
    rows.get('include')?.name === null,
    `name was ${JSON.stringify(rows.get('include')?.name)}`)
}

/* 3d. Loader entries are classified, not just listed -------------------- */
{
  // A real desktop profile is ~215 Loader entries and only ~28 bundles, so a
  // classifier that only understood bundles filed 88% of the profile under
  // 其他. These three entries cover the three shapes the Loader emits: a plain
  // package, a subpath of a package, and its own pseudo-module.
  const r = await call('POST', `${API}/categories/suggest`, { locale: 'zh' })
  const byKey = new Map((r.json.added || []).map((item) => [item.key, item]))

  const questions = byKey.get('plugin:include:user-questions')
  check('a Loader entry is filed by the description it registers',
    questions?.basis === 'desc', `basis was ${questions?.basis}`)
  check('a Loader entry does not land in 其他',
    questions?.categoryName && questions.categoryName !== '其他', `got ${questions?.categoryName}`)

  const tools = byKey.get('plugin:include:plugin-manager-tools')
  check('a subpath entry is classified by the package behind it',
    tools?.basis === 'desc' && tools?.categoryName !== '其他',
    `basis=${tools?.basis} category=${tools?.categoryName}`)

  // The Loader's own pseudo-module has no package.json anywhere, so the honest
  // answer is "no signal". Inventing a category for it would be worse than
  // leaving it where the user can move it.
  const pseudo = byKey.get('plugin:include')
  check('the Loader pseudo-module is admitted as unclassified',
    pseudo?.basis === 'none' && pseudo?.categoryName === '其他',
    `basis=${pseudo?.basis} category=${pseudo?.categoryName}`)

  // `cordis:include` must never be read as a package named `cordis`.
  check('a pseudo-module is not given a package name',
    !pseudo || pseudo.name === null || pseudo.name === 'cordis:include',
    `name was ${JSON.stringify(pseudo?.name)}`)
}

/* 3b. basis and reason must never contradict each other ---------------- */
{
  // The preview prints `reason` right next to `basis`, so a mismatch tells the
  // user two different things about one plugin. This is the invariant that the
  // first version of the classifier actually broke on live data (it labelled
  // local installs "from keywords" while the sentence said "installed from a
  // local path"), so it is asserted rather than trusted.
  const CLAIMS = {
    zh: {
      tags: /关键词/,
      desc: /简介/,
      readme: /README/i,
      name: /名字/,
      fact: /本机路径/,
      none: /没有可识别/,
    },
    en: {
      tags: /tagged/,
      desc: /description/,
      readme: /README/i,
      name: /name/,
      fact: /local path/,
      none: /no recognised/,
    },
  }
  for (const locale of ['zh', 'en']) {
    const r = await call('POST', `${API}/categories/suggest`, { locale })
    for (const item of r.json.added || []) {
      const claim = CLAIMS[locale][item.basis]
      check(`[${locale}] ${item.key}: reason matches basis "${item.basis}"`,
        Boolean(claim) && claim.test(item.reason || ''),
        `reason was "${item.reason}"`)
    }
  }
}

/* 4. English locale yields English category names ---------------------- */
{
  const r = await call('POST', `${API}/categories/suggest`, { locale: 'en' })
  const names = (r.json.doc?.nodes || []).map((n) => n.name)
  check('en locale produces English category names', names.includes('MCP & external tools'), names.join(', '))
  check('en locale produces no Chinese category names', !names.some((n) => /[\u4e00-\u9fa5]/.test(n)), names.join(', '))
}

/* 5. manual work survives unless overwrite is asked for ----------------- */
{
  // File one plugin by hand, the way a user would.
  const seed = {
    nodes: [{ id: 'mine', name: '我自己的分类', parentId: null, order: 0 }],
    assignments: { 'bundle:dsh-windows-mcp': 'mine' },
  }
  const saved = await call('POST', `${API}/categories/save`, { doc: seed })
  check('seeded the manual tree', saved.json?.ok === true, JSON.stringify(saved.json))

  const keep = await call('POST', `${API}/categories/suggest`, { locale: 'zh' })
  check('a manual assignment is kept by default',
    keep.json.doc.assignments['bundle:dsh-windows-mcp'] === 'mine',
    `it moved to ${keep.json.doc.assignments['bundle:dsh-windows-mcp']}`)
  check('the kept assignment is reported as kept', keep.json.summary.kept === 1,
    `kept=${keep.json.summary.kept}`)
  check('the manual category still exists',
    (keep.json.doc.nodes || []).some((n) => n.id === 'mine' && n.name === '我自己的分类'))

  const forced = await call('POST', `${API}/categories/suggest`, { locale: 'zh', overwrite: true })
  check('overwrite moves the manual assignment',
    forced.json.doc.assignments['bundle:dsh-windows-mcp'] !== 'mine',
    `still ${forced.json.doc.assignments['bundle:dsh-windows-mcp']}`)
  check('overwrite reports nothing kept', forced.json.summary.kept === 0, `kept=${forced.json.summary.kept}`)
}

/* 6. applying is just the ordinary save, and it validates ------------- */
{
  const suggest = await call('POST', `${API}/categories/suggest`, { locale: 'zh', overwrite: true })
  const applied = await call('POST', `${API}/categories/save`, { doc: suggest.json.doc })
  check('the proposal saves through the normal route', applied.json?.ok === true, JSON.stringify(applied.json))

  const stored = readStored()
  check('the tree is on disk after applying', Array.isArray(stored?.nodes) && stored.nodes.length > 0)
  check('assignments are on disk after applying', Object.keys(stored?.assignments || {}).length === TOTAL_ROWS,
    `${Object.keys(stored?.assignments || {}).length} of ${TOTAL_ROWS}`)
}

/* 7. re-running is stable rather than churny --------------------------- */
{
  const first = await call('POST', `${API}/categories/suggest`, { locale: 'zh', overwrite: true })
  const second = await call('POST', `${API}/categories/suggest`, { locale: 'zh', overwrite: true })
  const idsOf = (r) => (r.json.doc.nodes || []).map((n) => n.id).sort().join(',')
  check('re-running proposes the same category ids', idsOf(first) === idsOf(second),
    `${idsOf(first)} vs ${idsOf(second)}`)
  check('re-running does not duplicate categories',
    (second.json.doc.nodes || []).length === (first.json.doc.nodes || []).length,
    `${(first.json.doc.nodes || []).length} -> ${(second.json.doc.nodes || []).length}`)
}

/* 8. a hostile stored tree does not break the proposal ----------------- */
{
  // Hand-edit the file into a cycle plus a dangling parent, exactly the kind
  // of thing that happens when two machines' copies get merged.
  writeFileSync(categoriesFile, JSON.stringify({
    nodes: [
      { id: 'a', name: 'A', parentId: 'b', order: 0 },
      { id: 'b', name: 'B', parentId: 'a', order: 1 },
      { id: 'c', name: 'C', parentId: 'ghost', order: 2 },
    ],
    assignments: { 'bundle:dsh-grill-me': 'deleted-category' },
  }), 'utf8')

  const r = await call('POST', `${API}/categories/suggest`, { locale: 'zh' })
  check('a cyclic stored tree still yields a proposal', r.json?.ok === true, JSON.stringify(r.json?.error))

  const doc = r.json.doc
  const byId = new Map((doc.nodes || []).map((n) => [n.id, n]))
  let terminates = true
  for (const node of doc.nodes || []) {
    let hop = node.parentId
    let guard = 0
    while (hop) {
      if (guard++ > (doc.nodes || []).length) { terminates = false; break }
      const parent = byId.get(hop)
      if (!parent) { terminates = false; break }
      hop = parent.parentId
    }
    if (!terminates) break
  }
  check('the proposed tree still walks to a root', terminates)
  check('a dangling assignment was dropped', !Object.values(doc.assignments || {}).includes('deleted-category'))
}

/* ---- report ---------------------------------------------------------- */

if (failures.length === 0) {
  console.log('PASS: auto-categorisation classifies from real tags, admits its guesses,')
  console.log('      previews without writing, keeps manual work, and survives a hostile tree')
  process.exit(0)
}

console.error(`FAIL: ${failures.length} check(s) failed`)
for (const failure of failures) console.error(`  - ${failure}`)
process.exit(1)
