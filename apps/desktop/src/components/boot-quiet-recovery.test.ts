import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endQuietRecovery } from '@/store/boot-quiet'

import { QUIET_RECOVERY_MS, useQuietRecovery } from './boot-quiet-recovery'

const original = window.scoutDesktop

beforeEach(() => {
  vi.useFakeTimers()
  endQuietRecovery()
})

afterEach(() => {
  vi.useRealTimers()
  window.scoutDesktop = original
})

const backend = (up: () => boolean) => {
  window.scoutDesktop = {
    ...original,
    api: async () => {
      if (!up()) {
        throw new Error('ECONNREFUSED')
      }

      return {}
    }
  } as typeof window.scoutDesktop
}

describe('quiet recovery', () => {
  it('reconnects on its own as soon as the backend answers, without showing the screen', async () => {
    let up = false
    backend(() => up)
    const restart = vi.fn(async () => {})

    const { result } = renderHook(() => useQuietRecovery(true, restart))
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(result.current.quiet).toBe(true)
    expect(restart).not.toHaveBeenCalled()

    up = true
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(restart).toHaveBeenCalledOnce()
  })

  it('shows the screen only when the backend stays down past the quiet window', async () => {
    backend(() => false)
    const restart = vi.fn(async () => {})

    const { result } = renderHook(() => useQuietRecovery(true, restart))
    await act(() => vi.advanceTimersByTimeAsync(QUIET_RECOVERY_MS - 3_000))
    expect(result.current.quiet).toBe(true)
    // One silent restart along the way (a crashed local backend only respawns on a reload).
    expect(restart).toHaveBeenCalledOnce()

    await act(() => vi.advanceTimersByTimeAsync(6_000))
    expect(result.current.quiet).toBe(false)
  })
})
