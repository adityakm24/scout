/**
 * What Scout is doing right now, in a line a person reads at a glance — the phone's Live
 * Activity / ongoing notification (src/platform/phone-activity.ts) shows it.
 *
 * One activity at a time, like a phone shows one: a chat waiting on the user beats one that is
 * merely working, and between working chats the most recently active wins. Tool lines come from
 * the backend (`tool.start` → `activity`, tools/tool_activity.py); the waiting and thinking lines
 * are the renderer's, because it is the side that knows a card is on screen.
 */

import { atom, computed } from 'nanostores'

import { translateNow } from '@/i18n'

import { $approvalRequests } from './prompts'
import { $sessions } from './session'
import { $attentionSessionIds, $workingSessionIds, storedSessionIdForRuntimeId } from './session-states'

export type AgentActivityPhase = 'waiting' | 'working'

export interface AgentActivity {
  line: string
  phase: AgentActivityPhase
  sessionId: string
  /** Epoch ms the turn started: the live surface counts up from it. */
  startedAt: number
  title: string
}

interface Noted {
  at: number
  line: string
}

const $lines = atom<Record<string, Noted>>({})
const startedAt = new Map<string, number>()

/** A tool began; `line` is what it is doing for the user. Keyed by the stored session id. */
export function noteAgentActivity(runtimeId: string, line: string, at = Date.now()) {
  const stored = storedSessionIdForRuntimeId(runtimeId) ?? runtimeId

  if (line && $lines.get()[stored]?.line !== line) {
    $lines.set({ ...$lines.get(), [stored]: { at, line } })
  }
}

function waitingLine(stored: string): string {
  const approval = Object.values($approvalRequests.get()).find(
    request => request?.sessionId && (storedSessionIdForRuntimeId(request.sessionId) ?? request.sessionId) === stored
  )

  if (approval?.order) {
    return translateNow('activity.approveOrder', approval.order.merchant)
  }

  return translateNow(approval ? 'activity.waitingApproval' : 'activity.question')
}

export const $liveActivity = computed(
  [$workingSessionIds, $attentionSessionIds, $lines, $sessions, $approvalRequests],
  (working, attention, lines, sessions): AgentActivity | null => {
    const live = new Set([...working, ...attention])

    for (const id of startedAt.keys()) {
      if (!live.has(id)) {
        startedAt.delete(id)
      }
    }

    if (live.size === 0) {
      return null
    }

    const title = (id: string) => sessions.find(row => row.id === id)?.title?.trim() || 'Scout'
    const since = (id: string) => startedAt.get(id) ?? (startedAt.set(id, Date.now()), startedAt.get(id)!)
    const waiting = attention[0]

    if (waiting) {
      return { line: waitingLine(waiting), phase: 'waiting', sessionId: waiting, startedAt: since(waiting), title: title(waiting) }
    }

    const id = [...working].sort((a, b) => (lines[b]?.at ?? 0) - (lines[a]?.at ?? 0))[0]

    return {
      line: lines[id]?.line ?? translateNow('activity.thinking'),
      phase: 'working',
      sessionId: id,
      startedAt: since(id),
      title: title(id)
    }
  }
)

let desktopWatch = false

/** On a computer, the same line as one quiet notification that changes with each step, shown
 *  only while Scout is in the background (store/native-notifications.ts `activity`). */
export function startDesktopActivityNotifications(
  notify: (input: { body: string; sessionId: string; title: string }) => void
) {
  if (desktopWatch) {
    return
  }

  desktopWatch = true

  let last = ''

  $liveActivity.subscribe(activity => {
    const key = activity ? `${activity.sessionId}:${activity.line}` : ''

    if (activity && key !== last) {
      notify({ body: activity.title, sessionId: activity.sessionId, title: activity.line })
    }

    last = key
  })
}
