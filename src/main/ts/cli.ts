#!/usr/bin/env node

import {run} from './index'
import minimist from 'minimist'

const flags = minimist(process.argv.slice(2))

run(flags).catch(reason => {
  console.error(reason)
  process.exit(+reason.status || 1)
})
