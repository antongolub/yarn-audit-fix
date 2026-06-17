#!/usr/bin/env node

import process from 'node:process'

import minimist from 'minimist'

import { TFlags } from './ifaces'
import { run } from './runner'
import { getSelfManifest } from './util'

const env = process.env

// Tiny, dependency-light option spec (keeps the supported Node floor low — see
// the v11 migration note): which flags take a value, their `YAF_*` env-var
// defaults, and the allowed `choices` for the few enum-like ones.
const BOOLEAN = ['dry-run', 'force', 'ignore-engines', 'silent', 'verbose']
const STRING = [
  'audit-level',
  'cwd',
  'exclude',
  'ignore',
  'npm-path',
  'registry',
  'symlink',
  'temp',
]
const CHOICES: Record<string, string[]> = {
  'audit-level': ['low', 'moderate', 'high', 'critical'],
  'npm-path': ['system', 'local'],
  symlink: ['junction', 'dir'],
}
const ENV_DEFAULTS: Record<string, string | undefined> = {
  'audit-level': env.YAF_AUDIT_LEVEL,
  cwd: env.YAF_CWD,
  'dry-run': env.YAF_DRY_RUN,
  exclude: env.YAF_EXCLUDE,
  force: env.YAF_FORCE,
  ignore: env.YAF_IGNORE,
  'ignore-engines': env.YAF_IGNORE_ENGINES,
  'npm-path': env.YAF_NPM_PATH || 'system',
  registry: env.YAF_REGISTRY,
  silent: env.YAF_SILENT,
  verbose: env.YAF_VERBOSE,
}

const HELP = `Usage: yarn-audit-fix [options]

Options:
  --audit-level <level>   Min severity to fix: low | moderate | high | critical
  --cwd <path>            Working directory (defaults to process.cwd())
  --dry-run               Print what would change without writing
  --exclude <glob>        Package glob(s) to exclude (repeatable)
  --force                 Apply semver-major upgrades, not just compatible ones
  --ignore <id>           Advisory id glob(s) to ignore (repeatable)
  --ignore-engines        Forward --ignore-engines to yarn install
  --npm-path <path>       npm to use: system | local
  --registry <url>        Custom registry url
  --silent                Disable log output
  --symlink <type>        node_modules symlink type: junction | dir
  --temp <dir>            Directory for temporary assets
  --verbose               Verbose/debug logging
  -v, --version           Print version
  -h, --help              Print this help

Every flag also reads a YAF_<FLAG> env var (e.g. YAF_AUDIT_LEVEL).`

const argv = process.argv.slice(2)
const raw = minimist(argv, {
  boolean: BOOLEAN,
  string: STRING,
  alias: { v: 'version', h: 'help' },
})

if (raw.version) {
  console.log(getSelfManifest().version)
} else if (raw.help) {
  console.log(HELP)
} else {
  // Collect the long flags in first-seen order so that the subset forwarded to
  // `yarn install` keeps the order the user typed (preserves prior behaviour).
  const known = new Set([...BOOLEAN, ...STRING])
  const orderedKeys: string[] = []
  for (const token of argv) {
    if (!token.startsWith('--')) continue
    const key = token.replace(/^--(no-)?/, '').split('=')[0]
    if (known.has(key) && !orderedKeys.includes(key)) orderedKeys.push(key)
  }

  const flags: TFlags = {}
  // Explicit flags first (a boolean set to `false` via `--no-x`/`--x=false`
  // means "off" → omit it), then `YAF_*` defaults for whatever is still unset.
  for (const key of orderedKeys) {
    if (raw[key] !== false) flags[key] = raw[key]
  }
  for (const key of known) {
    if (!(key in flags) && ENV_DEFAULTS[key] !== undefined)
      flags[key] = ENV_DEFAULTS[key]
  }

  let valid = true
  for (const [key, allowed] of Object.entries(CHOICES)) {
    const value = flags[key]
    if (value !== undefined && !allowed.includes(String(value))) {
      console.error(
        `Invalid value for --${key}: "${value}". Expected one of: ${allowed.join(', ')}`,
      )
      valid = false
    }
  }

  if (valid) {
    // run() sets process.exitCode on failure; swallow the rejection so we don't
    // also print an unhandled-rejection stack on top of run()'s own report.
    run(flags).catch(() => {})
  } else {
    process.exitCode = 1
  }
}
