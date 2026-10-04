import { requireOptionalNativeModule } from 'expo'
import * as LiveActivity from 'expo-live-activity'
import * as Notifications from 'expo-notifications'
import { AppState, Platform } from 'react-native'

import { colors } from './theme'

/** What Scout is doing, from the page (apps/desktop/src/platform/phone-activity.ts). */
export interface ActivityUpdate {
  line: string
  phase: 'done' | 'waiting' | 'working'
  sessionId: string
  startedAt: number
  title: string
}

const ONGOING_ID = 'scout-activity'
const ONGOING_CHANNEL = 'scout-activity'
const ALERT_CHANNEL = 'scout-alerts'

let liveId: string | undefined
let lastPhase: ActivityUpdate['phase'] | null = null

// Only a development or store build carries the native module; Expo Go does not.
const liveActivityAvailable = () => Platform.OS === 'ios' && requireOptionalNativeModule('ExpoLiveActivity') != null

/** Android needs its channels before the first post: a quiet one for the running line (no sound
 *  on every step) and an alerting one for "Scout needs you" and "Scout is done". */
export async function prepareActivityChannels() {
  if (Platform.OS !== 'android') {
    return
  }

  await Notifications.setNotificationChannelAsync(ONGOING_CHANNEL, {
    importance: Notifications.AndroidImportance.LOW,
    name: 'What Scout is doing',
    showBadge: false
  })
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
    importance: Notifications.AndroidImportance.HIGH,
    name: 'Scout needs you'
  })
}

function liveState(update: ActivityUpdate) {
  return { subtitle: update.title, title: update.line }
}

// How long "Done" stays on the lock screen before the activity goes away.
const DONE_LINGER_MS = 10_000
let endTimer: ReturnType<typeof setTimeout> | undefined

/** iOS: one Live Activity on the lock screen and Dynamic Island, updated in place. */
function showLiveActivity(update: ActivityUpdate) {
  clearTimeout(endTimer)

  try {
    if (update.phase === 'done') {
      const id = liveId

      if (id) {
        // The library ends an activity at once; show "Done" first so the user sees the outcome.
        LiveActivity.updateActivity(id, liveState(update))
        endTimer = setTimeout(() => {
          LiveActivity.stopActivity(id, liveState(update))
          liveId = liveId === id ? undefined : liveId
        }, DONE_LINGER_MS)
      }

      return
    }

    if (liveId) {
      LiveActivity.updateActivity(liveId, liveState(update))
    } else {
      liveId =
        LiveActivity.startActivity(liveState(update), {
          backgroundColor: colors.card,
          deepLinkUrl: 'scout://',
          progressViewTint: colors.accent,
          subtitleColor: colors.textSecondary,
          titleColor: colors.text
        }) ?? undefined
    }
  } catch {
    // Live Activities switched off in Settings: the notifications below still reach the user.
    liveId = undefined
  }
}

/** Android (and iOS without Live Activities): a silent ongoing notification that changes in place,
 *  and an alert when Scout starts waiting on the user or finishes while the app is away. */
async function showNotification(update: ActivityUpdate) {
  if (update.phase === 'done') {
    await Notifications.dismissNotificationAsync(ONGOING_ID).catch(() => undefined)

    return
  }

  if (Platform.OS === 'android') {
    await Notifications.scheduleNotificationAsync({
      content: {
        autoDismiss: false,
        body: update.line,
        color: colors.accent,
        priority: Notifications.AndroidNotificationPriority.LOW,
        sticky: true,
        title: update.title
      },
      identifier: ONGOING_ID,
      trigger: { channelId: ONGOING_CHANNEL }
    })
  }
}

export async function showActivity(update: ActivityUpdate) {
  const entering = update.phase !== lastPhase
  lastPhase = update.phase === 'done' ? null : update.phase

  if (liveActivityAvailable()) {
    showLiveActivity(update)
  } else {
    await showNotification(update)
  }

  // Waiting on the user is the moment to ring, once, when they are not looking at Scout.
  if (entering && update.phase === 'waiting' && AppState.currentState !== 'active') {
    await Notifications.scheduleNotificationAsync({
      content: { body: update.title, sound: true, title: update.line },
      trigger: Platform.OS === 'android' ? { channelId: ALERT_CHANNEL } : null
    })
  }
}
