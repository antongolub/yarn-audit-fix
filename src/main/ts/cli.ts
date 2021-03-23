#!/usr/bin/env node

import { run } from './runner'
import {formatFlags, normalizeFlags, parseEnv} from './util'
import { Command, Option } from 'commander'

const env = process.env
const flags = new Command()
  // low, moderate, high, critical | low
  .addOption(new Option('--audit-level [level]', 'Include a vulnerability with a level as defined or higher')
    .choices(['low', 'moderate', 'high', 'critical'])
    .default(env.YAF_AUDIT_LEVEL)
  )
  .option('--audit-level [level]', 'Include a vulnerability with a level as defined or higher', env.YAF_AUDIT_LEVEL)
  .option('--dry-run', 'Get an idea of what audit fix will do', env.YAF_DRY_RUN_FORCE)
  .option('--force', 'Have audit fix install semver-major updates to toplevel dependencies, not just semver-compatible ones', env.YAF_FORCE)
  .option('--loglevel [level]', 'Set custom log level', env.YAF_LOGLEVEL)
  .option('--legacy-peer-deps', 'Accept an incorrect (potentially broken) deps resolution', env.YAF_LEGACY_PEER_DEPS)
  .addOption(new Option('--npm-path [path]', 'Switch to system default version of npm instead of package\'s own.')
    .choices(['system', 'local'])
    .default(env.YAF_NPM_PATH || 'local')
  )
  .addOption(new Option('--only [scope]', 'Set package updating scope')
    .choices(['prod', 'dev'])
    .default(env.YAF_ONLY)
  )
  .option('--package-lock-only [bool]', 'Run audit fix without modifying `node_modules`.', env.YAF_PACKAGE_LOCK_ONLY)
  .option('--registry [registry]', 'Custom registry url', env.YAF_REGISTRY)
  .option('--silent', ' Disable log output', env.YAF_SILENT)
  .option('--temp [dir]', ' Directory for temporary assets')
  .option('--verbose', 'Switch log level to verbose/debug', env.YAF_VERBOSE)
  .allowUnknownOption()
  .parse([...formatFlags(parseEnv(process.env)), ...process.argv.slice(2)], {from: 'user'})
  .opts()

run(normalizeFlags(flags)).catch((reason) => {
  !flags.silent && console.error(reason)
  process.exit(reason.status | 0 || 1)
})
