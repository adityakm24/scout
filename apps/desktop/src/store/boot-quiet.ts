// The quiet reconnect window for a lost backend (components/boot-quiet-recovery.ts). Kept in
// sessionStorage so it survives the reloads recovery itself performs: one window per outage.
const SINCE_KEY = 'scout.boot.quietSince'
const RESTARTED_KEY = 'scout.boot.quietRestarted'

const read = (key: string) => {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: null | string) => {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key)
    } else {
      window.sessionStorage.setItem(key, value)
    }
  } catch {
    // Storage unavailable: the window just restarts per page load.
  }
}

/** A boot that completed ends the outage: the next failure starts a fresh quiet window. */
export function endQuietRecovery() {
  write(SINCE_KEY, null)
  write(RESTARTED_KEY, null)
}

export const quietRecoveryState = {
  begin: () => write(SINCE_KEY, String(Date.now())),
  markRestarted: () => write(RESTARTED_KEY, '1'),
  restarted: () => read(RESTARTED_KEY) !== null,
  since: () => {
    const value = Number(read(SINCE_KEY))

    return Number.isFinite(value) && value > 0 ? value : null
  }
}
