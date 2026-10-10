import { capabilityScoped, type ProfileScope } from './client'

export type GoogleServiceId = 'calendar' | 'contacts' | 'docs' | 'drive' | 'gmail' | 'sheets'

/** One Google sign-in behind the google-workspace skill (Gmail, Calendar, Drive, Docs, Sheets, Contacts). */
export interface GoogleWorkspaceStatus {
  account: null | string
  client_configured: boolean
  services: { granted: boolean; id: GoogleServiceId }[]
  signed_in: boolean
}

export interface GoogleSignInResult {
  error: null | string
  status: 'done' | 'error' | 'pending'
}

const call = <T>(profile: ProfileScope | undefined, path: string, method = 'GET', body?: unknown) =>
  window.scoutDesktop.api<T>({ ...capabilityScoped(profile), path, method, ...(body === undefined ? {} : { body }) })

export const getGoogleWorkspace = (profile?: ProfileScope) =>
  call<GoogleWorkspaceStatus>(profile, '/api/google-workspace')

export const saveGoogleWorkspaceClient = (profile: ProfileScope | undefined, clientId: string, clientSecret: string) =>
  call<GoogleWorkspaceStatus>(profile, '/api/google-workspace/client', 'PUT', {
    client_id: clientId,
    client_secret: clientSecret
  })

export const startGoogleSignIn = (profile: ProfileScope | undefined, clientRedirectUri?: string) =>
  call<{ auth_url: string; flow_id: string }>(profile, '/api/google-workspace/sign-in', 'POST', {
    client_redirect_uri: clientRedirectUri ?? null
  })

export const relayGoogleSignIn = (
  profile: ProfileScope | undefined,
  flowId: string,
  reply: { code: null | string; error: null | string; state: null | string }
) =>
  call<GoogleSignInResult>(
    profile,
    `/api/google-workspace/sign-in/${encodeURIComponent(flowId)}/callback`,
    'POST',
    reply
  )

export const pollGoogleSignIn = (profile: ProfileScope | undefined, flowId: string) =>
  call<GoogleSignInResult>(profile, `/api/google-workspace/sign-in/${encodeURIComponent(flowId)}`)

export const cancelGoogleSignIn = (profile: ProfileScope | undefined, flowId: string) =>
  call<{ ok: boolean }>(profile, `/api/google-workspace/sign-in/${encodeURIComponent(flowId)}`, 'DELETE')

export const signOutGoogleWorkspace = (profile?: ProfileScope) =>
  call<GoogleWorkspaceStatus>(profile, '/api/google-workspace', 'DELETE')
