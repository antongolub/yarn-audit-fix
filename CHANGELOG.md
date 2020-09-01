## [2.2.1](https://github.com/antongolub/yarn-audit-fix/compare/v2.2.0...v2.2.1) (2020-09-01)


### Bug Fixes

* **package:** up deps ([c3dfa88](https://github.com/antongolub/yarn-audit-fix/commit/c3dfa881c2497993de59ba204bd66619bbcac37d)), closes [#22](https://github.com/antongolub/yarn-audit-fix/issues/22)

# [2.2.0](https://github.com/antongolub/yarn-audit-fix/compare/v2.1.1...v2.2.0) (2020-08-27)


### Features

* enable package-lock-only by default ([d927735](https://github.com/antongolub/yarn-audit-fix/commit/d927735d40fb4d40cc3a8d11f151fb0cc6ba6435)), closes [#23](https://github.com/antongolub/yarn-audit-fix/issues/23)

## [2.1.1](https://github.com/antongolub/yarn-audit-fix/compare/v2.1.0...v2.1.1) (2020-08-25)


### Performance Improvements

* **package:** up deps ([8da9fec](https://github.com/antongolub/yarn-audit-fix/commit/8da9fec1bd8ec0003776c0de1618f782447528bb))

# [2.1.0](https://github.com/antongolub/yarn-audit-fix/compare/v2.0.5...v2.1.0) (2020-08-22)


### Features

* introduce --inherit-npm flag ([b54ded4](https://github.com/antongolub/yarn-audit-fix/commit/b54ded4a1d5f5225676a0f7b9faf81f3bbad6e08))

## [2.0.5](https://github.com/antongolub/yarn-audit-fix/compare/v2.0.4...v2.0.5) (2020-08-22)


### Performance Improvements

* rm npm bins before semrel start, tech release ([3ce0106](https://github.com/antongolub/yarn-audit-fix/commit/3ce0106600b3f2626c0c1f832ce30e3ef753d146))

## [2.0.4](https://github.com/antongolub/yarn-audit-fix/compare/v2.0.3...v2.0.4) (2020-08-22)


### Bug Fixes

* fix workspaces detection ([f766f5d](https://github.com/antongolub/yarn-audit-fix/commit/f766f5dee18e436d9d628b55189f109e467f2fa9))

## [2.0.3](https://github.com/antongolub/yarn-audit-fix/compare/v2.0.2...v2.0.3) (2020-08-22)


### Performance Improvements

* add manifest to cxt ([b8761e7](https://github.com/antongolub/yarn-audit-fix/commit/b8761e7c6c11490a09c6a31fbc96c104aaced109))

## [2.0.1](https://github.com/antongolub/yarn-audit-fix/compare/v2.0.0...v2.0.1) (2020-08-22)


### Performance Improvements

* tech release ([9cbdbe8](https://github.com/antongolub/yarn-audit-fix/commit/9cbdbe898fc94c0c2134b2576f32bd97a1a1cdef))

# [2.0.0](https://github.com/antongolub/yarn-audit-fix/compare/v1.6.1...v2.0.0) (2020-08-22)


### Bug Fixes

* adapt yarn cmd invocation to win runtime ([d02d69f](https://github.com/antongolub/yarn-audit-fix/commit/d02d69f74cbaf5e12af6e1263df2d68af4f1e0b5))
* fix checksums ([d2a280d](https://github.com/antongolub/yarn-audit-fix/commit/d2a280d4036c81fd5bd89f15475a3700d397d9b5))


### Features

* **cli:** let --package-lock-only be configurable ([c457a18](https://github.com/antongolub/yarn-audit-fix/commit/c457a1859f3cf12d17eba169319d0e1250269b09))
* provide workspaces deps update ([a64fc95](https://github.com/antongolub/yarn-audit-fix/commit/a64fc95496998607cc8c50b5de73e4326c457c4e)), closes [#16](https://github.com/antongolub/yarn-audit-fix/issues/16)
* support custom workspace paths ([96bde5d](https://github.com/antongolub/yarn-audit-fix/commit/96bde5d7ad237bc9bc56c7820d9a1529fded6e02))


### Performance Improvements

* deps revision ([c35b253](https://github.com/antongolub/yarn-audit-fix/commit/c35b253b08a9e2592e0cf963a13b5bd32b1c4b67))
* tweak up npm audit invoker ([197ca96](https://github.com/antongolub/yarn-audit-fix/commit/197ca96f91a1c8d93e55afa3e9b6a957c72e51fe))


### BREAKING CHANGES

* --package-lock-only is disabled by default

## [1.6.1](https://github.com/antongolub/yarn-audit-fix/compare/v1.6.0...v1.6.1) (2020-08-17)


### Performance Improvements

* **package:** tech release ([1243032](https://github.com/antongolub/yarn-audit-fix/commit/12430323b881c2067b249e19cc2a55b9247376bc))

# [1.6.0](https://github.com/antongolub/yarn-audit-fix/compare/v1.5.1...v1.6.0) (2020-08-10)


### Bug Fixes

* discard flags after -- break ([4ee89e0](https://github.com/antongolub/yarn-audit-fix/commit/4ee89e03d59bd928e577859302689339ba666687))
* **cli:** handle `silent` flag at the top level promise ([08534ed](https://github.com/antongolub/yarn-audit-fix/commit/08534ed93091ea795d9d015c6eeb34224d4c7d89))


### Features

* **cli:** add symlink type customization ([bfb2747](https://github.com/antongolub/yarn-audit-fix/commit/bfb2747dbde5f1bceb6e9c9cbd3d915cb4a84dc6)), closes [#13](https://github.com/antongolub/yarn-audit-fix/issues/13)
* **cli:** pass optional flags to npm/yarn invocations ([cd2efab](https://github.com/antongolub/yarn-audit-fix/commit/cd2efab225261d07e4f193c29bd8cf6db91f9e32)), closes [#12](https://github.com/antongolub/yarn-audit-fix/issues/12)
* **cli:** provide `silent` flag support ([2a646bc](https://github.com/antongolub/yarn-audit-fix/commit/2a646bca6ef6b4918f3a3c56e94b2e98a9e9af46))

## [1.5.1](https://github.com/antongolub/yarn-audit-fix/compare/v1.5.0...v1.5.1) (2020-08-07)


### Bug Fixes

* **readme:** update usage example ([8d25680](https://github.com/antongolub/yarn-audit-fix/commit/8d256800d3542ee0d9ff60d1d72be6232bb7a2fc))
* print invoke cmd before its output ([dfe82fb](https://github.com/antongolub/yarn-audit-fix/commit/dfe82fb4de711dcddc0feb497c7ade66d4ef717d))

# [1.5.0](https://github.com/antongolub/yarn-audit-fix/compare/v1.4.1...v1.5.0) (2020-08-07)


### Features

* highlight steps in the output for better readability ([7abff28](https://github.com/antongolub/yarn-audit-fix/commit/7abff2850a3cfe8ffaa99fd97bec3b2f8c45a3af))

## [1.4.1](https://github.com/antongolub/yarn-audit-fix/compare/v1.4.0...v1.4.1) (2020-08-06)


### Bug Fixes

* exit with non-zero if anything fails ([#11](https://github.com/antongolub/yarn-audit-fix/issues/11)) ([3e7eb93](https://github.com/antongolub/yarn-audit-fix/commit/3e7eb931816c18eaa781565a25624599aef94f69)), closes [#10](https://github.com/antongolub/yarn-audit-fix/issues/10)

# [1.4.0](https://github.com/antongolub/yarn-audit-fix/compare/v1.3.0...v1.4.0) (2020-08-03)


### Features

* add async handlers support ([71eab4e](https://github.com/antongolub/yarn-audit-fix/commit/71eab4e8ac2c3bcedc985244f1845dedd967ca2a))
* perform most operations on temporary entities ([213b4f5](https://github.com/antongolub/yarn-audit-fix/commit/213b4f5086b9a3572994ce5f311acf7d6b09d84e)), closes [#6](https://github.com/antongolub/yarn-audit-fix/issues/6)

# [1.3.0](https://github.com/antongolub/yarn-audit-fix/compare/v1.2.2...v1.3.0) (2020-07-13)


### Features

* print invocation details to stdout ([f92b18a](https://github.com/antongolub/yarn-audit-fix/commit/f92b18a70498ad3aa03ba853260e84de675920a2))

## [1.2.2](https://github.com/antongolub/yarn-audit-fix/compare/v1.2.1...v1.2.2) (2020-07-10)


### Bug Fixes

* fix worlspaces issue ([221f17b](https://github.com/antongolub/yarn-audit-fix/commit/221f17b8f922c46efb0012c3acb8969dda15b711)), closes [#2](https://github.com/antongolub/yarn-audit-fix/issues/2) [#3](https://github.com/antongolub/yarn-audit-fix/issues/3)

## [1.2.1](https://github.com/antongolub/yarn-audit-fix/compare/v1.2.0...v1.2.1) (2020-07-09)


### Bug Fixes

* raplace yarm import to synp converter to handle workspaces issue ([c921179](https://github.com/antongolub/yarn-audit-fix/commit/c9211797bb3ab7fc346fff99e0215026f503664d))

# [1.2.0](https://github.com/antongolub/yarn-audit-fix/compare/v1.1.1...v1.2.0) (2020-07-09)


### Features

* use yarn import for package-lock converting ([e9fccd8](https://github.com/antongolub/yarn-audit-fix/commit/e9fccd8798be6c2570c46ddc086c23bc1e69f854))

## [1.1.1](https://github.com/antongolub/yarn-audit-fix/compare/v1.1.0...v1.1.1) (2020-07-09)


### Bug Fixes

* fix synp source arg, apply audit fix to lockfile only ([#1](https://github.com/antongolub/yarn-audit-fix/issues/1)) ([c2bd0fc](https://github.com/antongolub/yarn-audit-fix/commit/c2bd0fce3a61a0c3c46d1601b7aa75120760cbd4))

# [1.1.0](https://github.com/antongolub/yarn-audit-fix/compare/v1.0.0...v1.1.0) (2020-07-08)


### Features

* replace npm i with synp convertion ([7272a9c](https://github.com/antongolub/yarn-audit-fix/commit/7272a9ce6f241e37fa23955806ca3b7dc041b498))

# 1.0.0 (2020-07-08)


### Bug Fixes

* fix rimraf bin path ([69df2aa](https://github.com/antongolub/yarn-audit-fix/commit/69df2aa7cf66d73de6f4e63937a52ec87453e39d))


### Features

* add audit fix cmd queue ([7fc519d](https://github.com/antongolub/yarn-audit-fix/commit/7fc519d4b4925cf6e3760837b0c051d02c85212e))
* replace rm with rimraf ([67d9d16](https://github.com/antongolub/yarn-audit-fix/commit/67d9d16466360afcf1a246b17433fc8740e745bc))
