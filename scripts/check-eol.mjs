/**
 * check-eol.mjs — the suite must behave the same in a CRLF checkout.
 *
 * The bug this guards shipped in 0.9.0 and was caught by CI, not locally.
 *
 * Every check script slices declarations out of `index.js` and `client.js`
 * using markers written as `\n...`, and several of them — plus every
 * `mutate-*` script — match multi-line source text literally. Those patterns
 * are authored in LF. Git does not promise LF in the working tree: with
 * `core.autocrlf=true` (Git for Windows suggests it) the same commit produces
 * CRLF, so on `windows-latest` the closing-bracket scan `/\n[\]}]\n/` never
 * matched and `check-signals.mjs` failed with
 *
 *     FAIL: const AUTO_RULES = [ has no closing bracket in column 0
 *
 * for a file that plainly has one. The mutation runners did the same thing
 * more quietly: they reported PATTERN-MISSING and scored working guards as
 * unproven. Both are environment bugs that look like code bugs, which is the
 * worst kind to hand a contributor.
 *
 * Two things are asserted here, and they fail for different reasons:
 *
 *   1. `.gitattributes` pins `eol=lf`, so a normal clone is already correct.
 *      Without it, a fresh Windows clone of the repository is CRLF and every
 *      Windows contributor sees a red suite that the maintainer cannot
 *      reproduce.
 *
 *   2. The scripts normalise on read anyway. `.gitattributes` is the fix, but
 *      it only covers what git produces; a ZIP export, a tarball unpacked on
 *      Windows, or an editor that rewrites line endings all bypass it. The
 *      normalisation is what makes the suite describe the code rather than the
 *      checkout.
 *
 * The second assertion is not a text search. The scripts are actually run
 * against a temporary copy of the plugin whose source has been converted to
 * CRLF, and the run must stay green — the same experiment that reproduced the
 * failure.
 *
 *   node scripts/check-eol.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const problems = []
function check(label, condition, detail) {
  if (!condition) problems.push(detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`)
}

/* ---- 1. the repository pins LF ---------------------------------------- */

// Read defensively: a missing `.gitattributes` is exactly the regression this
// file exists to report, and it should be reported as a failed assertion
// rather than as an ENOENT stack trace from the checker itself.
let attributes = ''
try {
  attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8')
} catch {
  attributes = ''
}
const rule = attributes
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line.startsWith('* ') && /\beol=lf\b/.test(line))
check(
  'the repository forces LF in the working tree on every platform',
  Boolean(rule),
  attributes
    ? attributes.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).join(' | ')
    : '.gitattributes is missing or empty',
)

// A catch-all that does not cover text is the same bug with a longer file.
check(
  'the rule is a catch-all rather than a list of extensions',
  Boolean(rule) && /^\*\s/.test(rule),
  rule,
)

/* ---- 2. the scripts survive a CRLF checkout --------------------------- */

// Only the files a check script reads are converted. Converting the docs too
// would prove nothing extra and makes the copy slower.
const CONVERT = [
  'index.js',
  'client.js',
  'package.json',
  'cordis.patch.yml',
  'scripts/source-text.mjs',
]

const sandbox = mkdtempSync(join(tmpdir(), 'dsh-modpack-eol-'))

try {
  mkdirSync(join(sandbox, 'scripts'), { recursive: true })
  mkdirSync(join(sandbox, 'locale'), { recursive: true })

  const toCrlf = (text) => text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')

  for (const rel of CONVERT) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    writeFileSync(join(sandbox, rel), toCrlf(text), 'utf8')
  }
  for (const rel of ['locale/zh.json', 'locale/en.json', 'icon.svg', 'LICENSE']) {
    copyFileSync(join(ROOT, rel), join(sandbox, rel))
  }

  // Every shipped check and mutation script, converted as well — the scripts
  // themselves are read by nothing, but a CRLF script is what a Windows
  // contributor actually has on disk.
  const scripts = readFileSync(join(ROOT, 'package.json'), 'utf8')
  const listed = JSON.parse(scripts).files.filter((entry) => entry.startsWith('scripts/') && entry.endsWith('.mjs'))
  for (const rel of listed) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    writeFileSync(join(sandbox, rel), toCrlf(text), 'utf8')
  }

  // The conversion has to be real, or the run below proves nothing.
  const converted = readFileSync(join(sandbox, 'index.js'), 'utf8')
  check('the sandbox really is CRLF', converted.includes('\r\n'), converted.slice(0, 40))

  function run(script) {
    try {
      execFileSync(process.execPath, [join(sandbox, 'scripts', script)], {
        cwd: sandbox,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { ok: true, output: '' }
    } catch (err) {
      return { ok: false, output: String((err.stdout || '') + (err.stderr || '')) }
    }
  }

  // The one that failed first, and the cheapest to run: it slices the largest
  // block out of index.js and is where the closing-bracket scan lives.
  const signals = run('check-signals.mjs')
  check(
    'check-signals.mjs passes against a CRLF checkout',
    signals.ok,
    signals.output.split('\n').filter((line) => line.trim()).slice(0, 3).join(' | '),
  )

  // And a mutation runner, because they fail differently: a CRLF tree makes
  // their multi-line patterns match zero times, which is scored as a surviving
  // mutation rather than as an error.
  const mutate = run('mutate-compat.mjs')
  check(
    'a mutation runner still finds its patterns in a CRLF checkout',
    mutate.ok,
    mutate.output.split('\n').filter((line) => line.trim()).slice(-3).join(' | '),
  )
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error('FAIL: the suite depends on the checkout, not the code:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('PASS: the suite behaves the same in an LF and a CRLF checkout')
