<p align="center">
  <a href="https://yarnpkg.com/">
    <img alt="Yarn fix" src="https://github.com/antongolub/yarn-audit-fix/blob/master/img/yarn-audit-fix.png?raw=true?raw=true" width="546">
  </a>
</p>

<h1 align="center">
  yarn-audit-fix
</h1>

[![Build Status](https://travis-ci.com/antongolub/yarn-audit-fix.svg?branch=master)](https://travis-ci.com/antongolub/yarn-audit-fix)
[![npm (tag)](https://img.shields.io/npm/v/yarn-audit-fix)](https://www.npmjs.com/package/yarn-audit-fix)
[![deps](https://img.shields.io/david/antongolub/yarn-audit-fix)](https://david-dm.org/antongolub/yarn-audit-fix)
[![Maintainability](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/maintainability)](https://codeclimate.com/github/antongolub/yarn-audit-fix/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/1ace18434c46fe1a47fe/test_coverage)](https://codeclimate.com/github/antongolub/yarn-audit-fix/test_coverage)
[![CodeStyle](https://img.shields.io/badge/code%20style-tslint--config--qiwi-brightgreen.svg)](https://github.com/qiwi/tslint-config-qiwi)

Apply `npm audit fix` logic to `yarn.lock`

## Motivation
`yarn audit` detects vulnerabilities, but cannot fix them.
Strictly `yarn` cannot be a drop-in replacement for `npm`.
Authors suggest using [Depedabot](https://dependabot.com/) or [Snyk](https://snyk.io/) for security patches. Well, it is very inconvenient in some situations, to say the least of it.
The discussion: [yarn/issues/7075](https://github.com/yarnpkg/yarn/issues/7075)

Fortunately, there's a workaround: [stackoverflow/60878037](https://stackoverflow.com/a/60878037) (thanks to Gianfranco P.).
`yarn-audit-fix` is just a composition of these steps into a single utility.
More details: [dev.to/yarn-audit-fix-workaround](https://dev.to/antongolub/yarn-audit-fix-workaround-i2a)

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

### CLI
| Flag | Description | Default |
|---|---|---|
|`--verbose` | Switch log level to verbose/debug | false |
|`--package-lock-only` | Run audit fix without modifying `node_modules`. Highly recommended to **enable**. | false |
|`--silent` | Disable log output | false |
|`--loglevel` | Set custom [log level](https://docs.npmjs.com/misc/config#shorthands-and-other-cli-niceties)
|`--only` | Set package [updating scope](https://docs.npmjs.com/cli/audit): `dev`/`prod`
|`--force` | Have audit fix install semver-major updates to toplevel dependencies, not just semver-compatible ones | false
|`--audit-level` | Include a vulnerability with a level as defined or higher. Supported values: low, moderate, high, critical | low
|`--inherit-npm` | Use `npm` version from the environment |

### Troubleshooting
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
* Restore the original `node_modules` state. `yarn --force` or `rm-rf node_modules && yarn`.
* Apply `npx yarn-audit-fix --package-lock-only`. The last param should instruct **npm** not to modify `node_modules` contents.

## License
[MIT](./LICENSE)
