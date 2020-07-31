#!/usr/bin/env node

import {run} from './index'

let promise

// tslint:disable-next-line:no-floating-promises
(async() => {
  promise = run()

  await promise
})()

module.exports = promise
