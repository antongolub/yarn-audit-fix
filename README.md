# yarn-audit-fix
Apply `npm audit fix` logic to `yarn.lock`

## Motivation
`yarn audit` detects vulnerabilities, but cannot fix them.
Strictly `yarn` cannot be a drop-in replacement for `npm`.
Authors suggest using `depedabot` for security patches. Well, it is very inconvenient in some situations, to say the least of it.
The discussion: [yarn/issues/7075](https://github.com/yarnpkg/yarn/issues/7075)

Fortunately, there's a workaround: [stackoverflow/60878037](https://stackoverflow.com/a/60878037).
`yarn-audit-fix` is just a composition of these steps into a single utility.

## Install
```shell script
$ yarn add yarn-audit-fix -D
```

## Usage
```shell script
$ yarn-audit-fix

Applying npm audit fix...
Removing yarn.lock
Generating new yarn.lock from package-lock.json
Removing package-lock.json
Done
```
