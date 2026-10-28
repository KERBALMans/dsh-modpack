## What this changes

<!-- One or two sentences. The diff already says *what*; say *why*. -->

## Checklist

- [ ] `npm run check` passes
- [ ] Every `scripts/mutate-*.mjs` still passes (a new guard has a new mutation that kills it)
- [ ] No new runtime dependency
- [ ] If a route or a response shape changed, `API_VERSION` was bumped in **both** `index.js` and `client.js`
- [ ] If the panel changed, nothing layout-affecting was added to a hover / `[data-on]` / `[data-busy]` rule

See [CONTRIBUTING.md](../CONTRIBUTING.md) for why each of those exists.

## If this is a workaround

<!--
Anything done to survive a particular Harness build belongs here: which
version, what it does, and what would let it be removed later.
-->
