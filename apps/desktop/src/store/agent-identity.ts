import { atom } from 'nanostores'

import { describeAgent, getAgentAvatar, saveAgentAvatar, saveAgentName } from '@/api/agent-identity'

import { $activeGatewayProfile, refreshProfiles } from './profile'

/** The active profile's agent as the chat header and agent panel show it. The backend
 *  (`profile.yaml` + the profile's avatar asset) is the authority; this is its cache. */
export interface AgentIdentity {
  avatar: null | string
  loaded: boolean
  name: string
  profile: string
}

/** What the agent is called until the user names it. */
export const DEFAULT_AGENT_NAME = 'Scout'

export const $agentIdentity = atom<AgentIdentity>({ avatar: null, loaded: false, name: '', profile: '' })

export const agentDisplayName = (identity: Pick<AgentIdentity, 'name'>) => identity.name.trim() || DEFAULT_AGENT_NAME

// A profile switch while a read is in flight must not let the old profile's answer land.
let generation = 0

export async function refreshAgentIdentity(profile = $activeGatewayProfile.get()): Promise<void> {
  const mine = ++generation

  // `undefined` = the read failed (gateway still connecting): keep what we had and stay
  // unloaded so the next ensure retries, instead of caching "no name, no photo".
  const [snapshot, avatar] = await Promise.all([
    describeAgent(profile).catch(() => undefined),
    getAgentAvatar(profile).catch(() => undefined)
  ])

  if (mine !== generation || snapshot === undefined) {
    return
  }

  const previous = $agentIdentity.get()
  const keptAvatar = previous.profile === profile ? previous.avatar : null

  $agentIdentity.set({ avatar: avatar === undefined ? keptAvatar : avatar, loaded: true, name: snapshot.name, profile })
}

/** Load the identity for the active profile unless it is already cached. */
export function ensureAgentIdentity(): void {
  const profile = $activeGatewayProfile.get()
  const current = $agentIdentity.get()

  if (!current.loaded || current.profile !== profile) {
    void refreshAgentIdentity(profile)
  }
}

async function optimistic(patch: Partial<AgentIdentity>, write: (profile: string) => Promise<void>): Promise<void> {
  const before = $agentIdentity.get()
  generation += 1 // a read already in flight predates this write
  $agentIdentity.set({ ...before, ...patch })

  try {
    await write(before.profile || $activeGatewayProfile.get())
  } catch (error) {
    $agentIdentity.set(before)

    throw error
  }
}

export async function renameAgent(name: string): Promise<void> {
  await optimistic({ name: name.trim() }, profile => saveAgentName(profile, name))
  // The profile rail and pickers label profiles by display_name.
  void refreshProfiles().catch(() => undefined)
}

export const changeAgentAvatar = (dataUrl: null | string) =>
  optimistic({ avatar: dataUrl }, profile => saveAgentAvatar(profile, dataUrl))
