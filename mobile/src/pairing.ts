import * as SecureStore from 'expo-secure-store'

/** Where the phone's Scout lives: the backend's origin (its API), the page with Scout's screens
 *  (`/app/` when the backend serves them, the origin itself from a dev server) and the session token. */
export interface Pairing {
  appUrl?: string
  baseUrl: string
  token: string
}

const KEY = 'scout.pairing'

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The address to pair with. A `scout://pair?link=` (or Expo `exp://…/pair?link=`) wrapper carries
 *  the https address; the address itself is `https://<machine>.<tailnet>.ts.net/app/?token=`.
 *  Read it without `URLSearchParams`: React Native's URL drops everything after the second `=`. */
function pairingTarget(text: string): string {
  const trimmed = text.trim()
  const wrapped = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/.*[?&]link=([^&#]*)/i)

  if (!wrapped || /^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return decodePart(wrapped[1])
}

/** A pairing link is the renderer's own address with `?token=`: the same link opens Scout in a
 *  phone browser and pairs this app. */
export function parsePairingLink(text: string): Pairing | null {
  const match = /^(https?:\/\/[^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i.exec(pairingTarget(text))

  if (!match?.[3]) {
    return null
  }

  const token = match[3]
    .split('&')
    .map(part => {
      const eq = part.indexOf('=')

      return eq < 0 ? null : ([decodePart(part.slice(0, eq)), decodePart(part.slice(eq + 1))] as const)
    })
    .find(part => part?.[0] === 'token')?.[1]

  if (!token) {
    return null
  }

  const origin = match[1]
  const path = match[2] || '/'

  return { appUrl: origin + path, baseUrl: origin, token }
}

/** `scout://pair?link=<pairing link>` (or Expo Go's `exp://…/--/pair?link=…` in development). */
export function pairingFromDeepLink(url: string): Pairing | null {
  return parsePairingLink(url)
}

export async function loadPairing(): Promise<Pairing | null> {
  const saved = await SecureStore.getItemAsync(KEY)

  if (!saved) {
    return null
  }

  try {
    const pairing = JSON.parse(saved) as Pairing

    return pairing.baseUrl && pairing.token ? pairing : null
  } catch {
    return null
  }
}

export const savePairing = (pairing: Pairing) => SecureStore.setItemAsync(KEY, JSON.stringify(pairing))

export const forgetPairing = () => SecureStore.deleteItemAsync(KEY)
