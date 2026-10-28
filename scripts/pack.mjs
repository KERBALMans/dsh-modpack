#!/usr/bin/env node
/**
 * Build the two release artifacts from the manifests, not from a hand-typed
 * file list.
 *
 * The 0.6.1 zip shipped `scripts/_scan-utf8.cjs` — a one-off diagnostic from an
 * encoding accident — because the zip had been assembled by hand and nobody
 * re-derived the list. `scripts/repo-manifest.mjs` now owns the definition, and
 * both this script and `publish-github.mjs` read it. A file that belongs in
 * neither surface cannot sneak in, and one added to `files` cannot be
 * forgotten.
 *
 *   node scripts/pack.mjs
 *
 * Writes:
 *   dist/dsh-modpack-<version>.tgz   npm layout:   package/…
 *   dist/dsh-modpack-v<version>.zip  repository:   dsh-modpack/…
 *
 * This is a build tool, not a check: it is deliberately not part of `npm test`,
 * because it writes files.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { missingFiles, repoFiles, shippedFiles } from './repo-manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dist = join(root, 'dist')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

const shipped = shippedFiles(root, pkg)
const repo = repoFiles(root, pkg)

const absent = missingFiles(root, [...new Set([...shipped, ...repo])])
if (absent.length) {
  console.error('listed in a manifest but missing on disk:')
  for (const rel of absent) console.error(`  ${rel}`)
  process.exit(1)
}

const stage = join(dist, `.stage-${version}`)
rmSync(stage, { recursive: true, force: true })

function copyInto(target, list) {
  const dest = join(stage, target)
  for (const rel of list) {
    const to = join(dest, rel)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(join(root, rel), to)
  }
  return dest
}

const tgz = join(dist, `dsh-modpack-${version}.tgz`)
const zip = join(dist, `dsh-modpack-v${version}.zip`)
copyInto('package', shipped)
copyInto('dsh-modpack', repo)
rmSync(tgz, { force: true })
rmSync(zip, { force: true })

// bsdtar (shipped with Windows 10+) writes both; `-a` picks the format from the
// extension. `-C` keeps the single top-level folder and drops the staging path.
execFileSync('tar', ['-czf', tgz, '-C', join(stage), 'package'])
execFileSync('tar', ['-a', '-cf', zip, '-C', join(stage), 'dsh-modpack'])
rmSync(stage, { recursive: true, force: true })

// bsdtar emits CRLF on Windows, so a plain split('\n') leaves \r on every
// entry but the last — which makes a name comparison fail for all of them and
// look like a missing-file bug.
const list = (file) => execFileSync('tar', ['-tf', file], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  // bsdtar also lists the directories it created; they are not files, and
  // counting them would make every comparison below silently wrong.
  .filter((entry) => entry && !entry.endsWith('/'))
const tgzEntries = list(tgz)
const zipEntries = list(zip)
console.log(`tgz  ${tgzEntries.length} entries -> ${tgz}`)
console.log(`zip  ${zipEntries.length} entries -> ${zip}`)

// A tarball's root must be `package/`, or npm installs it as a folder named
// whatever it feels like; the zip's root must be the repo folder for the same
// reason when someone unpacks it to upload.
const wrongTgz = tgzEntries.filter((e) => !e.startsWith('package/'))
const wrongZip = zipEntries.filter((e) => !e.startsWith('dsh-modpack/'))
if (wrongTgz.length) { console.error('not under package/:', wrongTgz); process.exit(1) }
if (wrongZip.length) { console.error('not under dsh-modpack/:', wrongZip); process.exit(1) }

// Nothing may be shipped that is not in the manifests, and nothing in the npm
// surface may be missing from the tarball.
const inTgz = new Set(tgzEntries.map((e) => e.replace(/^package\//, '')))
const missing = shipped.filter((rel) => !inTgz.has(rel))
if (missing.length) {
  // Both sides, because "X is missing" is unhelpful when the real answer is
  // that every name on one side has a prefix or a separator the other lacks.
  console.error('in files[] but not in the tarball:', missing)
  console.error('tarball contains:', [...inTgz].sort())
  process.exit(1)
}
const inZip = new Set(zipEntries.map((e) => e.replace(/^dsh-modpack\//, '')))
const extraInZip = [...inZip].filter((rel) => !repo.includes(rel))
if (extraInZip.length) {
  console.error('in the zip but in no manifest:', extraInZip)
  console.error('zip contains:', [...inZip].sort())
  process.exit(1)
}

console.log(`OK  tgz = files[] + package.json (${shipped.length}), zip = the repository (${repo.length})`)

// Docs carry literal versions in copy-paste commands, and those rot silently:
// the 0.7.0 release shipped README and UPLOAD-GUIDE text still telling people to
// install 0.6.1. A version string that is not this version is wrong unless it is
// naming a past release on purpose, and the only place that is legitimate is the
// changelog — which is not scanned.
const DOCS = ['README.md', 'UPLOAD-GUIDE.md']
const stale = []
for (const doc of DOCS) {
  const text = readFileSync(join(root, doc), 'utf8')
  for (const [, found] of text.matchAll(/dsh-modpack-v?(\d+\.\d+\.\d+)/g)) {
    if (found !== version) stale.push(`${doc}: ${found}`)
  }
}
if (stale.length) {
  console.error(`stale version strings (expected ${version}):`)
  for (const line of [...new Set(stale)]) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`OK  ${DOCS.join(' + ')} mention only ${version}`)
