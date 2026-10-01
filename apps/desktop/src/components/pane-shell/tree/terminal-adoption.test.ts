import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A layout that lost the terminal's own slot (it was closed, or a preset
// without it was applied) re-adopts the pane when it is opened again. It must
// come back as its own zone under the chat, never as a tab stacked onto the
// sessions sidebar or the chat itself.

describe('re-adopting the terminal', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('docks it in its own zone below the chat', async () => {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')
    const { TERMINAL_DOCK } = await import('@/app/contrib/layout-presets')

    registry.registerMany([
      { id: 'sessions', area: 'panes', data: { placement: 'left' }, render: () => null },
      { id: 'dashboard', area: 'panes', data: { placement: 'left' }, render: () => null },
      { id: 'workspace', area: 'panes', data: { placement: 'main' }, render: () => null }
    ])
    tree.declareDefaultTree(
      model.split('row', [
        model.group(['sessions', 'dashboard'], { id: 'grp-sessions' }),
        model.group(['workspace'], { id: 'grp-main' })
      ])
    )

    registry.register({
      id: 'terminal',
      area: 'panes',
      data: { placement: 'bottom', dock: TERMINAL_DOCK },
      render: () => null
    })
    tree.watchContributedPanes()

    const layout = tree.$layoutTree.get()!

    expect(model.findGroupOfPane(layout, 'terminal')?.panes).toEqual(['terminal'])
    expect(model.findGroupOfPane(layout, 'sessions')?.panes).not.toContain('terminal')
    expect(model.findGroupOfPane(layout, 'workspace')?.panes).not.toContain('terminal')
  })

  // Boot: the app declares its default layout over the user's saved one. The default gives the
  // terminal a zone of its own, so it has no sibling to follow into the saved tree.
  async function bootWithSavedLayoutWithoutTerminal(dismissed: string[], sidebar = ['sessions', 'dashboard']) {
    window.localStorage.setItem(
      'scout.desktop.layoutTree.v2',
      JSON.stringify({
        type: 'split',
        id: 'spl-root',
        orientation: 'row',
        weights: [1, 3],
        children: [
          { type: 'group', id: 'grp-sessions', panes: sidebar, active: 'sessions' },
          { type: 'group', id: 'grp-main', panes: ['workspace'], active: 'workspace' }
        ]
      })
    )
    window.localStorage.setItem('scout.desktop.dismissedPanes.v1', JSON.stringify(dismissed))

    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')
    const { TERMINAL_DOCK } = await import('@/app/contrib/layout-presets')

    registry.registerMany([
      { id: 'sessions', area: 'panes', data: { placement: 'left' }, render: () => null },
      { id: 'dashboard', area: 'panes', data: { placement: 'left' }, render: () => null },
      { id: 'workspace', area: 'panes', data: { placement: 'main' }, render: () => null },
      { id: 'terminal', area: 'panes', data: { placement: 'bottom', dock: TERMINAL_DOCK }, render: () => null }
    ])
    tree.declareDefaultTree(
      model.split('row', [
        model.group(['sessions']),
        model.split('column', [model.group(['workspace']), model.group(['terminal'])])
      ])
    )
    tree.watchContributedPanes()

    return { layout: tree.$layoutTree.get()!, model }
  }

  it('keeps a closed terminal closed across a boot', async () => {
    const { layout, model } = await bootWithSavedLayoutWithoutTerminal(['terminal'])

    expect(model.allPaneIds(layout)).not.toContain('terminal')
  })

  it('brings a missing terminal back below the chat on boot, not into the sidebar', async () => {
    const { layout, model } = await bootWithSavedLayoutWithoutTerminal([])

    expect(model.findGroupOfPane(layout, 'terminal')?.panes).toEqual(['terminal'])
    expect(model.findGroupOfPane(layout, 'sessions')?.panes).not.toContain('terminal')
  })

  it('takes a closed terminal back out of a sidebar the old boot stacked it into', async () => {
    const { layout, model } = await bootWithSavedLayoutWithoutTerminal(
      ['terminal'],
      ['sessions', 'dashboard', 'terminal']
    )

    expect(model.allPaneIds(layout)).not.toContain('terminal')
    expect(model.findGroupOfPane(layout, 'sessions')?.panes).toEqual(['sessions', 'dashboard'])
  })
})
