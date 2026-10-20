import { capabilityScoped, type ProfileScope } from './client'

/** Who drives the Browser Agent's screen (`tools/bot_desktop/lease.py`); the holder is named by hash only. */
export interface BrowserScreenLease {
  holder: 'agent' | 'human'
  viewer_hash: null | string
}

export interface BrowserScreenStatus {
  lease: BrowserScreenLease
  running: boolean
}

export interface BrowserScreenObserve extends BrowserScreenStatus {
  path: string
  ticket: string
  viewer_id: string
}

const call = <T>(profile: ProfileScope | undefined, path: string, method = 'GET', body?: unknown) =>
  window.scoutDesktop.api<T>({ ...capabilityScoped(profile), path, method, ...(body === undefined ? {} : { body }) })

export const getBrowserScreen = (profile?: ProfileScope) => call<BrowserScreenStatus>(profile, '/api/browser-screen')

export const observeBrowserScreen = (profile?: ProfileScope) =>
  call<BrowserScreenObserve>(profile, '/api/browser-screen/observe', 'POST', {})

export const setBrowserScreenControl = (profile: ProfileScope | undefined, viewerId: string, take: boolean) =>
  call<{ lease: BrowserScreenLease }>(profile, '/api/browser-screen/lease', 'POST', { viewer_id: viewerId, take })

/** `viewer_hash` as the lease reports it: the first 12 hex of sha256(viewer_id). */
export async function viewerHash(viewerId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(viewerId))

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}
