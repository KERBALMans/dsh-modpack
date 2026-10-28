#!/usr/bin/env node
/**
 * Assert that the built tarball actually contains the files it must contain.
 *
 * This exists because the same assertion written as shell failed on CI while
 * every part of it passed:
 *
 *     TGZ=$(ls dist/*.tgz 2>/dev/null || ls *.tgz)
 *     tar -tzf "$TGZ" | grep -q 'package/index.js'
 *
 * GitHub's `shell: bash` runs with `-o pipefail`. `grep -q` exits the moment it
 * matches, which closes the read end of the pipe; `tar` then dies of EPIPE and
 * reports 2, and pipefail turns that into a failed step. Nothing about the
 * artifact was wrong — the check reported the shape of the pipeline, not the
 * shape of the tarball. On top of that, the `ls` fallback silently yields an
 * empty `TGZ` when neither glob matches, and `tar -tzf ""` also exits 2, so the
 * two failure modes were indistinguishable in the log.
 *
 * `execFileSync` has no pipeline to break: it buffers the whole listing and
 * returns it. Running it in Node also means the same code checks the artifact
 * on Windows and Linux, which is the point of the matrix in the first place.
 *
 *   node scripts/check-tarball.mjs
 *
 * Reads `dist/dsh-modpack-<version>.tgz` (built by `scripts/pack.mjs`); does
 * not build it, because a check that writes files is not a check.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tgz = join(root, 'dist', `dsh-modpack-${pkg.version}.tgz`)

if (!existsSync(tgz)) {
  console.error(`FAIL: no tarball at ${tgz}`)
  console.error('      run `node scripts/pack.mjs` first — this script only inspects what is there')
  process.exit(1)
}

// Same normalisation as pack.mjs: bsdtar on Windows emits CRLF, and a stray \r
// would make every name comparison fail in a way that looks like a missing file.
const entries = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter((entry) => entry && !entry.endsWith('/'))

const problems = []

// A release that ships a plugin missing its entry point installs cleanly and
// then does nothing — the worst possible failure, because nothing errors.
for (const required of ['package/index.js', 'package/client.js', 'package/cordis.patch.yml']) {
  if (!entries.includes(required)) problems.push(`missing from the tarball: ${required}`)
}

// Everything `package.json#files` promises has to be in there too, not just the
// three entry points: a locale that does not ship means an untranslated panel,
// and a missing README means an npm page with no explanation. Glob entries are
// checked by `pack.mjs` (which owns glob expansion); here only the literal ones
// and the implicit `package.json` can be asserted without duplicating that.
const inTarball = new Set(entries.map((entry) => entry.replace(/^package\//, '')))
for (const entry of pkg.files) {
  if (entry.includes('*')) continue
  if (!inTarball.has(entry)) problems.push(`in files[] but not in the tarball: ${entry}`)
}
if (!inTarball.has('package.json')) problems.push('in files[] but not in the tarball: package.json')

if (problems.length) {
  for (const problem of problems) console.error(`FAIL: ${problem}`)
  console.error('tarball contains:', [...inTarball].sort().join(', '))
  process.exit(1)
}

console.log(`PASS: the tarball carries the entry points and everything files[] promises (${entries.length} entries)`)
