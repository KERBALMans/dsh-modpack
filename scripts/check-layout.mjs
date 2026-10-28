/**
 * check-layout.mjs — nothing may move when you click or hover.
 *
 * The bug this guards. Five separate rules picked their "active" look with
 * `font-weight:600`:
 *
 *   .mpk-tab[data-on="1"]      the Build / Install tabs
 *   .mpk-chip[data-on="1"]     the filter chips above the plugin list
 *   .mpk-seg button[data-on="1"]   the 列表 / 树状图 switch
 *   .mpk-diag-box[data-on="1"] the boxes in the tree diagram
 *   .mpk-node[data-on="1"]     the rows of the category tree
 *
 * Bolding text increases its advance width, and the browser re-measures the
 * element to lay it out. So the instant you clicked a tab the tab grew, which
 * pushed every tab after it sideways; clicking a chip re-flowed the whole chip
 * row; clicking a tree node made that node's label longer under the cursor.
 * `font-weight` is the most tempting emphasis in CSS and the one that cannot be
 * applied without moving something.
 *
 * Two other members of the same family are covered here:
 *   - a button whose label is swapped while it works ("导出文件" -> "制作中…")
 *     changes its own width mid-click, so the whole row jumps;
 *   - `.mpk-node-tools` used to be `display:none` until hover, so pointing at a
 *     row shoved that row's count sideways.
 *
 * The rule this file enforces, in one sentence: **a style keyed on an
 * interaction state (`[data-on]`, `:hover`, `:focus`, `:checked`) must not
 * change any property that participates in layout.** Colour, background, border
 * colour, box-shadow and visibility are all fine; those are painted, not
 * measured.
 *
 * Like check-drag.mjs this reads the shipped CSS out of client.js rather than a
 * copy, because a copy would only prove the copy is right.
 *
 *   node scripts/check-layout.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'client.js')

const problems = []
function check(label, condition, detail) {
  if (!condition) problems.push(detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`)
}

const source = readFileSync(CLIENT, 'utf8')

/* ---- 1. lift the stylesheet out of the client bundle ------------------ */

const cssAt = source.indexOf('const CSS = `')
if (cssAt < 0) {
  console.error('FAIL: could not find `const CSS = ` in client.js')
  process.exit(1)
}
const cssFrom = source.indexOf('`', cssAt) + 1
const cssTo = source.indexOf('`', cssFrom)
if (cssTo < 0) {
  console.error('FAIL: could not find the end of the CSS template literal')
  process.exit(1)
}
const css = source.slice(cssFrom, cssTo)

// Comments are stripped before parsing: the explanations above quote the very
// selectors and declarations we are about to forbid, and a checker that reads
// its own documentation as violations is worse than no checker.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** @type {{ selector: string, declarations: [string, string][] }[]} */
const rules = []
for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = match[1].trim().replace(/\s+/g, ' ')
  const declarations = match[2]
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(':')
      return at < 0 ? [part, ''] : [part.slice(0, at).trim(), part.slice(at + 1).trim()]
    })
  if (selector) rules.push({ selector, declarations })
}
check('the stylesheet parses into rules', rules.length > 40, rules.length)

/* ---- 2. the invariant ------------------------------------------------ */

// Properties that take part in layout. Changing any of them re-measures the
// element and moves its siblings. Deliberately absent: color, background*,
// border-color, border-radius, box-shadow, opacity, visibility, text-shadow.
function changesMetrics(property) {
  if (property === 'display' || property === 'position' || property === 'float') return true
  if (property === 'width' || property === 'min-width' || property === 'max-width') return true
  if (property === 'height' || property === 'min-height' || property === 'max-height') return true
  if (property === 'font-weight' || property === 'font-size' || property === 'font-family') return true
  if (property === 'letter-spacing' || property === 'word-spacing' || property === 'line-height') return true
  if (property === 'white-space' || property === 'text-transform' || property === 'text-indent') return true
  if (property === 'border' || property === 'border-width') return true
  if (/^border-(top|right|bottom|left)-width$/.test(property)) return true
  if (property === 'gap' || property === 'row-gap' || property === 'column-gap') return true
  if (/^(padding|margin)(-|$)/.test(property)) return true
  return false
}

// A selector that only applies in some interaction state.
function isStateful(selector) {
  return /\[data-(on|busy|active|open|checked)/.test(selector)
    || /:hover|:focus|:checked|:active/.test(selector)
}

const offenders = []
for (const rule of rules) {
  if (!isStateful(rule.selector)) continue
  for (const [property, value] of rule.declarations) {
    if (!changesMetrics(property)) continue
    offenders.push(`${rule.selector} sets ${property}:${value}`)
  }
}
check('no interaction state changes a layout-affecting property',
  offenders.length === 0, offenders)

/* ---- 3. the three buttons that used to resize themselves -------------- */

const swaps = (source.match(/busyLabel\(busy,/g) || []).length
check('every busy button renders both of its labels at once', swaps >= 3, swaps)

// The old shape: a ternary choosing between a spinner-plus-"loading" node and
// the idle text. Any recurrence means a button is sizing itself to its label.
const oldShape = /busy\s*\?\s*el\('span',\s*null,\s*el\('span',\s*\{\s*className:\s*'mpk-spin'\s*\}\),\s*t\(/g
const regressed = (source.match(oldShape) || []).length
check('no button swaps its label through a ternary', regressed === 0, regressed)

const swapRule = rules.find((rule) => rule.selector === '.mpk-swap')
check('the swap container exists', Boolean(swapRule), swapRule && swapRule.selector)
if (swapRule) {
  check('.mpk-swap stacks its labels instead of laying them out in a row',
    swapRule.declarations.some(([p, v]) => p === 'display' && v === 'inline-grid'),
    swapRule.declarations)
}
const swapChild = rules.find((rule) => rule.selector === '.mpk-swap > *')
check('both swap labels occupy the same grid cell',
  Boolean(swapChild) && swapChild.declarations.some(([p, v]) => p === 'grid-area' && v === '1/1'),
  swapChild && swapChild.declarations)
const swapHidden = rules.find((rule) => rule.selector === '.mpk-swap > [data-on="0"]')
check('the hidden swap label keeps its space rather than leaving the flow',
  Boolean(swapHidden) && swapHidden.declarations.some(([p, v]) => p === 'visibility' && v === 'hidden'),
  swapHidden && swapHidden.declarations)

/* ---- 4. the tree row tools keep their place --------------------------- */

const tools = rules.find((rule) => rule.selector === '.mpk-node-tools')
check('the tree row tools rule exists', Boolean(tools))
if (tools) {
  check('the tree row tools reserve their space while hidden',
    tools.declarations.some(([p, v]) => p === 'visibility' && v === 'hidden'),
    tools.declarations)
  check('the tree row tools are no longer removed from the flow',
    !tools.declarations.some(([p, v]) => p === 'display' && v === 'none'),
    tools.declarations)
}
const toolsHover = rules.find((rule) => rule.selector === '.mpk-node:hover .mpk-node-tools')
check('hovering a tree row only reveals the tools',
  Boolean(toolsHover) && toolsHover.declarations.some(([p, v]) => p === 'visibility' && v === 'visible'),
  toolsHover && toolsHover.declarations)

/* ---- 5. the emphasis that replaced the bold --------------------------- */

// One rule carries the stroke for all five states, so it is found by its
// declaration rather than by any one selector.
const emphasis = rules.find((rule) =>
  rule.declarations.some(([p, v]) => p === 'text-shadow' && v.includes('currentColor')))
check('the active emphasis paints a stroke instead of re-measuring the text',
  Boolean(emphasis), emphasis && emphasis.declarations)
if (emphasis) {
  for (const owner of ['.mpk-tab', '.mpk-chip', '.mpk-seg button', '.mpk-diag-box', '.mpk-node']) {
    check(`the stroke still covers ${owner}[data-on="1"]`,
      emphasis.selector.includes(`${owner}[data-on="1"]`), emphasis.selector)
  }
}

/* ---- 6. nothing that appears after a click can be pushed out of reach -- */

// The second half of the same bug. The auto-classify panel grew when you
// clicked "预览", and it lived inside the tree's single scrolling box, so the
// action row it grew was below the fold of a container you had no reason to
// think was scrollable. "应用这个分类" was reachable, but only by scrolling a
// region that did not look like one.
//
// The rule: the tree is a card with a scrolling BODY, not a scrolling card. The
// header, the panel and the footer sit outside the scroller, so no amount of
// growth inside them can push anything out of view.

const treeRule = rules.find((rule) => rule.selector === '.mpk-tree')
check('the tree card exists', Boolean(treeRule))
if (treeRule) {
  check('the tree card itself does not scroll — only its body does',
    !treeRule.declarations.some(([p, v]) => p === 'overflow' && /auto|scroll/.test(v)),
    treeRule.declarations)
  check('the tree card is not pinned to a rail width',
    !treeRule.declarations.some(([p]) => p === 'width' || p === 'flex'),
    treeRule.declarations)
}

const treeBody = rules.find((rule) => rule.selector === '.mpk-tree-body')
check('the tree body is the scrolling region', Boolean(treeBody)
  && treeBody.declarations.some(([p, v]) => p === 'overflow' && /auto|scroll/.test(v)),
treeBody && treeBody.declarations)

// Source order is the only thing that decides whether the panel is inside the
// scroller: JSX children are positional. The panel must be emitted before the
// body div opens, or it is inside it.
const bodyAt = source.indexOf("el('div', { className: 'mpk-tree-body' }")
const autocatAt = source.indexOf('el(AutoCategorize,')
check('the auto-classify panel is rendered at all', autocatAt > 0, autocatAt)
check('the auto-classify panel is rendered outside the scrolling body',
  bodyAt > 0 && autocatAt > 0 && autocatAt < bodyAt, { autocatAt, bodyAt })

// The footer that carries the action row must be a column. As a wrapping row the
// sentence shared a line box with a button and broke into a ragged block, which
// is the "排版问题" this panel was reported for twice.
const foot = rules.find((rule) => rule.selector === '.mpk-autocat-foot')
check('the auto-classify footer exists', Boolean(foot))
if (foot) {
  check('the auto-classify footer stacks its sentence above its buttons',
    foot.declarations.some(([p, v]) => p === 'flex-direction' && v === 'column'),
    foot.declarations)
}
const actions = rules.find((rule) => rule.selector === '.mpk-autocat-actions')
check('the action row exists', Boolean(actions))
if (actions) {
  check('the action row wraps instead of overflowing its container',
    actions.declarations.some(([p, v]) => p === 'flex-wrap' && v === 'wrap'),
    actions.declarations)
}

// The category column used to be a 300px side rail next to the list. It is a
// full-width row now, which is what "独占一整行" asked for.
const stack = rules.find((rule) => rule.selector === '.mpk-stack')
check('the category column exists', Boolean(stack))
if (stack) {
  check('the category column is a full-width row, not a side rail',
    stack.declarations.some(([p, v]) => p === 'flex-direction' && v === 'column'),
    stack.declarations)
}

/* ---- 7. the panel is sized and pinned against the dialog, not itself ---- */

// Three bugs that only showed up in the real Electron window, all of them
// invisible to a jsdom-style test:
//
//   a) .mpk-tree carried overflow:hidden, which still creates a scroll
//      container. The settings dialog scrolls, so a position:sticky footer
//      nested inside the tree resolved against the tree instead of the dialog
//      and parked itself below the visible dialog box.
//   b) The settings dialog hard-codes width:800px, so no amount of width on
//      the section could make the tree wider than ~525px. "太小了" was a
//      parent constraint.
//   c) The footer was a wrapping row, so its sentence and its buttons fought
//      over one line box.
//
// The fixes are: clip instead of hidden, a sticky footer, and a width rule
// gated on a class the panel adds to <html> only while mounted.

const treeOverflow = treeRule ? treeRule.declarations.filter(([p]) => p === 'overflow') : []
check('the tree card clips without creating a scroll container',
  treeOverflow.some(([, v]) => v === 'clip'), treeOverflow)
check('the clip declaration comes after the hidden fallback',
  treeOverflow.findIndex(([, v]) => v === 'clip') > treeOverflow.findIndex(([, v]) => v === 'hidden'),
  treeOverflow)

if (foot) {
  check('the auto-classify footer sticks to the bottom of the dialog scrollport',
    foot.declarations.some(([p, v]) => p === 'position' && v === 'sticky'), foot.declarations)
  check('the sticky footer is pinned to bottom:0',
    foot.declarations.some(([p, v]) => p === 'bottom' && v === '0'), foot.declarations)
}

const wideRule = rules.find((rule) => rule.selector.includes('mpk-wide'))
check('a width rule exists for the settings dialog while the panel is mounted', Boolean(wideRule))
if (wideRule) {
  check('the width rule is scoped to the mounted class, not applied globally',
    /^html\.mpk-wide\s+\[role="dialog"\]/.test(wideRule.selector), wideRule.selector)
  check('the width rule raises the dialog above its hard-coded 800px',
    wideRule.declarations.some(([p, v]) => p === 'width' && /min\(\s*1[0-9]{3}px/.test(v)),
    wideRule.declarations)
}

// The class has to be ref-counted: the component is registered in two slots,
// and a boolean would let whichever unmounts first strip the class off the
// other. Both the add and the decrement must be present.
check('the panel adds the wide class on mount',
  /classList\.add\('mpk-wide'\)/.test(source))
check('the panel removes the wide class only when the last instance unmounts',
  /if \(left > 0\)/.test(source) && /classList\.remove\('mpk-wide'\)/.test(source))
check('the wide class is set through an effect that cleans up',
  /React\.useEffect\(\(\) => \{[\s\S]{0,400}classList\.add\('mpk-wide'\)[\s\S]{0,400}return \(\) => \{/.test(source))

if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('PASS: clicking or hovering never re-measures the text it lands on')