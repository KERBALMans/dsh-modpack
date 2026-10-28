/**
 * One definition of "what belongs in this repository".
 *
 * Two tools need that answer and they must not disagree:
 *
 *   - `scripts/pack.mjs` builds the release zip, which is what people who do
 *     not use npm unpack and upload;
 *   - `scripts/publish-github.mjs` uploads the repository through the GitHub
 *     API, file by file.
 *
 * When they each kept their own list, a file could reach GitHub and be missing
 * from the zip (or the reverse), and the 0.6.1 zip shipped a stray diagnostic
 * script for exactly that reason. So the list lives here and both read it.
 *
 * Two surfaces, on purpose:
 *
 *   shipped  — what `package.json#files` promises an npm consumer: the two
 *              halves, the patch, locales, the icon, the checks, the docs.
 *   repoOnly — files that only make sense next to the source: CI, issue
 *              templates, the ignore rules, and the two build tools themselves.
 *
 * `package.json` is never listed in `files` because npm adds it implicitly —
 * which is precisely why a hand-built tarball forgets it and the package then
 * cannot be installed at all. It is added here, once, for both surfaces.
 */
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Expand one `files` entry, which may be a literal path or a `dir/*.ext` glob.
 *
 * Globs are expanded by extension rather than by a pattern library: the two
 * manifest formats must agree byte for byte, and a dependency here would be the
 * only one in the package.
 */
export function expandEntry(root, entry) {
  if (!entry.includes('*')) return [entry]
  const dir = dirname(entry)
  const ext = entry.slice(entry.indexOf('*') + 1)
  let names
  try {
    names = readdirSync(join(root, dir))
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith(ext))
    .map((name) => `${dir}/${name}`)
}

/** Everything npm publishes, plus `package.json`. */
export function shippedFiles(root, pkg) {
  const listed = pkg.files.flatMap((entry) => expandEntry(root, entry))
  return [...new Set([...listed, 'package.json'])].sort()
}

/**
 * Repository-only paths. Directories are expanded recursively, so adding a
 * second workflow file does not require editing this list.
 */
export const REPO_ONLY = [
  '.gitattributes',
  '.gitignore',
  '.github',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'GITHUB-COPY.md',
  'scripts/pack.mjs',
  'scripts/check-tarball.mjs',
  'scripts/publish-github.mjs',
  'scripts/repo-manifest.mjs',
]

function walk(root, rel, out) {
  const abs = join(root, rel)
  let stat
  try {
    stat = statSync(abs)
  } catch {
    return
  }
  if (stat.isDirectory()) {
    for (const name of readdirSync(abs)) walk(root, `${rel}/${name}`, out)
    return
  }
  out.push(rel)
}

/** Everything the GitHub repository should contain. */
export function repoFiles(root, pkg) {
  const listed = pkg.files.flatMap((entry) => expandEntry(root, entry))
  const extra = []
  for (const rel of REPO_ONLY) walk(root, rel, extra)
  return [...new Set([...listed, ...extra, 'package.json'])].sort()
}

/**
 * Paths that are named in a manifest but do not exist on disk.
 *
 * A missing file is worse than a stray one: `cpSync` and the blob upload both
 * fail late, after some output has already been produced, and the message names
 * a path nobody typed.
 */
export function missingFiles(root, paths) {
  return paths.filter((rel) => {
    try {
      return !statSync(join(root, rel)).isFile()
    } catch {
      return true
    }
  })
}
