#!/usr/bin/env node

import process from 'node:process'

import minimist from 'minimist'

import { TFlags } from './ifaces'
import { run } from './runner'
import { getSelfManifest } from './util'

// Declarative option spec (keeps `parse` small and the Node floor low — see the
// v11 migration note): value-taking vs boolean flags, their `YAF_*` env-var
// fallbacks, and the allowed values for the enum-like ones.
const BOOLEAN = ['dry-run', 'force', 'silent', 'verbose']
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
const ENV: Record<string, string> = {
  'audit-level': 'YAF_AUDIT_LEVEL',
  cwd: 'YAF_CWD',
  'dry-run': 'YAF_DRY_RUN',
  exclude: 'YAF_EXCLUDE',
  force: 'YAF_FORCE',
  ignore: 'YAF_IGNORE',
  'npm-path': 'YAF_NPM_PATH',
  registry: 'YAF_REGISTRY',
  silent: 'YAF_SILENT',
  verbose: 'YAF_VERBOSE',
}
const CHOICES: Record<string, string[]> = {
  'audit-level': ['low', 'moderate', 'high', 'critical'],
  'npm-path': ['system', 'local'],
  symlink: ['junction', 'dir'],
}

const HELP = `Usage: yarn-audit-fix [options]

Options:
  --audit-level <level>   Min severity to fix: low | moderate | high | critical
  --cwd <path>            Working directory (defaults to process.cwd())
  --dry-run               Print what would change without writing
  --exclude <rules>       Packages to skip updating: comma-sep glob[@range]
                          (e.g. lodash,@scope/*@>=2 <3)
  --force                 Apply semver-major upgrades, not just compatible ones
  --ignore <ids>          Advisory ids to ignore: comma-sep globs (GHSA or npm id)
  --npm-path <path>       npm to use: system | local
  --registry <url>        Custom registry url
  --silent                Disable log output
  --symlink <type>        node_modules symlink type: junction | dir
  --temp <dir>            Directory for temporary assets
  --verbose               Verbose/debug logging
  -v, --version           Print version
  -h, --help              Print this help

Every flag also reads a YAF_<FLAG> env var (e.g. YAF_AUDIT_LEVEL).`

/**
 * Parse argv into a flags object. Explicit flags win and are kept in first-seen
 * order (so the subset later forwarded to `yarn install` matches what the user
 * typed); `YAF_*` env vars fill the rest. `--version` / `--help` short-circuit.
 * Throws on an out-of-range `choices` value.
 */
export const parse = (
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): TFlags => {
  const raw = minimist(argv, {
    boolean: BOOLEAN,
    string: STRING,
    alias: { v: 'version', h: 'help' },
  })
  if (raw.version) return { version: true }
  if (raw.help) return { help: true }

  const known = new Set([...BOOLEAN, ...STRING])
  const flags: TFlags = {}

  // Explicit flags, in first-seen order; a `--no-x` / `--x=false` boolean is off.
  for (const token of argv) {
    if (!token.startsWith('--')) continue
    const key = token.replace(/^--(no-)?/, '').split('=')[0]
    if (known.has(key) && !(key in flags) && raw[key] !== false) flags[key] = raw[key]
  }
  // `YAF_*` fallback for whatever is still unset.
  for (const key of known) {
    const name = ENV[key]
    if (name && !(key in flags) && env[name] !== undefined) flags[key] = env[name]
  }
  flags['npm-path'] ??= 'system'

  for (const [key, allowed] of Object.entries(CHOICES)) {
    const value = flags[key]
    if (value !== undefined && !allowed.includes(String(value)))
      throw new Error(
        `Invalid value for --${key}: "${value}". Expected one of: ${allowed.join(', ')}`,
      )
  }

  return flags
}

// Async IIFE rather than top-level await: the bundle targets ES2020 (the Node
// 14 floor) where TLA isn't available. Failures are handled here, not by a caller.
// eslint-disable-next-line unicorn/prefer-top-level-await
void (async () => {
  try {
    const opts = parse()

    if (opts.version) console.log(getSelfManifest().version)
    else if (opts.help) console.log(HELP)
    else await run(opts)
  } catch (err) {
    // `parse` throws on invalid CLI input; `run` already printed its own report
    // and set process.exitCode — surface only a parse message, then ensure 1.
    if (process.exitCode === undefined && err instanceof Error)
      console.error(err.message)
    process.exitCode ||= 1
  }
})()
