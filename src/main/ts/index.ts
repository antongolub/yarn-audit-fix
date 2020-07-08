import cp from 'child_process'

type Stage = [
  string,
  [string, string[] | undefined]?
]

export const stages: Stage[] = [
  [
    'Generating package-lock.json from yarn.lock',
    ['node_modules/.bin/synp', ['-s', 'yarn.lock']],
  ],
  [
    'Removing yarn.lock',
    ['node_modules/.bin/rimraf', ['yarn.lock']],
  ],
  [
    'Applying npm audit fix...',
    ['npm', ['audit', 'fix', '--package-lock-only']],
  ],
  [
    'Generating new yarn.lock from package-lock.json',
    ['node_modules/.bin/synp', ['-s', 'package-lock.json']],
  ],
  [
    'Removing package-lock.json',
    ['node_modules/.bin/rimraf', ['package-lock.json']],
  ],
  [
    'Done',
  ],
]

export const run = () => stages.forEach(([description, [cmd, args] = []]) => {
  console.log(description)

  if (cmd) {
    cp.spawnSync(cmd, args)
  }
})
