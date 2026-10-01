import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectorRowCard } from './connector-row-card'
import type { ConnectorCardModel, ConnectorState } from './types'

afterEach(cleanup)

const card = (state: ConnectorState): ConnectorCardModel =>
  ({
    inCatalog: true,
    name: 'Gmail',
    residency: 'local',
    slug: 'gmail',
    state,
    stateWord: state === 'connected' ? 'serverOn' : 'serverError',
    ways: { hosted: null, local: { installed: true, serverEnabled: true } }
  }) as unknown as ConnectorCardModel

describe('connector card reload', () => {
  it('offers a reload while the server is in trouble', () => {
    const onReload = vi.fn()
    render(<ConnectorRowCard card={card('broken')} onOpen={() => {}} onReload={onReload} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reload Gmail' }))

    expect(onReload).toHaveBeenCalledOnce()
  })

  it('keeps a healthy card free of it', () => {
    render(<ConnectorRowCard card={card('connected')} onOpen={() => {}} onReload={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Reload Gmail' })).toBeNull()
  })
})
