import { describe, expect, it } from 'vitest'

import { isMessagingSource, sessionSourceSearchTerms } from './session-source'

// Gateway surfaces (webhooks, the HTTP API, Home Assistant) get their own sidebar section;
// refreshMessagingSessions() filters rows through isMessagingSource().
describe('gateway surface source registration', () => {
  it('treats gateway surfaces as their own section', () => {
    expect(isMessagingSource('webhook')).toBe(true)
    expect(isMessagingSource('api_server')).toBe(true)
    expect(isMessagingSource('homeassistant')).toBe(true)
  })

  it('is case/space insensitive on the source id', () => {
    expect(isMessagingSource('WEBHOOK')).toBe(true)
    expect(isMessagingSource('  webhook ')).toBe(true)
  })

  it('exposes labels as search terms', () => {
    expect(sessionSourceSearchTerms('homeassistant')).toContain('Home Assistant')
  })

  it('does not flag local/CLI-ish sources (guard sanity)', () => {
    expect(isMessagingSource('cli')).toBe(false)
    expect(isMessagingSource('desktop')).toBe(false)
    expect(isMessagingSource(null)).toBe(false)
    expect(isMessagingSource(undefined)).toBe(false)
  })
})
