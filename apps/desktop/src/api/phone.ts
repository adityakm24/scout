import { capabilityScoped, type ProfileScope } from './client'

/** How the phone reaches this backend (`scout_backend/web_routers/phone.py`): Tailscale's HTTPS address. */
export interface PhonePairing {
  enable_url?: string
  error?: string
  host?: string
  link: null | string
  tailscale: 'missing' | 'not_served' | 'ready' | 'signed_out'
}

const call = (profile: ProfileScope | undefined, path: string, method = 'GET') =>
  window.scoutDesktop.api<PhonePairing>({
    ...capabilityScoped(profile),
    path,
    method,
    ...(method === 'POST' ? { body: {} } : {})
  })

export const getPhonePairing = (profile?: ProfileScope) => call(profile, '/api/phone/pairing')

/** Put the backend on the tailnet over HTTPS, then answer like getPhonePairing. */
export const servePhone = (profile?: ProfileScope) => call(profile, '/api/phone/serve', 'POST')
