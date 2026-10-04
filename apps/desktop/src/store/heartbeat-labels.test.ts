import { describe, expect, it } from 'vitest'

import { en } from '@/i18n/en'

import { failureText, headline, scheduleLabel } from './heartbeat'

const every = (count: number, unit: string) => `Every ${count} ${unit}`

describe('heartbeat labels', () => {
  it('spells out interval shorthand and capitalises the rest', () => {
    expect(scheduleLabel('every 30m', every)).toBe('Every 30 minute')
    expect(scheduleLabel('every 2h', every)).toBe('Every 2 hour')
    expect(scheduleLabel('every day at 3pm', every)).toBe('Every day at 3pm')
  })

  it('drops a leading emoji from a finding headline', () => {
    expect(headline('⏰ Reminder: Stand up and stretch')).toBe('Reminder: Stand up and stretch')
    expect(headline('**3 new emails**\n- Rahul')).toBe('3 new emails')
  })

  it('turns a failed run into what to fix, never the scheduler marker', () => {
    const copy = en.agentPanel.heartbeat
    const google =
      "[blocked_config:silent] attached skill 'google-workspace' is not ready: missing credential file " +
      'google_token.json. Provide the missing prerequisites or detach the skill from this job.'

    expect(failureText(google, copy)).toBe(copy.emailCheckNeedsGoogle)
    expect(failureText("[blocked_config] attached skill 'apple-notes' is not ready: x", copy)).toContain('Apple Notes')
    expect(failureText('[blocked_config:silent] delivery target slack is not connected', copy)).toBe(
      'Delivery target slack is not connected'
    )
  })
})
