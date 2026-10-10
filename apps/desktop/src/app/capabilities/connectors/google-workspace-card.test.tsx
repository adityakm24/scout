import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GoogleWorkspaceStatus } from '@/api/google-workspace'

import { GoogleWorkspaceCard } from './google-workspace-card'

const SERVICES = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'contacts'] as const

const status = (signedIn: boolean, configured = true): GoogleWorkspaceStatus => ({
  account: signedIn ? 'me@gmail.com' : null,
  client_configured: configured,
  services: SERVICES.map(id => ({ granted: signedIn, id })),
  signed_in: signedIn
})

const original = window.scoutDesktop

afterEach(() => {
  cleanup()
  window.scoutDesktop = original
})

/** A backend whose sign-in completes once the desktop relays the browser's reply. */
function desktop({ configured = true } = {}) {
  let signedIn = false
  const calls: string[] = []

  const api = async ({ method = 'GET', path }: { method?: string; path: string }) => {
    calls.push(`${method} ${path}`)

    if (path === '/api/google-workspace') {
      return status(signedIn, configured)
    }

    if (path === '/api/google-workspace/sign-in') {
      return { auth_url: 'https://accounts.google.com/o/oauth2/auth', flow_id: 'f1' }
    }

    signedIn = path.endsWith('/callback')

    return { error: null, status: 'done' }
  }

  const openExternal = vi.fn(async () => {})

  window.scoutDesktop = {
    ...original,
    api,
    mcpOauth: {
      cancel: async () => true,
      listen: async () => ({ id: 'l1', redirectUri: 'http://127.0.0.1:5555/callback' }),
      wait: async () => ({ code: '4/code', error: null, iss: null, state: 's' })
    },
    openExternal
  } as unknown as typeof window.scoutDesktop

  return { calls, openExternal }
}

async function connectWhenReady() {
  const connect = await screen.findByRole('button', { name: 'Connect' })
  await waitFor(() => expect(connect.hasAttribute('disabled')).toBe(false))
  fireEvent.click(connect)
}

describe('Google Workspace card', () => {
  it('connects through the browser and turns connected without a copied URL', async () => {
    const { calls, openExternal } = desktop()

    render(<GoogleWorkspaceCard profile="default" />)
    await connectWhenReady()

    expect(await screen.findByText('Connected as me@gmail.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    // The desktop's own listener caught the redirect and relayed it to the backend.
    expect(calls).toContain('POST /api/google-workspace/sign-in/f1/callback')
    expect(openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth')
  })

  it('asks for a Google client before it can connect', async () => {
    const { openExternal } = desktop({ configured: false })

    render(<GoogleWorkspaceCard profile="default" />)
    await connectWhenReady()

    expect(await screen.findByRole('dialog', { name: 'Connect your Google OAuth client' })).toBeTruthy()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
