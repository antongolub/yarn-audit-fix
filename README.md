<p align="center">
  <a href="https://yarnpkg.com/">
    <img alt="Yarn audit fix" src="https://github.com/antongolub/yarn-audit-fix/blob/master/img/yarn-audit-fix.png?raw=true?raw=true" width="546">
  </a>
</p>

<h1 align="center">
  yarn-audit-fix
</h1>

[![Build Status](https://travis-ci.com/antongolub/yarn-audit-fix.svg?branch=master)](https://travis-ci.com/antongolub/yarn-audit-fix)
[![Libraries.io deps status](https://img.shields.io/librariesio/release/npm/yarn-audit-fix?label=deps)](https://libraries.io/npm/yarn-audit-fix/sourcerank)
[![Maintainability](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/maintainability)](https://codeclimate.com/github/antongolub/yarn-audit-fix/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/test_coverage)](https://codeclimate.com/github/antongolub/yarn-audit-fix/test_coverage)
[![Sonar](https://sonarcloud.io/api/project_badges/measure?project=antongolub_yarn-audit-fix&metric=alert_status)](https://sonarcloud.io/dashboard?id=antongolub_yarn-audit-fix)
[![npm (tag)](https://img.shields.io/npm/v/yarn-audit-fix)](https://www.npmjs.com/package/yarn-audit-fix)

Apply `npm audit fix` logic to `yarn.lock`

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
   - [^7.0.0](#700)
   - [^6.0.0](#600)
   - [^4.0.0](#400)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Digest
### Problem
1. `yarn audit` detects vulnerabilities, but cannot fix them.
Authors suggest using [Depedabot](https://dependabot.com/) or [Snyk](https://snyk.io/) for security patches. Well, it is very inconvenient in some situations, to say the least of it.
The discussion: [yarn/issues/7075](https://github.com/yarnpkg/yarn/issues/7075).
2. `yarn audit` does not support custom (in-house, internal) registries. Here are the [issue](https://github.com/yarnpkg/yarn/issues/7012) & [PR](https://github.com/yarnpkg/yarn/pull/6484) which have not yet received the green light.

### Solution
Fortunately, there are several workarounds:
1. Compose `npm audit fix` with lockfile converter (thanks to [Gianfranco P.](https://github.com/gianpaj), [stackoverflow/60878037](https://stackoverflow.com/a/60878037)).
   `yarn-audit-fix --flow=convert` just reproduces these steps with minimal changes. More details: [dev.to/yarn-audit-fix-workaround](https://dev.to/antongolub/yarn-audit-fix-workaround-i2a)
2. Fetch `yarn/npm audit --json` and patch lockfile inners (kudos to [G. Kosev](https://github.com/spion), [code reference](https://github.com/hfour/yarn-audit-fix-ng/blob/main/src/index.ts)). `yarn-audit-fix --flow=patch`

### Key features
* A couple of strategies to fix security issues
* Mac / Linux / Windows support
* CLI / JS API
* TS and flow typings

## Getting started
### Requirements
Node.js: `^12.20.0 || ^14.13.1 || >=16.0.0`

### Install
```shell script
$ yarn add yarn-audit-fix -D
```
or even better
```
npm_config_yes=true npx yarn-audit-fix
```

### CLI
<pre>
$ yarn-audit-fix [--opts]

<b>Preparing temp assets...</b>
<b>Generating package-lock.json from yarn.lock...</b>
<b>Applying npm audit fix...</b>
<b>invoke</b> npm audit fix --package-lock-only
added 14 packages, removed 195 packages and updated 1245 packages in 4.795s
fixed 3 of 26 vulnerabilities in 1370 scanned packages
  23 vulnerabilities required manual review and could not be updated
<b>Updating yarn.lock from package-lock.json...</b>
<b>invoke</b> yarn import
info found npm package-lock.json, converting to yarn.lock
warning synp > request@2.88.2: request has been deprecated, see https://github.com/request/request/issues/3142
warning tslint-config-qiwi > tslint-react@5.0.0: tslint-react is deprecated along with TSLint
warning @qiwi/libdefkit > @types/read-pkg@5.1.0: This is a stub types definition. read-pkg provides its own type definitions, so you do not need this installed.
...
success Saved lockfile.
<b>invoke</b> yarn
[1/4] 🔍  Resolving packages...
success Already up-to-date.
<b>Done</b>
</pre>
| Option | Description | Default | with `--flow=convert` only | 
|---|---|---|---|
|`--flow` | Define how `yarn.lock` is modified. `convert` — to compose `npm audit fix` with two-way lockfile conversion (legacy flow). `patch` — to directly inject audit json data | `patch`
|`--audit-level` | Include a vulnerability with a level as defined or higher. Supported values: low, moderate, high, critical | `low`
|`--cwd` | Current working dir | `process.cwd()`
|`--dry-run` | Get an idea of what audit fix will do
|`--force` | Have audit fix install semver-major updates to toplevel dependencies, not just semver-compatible ones | `false`
|`--help/-h`| Print help message |
|`--legacy-peer-deps` | Accept an incorrect (potentially broken) deps resolution |  | ✔
|`--loglevel` | Set custom [log level](https://docs.npmjs.com/cli/v7/using-npm/config#loglevel) | | ✔
|`--npm-path` | Define npm path: switch to system **npm** version instead of default package's own. Or provide a custom path. `system / local / <custom path>` | `local`
|`--only` | Set package [update scope](https://docs.npmjs.com/cli/v7/using-npm/config#only): `dev`/`prod`
|`--package-lock-only` | Run audit fix without modifying `node_modules`. Highly recommended to **enable**. | `true` | ✔ |
|`--registry` | Custom registry url | | ✔ |
|`--silent` | Disable log output | `false` |
|`--symlink` | Symlink type for `node_modules` ref | `junction` for Windows, `dir` otherwise
|`--temp` | Directory for temporary assets | `<cwd>/node_modules/.cache/yarn-audit-fix` 
|`--verbose` | Switch log level to verbose/debug | `false` 

### ENV
All mentioned above CLI options can be replaced with the corresponding env variables with leading **YAF** prefix. For example:
* `YAF_FORCE` equals `--force`
* `YAF_ONLY=prod` — `--only=prod`

### JS API
**yarn-audit-fix** is a naive and optimistic workaround, so it exposes all of its inners to give anybody a chance to tweak up and find a better steps combination.
Typedoc: [https://antongolub.github.io/yarn-audit-fix/modules/](https://antongolub.github.io/yarn-audit-fix/modules/)

```ts
import { run, runSync } from 'yarn-audit-fix'

// NOTE actually it's promisified `run.sync`
await run({
   flow: 'patch',
   verbose: true
})

// `runSync` is an alias for `run.sync`
await runSync({
  flow: 'patch',
  verbose: true
})
```

Build and run custom flows.
```ts
import {
   clear,
   exit,
   patchLockfile,
   yarnInstall
} from 'yarn-audit-fix'

export const flow: TFlow = {
  main: [
    [
      'Patching yarn.lock with audit data...',
      patchLockfile,
      (...args) => {console.log('Smth interesting:', ...args)},
      yarnInstall,
    ],
    ['Done'],
  ],
  fallback: [['Failure!', exit]],
}

await run({}, flow)
```

## Migration notes
### ^7.0.0
Following the deps, converted to ESM. So legacy `require` API has been dropped since v7.0.0. Use the shiny new `import` instead or try your luck with [esm-hook](https://www.npmjs.com/package/@qiwi/esm). CLI works as before.
```js
// const {run} = require('yarn-audit-fix') turns into
import {run} from 'yarn-audit-fix'
```

### ^6.0.0
Default fix strategy [has been changed](https://github.com/antongolub/yarn-audit-fix/releases/tag/v6.0.0) to direct lockfile patching with `yarn audit --json` data. To use the previous _legacy_ flow, pass `--flow=convert` option to CLI.

### ^4.0.0
`--npm-v7` flag is redundant. From v4.0.0 package's own version of **npm** is used by default. But you're still able to invoke system default with `--npm-path=system` or define any custom `--npm-path=/another/npm/bin`.

## Troubleshooting
### yarn-audit-fix version x.x.x is out of date
```
npm_config_yes=true npx yarn-audit-fix --audit-level=moderate
Runtime digest
yarn-audit-fix version 4.3.6 is out of date. Install the latest 6.0.0 for better results
```
**npx** caches previously loaded packages, so you need one of:
1. Define version to load: `npm yarn-audit-fix@6.0.0`
2. Reset npx cache. For Mac/Linux: `rm -rf ~/.npm/_npx`

### yarn-audit-fix command not found
After installation, the package may not be found. This is probably an issue with $PATH finding `node_modules/.bin` contents or smth like that ([npm/issues/957](https://github.com/npm/npm/issues/957)).
A bit annoying, but it's easy to handle in several ways.
* You're able to run the cmd through **yarn**: `yarn yarn-audit-fix`.
* Simply invoke `node_modules/.bin/yarn-audit-fix` script.

### enoent: no such file or directory
In some cases **npm audit fix** makes `node_modules` to become inconsistent. This is expected. **yarn** and **npm** organize the directory space slightly differently.
```
npm WARN rm not removing /Users/antongolub/projects/queuefy/node_modules/.cache/yarn-audit-fix/node_modules/npm/node_modules/.bin/node-gyp as it wasn't installed by /Users/antongolub/projects/queuefy/node_modules/.cache/yarn-audit-fix/node_modules/npm/node_modules/node-gyp
npm WARN rm not removing /Users/antongolub/projects/queuefy/node_modules/.cache/yarn-audit-fix/node_modules/npm/node_modules/.bin/uuid as it wasn't installed by /Users/antongolub/projects/queuefy/node_modules/.cache/yarn-audit-fix/node_modules/npm/node_modules/uuid
npm ERR! code ENOENT
npm ERR! syscall chmod
npm ERR! path /Users/antongolub/projects/queuefy/node_modules/.cache/yarn-audit-fix/node_modules/@qiwi/libdefkit/node_modules/flowgen/lib/cli/index.js
npm ERR! errno -2
npm ERR! enoent ENOENT: no such file or directory, chmod '/Users/antongolub/projects/queuefy/node_modules/.cache/yarn-audit-fix/node_modules/@qiwi/libdefkit/node_modules/flowgen/lib/cli/index.js'
npm ERR! enoent This is related to npm not being able to find a file.
npm ERR! enoent 
npm ERR!     /Users/antongolub/.npm/_logs/2020-08-23T07_09_26_924Z-debug.log
{
  status: 254,
  signal: null,
  output: [ null, null, null ]
```
Let's try this workaround:
1. Restore the original `node_modules` state. `yarn --force` or `rm-rf node_modules && yarn`.
2. Apply `npx yarn-audit-fix --package-lock-only`. The last param should instruct **npm** not to modify `node_modules` contents.

### --force did not force the update
The problem only concerns repositories with `workspaces` (monorepos). 
`npm audit fix --force` throws 1 status code and suggests running `npm audit fix --force`. This quite ironic behaviour is exactly what **npm** (arborist) [does now](https://github.com/npm/arborist/blob/5b550501f50d6489d7e5f7598a97a5cf4cc5cc8a/lib/arborist/build-ideal-tree.js#L373). 
```
$$ yarn-audit-fix --force          
 Preparing temp assets...
 Generating package-lock.json from yarn.lock...
 Applying npm audit fix...
 invoke /home/qwelias/.nvm/versions/node/v12.18.1/lib/node_modules/yarn-audit-fix/node_modules/.bin/npm audit fix --package-lock-only --force --prefix=/home/qwelias/prj/stuff/test-yarn-audit-fix/node_modules/.cache/yarn-audit-fix
 npm WARN using --force Recommended protections disabled.
 npm WARN audit Updating lodash to 4.17.20,which is outside your stated dependency range.
 npm WARN audit Manual fix required in linked project at ./packages/bar for lodash@<=4.17.18.
 npm WARN audit 'cd ./packages/bar' and run 'npm audit' for details.
 npm WARN audit Manual fix required in linked project at ./packages/foo for lodash@<=4.17.18.
 npm WARN audit 'cd ./packages/foo' and run 'npm audit' for details.
 
 up to date, audited 7 packages in 2s
 
 # npm audit report
 
 lodash  <=4.17.18
 Severity: high
 Prototype Pollution - https://npmjs.com/advisories/782
 Prototype Pollution - https://npmjs.com/advisories/1065
 fix available via `npm audit fix --force`
 Will install lodash@4.17.20, which is outside the stated dependency range
 packages/bar/node_modules/lodash
 packages/foo/node_modules/lodash
 
 1 high severity vulnerability
 
 To address all issues, run:
   npm audit fix --force
 {
   status: 1,
   signal: null,
   output: [ null, null, null ],
   pid: 176019,
   stdout: null,
   stderr: null
 }
```
So you need, as the message says, to manually change the dependency versions. **npm@7** ~~is still in beta~~, perhaps this logic will be changed later.
In some cases **npm@6** works better, so if you have such a version installed on your system, you may try:
```shell
npx yarn-audit-fix --npm-path=system --flow=convert
```
You may also try to cast _the optimistic flags combo_
```shell
npx yarn-audit-fix --package-lock-only=false --force --legacy-peer-deps --flow=convert
```
Unfortunately, even this invocation may return something like:
```shell
# npm audit report

hosted-git-info  <3.0.8
Severity: moderate
Regular Expression Deinal of Service - https://npmjs.com/advisories/1677
No fix available
node_modules/normalize-package-data/node_modules/hosted-git-info
  normalize-package-data  2.0.0 - 2.5.0
  Depends on vulnerable versions of hosted-git-info
  node_modules/normalize-package-data
    meow  3.4.0 - 9.0.0
    Depends on vulnerable versions of normalize-package-data
    Depends on vulnerable versions of read-pkg-up
```
**No fix available** just means that no fix available. If you still doubt the correctness of the output, you can check it by hand.
```shell
npm i --package-lock-only
npm audit fix --package-lock-only --force
```

Same response for alternative patching flow:
```shell
npm_config_yes=true npx yarn-audit-fix --audit-level=moderate --flow=patch
```
```shell
Patching yarn.lock with audit data...
invoke yarn audit --json --level moderate
Can't find patched version that satisfies postcss@^7.0.0 in >=8.2.10
Can't find patched version that satisfies postcss@^7.0.1 in >=8.2.10
Can't find patched version that satisfies postcss@^7.0.27 in >=8.2.10
Can't find patched version that satisfies ws@^7.2.3 in >=6.2.2 <7.0.0 || >=7.4.6
Upgraded deps: <none>
invoke yarn --update-checksums
```
Not everything can be repaired, alack.

## Contributing
Feel free to open any issues: bugs, feature requests or other questions.
You're always welcome to suggest a PR. Just fork this repo, write some code, add some tests and push your changes.
Any feedback is appreciated.

## License
[MIT](./LICENSE)
