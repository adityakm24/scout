// Hands Scout's live activity (store/agent-activity.ts) to the phone shell, which shows it as an
// iOS Live Activity or an Android ongoing notification (mobile/src/activity.ts). Only changes
// cross; the end of a turn is sent as `done` so the surface can close itself.
//
// The chat on screen crosses too: once the app is closed, the backend pushes that chat's replies
// and steps to this phone (mobile/src/push.ts, scout_cli/push/).

import { translateNow } from '@/i18n'
import { $liveActivity, type AgentActivity } from '@/store/agent-activity'
import { $selectedStoredSessionId } from '@/store/session'

export interface PhoneActivityUpdate {
  line: string
  phase: 'done' | AgentActivity['phase']
  sessionId: string
  startedAt: number
  title: string
}

let started = false

export function startPhoneActivity() {
  const native = window.scoutNative

  if (started || !native) {
    return
  }

  started = true

  let last: null | PhoneActivityUpdate = null
  let sent = ''

  const send = (update: PhoneActivityUpdate) => {
    const key = JSON.stringify(update)

    if (key !== sent) {
      sent = key
      void native.request('activity', update).catch(() => undefined)
    }
  }

  $selectedStoredSessionId.subscribe(sessionId => {
    if (sessionId) {
      void native.request('watch', { sessionId }).catch(() => undefined)
    }
  })

  $liveActivity.subscribe(activity => {
    if (activity) {
      last = { ...activity }
      send(last)
    } else if (last) {
      send({ ...last, line: translateNow('activity.done'), phase: 'done' })
      last = null
    }
  })
}
