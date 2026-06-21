import process from 'node:process'

export type TProgress = {
  /** Set the spinner caption (interactive only). */
  label: (text: string) => void
  /** Print a line above the spinner (clear → write → redraw). */
  log: (line: string) => void
  /** Stop the animation and clear the spinner line. */
  stop: () => void
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Dependency-free progress reporter for the network-bound patch pipeline.
 *
 * On an interactive stderr it animates a braille spinner pinned to the bottom
 * line — updated via `label` — so the silent HTTP phases (advisory fetch,
 * packument resolution, tarball checksum recompute) no longer look frozen.
 * `log` prints a line cleanly above the spinner.
 *
 * Off a TTY (CI, pipes) or when `enabled` is false it drops the animation
 * entirely and only passes `log` lines through, so non-interactive output and
 * `--silent` stay clean. Writes go to **stderr** (the spinner) / **stdout**
 * (logs); the produced `yarn.lock` is untouched either way.
 */
export const createProgress = (enabled: boolean): TProgress => {
  const interactive = enabled && !!process.stderr.isTTY && !process.env.CI

  if (!interactive) {
    return {
      label: () => {},
      log: (line) => {
        if (enabled) console.log(line)
      },
      stop: () => {},
    }
  }

  let frame = 0
  let text = ''
  const clear = () => process.stderr.write('\r\x1b[2K')
  const draw = () => {
    process.stderr.write(`\r\x1b[2K${FRAMES[frame]} ${text}`)
    frame = (frame + 1) % FRAMES.length
  }
  const timer = setInterval(draw, 80)
  // Don't keep the event loop alive on the spinner alone.
  timer.unref?.()

  return {
    label: (t) => {
      text = t
    },
    log: (line) => {
      clear()
      console.log(line)
      draw()
    },
    stop: () => {
      clearInterval(timer)
      clear()
    },
  }
}
