/**
 * check-tree-logic.mjs — exercises the SHIPPED tree helpers inside client.js.
 *
 * `check-categories.mjs` proves the stored document survives hostile input, but
 * it never runs the code the UI actually filters with. If `subtreeIds` were
 * wrong, clicking a parent category would quietly show the wrong plugins and
 * every test we had would still pass.
 *
 * So this harness does not re-implement those helpers — it slices their real
 * source out of `client.js` and evaluates that. A copy of the algorithm here
 * would only prove the copy works.
 *
 *   node scripts/check-tree-logic.mjs
 */
import { readSource } from './source-text.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'client.js')

// The walkers are cycle-safe by construction, and the whole point of the cycle
// test is that a regression would hang rather than fail. A watchdog turns that
// hang into a visible failure instead of a stuck process.
const watchdog = setTimeout(() => {
  console.error('FAIL: a tree walker did not terminate within 5s (cycle guard broken?)')
  process.exit(1)
}, 5000)
watchdog.unref()

const problems = []
function check(label, condition, detail) {
  if (!condition) problems.push(detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`)
}

const source = readSource(CLIENT)
const start = source.indexOf('    function childrenOf(doc, parentId) {')
const end = source.indexOf('    function CategoryTree(')
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL: could not locate the tree helpers inside client.js (did they get renamed?)')
  process.exit(1)
}
const block = source.slice(start, end)
const exported = new Function(`${block}\nreturn { childrenOf, subtreeIds, labelOf, newCategoryId }`)()
const { childrenOf, subtreeIds, labelOf, newCategoryId } = exported

// Deliberately unsorted, to prove the sort is applied rather than inherited.
const doc = {
  nodes: [
    { id: 'a', name: '语言模型', parentId: null, order: 1 },
    { id: 'b', name: '开发工具', parentId: null, order: 0 },
    { id: 'c', name: '国内', parentId: 'a', order: 1 },
    { id: 'd', name: '国外', parentId: 'a', order: 0 },
    { id: 'e', name: '打包', parentId: 'b', order: 0 },
  ],
}

// --- childrenOf -----------------------------------------------------------
const roots = childrenOf(doc, null).map((n) => n.id)
check('roots are ordered by order, not by file order', roots.join(',') === 'b,a', roots)
check('missing parentId counts as root', childrenOf({ nodes: [{ id: 'z', name: 'Z' }] }, null).length === 1)
check('a category with no children returns none', childrenOf(doc, 'e').length === 0)
check('a document with no nodes does not throw', childrenOf({}, null).length === 0)

// Equal `order` falls back to name, so the tree never shuffles between renders.
const tie = childrenOf(
  { nodes: [{ id: 'y', name: 'b', parentId: null, order: 0 }, { id: 'x', name: 'a', parentId: null, order: 0 }] },
  null,
).map((n) => n.id)
check('equal order falls back to name', tie.join(',') === 'x,y', tie)

// --- subtreeIds -----------------------------------------------------------
const lang = [...subtreeIds(doc, 'a')].sort().join(',')
check('a subtree includes the node and its descendants', lang === 'a,c,d', lang)
check('a leaf subtree is just itself', [...subtreeIds(doc, 'e')].join(',') === 'e')
check('a child subtree does not leak its parent', [...subtreeIds(doc, 'd')].join(',') === 'd')
check('no id yields an empty set', subtreeIds(doc, null).size === 0 && subtreeIds(doc, '').size === 0)
check('an unknown id yields just itself', [...subtreeIds(doc, 'nope')].join(',') === 'nope')

// The host repairs cycles on write, but the UI may hold an optimistic document
// for a moment before the repaired one comes back. It must not hang on it.
const cyclic = {
  nodes: [
    { id: 'x', name: 'X', parentId: 'y', order: 0 },
    { id: 'y', name: 'Y', parentId: 'x', order: 1 },
  ],
}
const cyc = [...subtreeIds(cyclic, 'x')].sort().join(',')
check('a cyclic subtree terminates and still lists both nodes', cyc === 'x,y', cyc)

// --- labelOf --------------------------------------------------------------
check('a nested path is joined with " / "', labelOf(doc, 'c') === '语言模型 / 国内', labelOf(doc, 'c'))
check('a root path is just its name', labelOf(doc, 'b') === '开发工具', labelOf(doc, 'b'))
check('an unknown id yields an empty label', labelOf(doc, 'nope') === '')
check('labelling a cyclic node terminates', typeof labelOf(cyclic, 'x') === 'string')
check('labelling tolerates a document with no nodes', labelOf({}, 'a') === '')

// A dangling parentId must not silently truncate the path to nothing.
const dangling = { nodes: [{ id: 'k', name: '孤儿', parentId: 'ghost', order: 0 }] }
check('a dangling parent still yields the node name', labelOf(dangling, 'k') === '孤儿', labelOf(dangling, 'k'))

// --- newCategoryId --------------------------------------------------------
const ids = new Set(Array.from({ length: 500 }, () => newCategoryId()))
check('generated category ids are unique across 500 draws', ids.size === 500, ids.size)
check('generated ids are url-safe strings', [...ids].every((id) => /^c[0-9a-z]+$/.test(id)), [...ids][0])

clearTimeout(watchdog)
if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('PASS: the shipped tree helpers order, scope and label the tree, and survive a cyclic document')