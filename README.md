<p align="center">
  <a href="https://yarnpkg.com/">
    <img alt="Yarn audit fix" src="https://github.com/antongolub/yarn-audit-fix/blob/master/img/yarn-audit-fix.png?raw=true" width="546">
  </a>
</p>

<h1 align="center">
  yarn-audit-fix
</h1>

[![CI](https://github.com/antongolub/yarn-audit-fix/actions/workflows/ci.yaml/badge.svg?event=push)](https://github.com/antongolub/yarn-audit-fix/actions/workflows/ci.yaml)
[![Maintainability](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/maintainability)](https://codeclimate.com/github/antongolub/yarn-audit-fix/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/test_coverage)](https://codeclimate.com/github/antongolub/yarn-audit-fix/test_coverage)
[![Sonar](https://sonarcloud.io/api/project_badges/measure?project=antongolub_yarn-audit-fix&metric=alert_status)](https://sonarcloud.io/dashboard?id=antongolub_yarn-audit-fix)
[![Known Vulnerabilities](https://snyk.io/test/github/antongolub/yarn-audit-fix/badge.svg)](https://snyk.io/test/github/antongolub/yarn-audit-fix)
[![Downloads](https://img.shields.io/npm/dt/yarn-audit-fix)](https://www.npmjs.com/package/yarn-audit-fix)
[![npm (tag)](https://img.shields.io/npm/v/yarn-audit-fix)](https://www.npmjs.com/package/yarn-audit-fix)

The missing `yarn audit fix`

- [Digest](#digest)
   - [Problem](#problem)
   - [Solution](#solution)
   - [Key features](#key-features)
- [Getting started](#getting-started)
   - [Requirements](#requirements)
   - [Install](#install)
   - [CLI](#cli)
   - [ENV](#env)
   - [JS API](#js-api)
- [Migration notes](#migration-notes)
   - [^11.0.0](#1100)
   - [^10.0.0](#1000)
   - [^9.0.0](#900)
   - [^8.0.0](#800)
   - [^7.0.0](#700)
   - [^6.0.0](#600)
   - [^4.0.0](#400)
- [⚠️ Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Digest
### Problem
1. `yarn audit` detects vulnerabilities but cannot fix them. The authors suggest [Dependabot](https://dependabot.com/) or [Snyk](https://snyk.io/), which is inconvenient in many setups. Discussion: [yarn/issues/7075](https://github.com/yarnpkg/yarn/issues/7075).
2. `yarn audit` does not support custom (in-house) registries — see this [issue](https://github.com/yarnpkg/yarn/issues/7012) & [PR](https://github.com/yarnpkg/yarn/pull/6484), still unmerged.

### Solution
yarn-audit-fix fetches `yarn/npm audit --json` advisories and patches the
lockfile graph directly via [`@antongolub/lockfile`](https://github.com/antongolub/lockfile)
(kudos to [G. Kosev](https://github.com/spion), [code reference](https://github.com/hfour/yarn-audit-fix-ng/blob/main/src/index.ts)).
Full description: [dev.to/yarn-audit-fix-for-yarn-2-berry](https://dev.to/antongolub/the-missing-yarn-audit-fix-for-yarn-2-berry-1p8)

### Key features
* Supports every yarn lockfile schema in the wild: Yarn 1 Classic, Yarn 2/3 (berry v4–v6) and **Yarn 4+** (berry v8/v9/v10), auto-detected via [`@antongolub/lockfile`](https://github.com/antongolub/lockfile).
* Fixes vulnerabilities by patching the lockfile graph directly
* macOS / Linux / Windows
* CLI and JS API
* TypeScript typings

#### Lockfile compatibility

| Yarn  | Lockfile schema           | Supported |
|-------|---------------------------|:---------:|
| 1.x   | `yarn-classic`            | ✅        |
| 2.x   | `yarn-berry-v4`           | ✅        |
| 3.0   | `yarn-berry-v5`           | ✅        |
| 3.1+  | `yarn-berry-v6`           | ✅        |
| 4.0–4.13 | `yarn-berry-v8`        | ✅        |
| 4.14+ | `yarn-berry-v9`           | ✅        |
| 5.x dev | `yarn-berry-v10`        | ✅        |

## Getting started
### Requirements
Node.js: `>=16.0.0`

### Install
```sh
yarn add yarn-audit-fix -D
```
or run it directly:
```sh
npm_config_yes=true npx yarn-audit-fix
```

### CLI
<pre>
$ yarn-audit-fix [--opts]

<b>Verifying package structure...</b>
<b>Preparing temp assets...</b>
<b>Patching yarn.lock with audit data...</b>
<b>Installing deps update...</b>
<b>invoke</b> yarn install --update-checksums
[1/4] 🔍  Resolving packages...
[2/4] 🚚  Fetching packages...
[3/4] 🔗  Linking dependencies...
[4/4] 🔨  Rebuilding all packages...
success Saved lockfile.
<b>Done</b>
</pre>
| Option                | Description                                                                                                                                                             | Default                                    |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------|
| `--audit-level`       | Include a vulnerability with a level as defined or higher. Supported values: low, moderate, high, critical                                                              | `low`                                      |
| `--cwd`               | Current working dir                                                                                                                                                     | `process.cwd()`                            |
| `--dry-run`           | Get an idea of what audit fix will do                                                                                                                                   |                                            |
| `--force`             | Have audit fix install semver-major updates to toplevel dependencies, not just semver-compatible ones                                                                   | `false`                                    |
| `--help/-h`           | Print help message                                                                                                                                                      |                                            |
| `--npm-path`          | Switch to project's local **npm** version instead of system default. Or provide a custom path. `system / local / <custom path>`                                         | `system`                                   |
| `--registry`          | Custom registry url                                                                                                                                                     |                                            |
| `--silent`            | Disable log output                                                                                                                                                      | `false`                                    |
| `--symlink`           | Symlink type for `node_modules` ref                                                                                                                                     | `junction` for Windows, `dir` otherwise    |
| `--temp`              | Directory for temporary assets                                                                                                                                          | `<cwd>/node_modules/.cache/yarn-audit-fix` |
| `--verbose`           | Switch log level to verbose/debug                                                                                                                                       | `false`                                    |
| `--ignore-engines`    | Ignore engines check on `yarn install`                                                                                                                                  | `false`                                    |
| `--exclude`           | Array of glob patterns of packages to exclude from audit                                                                                                                |                                            |
| `--ignore`            | Array of glob patterns of advisory IDs to ignore in the audit report                                                                                                    |                                            |

### ENV
Any CLI option can be set via a `YAF`-prefixed env var. For example:
* `YAF_FORCE` — `--force`
* `YAF_AUDIT_LEVEL=high` — `--audit-level=high`

### JS API
**yarn-audit-fix** exposes its internals, so you can tweak the steps or build your own flow.
Typedoc: [antongolub.github.io/yarn-audit-fix/modules](https://antongolub.github.io/yarn-audit-fix/modules/)

```ts
import { run, runSync } from 'yarn-audit-fix'

// NOTE actually it's promisified `run.sync`
await run({
   verbose: true
})

// `runSync` is an alias for `run.sync`
await runSync({
  verbose: true
})
```

Individual stages (`resolveBins`, `patchLockfile`, `yarnInstall`, …) are exported too, so you can compose your own pipeline if needed.

## Migration notes
### ^11.0.0
**BREAKING:** the legacy `convert` flow is removed, and so is the `--flow` switch (plus its `synp`-based two-way lockfile conversion and the now-dead `--package-lock-only` / `--legacy-peer-deps` / `--loglevel` / `--only` flags). Direct graph patching is the only flow now — it is more controllable and supports every yarn schema.

With a single flow, the flow abstraction itself is gone: `getFlow`, the `TFlow` / `TStage` types, and the optional custom-flow argument to `run` / `runSync` are removed. Call `run(flags)` / `runSync(flags)` — the patch pipeline is inlined. The individual stages are still exported if you want to assemble your own.

Adds first-class Yarn 4+ support ([#248](https://github.com/antongolub/yarn-audit-fix/issues/248)). The bespoke v1/v2 lockfile adapters are replaced with [`@antongolub/lockfile`](https://github.com/antongolub/lockfile), which auto-detects every yarn schema (classic + berry v4–v10). The audit parser handles both the yarn 2/3 `{advisories: …}` shape and yarn 4's NDJSON, deriving `patched_versions` from `Vulnerable Versions` when the field is absent. Entries are patched via graph edge-redirect instead of in-place rewrite; merged descriptor keys (e.g. `"lodash@npm:4.17.21, lodash@npm:4.17.20":`) are reconciled by the following `yarn install`.

### ^10.0.0
v10 bumps the pkg deps and requires NodeJS v14.

### ^9.0.0
v9 adds experimental Yarn 2+ lockfile support and changes how lockfiles are detected (no longer via parse failure).

### ^8.0.0
From v8 the library no longer bundles **npm**, so the system default is used instead. If needed, you can:
* Install the required npm version and provide a custom path via [CLI](#cli) / [ENV](#env) / [JS API](#js-api)
* Use a pinch of **npx** magic: `npm_config_yes=true YAF_NPM_PATH=local npx -p yarn-audit-fix -p npm@8 -c yarn-audit-fix`

### ^7.0.0
Converted to ESM along with its deps, so the legacy `require` API was dropped in v7. Use `import` instead, or try [esm-hook](https://www.npmjs.com/package/@qiwi/esm). The CLI works as before.
```js
// const {run} = require('yarn-audit-fix') turns into
import {run} from 'yarn-audit-fix'
```

### ^6.0.0
Default fix strategy [has been changed](https://github.com/antongolub/yarn-audit-fix/releases/tag/v6.0.0) to direct lockfile patching with `yarn audit --json` data. The previous _legacy_ `convert` flow was opt-in via `--flow=convert` until v11, where it was removed entirely.

### ^4.0.0
The `--npm-v7` flag is redundant. From v4.0.0 the package's own **npm** is used by default. You can still pick the system default with `--npm-path=system`, or a custom one with `--npm-path=/another/npm/bin`.

## Troubleshooting
### yarn-audit-fix version x.x.x is out of date
```
npm_config_yes=true npx yarn-audit-fix --audit-level=moderate
Runtime digest
yarn-audit-fix version 4.3.6 is out of date. Install the latest 6.0.0 for better results
```
**npx** caches previously loaded packages, so you need one of:
1. Pin the version: `npx yarn-audit-fix@6.0.0`
2. Reset the npx cache. On macOS/Linux: `rm -rf ~/.npm/_npx`

### yarn-audit-fix command not found
After installation, the binary may not be found — usually a `$PATH` issue locating `node_modules/.bin` ([npm/issues/957](https://github.com/npm/npm/issues/957)). Two easy ways around it:
* Run it through **yarn**: `yarn yarn-audit-fix`
* Invoke the script directly: `node_modules/.bin/yarn-audit-fix`

### No fix available for some advisories
Some advisories can't be auto-fixed — there's no published version that satisfies the consumer's declared range, so the bump is skipped (re-run with `--force` to apply cross-major updates anyway).
```shell
npm_config_yes=true npx yarn-audit-fix --audit-level=moderate
```
```shell
Patching yarn.lock with audit data...
invoke yarn audit --json --level moderate
Can't find patched version that satisfies postcss@^7.0.0 in >=8.2.10
Can't find patched version that satisfies postcss@^7.0.1 in >=8.2.10
Can't find patched version that satisfies postcss@^7.0.27 in >=8.2.10
Can't find patched version that satisfies ws@^7.2.3 in >=6.2.2 <7.0.0 || >=7.4.6
Upgraded deps: <none>
invoke yarn install --update-checksums
```
Not everything can be repaired.

### Cannot install package despite being on correct node version
yarn-audit-fix is compatible with any NodeJS version which supports ESM, but the nested packages can define their own engine requirements.
```shell
pkg-dir@7.0.0: The engine "node" is incompatible with this module. Expected version ">=14.16". Got "14.15.1"
```

The _recommended_ way is to update the runtime version. As a temporary workaround, you can simply pass `--ignore-engines` flag.
```shell
yarn add yarn-audit-fix -D --ignore-engines
```

### Response Code: 400 (Bad Request)

In some cases **yarn npm audit** fails because `yarn.lock` contains a transitive dependency in an unreadable format:
```
  'example-dependency': 'npm:example-dependency@1.0.0'
```

This results in:
```shell
invoke yarn npm audit --all --json --recursive
➤ YN0035: Bad Request
➤ YN0035:   Response Code: 400 (Bad Request)
➤ YN0035:   Request Method: POST
➤ YN0035:   Request URL: https://registry.yarnpkg.com/-/npm/v1/security/audits/quick
```
https://github.com/yarnpkg/berry/issues/4117

Work around it with the `exclude` option:
1. Update project **yarn** to >=3.3.0 (earlier versions don't support this flag for **yarn npm audit**).
2. Run `npx yarn-audit-fix --exclude example-dependency` so **yarn** skips `example-dependency` while building the audit report.

## Contributing
Feel free to open any issues: bugs, feature requests or other questions.
You're always welcome to suggest a PR. Just fork this repo, write some code, add some tests and push your changes.
Any feedback is appreciated.

## License
[MIT](./LICENSE)
