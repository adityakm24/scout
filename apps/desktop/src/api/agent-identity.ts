import { profileScoped, scoutApi } from './client'

/** The agent of one profile as the agent panel edits it. The name lives in the profile's
 *  `profile.yaml` (`display_name`); the backend states it in new chats' system prompts and
 *  tells open chats about a rename on their next message. */
export interface AgentProfileSnapshot {
  name: string
  soul: string
}

export interface MemoryFile {
  entries: string[]
  limit: number
  updated_at: null | number
}

export interface MemoryFiles {
  memory: MemoryFile
  user: MemoryFile
}

export type MemoryTarget = keyof MemoryFiles

// Late import: store/gateway imports half the app, and the API layer must stay below it.
async function profileRpc<T>(profile: string, method: string, params: Record<string, unknown>): Promise<T> {
  const { requestGatewayForProfile } = await import('@/store/gateway')

  return requestGatewayForProfile<T>(profile, method, { name: profile, ...params }, undefined, undefined, {
    spawnPriority: 'foreground'
  })
}

export async function describeAgent(profile: string): Promise<AgentProfileSnapshot> {
  const res = await profileRpc<{ display_name?: string; soul?: string }>(profile, 'profiles.describe', {})

  return { name: res.display_name ?? '', soul: res.soul ?? '' }
}

export async function getAgentAvatar(profile: string): Promise<null | string> {
  const res = await profileRpc<{ data?: string; found?: boolean }>(profile, 'profiles.get_asset', { asset: 'avatar' })

  return res.found && res.data ? res.data : null
}

interface ConfigureResult {
  applied?: Record<string, boolean>
}

async function configure(profile: string, params: Record<string, unknown>, section: string): Promise<void> {
  const res = await profileRpc<ConfigureResult>(profile, 'profiles.configure', params)

  if (res.applied?.[section] !== true) {
    throw new Error(`The backend did not save the agent's ${section}`)
  }
}

export const saveAgentName = (profile: string, name: string) =>
  configure(profile, { display_name: name.trim() }, 'display_name')

export const saveAgentSoul = (profile: string, soul: string) => configure(profile, { soul }, 'soul')

/** `dataUrl` null removes the photo. */
export async function saveAgentAvatar(profile: string, dataUrl: null | string): Promise<void> {
  await profileRpc(
    profile,
    'profiles.set_asset',
    dataUrl ? { asset: 'avatar', data: dataUrl } : { asset: 'avatar', clear: true }
  )
}

export function getMemoryFiles(profile: string): Promise<MemoryFiles> {
  return scoutApi<MemoryFiles>({ ...profileScoped(profile), path: '/api/memory/files' })
}

export function saveMemoryFile(profile: string, target: MemoryTarget, entries: string[]): Promise<MemoryFile> {
  return scoutApi<MemoryFile>({
    ...profileScoped(profile),
    path: `/api/memory/files/${target}`,
    method: 'PUT',
    body: { entries }
  })
}
