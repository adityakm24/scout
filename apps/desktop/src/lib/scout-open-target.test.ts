import { describe, expect, it } from 'vitest'

import {
  normalizeScoutOpenString,
  pathFromOpenDeepLink,
  pathFromScoutDeepLink,
  resolveScoutOpenPath
} from './scout-open-target'

describe('normalizeScoutOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeScoutOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeScoutOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped scout:// deep links to the same path', () => {
    expect(normalizeScoutOpenString('scout://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeScoutOpenString('scout://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps scout://open/… deep links by stripping the open host', () => {
    expect(normalizeScoutOpenString('scout://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeScoutOpenString('scout://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved scout kinds and unsafe paths', () => {
    expect(normalizeScoutOpenString('scout://blueprint/morning-brief')).toBeNull()
    expect(normalizeScoutOpenString('scout://plugin/install')).toBeNull()
    expect(normalizeScoutOpenString('https://example.com/x')).toBeNull()
    expect(normalizeScoutOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeScoutOpenString('index-network')).toBeNull()
  })
})

describe('resolveScoutOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveScoutOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveScoutOpenPath({ href: 'scout://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromScoutDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromScoutDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from scout://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromScoutDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromScoutDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromScoutDeepLink('plugin', 'install')).toBeNull()
    expect(pathFromScoutDeepLink('skill', 'install')).toBeNull()
  })
})
