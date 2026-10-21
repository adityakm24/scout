import * as SecureStore from 'expo-secure-store'

/** Where the phone's Scout lives: the backend's origin (its API), the page with Scout's screens
 *  (`/app/` when the backend serves them, the origin itself from a dev server) and the session token. */
export interface Pairing {
  appUrl?: string
  baseUrl: string
  token: string
}

const KEY = 'scout.pairing'

/** A pairing link is the renderer's own address with `?token=`: the same link opens Scout in a
 *  phone browser (src/platform/web-bridge.ts reads it there) and pairs this app. */
export function parsePairingLink(text: string): Pairing | null {
  try {
    const url = new URL(text.trim())
    const token = url.searchParams.get('token')

    if (!/^https?:$/.test(url.protocol) || !token) {
      return null
    }

    return { appUrl: url.origin + url.pathname, baseUrl: url.origin, token }
  } catch {
    return null
  }
}

/** `scout://pair?link=<pairing link>` (or Expo Go's `exp://…/--/pair?link=…` in development). */
export function pairingFromDeepLink(url: string): Pairing | null {
  try {
    const link = new URL(url).searchParams.get('link')

    return link ? parsePairingLink(link) : null
  } catch {
    return null
  }
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
