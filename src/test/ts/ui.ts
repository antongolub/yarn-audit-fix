import { describe, expect, it, vi } from 'vitest'

import { createProgress } from '../../main/ts/ui'

// vitest's stderr is not a TTY, so `createProgress` takes its non-interactive
// path: no spinner, `label`/`stop` are no-ops, and `log` passes through only
// when enabled. (The animated branch is TTY-only and exercised manually.)
describe('createProgress', () => {
  it('is fully silent when disabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const p = createProgress(false)
    p.label('fetching')
    p.log('hello')
    p.stop()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('passes log lines through off a TTY, drops labels', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const p = createProgress(true)
    p.label('phase') // no-op without a TTY — would be spinner caption otherwise
    p.log('Upgraded deps (1):')
    p.stop()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('Upgraded deps (1):')
    spy.mockRestore()
  })

  it('animates a spinner on an interactive stderr', () => {
    const origTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
    const origCI = process.env.CI
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    delete process.env.CI
    vi.useFakeTimers()
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const p = createProgress(true)
      p.label('fetching advisories')
      vi.advanceTimersByTime(80) // one tick → a frame is drawn with the caption
      expect(write.mock.calls.some((c) => String(c[0]).includes('fetching advisories'))).toBe(true)

      write.mockClear()
      p.log('a line above the spinner')
      expect(log).toHaveBeenCalledWith('a line above the spinner')
      expect(write).toHaveBeenCalled() // clear + redraw around the log

      p.stop()
      write.mockClear()
      vi.advanceTimersByTime(240) // interval cleared → no further frames
      expect(write).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      write.mockRestore()
      log.mockRestore()
      if (origTTY) Object.defineProperty(process.stderr, 'isTTY', origTTY)
      else delete (process.stderr as any).isTTY
      if (origCI !== undefined) process.env.CI = origCI
    }
  })
})
