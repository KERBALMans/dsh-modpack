# Contributing

Thanks for looking. This plugin is deliberately small — two files, no
dependencies — and most of the value is in its checks. Reading this page before
sending a patch will save you a round trip.

## The shape of the code

| File | Runs where | What it is |
| --- | --- | --- |
| `index.js` | Host (Node) | The whole backend: inventory, pack/plan/apply, the category tree, the classification pipeline, the HTTP routes. |
| `client.js` | Browser (ESM) | The settings panel. One React component plus its CSS, registered into a slot. |
| `cordis.patch.yml` | Host | The one-line patch that mounts the host half. |
| `locale/*.json` | Both | Category names in both languages. UI strings are inline in `client.js`. |

The two halves talk over `/api/dsh-modpack/*`. `API_VERSION` in each file is the
handshake: if the browser is holding an older `client.js` than the host is
serving, the panel says "reload" instead of failing one button at a time. If you
add a route or change a response shape, bump it in **both** files — `check-future.mjs`
fails if they disagree.

## Ground rules

**No runtime dependencies.** `package.json` has no `dependencies` block and
should keep it that way. The plugin is installed into other people's Harness
profiles; every dependency is a chance for their install to break on a version
conflict. Node built-ins and what the host injects are all you get.

**Never invent a classification.** The classifier may only pick an id from the
closed vocabulary in `AUTO_RULES`. "I don't know" is a valid, expected answer
(`none`), and the UI shows those rows separately. A confident wrong label is
worse than an honest blank, because the user cannot tell it is wrong.

**Say where an answer came from.** Every classified row carries a `basis`
(`tags` / `desc` / `readme` / `name` / `fact` / `remote` / `ai` / `none`) and the
`why` text must match that basis. If the label came from the package name, the
explanation must not claim it read the README.

**A guard without a test is a comment.** Anything defensive — a `try/catch`
around a service that may be reshaped, a `typeof` check before calling a method
that may not exist — needs a scenario in the matching `check-*.mjs` that fails
when the guard is removed. `mutate-*.mjs` is how we prove the check can fail.

## Running the tests

There is nothing to install.

```bash
npm run check          # every check script, in order
npm test               # same thing
```

Individual checks are plain Node scripts with no framework:

```bash
node scripts/check-future.mjs
```

To prove a check actually tests what it claims:

```bash
node scripts/mutate-future.mjs     # breaks each guard, expects the check to fail
```

The `mutate-*` scripts edit the real source files, run the check, and restore
the original bytes in a `finally` block — including when the run fails. Do not
run two of them at once.

CI (`.github/workflows/ci.yml`) runs the same commands on Node 20 and 22, on
Linux and Windows.

## Adding a check

Most checks follow the same pattern, and it is worth copying it:

1. **Read the shipped source, do not re-implement it.** A test that restates the
   logic only proves the restatement works. Slice the function out of
   `client.js` / `index.js` and evaluate it (see `sliceFunction` in
   `check-future.mjs`), or mount the real plugin against a fake context.
2. **Mount, don't mock the world.** `check-compat.mjs` and `check-future.mjs`
   both build a small synthetic `ctx` with only the services the code touches.
   That is what makes it possible to test "what happens on a Harness that does
   not have this service" at all.
3. **One assertion, one sentence, in the user's terms.** Failure output is read
   by whoever broke the build, often months later. `"an older host that reports
   no number is NOT a mismatch"` beats `"expected null, got {host:null}"`.
4. **Add a mutation.** If you cannot think of an edit that would make the new
   check fail, the check is not testing anything yet.

## Changing the UI

The panel has one hard rule, learned the expensive way: **no layout-affecting
CSS property in a stateful selector.** Hover, `[data-on]` and `[data-busy]` may
change colour, background, border colour and `text-shadow` — never `font-weight`,
`font-size`, `letter-spacing` or `padding`. A selected tab that gets bolder is
wider, and the whole row of tabs shifts under the pointer mid-click. That was a
real bug, reported as "the buttons move when I click them", and it took three
releases to find.

`scripts/check-layout.mjs` enforces this. It also checks that buttons swap their
label through a fixed-width grid (`visibility:hidden`, not `display:none`), so
the box does not resize when the text changes.

## Commit messages and pull requests

No template, but a sentence on *why* is worth more than a sentence on *what* —
the diff already says what. If a change is a workaround for something in
Harness, say which version and what it does, so it can be removed later.

## Releasing

1. Bump `version` in `package.json` **and** `PLUGIN_VERSION` in `index.js`.
2. Add a `CHANGELOG.md` section (newest first).
3. `npm run check` — all checks and every mutation must pass.
4. `node scripts/pack.mjs` — writes `dist/*.tgz` and `dist/*.zip`, and refuses
   to build if the docs still name a different version.
5. Tag, and attach the two artifacts to the GitHub release.

`node scripts/publish-github.mjs` does the whole upload through the GitHub API
if you do not have `git` installed; see `UPLOAD-GUIDE.md`.
