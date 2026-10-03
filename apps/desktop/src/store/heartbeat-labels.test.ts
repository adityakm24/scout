import { describe, expect, it } from 'vitest'

import { headline, scheduleLabel } from './heartbeat'

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
})
