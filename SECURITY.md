# Security

## What this plugin can do

Being straight with you matters more than a short policy, so here is the whole
surface.

`dsh-modpack` runs in two places, and both are trusted code inside your Harness
process:

- **The host half (`index.js`)** is a normal Harness plugin. It can read your
  profile directory, read the `package.json` and entry files of installed
  plugins (that is how it classifies them), write modpack files under
  `storages/dsh-modpack/`, and — only when you press install — call the
  `pluginManager` service to add bundles to your profile.
- **The client half (`client.js`)** is JavaScript that runs in the settings
  page. It can call the routes below and nothing else.

There is no sandbox between the host half and the rest of your machine. That is
true of every Harness plugin, not a property of this one. Install plugins the
same way you install software: from people you have reason to trust, after
looking at what they do.

## The routes

Everything the client half can ask for, all under `/api/dsh-modpack`:

| Route | Method | Effect |
| --- | --- | --- |
| `/diag` | GET | Read-only: paths, versions, capability flags. |
| `/inventory` | GET | Read-only: what is installed, with classification. |
| `/saved` | GET | Read-only: the modpack files already in `storages/`. |
| `/categories` | GET | Read-only: the category tree. |
| `/categories/suggest` | POST | Dry run: proposes a tree. Writes nothing. |
| `/categories/save` | POST | The only write to the category tree. |
| `/categories/forget` | POST | Forget a cached remote result. |
| `/pack` | POST | Assemble a modpack document from a selection. |
| `/save` | POST | Write one `.dshmodpack.json` under `storages/`. |
| `/load` | POST | Read one saved modpack back. |
| `/delete` | POST | Delete one saved modpack. |
| `/plan` | POST | Dry run: what a modpack would install. No writes. |
| `/apply` | POST | Install a modpack: the only route that changes your profile. |

There is no route that runs a shell command, no route that takes a filesystem
path from the request, and no route that fetches an arbitrary URL. Every request
is admitted through the host's own `connection` service when the build has one —
the same gate the rest of the Harness UI goes through; `/diag` reports which
mode is in force. On a build without that service the plugin falls back to the
plain "the server is listening on loopback" posture, which is what Harness
plugins have always had. Network access is limited to the npm registry metadata
and GitHub README fetches that the online-classification step uses, and both are
off unless you turn them on.

## Things worth knowing before you install

**`/apply` installs code.** That is what a modpack is. The preview shows you the
exact list of packages and versions before anything happens, and installation
goes through the `pluginManager` service rather than writing into your profile
directly — so it is subject to the same checks any other install is. Still: only
install modpacks you would install package by package.

**The AI classification step sends metadata to your model provider.** When you
enable it, the plugin sends package names, descriptions, keywords, and a short
excerpt of each plugin's entry file and README to whatever model the host's
`llm` service is configured with. It does not send your modpacks, your category
names, your file paths, or your conversation. The excerpt is capped (a few KB per
plugin, at most 30 plugins per run) and the request goes through the host's own
model configuration, so your usual provider and data policy apply.

**The online classification step talks to the public npm registry.** It looks up
`registry.npmjs.org` for package descriptions and fetches READMEs from
`raw.githubusercontent.com`. Those are ordinary outbound HTTPS requests that
reveal the package names you have installed. Both steps are off by default and
are per-run switches, not settings that stick.

**Nothing is phoned home.** There is no telemetry, no analytics, no update
check, and no server operated by this project. The plugin makes no request you
did not trigger.

## Reporting a vulnerability

Open a private security advisory on this repository
(*Security* → *Report a vulnerability*), or open an issue if the problem is not
sensitive. Please include the version, what you expected, and what happened.

There is no bounty and no response-time promise — this is a small project — but
security reports get looked at first.

## Supported versions

Only the latest release is supported. Fixes ship as a new version; there are no
backports, because there is exactly one maintainer and old versions are one
`npm install` away from being upgraded.
