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
})
