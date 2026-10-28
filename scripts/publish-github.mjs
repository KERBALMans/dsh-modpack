#!/usr/bin/env node
/**
 * Publish dsh-modpack to GitHub.
 *
 * There is no `git` binary on this machine, so this script talks to the GitHub
 * Git Data API directly and builds one clean initial commit (blobs -> tree ->
 * commit -> ref) instead of dribbling the files out one commit at a time.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> node scripts/publish-github.mjs [owner/repo]
 *
 * The token is read from the environment and is never written to disk, never
 * logged, and never embedded in anything this script uploads.
 *
 * Required token permissions:
 *   - classic PAT:            `repo`  (plus `read:user`)
 *   - fine-grained PAT:       Repository permissions -> Administration: Read and
 *                             write (to create the repo), Contents: Read and
 *                             write (to push files)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { missingFiles, repoFiles } from './repo-manifest.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
if (!token) {
  console.error('Missing GITHUB_TOKEN (or GH_TOKEN).')
  console.error('Create a Personal Access Token at https://github.com/settings/tokens')
  console.error('then run:  GITHUB_TOKEN=... node scripts/publish-github.mjs')
  process.exit(2)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const target = process.argv[2] || pkg.name
const [ownerArg, repoArg] = target.includes('/') ? target.split('/') : [null, target]

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': `${pkg.name}-publisher`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text } }
  return { status: res.status, ok: res.ok, body: parsed }
}

/** Every file that belongs in the repository, in a stable order. */
const repoPaths = () => repoFiles(ROOT, pkg)

async function main() {
  console.log(`↻ verifying token`)
  const me = await api('GET', '/user')
  if (!me.ok) {
    console.error(`✗ token rejected (${me.status}): ${me.body?.message || 'unknown error'}`)
    process.exit(1)
  }
  const owner = ownerArg || me.body.login
  const repo = repoArg
  console.log(`✓ authenticated as ${me.body.login}`)

  // Stamp the real URLs into package.json before uploading. Shipping a
  // placeholder would publish a package whose `repository` link 404s, and the
  // file that lands in the repo is the one everybody reads. Writing it here
  // keeps the source copy honest too — a second run is a no-op.
  const repoUrl = `https://github.com/${owner}/${repo}`
  const wanted = {
    repository: { type: 'git', url: `git+${repoUrl}.git` },
    bugs: { url: `${repoUrl}/issues` },
    homepage: `${repoUrl}#readme`,
  }
  let stamped = false
  for (const [key, value] of Object.entries(wanted)) {
    if (JSON.stringify(pkg[key]) === JSON.stringify(value)) continue
    pkg[key] = value
    stamped = true
  }
  if (stamped) {
    // Preserve the file's 2-space formatting and trailing newline.
    writeFileSync(join(ROOT, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    console.log(`✓ stamped repository URLs into package.json for ${owner}/${repo}`)
  }

  console.log(`↻ ensuring ${owner}/${repo} exists`)
  const created = await api('POST', '/user/repos', {
    name: repo,
    description: pkg.description,
    homepage: `https://github.com/${owner}/${repo}`,
    private: false,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: false,
  })
  if (created.ok) {
    console.log(`✓ created https://github.com/${owner}/${repo}`)
  } else if (created.status === 422) {
    console.log(`• repository already exists, reusing it`)
  } else {
    console.error(`✗ could not create repository (${created.status}): ${created.body?.message || ''}`)
    if (created.status === 403) console.error('  the token needs permission to create repositories')
    process.exit(1)
  }

  const paths = repoPaths()
  const absent = missingFiles(ROOT, paths)
  if (absent.length) {
    console.error('✗ listed in a manifest but missing on disk:')
    for (const rel of absent) console.error(`  ${rel}`)
    process.exit(1)
  }
  console.log(`↻ uploading ${paths.length} files`)

  const tree = []
  for (const path of paths) {
    const content = readFileSync(join(ROOT, path))
    const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64',
    })
    if (!blob.ok) {
      console.error(`✗ blob failed for ${path} (${blob.status}): ${blob.body?.message || ''}`)
      process.exit(1)
    }
    tree.push({ path: path.split('\\').join('/'), mode: '100644', type: 'blob', sha: blob.body.sha })
    console.log(`  • ${path}`)
  }

  const newTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree })
  if (!newTree.ok) {
    console.error(`✗ tree failed (${newTree.status}): ${newTree.body?.message || ''}`)
    process.exit(1)
  }

  // Preserve history when the branch already exists, so re-running this after
  // an edit simply adds a commit instead of orphaning the previous one.
  const parents = []
  const existing = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/main`)
  if (existing.ok) parents.push(existing.body.object.sha)
  else if (existing.status !== 404) console.log(`• could not read main (${existing.status}), starting a fresh history`)

  const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
    message: parents.length
      ? `Update ${pkg.name} to ${pkg.version}`
      : `${pkg.name} ${pkg.version}\n\n${pkg.description}`,
    tree: newTree.body.sha,
    parents,
  })
  if (!commit.ok) {
    console.error(`✗ commit failed (${commit.status}): ${commit.body?.message || ''}`)
    process.exit(1)
  }

  const ref = parents.length
    ? await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/main`, { sha: commit.body.sha, force: false })
    : await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: 'refs/heads/main', sha: commit.body.sha })
  if (!ref.ok) {
    console.error(`✗ ref update failed (${ref.status}): ${ref.body?.message || ''}`)
    process.exit(1)
  }

  console.log(`\n✓ published ${paths.length} files in one commit`)
  console.log(`  https://github.com/${owner}/${repo}`)
  console.log(`  commit ${commit.body.sha.slice(0, 7)}`)
  console.log(`\nNext: add the \`dsh-plugin\` topic so other Harness users can find it:`)
  console.log(`  https://github.com/${owner}/${repo}/settings`)
}

main().catch((err) => {
  console.error(`✗ ${(err && err.stack) || err}`)
  process.exit(1)
})