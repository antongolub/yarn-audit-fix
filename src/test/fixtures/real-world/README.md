# Real-world yarn fixtures

Snapshots of real, highly-starred **yarn** projects for smoke-testing the patch
flow against lockfile + monorepo shapes produced by actual yarn workflows.

Each directory handle is `<org>-<repo>-<branch>-<sha7>`. The root `yarn.lock`
and the **full nested `package.json` tree** are byte-identical to that commit,
fetched from `raw.githubusercontent.com` at the recorded SHA — provenance is
verifiable, not approximate.

Coverage: yarn-classic (9), yarn-berry v6 (1), yarn-berry v8 (10), yarn-berry
v10 (2). Large monorepos stress workspace discovery — gatsby (362 nested
`package.json`), fluentui (270), react-spectrum (268), cypress (209).

| Repo handle | Source repo | Commit SHA | Branch | Format | package.json |
| --- | --- | --- | --- | --- | ---: |
| `facebook-react-main-557e28f` | `https://github.com/facebook/react` | `557e28fae7cbd4cf2714d556f6d8a3a42f7d8ce2` | `main` | `yarn-classic` | 111 |
| `facebook-react-native-main-0873116` | `https://github.com/facebook/react-native` | `08731165f583e6dae344ea80ae4f9051aac0ff48` | `main` | `yarn-classic` | 40 |
| `gatsbyjs-gatsby-master-1f38c85` | `https://github.com/gatsbyjs/gatsby` | `1f38c85963fd6bcfa9ccee2f925e5e02b00eafbb` | `master` | `yarn-classic` | 362 |
| `cypress-io-cypress-develop-1152c0d` | `https://github.com/cypress-io/cypress` | `1152c0d5c05d5fb71c57f531f4dd2163d3734ed1` | `develop` | `yarn-classic` | 209 |
| `facebook-docusaurus-main-183fc6f` | `https://github.com/facebook/docusaurus` | `183fc6f1e3d5dab9fb9687e85091660f90a42010` | `main` | `yarn-classic` | 50 |
| `excalidraw-excalidraw-master-3372149` | `https://github.com/excalidraw/excalidraw` | `33721492771919e8569964fe0b034a9cf7f25955` | `master` | `yarn-classic` | 11 |
| `aws-aws-cdk-main-5b19ac5` | `https://github.com/aws/aws-cdk` | `5b19ac5be5131d92dcf388a8f6a927cf634cab89` | `main` | `yarn-classic` | 72 |
| `aws-amplify-amplify-js-main-00713e1` | `https://github.com/aws-amplify/amplify-js` | `00713e1e4f39ab6d8b202710bc662c72aaba5eac` | `main` | `yarn-classic` | 90 |
| `microsoft-fluentui-master-2fa748f` | `https://github.com/microsoft/fluentui` | `2fa748f31bf941ddf1be8328c375b84e5e9dda28` | `master` | `yarn-classic` | 270 |
| `medusajs-medusa-develop-08d7f0e` | `https://github.com/medusajs/medusa` | `08d7f0e972754be3a933bfe897c59e93132be61e` | `develop` | `yarn-berry-v6` | 111 |
| `strapi-strapi-develop-d4be042` | `https://github.com/strapi/strapi` | `d4be0425429ca06019dd0461dc3b715d164ed225` | `develop` | `yarn-berry-v8` | 62 |
| `calcom-cal.com-main-180ede2` | `https://github.com/calcom/cal.com` | `180ede28f0bddf2738933a6e60a8e80f6116d7da` | `main` | `yarn-berry-v8` | 119 |
| `tldraw-tldraw-main-ed2a504` | `https://github.com/tldraw/tldraw` | `ed2a50477fbfcf1d672fb420a9fe8536ad3663a2` | `main` | `yarn-berry-v8` | 48 |
| `reduxjs-redux-master-1ea3a6b` | `https://github.com/reduxjs/redux` | `1ea3a6bbeefd6b2bd6a71196742c4db40f4822b1` | `master` | `yarn-berry-v8` | 14 |
| `electron-electron-main-603c14f` | `https://github.com/electron/electron` | `603c14fc3492f8612936e464d450d141f21402b0` | `main` | `yarn-berry-v8` | 60 |
| `adobe-react-spectrum-main-74a1dbf` | `https://github.com/adobe/react-spectrum` | `74a1dbf520eb5d08b05d157020b66c8943deb5dc` | `main` | `yarn-berry-v8` | 268 |
| `sequelize-sequelize-main-8260c29` | `https://github.com/sequelize/sequelize` | `8260c2905e22f92b8c908023faaf4ad99994981c` | `main` | `yarn-berry-v8` | 14 |
| `elastic-eui-main-0ad13ae` | `https://github.com/elastic/eui` | `0ad13ae958c5f8d8094f4e9b1ba2f2041a2bbc4a` | `main` | `yarn-berry-v8` | 13 |
| `react-navigation-react-navigation-main-6104e1d` | `https://github.com/react-navigation/react-navigation` | `6104e1de050916a84ef5062967e3bdebe88575cf` | `main` | `yarn-berry-v8` | 15 |
| `software-mansion-react-native-reanimated-main-7740906` | `https://github.com/software-mansion/react-native-reanimated` | `7740906343dd71dcb95f3f0b423db58048bcc7c1` | `main` | `yarn-berry-v8` | 15 |
| `grafana-grafana-main-9bcff8f` | `https://github.com/grafana/grafana` | `9bcff8f6f5e84fafac24e57794973cb034869055` | `main` | `yarn-berry-v10` | 38 |
| `mantinedev-mantine-master-f27b9d7` | `https://github.com/mantinedev/mantine` | `f27b9d741b9174c1bf4ce7c050c5a31868be33d5` | `master` | `yarn-berry-v10` | 33 |
