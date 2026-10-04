import * as SecureStore from 'expo-secure-store'

/** Where the phone's Scout lives: the renderer's address and the backend session token. */
export interface Pairing {
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

    return { baseUrl: url.origin, token }
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
