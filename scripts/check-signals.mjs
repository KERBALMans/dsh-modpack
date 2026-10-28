/**
 * check-signals.mjs — proves the description tier fires on real published prose.
 *
 * Why this file exists: the first version of the online classifier matched none
 * of the descriptions this harness's own official bundles publish on npm. Every
 * lookup came back empty, on a network that was working perfectly, and nothing
 * failed — the feature simply did nothing, which is the hardest kind of bug to
 * notice. A stub-based test cannot catch that: it can only prove the code
 * agrees with the strings we invented.
 *
 * So the strings below are copied verbatim from `registry.npmjs.org`, and the
 * rule table is sliced out of the shipped `index.js` rather than re-implemented.
 *
 *   node scripts/check-signals.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, '..', 'index.js')

const problems = []
function check(label, condition, detail) {
  if (!condition) problems.push(detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`)
}

const source = readFileSync(SOURCE, 'utf8')

/* Slice the shipped rule table and signal table out of index.js. */
function slice(fromMarker, toMarker) {
  const start = source.indexOf(fromMarker)
  const end = source.indexOf(toMarker, start + fromMarker.length)
  if (start < 0 || end < 0) {
    console.error(`FAIL: could not locate ${fromMarker} in index.js (did it get renamed?)`)
    process.exit(1)
  }
  return source.slice(start, end)
}

/**
 * One whole top-level declaration, closed at the first bracket alone in column 0.
 *
 * Declarations are sliced to their own closing bracket rather than to whatever
 * text follows them, because "whatever follows" is usually a doc comment and doc
 * comments get reworded. That is not hypothetical: the comment above
 * `classifyFromLocalReadme` was rewritten when the description tier landed, the
 * end marker stopped matching, and this file reported a missing function that
 * was still sitting in the source.
 */
function sliceBlock(opening) {
  const start = source.indexOf(opening)
  if (start < 0) {
    console.error(`FAIL: could not locate ${opening} in index.js (did it get renamed?)`)
    process.exit(1)
  }
  const close = source.slice(start).search(/\n[\]}]\n/)
  if (close < 0) {
    console.error(`FAIL: ${opening} has no closing bracket in column 0`)
    process.exit(1)
  }
  return source.slice(start, start + close + 3)
}

const rulesBlock = sliceBlock('const AUTO_RULES = [')
const signalsBlock = slice('const REMOTE_SIGNALS = {', '\nconst REMOTE_CACHE_FILE')

// `classifyRemote` is what the host actually calls; take it verbatim too, so a
// change to its tier order is exercised here rather than assumed correct. It
// reads READMEs through `readmeLede`, which is sliced for the same reason.
const classifyBlock = sliceBlock('function classifyRemote(meta, locale) {')
const ledeMaxBlock = slice('const README_LEDE_MAX', '\nconst README_FILES')
const ledeBlock = sliceBlock('function readmeLede(readme) {')

const helpers = `
  function wordish(text, hint) {
    if (typeof text !== 'string' || typeof hint !== 'string') return false
    const t = text.toLowerCase()
    const h = hint.toLowerCase()
    return t.includes(h)
  }
`

const exported = new Function(`${helpers}
${ledeMaxBlock}
${ledeBlock}
${rulesBlock}
${signalsBlock}
${classifyBlock}
return { AUTO_RULES, REMOTE_SIGNALS, classifyRemote, readmeLede }
`)()

const { AUTO_RULES, classifyRemote, readmeLede } = exported

/* ---- real published strings, copied from registry.npmjs.org ------------ */
const REAL = [
  ['@deepseek-ai/dsh-base',
    "The shared dsh core as a profile bundle: every profile's first patch layer, inserting the base services",
    '运行时核心'],
  ['@deepseek-ai/dsh-web-app',
    'The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugins',
    '运行时核心'],
  ['@deepseek-ai/dsh-subagent-codex',
    'One-shot Codex subagent provider over the official app-server protocol',
    '子智能体'],
  ['@deepseek-ai/dsh-experimental-terminal-bundle',
    'Keep shell processes alive across tool calls.',
    '终端与 Shell'],
  ['@deepseek-ai/dsh-experimental-tool-worktree',
    'Model tool that creates and enters a new Git worktree',
    'Git 与工作树'],
  ['@deepseek-ai/dsh-experimental-session-titles-bundle',
    'Refresh session titles as new human prompts arrive.',
    '会话标题'],
  // `experimental-` is an official naming prefix, not a description of what a
  // package does, so the rules were ordered to let function win: this bundle is
  // filed as translation, and only packages whose prefix is all we know (see
  // `dsh-experimental-ralph-bundle`) fall through to the experimental bucket.
  ['@deepseek-ai/dsh-experimental-cot-translation-bundle',
    'Experimental machine translation of expanded reasoning',
    '翻译'],
]

for (const [name, description, expected] of REAL) {
  // No keywords: this is how those packages are actually published, and the
  // description is the only evidence the classifier has to work with.
  const verdict = classifyRemote({ keywords: [], description, topics: [], readme: '' }, 'zh')
  const got = verdict ? verdict.name.zh : null
  check(`the real npm description of ${name} classifies`, got === expected,
    `expected ${expected}, got ${got}`)
  check(`the verdict for ${name} is evidenced by the description`,
    verdict && verdict.evidence === 'description', verdict && verdict.evidence)
}

/* ---- only the lede of a README may vote ------------------------------- *
 * Matching a whole README filed `@deepseek-ai/dsh-subagent-codex` under
 * terminals, because its body says "the complete terminal result" — meaning
 * *final*. Two more real examples: `dsh-windows-mcp` mentions "DSH's own plugin
 * manager" while telling you how to install it, and `dsh-aliyun-coupon` notes
 * that its Host half needs a toggle in the plugin manager. All three sentences
 * are about installing or developing the plugin, not about what it does. A
 * package's opening paragraph describes the package; the rest describes usage.
 * ----------------------------------------------------------------------- */
{
  const usage = 'Keeps shell processes alive across tool calls.'
  const install = "Install it with DSH's own plugin manager."

  const signalInBody = ['# my-plugin', '', 'A small helper.', '',
    '## Install', '', install, '', '## Usage', '', usage].join('\n')
  check('a signal that appears only after the lede does not classify',
    classifyRemote({ keywords: [], description: '', topics: [], readme: signalInBody }, 'zh') === null,
    (classifyRemote({ keywords: [], description: '', topics: [], readme: signalInBody }, 'zh') || {}).name)

  const signalInLede = [usage, '', '## Install', '', install].join('\n')
  const ledeVerdict = classifyRemote({ keywords: [], description: '', topics: [], readme: signalInLede }, 'zh')
  check('the same signal inside the lede does classify',
    ledeVerdict && ledeVerdict.name.zh === '终端与 Shell', ledeVerdict && ledeVerdict.name.zh)

  // A README that opens with a heading has no lede above it. Bailing out there
  // would hand back the entire slice — the very thing being prevented.
  const leadingHeading = ['## my-plugin', '', 'A small helper.', '',
    '## Usage', '', usage].join('\n')
  check('a file that opens with a heading still has its body excluded',
    classifyRemote({ keywords: [], description: '', topics: [], readme: leadingHeading }, 'zh') === null,
    (classifyRemote({ keywords: [], description: '', topics: [], readme: leadingHeading }, 'zh') || {}).name)

  check('readmeLede cuts at the first heading',
    readmeLede('# a\n\nx\n\n## H\n\nbody') === '# a\n\nx\n\n', readmeLede('# a\n\nx\n\n## H\n\nbody'))
  check('readmeLede handles a leading heading',
    readmeLede('## a\n\nx\n\n## H\n\nbody') === '## a\n\nx\n\n', readmeLede('## a\n\nx\n\n## H\n\nbody'))
  check('readmeLede caps a file with no heading at all',
    readmeLede('x'.repeat(4000)).length === 1500, readmeLede('x'.repeat(4000)).length)
}

/* ---- the tables must not have become one giant catch-all -------------- */
{
  // A description that says nothing must stay unclassified. If a rule were too
  // greedy, every plugin would land somewhere and nobody would notice the
  // classifier had stopped discriminating.
  const nothing = classifyRemote({ keywords: [], description: 'A thing.', topics: [], readme: '' }, 'zh')
  check('a contentless description classifies nothing', nothing === null, nothing && nothing.name.zh)

  const ruleIds = AUTO_RULES.map((r) => r.id)
  check('the catch-all rule is last', ruleIds[ruleIds.length - 1] === 'other', ruleIds.join(','))
  check('no rule is duplicated', new Set(ruleIds).size === ruleIds.length, ruleIds.join(','))
}

/* ---- the host's tier vocabulary and the panel's labels must agree ----- */
{
  // Two defects of the same shape shipped before this check existed: the
  // `readme` tier had no counter in the summary, so those rows were counted in
  // "assigned" but in none of the per-tier numbers; and it had no case in the
  // client's label chain, so the panel displayed the author's own prose as a
  // name guess. Both are invisible in a single file, which is why the assertion
  // is a cross-file one: the vocabulary is read out of the host and looked for
  // in the client, rather than being written down twice.
  const clientSource = readFileSync(join(HERE, '..', 'client.js'), 'utf8')

  // The vocabulary the panel reports — read from the counters themselves, so it
  // is whatever the host actually counts rather than a list kept in step by hand.
  const counters = [...source.matchAll(/^\s*(\w+): added\.filter\(\(item\) => item\.basis === '([a-z-]+)'\)/gm)]
  const vocab = [...new Set(counters.map((m) => m[2]))]
  check('the summary counts more than one tier', vocab.length >= 6, vocab.join(','))

  // Every basis the classifier can attach to a row. `tags` and `name` are chosen
  // by a ternary rather than written as a literal, so they are added explicitly —
  // otherwise the two tiers that started this whole check would be the two it
  // could not see.
  const emitted = new Set([...source.matchAll(/\bbasis: '([a-z-]+)'/g)].map((m) => m[1]))
  emitted.add('tags')
  emitted.add('name')
  for (const basis of emitted) {
    check(`rows classified as "${basis}" are counted in the summary`,
      vocab.includes(basis), `the summary counts ${vocab.join(', ')}`)
  }

  // The client turns a basis into a label through one chain of ternaries whose
  // fallback is the weakest claim of all. A tier missing from that chain is
  // therefore not shown as unknown — it is shown as a guess.
  const chainStart = clientSource.indexOf('const basisKey = (basis) =>')
  const chainEnd = clientSource.indexOf('// The breakdown matters more than the headline', chainStart)
  if (chainStart < 0 || chainEnd < 0) {
    console.error('FAIL: could not locate the client\'s basisKey chain in client.js (did it get renamed?)')
    process.exit(1)
  }
  const chain = clientSource.slice(chainStart, chainEnd)
  // The chain has no case for its own fallback — that is what `else` means. The
  // fallback is read off the last label it names rather than assumed to be
  // `name`, so that adding a case for `name` and demoting something else to the
  // fallback does not silently leave the demoted tier unlabelled.
  const fallbackLabel = (chain.match(/'autoBasis([A-Za-z]+)'/g) || []).pop() || ''
  const fallbackBasis = fallbackLabel.replace(/[^A-Za-z]/g, '').replace(/^autoBasis/, '').toLowerCase()
  check('the label chain ends in a fallback label', fallbackBasis.length > 0, fallbackLabel)
  for (const basis of vocab) {
    check(`the panel has a label for "${basis}"`,
      chain.includes(`basis === '${basis}'`) || basis === fallbackBasis,
      `it falls through to ${fallbackLabel || 'no label at all'}`)
  }

  // Each label has to exist in both dictionaries. A key defined only in `zh`
  // renders as the raw key name in an English client.
  const labelKeys = [...new Set([...chain.matchAll(/'(autoBasis[A-Za-z]+)'/g)].map((m) => m[1]))]
  check('the label chain names at least one label', labelKeys.length > 0)
  for (const key of labelKeys) {
    const definitions = clientSource.split(`${key}:`).length - 1
    check(`${key} is defined in both locales`, definitions >= 2, `${definitions} definition(s)`)
  }

  // And every counter has to be read somewhere, or the host computes a number
  // nobody ever sees.
  const counterNames = [...new Set(counters.map((m) => m[1]))]
  for (const name of counterNames) {
    check(`the panel reads the "${name}" counter`, clientSource.includes(`s.${name}`),
      `nothing in client.js reads s.${name}`)
  }
}

if (problems.length > 0) {
  console.error(`FAIL: ${problems.length} check(s) failed`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log('PASS: the description tier classifies the real npm prose of the official bundles,')
console.log('      and an empty description still classifies nothing')
