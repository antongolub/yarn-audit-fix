#!/usr/bin/env node

import {run} from './index'
import {parseFlags} from './util'

const flags = parseFlags(process.argv.slice(2))

run(flags).catch(reason => {
  console.error(reason)
  process.exit(+reason.status || 1)
})
