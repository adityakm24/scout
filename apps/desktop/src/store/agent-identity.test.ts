import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  describeAgent: vi.fn(),
  getAgentAvatar: vi.fn(),
  saveAgentAvatar: vi.fn(),
  saveAgentName: vi.fn()
}))

vi.mock('@/api/agent-identity', () => api)

import { $agentIdentity, ensureAgentIdentity, refreshAgentIdentity, renameAgent } from './agent-identity'
import { $activeGatewayProfile } from './profile'

describe('agent identity cache', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    $activeGatewayProfile.set('default')
    $agentIdentity.set({ avatar: null, loaded: false, name: '', profile: '' })
  })

  it('never caches a failed read as "no name, no photo"', async () => {
    api.describeAgent.mockRejectedValue(new Error('gateway connecting'))
    api.getAgentAvatar.mockRejectedValue(new Error('gateway connecting'))
    await refreshAgentIdentity('default')

    expect($agentIdentity.get().loaded).toBe(false)

    api.describeAgent.mockResolvedValue({ name: 'Charlie', soul: '' })
    api.getAgentAvatar.mockResolvedValue('data:image/png;base64,AA')
    ensureAgentIdentity()
    await vi.waitFor(() => expect($agentIdentity.get().loaded).toBe(true))

    expect($agentIdentity.get()).toMatchObject({ avatar: 'data:image/png;base64,AA', name: 'Charlie' })
  })

  it('keeps the photo it already showed when only the photo read fails', async () => {
    $agentIdentity.set({ avatar: 'data:image/png;base64,AA', loaded: true, name: 'Charlie', profile: 'default' })
    api.describeAgent.mockResolvedValue({ name: 'Charlie', soul: '' })
    api.getAgentAvatar.mockRejectedValue(new Error('transient'))

    await refreshAgentIdentity('default')

    expect($agentIdentity.get().avatar).toBe('data:image/png;base64,AA')
  })

  it('rolls a rename back when the backend refuses it', async () => {
    $agentIdentity.set({ avatar: null, loaded: true, name: 'Charlie', profile: 'default' })
    api.saveAgentName.mockRejectedValue(new Error('refused'))

    await expect(renameAgent('Juniper')).rejects.toThrow('refused')

    expect($agentIdentity.get().name).toBe('Charlie')
  })
})
