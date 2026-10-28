/**
 * Drives the real `/api/dsh-modpack/categories` handler against a throwaway
 * DSH home, then checks that an exported modpack carries the grouping through.
 *
 * This exists because the category file is a plain JSON file in the user's home
 * directory. People hand-edit it, sync it between machines, and merge two
 * copies — so the interesting inputs are the broken ones. A tree that has been
 * knotted into a cycle, points at a parent that no longer exists, or assigns a
 * plugin to a category somebody deleted must degrade to something renderable,
 * never to a page that will not draw. Every case below is one of those.
 *
 * Run:  node scripts/check-categories.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRequire } from 'node:module'

const API = '/api/dsh-modpack'

/* ---- a throwaway DSH home with a minimal profile --------------------- */

const home = mkdtempSync(join(tmpdir(), 'dsh-modpack-cat-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'check'
// `profileDir()` prefers DSH_PROFILE_DIR over DSH_HOME, and a shell that is
// itself running inside a Harness session has it set to the real profile.
// Clearing it keeps this test off the live tree.
delete process.env.DSH_PROFILE_DIR

const profile = join(home, 'profiles', 'check')
mkdirSync(profile, { recursive: true })

const BUNDLES = ['billion-context', 'dsh-connect-workbuddy', 'dsh-session-manager']
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'check-profile',
  version: '0.0.0',
  private: true,
  dependencies: {
    'billion-context': '^0.1.208',
    'dsh-connect-workbuddy': '^5.8.5',
    'dsh-session-manager': '^0.7.5',
  },
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

/** `ctx.inject` hands the callback a child context that exposes the service as
 *  a property, which is exactly what `serviceOf` reads. */
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

/** Walk every node to a root, the way the UI does. Returns null on a cycle. */
function walkTerminates(doc) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  for (const node of doc.nodes) {
    let hop = node.parentId
    let guard = 0
    while (hop) {
      if (guard++ > doc.nodes.length) return null
      const parent = byId.get(hop)
      if (!parent) return null
      hop = parent.parentId
    }
  }
  return true
}

/* 1. empty state ------------------------------------------------------- */
{
  const r = await call('GET', `${API}/categories`)
  check('GET /categories answers ok on a fresh home', r.json?.ok === true, JSON.stringify(r.json))
  check('fresh tree is empty', Array.isArray(r.json?.doc?.nodes) && r.json.doc.nodes.length === 0,
    JSON.stringify(r.json?.doc?.nodes))
  check('fresh tree has no assignments', r.json?.doc?.assignments
    && Object.keys(r.json.doc.assignments).length === 0)
}

/* 2. a valid two-level tree round-trips -------------------------------- */
const GOOD_TREE = {
  nodes: [
    { id: 'a', name: '语言模型', parentId: null, order: 0 },
    { id: 'a1', name: '国内', parentId: 'a', order: 0 },
    { id: 'b', name: '开发工具', parentId: null, order: 1 },
  ],
  assignments: {
    'bundle:billion-context': 'a1',
    'bundle:dsh-session-manager': 'b',
    'bundle:ghost': 'does-not-exist', // must be dropped, not kept as a dead pointer
  },
}
{
  const r = await call('POST', `${API}/categories/save`, { doc: GOOD_TREE })
  check('a valid tree saves', r.json?.ok === true, JSON.stringify(r.json))
  check('the category file is created', existsSync(categoriesFile))

  const again = await call('GET', `${API}/categories`)
  const doc = again.json?.doc
  check('all three categories survive', doc?.nodes?.length === 3, JSON.stringify(doc?.nodes))
  check('an assignment to a missing category is dropped',
    doc?.assignments && !('bundle:ghost' in doc.assignments), JSON.stringify(doc?.assignments))
  check('real assignments survive', doc?.assignments?.['bundle:billion-context'] === 'a1')
  check('counts are reported', doc?.counts?.categories === 3 && doc?.counts?.assigned === 2,
    JSON.stringify(doc?.counts))

  const onDisk = JSON.parse(readFileSync(categoriesFile, 'utf8'))
  check('the file on disk holds the tree', onDisk.nodes.length === 3 && onDisk.assignments['bundle:dsh-session-manager'] === 'b',
    JSON.stringify(onDisk).slice(0, 200))
  check('the file on disk has no dead pointer', !('bundle:ghost' in onDisk.assignments))
}

/* 3. hostile hand-edited files ----------------------------------------- */
{
  // A two-node cycle: each is the other's parent. Left alone this would make
  // any recursive renderer spin forever.
  const r = await call('POST', `${API}/categories/save`, {
    doc: {
      nodes: [
        { id: 'x', name: 'X', parentId: 'y' },
        { id: 'y', name: 'Y', parentId: 'x' },
        { id: 'z', name: 'Z', parentId: 'z' },        // its own parent
        { id: 'w', name: 'W', parentId: 'nope' },     // parent that does not exist
      ],
      assignments: {},
    },
  })
  check('a cyclic tree is still accepted for repair', r.json?.ok === true, JSON.stringify(r.json))

  const doc = (await call('GET', `${API}/categories`)).json?.doc
  check('every node survives repair', doc?.nodes?.length === 4, JSON.stringify(doc?.nodes))
  check('walking the repaired tree terminates', walkTerminates(doc) === true,
    JSON.stringify(doc?.nodes))
  const byId = new Map((doc?.nodes || []).map((n) => [n.id, n]))
  check('a self-parent is detached', byId.get('z')?.parentId === null)
  check('a dangling parent is detached', byId.get('w')?.parentId === null)
  check('exactly one edge of the cycle is cut',
    (byId.get('x')?.parentId === null) !== (byId.get('y')?.parentId === null),
    `x=${byId.get('x')?.parentId} y=${byId.get('y')?.parentId}`)
}

/* 4. what must be refused rather than repaired -------------------------- */
{
  const dup = await call('POST', `${API}/categories/save`, {
    doc: { nodes: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }], assignments: {} },
  })
  check('duplicate ids are refused', dup.json?.ok === false, JSON.stringify(dup.json))

  const unnamed = await call('POST', `${API}/categories/save`, {
    doc: { nodes: [{ id: 'a', name: '   ' }], assignments: {} },
  })
  check('a blank name is refused', unnamed.json?.ok === false, JSON.stringify(unnamed.json))

  const notAnObject = await call('POST', `${API}/categories/save`, { doc: 'nonsense' })
  check('a non-object document is refused', notAnObject.json?.ok === false, JSON.stringify(notAnObject.json))

  // A refusal must not have destroyed what was already on disk.
  const doc = (await call('GET', `${API}/categories`)).json?.doc
  check('a refused save leaves the stored tree intact', doc?.nodes?.length === 4, JSON.stringify(doc?.nodes))
}

/* 5. export carries the grouping ---------------------------------------- */
{
  await call('POST', `${API}/categories/save`, { doc: GOOD_TREE })

  const r = await call('POST', `${API}/pack`, {
    meta: { name: 'category check' },
    keys: ['bundle:billion-context', 'bundle:dsh-session-manager'],
    overrides: {},
  })
  check('the pack builds', r.json?.ok === true, JSON.stringify(r.json).slice(0, 300))

  const doc = r.json?.modpack
  const nested = (doc?.plugins || []).find((e) => e.name === 'billion-context')
  const flat = (doc?.plugins || []).find((e) => e.name === 'dsh-session-manager')

  check('a nested entry exports its full category path',
    nested?.category === '语言模型 / 国内', JSON.stringify(nested?.category))
  check('a top-level entry exports its category name',
    flat?.category === '开发工具', JSON.stringify(flat?.category))
  check('the document lists the categories it used',
    Array.isArray(doc?.categories) && doc.categories.includes('开发工具') && doc.categories.includes('语言模型 / 国内'),
    JSON.stringify(doc?.categories))

  // The recipient's route out of the chicken-and-egg problem: the file has to
  // explain how to install itself to somebody who does not have this plugin.
  check('the document explains how to install itself without this plugin',
    Array.isArray(doc?.howToUse) && doc.howToUse.length >= 3
      && doc.howToUse.some((line) => /plugin_manager/.test(line)),
    JSON.stringify(doc?.howToUse))
  check('every howToUse line is a non-empty string',
    Array.isArray(doc?.howToUse) && doc.howToUse.every((line) => typeof line === 'string' && line.trim()),
    JSON.stringify(doc?.howToUse))
}

/* ---- report ---------------------------------------------------------- */

rmSync(home, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} problem(s)\n`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log('PASS: category tree stores, repairs hostile input, and exports its grouping')