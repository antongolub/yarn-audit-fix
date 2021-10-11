#!/usr/bin/env node

import { Command, Option } from 'commander'

import { run } from './runner'

const env = process.env
const flags = new Command()
  .addOption(
    new Option(
      '--audit-level [level]',
      'Include a vulnerability with a level as defined or higher',
    )
      .choices(['low', 'moderate', 'high', 'critical'])
      .default(env.YAF_AUDIT_LEVEL),
  )
  .option(
    '--cwd [path]',
    'CWD. Defaults to `process.cwd()`',
    env.YAF_CWD,
  )
  .option(
    '--dry-run [bool]',
    'Get an idea of what audit fix will do',
    env.YAF_DRY_RUN,
  )
  .addOption(
    new Option('--flow [flow]', 'Define how `yarn.lock` is modified')
      .choices(['convert', 'patch'])
      .default(env.YAF_FLOW || 'patch'),
  )
  .option(
    '--force [bool]',
    'Have audit fix install semver-major updates to toplevel dependencies, not just semver-compatible ones',
    env.YAF_FORCE,
  )
  .option(
    '--ignore-engines [bool]',
    'Ignore engines check',
    env.YAF_IGNORE_ENGINES,
  )
  .option('--loglevel [level]', 'Set custom log level', env.YAF_LOGLEVEL)
  .option(
    '--legacy-peer-deps [bool]',
    'Accept an incorrect (potentially broken) deps resolution',
    env.YAF_LEGACY_PEER_DEPS,
  )
  .addOption(
    new Option(
      '--npm-path [path]',
      "Switch to system default version of npm instead of package's own.",
    )
      .choices(['system', 'local'])
      .default(env.YAF_NPM_PATH || 'local'),
  )
  .addOption(
    new Option('--only [scope]', 'Set package updating scope')
      .choices(['prod', 'dev'])
      .default(env.YAF_ONLY),
  )
  .option(
    '--package-lock-only [bool]',
    'Run audit fix without modifying `node_modules`.',
    env.YAF_PACKAGE_LOCK_ONLY,
  )
  .option('--registry [registry]', 'Custom registry url', env.YAF_REGISTRY)
  .option('--silent [bool]', 'Disable log output', env.YAF_SILENT)
  .addOption(
    new Option(
      '--symlink',
      'Define symlink type for `node_modules` assets',
    ).choices(['junction', 'dir']),
  )
  .option('--temp [dir]', 'Directory for temporary assets')
  .option(
    '--verbose [bool]',
    'Switch log level to verbose/debug',
    env.YAF_VERBOSE,
  )
  .allowUnknownOption()
  .parse(process.argv)
  .opts()

run.sync(flags)
