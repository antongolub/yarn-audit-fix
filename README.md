<p align="center">
  <a href="https://yarnpkg.com/">
    <img alt="Yarn audit fix" src="https://github.com/antongolub/yarn-audit-fix/blob/master/img/yarn-audit-fix.png?raw=true?raw=true" width="546">
  </a>
</p>

<h1 align="center">
  yarn-audit-fix
</h1>

[![Build Status](https://travis-ci.com/antongolub/yarn-audit-fix.svg?branch=master)](https://travis-ci.com/antongolub/yarn-audit-fix)
[![deps](https://img.shields.io/david/antongolub/yarn-audit-fix?label=deps)](https://david-dm.org/antongolub/yarn-audit-fix)
[![Maintainability](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/maintainability)](https://codeclimate.com/github/antongolub/yarn-audit-fix/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/test_coverage)](https://codeclimate.com/github/antongolub/yarn-audit-fix/test_coverage)
[![Sonar](https://sonarcloud.io/api/project_badges/measure?project=antongolub_yarn-audit-fix&metric=alert_status)](https://sonarcloud.io/dashboard?id=antongolub_yarn-audit-fix)
[![npm (tag)](https://img.shields.io/npm/v/yarn-audit-fix)](https://www.npmjs.com/package/yarn-audit-fix)

Apply `npm audit fix` logic to `yarn.lock`

## Motivation
1. `yarn audit` detects vulnerabilities, but cannot fix them.
Authors suggest using [Depedabot](https://dependabot.com/) or [Snyk](https://snyk.io/) for security patches. Well, it is very inconvenient in some situations, to say the least of it.
The discussion: [yarn/issues/7075](https://github.com/yarnpkg/yarn/issues/7075).  
Fortunately, there's a workaround: [stackoverflow/60878037](https://stackoverflow.com/a/60878037) (thanks to Gianfranco P.).
`yarn-audit-fix` is just a composition of these steps into a single utility.
More details: [dev.to/yarn-audit-fix-workaround](https://dev.to/antongolub/yarn-audit-fix-workaround-i2a)
   
2. `yarn audit` does not support custom (in-house, internal) registries. Here are the [issue](https://github.com/yarnpkg/yarn/issues/7012) & [PR](https://github.com/yarnpkg/yarn/pull/6484) which have not yet received the green light.

## Install
```shell script
$ yarn add yarn-audit-fix -D
```
or even better
```
npx yarn-audit-fix
```

## Usage
<pre>
$ yarn-audit-fix

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

### Migration from v3 to v4
`--npm-v7` flag is redundant. From v4.0.0 package's own version of **npm** is used by default. But you're still able to invoke system default with `--npm-path=system` or define any custom `--npm-path=/another/npm/bin`.

### CLI
| Flag | Description | Default |
|---|---|---|
|`--audit-level` | Include a vulnerability with a level as defined or higher. Supported values: low, moderate, high, critical | low
|`--dry-run` | Get an idea of what audit fix will do | 
|`--force` | Have audit fix install semver-major updates to toplevel dependencies, not just semver-compatible ones | false
|`--legacy-peer-deps` | Accept an incorrect (potentially broken) deps resolution | 
|`--loglevel` | Set custom [log level](https://docs.npmjs.com/cli/v7/using-npm/config#loglevel)
|`--npm-path` | Declare npm path: switch to system default version of **npm** instead of package's own. `system / local / <custom path>` | `local`
|`--only` | Set package [updating scope](https://docs.npmjs.com/cli/v7/using-npm/config#only): `dev`/`prod`
|`--package-lock-only` | Run audit fix without modifying `node_modules`. Highly recommended to **enable**. | true |
|`--registry` | Custom registry url |
|`--silent` | Disable log output | false |
|`--temp` | Directory for temporary assets | `<cwd>/node_modules/.cache/yarn-audit-fix`
|`--symlink` | Symlink type for `node_modules` ref | `junction` for Windows, `dir` otherwise
|`--verbose` | Switch log level to verbose/debug | false |

### ENV
All mentioned above CLI directives can be replaced with corresponding env variables with leading **YAF** prefix. For example:
* `YAF_FORCE` equals `--force`
* `YAF_ONLY=prod` — `--only=prod`

## Troubleshooting
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

### yarn-audit-fix command not found
After installation the package may not be found. This is probably an issue with $PATH finding `node_modules/.bin` contents or smth like that ([npm/issues/957](https://github.com/npm/npm/issues/957)).
A bit annoying, but it's easy to handle in several ways. 
* You're able to run the cmd through **yarn**: `yarn yarn-audit-fix`. 
* Simply invoke `node_modules/.bin/yarn-audit-fix` script.

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
npx yarn-audit-fix --npm-path=system
```
You may also try to cast _the optimistic flags combo_
```shell
npx yarn-audit-fix --package-lock-only=false --force --legacy-peer-deps
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
**No fix available** just means that no fix available. If you still doubt the correctness of the output, you can check it.
```shell
npm i --package-lock-only
npm audit fix --package-lock-only --force
```
Not everything can be fixed, alack.

## License
[MIT](./LICENSE)
