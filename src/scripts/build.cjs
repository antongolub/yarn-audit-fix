#!/usr/bin/env node

const esbuild = require('esbuild')
const { nodeExternalsPlugin } = require('esbuild-node-externals')
const glob = require('fast-glob')
const minimist = require('minimist')
const path = require('node:path')

const {entry, external} = minimist(process.argv.slice(2), {
  default: {
    entry: './src/main/ts/index.ts'
  }
})

const esmConfig = {
  entryPoints: entry.split(':').map(e => e.includes('*') ? glob.sync(e, {absolute: false, onlyFiles: true, cwd: process.cwd()}) : path.normalize(path.join(process.cwd(), e))).flat(1),
  outdir: './target/esm',
  bundle: true,
  minify: true,
  sourcemap: true,
  sourcesContent: false,
  platform: 'node',
  target: 'ES2020',
  format: 'esm',
  outExtension: {
    '.js': '.mjs'
  },
  external: ['node:*'],               // https://github.com/evanw/esbuild/issues/1466
  plugins: [nodeExternalsPlugin()],   // https://github.com/evanw/esbuild/issues/619
  tsconfig: './tsconfig.json'
}

const cjsConfig = {
  ...esmConfig,
  outdir: './target/cjs',
  target: 'es6',
  format: 'cjs',
  outExtension: {
    '.js': '.cjs'
  }
}

const config = process.argv.includes('--cjs')
  ? cjsConfig
  : esmConfig

esbuild
  .build(config)
  .catch(() => process.exit(1))
