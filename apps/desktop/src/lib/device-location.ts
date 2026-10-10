// The device's current location for the agent's device_location tool (tools/device_location_tool.py):
// the phone shell's GPS when hosted by the phone app (mobile/src/ScoutScreen.tsx), else the
// browser/OS location services. Always resolves; a failure is an {error} the agent can relay.

export interface DeviceLocation {
  accuracy?: null | number
  device: 'computer' | 'phone'
  latitude: number
  longitude: number
}

const TIMEOUT_MS = 20_000

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

function fromBrowser(): Promise<DeviceLocation | { error: string }> {
  if (!('geolocation' in navigator)) {
    return Promise.resolve({ error: 'This device has no location services.' })
  }

  return new Promise(resolve =>
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({ accuracy: coords.accuracy, device: 'computer', latitude: coords.latitude, longitude: coords.longitude }),
      error => resolve({ error: error.code === error.PERMISSION_DENIED ? 'Location access was not allowed.' : error.message }),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: TIMEOUT_MS }
    )
  )
}

export async function readDeviceLocation(): Promise<DeviceLocation | { error: string }> {
  const native = window.scoutNative

  if (!native) {
    return fromBrowser()
  }

  try {
    const found = await native.request<{ accuracy?: number; latitude: number; longitude: number }>('location')

    return { accuracy: found.accuracy ?? null, device: 'phone', latitude: found.latitude, longitude: found.longitude }
  } catch (error) {
    return { error: reason(error) }
  }
}
