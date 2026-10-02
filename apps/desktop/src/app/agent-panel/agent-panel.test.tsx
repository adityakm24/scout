import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./open', () => ({ closeAgentPanel: vi.fn() }))
vi.mock('./persona-tab', () => ({ PersonaTab: () => null }))
vi.mock('./identity-card', () => ({ IdentityCard: () => null }))

import { MemoryRouter } from 'react-router'

import { closeAgentPanel } from './open'

import { AgentPanel } from '.'

afterEach(cleanup)

describe('agent panel', () => {
  it('can be closed from the panel itself, and its tabs share the width', () => {
    render(
      <MemoryRouter>
        <AgentPanel />
      </MemoryRouter>
    )

    screen.getByRole('button', { name: 'Close panel' }).click()
    expect(closeAgentPanel).toHaveBeenCalledOnce()

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('flex-1')
    }
  })
})
