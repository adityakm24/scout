import { useEffect, useState } from 'react'

import { quietRecoveryState as state } from '@/store/boot-quiet'

/** How long a lost backend is retried silently before the recovery screen appears. */
export const QUIET_RECOVERY_MS = 60_000
const PROBE_EVERY_MS = 3_000
// One silent restart (reset + reload) partway through: a crashed local backend never answers a
// probe on its own, the reload is what respawns it.
const SILENT_RESTART_AFTER_MS = 15_000

/**
 * A backend that drops for a moment (restart, sleep, update) should not greet the user with a
 * recovery screen. While `failed`, probe the backend; reconnect (`restart`) as soon as it answers,
 * restart once silently, and only report `quiet: false` — show the screen — after
 * {@link QUIET_RECOVERY_MS}. The window outlives the reloads recovery performs and dismissal of
 * the screen; only a completed boot (`endQuietRecovery`, store/boot-quiet.ts) closes it.
 */
export function useQuietRecovery(failed: boolean, restart: () => Promise<void>): { quiet: boolean } {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!failed) {
      return
    }

    if (!state.since()) {
      state.begin()
    }

    let stopped = false

    const tick = async () => {
      const since = state.since() ?? Date.now()
      setNow(Date.now())

      if (stopped || Date.now() - since >= QUIET_RECOVERY_MS) {
        return
      }

      const answered = await window.scoutDesktop
        ?.api({ path: '/api/status', timeoutMs: 2_500 })
        .then(() => true)
        .catch(() => false)

      if (stopped) {
        return
      }

      if (answered || (Date.now() - since >= SILENT_RESTART_AFTER_MS && !state.restarted())) {
        state.markRestarted()
        stopped = true
        await restart()
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), PROBE_EVERY_MS)

    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [failed, restart])

  const since = state.since() ?? now

  return { quiet: failed && now - since < QUIET_RECOVERY_MS }
}
