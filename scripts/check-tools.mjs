/**
 * Mounts the host half against a fake Cordis context and asserts the three
 * agent tools reach `tools.register` with a shape the host actually accepts.
 *
 * This exists because the tools once failed *silently*: the definitions were
 * built with `defineTool` from `@deepseek-ai/dsh-tools`, which is not a
 * resolvable specifier for a profile-installed plugin. The dynamic import
 * threw, the `catch` swallowed it, and the plugin still loaded and served its
 * UI — so nothing looked wrong while the agent tools never existed.
 *
 * Run:  node scripts/check-tools.mjs
 */

const TOOL_NAMES = ['modpack_list', 'modpack_export', 'modpack_apply']

/** Tool names the host reserves for itself. */
const RESERVED = new Set(['run_code'])

const registered = []

const fakeTools = {
  register(definition) {
    registered.push(definition)
    return () => {}
  },
}

/** A context that exposes only `tools`; every other service stays absent, so
 *  this also exercises the degraded paths rather than a happy-path mock. */
const ctx = {
  get(name) {
    return name === 'tools' ? fakeTools : undefined
  },
  effect(fn) {
    const disposer = fn()
    return typeof disposer === 'function' ? disposer : () => {}
  },
}

const failures = []
const fail = (message) => failures.push(message)

const mod = await import('../index.js')

if (typeof mod.apply !== 'function') {
  console.error('FAIL: index.js does not export an `apply` function')
  process.exit(1)
}

mod.apply(ctx)

// `registerTools` is async, so give any leftover microtasks a chance to run.
await new Promise((resolve) => setTimeout(resolve, 0))

/* ---- assertions ---------------------------------------------------- */

if (registered.length !== TOOL_NAMES.length) {
  fail(`expected ${TOOL_NAMES.length} tools registered, got ${registered.length} (${registered.map((t) => t.name).join(', ') || 'none'})`)
}

for (const expected of TOOL_NAMES) {
  const tool = registered.find((t) => t.name === expected)
  if (!tool) {
    fail(`tool \`${expected}\` was not registered`)
    continue
  }

  if (RESERVED.has(tool.name)) fail(`tool \`${tool.name}\` collides with a host-reserved name`)
  if (typeof tool.description !== 'string' || tool.description.trim() === '') {
    fail(`tool \`${tool.name}\` has no description`)
  }

  // `parameters` is projected verbatim to the model, so it must already BE a
  // JSON Schema — not the field-map that `defineTool` used to compile.
  const params = tool.parameters
  if (params === null || typeof params !== 'object') {
    fail(`tool \`${tool.name}\` has no parameters schema`)
  } else {
    if (params.type !== 'object') fail(`tool \`${tool.name}\`: parameters.type must be "object", got ${JSON.stringify(params.type)}`)
    if (params.properties === null || typeof params.properties !== 'object') {
      fail(`tool \`${tool.name}\`: parameters.properties must be an object`)
    } else {
      for (const [key, spec] of Object.entries(params.properties)) {
        if (spec === null || typeof spec !== 'object' || typeof spec.type !== 'string') {
          fail(`tool \`${tool.name}\`: property \`${key}\` is not a JSON Schema fragment`)
        }
      }
    }
    // The exact shape of the old bug: a field-map with `required: true` on a
    // property instead of a top-level `required` array.
    for (const [key, spec] of Object.entries(params.properties || {})) {
      if (spec && spec.required !== undefined) {
        fail(`tool \`${tool.name}\`: property \`${key}\` uses the old field-map \`required\` flag`)
      }
    }
  }

  // The host validates exactly these two things.
  if (tool.output === null || typeof tool.output !== 'object') {
    fail(`tool \`${tool.name}\` has no output contract`)
    continue
  }
  if (tool.output.schema === null || typeof tool.output.schema !== 'object') {
    fail(`tool \`${tool.name}\`: output.schema must be a JSON Schema object`)
  }
  if (typeof tool.output.render !== 'function') {
    fail(`tool \`${tool.name}\`: output.render must be a function`)
    continue
  }

  let blocks
  try {
    blocks = tool.output.render({}, { ok: true })
  } catch (err) {
    fail(`tool \`${tool.name}\`: output.render threw — ${(err && err.message) || String(err)}`)
    continue
  }
  if (!Array.isArray(blocks) || blocks.length === 0 || typeof blocks[0]?.text !== 'string') {
    fail(`tool \`${tool.name}\`: output.render must return text content blocks`)
  }

  if (typeof tool.execute !== 'function') fail(`tool \`${tool.name}\` has no execute function`)
}

/* ---- report -------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} problem(s)\n`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`PASS: ${registered.length}/${TOOL_NAMES.length} tools registered with a host-valid shape`)
for (const tool of registered) console.log(`  - ${tool.name}`)