import { describe, expect, it } from 'vitest'

import { listTime, previewLine } from './phone-shell'

describe('phone chats list', () => {
  it('dates a row like Messages: the time today, then yesterday, a weekday, a date', () => {
    const now = new Date(2026, 9, 4, 15, 0)
    const at = (days: number, hour: number) => new Date(2026, 9, 4 - days, hour).getTime() / 1000

    expect(listTime(at(0, 9), now)).toMatch(/9:00/)
    expect(listTime(at(1, 23), now)).toMatch(/^Yesterday$/i)
    expect(listTime(at(3, 9), now)).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2026, 9, 1)))
    expect(listTime(at(30, 9), now)).not.toMatch(/day$/)
  })

  it('shows the first message under the title only when the title is not just that message', () => {
    const ask = 'okay what did DBS say in the last email?'

    expect(previewLine({ preview: ask, title: 'okay what did DBS say in the last email? #4' })).toBe('')
    expect(previewLine({ preview: ask, title: 'okay what did DBS say…' })).toBe('')
    expect(previewLine({ preview: 'can you see my saved address', title: 'Check saved addresses' })).toBe(
      'can you see my saved address'
    )
  })
})
