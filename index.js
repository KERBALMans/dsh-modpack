/**
 * dsh-modpack — Host half.
 *
 * The "modpack builder" backend. It never touches `package.json`,
 * `cordis.patch.yml` or `node_modules` by hand: every mutation goes through the
 * Harness `pluginManager` service, which owns the profile files, runs pnpm, and
 * applies the declared reload lifecycle. That keeps this plugin honest — it can
 * only do what Settings → Plugins can do, just in bulk and from a file.
 *
 * Surface:
 *   GET  /api/dsh-modpack/inventory  current plugins + bundles (the picker)
 *   GET  /api/dsh-modpack/saved      modpacks stored on this machine
 *   POST /api/dsh-modpack/pack       build a modpack document from a selection
 *   POST /api/dsh-modpack/save       write a modpack into the storage directory
 *   POST /api/dsh-modpack/load       read one back
 *   POST /api/dsh-modpack/delete     remove a stored modpack
 *   POST /api/dsh-modpack/plan       dry-run: what would applying this pack do
 *   POST /api/dsh-modpack/apply      install / enable / disable for real
 *   GET  /api/dsh-modpack/categories        the user's category tree
 *   POST /api/dsh-modpack/categories/save   replace it
 *   POST /api/dsh-modpack/categories/suggest  propose a tree from plugin tags
 *                                             (`online: true` also asks npm
 *                                             and GitHub about unlabelled ones;
 *                                             `ai: true` asks the configured
 *                                             model, `source: true` adds the
 *                                             package's entry code to the
 *                                             evidence it is given, and
 *                                             `reason: true` adds how the plugin
 *                                             attaches to the host and asks the
 *                                             model to reason about that before
 *                                             choosing)
 *   POST /api/dsh-modpack/categories/forget   drop the online-lookup cache
 *   GET  /api/dsh-modpack/diag       environment probe
 *
 * Design notes for portability:
 *  - Nothing machine-specific is baked in: storage lives under `DSH_HOME`.
 *  - Every `ctx.get()` is guarded, so the plugin still loads (degraded) on a
 *    Harness build that dropped a service.
 *  - Entries installed from a local path (`link:` / `file:` / absolute path)
 *    are recorded but marked non-portable, because that path does not exist on
 *    somebody else's computer. The UI offers a per-entry override.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const API_PREFIX = '/api/dsh-modpack'
const FORMAT = 'dsh-modpack'
const FORMAT_VERSION = 1
const PLUGIN_VERSION = '0.9.1'
// Bumped only when the shape of a route's request/response changes in a way the
// other half must know about. The client compares this against its own copy:
// a browser that cached yesterday's `client.js` while the host half was
// upgraded would otherwise call routes with the old body shape and see
// failures that look like bugs in the plugin. Same number means "these two
// halves speak the same language", which is the only thing they need to agree
// on — the plugin version itself may differ freely.
const API_VERSION = 2
const BODY_LIMIT = 16 * 1024 * 1024
const SUFFIX = '.dshmodpack.json'

/* ------------------------------------------------------------------ */
/* environment                                                         */
/* ------------------------------------------------------------------ */

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Where the running profile lives.
 *
 * The environment fallback is a guess, and on the desktop client it guesses
 * wrong: the host is launched with the profile directory as an *argument*, so
 * `DSH_PROFILE` / `DSH_PROFILE_DIR` are unset in the host process (they are
 * exported into shell calls, not into the plugin sandbox). The fallback then
 * resolves to `<home>/profiles/default`, a directory that does not exist —
 * every profile-installed package became invisible to the classifier while the
 * asar-resident official ones still resolved, which is exactly the kind of
 * half-broken that looks like a classification problem.
 *
 * `ctx.profileContext.dir` is the authoritative answer, so `apply` records it
 * here on the way in. The environment stays as the fallback because the test
 * harness mounts the plugin without a profile context and drives it that way.
 */
let profileDirOverride = null

function profileDir() {
  if (profileDirOverride) return profileDirOverride
  return process.env.DSH_PROFILE_DIR || join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'default')
}

function storageDir() {
  return join(dshHome(), 'storages', 'dsh-modpack')
}

function runtimeVersion() {
  const env = process.env.DSH_VERSION || process.env.DSH_CLIENT_VERSION
  if (env) return String(env)
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(profileDir(), 'package.json'), 'utf8'))
  } catch {
    return null
  }
  if (pkg.dsh && typeof pkg.dsh.version === 'string') return pkg.dsh.version
  // A profile rarely pins a dsh version of its own, but it depends on official
  // packages from the same release train, so an exact pin identifies the build.
  const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
  for (const [name, spec] of Object.entries(deps)) {
    if (/^@deepseek-ai\/dsh-/.test(name) && /^\d+\.\d+\.\d+/.test(String(spec))) return String(spec)
  }
  return null
}

/** A spec that only resolves on the machine that wrote it. */
function isLocalSpec(spec) {
  const value = String(spec || '')
  if (value.startsWith('link:') || value.startsWith('file:')) return true
  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('.\\') || value.startsWith('..\\')) return true
  if (value.startsWith('/') || value.startsWith('\\')) return true
  return /^[A-Za-z]:[\\/]/.test(value)
}

/**
 * The package a Loader entry belongs to: `@scope/pkg/sub` -> `@scope/pkg`.
 *
 * The Loader names an entry after the module it loaded, and one package can
 * contribute several entries (`@deepseek-ai/dsh-plugin-manager` and its
 * `/tools` subpath). The classifiers read `row.name` as "which package is
 * this", so the subpath has to come off — otherwise `dsh-plugin-manager/tools`
 * is a different name from `dsh-plugin-manager` and neither is a real one.
 *
 * Returns null for entries that are not packages at all: `cordis:include` is
 * the Loader's own pseudo-module and has no `package.json` anywhere.
 */
function packageNameOf(moduleName) {
  const value = String(moduleName || '').trim()
  if (!value || value.includes(':')) return null
  const parts = value.split('/').filter(Boolean)
  if (parts.length === 0) return null
  return value.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/* ------------------------------------------------------------------ */
/* HTTP helpers (mirrors the stock Harness route idiom)                */
/* ------------------------------------------------------------------ */

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求内容过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Admit only requests that came from the Harness page itself.
 * `connection.admit` is the sanctioned gate; when the service is absent (older
 * or newer build) the route stays usable but the mode is reported as `legacy`.
 */
function authorize(ctx, req) {
  const connection = serviceOf(ctx, 'connection')
  if (!connection || typeof connection.admit !== 'function') return { ok: true, mode: 'legacy' }
  let admission
  try {
    admission = connection.admit(req)
  } catch {
    return { ok: false, status: 401, mode: 'error' }
  }
  if (admission && typeof admission === 'object') {
    if ('peer' in admission && admission.peer) return { ok: true, mode: 'peer' }
    if ('rejection' in admission) {
      return { ok: false, status: admission.rejection === 403 ? 403 : 401, mode: 'rejected' }
    }
  }
  return { ok: false, status: 401, mode: 'rejected' }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/* ------------------------------------------------------------------ */
/* pluginManager access                                                */
/* ------------------------------------------------------------------ */

function manager(ctx) {
  // `serviceOf` accepts either the cordis accessor (`ctx.get`) or a plain
  // property. Builds have shipped both spellings; reading only one of them
  // makes the plugin look broken on the other for no reason at all.
  const pm = serviceOf(ctx, 'pluginManager')
  if (!pm || typeof pm.listBundles !== 'function') return null
  return pm
}

/* ------------------------------------------------------------------ */
/* capability probing                                                  */
/* ------------------------------------------------------------------ */

/**
 * What this Harness build can actually do.
 *
 * The plugin is meant to keep working across Harness releases, so it asks the
 * runtime what it *has* rather than what version it claims to be. Version
 * numbers would be the wrong test twice over: an rc build may already carry a
 * method its number does not promise, and a future build may rename one
 * without changing the number this plugin would compare against. Probing the
 * method itself degrades feature by feature instead of all at once.
 */
function capabilities(ctx) {
  const pm = manager(ctx)
  const has = (object, name) => Boolean(object && typeof object[name] === 'function')
  return {
    pluginManager: Boolean(pm),
    // Reading inventory. `listBundles` is the only hard requirement; a build
    // that drops it still yields a usable file-based inventory.
    listBundles: has(pm, 'listBundles'),
    listPlugins: has(pm, 'listPlugins'),
    installBundle: has(pm, 'installBundle'),
    removeBundle: has(pm, 'removeBundle'),
    setBundleEnabled: has(pm, 'setBundleEnabled'),
    setPluginEnabled: has(pm, 'setPluginEnabled'),
    // Optional refinements. Absent means the older, coarser behaviour, never a
    // failure — `requestId` and `pinVersions` are conveniences, not contracts.
    installRequestId: has(pm, 'waitForInstall') || has(pm, 'cancelInstall'),
    registries: has(pm, 'registries'),
    inspect: has(pm, 'inspect'),
    versionExemptions: has(pm, 'listVersionExemptions') && has(pm, 'setVersionExemption'),
    webServer: Boolean(serviceOf(ctx, 'webServer')),
    tools: Boolean(serviceOf(ctx, 'tools')),
  }
}

function describeMeta(meta) {
  if (!meta || typeof meta !== 'object') return null
  const pick = (value) => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') return value.zh || value.en || Object.values(value)[0] || null
    return null
  }
  return { title: pick(meta.title), description: pick(meta.description), icon: meta.icon || null }
}

/** Optional title/description carrier on bundle + plugin rows. */
function textOf(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.zh || value.en || Object.values(value)[0] || null
  return null
}

/**
 * The picker payload: one row per *thing the user can check*, meaning the
 * bundle layer (what `dsh plugin` installs) and, separately, every live Loader
 * entry so a user can also carry plain enable/disable decisions.
 */
/** Clean version out of a dependency spec: `^0.1.208` and `foo@^0.1.208` -> `0.1.208`. */
function specVersion(spec) {
  const s = String(spec || '').trim()
  const at = s.indexOf('@', 1)
  const range = (at > 0 ? s.slice(at + 1) : s).trim()
  const match = /^[\^~>=<]*\s*(\d+\.\d+\.\d+[^\s]*)$/.exec(range)
  return match ? match[1] : null
}

/** A recorded version we can pin an install to. */
function isExactVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+/.test(value.trim())
}

/**
 * `pluginManager.installBundle` takes a resolvable npm spec. A profile's
 * dependency map stores a bare range (`^0.1.208`, `0.7.5`), which is not
 * resolvable on its own, so qualify it with the package name. Anything that is
 * already resolvable — `link:`, `file:`, a git/URL spec, or a `name@range`
 * spec — is passed through untouched.
 */
function resolvableSpec(name, spec) {
  const s = typeof spec === 'string' ? spec.trim() : ''
  if (!s || s === name) return name || s
  if (isLocalSpec(s)) return s
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (/^(git|github|gitlab|bitbucket|workspace|npm|patch|portal):/i.test(s)) return s
  if (s.indexOf('@', 1) > 0) return s
  if (/^[\^~><=v]*\s*\d/.test(s) || s === '*' || s === 'latest') return name ? `${name}@${s}` : s
  return s
}

/**
 * Best-effort version of an installed package, read from the profile's own
 * node_modules. Only used by the file fallback below.
 */
function installedVersion(dir, name) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8'))
    return pkg.version || null
  } catch {
    return null
  }
}

/**
 * Row ids the profile patch file switches off. Deliberately a shallow scan:
 * the fallback only reports state, and resolving the real merged config is the
 * pluginManager's job.
 */
function disabledRowIds(dir) {
  const off = new Set()
  let text
  try {
    text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
  } catch {
    return off
  }
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const id = /^\s*(?:-\s*)?id:\s*['"]?([^\s'"]+)['"]?\s*$/.exec(raw)
    if (id) {
      current = id[1]
      continue
    }
    if (!current) continue
    if (/^\s*disabled:\s*true\s*$/.test(raw) || /^\s*enabled:\s*false\s*$/.test(raw)) off.add(current)
  }
  return off
}

/**
 * Read-only inventory built from the profile's own files, used when the
 * Harness build exposes no pluginManager service. Exporting a pack still works;
 * the UI reports the page as degraded so it never offers installation.
 */
function fileInventory() {
  const dir = profileDir()
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch (err) {
    return {
      ok: false,
      degraded: true,
      reason: `无法读取 profile 的 package.json：${(err && err.message) || String(err)}`,
      pluginVersion: PLUGIN_VERSION,
      profileDir: dir,
      bundles: [],
      plugins: [],
    }
  }

  const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
  const declared = pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  const enabledNames = new Set(declared.map(String))
  const off = disabledRowIds(dir)
  const names = [...new Set([...Object.keys(deps), ...enabledNames])].sort()

  const bundles = names.map((name) => {
    const spec = typeof deps[name] === 'string' ? deps[name] : null
    return {
      key: `bundle:${name}`,
      kind: 'bundle',
      name,
      spec: resolvableSpec(name, spec),
      version: installedVersion(dir, name) || specVersion(spec) || (name.startsWith('@deepseek-ai/') ? runtimeVersion() : null),
      enabled: enabledNames.has(name) && !off.has(name),
      installed: Boolean(spec),
      official: name.startsWith('@deepseek-ai/'),
      optional: false,
      removable: true,
      availability: enabledNames.has(name) ? 'profile' : 'installation',
      source: spec,
      local: isLocalSpec(spec),
      description: null,
      title: null,
      icon: null,
      rowCount: 0,
      readOnlyReason: null,
      error: null,
      overrides: [],
    }
  })

  return {
    ok: true,
    degraded: true,
    reason: '未找到 pluginManager 服务：已直接从 profile 配置文件读取插件清单，可以打包导出，但不能在界面里安装。',
    pluginVersion: PLUGIN_VERSION,
    dshVersion: runtimeVersion(),
    profileDir: dir,
    storageDir: storageDir(),
    bundles,
    plugins: [],
    warnings: [],
  }
}

async function inventory(ctx) {
  const pm = manager(ctx)
  if (!pm) return fileInventory()

  let bundles = []
  let plugins = []
  const warnings = []
  let listFailed = false
  try {
    bundles = await pm.listBundles()
  } catch (err) {
    // A build that exposes `listBundles` but throws from it is the shape a
    // future release most plausibly takes: the method still exists, its
    // contract moved. Returning the empty list we just got would show the user
    // a Harness with no plugins installed — worse than the degraded page,
    // because it looks like data loss. Fall back to reading the profile's own
    // files, which needs nothing from the pluginManager.
    listFailed = true
    warnings.push(`listBundles 失败：${(err && err.message) || String(err)}`)
  }
  if (typeof pm.listPlugins === 'function') {
    try {
      plugins = await pm.listPlugins()
    } catch (err) {
      warnings.push(`listPlugins 失败：${(err && err.message) || String(err)}`)
    }
  } else {
    // An older or slimmer build: bundles still list, but there are no Loader
    // entry ids to carry. Say so instead of silently showing a shorter list.
    warnings.push('当前 Harness 版本的 pluginManager 没有 listPlugins：只能打包/安装 bundle，无法携带单个插件的启用状态。')
  }

  // A `listBundles` that answered with something other than an array is the
  // same failure one step later: `.map` would throw here and take the whole
  // page down with a stack trace instead of a warning.
  if (!Array.isArray(bundles)) {
    listFailed = true
    warnings.push('listBundles 返回的不是数组，已改用 profile 文件推断清单。')
    bundles = []
  }
  if (!Array.isArray(plugins)) plugins = []

  if (listFailed) {
    // The file-based inventory is the same one a pluginManager-less build gets.
    // It cannot install, but it can still list, which is what a user looking at
    // a broken upgrade needs first.
    const fallback = fileInventory()
    if (fallback.ok) {
      fallback.warnings = [...warnings, ...(fallback.warnings || [])]
      fallback.degraded = true
      fallback.degradedReason = 'pluginManager 读取失败，已改用 profile 文件推断（只读）'
      return fallback
    }
  }

  const rows = bundles.map((b) => {
    const target = b.installTarget || {}
    const spec = target.spec || b.name
    return {
      key: `bundle:${b.name}`,
      kind: 'bundle',
      name: b.name,
      spec,
      version: target.version || b.version || null,
      enabled: b.enabled !== false,
      installed: Boolean(b.installed),
      official: Boolean(b.official),
      optional: Boolean(b.optional),
      removable: Boolean(b.removable),
      availability: b.availability || null,
      source: b.source || null,
      local: isLocalSpec(spec),
      description: textOf(b.description) || describeMeta(b.meta)?.description || null,
      title: describeMeta(b.meta)?.title || null,
      icon: describeMeta(b.meta)?.icon || null,
      rowCount: Array.isArray(b.rows) ? b.rows.length : 0,
      readOnlyReason: b.readOnlyReason || null,
      error: b.error ? (b.error.diagnostic || b.error.code) : null,
      overrides: Array.isArray(b.overrides) ? b.overrides : [],
    }
  })

  const pluginRows = plugins.map((p) => ({
    key: `plugin:${p.entryId}`,
    kind: 'plugin',
    entryId: String(p.entryId),
    moduleName: p.moduleName,
    // The Loader calls an entry `@deepseek-ai/dsh-session` but a subpath entry
    // `@deepseek-ai/dsh-plugin-manager/tools`; the package behind both is the
    // part before the second slash. Classifiers read `name`, and without this
    // every one of the 200-odd plugin rows looked like it had no name at all.
    name: packageNameOf(p.moduleName),
    enabled: Boolean(p.enabled),
    fiberPhase: p.fiberPhase || null,
    title: describeMeta(p.meta)?.title || null,
    description: describeMeta(p.meta)?.description || null,
    readOnlyReason: p.readOnlyReason || null,
    patchId: p.patchId || null,
  }))

  return {
    ok: true,
    degraded: false,
    pluginVersion: PLUGIN_VERSION,
    dshVersion: runtimeVersion(),
    profileDir: profileDir(),
    storageDir: storageDir(),
    bundles: rows,
    plugins: pluginRows,
    warnings,
  }
}

/* ------------------------------------------------------------------ */
/* modpack documents                                                   */
/* ------------------------------------------------------------------ */

function sanitizeFileName(name) {
  const base = String(name || 'modpack').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80)
  return (base || 'modpack')
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = raw.kind === 'plugin' ? 'plugin' : 'bundle'
  const spec = typeof raw.spec === 'string' ? raw.spec.trim() : ''
  const override = typeof raw.override === 'string' ? raw.override.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const moduleName = typeof raw.moduleName === 'string' ? raw.moduleName.trim() : ''
  if (kind === 'bundle' && !name) return null
  if (kind === 'plugin' && !moduleName) return null
  return {
    kind,
    name: name || null,
    moduleName: moduleName || null,
    entryId: typeof raw.entryId === 'string' ? raw.entryId : null,
    spec: spec || name || moduleName,
    override: override || null,
    version: typeof raw.version === 'string' ? raw.version : null,
    enabled: raw.enabled !== false,
    official: Boolean(raw.official),
    local: kind === 'bundle' ? isLocalSpec(override || spec || name) : false,
    title: typeof raw.title === 'string' ? raw.title : null,
    description: typeof raw.description === 'string' ? raw.description : null,
    // The author's own grouping, carried so a pack stays readable to whoever
    // receives it. Cosmetic: `planModpack` never installs anything based on it.
    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim().slice(0, 200) : null,
  }
}

function buildModpack(meta, entries) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(Boolean)
  const bundles = normalized.filter((e) => e.kind === 'bundle')
  const plugins = normalized.filter((e) => e.kind === 'plugin')
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    generator: `dsh-modpack@${PLUGIN_VERSION}`,
    name: String(meta.name || '未命名整合包').slice(0, 120),
    description: String(meta.description || '').slice(0, 2000),
    author: String(meta.author || '').slice(0, 120),
    createdAt: new Date().toISOString(),
    dshVersion: runtimeVersion(),
    counts: { total: normalized.length, bundles: bundles.length, plugins: plugins.length },
    categories: [...new Set(normalized.map((e) => e.category).filter(Boolean))].sort(),
    // The file has to explain itself to somebody who does NOT have this plugin —
    // that is the whole point of sending a pack to another machine. Written into
    // the document rather than only into this project's README, because the file
    // is what travels, and because a recipient's agent can act on it directly.
    howToUse: [
      'This file is a DeepSeek Harness modpack (dsh-modpack). 这是一个 DeepSeek Harness 整合包。',
      'A: Install the dsh-modpack plugin, then use Settings → Plugin Modpacks → Import. 已装本插件时，在「设置 → 插件整合包 → 导入」选择本文件，预览后一键安装。',
      'B: Without the plugin, hand this file to any DeepSeek Harness agent and ask it to install the plugins listed in plugins[] with the plugin_manager tool. Install each as `<name>@<spec>`, then apply its `enabled` flag. 未装本插件时，把本文件交给任意 DSH 智能体，让它用 plugin_manager 按 plugins[] 逐个安装。',
      'C: Or install each entry in plugins[] by hand from its name and spec. 也可以照着 plugins[] 里的 name / spec 手动逐个安装。',
      `plugins[] entries are self-contained; \`category\` is the author's grouping and is never an install instruction. format=${FORMAT} formatVersion=${FORMAT_VERSION}.`,
    ],
    plugins: [...bundles, ...plugins],
  }
}

function validateModpack(doc) {
  if (!doc || typeof doc !== 'object') return '整合包内容不是合法 JSON 对象'
  if (doc.format !== FORMAT) return `不是 dsh-modpack 文件（format=${JSON.stringify(doc.format)}）`
  const version = Number(doc.formatVersion || 0)
  if (!Number.isFinite(version) || version < 1) return `整合包版本号无效（formatVersion=${JSON.stringify(doc.formatVersion)}）`
  if (version > FORMAT_VERSION) return `整合包由更新的 dsh-modpack 生成（formatVersion=${version}，本机支持 ${FORMAT_VERSION}），请先升级插件`
  if (!Array.isArray(doc.plugins)) return '整合包缺少 plugins 数组'
  return null
}

function listSaved() {
  const dir = storageDir()
  const out = []
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(SUFFIX)) continue
      const full = join(dir, file)
      try {
        const stat = statSync(full)
        const doc = JSON.parse(readFileSync(full, 'utf8'))
        out.push({
          file,
          path: full,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          name: doc.name || file.replace(SUFFIX, ''),
          description: doc.description || '',
          author: doc.author || '',
          counts: doc.counts || { total: Array.isArray(doc.plugins) ? doc.plugins.length : 0 },
          dshVersion: doc.dshVersion || null,
        })
      } catch {
        /* unreadable file: skip rather than fail the listing */
      }
    }
  } catch {
    /* storage directory does not exist yet */
  }
  out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
  return out
}

/* ------------------------------------------------------------------ */
/* categories — a user-named tree over the installed plugins           */
/* ------------------------------------------------------------------ */

const CATEGORY_FILE = 'categories.json'
const CATEGORY_MAX_NODES = 500
const CATEGORY_MAX_NAME = 60

function categoriesPath() {
  return join(storageDir(), CATEGORY_FILE)
}

/**
 * Coerce whatever is on disk (or on the wire) into a shape the UI can walk
 * without defensive checks at every level: unique ids, bounded names, no
 * dangling or cyclic parents, and no assignment pointing at a category that
 * no longer exists.
 *
 * This is deliberately forgiving rather than strict. `categories.json` is a
 * plain file in the user's home directory, so people will hand-edit it, sync
 * it between machines, or merge two copies — and a tree that has been knotted
 * into a cycle must degrade to a flat list, never to a page that will not
 * render. What sanitizing cannot honestly repair is reported by
 * `validateCategories` before writing, so the UI can still explain a refusal.
 */
function sanitizeCategories(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  const nodes = []
  const seen = new Set()
  for (const item of Array.isArray(src.nodes) ? src.nodes : []) {
    if (nodes.length >= CATEGORY_MAX_NODES) break
    if (!item || typeof item !== 'object') continue
    const id = textOf(item.id).slice(0, 64)
    const name = textOf(item.name).trim().slice(0, CATEGORY_MAX_NAME)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    nodes.push({
      id,
      name,
      parentId: item.parentId == null || item.parentId === '' ? null : textOf(item.parentId).slice(0, 64),
      order: Number.isFinite(item.order) ? Math.trunc(item.order) : nodes.length,
    })
  }

  // 1. A parent must exist and must not be the node itself.
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    if (node.parentId && (node.parentId === node.id || !byId.has(node.parentId))) node.parentId = null
  }

  // 2. Walking up from any node must terminate. A cycle is broken by
  //    detaching the node that closed it, which keeps the rest of the
  //    subtree exactly where the user put it.
  for (const node of nodes) {
    let hop = node.parentId
    let guard = 0
    while (hop && guard++ <= nodes.length) {
      if (hop === node.id) { node.parentId = null; break }
      const parent = byId.get(hop)
      hop = parent ? parent.parentId : null
    }
  }

  const assignments = {}
  const source = src.assignments && typeof src.assignments === 'object' && !Array.isArray(src.assignments)
    ? src.assignments
    : {}
  for (const [key, value] of Object.entries(source)) {
    const id = textOf(value)
    if (!key || !id || !byId.has(id)) continue
    assignments[String(key).slice(0, 200)] = id
  }

  const updatedAt = textOf(src.updatedAt)
  return {
    version: 1,
    updatedAt: updatedAt || null,
    nodes,
    assignments,
    counts: { categories: nodes.length, assigned: Object.keys(assignments).length },
  }
}

function readCategories() {
  try {
    return sanitizeCategories(JSON.parse(readFileSync(categoriesPath(), 'utf8')))
  } catch {
    return sanitizeCategories(null) // no file yet, or unreadable: start empty
  }
}

function writeCategories(doc) {
  const clean = sanitizeCategories(doc)
  clean.updatedAt = new Date().toISOString()
  mkdirSync(storageDir(), { recursive: true })
  writeFileSync(
    categoriesPath(),
    JSON.stringify({ version: clean.version, updatedAt: clean.updatedAt, nodes: clean.nodes, assignments: clean.assignments }, null, 2),
    'utf8',
  )
  return clean
}

function validateCategories(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return '分类数据无效'
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : []
  if (nodes.length > CATEGORY_MAX_NODES) return `分类数量超过上限（${CATEGORY_MAX_NODES}）`
  const ids = new Set()
  for (const node of nodes) {
    if (!node || typeof node !== 'object') return '分类条目无效'
    const id = textOf(node.id)
    const name = textOf(node.name).trim()
    if (!id) return '分类缺少 id'
    if (!name) return '分类名称不能为空'
    if (name.length > CATEGORY_MAX_NAME) return `分类名称过长（上限 ${CATEGORY_MAX_NAME} 字）`
    if (ids.has(id)) return `分类 id 重复：${id}`
    ids.add(id)
  }
  return null
}

/* ------------------------------------------------------------------ */
/* automatic categorisation                                            */
/* ------------------------------------------------------------------ */

/**
 * Read the *author-declared* metadata for one installed package.
 *
 * This is the whole reason auto-categorisation can be honest rather than
 * guesswork: `package.json` carries `keywords`, and the DSH plugin ecosystem
 * already tags packages with `dsh-plugin` plus a handful of domain words
 * (`mcp`, `session`, `context`, `model-provider`, `skill`, ...). Reading the
 * tags beats inferring from names, which are inconsistent across authors.
 *
 * Best-effort by design: a package missing from every root costs a few failed
 * reads and nothing else. What a caller gets back may be a description with no
 * keywords, or keywords with no README — each tier of the classifier consumes
 * whichever field it needs and reports which one it actually used.
 *
 * `packageMetaRoots` decides where to look; the order there is the order of
 * preference, and the first root that yields a readable manifest wins.
 *
 * The profile's `node_modules` covers everything the user installed, and that
 * was the whole list until a real profile made the cost visible: seven of
 * sixteen rows could only be guessed, and all seven were official
 * `@deepseek-ai/*` bundles. Those are never installed into the profile — they
 * ship inside the runtime, which in the desktop app is a single `app.asar`
 * archive. Nothing about them is unreadable in principle; the classifier was
 * simply looking in one place.
 *
 * Electron patches `fs` so that `app.asar/...` opens like a directory, which is
 * why the host can read it while a plain shell cannot. That patch is also why
 * this is a list of *tries* rather than a checked path: under `npx
 * @deepseek-ai/dsh` there is no archive at all and every root here fails
 * harmlessly, leaving the original single-root behaviour intact.
 */
function packageMetaRoots() {
  const roots = [join(profileDir(), 'node_modules')]
  const resourcesDirs = []
  // Electron sets this to `<install>/resources`. Guarded because a plain Node
  // host has no such property.
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    resourcesDirs.push(process.resourcesPath)
  }
  // The same directory, derived from the binary instead, for hosts that do not
  // expose `resourcesPath` to plugins.
  try {
    resourcesDirs.push(join(dirname(process.execPath), 'resources'))
  } catch {
    /* no usable execPath: the roots above still stand */
  }
  for (const resources of resourcesDirs) {
    // `dsh/` is the runtime's own package root in the shipped desktop app; the
    // flat form is the layout a differently-packaged build would use.
    roots.push(join(resources, 'app.asar', 'dsh', 'node_modules'))
    roots.push(join(resources, 'app.asar', 'node_modules'))
  }
  return roots
}

function readPackageMeta(name) {
  const parts = String(name).split('/')
  for (const root of packageMetaRoots()) {
    const dir = join(root, ...parts)
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      return {
        keywords: Array.isArray(pkg.keywords) ? pkg.keywords.map((k) => String(k).toLowerCase()) : [],
        description: typeof pkg.description === 'string' ? pkg.description : null,
        version: typeof pkg.version === 'string' ? pkg.version : null,
        readme: readLocalReadme(dir),
      }
    } catch {
      /* not under this root — try the next one */
    }
  }
  return null
}

/**
 * The README that shipped inside the installed package, if any.
 *
 * This is the cheapest evidence there is — it is already on disk, it costs no
 * network call, and it is the author's own words about this exact package. It
 * matters most for the plugins the online lookup cannot help with: a package
 * installed from a local folder (`link:` / `@local/`) is never on npm, so
 * without this it would be classified from its name alone even though a
 * perfectly good description is sitting next to its `package.json`.
 *
 * Capped hard: READMEs run to 65 KB in this profile, and the classifier only
 * ever looks for a few dozen short phrases near the top.
 */
function readLocalReadme(dir) {
  for (const file of README_FILES) {
    try {
      const text = readFileSync(join(dir, file), 'utf8')
      if (text) return text.slice(0, LOCAL_README_CHARS)
    } catch {
      /* try the next name */
    }
  }
  return ''
}

/**
 * Ordered rules, first match wins. Order is deliberate: the more specific a
 * rule is, the earlier it sits. `mcp` beats `automation` because a Windows MCP
 * bridge is primarily an MCP server; `session` beats `local` because knowing
 * what a plugin *does* is more useful than knowing how it was installed.
 *
 * `experimental` sits second to last on purpose. It describes a plugin's
 * *maturity*, not its function, so letting it fire early collapsed five
 * different official bundles — translation, session titles, terminal, worktree,
 * repeated work — into one bucket labelled "experimental", which is exactly the
 * kind of tree that looks organised and helps nobody. It is still the answer for
 * a plugin that has no functional signal at all, which is what `ralph-bundle`
 * genuinely is; it just must not outrank `terminal` or `translation` when those
 * have something to say.
 *
 * Every rule carries the reason it fired, so the preview can say *why* a
 * plugin landed where it did instead of asking the user to trust a black box.
 */
const AUTO_RULES = [
  {
    id: 'mcp',
    name: { zh: 'MCP 与外部工具', en: 'MCP & external tools' },
    why: { zh: '关键词含 mcp，用来接入外部工具服务', en: 'tagged mcp — bridges an external tool server' },
    whyGuess: { zh: '名字里带 mcp，推测是接入外部工具的桥', en: 'name contains "mcp" — guessing it bridges an external tool server' },
    tags: ['mcp', 'model-context-protocol'],
    test: (row, meta) =>
      /\bmcp\b/i.test(row.name || '') ||
      (meta && (meta.keywords.includes('mcp') || meta.keywords.includes('model-context-protocol'))),
  },
  {
    id: 'session',
    name: { zh: '会话与工作区', en: 'Sessions & workspaces' },
    why: { zh: '关键词涉及会话或工作区管理', en: 'tagged for session or workspace management' },
    whyGuess: { zh: '名字里带 session/workspace，推测是会话或工作区相关', en: 'name mentions session or workspace — guessing it manages them' },
    tags: ['session', 'workspace', 'session-manager', 'workspace-archive'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('session') || meta.keywords.includes('workspace') ||
        meta.keywords.includes('session-manager') || meta.keywords.includes('workspace-archive'))) ||
      /session|workspace/i.test(row.name || ''),
  },
  {
    id: 'model',
    name: { zh: '模型接入', en: 'Model providers' },
    why: { zh: '关键词涉及模型提供方或额度', en: 'tagged as a model provider or credit source' },
    whyGuess: { zh: '名字像某个模型服务，推测是模型接入', en: 'name looks like a model service — guessing it is a provider' },
    tags: ['model-provider', 'credits', 'provider', 'llm'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('model-provider') || meta.keywords.includes('credits') ||
        meta.keywords.includes('provider') || meta.keywords.includes('llm'))) ||
      /workbuddy|codebuddy|codex|openai|anthropic|gemini|ollama/i.test(row.name || ''),
  },
  {
    id: 'context',
    name: { zh: '上下文与记忆', en: 'Context & memory' },
    why: { zh: '关键词涉及上下文压缩或记忆', en: 'tagged for context compression or memory' },
    whyGuess: { zh: '名字里带 context/memory，推测与上下文或记忆有关', en: 'name mentions context or memory — guessing it manages them' },
    tags: ['context', 'compression', 'memory', 'acp'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('context') || meta.keywords.includes('compression') ||
        meta.keywords.includes('memory') || meta.keywords.includes('acp'))) ||
      /context|memory/i.test(row.name || ''),
  },
  {
    id: 'skill',
    name: { zh: '技能与提示词', en: 'Skills & prompts' },
    why: { zh: '关键词含 skill，提供的是技能而非代码', en: 'tagged skill — ships instructions, not code' },
    whyGuess: { zh: '名字里带 skill/prompt，推测提供的是技能', en: 'name mentions skill or prompt — guessing it ships instructions' },
    tags: ['skill', 'prompt'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('skill') || meta.keywords.includes('prompt'))) ||
      /skill|prompt/i.test(row.name || ''),
  },
  {
    id: 'plugin-mgmt',
    name: { zh: '插件管理', en: 'Plugin management' },
    why: { zh: '关键词涉及插件/整合包管理', en: 'tagged for plugin or modpack management' },
    whyGuess: { zh: '名字里带 modpack/plugin-manager，推测是插件管理工具', en: 'name mentions modpack or plugin-manager — guessing it manages plugins' },
    tags: ['plugin-manager', 'modpack', 'plugin-management'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('plugin-manager') || meta.keywords.includes('modpack') ||
        meta.keywords.includes('plugin-management'))) ||
      /modpack|plugin-manager/i.test(row.name || ''),
  },
  {
    id: 'automation',
    name: { zh: '桌面与自动化', en: 'Desktop & automation' },
    why: { zh: '关键词涉及桌面自动化或界面操作', en: 'tagged for desktop automation or UI control' },
    whyGuess: { zh: '名字里带 windows/desktop，推测是桌面操作相关', en: 'name mentions windows or desktop — guessing it drives the desktop' },
    tags: ['automation', 'computer-use', 'ui-automation', 'screenshot'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('automation') || meta.keywords.includes('computer-use') ||
        meta.keywords.includes('ui-automation') || meta.keywords.includes('screenshot'))) ||
      /windows|desktop|automation/i.test(row.name || ''),
  },
  {
    id: 'ui',
    name: { zh: '界面与主题', en: 'UI & themes' },
    why: { zh: '关键词涉及界面、主题或渲染', en: 'tagged for UI, theming or rendering' },
    whyGuess: { zh: '名字里带 ui/theme/render，推测是界面相关', en: 'name mentions ui, theme or render — guessing it affects the interface' },
    tags: ['ui', 'theme', 'render', 'slot'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('ui') || meta.keywords.includes('theme') ||
        meta.keywords.includes('render') || meta.keywords.includes('slot'))) ||
      /ui-|theme|render/i.test(row.name || ''),
  },
  {
    id: 'local',
    name: { zh: '本地开发', en: 'Local development' },
    why: { zh: '装的是本机路径（link/file），换台电脑要重新指路径', en: 'installed from a local path — a different machine needs it re-pointed' },
    // Fires on how the package was installed, not on any keyword: a fact, so it
    // must not claim 'tags' and must not be presented as a guess either.
    basis: 'fact',
    tags: [],
    test: (row) => row.local === true || /^@local\//.test(row.name || ''),
  },
  {
    id: 'terminal',
    name: { zh: '终端与 Shell', en: 'Terminal & shell' },
    why: { zh: '关键词涉及终端或 shell 进程', en: 'tagged for terminal or shell processes' },
    whyGuess: { zh: '名字或简介提到 terminal/shell，推测与终端有关', en: 'name or description mentions terminal or shell' },
    tags: ['terminal', 'shell', 'pty', 'command'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('terminal') || meta.keywords.includes('shell') ||
        meta.keywords.includes('pty'))) ||
      /terminal|shell/i.test(row.name || ''),
  },
  {
    id: 'worktree',
    name: { zh: 'Git 与工作树', en: 'Git & worktrees' },
    why: { zh: '关键词涉及 Git 工作树或分支', en: 'tagged for Git worktrees or branches' },
    whyGuess: { zh: '名字或简介提到 worktree/git，推测与 Git 有关', en: 'name or description mentions worktree or git' },
    tags: ['worktree', 'git', 'branch'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('worktree') || meta.keywords.includes('git'))) ||
      /worktree/i.test(row.name || ''),
  },
  {
    id: 'subagent',
    name: { zh: '子智能体', en: 'Subagents' },
    why: { zh: '关键词涉及子智能体或外部代理', en: 'tagged for subagents or an external agent backend' },
    whyGuess: { zh: '名字或简介提到 subagent/codex，推测接入子智能体', en: 'name or description mentions subagent or codex' },
    tags: ['subagent', 'sub-agent', 'codex', 'agent-backend'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('subagent') || meta.keywords.includes('sub-agent'))) ||
      /subagent|sub-agent/i.test(row.name || ''),
  },
  {
    id: 'titles',
    name: { zh: '会话标题', en: 'Session titles' },
    why: { zh: '关键词涉及会话标题生成', en: 'tagged for session-title generation' },
    whyGuess: { zh: '名字或简介提到标题，推测是标题生成', en: 'name or description mentions titles' },
    tags: ['title', 'titles', 'naming'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('title') || meta.keywords.includes('titles'))) ||
      /title/i.test(row.name || ''),
  },
  {
    id: 'translation',
    name: { zh: '翻译', en: 'Translation' },
    why: { zh: '关键词涉及机器翻译', en: 'tagged for machine translation' },
    whyGuess: { zh: '名字或简介提到翻译，推测做翻译', en: 'name or description mentions translation' },
    tags: ['translation', 'translate', 'i18n'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('translation') || meta.keywords.includes('translate'))) ||
      /translat/i.test(row.name || ''),
  },
  {
    id: 'runtime',
    name: { zh: '运行时核心', en: 'Runtime core' },
    why: { zh: '关键词涉及运行时或基础层', en: 'tagged as a runtime core or base layer' },
    whyGuess: { zh: '名字像基础层（base/web-app），推测是运行时核心', en: 'name looks like a base layer — guessing it is runtime core' },
    tags: ['runtime', 'core', 'base', 'web-app'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('runtime') || meta.keywords.includes('core'))) ||
      /(^|\/)dsh-(base|web-app)$/i.test(row.name || ''),
  },
  {
    id: 'web',
    name: { zh: '网页访问', en: 'Web access' },
    why: { zh: '关键词涉及网页搜索或抓取', en: 'tagged for web search or page fetching' },
    whyGuess: { zh: '名字里带 web-search/web-fetch，推测负责网页访问', en: 'name mentions web-search or web-fetch — guessing it reaches the web' },
    tags: ['web', 'web-search', 'web-fetch', 'search', 'fetch'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('web') || meta.keywords.includes('web-search') ||
        meta.keywords.includes('web-fetch'))) ||
      /web-search|web-fetch|tool-web|(^|\/)dsh-web$/i.test(row.name || ''),
  },
  {
    id: 'permissions',
    name: { zh: '沙箱与权限', en: 'Sandbox & permissions' },
    why: { zh: '关键词涉及沙箱、审批或权限模式', en: 'tagged for sandboxing, approval or permission modes' },
    whyGuess: { zh: '名字里带 sandbox/approval/permission，推测管权限与沙箱', en: 'name mentions sandbox, approval or permission — guessing it governs access' },
    tags: ['sandbox', 'approval', 'permission', 'permissions', 'security'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('sandbox') || meta.keywords.includes('approval') ||
        meta.keywords.includes('permission') || meta.keywords.includes('security'))) ||
      /sandbox|approval|permission/i.test(row.name || ''),
  },
  {
    id: 'storage',
    name: { zh: '数据存储', en: 'Storage' },
    why: { zh: '关键词涉及数据存储或凭据', en: 'tagged for data storage or credentials' },
    whyGuess: { zh: '名字里带 storage/attachment/credentials，推测负责持久化', en: 'name mentions storage, attachment or credentials — guessing it persists data' },
    tags: ['storage', 'attachment', 'credentials', 'persistence'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('storage') || meta.keywords.includes('attachment') ||
        meta.keywords.includes('credentials') || meta.keywords.includes('persistence'))) ||
      /storage|attachment|credentials|spill/i.test(row.name || ''),
  },
  {
    id: 'files',
    name: { zh: '文件与工作区', en: 'Files & workspace' },
    why: { zh: '关键词涉及文件读写、搜索或工作区目录', en: 'tagged for file reading, searching or workspace directories' },
    whyGuess: { zh: '名字里带 tool-fs/file-upload/working-directory，推测管文件与目录', en: 'name mentions tool-fs, file-upload or working-directory — guessing it handles files' },
    tags: ['files', 'file', 'workspace-files', 'file-search'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('files') || meta.keywords.includes('file') ||
        meta.keywords.includes('file-search'))) ||
      /tool-fs|fs-observation|file-reference|file-upload|workspace-files|workspace-changes|working-directory|client-resources/i.test(row.name || ''),
  },
  {
    id: 'commands',
    name: { zh: '命令与快捷入口', en: 'Commands' },
    why: { zh: '关键词涉及用户命令或斜杠入口', en: 'tagged for user commands or slash entry points' },
    whyGuess: { zh: '名字里带 command，推测注册的是用户命令', en: 'name mentions command — guessing it registers user commands' },
    tags: ['command', 'commands', 'slash-command'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('command') || meta.keywords.includes('commands'))) ||
      /(^|\/)dsh-commands?(-|$)|command-feedback/i.test(row.name || ''),
  },
  {
    id: 'tools',
    name: { zh: '工具与调用', en: 'Tools' },
    why: { zh: '关键词涉及工具注册或调用', en: 'tagged for tool registration or invocation' },
    whyGuess: { zh: '名字是 dsh-tool-*，按官方命名推测是给 AI 用的工具', en: 'named dsh-tool-* — guessing from the official convention that it is a model-facing tool' },
    tags: ['tool', 'tools', 'tool-call'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('tool') || meta.keywords.includes('tools'))) ||
      /(^|\/)dsh-tools?(-|$)/i.test(row.name || ''),
  },
  {
    id: 'settings',
    name: { zh: '设置与配置', en: 'Settings' },
    why: { zh: '关键词涉及设置或插件配置', en: 'tagged for settings or plugin configuration' },
    whyGuess: { zh: '名字里带 settings/config-editor，推测管设置与配置', en: 'name mentions settings or config-editor — guessing it stores configuration' },
    tags: ['settings', 'config', 'configuration'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('settings') || meta.keywords.includes('config'))) ||
      /(^|\/)dsh-settings$|config-editor|api-settings-controller|client-ui-settings/i.test(row.name || ''),
  },
  {
    id: 'telemetry',
    name: { zh: '遥测与上报', en: 'Telemetry' },
    why: { zh: '关键词涉及遥测、统计或上报', en: 'tagged for telemetry, analytics or reporting' },
    whyGuess: { zh: '名字里带 otel/telemetry/analytics，推测是数据上报', en: 'name mentions otel, telemetry or analytics — guessing it reports usage' },
    tags: ['telemetry', 'analytics', 'otel', 'opentelemetry'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('telemetry') || meta.keywords.includes('analytics') ||
        meta.keywords.includes('otel'))) ||
      /otel|telemetry|analytics|product-inventory|package-inventory/i.test(row.name || ''),
  },
  {
    id: 'tasks',
    name: { zh: '后台任务与调度', en: 'Background tasks' },
    why: { zh: '关键词涉及后台任务、定时或工作流', en: 'tagged for background jobs, scheduling or workflows' },
    whyGuess: { zh: '名字里带 jobs/schedule/workflow，推测管后台任务与调度', en: 'name mentions jobs, schedule or workflow — guessing it runs background work' },
    tags: ['jobs', 'schedule', 'workflow', 'background-job'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('jobs') || meta.keywords.includes('schedule') ||
        meta.keywords.includes('workflow'))) ||
      /jobs|schedule|workflow|ralph/i.test(row.name || ''),
  },
  {
    id: 'dialogs',
    name: { zh: '宿主集成与对话框', en: 'Host integration' },
    why: { zh: '关键词涉及系统对话框或本地应用', en: 'tagged for system dialogs or local applications' },
    whyGuess: { zh: '名字里带 directory-picker/open-in-app，推测与宿主系统交互', en: 'name mentions directory-picker or open-in-app — guessing it talks to the host OS' },
    tags: ['dialog', 'directory-picker', 'open-in-app'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('dialog') || meta.keywords.includes('directory-picker'))) ||
      /directory-picker|open-in-app/i.test(row.name || ''),
  },
  {
    id: 'profiles',
    name: { zh: '应用档与入口', en: 'App profiles' },
    why: { zh: '关键词表明它是一套整体运行档（ACP/SDK 之类入口）', en: 'tagged as a whole runtime profile or entry app' },
    whyGuess: { zh: '名字以 -app 结尾，推测它是一套整体运行档', en: 'name ends in -app — guessing it is a whole runtime profile' },
    tags: ['profile', 'app', 'entry'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('profile') || meta.keywords.includes('entry'))) ||
      /-app$|profile/i.test(row.name || ''),
  },
  {
    id: 'client',
    name: { zh: '客户端与接口', en: 'Client & API' },
    why: { zh: '关键词涉及客户端或对外接口', en: 'tagged for the client or the API surface' },
    whyGuess: { zh: '名字是 dsh-client-*/dsh-api-*，推测是客户端运行时或接口层', en: 'named dsh-client-* or dsh-api-* — guessing it is the client runtime or API layer' },
    tags: ['client', 'api', 'browser'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('client') || meta.keywords.includes('api'))) ||
      /(^|\/)dsh-(client|api)-/i.test(row.name || ''),
  },
  {
    id: 'agent',
    name: { zh: '智能体循环', en: 'Agent loop' },
    why: { zh: '关键词涉及智能体、计划或目标', en: 'tagged for the agent, planning or goals' },
    whyGuess: { zh: '名字里带 agent-loop/plan-mode/goal，推测是智能体主循环', en: 'name mentions agent-loop, plan-mode or goal — guessing it drives the agent loop' },
    tags: ['agent', 'agent-loop', 'plan-mode', 'goal'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('agent') || meta.keywords.includes('agent-loop') ||
        meta.keywords.includes('plan-mode') || meta.keywords.includes('goal'))) ||
      /(^|\/)dsh-agent|agent-loop|plan-mode|(^|\/)dsh-goal|goal-round/i.test(row.name || ''),
  },
  {
    id: 'infra',
    name: { zh: '基础服务', en: 'Base services' },
    why: { zh: '关键词标明它是供其他插件使用的基础服务', en: 'tagged as a base service other plugins build on' },
    whyGuess: { zh: '名字像注册表/网关/子进程这类底层服务，推测是基础服务', en: 'name looks like a registry, gateway or subprocess service — guessing it is infrastructure' },
    tags: ['service', 'registry', 'gateway', 'infrastructure'],
    test: (row, meta) =>
      (meta && (meta.keywords.includes('service') || meta.keywords.includes('registry') ||
        meta.keywords.includes('gateway') || meta.keywords.includes('infrastructure'))) ||
      /typert|api-gateway|system-prompt|subprocess|shell-env|hmr/i.test(row.name || ''),
  },
  {
    // Maturity, not function — so it is tried only after every functional rule.
    id: 'experimental',
    name: { zh: '实验特性', en: 'Experimental' },
    why: { zh: '关键词标记为实验性功能', en: 'tagged experimental' },
    whyGuess: { zh: '名字里带 experimental，按官方命名习惯推测是实验性功能', en: 'name contains "experimental" — guessing from the official naming convention' },
    tags: ['experimental'],
    test: (row, meta) =>
      /experimental/i.test(row.name || '') ||
      (meta && meta.keywords.includes('experimental')),
  },
  {
    id: 'other',
    name: { zh: '其他', en: 'Other' },
    why: { zh: '没有可识别的分类线索，先放这里，你可以自己挪', en: 'no recognised signal — filed here for you to move' },
    // The catch-all is not a judgement about the plugin at all, so it must not
    // be reported as a name-based guess.
    basis: 'none',
    tags: [],
    test: () => true,
  },
]

/**
 * Which rule claims this row, and on what basis.
 *
 * `basis` is not inferred from "did the package have keywords". A rule can fire
 * several different ways, and they make different claims:
 *   - 'tags'     — the author's own keywords said so (a fact about intent)
 *   - 'desc'     — the author's one-line `description` said so (prose, but
 *                  still the package's own file, still no network involved)
 *   - 'readme'   — the README shipped inside the installed package says so (the
 *                  author's own prose, read from disk, no network involved)
 *   - 'remote'   — a public npm/GitHub page said so (evidence, but off-machine)
 *   - 'ai'       — a language model said so (the only tier that costs money)
 *   - 'name'     — the package name looks like it (our guess)
 *   - 'fact'     — how it was installed (a fact, but not a keyword)
 *   - 'none'     — nothing recognised a signal at all
 * The UI prints `reason` next to `basis`, so a mismatch would tell the user two
 * contradictory things about the same plugin. Hence each rule declares the
 * keywords that count as its own signal, and only a real keyword hit may claim
 * 'tags'.
 *
 * The prose tiers run *after* the keyword tier on purpose: a package that
 * declares `mcp` in its keywords must never be filed by a sentence in prose,
 * because the author's structured statement outranks their narrative one. Among
 * the prose tiers, the one-line description runs before the README: it is
 * written to summarise the package, while a README opens with whatever the
 * author felt like saying first.
 */
function classifyRow(row) {
  // Read the manifest for any row that names a real package. Plugin rows used
  // to be excluded here on the assumption that only bundles have manifests; the
  // 215 Loader entries in a real profile proved otherwise — they are ordinary
  // `@deepseek-ai/*` packages with their own `package.json` and keywords, and
  // refusing to look at it was the reason every one of them fell through to
  // "其他".
  const meta = row && row.name ? readPackageMeta(row.name) : null
  for (const rule of AUTO_RULES) {
    let hit = false
    try {
      hit = rule.test(row, meta)
    } catch {
      hit = false
    }
    if (!hit) continue
    const tagged = Boolean(
      meta && Array.isArray(meta.keywords) && meta.keywords.length > 0 &&
      Array.isArray(rule.tags) && rule.tags.some((tag) => meta.keywords.includes(tag)),
    )
    const basis = rule.basis === 'fact' || rule.basis === 'none'
      ? rule.basis
      : (tagged ? 'tags' : 'name')
    return {
      ruleId: rule.id,
      name: rule.name,
      why: basis === 'name' ? (rule.whyGuess || rule.why) : rule.why,
      basis,
    }
  }
  const last = AUTO_RULES[AUTO_RULES.length - 1]
  return { ruleId: last.id, name: last.name, why: last.why, basis: 'none' }
}

/**
 * The lede of a README: everything before the first `## ` heading, capped.
 *
 * Matching the whole file was wrong in a way that only showed up against real
 * packages. `@deepseek-ai/dsh-subagent-codex` says "complete terminal result",
 * meaning *final*, and got filed under terminals; `dsh-windows-mcp` installs
 * via "DSH's own plugin manager", a sentence about installing it, not about
 * what it does; `dsh-aliyun-coupon` says its Host half needs a toggle in the
 * plugin manager, same trap. A package's own opening paragraph describes the
 * package; everything after that describes usage, history and caveats.
 */
function readmeLede(readme) {
  if (typeof readme !== 'string') return ''
  const text = readme.slice(0, README_LEDE_MAX)
  let heading = text.search(/^## /m)
  // A file whose very first line is `## Title` has no lede above it. Giving up
  // here would hand back the whole slice, which is the bug this function
  // exists to prevent, so the cut falls to the *next* heading instead.
  if (heading === 0) {
    const next = text.slice(1).search(/^## /m)
    heading = next < 0 ? -1 : next + 1
  }
  return heading > 0 ? text.slice(0, heading) : text
}

/**
 * The last offline rung: the README that ships inside the package.
 *
 * Consulted only when neither the keyword/name pass nor the one-line
 * description could stand behind a row, so a plugin whose author already said
 * what it does is never re-judged by prose. The signal table is the same one
 * the online pass uses — the phrases that count as evidence do not change
 * depending on where the text was read from.
 *
 * Returns null when the local README says nothing recognisable, which is the
 * normal case and not a failure.
 */
function classifyFromLocalReadme(row) {
  if (!row) return null
  const meta = row.name ? readPackageMeta(row.name) : null
  const readme = meta && typeof meta.readme === 'string' ? meta.readme : ''
  if (!readme) return null
  const lede = readmeLede(readme)
  if (!lede) return null
  for (const rule of AUTO_RULES) {
    const signal = REMOTE_SIGNALS[rule.id]
    if (!signal) continue
    let matched = false
    try {
      matched = signal.hints.some((hint) => wordish(lede, hint))
    } catch {
      matched = false
    }
    if (!matched) continue
    return {
      ruleId: rule.id,
      name: rule.name,
      basis: 'readme',
      evidence: 'local-readme',
      source: null,
      why: {
        zh: `插件自带的 README 里写着：${signal.why.zh}`,
        en: `the README shipped with the plugin says: ${signal.why.en}`,
      },
    }
  }
  return null
}

/**
 * What the package says about itself, in its own one-line description.
 *
 * This is the tier that removes the guessing. A `description` is exactly what
 * the online rung was paying a network round-trip to read, and for an official
 * bundle it is the *only* functional signal that exists on the machine: those
 * packages ship no `keywords`, and their README is out of reach in every
 * install layout except the archive roots `packageMetaRoots` now tries.
 * Matching it costs nothing, needs no network, and is about what the package
 * does rather than about what it is called.
 *
 * Ordered before the README rung to mirror the online pass, whose evidence
 * order is topics > keywords > description > README. Both rungs walk
 * `AUTO_RULES` in the same order and match the same hint table, so for the same
 * text they reach the same verdict — which is what lets a row answered here be
 * dropped from the online rung's work list without changing the answer.
 */
function classifyFromLocalDescription(row) {
  if (!row) return null
  // Two different files can hold the author's one-line description, and which
  // one we read decides what the reason line is allowed to claim.
  //
  //   - A bundle row has no description of its own in the inventory, so the
  //     text comes out of `package.json#description`.
  //   - A plugin row already carries the description the Loader registered from
  //     the package's own `dsh.meta` block. That is the author's prose too, but
  //     it is not the `description` field of `package.json`, and saying it was
  //     would be a small lie printed next to the verdict.
  const own = [row.title, row.description]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join('\n')
  const meta = row.name ? readPackageMeta(row.name) : null
  const fromManifest = meta && typeof meta.description === 'string' ? meta.description.trim() : ''
  const description = own || fromManifest
  if (!description) return null
  const where = own
    ? { zh: '插件注册时自带的名称与简介', en: 'the name and description the plugin registers for itself' }
    : { zh: '插件自己的 package.json 简介', en: "the plugin's own package.json description" }
  for (const rule of AUTO_RULES) {
    const signal = REMOTE_SIGNALS[rule.id]
    if (!signal) continue
    let matched = false
    try {
      matched = signal.hints.some((hint) => wordish(description, hint))
    } catch {
      matched = false
    }
    if (!matched) continue
    return {
      ruleId: rule.id,
      name: rule.name,
      basis: 'desc',
      evidence: 'local-description',
      source: null,
      why: {
        zh: `${where.zh}里写着：${signal.why.zh}`,
        en: `${where.en} says: ${signal.why.en}`,
      },
    }
  }
  return null
}

/**
 * The offline verdict for one row: keywords and name first, then the author's
 * own prose, cheapest evidence first.
 *
 * One function rather than a chain written out at each call site, because two
 * callers have to agree about it — the route seeds every rung's input with it,
 * and `suggestCategories` falls back to it. Two copies would be two chances to
 * disagree about whether a package has already been answered, and that
 * disagreement surfaces as a package name being sent over the network that did
 * not need to be.
 */
function localVerdict(row) {
  const base = classifyRow(row)
  if (base.basis !== 'name' && base.basis !== 'none') return base
  return classifyFromLocalDescription(row) || classifyFromLocalReadme(row) || base
}

/* ------------------------------------------------------------------ */
/* remote enrichment (opt-in, never automatic)                         */
/* ------------------------------------------------------------------ */

/**
 * The vocabulary the online lookup is allowed to match.
 *
 * Deliberately separate from `AUTO_RULES`: the local rules can lean on a
 * package *name* (`/windows|desktop/`), but a README is prose and would match
 * almost anything, so the remote pass only accepts the terms below — and only
 * with word boundaries for short ones. `local` and `other` have no entry at
 * all: one is a fact about installation, the other is the absence of a signal.
 */
const REMOTE_SIGNALS = {
  mcp: {
    tags: ['mcp', 'model-context-protocol'],
    hints: ['model context protocol', 'mcp server', 'mcp 服务'],
    why: { zh: '它用来接入外部工具服务（MCP）', en: 'it bridges an external tool server over MCP' },
  },
  session: {
    tags: ['session', 'workspace', 'session-manager', 'workspace-management', 'session-management'],
    hints: ['session manager', 'workspace manager', '会话管理', '工作区管理', '会话记录', '会话日志', '会话状态', '会话查询', '工作区变更', '消息反馈', '会话反馈'],
    why: { zh: '它管理会话或工作区', en: 'it manages sessions or workspaces' },
  },
  model: {
    tags: ['model-provider', 'credits', 'llm'],
    hints: ['model provider', 'model bridge', '积分倍率', '模型接入', '模型调用', '模型适配', '模型服务', '默认模型', 'api 密钥', '账号模型', '模型请求', '模型重试', 'api 扩展'],
    why: { zh: '它是模型接入或额度相关', en: 'it provides model access or credits' },
  },
  context: {
    tags: ['context', 'compression', 'memory', 'acp'],
    hints: ['context compression', '上下文压缩', '上下文', '记忆', 'token 计量', '压缩'],
    why: { zh: '它处理上下文压缩或记忆', en: 'it compresses or remembers context' },
  },
  skill: {
    tags: ['skill', 'prompt'],
    hints: ['skill', '技能', '提示词'],
    why: { zh: '它提供的是技能/提示词，不是可执行代码', en: 'it ships instructions (a skill) rather than code' },
  },
  'plugin-mgmt': {
    tags: ['plugin-manager', 'modpack', 'plugin-management'],
    hints: ['plugin management', 'bundle management', 'plugin manager', '插件管理', '整合包'],
    why: { zh: '它管理插件或整合包', en: 'it manages plugins or modpacks' },
  },
  automation: {
    tags: ['automation', 'computer-use', 'ui-automation', 'screenshot', 'windows-mcp'],
    hints: ['desktop automation', 'ui automation', '桌面自动化', '自动化操作'],
    why: { zh: '它操作桌面或界面', en: 'it drives the desktop or the UI' },
  },
  ui: {
    tags: ['ui', 'theme', 'render', 'slot'],
    hints: ['theme', '界面主题', '界面', '面板', '侧栏', '布局', 'slot'],
    why: { zh: '它影响界面外观', en: 'it affects the interface' },
  },
  // The signals below were added after running the classifier against the real
  // npm descriptions of this harness's own official bundles. Those packages ship
  // no `keywords`, so their one-line description is the only evidence there is,
  // and the first version of this table matched none of it: eight of eight
  // lookups came back empty on a network that was working perfectly. A
  // description tier that never fires is worse than no description tier, because
  // it looks like the feature is working.
  terminal: {
    tags: ['terminal', 'shell', 'pty', 'command'],
    hints: ['shell process', 'terminal session', 'shell processes', 'terminal', '终端', '命令行', 'shell'],
    why: { zh: '它管理终端或 shell 进程', en: 'it manages terminal or shell processes' },
  },
  worktree: {
    tags: ['worktree', 'git', 'branch'],
    hints: ['worktree', 'git branch', '工作树'],
    why: { zh: '它处理 Git 工作树或分支', en: 'it works with Git worktrees or branches' },
  },
  subagent: {
    tags: ['subagent', 'agent', 'codex'],
    hints: ['subagent', 'sub-agent', '子代理', '子智能体'],
    why: { zh: '它接入子智能体或外部模型代理', en: 'it provides subagents or an external agent backend' },
  },
  titles: {
    tags: ['title', 'titles', 'naming'],
    hints: ['session title', 'session titles', '会话标题'],
    why: { zh: '它生成或刷新会话标题', en: 'it generates or refreshes session titles' },
  },
  translation: {
    tags: ['translation', 'translate', 'i18n'],
    hints: ['translation', 'machine translation', '翻译'],
    why: { zh: '它做机器翻译', en: 'it performs machine translation' },
  },
  experimental: {
    tags: ['experimental', 'experimental-feature'],
    hints: ['experimental', '实验性', '实验'],
    why: { zh: '作者把它标为实验性功能', en: 'the author marks it experimental' },
  },
  web: {
    tags: ['web', 'web-search', 'web-fetch'],
    hints: ['web page', 'web search', 'web fetch', 'http 网页', '网页搜索', '网页获取', '网页访问', '抓取网页', '搜索网页'],
    why: { zh: '它负责网页搜索或抓取', en: 'it searches or fetches the web' },
  },
  permissions: {
    tags: ['sandbox', 'approval', 'permission', 'security'],
    hints: ['sandbox', 'approval', 'permission mode', '沙箱', '权限模式', '审批', '授权'],
    why: { zh: '它管沙箱、审批或权限模式', en: 'it governs the sandbox, approvals or permission modes' },
  },
  storage: {
    tags: ['storage', 'attachment', 'credentials', 'persistence'],
    hints: ['storage backend', '本地存储', '数据存储', '凭据', '附件', '持久保存', '键值'],
    why: { zh: '它负责数据持久化或凭据', en: 'it persists data or holds credentials' },
  },
  tools: {
    tags: ['tool', 'tools'],
    hints: ['tool call', 'tool registration', '工具调用', '工具注册', '工具结果'],
    why: { zh: '它管理工具的注册与调用', en: 'it registers or dispatches tools' },
  },
  client: {
    tags: ['client', 'api'],
    hints: ['client', 'browser', '客户端', '浏览器'],
    why: { zh: '它是客户端运行时或对外接口', en: 'it is the client runtime or the API surface' },
  },
  agent: {
    tags: ['agent', 'agent-loop', 'plan-mode', 'goal'],
    hints: ['agent loop', 'plan mode', '智能体', '计划模式', '会话目标', '运行循环', '向用户提问', '用户提问'],
    why: { zh: '它是智能体主循环、计划或目标', en: 'it is the agent loop, planning or goals' },
  },
  infra: {
    tags: ['service', 'registry', 'gateway', 'infrastructure'],
    hints: ['registry', 'gateway', 'for other plugins', '为其他插件提供', '注册表', '网关', '统一管理', '清单服务', '插件清单', 'http 服务', '接口路由', '动态插件', '运行器'],
    why: { zh: '它是供其他插件使用的基础服务', en: 'it is a base service other plugins build on' },
  },
  runtime: {
    tags: ['runtime', 'core', 'base', 'bundle', 'web-app'],
    hints: ['core', 'runtime glue', 'first patch layer', '核心', '运行时', 'web 服务', '启动配置', '前端页面'],
    why: { zh: '它是运行时核心或基础层', en: 'it is a runtime core or base layer' },
  },
  files: {
    tags: ['files', 'file', 'file-search'],
    hints: ['file search', 'file read', 'workspace files', '文件读写', '文件搜索', '工作区文件', '本地文件', '附件', 'office', '文档转换', '转换为 pdf'],
    why: { zh: '它读写、搜索文件或管理工作区目录', en: 'it reads, searches or organises files' },
  },
  commands: {
    tags: ['command', 'commands', 'slash-command'],
    hints: ['user command', 'slash command', '用户命令', '斜杠命令'],
    why: { zh: '它注册用户命令或斜杠入口', en: 'it registers user commands or slash entries' },
  },
  settings: {
    tags: ['settings', 'config', 'configuration'],
    // Not the bare word "配置": it appears in half the ecosystem's prose
    // ("按配置管理后台运行", "配置启用状态") and made this bucket swallow a
    // third of the profile. Only phrases about *storing settings* count.
    hints: ['settings', 'plugin configuration', 'user settings', '插件配置', '用户设置', '设置服务', '设置界面', '设置读写', '配置编辑'],
    why: { zh: '它保存设置或插件配置', en: 'it stores settings or plugin configuration' },
  },
  telemetry: {
    tags: ['telemetry', 'analytics', 'otel'],
    hints: ['telemetry', 'analytics', 'opentelemetry', '上报', '遥测', '使用统计'],
    why: { zh: '它上报遥测或使用统计', en: 'it reports telemetry or usage analytics' },
  },
  tasks: {
    tags: ['jobs', 'schedule', 'workflow'],
    hints: ['background job', 'background task', 'workflow', '后台任务', '任务调度', '工作流', '定时'],
    why: { zh: '它管理后台任务、定时任务或工作流', en: 'it runs background jobs, schedules or workflows' },
  },
  dialogs: {
    tags: ['dialog', 'directory-picker', 'open-in-app'],
    hints: ['directory picker', 'open in app', '目录选择', '外部应用', '对话框'],
    why: { zh: '它与宿主系统的对话框或本地应用交互', en: 'it talks to the host OS dialogs or local applications' },
  },
  profiles: {
    tags: ['profile', 'app', 'entry'],
    hints: ['profile bundle', 'json-rpc', 'stdio', 'process lifecycle', '运行档', '进程生命周期', '入口应用'],
    why: { zh: '它是一套整体运行档（含进程生命周期与入口协议）', en: 'it is a whole runtime profile with process lifecycle and an entry protocol' },
  },
}

const EVIDENCE_LABEL = {
  topics: { zh: '话题', en: 'topics' },
  keywords: { zh: '关键词', en: 'keywords' },
  description: { zh: '简介', en: 'description' },
  readme: { zh: 'README', en: 'README' },
}

const REMOTE_CACHE_FILE = 'remote-cache.json'
const REMOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PARTIAL_TTL_MS = 6 * 60 * 60 * 1000
const REMOTE_TIMEOUT_MS = 6000
const REMOTE_BUDGET_MS = 25000
const REMOTE_CONCURRENCY = 4
const REMOTE_MAX_LOOKUPS = 40
const REMOTE_README_CHARS = 6000
const REMOTE_README_LIMIT = 200 * 1024
const LOCAL_README_CHARS = 6000
/**
 * How much of a README is allowed to vote on a classification. Only the lede —
 * see `readmeLede` — but the slice happens before the heading search so a file
 * that opens with a 20 KB banner still cannot be scanned in full.
 */
const README_LEDE_MAX = 1500
const README_FILES = ['README.md', 'readme.md', 'README.zh.md', 'README.zh-CN.md']

function remoteCachePath() {
  return join(storageDir(), REMOTE_CACHE_FILE)
}

function readRemoteCache() {
  try {
    const doc = JSON.parse(readFileSync(remoteCachePath(), 'utf8'))
    const entries = doc && typeof doc.entries === 'object' && doc.entries ? doc.entries : {}
    const out = {}
    for (const [name, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object') continue
      if (typeof entry.at !== 'number' || !entry.meta || typeof entry.meta !== 'object') continue
      out[name] = entry
    }
    return out
  } catch {
    return {}
  }
}

function writeRemoteCache(entries) {
  const dir = storageDir()
  mkdirSync(dir, { recursive: true })
  // Prune on write so the file cannot grow forever on a machine that installs
  // and removes plugins over months. Four TTLs is generous enough that a
  // re-installed plugin still answers instantly.
  const horizon = Date.now() - REMOTE_TTL_MS * 4
  const kept = {}
  for (const [name, entry] of Object.entries(entries || {})) {
    if (entry && typeof entry.at === 'number' && entry.at >= horizon) kept[name] = entry
  }
  writeFileSync(remoteCachePath(), JSON.stringify({ version: 1, entries: kept }, null, 2), 'utf8')
}

function encodePackageName(name) {
  return String(name).replace('/', '%2F')
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Substring match, except for short needles.
 *
 * `ui` and `mcp` as plain substrings hit "quick" and "McPherson"; requiring a
 * non-alphanumeric boundary on both sides costs nothing and removes a whole
 * class of false positives. Longer needles are specific enough to match as-is,
 * which is also what makes CJK phrases work — `\b` has no meaning there.
 */
function wordish(haystack, needle) {
  if (!haystack || !needle) return false
  const text = String(haystack).toLowerCase()
  const value = String(needle).toLowerCase()
  if (value.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRe(value)}($|[^a-z0-9])`).test(text)
  }
  return text.includes(value)
}

/** `git+https://github.com/a/b.git`, `{url}`, `github:a/b` -> `a/b`. Only github.com. */
function githubRepoOf(repository) {
  if (!repository) return null
  const raw = typeof repository === 'string'
    ? repository
    : (typeof repository.url === 'string' ? repository.url : '')
  if (!raw) return null
  const match = String(raw).match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i)
  if (!match) return null
  const owner = match[1]
  const repo = match[2].replace(/\.git$/i, '')
  if (!owner || !repo) return null
  return `${owner}/${repo}`
}

/**
 * The folder inside the repository that holds this package, when the registry
 * publishes one.
 *
 * Official `@deepseek-ai/*` packages all live in one monorepo, but each one
 * publishes `repository.directory` pointing at its own folder. That single
 * field turns the repository from "a README describing the whole product" into
 * "a README describing exactly this package" — the difference between evidence
 * and a fabrication with a citation attached. Without it, a monorepo package
 * has no honest README at all.
 */
function repoDirectoryOf(repository) {
  if (!repository || typeof repository !== 'object') return null
  const dir = typeof repository.directory === 'string' ? repository.directory.trim() : ''
  if (!dir) return null
  // The value comes from a package manifest, i.e. from whoever published the
  // package. It is only ever appended to a URL, but a `..` segment has no
  // legitimate meaning here and refusing it costs one comparison.
  if (dir.split('/').some((part) => part === '..')) return null
  return dir.replace(/^\/+|\/+$/g, '')
}

/**
 * Is this repository *this package*, or a monorepo that contains it?
 *
 * Official `@deepseek-ai/*` packages all point at `deepseek-ai/deepseek-harness`
 * — one repository for the whole product. Reading its README for
 * `dsh-plugin-manager` would describe the entire Harness and file the plugin
 * under whatever the README talks about most, which is a fabrication with a
 * citation attached. So a repository with no `directory` is trusted only when
 * its name contains the package's own name.
 */
function repoMatchesPackage(repo, name) {
  if (!repo) return false
  const base = String(name).split('/').pop().toLowerCase()
  if (!base) return false
  return String(repo).toLowerCase().includes(base)
}

async function fetchWithTimeout(url, get, timeoutMs, as) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const res = await get(url, {
      signal: controller ? controller.signal : undefined,
      headers: { 'user-agent': 'dsh-modpack', accept: as === 'text' ? 'text/plain,*/*' : 'application/json' },
    })
    // A 404 is an answer ("this package is not on npm"), not a failure, and the
    // difference decides whether the result may be cached. Anything else that is
    // not 2xx is treated as a failure and retried on the next preview.
    if (res && res.status === 404) return { status: 'missing', value: null }
    if (!res || !res.ok) return { status: 'failed', value: null }
    if (as === 'text') {
      const text = await res.text()
      return { status: 'ok', value: typeof text === 'string' ? text.slice(0, REMOTE_README_LIMIT) : null }
    }
    const value = await res.json()
    return { status: 'ok', value: value && typeof value === 'object' ? value : null }
  } catch {
    return { status: 'failed', value: null }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function tryJson(url, get, timeoutMs) {
  const result = await fetchWithTimeout(url, get, timeoutMs, 'json')
  return result
}

async function tryText(url, get, timeoutMs) {
  const result = await fetchWithTimeout(url, get, timeoutMs, 'text')
  return result.status === 'ok' && typeof result.value === 'string' && result.value.length > 0 ? result.value : null
}

async function tryReadme(repo, get, timeoutMs, directory) {
  // `HEAD` resolves the default branch on raw.githubusercontent.com, so one ref
  // covers `main` and `master` repos alike. Four names, then stop: a project
  // without a README at any of them is not going to have a fifth.
  //
  // `directory` scopes the read to one package inside a monorepo. It is not a
  // fallback after the root README: a package at `packages/x/y` must never be
  // described by the repository's own front page, so when a directory is known
  // the root is not tried at all.
  const base = directory ? `${repo}/HEAD/${directory}` : `${repo}/HEAD`
  for (const file of README_FILES) {
    const text = await tryText(`https://raw.githubusercontent.com/${base}/${file}`, get, timeoutMs)
    if (text) return text.slice(0, REMOTE_README_CHARS)
  }
  return ''
}

/**
 * Gather what the outside world says about one package.
 *
 * Staged on purpose: the npm registry answers for free, GitHub's API is rate
 * limited, and the README costs the most bytes. Each stage is only entered when
 * the previous one failed to produce a usable signal, so a package that already
 * declares `mcp` in its keywords never costs a GitHub call.
 *
 * `meta.status` separates "we asked and the answer is nothing" from "we could
 * not ask": only the first may be cached, or one dropped connection would
 * freeze a plugin as unclassifiable for a week.
 *
 * `meta.trail` records every stage that was actually reached, including the
 * ones that came back empty. The UI shows it, because "we searched GitHub and
 * found nothing" and "we never got that far" look identical in a category name
 * and mean very different things to the person reading the preview.
 */
async function lookupRemote(name, deps) {
  const d = deps || {}
  const get = typeof d.fetch === 'function' ? d.fetch : globalThis.fetch
  const timeoutMs = Number(d.timeoutMs) > 0 ? Number(d.timeoutMs) : REMOTE_TIMEOUT_MS
  const meta = {
    name, repo: null, directory: null, url: null, keywords: [], topics: [], description: null, readme: '',
    readmeScope: null, sources: [], trail: [], status: 'ok',
  }
  if (typeof get !== 'function') {
    meta.status = 'failed'
    return meta
  }

  const reg = await tryJson(`https://registry.npmjs.org/${encodePackageName(name)}/latest`, get, timeoutMs)
  meta.trail.push({ stage: 'registry', outcome: reg.status })
  if (reg.status === 'failed') {
    meta.status = 'failed'
    return meta
  }
  if (reg.status === 'missing') {
    // Not published to npm. GitHub search can still find it by name — plenty of
    // Harness plugins are installed straight from a git URL and never appear on
    // npm at all — so this is a dead end for the registry, not for the lookup.
    await searchGithubByName(meta, name, get, timeoutMs)
    return meta
  }
  const payload = reg.value
  if (!payload) {
    meta.status = 'failed'
    return meta
  }
  meta.keywords = Array.isArray(payload.keywords) ? payload.keywords.map((k) => String(k).toLowerCase()) : []
  meta.description = typeof payload.description === 'string' ? payload.description : null
  meta.repo = githubRepoOf(payload.repository)
  meta.directory = repoDirectoryOf(payload.repository)
  meta.sources.push('registry')
  if (!meta.repo) {
    await searchGithubByName(meta, name, get, timeoutMs)
    return meta
  }
  meta.url = `https://github.com/${meta.repo}`
  // A package inside a monorepo is a first-class citizen as long as the
  // registry said which folder it lives in: the README at that folder describes
  // this package and nothing else. Without the folder there is no honest way to
  // read the monorepo, so the registry description is all we keep.
  const scoped = Boolean(meta.directory)
  if (!scoped && !repoMatchesPackage(meta.repo, name)) {
    await searchGithubByName(meta, name, get, timeoutMs)
    return meta
  }
  // Do NOT classify here. `topics` outrank the registry's `keywords`, so
  // answering before the repository has been asked would let a weaker tier win
  // purely because it was cheaper to fetch. The repository metadata is one
  // request; the README below is the only fetch worth skipping.

  const gh = await tryJson(`https://api.github.com/repos/${meta.repo}`, get, timeoutMs)
  meta.trail.push({ stage: 'github', outcome: gh.status })
  if (gh.status === 'failed') {
    // Keep what the registry gave us, but do not let the miss be cached as if
    // the repository had nothing to say.
    meta.status = 'partial'
    return meta
  }
  const info = gh.value
  if (info) {
    // Repository topics describe the whole repository, so they are only this
    // package's topics when the repository *is* the package. For a monorepo
    // package they would hand it every topic the product has, which is the same
    // fabrication as reading the monorepo README.
    if (!meta.directory && Array.isArray(info.topics)) meta.topics = info.topics.map((t) => String(t).toLowerCase())
    if (!meta.description && typeof info.description === 'string') meta.description = info.description
    meta.sources.push('github')
  }
  if (classifyRemote(meta, d.locale)) return meta

  const readme = await tryReadme(meta.repo, get, timeoutMs, meta.directory)
  meta.trail.push({ stage: 'readme', outcome: readme ? 'ok' : 'missing' })
  if (readme) {
    meta.readme = readme
    meta.readmeScope = meta.directory ? 'package' : 'repo'
    meta.sources.push('readme')
  }
  return meta
}

/**
 * Last resort: find the repository by searching GitHub for the package name.
 *
 * Reached only when the registry has no repository for this package — an
 * unpublished plugin, or one published without a `repository` field. The result
 * is a *search hit*, not a declaration by the author, so it is accepted only
 * when the repository name matches the package name after normalising; a loose
 * search hit would file a plugin under a stranger's project.
 */
async function searchGithubByName(meta, name, get, timeoutMs) {
  const base = String(name).split('/').pop()
  if (!base || base.length < 4) return
  const query = encodeURIComponent(`"${base}" in:name`)
  const res = await tryJson(`https://api.github.com/search/repositories?q=${query}&per_page=5`, get, timeoutMs)
  meta.trail.push({ stage: 'github-search', outcome: res.status })
  if (res.status !== 'ok' || !res.value || !Array.isArray(res.value.items)) return
  const wanted = normaliseName(base)
  const hit = res.value.items.find((item) => {
    const full = typeof item.full_name === 'string' ? item.full_name : ''
    return normaliseName(full.split('/').pop() || '') === wanted
  })
  if (!hit) return
  meta.repo = hit.full_name
  meta.url = `https://github.com/${hit.full_name}`
  meta.sources.push('github-search')
  if (Array.isArray(hit.topics)) meta.topics = hit.topics.map((t) => String(t).toLowerCase())
  if (!meta.description && typeof hit.description === 'string') meta.description = hit.description
  const readme = await tryReadme(meta.repo, get, timeoutMs, null)
  meta.trail.push({ stage: 'readme', outcome: readme ? 'ok' : 'missing' })
  if (readme) {
    meta.readme = readme
    meta.readmeScope = 'repo'
    meta.sources.push('readme')
  }
}

/** `dsh-windows-mcp`, `dsh_windows_mcp` and `DSHWindowsMcp` are the same name. */
function normaliseName(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Classify from remote evidence, or return null.
 *
 * Three tiers, strongest first, and every rule in the table is tried within a
 * tier before moving to the next. That ordering is the honesty guarantee: a
 * repo's own `topics` always beat a sentence in its README, so a plugin can
 * never be filed by prose when its author had already said it plainly.
 *
 * `meta.topics` is only ever populated for a repository that *is* the package,
 * so a monorepo package never inherits the product's topics — it is judged on
 * its own folder's README instead, which is why `readme` sits above nothing and
 * below everything the package itself declared.
 */
function classifyRemote(meta, locale) {
  if (!meta || typeof meta !== 'object') return null
  const loc = locale === 'en' ? 'en' : 'zh'
  const topics = Array.isArray(meta.topics) ? meta.topics : []
  const keywords = Array.isArray(meta.keywords) ? meta.keywords : []
  const description = typeof meta.description === 'string' ? meta.description : ''
  // The lede only. A fetched README has the same install-instruction and
  // dev-note noise a local one does, so the same cut applies; see `readmeLede`.
  const readme = readmeLede(typeof meta.readme === 'string' ? meta.readme : '')

  const tiers = [
    { evidence: 'topics', hit: (sig) => topics.some((topic) => sig.tags.includes(topic)) },
    { evidence: 'keywords', hit: (sig) => keywords.some((word) => sig.tags.includes(word)) },
    { evidence: 'description', hit: (sig) => sig.hints.some((hint) => wordish(description, hint)) },
    { evidence: 'readme', hit: (sig) => sig.hints.some((hint) => wordish(readme, hint)) },
  ]

  for (const tier of tiers) {
    for (const rule of AUTO_RULES) {
      const signal = REMOTE_SIGNALS[rule.id]
      if (!signal) continue
      let matched = false
      try {
        matched = tier.hit(signal)
      } catch {
        matched = false
      }
      if (!matched) continue
      const repo = meta.repo || meta.name
      const label = (EVIDENCE_LABEL[tier.evidence] || EVIDENCE_LABEL.description)
      const why = signal.why
      // Naming the folder matters: for an official bundle the repository is
      // `deepseek-ai/deepseek-harness` for eight different plugins, so a reason
      // that stops at the repo name tells the reader nothing about which of
      // them the sentence came from.
      const where = meta.directory ? `${repo}/${meta.directory}` : repo
      return {
        ruleId: rule.id,
        name: rule.name,
        basis: 'remote',
        evidence: tier.evidence,
        source: meta.url || null,
        repo,
        directory: meta.directory || null,
        readmeScope: meta.readmeScope || null,
        // Same `{zh, en}` shape as the local rules: the caller picks a locale
        // off this object, and a bare string here silently produced `undefined`
        // reasons in both languages.
        why: {
          zh: `在 GitHub 仓库 ${where} 的${label.zh}里查到：${why.zh}`,
          en: `found in the ${label.en} of GitHub repo ${where}: ${why.en}`,
        },
      }
    }
  }
  return null
}

/** A verdict the local pass could not stand behind: a name guess, or nothing. */
function needsRemote(verdict) {
  return Boolean(verdict) && (verdict.basis === 'name' || verdict.basis === 'none')
}

/** Run `worker` over `items` with a fixed number of concurrent lanes. */
async function pool(items, limit, worker) {
  const queue = [...items]
  const lanes = Math.max(1, Math.min(Number(limit) || 1, queue.length || 1))
  const runners = []
  for (let i = 0; i < lanes; i++) {
    runners.push((async () => {
      for (;;) {
        const item = queue.shift()
        if (item === undefined) return
        try {
          await worker(item)
        } catch {
          /* one unreachable plugin must not abort the rest */
        }
      }
    })())
  }
  await Promise.all(runners)
}

/**
 * Look up every row the local pass could not classify confidently.
 *
 * Only those rows are sent anywhere — a plugin whose own keywords already
 * answered is never named to a third party, which keeps the privacy cost of
 * this feature proportional to how little the plugin says about itself.
 */
async function enrichRemote(rows, verdicts, opts) {
  const o = opts || {}
  const stats = { candidates: 0, looked: 0, found: 0, cached: 0, failed: 0, skipped: 0, unpublished: 0 }
  const byKey = new Map()
  const trails = new Map()
  // What the network actually said, kept beside the verdicts rather than
  // discarded with them. A row this pass looked at and could NOT file is
  // exactly the row the AI rung is handed next, and the evidence that failed to
  // match our keyword table is still the best description of the plugin anyone
  // has produced. Dropping it would make the model re-guess from the name.
  const evidence = new Map()
  const targets = rows.filter((row) => Boolean(row.name) && needsRemote(verdicts.get(row.key)))
  stats.candidates = targets.length
  if (targets.length === 0) return { byKey, stats, trails, evidence }

  const cache = readRemoteCache()
  const now = Date.now()
  const pending = []
  for (const row of targets) {
    const entry = cache[row.name]
    const ttl = entry && Number(entry.ttl) > 0 ? Number(entry.ttl) : REMOTE_TTL_MS
    if (entry && now - entry.at < ttl) {
      stats.cached++
      trails.set(row.key, { stages: (entry.meta && entry.meta.trail) || [], cached: true })
      if (entry.meta) evidence.set(row.key, entry.meta)
      const verdict = classifyRemote(entry.meta, o.locale)
      if (verdict) {
        byKey.set(row.key, verdict)
        stats.found++
      }
      continue
    }
    pending.push(row)
  }

  const slice = pending.slice(0, REMOTE_MAX_LOOKUPS)
  stats.skipped = pending.length - slice.length
  const startedAt = Date.now()
  const writes = {}

  await pool(slice, REMOTE_CONCURRENCY, async (row) => {
    if (Date.now() - startedAt > REMOTE_BUDGET_MS) {
      stats.skipped++
      return
    }
    stats.looked++
    const meta = await lookupRemote(row.name, { fetch: o.fetch, locale: o.locale })
    if (!meta || meta.status === 'failed') {
      // A failed request is not evidence. Retry it next time rather than
      // remembering the outage as "this plugin says nothing about itself".
      stats.failed++
      trails.set(row.key, { stages: (meta && meta.trail) || [], failed: true })
      return
    }
    trails.set(row.key, { stages: meta.trail || [], cached: false })
    evidence.set(row.key, meta)
    // `partial` is cached with a short leash: what the registry said is true,
    // but a GitHub miss may have been a rate limit.
    writes[row.name] = {
      at: Date.now(),
      ttl: meta.status === 'partial' ? PARTIAL_TTL_MS : REMOTE_TTL_MS,
      meta,
    }
    const verdict = classifyRemote(meta, o.locale)
    if (verdict) {
      byKey.set(row.key, verdict)
      stats.found++
    } else if (meta.status === 'unpublished') {
      stats.unpublished++
    }
  })

  if (Object.keys(writes).length > 0) {
    try {
      writeRemoteCache({ ...cache, ...writes })
    } catch {
      /* the cache is a convenience, never a requirement */
    }
  }
  return { byKey, stats, trails, evidence }
}

/* ------------------------------------------------------------------ */
/* code evidence + model judgement                                     */
/* ------------------------------------------------------------------ */

/**
 * The strongest evidence about a plugin is its own code, and until now the
 * classifier never opened it.
 *
 * This reads the package's declared entry file and pulls out three things, in
 * descending order of usefulness:
 *
 *   1. the leading block comment — the author describing the file in prose,
 *      before any implementation noise;
 *   2. the registering calls (`ctx.slots.register`, `webServer.register`, …) —
 *      what the plugin actually hooks into, which is what it *does*;
 *   3. its dependency and import specifiers — what it is built on.
 *
 * It is deliberately NOT fed to a hand-written keyword table. A table over code
 * would be exactly as brittle as the name table it would sit beside, and its
 * `why` text would be a guess dressed up as a reading. Code is evidence for
 * something that can reason over it, not for another regex.
 */
const CODE_FILE_MAX = 48 * 1024
const CODE_HEAD_MAX = 700
const CODE_SIGNAL_MAX = 12

/**
 * The directory a package's own files can be read from, or null.
 *
 * Tries the same roots as `readPackageMeta`, in the same order: the profile
 * first, then the runtime archive. Reading the manifest and reading the code
 * used to disagree about where a package lives, and the disagreement was
 * invisible — a row could be *filed* from its manifest description and then
 * still report no code and no role, which is what the panel showed as
 * "0 with source, 0 with a role description" on a machine full of official
 * bundles. One lookup, one answer.
 */
function packageDir(name) {
  const parts = String(name || '').split('/').filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null
  for (const root of packageMetaRoots()) {
    try {
      const dir = join(root, ...parts)
      if (existsSync(join(dir, 'package.json'))) return dir
    } catch {
      /* try the next root */
    }
  }
  return null
}

/** The file the package itself says it starts from. */
function entryFileOf(pkg, dir) {
  const candidates = []
  const fromExport = (value) => {
    if (typeof value === 'string') {
      candidates.push(value)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const key of ['import', 'module', 'default', 'require', 'node']) {
      if (value[key] !== undefined) fromExport(value[key])
    }
  }
  if (pkg && pkg.exports !== undefined) {
    const root = typeof pkg.exports === 'object' && pkg.exports !== null && pkg.exports['.'] !== undefined
      ? pkg.exports['.']
      : pkg.exports
    fromExport(root)
  }
  if (pkg && typeof pkg.main === 'string') candidates.push(pkg.main)
  candidates.push('index.js', 'index.mjs', 'index.cjs', 'dist/index.js', 'lib/index.js')
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.includes('..')) continue
    const file = join(dir, candidate)
    try {
      if (existsSync(file) && statSync(file).isFile()) return file
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/**
 * Everything the code says about itself, bounded hard.
 *
 * Bounded because this text ends up in a prompt: a 300 KB bundle would cost
 * more tokens than the classification is worth, and the discriminating parts —
 * the author's own summary and the list of things it registers — are at the
 * top of the file by convention.
 *
 * Returns null when there is no readable code at all. That is the normal case
 * for a *pure* official bundle whose entry lives inside the archive and cannot
 * be opened, but it is no longer the assumed case: `packageDir` looks in the
 * archive too, and every official package that ships plain `.js` next to its
 * manifest now yields a digest.
 */
function codeDigest(row) {
  if (!row || !row.name) return null
  const dir = packageDir(row.name)
  if (!dir) return null
  let pkg = null
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }

  const file = entryFileOf(pkg, dir)
  let source = ''
  if (file) {
    try {
      source = readFileSync(file, 'utf8').slice(0, CODE_FILE_MAX)
    } catch {
      source = ''
    }
  }

  const head = (source.match(/^\s*\/\*[\s\S]*?\*\//) || [''])[0]
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, CODE_HEAD_MAX)

  const signals = []
  const seen = new Set()
  for (const line of source.split('\n')) {
    if (signals.length >= CODE_SIGNAL_MAX) break
    if (!/\.\s*(register|inject)\s*\(/.test(line)) continue
    const text = line.trim().replace(/\s+/g, ' ').slice(0, 140)
    if (seen.has(text)) continue
    seen.add(text)
    signals.push(text)
  }

  // What the file actually pulls in, which catches a capability the manifest
  // never declared — a lazily imported `node:child_process`, say.
  const imports = [...new Set(
    (source.match(/(?:from|require\()\s*['"]([^'"]+)['"]/g) || [])
      .map((hit) => hit.replace(/^(?:from|require\()\s*['"]/, '').replace(/['"]$/, '')),
  )].slice(0, 16)

  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.peerDependencies || {}) })

  return {
    file: file ? file.slice(dir.length + 1) : null,
    head,
    signals,
    deps: deps.slice(0, 16),
    imports,
  }
}

/**
 * How a plugin sits inside the client it is installed in.
 *
 * The offline tiers answer "what domain is this about": they read the author's
 * own words and stop there. This is the other half of the question — "what does
 * it attach itself to" — and it is a fact about the installation rather than a
 * guess. The manifest says whether the package ships a browser half, a Node
 * half or both, and whether it is a patch layer that rewrites the host's own
 * composition; the entry file says which slot it mounts into and which
 * capabilities it reaches for.
 *
 * Deliberately structural, never semantic. It reports `slot=settings.section`,
 * not "this is a settings page": naming the mount point is evidence, naming its
 * meaning is exactly the judgement the model is being asked to make. Two
 * packages both called `dsh-session-archive` — one mounting a `sidebar.footer`
 * slot and reading `node:fs`, the other registering two tools with no UI at all
 * — are telling completely different stories, and only the structural facts can
 * tell them apart.
 *
 * Returns null when the manifest is unreadable. The entry file is a different
 * matter: a package that ships only a `dist/` bundle with no resolvable entry
 * still reports its halves and its patch layer, and `learned` below decides
 * whether that is enough to say anything at all.
 */
function roleFacts(row, digest) {
  if (!row || !row.name) return null
  const dir = packageDir(row.name)
  if (!dir) return null
  let pkg = null
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const dsh = pkg && pkg.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : {}
  const clientCfg = dsh.client && typeof dsh.client === 'object' ? dsh.client : null
  const bundleCfg = dsh.bundle && typeof dsh.bundle === 'object' ? dsh.bundle : null

  // A browser half can be declared in `dsh.client` or exported as `./client`;
  // both are the same promise to the runtime, and different packages use one or
  // the other, so neither alone is enough.
  const exportsClient = Boolean(
    pkg && pkg.exports && typeof pkg.exports === 'object' &&
    (pkg.exports['./client'] !== undefined || pkg.exports['./client.js'] !== undefined),
  )
  const clientHalf = Boolean(clientCfg) || exportsClient
  // `entryFileOf` falls back to index.js and friends, which is right here: the
  // question is whether there is a module the host can load, not whether the
  // author remembered to declare `main`.
  const hostHalf = Boolean(entryFileOf(pkg, dir))
  const halves = clientHalf && hostHalf ? 'client+host' : clientHalf ? 'client' : hostHalf ? 'host' : 'unknown'

  const signals = digest && Array.isArray(digest.signals) ? digest.signals : []
  const joined = signals.join('\n')
  const slots = []
  const slotRe = /slots\s*\.\s*register\s*\(\s*['"]([^'"]+)['"]/g
  let hit = null
  while ((hit = slotRe.exec(joined))) {
    if (!slots.includes(hit[1])) slots.push(hit[1])
    if (slots.length >= 4) break
  }

  const imports = digest && Array.isArray(digest.imports) ? digest.imports : []
  const hay = `${joined}\n${imports.join('\n')}`
  const surfaces = []
  // What the code actually reaches for, as opposed to what the description says
  // it is for. Ordered so a UI plugin that also reads a file still leads with
  // `ui`, which is the fact that decides its category.
  const SURFACES = [
    ['ui', /slots\s*\.\s*register|\bdocument\.|createElement|\.css\b/],
    ['tools', /tools\s*\.\s*(register|define)|\.tools\s*\./],
    ['http', /webServer\s*\.\s*register|\bfetch\s*\(|node:https?/],
    ['files', /node:fs|readFileSync|writeFileSync|readdirSync/],
    ['process', /child_process|spawn\s*\(|execFile/],
    ['llm', /\bllm\s*\.|prepareCall/],
    ['agent', /\bagent\w*\s*\.|\bsubagent\b/i],
    ['terminal', /\bpty\b|\bterminal\b/i],
  ]
  for (const [id, re] of SURFACES) {
    if (re.test(hay)) surfaces.push(id)
  }

  // A line reading `halves=unknown; patch=no; slot=-; touches=-` is not
  // evidence, it is the absence of evidence wearing the costume of a fact. The
  // prompt has already told the model the field exists, so the honest encoding
  // of "we learned nothing" is to attach no line at all — an absent line reads
  // as unknown, while `touches=-` reads as "it touches nothing", which is a
  // claim nobody made.
  const learned = halves !== 'unknown' || slots.length > 0 || surfaces.length > 0
  if (!learned) return null

  return {
    halves,
    patch: Boolean(bundleCfg && bundleCfg.patch),
    slots: slots.slice(0, 4),
    surfaces: surfaces.slice(0, 6),
  }
}

/** One compact line, so the prompt stays scannable at the row cap. */
function roleLine(role) {
  if (!role) return null
  return `halves=${role.halves}; patch=${role.patch ? 'yes' : 'no'}; ` +
    `slot=${role.slots.length ? role.slots.join(',') : '-'}; ` +
    `touches=${role.surfaces.length ? role.surfaces.join(',') : '-'}`
}

const AI_MAX_ROWS = 30
const AI_MAX_TOKENS = 1800
const AI_TIMEOUT_MS = 90 * 1000

/**
 * Does this digest actually carry code, or is it an empty shell?
 *
 * `codeDigest` returns an object whenever the package manifest was readable —
 * even when no entry file could be found — so testing the object for truthiness
 * counts a package with no source at all as "source was read", and the panel
 * then reports "N of them included source excerpts" to the user. Only the three
 * fields that come from reading the file count. `deps` is deliberately excluded:
 * it is manifest data, not source, and every package has it.
 */
function digestHasCode(digest) {
  if (!digest) return false
  return Boolean(digest.head) || digest.signals.length > 0 || digest.imports.length > 0
}

/**
 * The vocabulary the model may choose from.
 *
 * `local` is withheld: it means "installed from a folder on this machine",
 * which is a fact about an installation, not a judgement about what a plugin
 * does — and every row that could reach this pass has already been excluded
 * from it by the fact tier anyway. Offering it would only invite the model to
 * invent a reason for a category that cannot apply.
 */
const RULE_BY_ID = new Map(AUTO_RULES.map((rule) => [rule.id, rule]))
const AI_RULES = AUTO_RULES.filter((rule) => rule.id !== 'local')

function ruleLabel(rule, locale) {
  return (rule.name && (rule.name[locale] || rule.name.zh)) || rule.id
}

function ruleWhy(rule, locale) {
  return (rule.why && (rule.why[locale] || rule.why.zh)) || ''
}

function clip(text, max) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * Which provider and model to ask.
 *
 * The session's own default model is preferred, because that is the one the
 * user already configured and already pays for; anything else would spend
 * quota on a provider they may not have chosen. Discovery is only the
 * fallback, and it is allowed to fail — an unavailable model must degrade to
 * "the offline answer stands", never to a broken preview.
 */
async function resolveCallTarget(ctx, llm) {
  const str = (value) => (typeof value === 'string' && value ? value : null)
  try {
    const service = serviceOf(ctx, 'agentDefaultModel')
    if (service && typeof service.currentSelection === 'function') {
      const selection = service.currentSelection()
      const provider = str(selection && selection.provider)
      const model = str(selection && selection.model)
      if (provider && model) return { provider, model }
    }
  } catch {
    /* fall through to discovery */
  }
  try {
    const providers = await llm.listProviders()
    for (const entry of Array.isArray(providers) ? providers : []) {
      const id = str(entry && entry.id)
      if (!id) continue
      const models = await llm.listModels(id)
      const first = (Array.isArray(models) ? models : []).find((model) => str(model && model.id))
      if (first) return { provider: id, model: first.id }
    }
  } catch {
    /* no reachable model */
  }
  return null
}

/**
 * One non-streaming completion, collected from the stream.
 *
 * Two host behaviours dictate the shape of this function, and getting either
 * one wrong makes every AI run fail:
 *
 * 1. The cancellation signal must NOT be a field of the config handed to
 *    `prepareCall`. The host deep-copies that config before returning it
 *    (`deepFreeze(structuredClone(resolved.config))`), and a `structuredClone`
 *    of an `AbortSignal` is a plain object with no prototype: it still looks
 *    like a signal from a distance, but the adapter's own
 *    `AbortSignal.any([options.signal, ...])` rejects it with
 *    `signals[0] is not of type AbortSignal.` — which is exactly how every AI
 *    run used to die. The signal therefore travels as `prepareCall`'s second
 *    argument, and is re-attached to the dispatch options afterwards, where it
 *    is still the live object.
 * 2. The prepared config must be handed back to `stream()` rather than the
 *    object we asked with: `prepareCall` materialises adapter-configured
 *    defaults into it and then compares the caller's config against it field
 *    by field, so streaming a different object is precisely how
 *    `INVALID_PREPARED_CALL` happens.
 *
 * `callConfigEquals` ignores both `messages` and `signal`, so re-attaching the
 * live signal to the resolved config cannot trip the prepared-call check.
 */
async function callModel(llm, target, prompt, signal) {
  const base = {
    provider: target.provider,
    model: target.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: AI_MAX_TOKENS,
    temperature: 0,
  }
  const prepared = await llm.prepareCall(base, signal)
  // `{...base, ...prepared.config}` rather than `prepared.config` alone: a
  // service is allowed to return a config that only names the route (the
  // adapter-default fields), and the prompt would then vanish from the request.
  const resolved = prepared && prepared.config ? { ...base, ...prepared.config } : base
  // Belt and braces: if a service echoes the signal into the config we sent it
  // — or into the config it hands back — the copy is a clone and must not be
  // used. Delete first, then attach the one live object we own.
  const options = { ...resolved }
  delete options.signal
  if (signal !== undefined) options.signal = signal

  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let failure = null
  for await (const chunk of prepared.stream(options)) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
    } else if (chunk.type === 'usage' && chunk.usage) {
      inputTokens += Number(chunk.usage.inputTokens || chunk.usage.input || 0) || 0
      outputTokens += Number(chunk.usage.outputTokens || chunk.usage.output || 0) || 0
    } else if (chunk.type === 'finish' && chunk.reason) {
      const kind = chunk.reason.kind
      if (kind === 'error' || kind === 'aborted') {
        const detail = chunk.reason.failure
        failure = (detail && (detail.message || detail.code)) || kind
      }
    }
  }
  return { text, inputTokens, outputTokens, failure }
}

/**
 * The prompt.
 *
 * Written as a closed-vocabulary choice on purpose: the model picks from the
 * ids the offline pass already uses, so an AI-filed plugin lands in the same
 * category a tag-filed one would, and re-running never forks "MCP 与外部工具"
 * into a second, near-identical bucket. The evidence for each plugin is
 * labelled so the model can weigh a declared keyword above a prose sentence,
 * exactly as the deterministic tiers do.
 */
function buildAiPrompt(entries, locale, opts) {
  const o = opts || {}
  const zh = locale !== 'en'
  // Only ask for role reasoning when role facts are actually attached. Asking a
  // model to "reason about what it attaches to" while sending it no attachment
  // data is an invitation to invent one, and the invented one is unfalsifiable.
  const anyRole = o.reason === true && entries.some((entry) => entry.role)
  const lines = []
  lines.push(zh
    ? '你在为一个插件化的智能体宿主（DeepSeek Harness）里已安装的插件归类。'
    : 'You are filing installed plugins of DeepSeek Harness, a plugin-based agent harness.')
  lines.push('')
  lines.push(zh ? '可用分类（只能选下面列出的 id，不要发明新的）：' : 'Available categories (pick only from these ids, invent none):')
  for (const rule of AI_RULES) {
    lines.push(`- ${rule.id}: ${ruleLabel(rule, locale)} — ${ruleWhy(rule, locale)}`)
  }
  lines.push('')
  // The field list is generated from what is actually attached. Naming the
  // code fields in a run that carries no code would tell the model to expect
  // evidence that never arrives, and it would be right to read that absence as
  // a fact about the plugin rather than a fact about this request.
  const anyCode = entries.some((entry) => entry.digest && digestHasCode(entry.digest))
  // Same rule as the code fields: name a field only when it is actually
  // attached, or the model reads its absence as a fact about the plugin.
  const anyRemote = entries.some((entry) => entry.remote && (entry.remote.description || entry.remote.readme || (Array.isArray(entry.remote.topics) && entry.remote.topics.length > 0)))
  const remoteNote = anyRemote
    ? (zh
        ? '有些插件还带 remote-* 字段，那是刚从 npm / GitHub 查到的公开资料（仓库话题、仓库简介、仓库 README 开头），出处写在 remote-source 里。'
        : 'Some plugins carry remote-* fields: public material just retrieved from npm / GitHub (repository topics, repository description, the opening of the repository README), with its origin named in remote-source.')
    : ''
  lines.push(anyCode
    ? (zh
        ? `下面每个插件给出：包名、包自述描述、作者声明的关键词、README 开头，以及入口代码摘录（code-summary 是文件头注释，code-registers 是它实际注册的东西，code-deps 是它的依赖）。${remoteNote}`
        : `Each plugin below lists: package name, its own description, the keywords its author declared, the opening of its README, and excerpts of its entry code (code-summary is the file header comment, code-registers is what it actually hooks into, code-deps is what it depends on). ${remoteNote}`)
    : (zh
        ? `下面每个插件给出：包名、包自述描述、作者声明的关键词，以及 README 开头。没有给出入口代码，所以不要根据「没看到代码」推断它做什么。${remoteNote}`
        : `Each plugin below lists: package name, its own description, the keywords its author declared, and the opening of its README. No entry code is included, so do not infer anything from its absence. ${remoteNote}`))
  lines.push(anyCode
    ? (zh
        ? '请为每个插件挑一个最合适的分类。判断依据的优先级：作者关键词 > 代码实际注册的东西 > 包描述 > README > 包名。'
        : 'Choose the single best category for each. Weigh the evidence in this order: declared keywords > what the code actually registers > package description > README > package name.')
    : (zh
        ? '请为每个插件挑一个最合适的分类。判断依据的优先级：作者关键词 > 包描述 > README > 包名。'
        : 'Choose the single best category for each. Weigh the evidence in this order: declared keywords > package description > README > package name.'))
  if (anyRole) {
    // The extra rung. It does not change the vocabulary or the honesty rules —
    // it changes what the model is asked to do *before* it picks, because a
    // plugin's name and its mount point together say more than either alone.
    lines.push('')
    lines.push(zh
      ? '每个插件还带一行 relationship，说明它装进这个宿主之后实际接在哪儿：'
      : 'Each plugin also carries a relationship line describing where it actually attaches inside this host:')
    lines.push(zh
      ? '- halves：它有几个半边。client 是浏览器里跑的那半（画界面），host 是 Node 里跑的那半（干活）。client+host 表示两半都有。'
      : '- halves: which halves it ships. client runs in the browser (draws UI), host runs in Node (does the work). client+host means both.')
    lines.push(zh
      ? '- patch：yes 表示它是补丁层，会改写宿主自己的装配，而不是新增一个独立功能。'
      : '- patch: yes means it is a patch layer that rewrites the host\'s own composition rather than adding a standalone feature.')
    lines.push(zh
      ? '- slot：它往界面的哪个插槽挂载（- 表示不画界面）。'
      : '- slot: which UI slot it mounts into (- means it draws nothing).')
    lines.push(zh
      ? '- touches：它实际伸手去够的能力（ui/tools/http/files/process/llm/agent/terminal）。'
      : '- touches: the capabilities it actually reaches for (ui/tools/http/files/process/llm/agent/terminal).')
    lines.push('')
    lines.push(zh
      ? '请按这个顺序想，再给答案：先看名字猜它大概是干什么的，再用 relationship 检验这个猜测——如果名字说的是 A，但它挂的是界面插槽、够的是 files，那它多半是 A 的展示层或编辑器，而不是 A 本身；如果它 patch=yes 且不画界面，它多半是给已有功能打补丁，而不是自己提供功能。想清楚之后再选分类。'
      : 'Think in this order, then answer: first guess from the name what it is for, then test that guess against relationship — if the name says A but it mounts a UI slot and reaches for files, it is more likely A\'s viewer or editor than A itself; if patch=yes and it draws nothing, it is more likely patching an existing feature than providing one. Only then pick the category.')
    lines.push(zh
      ? '把这段推理写进 why 里：先说它在这个宿主里扮演什么角色，再说为什么落到这个分类。'
      : 'Put that reasoning in why: first say what role it plays in this host, then why that lands it in this category.')
  }
  lines.push(zh
    ? '只输出一个 JSON 数组，不要解释文字，不要代码围栏。格式：'
    : 'Output ONLY a JSON array, no prose, no code fence. Format:')
  lines.push('[{"key":"<key>","category":"<id>","why":"<一句话理由，用中文>"}]')
  lines.push('')
  lines.push(zh ? '插件：' : 'Plugins:')
  for (const entry of entries) {
    lines.push(`--- key: ${entry.key}`)
    lines.push(`name: ${entry.name}`)
    const meta = entry.meta
    if (meta && meta.description) lines.push(`description: ${clip(meta.description, 300)}`)
    if (meta && Array.isArray(meta.keywords) && meta.keywords.length > 0) {
      lines.push(`keywords: ${meta.keywords.slice(0, 12).join(', ')}`)
    }
    const lede = meta ? readmeLede(meta.readme) : ''
    if (lede) lines.push(`readme: ${clip(lede, 400)}`)
    // Remote findings are labelled with where they came from, for the same
    // reason the deterministic tiers name their source: a sentence from the
    // package's own repository README and one from a search hit are not
    // equally good evidence, and the model is told which it is holding.
    const remote = entry.remote
    if (remote) {
      if (remote.repo) {
        const scope = remote.readmeScope === 'directory' && remote.readmeDir ? `${remote.repo}/${remote.readmeDir}` : remote.repo
        lines.push(`remote-source: ${scope}${remote.url ? ` (${remote.url})` : ''}`)
      }
      if (Array.isArray(remote.topics) && remote.topics.length > 0) {
        lines.push(`remote-topics: ${remote.topics.slice(0, 15).join(', ')}`)
      }
      if (remote.description && remote.description !== (meta && meta.description)) {
        lines.push(`remote-description: ${clip(remote.description, 300)}`)
      }
      const remoteLede = readmeLede(remote.readme)
      if (remoteLede && !lede) lines.push(`remote-readme: ${clip(remoteLede, 400)}`)
    }
    const digest = entry.digest
    if (digest) {
      if (digest.file) lines.push(`code-file: ${digest.file}`)
      if (digest.head) lines.push(`code-summary: ${clip(digest.head, 400)}`)
      if (digest.deps.length > 0) lines.push(`code-deps: ${digest.deps.join(', ')}`)
      if (digest.imports.length > 0) lines.push(`code-imports: ${digest.imports.join(', ')}`)
      if (digest.signals.length > 0) {
        lines.push('code-registers:')
        for (const signal of digest.signals) lines.push(`  ${clip(signal, 140)}`)
      }
    }
    // Attached only when the caller asked for the reasoning rung. A row whose
    // manifest was unreadable simply carries no line, and the prompt has already
    // said the field exists — so an absent line reads as "unknown", which is
    // what it is.
    if (o.reason === true && entry.role) {
      const line = roleLine(entry.role)
      if (line) lines.push(`relationship: ${line}`)
    }
  }
  return lines.join('\n')
}

/**
 * Read the model's answer, tolerating the two things models do anyway.
 *
 * Even with "no code fence" in the prompt, a fenced block is common, so the
 * fence is stripped rather than treated as a protocol violation. Everything
 * else is tolerated by slicing from the first `[` to the last `]` — but the
 * *contents* are validated strictly: an unknown key or an id that is not one of
 * ours is dropped, not coerced. A model that answers about a plugin we never
 * asked about must not be able to write into the tree.
 */
function parseAiVerdicts(text, allowedKeys) {
  const body = String(text || '').replace(/```[a-zA-Z]*/g, '').trim()
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let parsed = null
  try {
    parsed = JSON.parse(body.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const key = typeof item.key === 'string' ? item.key : null
    const category = typeof item.category === 'string' ? item.category : null
    if (!key || !category || !allowedKeys.has(key) || !RULE_BY_ID.has(category)) continue
    out.push({ key, category, why: clip(item.why, 220) })
  }
  return out
}

/**
 * Ask the configured model to file the plugins the offline passes could not.
 *
 * Only ever called when the user ticked the box: this is the one path in the
 * plugin that spends money, so it must be a deliberate choice and its cost must
 * be reported back rather than swallowed. Everything about it degrades to "the
 * offline answer stands" — a missing service, no configured model, a network
 * failure, an unparseable answer. None of those may break the preview.
 */
async function aiClassify(ctx, rows, verdicts, opts) {
  const o = opts || {}
  const stats = {
    available: false,
    provider: null,
    model: null,
    reason: null,
    candidates: 0,
    asked: 0,
    found: 0,
    failed: 0,
    withCode: 0,
    withRole: 0,
    reasoned: false,
    inputTokens: null,
    outputTokens: null,
  }
  const byKey = new Map()

  const llm = serviceOf(ctx, 'llm')
  if (!llm || typeof llm.prepareCall !== 'function') {
    stats.reason = 'llm-unavailable'
    return { byKey, stats }
  }
  stats.available = true

  const targets = rows.filter((row) => Boolean(row.name) && needsRemote(verdicts.get(row.key)))
  stats.candidates = targets.length
  if (targets.length === 0) return { byKey, stats }

  const slice = targets.slice(0, AI_MAX_ROWS)
  const target = await resolveCallTarget(ctx, llm)
  if (!target) {
    stats.reason = 'no-model'
    return { byKey, stats }
  }
  stats.provider = target.provider
  stats.model = target.model

  const entries = []
  for (const row of slice) {
    // The online rung's findings ride along when there are any. They stopped
    // being the *only* description of an official bundle on this machine once
    // `readPackageMeta` learned to reach the runtime archive, but a repository
    // topic or GitHub description is still evidence the local file does not
    // carry — and a row only reaches this loop after every local rung declined
    // to answer it.
    const remote = o.remoteEvidence instanceof Map ? o.remoteEvidence.get(row.key) : null
    const entry = { key: row.key, name: row.name, meta: readPackageMeta(row.name), digest: null, role: null, remote: remote || null }
    if (o.source === true) {
      entry.digest = codeDigest(row)
      if (digestHasCode(entry.digest)) stats.withCode++
    }
    // The role rung is built from the digest, so it rides on the same tick that
    // already reads the entry file. `source` is what the UI forces on when this
    // rung is chosen; the host checks the flag rather than trusting that.
    if (o.reason === true) {
      entry.role = roleFacts(row, entry.digest)
      if (entry.role) stats.withRole++
    }
    entries.push(entry)
  }
  stats.asked = entries.length
  // Reported as "did the prompt actually carry a relationship line for anyone",
  // not as "was the box ticked": the panel says "N of them came with a role
  // description", and that sentence has to be true about the bytes sent.
  stats.reasoned = o.reason === true && stats.withRole > 0

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  let answer = null
  try {
    answer = await callModel(llm, target, buildAiPrompt(entries, o.locale, { reason: o.reason === true }), controller.signal)
  } catch (err) {
    stats.failed = entries.length
    stats.reason = clip((err && err.message) || String(err), 200)
    return { byKey, stats }
  } finally {
    clearTimeout(timer)
  }

  stats.inputTokens = answer.inputTokens || null
  stats.outputTokens = answer.outputTokens || null
  if (answer.failure) {
    stats.failed = entries.length
    stats.reason = clip(answer.failure, 200)
    return { byKey, stats }
  }

  const allowed = new Set(entries.map((entry) => entry.key))
  // The evidence sentence has to describe what this run actually sent. Naming
  // "source" in a run that shipped no code, or staying silent about the role
  // facts in a run that shipped them, would misdescribe the same request in
  // opposite directions.
  const bitsZh = []
  const bitsEn = []
  if (o.source === true) { bitsZh.push('源码'); bitsEn.push('source') }
  if (stats.reasoned) { bitsZh.push('它与宿主的作用关系'); bitsEn.push('how it attaches to the host') }
  const evidenceText = bitsZh.length ? `、${bitsZh.join('、')}` : ''
  const evidenceEn = bitsEn.length ? ` and ${bitsEn.join(' and ')}` : ''
  for (const verdict of parseAiVerdicts(answer.text, allowed)) {
    // Redundant with the parser's own `RULE_BY_ID.has(category)` check, and
    // deliberately kept: the parser is documented as self-contained, so this
    // guard is what still holds if that check is ever relaxed. Being redundant
    // means neither one alone can be killed by a mutation test — they are
    // mutated together in `scripts/_mutate-ai.mjs`.
    const rule = RULE_BY_ID.get(verdict.category)
    if (!rule) continue
    byKey.set(verdict.key, {
      ruleId: rule.id,
      name: rule.name,
      basis: 'ai',
      evidence: 'ai',
      why: {
        zh: `由模型 ${stats.provider}/${stats.model} 综合包名、描述${evidenceText}判断：${verdict.why || ruleWhy(rule, o.locale)}`,
        en: `judged by ${stats.provider}/${stats.model} from the name, description${evidenceEn}: ${verdict.why || ruleWhy(rule, 'en')}`,
      },
    })
  }
  // A model that answered about only some plugins is not a failure; the rest
  // simply keep whatever the offline passes decided. Saying "found N of M" is
  // the honest version of that.
  stats.found = byKey.size
  return { byKey, stats }
}

/**
 * Propose a category tree for the current inventory. Pure: reads, changes
 * nothing. The caller previews it, then saves through the ordinary
 * `/categories/save` route — so there is exactly one write path and one
 * validator, and a proposal the user rejects leaves the stored tree untouched.
 *
 * Existing categories are reused by name rather than duplicated, and existing
 * manual assignments are kept unless `overwrite` is set. Auto-sorting must
 * never quietly undo work the user did by hand.
 */
function suggestCategories(rows, existing, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const overwrite = opts.overwrite === true
  const locale = opts.locale === 'en' ? 'en' : 'zh'
  // Remote verdicts are handed in rather than fetched here: this function stays
  // pure and synchronous, so the preview cannot block on the network and a
  // failed lookup simply leaves the local verdict in place.
  const remote = opts.remoteVerdicts instanceof Map ? opts.remoteVerdicts : new Map()
  // What the network was asked and what it answered, per row. Handed in for the
  // same reason the verdicts are: this function must stay pure and synchronous.
  const trails = opts.remoteTrails instanceof Map ? opts.remoteTrails : new Map()
  const base = sanitizeCategories(existing)

  const nodes = base.nodes.map((node) => ({ ...node }))
  const assignments = { ...base.assignments }
  const byName = new Map(nodes.map((node) => [node.name, node]))

  const added = []
  const kept = []
  const categories = new Map()
  let overwrote = 0

  for (const row of rows) {
    const already = assignments[row.key]
    if (already && !overwrite) {
      kept.push({ key: row.key, name: row.title || row.name || row.moduleName, categoryId: already })
      continue
    }
    if (already && overwrite) overwrote++
    const local = classifyRow(row)
    // Everything the machine can answer without a network call: keywords, the
    // package's own description, its README. Only a verdict the author's own
    // words could not settle gets a second reading.
    const localFinal = localVerdict(row)
    // `enrichRemote` only ever returns verdicts for rows the local pass was
    // unsure about — it filters by `needsRemote` before a name is sent anywhere,
    // which is also what keeps confident plugins private. So a remote verdict
    // cannot displace a keyword answer here: there is no such entry to displace
    // it with. That invariant lives upstream and is asserted there.
    const verdict = remote.has(row.key) ? remote.get(row.key) : localFinal
    const label = verdict.name[locale] || verdict.name.zh
    let node = byName.get(label)
    if (!node) {
      node = { id: `auto-${verdict.ruleId}`, name: label, parentId: null, order: nodes.length }
      // `auto-<rule>` is stable, so re-running does not churn ids. If the user
      // already made a category with that id but another name, keep theirs.
      if (nodes.some((n) => n.id === node.id)) node.id = `${node.id}-${nodes.length}`
      nodes.push(node)
      byName.set(label, node)
    }
    assignments[row.key] = node.id
    categories.set(node.id, (categories.get(node.id) || 0) + 1)
    added.push({
      key: row.key,
      name: row.title || row.name || row.moduleName,
      categoryId: node.id,
      categoryName: label,
      reason: verdict.why[locale] || verdict.why.zh,
      basis: verdict.basis,
      evidence: verdict.evidence || null,
      source: verdict.source || null,
      // Only present for rows the network was actually asked about. A row the
      // local pass answered confidently has no trail, and must not be shown as
      // if a lookup had been attempted and failed.
      trail: trails.get(row.key) || null,
      localBasis: local.basis,
    })
  }

  const doc = sanitizeCategories({ nodes, assignments })
  return {
    doc,
    added,
    kept,
    categories: [...categories.entries()].map(([id, count]) => ({ id, name: (doc.nodes.find((n) => n.id === id) || {}).name || id, count })),
    summary: {
      total: rows.length,
      assigned: added.length,
      kept: kept.length,
      overwrote,
      fromTags: added.filter((item) => item.basis === 'tags').length,
      // The author's own one-line description, read from the package on this
      // machine. Counted separately from `fromTags` because it is prose rather
      // than a declared keyword — and separately from `fromRemote` because
      // nothing left the machine to get it.
      fromDesc: added.filter((item) => item.basis === 'desc').length,
      // The README shipped inside the package. Counted for the same reason as
      // `fromDesc` — it is the author's own prose read off this machine — but
      // tracked apart from it, because a README is a whole document while a
      // description is the one sentence the author wrote to summarise the
      // package. Leaving this bucket out entirely (as an earlier version did)
      // meant those rows appeared in `assigned` but in none of the tier counts,
      // so the panel silently under-reported how many rows it had justified.
      fromReadme: added.filter((item) => item.basis === 'readme').length,
      fromName: added.filter((item) => item.basis === 'name').length,
      fromFact: added.filter((item) => item.basis === 'fact').length,
      // Kept apart from `fromTags` on purpose: both are evidence, but one is the
      // author's package metadata and the other is a third-party page we read
      // over the network. Collapsing them would hide how much of the tree rests
      // on an external lookup.
      fromRemote: added.filter((item) => item.basis === 'remote').length,
      // Kept apart from every other tier for the same reason: this one was
      // decided by a model, and a user reading "9 categories" is entitled to
      // know how many of them a language model chose rather than a fact did.
      fromAi: added.filter((item) => item.basis === 'ai').length,
      // Counted separately so the panel can say "N filed under Other" instead of
      // letting those rows quietly inflate the "guessed from name" number.
      unclassified: added.filter((item) => item.basis === 'none').length,
      newCategories: [...new Set(added.map((item) => item.categoryId))].length,
    },
  }
}

/** "父 / 子 / 孙" for one category id — the path the user sees in the tree. */
function categoryLabel(doc, id) {
  const nodes = Array.isArray(doc && doc.nodes) ? doc.nodes : []
  if (!id || nodes.length === 0) return null
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parts = []
  let node = byId.get(id)
  let guard = 0
  while (node && guard++ <= nodes.length) {
    parts.unshift(node.name)
    node = node.parentId ? byId.get(node.parentId) : null
  }
  return parts.length ? parts.join(' / ') : null
}

/* ------------------------------------------------------------------ */
/* plan + apply                                                        */
/* ------------------------------------------------------------------ */

/**
 * Diff a modpack against the live profile. Pure: reads state, changes nothing.
 * Every entry lands in exactly one bucket so the UI can show a truthful
 * preview before the user commits to running pnpm.
 */
async function planModpack(ctx, doc, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const allowLocal = opts.allowLocal === true
  const pm = manager(ctx)
  if (!pm) return { ok: false, error: 'pluginManager 服务不可用，无法安装' }

  let bundles = []
  let plugins = []
  try {
    bundles = await pm.listBundles()
  } catch { /* treated as empty */ }
  if (typeof pm.listPlugins === 'function') {
    try {
      plugins = await pm.listPlugins()
    } catch { /* treated as empty */ }
  }

  const bundleByName = new Map(bundles.map((b) => [b.name, b]))
  const pluginByModule = new Map()
  for (const p of plugins) {
    if (!pluginByModule.has(p.moduleName)) pluginByModule.set(p.moduleName, [])
    pluginByModule.get(p.moduleName).push(p)
  }

  const actions = []
  for (const raw of doc.plugins) {
    const entry = normalizeEntry(raw)
    if (!entry) {
      actions.push({ type: 'invalid', label: JSON.stringify(raw).slice(0, 120) })
      continue
    }
    const label = entry.title || entry.name || entry.moduleName

    if (entry.kind === 'bundle') {
      const spec = resolvableSpec(entry.name, entry.override || entry.spec || entry.name)
      const current = bundleByName.get(entry.name)
      if (current) {
        const currentEnabled = current.enabled !== false
        if (currentEnabled !== entry.enabled) {
          actions.push({
            type: 'toggle', kind: 'bundle', label, name: entry.name,
            from: currentEnabled, to: entry.enabled,
            note: '已安装，仅调整启用状态',
          })
        } else {
          actions.push({ type: 'skip', kind: 'bundle', label, name: entry.name, note: '已安装且状态一致' })
        }
        continue
      }
      const local = isLocalSpec(spec)
      if (local && !allowLocal) {
        actions.push({
          type: 'blocked', kind: 'bundle', label, name: entry.name, spec,
          note: '来自本机路径，在这台电脑上无法解析；请在整合包里为它填写 registry 或 git 地址',
        })
        continue
      }
      // A pack records both the author's spec and the exact version they ran.
      // Pinning is opt-in: a range stays resilient, a pin reproduces the
      // author's setup. Only plain registry ranges can be pinned safely.
      const pinnable = Boolean(opts.pinVersions) && !local && specVersion(spec) && isExactVersion(entry.version)
      const installSpec = pinnable ? `${entry.name}@${entry.version}` : spec
      actions.push({
        type: 'install', kind: 'bundle', label, name: entry.name, spec: installSpec,
        to: entry.enabled, local, pinned: pinnable,
        note: pinnable
          ? `将锁定版本安装 ${entry.version}`
          : entry.version ? `将安装 ${entry.version}（按 ${spec} 解析）` : `将安装（按 ${spec} 解析）`,
      })
      continue
    }

    const holders = pluginByModule.get(entry.moduleName) || []
    if (holders.length === 0) {
      actions.push({
        type: 'blocked', kind: 'plugin', label, moduleName: entry.moduleName,
        note: '本机没有这个插件的载体包，请先在整合包里勾选它所属的 bundle',
      })
      continue
    }
    for (const holder of holders) {
      if (holder.readOnlyReason) {
        actions.push({
          type: 'blocked', kind: 'plugin', label, moduleName: entry.moduleName, entryId: String(holder.entryId),
          note: `该条目不可通过配置修改（${holder.readOnlyReason}）`,
        })
        continue
      }
      const currentEnabled = Boolean(holder.enabled)
      if (currentEnabled === entry.enabled) {
        actions.push({ type: 'skip', kind: 'plugin', label, moduleName: entry.moduleName, entryId: String(holder.entryId), note: '状态一致' })
      } else {
        actions.push({
          type: 'toggle', kind: 'plugin', label, moduleName: entry.moduleName, entryId: String(holder.entryId),
          from: currentEnabled, to: entry.enabled, note: '调整插件启用状态',
        })
      }
    }
  }

  const summary = {
    install: actions.filter((a) => a.type === 'install').length,
    toggle: actions.filter((a) => a.type === 'toggle').length,
    skip: actions.filter((a) => a.type === 'skip').length,
    blocked: actions.filter((a) => a.type === 'blocked').length,
    invalid: actions.filter((a) => a.type === 'invalid').length,
  }
  return { ok: true, summary, actions, modpack: { name: doc.name, counts: doc.counts || null } }
}

async function applyModpack(ctx, doc, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const pm = manager(ctx)
  if (!pm) return { ok: false, error: 'pluginManager 服务不可用，无法安装' }
  const caps = capabilities(ctx)
  if (!caps.installBundle) {
    return { ok: false, error: '当前 Harness 版本的 pluginManager 没有 installBundle：只能导出整合包，无法在本机安装。' }
  }

  const planned = await planModpack(ctx, doc, opts)
  if (!planned.ok) return planned

  const results = []
  const requestId = typeof opts.requestId === 'string' && opts.requestId ? opts.requestId : `modpack-${Date.now()}`
  for (const action of planned.actions) {
    if (action.type === 'skip' || action.type === 'blocked' || action.type === 'invalid') {
      results.push({ ...action, outcome: action.type === 'skip' ? 'skipped' : action.type })
      continue
    }
    try {
      if (action.type === 'install') {
        // `requestId` is only meaningful to builds that expose the wait/cancel
        // pair; passing an unknown option is harmless today but is exactly the
        // kind of thing a stricter future implementation rejects wholesale.
        const installOptions = { enabled: action.to !== false }
        if (caps.installRequestId) installOptions.requestId = requestId
        const change = await pm.installBundle(action.spec, installOptions)
        results.push({
          ...action,
          outcome: change && change.application === 'failed' ? 'failed' : 'installed',
          application: change ? change.application : null,
          restartReason: change ? change.restartReason : null,
          error: change && change.error ? (change.error.diagnostic || change.error.code) : null,
          pendingBuilds: change ? change.pendingBuilds : null,
          version: change ? change.version : null,
        })
        continue
      }
      if (action.type === 'toggle' && action.kind === 'bundle') {
        if (!caps.setBundleEnabled) {
          results.push({ ...action, outcome: 'unsupported', error: '当前 Harness 版本不支持 setBundleEnabled' })
          continue
        }
        const change = await pm.setBundleEnabled(action.name, action.to === true)
        results.push({
          ...action,
          outcome: 'toggled',
          application: change ? change.application : null,
          error: change && change.error ? (change.error.diagnostic || change.error.code) : null,
        })
        continue
      }
      if (action.type === 'toggle' && action.kind === 'plugin') {
        if (!caps.setPluginEnabled) {
          results.push({ ...action, outcome: 'unsupported', error: '当前 Harness 版本不支持 setPluginEnabled' })
          continue
        }
        const change = await pm.setPluginEnabled(action.entryId, action.to === true)
        results.push({
          ...action,
          outcome: 'toggled',
          application: change ? change.application : null,
          error: change && change.error ? (change.error.diagnostic || change.error.code) : null,
        })
        continue
      }
      results.push({ ...action, outcome: 'unhandled' })
    } catch (err) {
      results.push({ ...action, outcome: 'failed', error: (err && err.message) || String(err) })
    }
  }

  const tally = results.reduce((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] || 0) + 1
    return acc
  }, {})

  return {
    ok: true,
    requestId,
    modpackName: doc.name || null,
    summary: planned.summary,
    tally,
    results,
    restartRequired: results.some((r) => r.application === 'restart-required'),
  }
}

/* ------------------------------------------------------------------ */
/* agent tools (best effort — skipped when the service is unavailable) */
/* ------------------------------------------------------------------ */

async function registerTools(ctx, api) {
  const tools = serviceOf(ctx, 'tools')
  if (!tools || typeof tools.register !== 'function') return

  const text = (value) => [{ type: 'text', text: String(value) }]

  // Tool definitions are written out by hand rather than built with
  // `defineTool` from `@deepseek-ai/dsh-tools`: that package is not a
  // resolvable specifier for a profile-installed plugin, and a dynamic
  // `import()` of it fails silently. The host's `tools.register` only
  // requires `output.render` to be a function and `output.schema` to be a
  // supported JSON Schema, and it projects `parameters` verbatim to the
  // model — so raw JSON Schema is the whole contract.
  const listTool = {
    name: 'modpack_list',
    description:
      'List the plugins and bundles installed in this DeepSeek Harness profile, with their enablement. This is the inventory a plugin modpack is built from.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional case-insensitive substring matched against bundle name, title and description.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(JSON.stringify(value, null, 2)),
    },
    async execute(args) {
      const data = await api.inventory()
      const needle = String((args && args.filter) || '').toLowerCase()
      const match = (row) =>
        !needle ||
        [row.name, row.moduleName, row.title, row.description].some(
          (field) => typeof field === 'string' && field.toLowerCase().includes(needle),
        )
      return {
        ok: data.ok,
        degraded: data.degraded,
        reason: data.reason || null,
        profileDir: data.profileDir,
        bundles: (data.bundles || []).filter(match),
        plugins: (data.plugins || []).filter(match),
      }
    },
  }

  const exportTool = {
    name: 'modpack_export',
    description:
      'Pack selected installed plugins into a plugin modpack document (the Minecraft-modpack equivalent for DeepSeek Harness) and save it on this machine. Returns the file path plus what was packed.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Modpack name, also used for the file name.' },
        description: { type: 'string', description: 'What this modpack is for.' },
        author: { type: 'string', description: 'Who assembled it.' },
        bundles: { type: 'string', description: 'Comma-separated bundle package names to include. Use "*" for every bundle.' },
        plugins: { type: 'string', description: 'Comma-separated Loader entry ids whose enable/disable state should travel with the pack.' },
        includeDisabled: { type: 'boolean', description: 'Also pack bundles that are currently disabled, as disabled entries. Defaults to false.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(JSON.stringify(value, null, 2)),
    },
    async execute(args) {
      const inventory = await api.inventory()
      if (!inventory.ok) return { ok: false, error: inventory.reason }
      const a = args || {}
      const wantsAll = String(a.bundles || '').trim() === '*'
      const wanted = new Set(
        String(a.bundles || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      const wantedPlugins = new Set(
        String(a.plugins || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      const entries = []
      for (const row of inventory.bundles) {
        const picked = wantsAll || wanted.has(row.name)
        if (!picked) continue
        if (!row.enabled && a.includeDisabled !== true) continue
        entries.push(row)
      }
      for (const row of inventory.plugins) {
        if (wantedPlugins.has(row.entryId)) entries.push(row)
      }
      if (entries.length === 0) return { ok: false, error: '没有匹配到任何插件；请先调用 modpack_list 查看可选名称。' }
      const modpack = buildModpack(a, entries)
      const saved = api.save(modpack)
      return {
        ok: true,
        path: saved.path,
        name: modpack.name,
        counts: modpack.counts,
        notPortable: entries.filter((e) => e.kind === 'bundle' && isLocalSpec(e.spec)).map((e) => e.name),
      }
    },
  }

  const applyTool = {
    name: 'modpack_apply',
    description:
      'Install and enable the plugins named by a plugin modpack on this DeepSeek Harness. Runs a preview first, then performs the installation through the plugin manager. Defaults to a dry run.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Modpack file path. Give either path or document.' },
        document: { type: 'object', additionalProperties: true, description: 'An inlined modpack document, as an alternative to path.' },
        dryRun: { type: 'boolean', description: 'Preview only, changing nothing. Defaults to true; pass false to actually install.' },
        allowLocal: { type: 'boolean', description: 'Also try entries whose spec is a local path on this machine.' },
        pinVersions: { type: 'boolean', description: 'Install each bundle at the exact version the pack records, instead of resolving the recorded range.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(JSON.stringify(value, null, 2)),
    },
    async execute(args) {
      const a = args || {}
      let doc = a.document && typeof a.document === 'object' ? a.document : null
      if (!doc && a.path) {
        try {
          doc = JSON.parse(readFileSync(String(a.path), 'utf8'))
        } catch (err) {
          return { ok: false, error: `读取整合包失败：${(err && err.message) || String(err)}` }
        }
      }
      if (!doc) return { ok: false, error: '请提供 path 或 document。' }
      const problem = validateModpack(doc)
      if (problem) return { ok: false, error: problem }
      const opts = { allowLocal: a.allowLocal === true, pinVersions: a.pinVersions === true }
      if (a.dryRun === false) return await applyModpack(ctx, doc, opts)
      return await planModpack(ctx, doc, opts)
    },
  }

  ctx.effect(() => tools.register(listTool), 'dsh-modpack: modpack_list')
  ctx.effect(() => tools.register(exportTool), 'dsh-modpack: modpack_export')
  ctx.effect(() => tools.register(applyTool), 'dsh-modpack: modpack_apply')
}

/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */

/**
 * Read a service from an `inject()` callback context.
 *
 * Cordis exposes an injected service both as a direct property and through
 * `get()`; which of the two is populated depends on the runtime, so accept
 * either rather than guessing. Returns `undefined` only when the service is
 * genuinely absent, so a caller's guard keeps its original meaning.
 */
function serviceOf(childCtx, name) {
  if (!childCtx) return undefined
  const viaGet = typeof childCtx.get === 'function' ? childCtx.get(name) : undefined
  return viaGet === undefined ? childCtx[name] : viaGet
}

/**
 * Run `cb` once a host service is mounted.
 *
 * `ctx.get()` reports only what exists at this instant, and these services are
 * regularly mounted *after* plugins are applied — probing once silently skipped
 * both registrations while the plugin still looked perfectly healthy. The tab
 * appeared, every request behind it failed, and no agent tool was ever exposed.
 *
 * `ctx.inject()` is the correct primitive: it declares the dependency and fires
 * the callback when the service arrives. Runtimes that predate `inject` fall
 * back to a direct read, which is no worse than the behaviour it replaces.
 */
function whenService(ctx, name, cb) {
  if (typeof ctx.inject === 'function') {
    ctx.inject([name], (childCtx) => cb(serviceOf(childCtx, name), childCtx))
    return
  }
  const service = serviceOf(ctx, name)
  if (service) cb(service, ctx)
}

export function apply(ctx) {
  // Record the profile the host actually launched before anything reads it.
  // Everything below — the inventory, the manifest roots, the code digests —
  // resolves paths through `profileDir()`, and on the desktop client that is
  // the only place the real directory is available.
  try {
    const profile = serviceOf(ctx, 'profileContext')
    if (profile && typeof profile.dir === 'string' && profile.dir) profileDirOverride = profile.dir
  } catch {
    /* no profile context: keep the environment fallback */
  }

  const api = {
    inventory: () => inventory(ctx),
    plan: (doc, options) => planModpack(ctx, doc, options),
    apply: (doc, options) => applyModpack(ctx, doc, options),
    save: (doc) => {
      const dir = storageDir()
      mkdirSync(dir, { recursive: true })
      const file = `${sanitizeFileName(doc.name)}${SUFFIX}`
      const path = join(dir, file)
      writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8')
      return { path, file }
    },
  }

  const handler = async (req, res) => {
    let path = API_PREFIX
    let query = new URLSearchParams()
    try {
      const parsed = new URL(req.url || API_PREFIX, 'http://127.0.0.1')
      path = parsed.pathname.replace(/\/+$/, '')
      query = parsed.searchParams
    } catch {
      /* keep defaults */
    }

    const auth = authorize(ctx, req)
    if (!auth.ok) {
      sendJson(res, auth.status || 401, { ok: false, error: '未授权：请通过 DeepSeek Harness 界面访问' })
      return
    }

    let body = {}
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const raw = await readBody(req)
        body = raw ? JSON.parse(raw) : {}
      } catch (err) {
        sendJson(res, 400, { ok: false, error: `请求内容解析失败：${(err && err.message) || String(err)}` })
        return
      }
    }

    try {
      if (path === `${API_PREFIX}/diag`) {
        sendJson(res, 200, {
          ok: true,
          pluginVersion: PLUGIN_VERSION,
          // The two halves agree on this number or they do not talk. See the
          // `API_VERSION` declaration for why the plugin version cannot serve
          // as that handshake.
          apiVersion: API_VERSION,
          dshVersion: runtimeVersion(),
          node: process.version,
          platform: process.platform,
          profileDir: profileDir(),
          storageDir: storageDir(),
          hasPluginManager: Boolean(manager(ctx)),
          hasWebServer: Boolean(serviceOf(ctx, 'webServer')),
          auth: auth.mode,
          // The UI uses this to hide actions the running build cannot perform
          // instead of offering a button that fails on click.
          capabilities: capabilities(ctx),
        })
        return
      }

      if (path === `${API_PREFIX}/inventory`) {
        sendJson(res, 200, await api.inventory())
        return
      }

      if (path === `${API_PREFIX}/saved`) {
        sendJson(res, 200, { ok: true, storageDir: storageDir(), modpacks: listSaved() })
        return
      }

      if (path === `${API_PREFIX}/categories`) {
        sendJson(res, 200, { ok: true, doc: readCategories(), path: categoriesPath() })
        return
      }

      if (path === `${API_PREFIX}/categories/suggest`) {
        // Preview only. Deliberately writes nothing: the user sees the
        // proposal, and only an explicit "apply" reaches /categories/save.
        const inventoryData = await api.inventory()
        if (!inventoryData.ok) {
          sendJson(res, 200, { ok: false, error: inventoryData.reason })
          return
        }
        const rows = [...inventoryData.bundles, ...inventoryData.plugins]
        const locale = body.locale === 'en' ? 'en' : 'zh'
        const existing = readCategories()

        // Evidence passes, each one opt-in and each handed the merged verdicts
        // of the passes before it. The gate is the same at every rung —
        // `needsRemote`, meaning "the passes below could not stand behind this"
        // — which is what keeps a plugin its author already tagged from being
        // re-judged, let alone sent anywhere.
        const base = new Map()
        // Settled offline, description and README included. Seeding the rungs
        // with the *full* local answer is what keeps the network out of rows
        // this machine could already decide: `needsRemote` sees a basis it can
        // stand behind and the row never becomes a lookup.
        for (const row of rows) base.set(row.key, localVerdict(row))
        // Two maps on purpose. `overrides` holds only the rows a later rung
        // changed, because `suggestCategories` reads its absence as "fall back
        // to the offline answer, prose included". Seeding it with every row
        // would silently disable the local prose tiers for all of them.
        const overrides = new Map()
        const settled = () => {
          const merged = new Map(base)
          for (const [key, value] of overrides) merged.set(key, value)
          return merged
        }

        let remote = { byKey: new Map(), stats: null, trails: undefined }
        if (body.online === true) {
          // `enrichRemote` is the one place that decides which rows are too
          // uncertain to stand on their own. Filtering here as well made that
          // decision twice, and the second copy could never fire — a mutation
          // that removed it changed nothing, which is how it was found.
          remote = await enrichRemote(rows, settled(), { locale })
          for (const [key, value] of remote.byKey) overrides.set(key, value)
        }

        // Reading a package's entry code is free and local, but it is only
        // *evidence*: it is handed to the model rather than matched by a table
        // of our own. Asking for it without asking for the model would do
        // nothing at all, so the UI disables that combination instead of
        // letting it look like it did something.
        let ai = { byKey: new Map(), stats: null }
        if (body.ai === true) {
          ai = await aiClassify(ctx, rows, settled(), {
            locale,
            // The reasoning rung is a strict extension of the source rung: it
            // derives its facts from the same entry file. Ticking it therefore
            // reads the file too, instead of attaching a role line built from
            // half the inputs.
            source: body.source === true || body.reason === true,
            reason: body.reason === true,
            remoteEvidence: remote.evidence,
          })
          for (const [key, value] of ai.byKey) overrides.set(key, value)
        }

        const suggestion = suggestCategories(rows, existing, {
          overwrite: body.overwrite === true,
          locale,
          remoteVerdicts: overrides,
          remoteTrails: remote.trails,
        })
        sendJson(res, 200, { ok: true, ...suggestion, remote: remote.stats, ai: ai.stats })
        return
      }

      if (path === `${API_PREFIX}/categories/forget`) {
        // The cache holds package names this machine asked about. A user who
        // wants that record gone should not have to find the file.
        try {
          rmSync(remoteCachePath(), { force: true })
          sendJson(res, 200, { ok: true })
        } catch (err) {
          sendJson(res, 200, { ok: false, error: `清除缓存失败：${(err && err.message) || String(err)}` })
        }
        return
      }

      if (path === `${API_PREFIX}/categories/save`) {
        const problem = validateCategories(body.doc)
        if (problem) {
          sendJson(res, 200, { ok: false, error: problem })
          return
        }
        try {
          sendJson(res, 200, { ok: true, doc: writeCategories(body.doc) })
        } catch (err) {
          sendJson(res, 200, { ok: false, error: `保存分类失败：${(err && err.message) || String(err)}` })
        }
        return
      }

      if (path === `${API_PREFIX}/pack`) {
        const inventoryData = await api.inventory()
        if (!inventoryData.ok) {
          sendJson(res, 200, { ok: false, error: inventoryData.reason })
          return
        }
        const wanted = new Set(Array.isArray(body.keys) ? body.keys.map(String) : [])
        const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : {}
        const catDoc = readCategories()
        const picked = []
        for (const row of [...inventoryData.bundles, ...inventoryData.plugins]) {
          if (!wanted.has(row.key)) continue
          picked.push({
            ...row,
            override: overrides[row.key] || row.override || null,
            category: categoryLabel(catDoc, catDoc.assignments[row.key]),
          })
        }
        if (picked.length === 0) {
          sendJson(res, 200, { ok: false, error: '没有勾选任何插件' })
          return
        }
        const doc = buildModpack(body.meta || {}, picked)
        const notPortable = doc.plugins.filter((e) => e.kind === 'bundle' && e.local).map((e) => e.name)
        sendJson(res, 200, { ok: true, modpack: doc, notPortable })
        return
      }

      if (path === `${API_PREFIX}/save`) {
        const doc = body.modpack
        const problem = validateModpack(doc)
        if (problem) {
          sendJson(res, 200, { ok: false, error: problem })
          return
        }
        const saved = api.save(doc)
        sendJson(res, 200, { ok: true, path: saved.path, file: saved.file })
        return
      }

      if (path === `${API_PREFIX}/load`) {
        const dir = storageDir()
        const file = String(body.file || '')
        if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) {
          sendJson(res, 200, { ok: false, error: '文件名无效' })
          return
        }
        const full = join(dir, file)
        try {
          const doc = JSON.parse(readFileSync(full, 'utf8'))
          const problem = validateModpack(doc)
          if (problem) {
            sendJson(res, 200, { ok: false, error: problem })
            return
          }
          sendJson(res, 200, { ok: true, modpack: doc })
        } catch (err) {
          sendJson(res, 200, { ok: false, error: `读取失败：${(err && err.message) || String(err)}` })
        }
        return
      }

      if (path === `${API_PREFIX}/delete`) {
        const dir = storageDir()
        const file = String(body.file || '')
        if (!file || !file.endsWith(SUFFIX) || file.includes('/') || file.includes('\\') || file.includes('..')) {
          sendJson(res, 200, { ok: false, error: '文件名无效' })
          return
        }
        try {
          rmSync(join(dir, file), { force: true })
          sendJson(res, 200, { ok: true })
        } catch (err) {
          sendJson(res, 200, { ok: false, error: `删除失败：${(err && err.message) || String(err)}` })
        }
        return
      }

      if (path === `${API_PREFIX}/plan`) {
        const doc = body.modpack && typeof body.modpack === 'object' ? body.modpack : body.document
        const problem = validateModpack(doc)
        if (problem) {
          sendJson(res, 200, { ok: false, error: problem })
          return
        }
        sendJson(res, 200, await api.plan(doc, { allowLocal: body.allowLocal === true, pinVersions: body.pinVersions === true }))
        return
      }

      if (path === `${API_PREFIX}/apply`) {
        const doc = body.modpack && typeof body.modpack === 'object' ? body.modpack : body.document
        const problem = validateModpack(doc)
        if (problem) {
          sendJson(res, 200, { ok: false, error: problem })
          return
        }
        sendJson(res, 200, await api.apply(doc, { allowLocal: body.allowLocal === true, pinVersions: body.pinVersions === true, requestId: body.requestId }))
        return
      }

      if (path === API_PREFIX || path === `${API_PREFIX}/`) {
        sendJson(res, 200, { ok: true, plugin: 'dsh-modpack', version: PLUGIN_VERSION, endpoints: ['inventory', 'saved', 'pack', 'save', 'load', 'delete', 'plan', 'apply', 'diag', 'categories', 'categories/save', 'categories/suggest', 'categories/forget'] })
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      sendJson(res, 500, { ok: false, error: (err && err.message) || String(err) })
    }
  }

  // `webServer` and `tools` are host services that are frequently NOT mounted
  // yet at the moment this plugin is applied. `ctx.get()` only ever reports
  // what already exists, so probing it once here skipped both registrations
  // while the plugin still looked perfectly healthy: the settings tab appeared,
  // nothing behind it worked, and no agent tool was ever exposed. `ctx.inject()`
  // declares the dependency and runs the callback once the service is up.
  whenService(ctx, 'webServer', (webServer, webCtx) => {
    if (!webServer || typeof webServer.register !== 'function') {
      console.error('[dsh-modpack] webServer 服务不可用：HTTP 接口未注册，界面将无法工作。')
      return
    }
    webCtx.effect(
      () => webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
      'dsh-modpack: routes',
    )
  })

  try {
    mkdirSync(storageDir(), { recursive: true })
    const marker = join(storageDir(), 'plugin.json')
    if (!existsSync(marker)) {
      writeFileSync(marker, JSON.stringify({ route: API_PREFIX, version: PLUGIN_VERSION }, null, 2), 'utf8')
    }
  } catch {
    /* non-fatal */
  }

  whenService(ctx, 'tools', (_tools, toolsCtx) => {
    registerTools(toolsCtx, api).catch((err) => {
      console.error('[dsh-modpack] 智能体工具注册失败（不影响界面）：', (err && err.message) || String(err))
    })
  })
}