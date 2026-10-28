/**
 * check-online-ui.mjs — the investigation switches must exist, default to OFF,
 * and actually reach the request.
 *
 * Two bugs are guarded here, of the same shape.
 *
 * The first: the host half grew an `online` flag and the route honoured it, but
 * `client.js` never sent it. Everything looked finished — the endpoint worked,
 * the tests were green — and the feature was unreachable from the UI. A
 * substring check for the word "online" would have passed against the broken
 * file too, so this test *runs* the component.
 *
 * The second: the run used to start on the first click, which meant the
 * conditions were chosen *after* the click that acted on them. The check that
 * matters is therefore negative — opening the options must send nothing at all,
 * and only the explicit start button may spend tokens or touch the network.
 *
 *   node scripts/check-online-ui.mjs
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

/* ---- extract the shipped component ------------------------------------ */

const marker = 'function AutoCategorize({'
const start = source.indexOf(marker)
if (start < 0) {
  console.error('FAIL: could not find `AutoCategorize` in client.js')
  process.exit(1)
}

// The parameter list itself contains braces (`{ t, locale, ... }`), so the
// first `{` after the name is NOT the body. Walk the parentheses first.
let parens = 0
let bodyStart = -1
for (let i = source.indexOf('(', start); i < source.length; i += 1) {
  if (source[i] === '(') parens += 1
  else if (source[i] === ')') {
    parens -= 1
    if (parens === 0) { bodyStart = source.indexOf('{', i); break }
  }
}
if (bodyStart < 0) {
  console.error('FAIL: could not locate the body of `AutoCategorize`')
  process.exit(1)
}
let depth = 0
let end = -1
for (let i = bodyStart; i < source.length; i += 1) {
  if (source[i] === '{') depth += 1
  else if (source[i] === '}') {
    depth -= 1
    if (depth === 0) { end = i + 1; break }
  }
}
if (end < 0) {
  console.error('FAIL: could not read the body of `AutoCategorize`')
  process.exit(1)
}
const body = source.slice(start, end)

/* ---- a hooks runtime small enough to trust ---------------------------- */

function createRuntime() {
  const states = []
  let cursor = 0
  let rerender = () => {}

  const React = {
    useState(init) {
      const i = cursor++
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init
      const set = (value) => {
        states[i] = typeof value === 'function' ? value(states[i]) : value
        rerender()
      }
      return [states[i], set]
    },
    createElement: () => null,
  }

  const el = (type, props, ...children) => ({ type, props: props || {}, children })

  // Every request the component makes, in order.
  const requests = []
  // Knob for the "the AI rung had nothing to do" case. A fixed response can
  // only ever prove the happy path renders.
  let aiOverride = null
  const call = (path, payload) => {
    requests.push({ path, payload })
    if (path === '/categories/forget') return Promise.resolve({ ok: true })
    return Promise.resolve({
      ok: true,
      doc: { nodes: [], assignments: {} },
      added: [],
      summary: {
        total: 0, assigned: 0, kept: 0, overwrote: 0,
        fromTags: 0, fromName: 0, fromFact: 0, fromRemote: 0, fromAi: 0,
        unclassified: 0, newCategories: 0,
      },
      remote: { candidates: 0, looked: 0, found: 0, cached: 0, failed: 0, skipped: 0 },
      ai: aiOverride || {
        available: true, asked: 3, found: 2, failed: 0, reason: null,
        provider: 'test-provider', model: 'test-model',
        inputTokens: 100, outputTokens: 20, withCode: 2,
      },
    })
  }

  const t = (key, a, b) => (typeof a === 'number' ? `${key}(${a},${b})` : key)
  const notify = () => {}

  const AutoCategorize = new Function(
    'React', 'el', 'call', 't', 'locale', 'onApply', 'notify',
    `return (${body})`,
  )(React, el, call, t, 'zh', () => {}, notify)

  return {
    AutoCategorize,
    requests,
    setAi(override) { aiOverride = override },
    render(props) {
      cursor = 0
      return AutoCategorize(props)
    },
    setRerender(fn) { rerender = fn },
  }
}

/* ---- walk the element tree -------------------------------------------- */

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) findAll(child, predicate, out)
  return out
}

function buttonByText(tree, text) {
  return findAll(tree, (n) => n.type === 'button' && String(n.children.join('')).includes(text))[0]
}

function boxes(tree) {
  return findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox')
}

// What the user can actually read. `findAll` deliberately skips strings (they
// are not elements), and `JSON.stringify` would also match prop values — which
// is not the same claim as "this text is on screen".
function textOf(node) {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return (node.children || []).map(textOf).join(' ')
}

/* ---- 1. closed: one button, nothing sent ------------------------------ */

const rt = createRuntime()
const props = () => ({ t: (k) => k, locale: 'zh', onApply: () => {}, notify: () => {} })
let tree = rt.render(props())
rt.setRerender(() => { tree = rt.render(props()) })

const openBtn = buttonByText(tree, 'autoOpen')
check('closed state renders the auto-classify button', Boolean(openBtn))
check('closed state sends no request', rt.requests.length === 0, rt.requests)

/* ---- 2. opening the options must not start anything -------------------- */

await openBtn.props.onClick()
check('opening the options issues NO request', rt.requests.length === 0, rt.requests)

const optionBoxes = boxes(tree)
check('options render five switches (overwrite/online/ai/source/reason)', optionBoxes.length === 5, optionBoxes.length)
check('options render a start button', Boolean(buttonByText(tree, 'autoStart')))
check('options render a cancel button', Boolean(buttonByText(tree, 'autoCancel')))
check('options do not render the preview button yet', !buttonByText(tree, 'autoPreview'))

// Source reading is meaningless without a model to read it, so the switch must
// be visibly disabled rather than accept a tick and quietly do nothing. The
// reasoning rung derives its facts from that same source read, so it inherits
// the same rule — and it is drawn *below* source, so the order of the two
// switches is part of what is being checked here.
const sourceBox = optionBoxes[3]
check('the source switch starts disabled while AI is off', sourceBox && sourceBox.props.disabled === true,
  sourceBox && sourceBox.props.disabled)
check('the source switch starts unchecked', sourceBox && sourceBox.props.checked === false)
const reasonBox = optionBoxes[4]
check('the reasoning switch starts disabled while AI is off', reasonBox && reasonBox.props.disabled === true,
  reasonBox && reasonBox.props.disabled)
check('the reasoning switch starts unchecked', reasonBox && reasonBox.props.checked === false)

/* ---- 3. the default request is offline, model-free, non-destructive ---- */

const startBtn = buttonByText(tree, 'autoStart')
await startBtn.props.onClick()
check('start issues exactly one suggest request', rt.requests.length === 1, rt.requests)
const first = rt.requests[0] || {}
const p0 = first.payload || {}
check('the request targets /categories/suggest', first.path === '/categories/suggest', first.path)
check('online defaults to FALSE', p0.online === false, p0)
check('ai defaults to FALSE', p0.ai === false, p0)
check('source defaults to FALSE', p0.source === false, p0)
check('reason defaults to FALSE', p0.reason === false, p0)
check('overwrite defaults to FALSE', p0.overwrite === false, p0)

/* ---- 4. each switch reaches the request -------------------------------- */

rt.requests.length = 0
buttonByText(tree, 'autoOptionsShort').props.onClick()
check('the preview can go back to the options', Boolean(buttonByText(tree, 'autoStart')))

// Toggle every box on, then start again and read the payload.
for (const box of boxes(tree)) box.props.onChange({ target: { checked: true } })
await buttonByText(tree, 'autoStart').props.onClick()
const all = rt.requests[rt.requests.length - 1]
const pa = (all && all.payload) || {}
check('overwrite reaches the request', pa.overwrite === true, pa)
check('online reaches the request', pa.online === true, pa)
check('ai reaches the request', pa.ai === true, pa)
check('source reaches the request once AI is on', pa.source === true, pa)
check('the reasoning rung reaches the request', pa.reason === true, pa)

/* ---- 4b. the reasoning rung turns source on by itself ------------------- */

// The rung is built out of the entry file, so a reasoning tick without a source
// tick would ask the host to reason about a file it was told not to read. The
// host forces it on as well, but the panel must not show a combination it is
// quietly rewriting underneath the user.
rt.requests.length = 0
buttonByText(tree, 'autoOptionsShort').props.onClick()
boxes(tree)[3].props.onChange({ target: { checked: false } })
check('unticking source leaves the reasoning rung ticked', boxes(tree)[4].props.checked === true)
boxes(tree)[4].props.onChange({ target: { checked: true } })
check('ticking the reasoning rung ticks source too', boxes(tree)[3].props.checked === true,
  boxes(tree)[3].props.checked)
await buttonByText(tree, 'autoStart').props.onClick()
const pr = (rt.requests[rt.requests.length - 1] || {}).payload || {}
check('the reasoning rung never travels without source', pr.reason === true && pr.source === true, pr)

/* ---- 5. AI off must clear source --------------------------------------- */

rt.requests.length = 0
buttonByText(tree, 'autoOptionsShort').props.onClick()
const aiBox = boxes(tree)[2]
aiBox.props.onChange({ target: { checked: false } })
const afterOff = boxes(tree)
check('switching AI off disables the source switch', afterOff[3].props.disabled === true,
  afterOff[3].props.disabled)
check('switching AI off clears the source tick', afterOff[3].props.checked === false,
  afterOff[3].props.checked)
check('switching AI off disables the reasoning switch', afterOff[4].props.disabled === true,
  afterOff[4].props.disabled)
check('switching AI off clears the reasoning tick', afterOff[4].props.checked === false,
  afterOff[4].props.checked)
await buttonByText(tree, 'autoStart').props.onClick()
const po = (rt.requests[rt.requests.length - 1] || {}).payload || {}
check('a cleared source does not travel', po.source === false && po.ai === false, po)
check('a cleared reasoning rung does not travel', po.reason === false, po)

/* ---- 6. the preview reports what the model actually did ---------------- */

const previewTree = tree
check('preview renders exactly one switch (overwrite)', boxes(previewTree).length === 1,
  boxes(previewTree).length)
check('preview renders a forget-cache button', Boolean(buttonByText(previewTree, 'autoForget')))
check('preview renders a change-options button', Boolean(buttonByText(previewTree, 'autoOptionsShort')))
check('preview names the model that was asked',
  textOf(previewTree).includes('test-model'),
  textOf(previewTree).slice(0, 400))
check('preview reports the token cost',
  textOf(previewTree).includes('autoAiTokens'), textOf(previewTree).slice(0, 400))

/* ---- 6b. an AI rung with nothing to do says so out loud ----------------- */

// The healthy outcome on a real profile: offline and online filed every row, so
// no tokens were spent. Rendered as nothing at all, a ticked box would look
// broken to the person who ticked it.
rt.setAi({ available: true, candidates: 0, asked: 0, found: 0, failed: 0, reason: null, provider: null, model: null })
await buttonByText(previewTree, 'autoOptionsShort').props.onClick()
await buttonByText(tree, 'autoStart').props.onClick()
const nothingTree = rt.render(props())
check('an AI rung with no candidates explains itself instead of going silent',
  textOf(nothingTree).includes('autoAiNothing'), textOf(nothingTree).slice(0, 500))
check('the no-candidate line does not name a model that never answered',
  !textOf(nothingTree).includes('test-model'), textOf(nothingTree).slice(0, 500))
rt.setAi(null)

rt.requests.length = 0
const forgetBtn = buttonByText(previewTree, 'autoForget')
if (forgetBtn) await forgetBtn.props.onClick()
const forgetReq = rt.requests[0]
check('forget calls /categories/forget', forgetReq && forgetReq.path === '/categories/forget', forgetReq)

/* ---- 7. both locales define every key this component uses -------------- */

const NEW_KEYS = [
  'autoBasisRemote', 'autoFromRemote', 'autoOnline', 'autoOnlineHint',
  'autoOnlineRan', 'autoOnlineNone', 'autoOnlineFail', 'autoForget',
  'autoForgetDone', 'autoForgetHint', 'autoAiNothing',
  'autoOpen', 'autoOptionsShort', 'autoOptionsTitle', 'autoOptionsIntro',
  'autoOptOffline', 'autoOptSource', 'autoOptSourceHint', 'autoOptAi',
  'autoOptAiHint', 'autoOptNeedAi', 'autoStart', 'autoRunning',
  'autoAiUnavailable', 'autoAiNoModel', 'autoAiFailed', 'autoAiRan',
  'autoAiTokens', 'autoAiCode', 'autoBasisAi', 'autoFromAi',
]
for (const key of NEW_KEYS) {
  const hits = source.split(new RegExp(`\\b${key}\\s*:`)).length - 1
  check(`i18n key ${key} is defined in both locales`, hits >= 2, hits)
}

/* ---- 8. every t() key this component asks for actually exists ---------- */

// A missing key renders as the raw key text in the panel. Collect the literal
// keys the component passes to t() and confirm each one is defined twice.
const used = new Set()
for (const match of body.matchAll(/\bt\(\s*'([A-Za-z][A-Za-z0-9]*)'/g)) used.add(match[1])
for (const key of used) {
  const hits = source.split(new RegExp(`\\b${key}\\s*:`)).length - 1
  check(`key used by the component is defined in both locales: ${key}`, hits >= 2, hits)
}

/* ---- report ----------------------------------------------------------- */

if (problems.length > 0) {
  console.error('FAIL: the auto-classify UI is not wired correctly:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('PASS: the investigation switches exist, all default to OFF, the options step')
console.log('      sends nothing until start, every switch reaches the request, and the')
console.log('      preview names the model, its cost and the route it called.')