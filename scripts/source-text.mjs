/**
 * Reading the plugin's own source, independent of how it was checked out.
 *
 * Every check script slices declarations out of `index.js` and `client.js`
 * with markers written as `\n...`, and several of them — plus every
 * `mutate-*` script — match multi-line source text literally. Those patterns
 * are authored in LF.
 *
 * Git does not promise LF in the working tree. `core.autocrlf=true` (the
 * default suggested by Git for Windows) converts on checkout, so the same
 * commit produces LF on `ubuntu-latest` and CRLF on `windows-latest`. Markers
 * that span a line break then stop matching, and the failure is misleading:
 * `check-signals.mjs` reported "const AUTO_RULES = [ has no closing bracket
 * in column 0" for a file that plainly has one, and the mutation runners
 * reported PATTERN-MISSING, which scores a real guard as unproven.
 *
 * `.gitattributes` pins `eol=lf` so a normal clone is already correct. This
 * module is the belt to that braces: it normalises on read, so the checks
 * describe the code rather than the checkout, and they behave the same in a
 * CRLF tree, a ZIP export, or a tarball unpacked on Windows.
 *
 * Write the mutated text back with `readSource`/`writeFileSync` as-is. The
 * mutate scripts restore the untouched original afterwards, so the file on
 * disk keeps whatever line endings it arrived with.
 */
import { readFileSync } from 'node:fs'

/** Collapse CRLF to LF. */
export function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n')
}

/** Read a text file with CRLF collapsed to LF. */
export function readSource(path) {
  return normalizeEol(readFileSync(path, 'utf8'))
}
