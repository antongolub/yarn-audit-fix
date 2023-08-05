import * as fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getNpm, getYarn, TContext } from '../../main/ts'
import { format, parse, patch } from '../../main/ts/lockfile/'
import { parseAuditReport as parseAuditV1 } from '../../main/ts/lockfile/v1'
import { parseAuditReport as parseAuditV2 } from '../../main/ts/lockfile/v2'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(__dirname, '../fixtures')

describe('patch', () => {
  const bins: Record<string, string> = {
    npm: getNpm(),
    yarn: getYarn(),
  }

  it('yarnlock v2', () => {
    const report = fs.readFileSync(
      join(fixtures, 'lockfile/v2/yarn-audit-report.json'),
      'utf-8',
    )
    const lockfile = fs.readFileSync(
      join(fixtures, 'lockfile/v2/yarn.lock'),
      'utf-8',
    )
    const expected = fs.readFileSync(
      join(fixtures, 'lockfile/v2/yarn-lock-patched.yaml'),
      'utf-8',
    )
    const result = format(
      patch(
        parse(lockfile, 'yarn2'),
        parseAuditV2(report),
        { flags: {}, bins } as TContext,
        'yarn2',
      ),
      'yarn2',
    )

    expect(result).toEqual(expected)
  })

  it('yarnlock v1', () => {
    const report = fs.readFileSync(
      join(fixtures, 'lockfile/v1/yarn-audit-report.json'),
      'utf-8',
    )
    const lockfile = fs.readFileSync(
      join(fixtures, 'lockfile/v1/yarn.lock'),
      'utf-8',
    )
    const expected = fs.readFileSync(
      join(fixtures, 'lockfile/v1/yarn-lock-patched.yaml'),
      'utf-8',
    )
    const result = format(
      patch(
        parse(lockfile, 'yarn1'),
        parseAuditV1(report),
        { flags: {}, bins } as TContext,
        'yarn1',
      ),
      'yarn1',
    )

    // fs.writeFileSync('result.yaml', result)
    expect(result).toEqual(expected)
  })
})
