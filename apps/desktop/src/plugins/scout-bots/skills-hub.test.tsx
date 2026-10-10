/**
 * Skills found through the hub search install into the bot they were searched for: an existing bot
 * routes through its owner connection, never the active gateway.
 */

import type * as ScoutSdk from '@scout/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  notifyError: vi.fn(),
  request: vi.fn(async (_method: string, params: Record<string, unknown>) =>
    params.action === 'search' ? { results: [{ description: 'Research the web', name: 'web-research' }] } : {}
  ),
  requestProfile: vi.fn(async (_route: unknown, _method: string, _params: Record<string, unknown>) => ({}))
}))

vi.mock('@scout/plugin-sdk', async importOriginal => {
  const original = await importOriginal<typeof ScoutSdk>()

  return {
    ...original,
    usePluginI18n: () => translateBots,
    host: {
      ...original.host,
      notify: mocks.notify,
      notifyError: mocks.notifyError,
      request: mocks.request,
      requestProfile: mocks.requestProfile
    }
  }
})

const { HubSkillsSection } = await import('./skills-hub')

async function searchAndInstall(name: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: name } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`install "${name}"`, 'i') }))
}

function installCalls() {
  return mocks.request.mock.calls.filter(([, params]) => params.action === 'install')
}

function routedInstallCalls() {
  return mocks.requestProfile.mock.calls.filter(([, , params]) => params.action === 'install')
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('hub skill install', () => {
  it('installs on the active gateway when no bot exists yet', async () => {
    render(<HubSkillsSection />)
    await searchAndInstall('web-research')

    await waitFor(() => expect(installCalls()).toHaveLength(1))
    expect(installCalls()).toEqual([['skills.manage', { action: 'install', query: 'web-research' }]])
    expect(routedInstallCalls()).toEqual([])
  })

  it('routes an existing source-scoped bot install through its owner connection', async () => {
    render(
      <HubSkillsSection
        bot={{
          name: 'worker',
          remoteSource: true,
          route: {
            connectionId: 'remote-a',
            mode: 'remote',
            profile: 'worker',
            targetProfile: 'backend-worker'
          },
          sourceScoped: true
        }}
      />
    )
    await searchAndInstall('web-research')

    await waitFor(() => expect(routedInstallCalls()).toHaveLength(1))
    expect(routedInstallCalls()).toEqual([
      [
        expect.objectContaining({
          connectionId: 'remote-a',
          mode: 'remote',
          profile: 'worker',
          targetProfile: 'backend-worker'
        }),
        'skills.manage',
        { action: 'install', profile: 'backend-worker', query: 'web-research' }
      ]
    ])
    expect(installCalls()).toEqual([])
  })
})
