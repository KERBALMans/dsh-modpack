/**
 * check-drag.mjs — the drop zone must not leak a drag into the Harness shell.
 *
 * The bug this guards: dropping a `.dshmodpack.json` on the import panel was
 * handled by the plugin *and* by the shell's document-level drop listener, so
 * the pack file was also attached to the chat composer. Drag events bubble, so
 * calling `preventDefault()` alone marks the drop as ours without stopping it
 * from continuing up the tree.
 *
 * Like check-tree-logic.mjs, this evaluates the shipped source rather than a
 * copy of it — a re-implementation here would only prove the copy works.
 *
 *   node scripts/check-drag.mjs
 */
import { readSource } from './source-text.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'client.js')

const problems = []
function check(label, condition, detail) {
  if (!condition) problems.push(detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`)
}

const source = readSource(CLIENT)

/* ---- 1. the helper itself, taken from the shipped file ----------------- */

const marker = 'const swallowDrag = (event) => {'
const start = source.indexOf(marker)
if (start < 0) {
  console.error('FAIL: could not find `swallowDrag` in client.js (was the drop fix removed?)')
  process.exit(1)
}
let depth = 0
let end = -1
for (let i = source.indexOf('{', start); i < source.length; i += 1) {
  if (source[i] === '{') depth += 1
  else if (source[i] === '}') {
    depth -= 1
    if (depth === 0) { end = i + 1; break }
  }
}
if (end < 0) {
  console.error('FAIL: could not read the body of `swallowDrag`')
  process.exit(1)
}

const swallowDrag = new Function(`${source.slice(start, end)}; return swallowDrag;`)()

function fakeEvent(extra = {}) {
  const calls = []
  const event = {
    calls,
    preventDefault: () => calls.push('preventDefault'),
    stopPropagation: () => calls.push('stopPropagation'),
    stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
    ...extra,
  }
  return event
}

const plain = fakeEvent()
swallowDrag(plain)
check('a drag calls preventDefault', plain.calls.includes('preventDefault'), plain.calls)
check('a drag stops propagating to the shell', plain.calls.includes('stopPropagation'), plain.calls)
check('a drag also stops sibling listeners on the same node',
  plain.calls.includes('stopImmediatePropagation'), plain.calls)

// Older or synthetic events may not implement stopImmediatePropagation; the
// guard must not throw, because throwing inside a drop handler would leave the
// panel stuck in its highlight state.
const minimal = { preventDefault() {}, stopPropagation() {} }
let threw = null
try {
  swallowDrag(minimal)
} catch (err) {
  threw = err
}
check('an event without stopImmediatePropagation does not throw', threw === null,
  threw && threw.message)

/* ---- 2. the handlers must actually use it ----------------------------- */

const dropStart = source.indexOf('const onDrop = (event) => {')
check('an onDrop handler exists', dropStart > 0)
if (dropStart > 0) {
  const dropBody = source.slice(dropStart, dropStart + 400)
  check('onDrop swallows the drag before touching the file',
    dropBody.indexOf('swallowDrag(event)') >= 0
      && dropBody.indexOf('swallowDrag(event)') < dropBody.indexOf('dataTransfer'),
    dropBody.slice(0, 200))
}

for (const handler of ['onDragEnter', 'onDragOver', 'onDragLeave']) {
  const at = source.indexOf(`const ${handler} = (event) => {`)
  check(`${handler} exists`, at > 0)
  if (at > 0) {
    const body = source.slice(at, at + 400)
    check(`${handler} swallows the drag`,
      body.indexOf('swallowDrag(event)') >= 0, body.slice(0, 160))
  }
}

/* ---- 3. the drop zone must be wired to all four ----------------------- */

const zoneAt = source.indexOf("className: 'mpk-drop'")
check('the drop zone is still rendered', zoneAt > 0)
if (zoneAt > 0) {
  const zone = source.slice(zoneAt, zoneAt + 600)
  for (const prop of ['onDragEnter', 'onDragOver', 'onDragLeave', 'onDrop']) {
    // `onDrop,` shorthand or `onDrop:` both count.
    check(`the drop zone wires ${prop}`,
      new RegExp(`\\b${prop}\\s*[,:]`).test(zone), zone.slice(0, 300))
  }
  check('the drop zone no longer uses an inline preventDefault-only dragover',
    !/onDragOver:\s*\(e\)\s*=>\s*\{\s*e\.preventDefault\(\)\s*;?\s*setOver/.test(zone))
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('PASS: a dropped pack is claimed by the panel and never reaches the shell')