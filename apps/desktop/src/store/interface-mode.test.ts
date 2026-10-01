/**
 * Interface mode is a resolver input, never a preference writer. These tests
 * pin the precedence contract — sessionReveal ?? policy[mode] ?? userPref —
 * and the promise that matters to an existing install: the default mode writes no
 * record and a round trip through Simple leaves every preference byte-identical.
 */

import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MODE_KEY = 'scout.desktop.interfaceMode.v1'

const loadStore = () => import('./interface-mode')

describe('interface mode persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('never writes a record for the default, so an untouched install stays untouched', async () => {
    const { $interfaceMode, DEFAULT_INTERFACE_MODE, INTERFACE_MODES, setInterfaceMode } = await loadStore()
    const other = INTERFACE_MODES.find(mode => mode !== DEFAULT_INTERFACE_MODE)!

    expect($interfaceMode.get()).toBe(DEFAULT_INTERFACE_MODE)
    setInterfaceMode(DEFAULT_INTERFACE_MODE)
    expect(window.localStorage.getItem(MODE_KEY)).toBeNull()

    setInterfaceMode(other)
    expect(window.localStorage.getItem(MODE_KEY)).not.toBeNull()

    setInterfaceMode(DEFAULT_INTERFACE_MODE)
    expect(window.localStorage.getItem(MODE_KEY)).toBeNull()
  })

  it('restores a chosen mode across a reload and treats anything unknown as the default', async () => {
    const { DEFAULT_INTERFACE_MODE, INTERFACE_MODES } = await loadStore()

    for (const mode of INTERFACE_MODES) {
      ;(await loadStore()).setInterfaceMode(mode)
      vi.resetModules()
      expect((await loadStore()).$interfaceMode.get()).toBe(mode)
    }

    window.localStorage.setItem(MODE_KEY, 'intermediate')
    vi.resetModules()
    expect((await loadStore()).$interfaceMode.get()).toBe(DEFAULT_INTERFACE_MODE)
  })
})

describe('modeBound resolver', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('falls through to the preference in Advanced, and writes reach the preference', async () => {
    const { modeBound, setInterfaceMode } = await loadStore()
    setInterfaceMode('advanced')
    const $pref = atom(true)
    const $bound = modeBound('statusbarVisible', $pref, value => $pref.set(value))

    expect($bound.get()).toBe(true)

    $bound.set(false)
    expect($pref.get()).toBe(false)
    expect($bound.get()).toBe(false)
  })

  it('shadows the preference in Simple without writing it, and lifts the shadow on the way back', async () => {
    const { modeBound, setInterfaceMode } = await loadStore()
    const $pref = atom(true)
    const $bound = modeBound('statusbarVisible', $pref, value => $pref.set(value))

    setInterfaceMode('simple')
    expect($bound.get()).toBe(false)
    expect($pref.get()).toBe(true)

    setInterfaceMode('advanced')
    expect($bound.get()).toBe(true)
  })

  it('routes a toggle made under a shadow to the session layer, cleared on the next mode change', async () => {
    const { modeBound, setInterfaceMode } = await loadStore()
    const $pref = atom(false)
    const $bound = modeBound('terminalOpen', $pref, value => $pref.set(value))

    setInterfaceMode('simple')
    $bound.set(true)
    expect($bound.get()).toBe(true)
    expect($pref.get()).toBe(false)

    setInterfaceMode('advanced')
    expect($bound.get()).toBe(false)

    setInterfaceMode('simple')
    expect($bound.get()).toBe(false)
  })

  it('drops a shadowed write made as layout intent: the mode decides what rests, the preference stays', async () => {
    const { asLayoutIntent, modeBound, setInterfaceMode } = await loadStore()
    const $pref = atom(false)
    const $bound = modeBound('terminalOpen', $pref, value => $pref.set(value))

    setInterfaceMode('simple')
    asLayoutIntent(() => $bound.set(true))
    expect($bound.get()).toBe(false)
    expect($pref.get()).toBe(false)

    setInterfaceMode('advanced')
    asLayoutIntent(() => $bound.set(true))
    expect($pref.get()).toBe(true)
  })

  it('leaves a surface Simple has no opinion on alone', async () => {
    const { modeBound, setInterfaceMode, $modeShadowed } = await loadStore()

    setInterfaceMode('simple')
    expect($modeShadowed('statusbarVisible').get()).toBe(true)

    setInterfaceMode('advanced')
    expect($modeShadowed('statusbarVisible').get()).toBe(false)

    const $pref = atom<'product' | 'technical'>('technical')
    const $bound = modeBound('toolViewMode', $pref, value => $pref.set(value))

    expect($bound.get()).toBe('technical')
  })

  it('keeps the profile rail available in Simple for multiple profiles or gateways', async () => {
    const { modeBound, setInterfaceMode, setModeContext } = await loadStore()
    const $pref = atom(true)
    const $bound = modeBound('profileRailVisible', $pref, value => $pref.set(value))

    setInterfaceMode('simple')
    expect($bound.get()).toBe(false)

    setModeContext({ profileCount: 2 })
    expect($bound.get()).toBe(true)

    setModeContext({ profileCount: 1 })
    expect($bound.get()).toBe(false)

    setModeContext({ connectionCount: 2 })
    expect($bound.get()).toBe(true)

    setModeContext({ connectionCount: 1 })
    expect($bound.get()).toBe(false)
  })
})

describe('tiers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('shows untagged items everywhere and a tiered item only in its mode', async () => {
    const { shownInMode, $showsAdvancedChrome, setInterfaceMode } = await loadStore()

    const items = [
      { id: 'settings' },
      { id: 'hud', tier: 'advanced' as const },
      { id: 'side', tier: 'simple' as const }
    ]

    expect(items.filter(shownInMode('advanced')).map(item => item.id)).toEqual(['settings', 'hud'])
    expect(items.filter(shownInMode('simple')).map(item => item.id)).toEqual(['settings', 'side'])

    setInterfaceMode('advanced')
    expect($showsAdvancedChrome.get()).toBe(true)
    setInterfaceMode('simple')
    expect($showsAdvancedChrome.get()).toBe(false)
  })
})
