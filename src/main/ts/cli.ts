#!/usr/bin/env node

import {run} from './index'

run().catch(reason => {
  console.error(reason)
  process.exit(+reason.status || 1)
})
