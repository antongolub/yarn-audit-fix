# yarn-audit-fix

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
Authors suggest using `depedabot` for security patches. Well, it is very inconvenient in some situations, to say the least of it.
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
```shell script
$ yarn-audit-fix

Generating package-lock.json...
Applying npm audit fix...
Generating new yarn.lock from package-lock.json...
Done
```

## License
[MIT](./LICENSE)
