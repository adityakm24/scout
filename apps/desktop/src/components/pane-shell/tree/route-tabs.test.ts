import { afterEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'

import { findGroup, group, split } from './model'
import { $layoutTree, syncRouteTabs } from './store'

const disposers: (() => void)[] = []

function registerPane(id: string, data: Record<string, unknown>) {
  disposers.push(registry.register({ area: 'panes', data, id, render: () => null, title: id }))
}

const activeSideTab = () => findGroup($layoutTree.get()!, 'g-side')?.active

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
})

/** SESSIONS | BOTS | DASHBOARD, where the Dashboard tab mirrors `/dashboard`. */
function dashboardTree(onActivate = vi.fn(), onDeactivate = vi.fn()) {
  registerPane('sessions', { placement: 'left', hideOnly: true })
  registerPane('bots', { placement: 'left', hideOnly: true })
  registerPane('dashboard', {
    dock: { pane: 'sessions', pos: 'center' },
    hideOnly: true,
    onActivate,
    onDeactivate,
    placement: 'left',
    route: '/dashboard'
  })
  registerPane('workspace', { placement: 'main', uncloseable: true })
  $layoutTree.set(
    split('row', [
      group(['sessions', 'bots', 'dashboard'], { active: 'sessions', id: 'g-side' }),
      group(['workspace'], { active: 'workspace', id: 'g-main' })
    ])
  )

  return { onActivate, onDeactivate }
}

describe('route-mirroring tabs', () => {
  it('fronts the tab on its route and hands it back to its dock pane on leaving, without running tab hooks', () => {
    const { onActivate, onDeactivate } = dashboardTree()

    syncRouteTabs('/dashboard')
    expect(activeSideTab()).toBe('dashboard')

    syncRouteTabs('/capabilities')
    expect(activeSideTab()).toBe('sessions')

    expect(onActivate).not.toHaveBeenCalled()
    expect(onDeactivate).not.toHaveBeenCalled()
  })

  it('leaves a tab the user chose alone while the route is elsewhere', () => {
    dashboardTree()
    $layoutTree.set(
      split('row', [
        group(['sessions', 'bots', 'dashboard'], { active: 'bots', id: 'g-side' }),
        group(['workspace'], { active: 'workspace', id: 'g-main' })
      ])
    )

    syncRouteTabs('/session/abc')

    expect(activeSideTab()).toBe('bots')
  })
})
