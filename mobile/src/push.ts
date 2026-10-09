import Constants from 'expo-constants'
import * as LiveActivity from 'expo-live-activity'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { AppState, type AppStateStatus, Platform } from 'react-native'

import type { Pairing } from './pairing'

// Tells the paired Scout how to reach this phone once iOS or Android suspends the app
// (scout_cli/push/): the Expo push token for notifications, Apple's tokens for the Live Activity,
// whether the app is on screen, and which chat is. While the app is on screen the page does all
// of it itself, so the backend stays quiet.

const DEVICE_KEY = 'scout.device-id'
// The backend counts a phone as away 150 s after its last "on screen" (FOREGROUND_TTL_SECONDS).
const PRESENCE_REFRESH_MS = 60_000
// The name a Live Activity started by push carries (scout_cli/push/apns.py ACTIVITY_NAME_PREFIX).
const PUSHED_ACTIVITY_PREFIX = 'scout:'

let pairing: null | Pairing = null
let deviceId = ''
let watching: null | string = null
let pushToStartToken: null | string = null
// Whether the server's notifications get through (the push service took the last one).
let serverDelivers = false

// Live Activity id → its chat, its update token, and what the backend was last told.
const activityChats = new Map<string, string>()
const activityTokens = new Map<string, string>()
const activityPosted = new Map<string, { sessionId: string; token: string }>()

async function api(path: string, method: 'DELETE' | 'POST', body?: unknown) {
  if (!pairing || !deviceId) {
    return
  }

  const response = await fetch(`${pairing.baseUrl}/api/push/devices${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'X-Scout-Session-Token': pairing.token },
    method
  })

  if (!response.ok) {
    throw new Error(`${method} /api/push/devices${path}: ${response.status}`)
  }

  const answer = (await response.json().catch(() => null)) as { delivers?: boolean | null } | null

  if (answer && 'delivers' in answer) {
    serverDelivers = answer.delivers === true
  }
}

const quietly = (work: Promise<unknown>) => void work.catch(error => console.warn(`[push] ${String(error)}`))

async function stableDeviceId(): Promise<string> {
  const saved = await SecureStore.getItemAsync(DEVICE_KEY)

  if (saved) {
    return saved
  }

  const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  await SecureStore.setItemAsync(DEVICE_KEY, created)

  return created
}

/** Expo's token for this install, or null where there is none (no permission, no network, a
 *  simulator without push). Notifications then come only from the page while the app is open. */
async function expoToken(): Promise<null | string> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId

  try {
    const { granted } = await Notifications.getPermissionsAsync()

    return granted && projectId ? (await Notifications.getExpoPushTokenAsync({ projectId })).data : null
  } catch (error) {
    console.warn(`[push] no Expo push token: ${String(error)}`)

    return null
  }
}

async function register() {
  const token = await expoToken()

  // Apple's push-to-start token can arrive before this phone knows its own id: startPush posts it.
  if (!deviceId) {
    return
  }

  await api('', 'POST', {
    device_id: deviceId,
    expo_token: token,
    name: Constants.deviceName ?? '',
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    push_to_start_token: pushToStartToken
  })
}

function reportPresence(state: AppStateStatus = AppState.currentState) {
  quietly(api(`/${encodeURIComponent(deviceId)}/presence`, 'POST', { foreground: state === 'active', watching }))
}

/** The backend learns which chat each Live Activity follows, and Apple's token to change it. */
function postActivity(activityId: string) {
  const sessionId = activityChats.get(activityId)
  const token = activityTokens.get(activityId)
  const before = activityPosted.get(activityId)

  if (!sessionId || !token || (before?.sessionId === sessionId && before.token === token)) {
    return
  }

  const path = `/${encodeURIComponent(deviceId)}/live-activity`

  if (before && before.sessionId !== sessionId) {
    quietly(api(path, 'POST', { session_id: before.sessionId, token: null }))
  }

  activityPosted.set(activityId, { sessionId, token })
  quietly(api(path, 'POST', { session_id: sessionId, token }))
}

function forgetActivity(activityId: string) {
  const before = activityPosted.get(activityId)

  activityChats.delete(activityId)
  activityTokens.delete(activityId)
  activityPosted.delete(activityId)

  if (before) {
    quietly(api(`/${encodeURIComponent(deviceId)}/live-activity`, 'POST', { session_id: before.sessionId, token: null }))
  }
}

// The page is frozen soon after iOS takes the app off screen, and catches up when it comes back:
// what it would notify about then, the user is about to see (and the server already pushed).
const CATCH_UP_MS = 3_000
const IOS_FREEZES_AFTER_MS = 25_000
let activeSince = AppState.currentState === 'active' ? Date.now() : 0
let awaySince = AppState.currentState === 'active' ? 0 : Date.now()

AppState.addEventListener('change', state => {
  if (state === 'active') {
    activeSince = Date.now()
  } else if (awaySince <= activeSince) {
    awaySince = Date.now()
  }
})

/** Whether the phone should post the page's notification itself, or leave it to the server. */
export function notifyLocally(): boolean {
  const now = Date.now()

  if (AppState.currentState === 'active') {
    return now - activeSince > CATCH_UP_MS
  }

  if (Platform.OS === 'ios' && now - awaySince > IOS_FREEZES_AFTER_MS) {
    return false
  }

  return !serverDelivers
}

/** The page's Live Activity now follows `sessionId` (mobile/src/activity.ts). */
export function noteLiveActivity(activityId: string, sessionId: string) {
  activityChats.set(activityId, sessionId)
  postActivity(activityId)
}

/** The chat on screen (from the page): its replies and steps follow the phone once it is closed. */
export function setWatching(sessionId: string) {
  if (sessionId && sessionId !== watching) {
    watching = sessionId
    reportPresence()
  }
}

// Apple hands these over once, early, and only to a listener already attached: subscribe as soon
// as the app loads, before any registration, and post what arrived once the phone is registered.
if (Platform.OS === 'ios') {
  LiveActivity.addActivityPushToStartTokenListener(({ activityPushToStartToken }) => {
    pushToStartToken = activityPushToStartToken
    quietly(register())
  })
  LiveActivity.addActivityTokenListener(({ activityID, activityName, activityPushToken }) => {
    activityTokens.set(activityID, activityPushToken)

    if (activityName.startsWith(PUSHED_ACTIVITY_PREFIX)) {
      activityChats.set(activityID, activityName.slice(PUSHED_ACTIVITY_PREFIX.length))
    }

    postActivity(activityID)
  })
  LiveActivity.addActivityUpdatesListener(({ activityID, activityState }) => {
    if (activityState === 'ended' || activityState === 'dismissed') {
      forgetActivity(activityID)
    }
  })
}

/** Start telling `next`'s Scout about this phone; returns a stop function. */
export function startPush(next: Pairing): () => void {
  const subscriptions: { remove: () => void }[] = []
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  const onState = (state: AppStateStatus) => {
    clearInterval(timer)
    reportPresence(state)

    if (state === 'active') {
      timer = setInterval(() => reportPresence('active'), PRESENCE_REFRESH_MS)
    }
  }

  void (async () => {
    const id = await stableDeviceId()

    if (stopped) {
      return
    }

    pairing = next
    deviceId = id

    try {
      await register()
    } catch (error) {
      console.warn(`[push] registration failed: ${String(error)}`)

      return
    }

    onState(AppState.currentState)
    activityChats.forEach((_, activityId) => postActivity(activityId))
    subscriptions.push(AppState.addEventListener('change', onState))
    // A new token after a reinstall or a permission change.
    subscriptions.push(Notifications.addPushTokenListener(() => quietly(register())))
  })()

  return () => {
    stopped = true
    clearInterval(timer)
    subscriptions.forEach(subscription => subscription.remove())
  }
}

/** This phone stops hearing from Scout (unpairing). */
export async function forgetPush() {
  await api(`/${encodeURIComponent(deviceId)}`, 'DELETE').catch(() => undefined)
  pairing = null
}
