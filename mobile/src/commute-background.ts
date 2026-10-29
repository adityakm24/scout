import * as Location from 'expo-location'
import * as SecureStore from 'expo-secure-store'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'

import type { Pairing } from './pairing'

const TASK_NAME = 'scout-commute-location'
const CONFIG_KEY = 'scout.commute-background'

interface CommuteBackgroundConfig extends Pairing {
  profile: string
  syncId: string
}

interface CommuteLocationResponse {
  stop_tracking?: boolean
}

function profileQuery(profile: string): string {
  return profile && profile !== 'current' ? `?profile=${encodeURIComponent(profile)}` : ''
}

async function postLocation(config: CommuteBackgroundConfig, location: Location.LocationObject) {
  const response = await fetch(
    `${config.baseUrl}/api/commute/location${profileQuery(config.profile)}`,
    {
      body: JSON.stringify({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        sync_id: config.syncId
      }),
      headers: { 'content-type': 'application/json', 'X-Scout-Session-Token': config.token },
      method: 'POST'
    }
  )

  if (response.status === 404) {
    await stopBackgroundCommuteTracking(config.syncId)

    return
  }
  if (!response.ok) {
    throw new Error(`Commute location update failed (${response.status}): ${await response.text()}`)
  }

  const result = (await response.json()) as CommuteLocationResponse
  if (result.stop_tracking) {
    await stopBackgroundCommuteTracking(config.syncId)
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn(`[commute] Background location task failed: ${error.message}`)

    return
  }

  const location = data?.locations.at(-1)
  if (!location) {
    return
  }

  try {
    const saved = await SecureStore.getItemAsync(CONFIG_KEY)
    if (!saved) {
      await stopBackgroundCommuteTracking()

      return
    }

    const config = JSON.parse(saved) as CommuteBackgroundConfig
    await postLocation(config, location)
  } catch (taskError) {
    console.warn(`[commute] ${taskError instanceof Error ? taskError.message : String(taskError)}`)
  }
})

export async function startBackgroundCommuteTracking(
  pairing: Pairing,
  syncId: string,
  profile: string
): Promise<void> {
  if (Platform.OS !== 'ios') {
    throw new Error('Background commute tracking is currently supported on iPhone only.')
  }

  const taskAvailable = await TaskManager.isAvailableAsync()
  if (!taskAvailable) {
    throw new Error('Background tasks are unavailable in this app build. Install a native Release build.')
  }

  const foreground = await Location.requestForegroundPermissionsAsync()
  if (foreground.status !== 'granted') {
    throw new Error('Allow Scout to use your location to start commute tracking.')
  }

  const background = await Location.requestBackgroundPermissionsAsync()
  if (background.status !== 'granted') {
    throw new Error('Set Scout location access to Always in iPhone Settings to track while locked.')
  }

  const config: CommuteBackgroundConfig = { ...pairing, profile, syncId }
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
  })

  if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
    return
  }

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.AutomotiveNavigation,
    deferredUpdatesDistance: 100,
    deferredUpdatesInterval: 60_000,
    distanceInterval: 100,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true
  })
}

export async function stopBackgroundCommuteTracking(syncId?: string): Promise<void> {
  const saved = await SecureStore.getItemAsync(CONFIG_KEY)
  if (syncId && saved) {
    const config = JSON.parse(saved) as CommuteBackgroundConfig
    if (config.syncId !== syncId) {
      return
    }
  }

  if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(TASK_NAME)
  }
  await SecureStore.deleteItemAsync(CONFIG_KEY)
}

export async function refreshBackgroundCommuteStatus(
  pairing: Pairing,
  syncId: string,
  profile: string
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${pairing.baseUrl}/api/commute/tracking/${encodeURIComponent(syncId)}${profileQuery(profile)}`,
    { headers: { 'X-Scout-Session-Token': pairing.token } }
  )
  if (!response.ok) {
    throw new Error(`Commute status refresh failed (${response.status}): ${await response.text()}`)
  }

  return (await response.json()) as Record<string, unknown>
}
