/**
 * mutate-metasource.mjs — shipped test tool.
 *
 * Proves `check-metasource.mjs` and the tier-vocabulary half of
 * `check-signals.mjs` can actually fail.
 *
 * The fix these guard is the loudest complaint the plugin ever got — "为什么还有
 * 这么多插件无法判断" — and its shape (try more roots; read the package's own
 * description instead of guessing from its name) is exactly the kind a test
 * written next to it will agree with no matter what. The second half is the same
 * story one layer up: a tier that is classified but not counted, or counted but
 * not labelled, produces a panel that quietly misreports its own evidence.
 *
 * Two files are involved, so a mutation says which one it edits and which check
 * has to notice. The original bytes of both are restored after every mutation,
 * including on failure.
 *
 *   node scripts/mutate-metasource.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeEol } from './source-text.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const FILES = {
  host: join(ROOT, 'index.js'),
  client: join(ROOT, 'client.js'),
}

const MUTATIONS = [
  {
    name: 'the archive roots are never built',
    file: 'host',
    check: 'check-metasource.mjs',
    why: 'seven of sixteen real plugins would go back to being guessed from their names, which is the bug the user reported',
    edits: [[
      "    roots.push(join(resources, 'app.asar', 'dsh', 'node_modules'))\n    roots.push(join(resources, 'app.asar', 'node_modules'))",
      '    void resources',
    ]],
  },
  {
    name: 'the offline pass never reads the package description',
    file: 'host',
    check: 'check-metasource.mjs',
    why: 'the only functional signal an official bundle ships would go unused, and every one of them would need a network lookup or a guess',
    edits: [[
      '  return classifyFromLocalDescription(row) || classifyFromLocalReadme(row) || base',
      '  return classifyFromLocalReadme(row) || base',
    ]],
  },
  {
    name: 'a description match is reported as the author\'s keywords',
    file: 'host',
    check: 'check-metasource.mjs',
    why: 'the panel would claim the author tagged the package, when the evidence was a sentence of prose',
    edits: [["      basis: 'desc',", "      basis: 'tags',"]],
  },
  {
    name: 'the description tier matches the package name instead',
    file: 'host',
    check: 'check-metasource.mjs',
    why: 'the tier would then be a second name guess wearing the label of evidence',
    edits: [[
      '      matched = signal.hints.some((hint) => wordish(description, hint))',
      '      matched = signal.hints.some((hint) => wordish(row.name, hint))',
    ]],
  },
  {
    name: 'a tier is classified but never counted',
    file: 'host',
    check: 'check-signals.mjs',
    why: 'those rows would appear in "assigned" and in none of the per-tier numbers, so the panel would under-report how many rows it actually justified',
    edits: [[
      "      fromReadme: added.filter((item) => item.basis === 'readme').length,\n",
      '',
    ]],
  },
  {
    name: 'a tier the host reports has no label on the panel',
    file: 'client',
    check: 'check-signals.mjs',
    why: 'a missing case falls through to the weakest label, so the author\'s own description would be shown as a guess about the name',
    edits: [[
      "        basis === 'tags' ? 'autoBasisTags'\n          : basis === 'desc' ? 'autoBasisDesc'\n",
      "        basis === 'tags' ? 'autoBasisTags'\n",
    ]],
  },
  {
    name: 'a label exists in one language only',
    file: 'client',
    check: 'check-signals.mjs',
    why: 'an English client would render the raw key name where the Chinese one shows a sentence',
    edits: [[
      "        autoBasisDesc: \"from the plugin's own description\",\n",
      '',
    ]],
  },
  {
    name: 'a counter is computed and never read',
    file: 'client',
    check: 'check-signals.mjs',
    why: 'the host would work out how many rows a tier accounted for and then throw the number away',
    edits: [[
      "      if (s.fromReadme) parts.push(t('autoFromReadme', s.fromReadme))\n",
      '',
    ]],
  },
  {
    name: 'Loader entries are not given the package they came from',
    file: 'host',
    check: 'check-autocat.mjs',
    why: 'every Loader entry would look like it has no name at all, which is exactly how 215 real plugins all fell into 其他',
    edits: [[
      '    name: packageNameOf(p.moduleName),',
      '    name: null,',
    ]],
  },
  {
    name: 'a subpath entry keeps its subpath as the package name',
    file: 'host',
    check: 'check-autocat.mjs',
    why: '`@scope/pkg/tools` is not a package, so the entry would be classified from a name no package ever had',
    edits: [[
      "  return value.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]",
      '  return value',
    ]],
  },
  {
    name: 'the description tier goes back to reading only bundles',
    file: 'host',
    check: 'check-autocat.mjs',
    why: 'the author\'s own description would be ignored for every Loader entry, so the profile would fall back to name guesses',
    edits: [[
      '  const own = [row.title, row.description]',
      "  if (row.kind !== 'bundle') return null\n  const own = [row.title, row.description]",
    ]],
  },
  {
    name: 'the plugin rows go back to carrying no package name',
    file: 'host',
    check: 'check-autocat.mjs',
    why: 'every Loader entry would lose the package it came from, and with it the description, the README and the code digest',
    edits: [[
      '    name: packageNameOf(p.moduleName),',
      '    name: null,',
    ]],
  },
  {
    name: 'a subpath module is used as if it were the package name',
    file: 'host',
    check: 'check-autocat.mjs',
    why: 'dsh-plugin-manager/tools would be looked up as a package of its own and never resolve, so subpath entries would be guessed from their full spec',
    edits: [[
      "  return value.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]",
      '  return value',
    ]],
  },
  {
    name: 'the host ignores the profile the launcher passed in',
    file: 'host',
    check: 'check-profileroot.mjs',
    why: 'on the desktop client every package installed into the running profile becomes unreadable, which is the "everything I installed is 无法判断" bug',
    edits: [[
      "    if (profile && typeof profile.dir === 'string' && profile.dir) profileDirOverride = profile.dir",
      '    void profile',
    ]],
  },
  {
    name: 'the profile override is written but never read back',
    file: 'host',
    check: 'check-profileroot.mjs',
    why: 'the same wrong directory as before, reached by a longer route: the fix would look applied and change nothing',
    edits: [[
      '  if (profileDirOverride) return profileDirOverride\n',
      '',
    ]],
  },
]

// `raws` is what is on disk and what gets restored; `originals` is the same
// text with CRLF collapsed, because the patterns below are authored in LF.
// See scripts/source-text.mjs.
const raws = new Map(Object.entries(FILES).map(([key, path]) => [key, readFileSync(path, 'utf8')]))
const originals = new Map([...raws].map(([key, text]) => [key, normalizeEol(text)]))
let survived = 0

try {
  for (const mutation of MUTATIONS) {
    const key = mutation.file || 'host'
    const original = originals.get(key)
    let next = original
    let ok = true

    for (const [from, to] of mutation.edits) {
      const hits = next.split(from).length - 1
      if (hits !== 1) {
        console.log(`SKIP  ${mutation.name}`)
        console.log(`      pattern matched ${hits} times in ${key}, expected exactly 1:`)
        console.log(`      ${from.split('\n')[0].slice(0, 90)}`)
        ok = false
        survived += 1
        break
      }
      next = next.replace(from, to)
    }
    if (!ok) continue

    writeFileSync(FILES[key], next, 'utf8')

    let failed = false
    let output = ''
    try {
      execFileSync(process.execPath, [join(HERE, mutation.check)], { encoding: 'utf8' })
    } catch (err) {
      failed = true
      output = String((err.stdout || '') + (err.stderr || ''))
    }

    writeFileSync(FILES[key], raws.get(key), 'utf8')

    if (failed) {
      const lines = output.split('\n').filter((line) => /^\s*(-|✗)\s/.test(line))
      console.log(`KILLED ${mutation.name}`)
      for (const line of lines.slice(0, 2)) console.log(`      ${line.trim()}`)
    } else {
      console.log(`SURVIVED ${mutation.name}`)
      console.log(`      why it matters: ${mutation.why}`)
      survived += 1
    }
  }
} finally {
  for (const [key, path] of Object.entries(FILES)) writeFileSync(path, raws.get(key), 'utf8')
}

if (survived > 0) {
  console.error(`\nFAIL: ${survived}/${MUTATIONS.length} mutation(s) were not caught`)
  process.exit(1)
}
console.log(`\nPASS: all ${MUTATIONS.length} mutations were caught`)