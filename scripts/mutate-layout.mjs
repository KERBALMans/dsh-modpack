/**
 * mutate-layout.mjs — shipped test tool.
 *
 * Proves `check-layout.mjs` can actually fail.
 *
 * This one matters more than most, because the defect it guards was invisible to
 * every other check in the suite. The plugin worked, the classification was
 * right, the panel rendered — and yet clicking a tab made the tabs shuffle, and
 * clicking a filter chip made the chip row re-flow. Nothing was *broken*; things
 * merely moved. A test written next to that fix will happily agree with it
 * forever, so each way the movement can come back is re-introduced here and has
 * to be caught:
 *
 *   - bold as the active state (the original bug, on a tab and on a tree node),
 *   - letter-spacing as the active state (the same mistake in different clothes,
 *     which is why the check forbids a whole class of properties, not one),
 *   - a button that swaps its label and therefore its width,
 *   - a stack of labels that stops being a stack,
 *   - a hidden label or hidden tools that leave the flow instead of reserving it.
 *
 * All edits are confined to client.js and its original bytes are restored after
 * every mutation, including on failure.
 *
 *   node scripts/mutate-layout.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeEol } from './source-text.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIENT = join(ROOT, 'client.js')

const TAB = '.mpk-tab[data-on="1"]{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}'
const NODE = '.mpk-node[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent);color:var(--dsw-alias-brand-primary)}'
const CHIP = '.mpk-chip[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}'
const STROKE = '.mpk-tab[data-on="1"],.mpk-chip[data-on="1"],.mpk-seg button[data-on="1"],.mpk-diag-box[data-on="1"],.mpk-node[data-on="1"]{text-shadow:0 0 .6px currentColor}'

const MUTATIONS = [
  {
    name: 'a tab signals its active state by getting bolder',
    why: 'this is the exact bug the user reported: the clicked tab gains width, so every tab after it slides sideways',
    edits: [[TAB, TAB.replace('}', ';font-weight:600}')]],
  },
  {
    name: 'an active tree node is emphasised with bold',
    why: 'the label grows under the cursor, so the nodes below it re-wrap',
    edits: [[NODE, NODE.replace('}', ';font-weight:600}')]],
  },
  {
    name: 'an active chip is stretched with letter-spacing',
    why: 'the same mistake in different clothes — which is why the check forbids a class of properties rather than font-weight alone',
    edits: [[CHIP, CHIP.replace('}', ';letter-spacing:.03em}')]],
  },
  {
    name: 'the metrics-neutral stroke is dropped',
    why: 'the tint would be left to carry the whole active state, and the next person to want it louder would reach for font-weight again',
    edits: [[`${STROKE}\n`, '']],
  },
  {
    name: 'the stroke covers four of the five states',
    why: 'the forgotten state keeps its tint but no longer reads as active, inviting the bold back for that one selector',
    edits: [[STROKE, STROKE.replace(',.mpk-node[data-on="1"]{', '{')]],
  },
  {
    name: 'a busy button goes back to swapping its label',
    why: 'the button resizes the moment it is clicked, so the whole action row jumps while the work runs',
    edits: [[
      "              }, busyLabel(busy, t('exportFile'), t('loading'))),",
      "              }, busy ? el('span', null, el('span', { className: 'mpk-spin' }), t('loading')) : t('exportFile')),",
    ]],
  },
  {
    name: 'the two labels stop sharing one grid cell',
    why: 'laid out in a row, the container is as wide as both labels at once, and the button is permanently oversized',
    edits: [['.mpk-swap{display:inline-grid;', '.mpk-swap{display:flex;']],
  },
  {
    name: 'the hidden label leaves the flow instead of reserving its space',
    why: 'the button would be as wide as whichever label is currently visible, which is the resize the stack was built to prevent',
    edits: [['.mpk-swap > [data-on="0"]{visibility:hidden}', '.mpk-swap > [data-on="0"]{display:none}']],
  },
  {
    name: 'the tree row tools hide by leaving the flow',
    why: 'pointing at a row shoves that row\'s count sideways',
    edits: [[
      '.mpk-node-tools{display:flex;visibility:hidden;flex:none;gap:1px}',
      '.mpk-node-tools{display:none;flex:none;gap:1px}',
    ]],
  },
  {
    name: 'hovering a tree row re-flows it',
    why: 'the reveal is done by re-laying-out the row rather than by making the reserved space visible',
    edits: [['.mpk-node:hover .mpk-node-tools{visibility:visible}', '.mpk-node:hover .mpk-node-tools{display:flex}']],
  },
  {
    name: 'the tree card goes back to scrolling as a whole',
    why: 'the panel and its action row are back inside the scroller, so growing the panel pushes the buttons below the fold of a box that does not look scrollable',
    edits: [['.mpk-tree{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);overflow:hidden;overflow:clip}',
      '.mpk-tree{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);overflow:auto;max-height:420px}']],
  },
  {
    name: 'the panel moves back inside the scrolling body',
    why: 'source order is what decides containment: emitted after the body div opens, the panel scrolls with the nodes again',
    edits: [[
      "        el(AutoCategorize, {\n          t,\n          locale: locale || 'zh',\n          notify,\n          onApply: (next) => onChange(next),\n        }),\n\n        el('div', { className: 'mpk-tree-body' },",
      "        el('div', { className: 'mpk-tree-body' },\n        el(AutoCategorize, {\n          t,\n          locale: locale || 'zh',\n          notify,\n          onApply: (next) => onChange(next),\n        }),",
    ]],
  },
  {
    name: 'the footer goes back to being a wrapping row',
    why: 'the sentence shares a line box with the buttons again, which is the ragged block users reported as a layout problem',
    edits: [['.mpk-autocat-foot{display:flex;flex-direction:column;gap:8px;margin:12px -14px -10px;padding:8px 14px 10px;position:sticky;bottom:0;z-index:3;background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l1)}',
      '.mpk-autocat-foot{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}']],
  },
  {
    name: 'the action row stops wrapping',
    why: 'five buttons on one unwrapping line overflow the container and are clipped rather than moved to a second line',
    edits: [['.mpk-autocat-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}',
      '.mpk-autocat-actions{display:flex;align-items:center;gap:6px;justify-content:flex-end}']],
  },
  {
    name: 'the category column goes back to being a side rail',
    why: 'a rail is narrower than the five-button action row, which is what clipped "应用这个分类" in the first place',
    edits: [['.mpk-stack{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.mpk-stack{display:flex;flex-direction:row;gap:12px;min-width:0}']],
  },
  {
    name: 'the tree goes back to clipping with overflow:hidden alone',
    why: 'hidden still creates a scroll container, so the sticky footer inside the tree resolves against the tree instead of the dialog and parks itself below the visible dialog box',
    edits: [['background:var(--dsw-alias-bg-base);overflow:hidden;overflow:clip}',
      'background:var(--dsw-alias-bg-base);overflow:hidden}']],
  },
  {
    name: 'the clip fallback is ordered after the clip declaration',
    why: 'an engine that understands both would then use hidden, reintroducing the nested scroll container while the source still looks fixed',
    edits: [['background:var(--dsw-alias-bg-base);overflow:hidden;overflow:clip}',
      'background:var(--dsw-alias-bg-base);overflow:clip;overflow:hidden}']],
  },
  {
    name: 'the auto-classify footer stops sticking',
    why: 'without position:sticky the action row scrolls out of the dialog as the panel grows, which is exactly the "点不了应用最新分类" report',
    edits: [['padding:8px 14px 10px;position:sticky;bottom:0;z-index:3;',
      'padding:8px 14px 10px;z-index:3;']],
  },
  {
    name: 'the sticky footer is pinned to the top instead of the bottom',
    why: 'sticking to the top detaches the action row from the end of the panel and leaves it over the options above',
    edits: [['position:sticky;bottom:0;z-index:3;',
      'position:sticky;top:0;z-index:3;']],
  },
  {
    name: 'the settings dialog keeps its hard-coded 800px width',
    why: 'the plugin section can never be wider than its parent, so the tree stays at ~525px and the category column is not "独占一整行"',
    edits: [['html.mpk-wide [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]{width:min(1200px,calc(100vw - 64px))}',
      'html.mpk-wide [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]{width:800px}']],
  },
  {
    name: 'the width rule leaks out of the mounted class',
    why: 'an unscoped selector widens every settings dialog in the product, including the ones this plugin does not own',
    edits: [['html.mpk-wide [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]{width:min(1200px,calc(100vw - 64px))}',
      '[role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]{width:min(1200px,calc(100vw - 64px))}']],
  },
  {
    name: 'the wide class is added but never removed',
    why: 'the dialog stays wide after the panel unmounts, and every later settings tab inherits a width it did not ask for',
    edits: [["          if (left > 0) {\n            root.dataset.mpkWide = String(left)\n          } else {\n            delete root.dataset.mpkWide\n            root.classList.remove('mpk-wide')\n          }",
      "          root.dataset.mpkWide = String(left)\n          root.classList.remove('mpk-wide')"]],
  },
  {
    name: 'the wide class is removed on any unmount, ignoring the ref count',
    why: 'the component is registered in two slots, so the first one to unmount strips the width off the other and the dialog collapses mid-session',
    edits: [["          if (left > 0) {\n            root.dataset.mpkWide = String(left)\n          } else {\n            delete root.dataset.mpkWide\n            root.classList.remove('mpk-wide')\n          }",
      "          delete root.dataset.mpkWide\n          root.classList.remove('mpk-wide')"]],
  },
]

// `raw` is the file exactly as checked out and is what gets restored; the
// patterns are authored in LF, so they are matched against `original`. See
// scripts/source-text.mjs for why that distinction exists.
const raw = readFileSync(CLIENT, 'utf8')
const original = normalizeEol(raw)
let survived = 0

try {
  for (const mutation of MUTATIONS) {
    let next = original
    let ok = true

    for (const [from, to] of mutation.edits) {
      const hits = next.split(from).length - 1
      if (hits !== 1) {
        console.log(`SKIP  ${mutation.name}`)
        console.log(`      pattern matched ${hits} times in client.js, expected exactly 1:`)
        console.log(`      ${from.slice(0, 90)}`)
        ok = false
        survived += 1
        break
      }
      next = next.replace(from, to)
    }
    if (!ok) continue

    writeFileSync(CLIENT, next, 'utf8')

    let failed = false
    let output = ''
    try {
      // stderr is captured rather than inherited: check-layout writes its
      // failure report there, and inheriting it would print every expected
      // failure as if the run had gone wrong.
      execFileSync(process.execPath, [join(HERE, 'check-layout.mjs')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      failed = true
      output = String((err.stdout || '') + (err.stderr || ''))
    }

    writeFileSync(CLIENT, raw, 'utf8')

    if (failed) {
      const lines = output.split('\n').filter((line) => /^\s*-\s/.test(line))
      console.log(`KILLED ${mutation.name}`)
      for (const line of lines.slice(0, 2)) console.log(`      ${line.trim()}`)
    } else {
      console.log(`SURVIVED ${mutation.name}`)
      console.log(`      why it matters: ${mutation.why}`)
      survived += 1
    }
  }
} finally {
  writeFileSync(CLIENT, raw, 'utf8')
}

if (survived > 0) {
  console.error(`\nFAIL: ${survived}/${MUTATIONS.length} mutation(s) were not caught`)
  process.exit(1)
}
console.log(`\nPASS: all ${MUTATIONS.length} mutations were caught`)