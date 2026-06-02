# Vulnerable yarn lockfiles

Older snapshots of popular yarn repos (pinned to ~2024-03, before the 2024 CVE
fix wave) that still carry **genuinely unpatched** transitive deps — `lockfile`
only (no nested tree), purpose-built to test yaf's patch on real vulnerable
graphs.

Unlike `../real-world/` (current repos, mostly patched), these let the **default
compat-safe path** apply real in-major fixes (braces 3.0.2→3.0.3, cross-spawn
7.0.3→7.0.5, ws 8.16→8.17.1, micromatch 4.0.5→4.0.8, nanoid 3.3.7→3.3.8, tar
6.1→6.2.1, cookie 0.6→0.7) while the gate holds back cross-major bumps for
`--force`. Exercised by `src/test/ts/real-world.ts` against the local advisory
cache (`../advisories.json`).

Measured (cached advisories, offline `minVersion` resolver):

| Handle | Source repo | Commit SHA | Date | Format | vulns | default fixes | `--force` |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| `facebook-react-main-df95577` | `https://github.com/facebook/react` | `df95577db0d1d7ca383f281bc1d9e6ba5579bef2` | 2024-03-30 | `yarn-classic` | 50 | 20 → 30 left | → 0 |
| `gatsbyjs-gatsby-master-5723972` | `https://github.com/gatsbyjs/gatsby` | `5723972ebfa2c5cc56cb822daa4a026e4cdaf11d` | 2024-03-15 | `yarn-classic` | 46 | 15 → 31 left | → 0 |
| `strapi-strapi-develop-48671c2` | `https://github.com/strapi/strapi` | `48671c244dae9aaccbaac3c2541964ffe1a39862` | 2024-03-29 | `yarn-berry-v8` | 28 | 10 → 18 left | → 0 |
| `mantinedev-mantine-master-1b112cb` | `https://github.com/mantinedev/mantine` | `1b112cb25082923e3dfae23f1f7733f61d61e81d` | 2024-03-31 | `yarn-berry-v10` | 25 | 17 → 8 left | → 0 |

Each `yarn.lock` is byte-identical to its commit (fetched from
`raw.githubusercontent.com` at the recorded SHA).
