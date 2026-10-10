import { describe, expect, it } from 'vitest'

import {
  dueKind,
  isoWithOffset,
  presetDate,
  presetSchedule,
  REMINDER_PRESETS,
  REMINDER_REPEATS,
  scheduleFor
} from './time'

// The forms `cron/jobs.py::parse_schedule` accepts — every string the Dashboard
// sends must be one of them, or the backend rejects the reminder.
const BACKEND_FORMS = [
  /^in \d+[mh]$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/,
  /^every day at \d{2}:\d{2}$/,
  /^weekdays at \d{2}:\d{2}$/,
  /^every (sunday|monday|tuesday|wednesday|thursday|friday|saturday) at \d{2}:\d{2}$/
]

describe('reminder schedules', () => {
  const now = new Date(2026, 8, 30, 14, 7)

  it('only ever produces a schedule form the backend parses', () => {
    for (const preset of REMINDER_PRESETS) {
      for (const repeat of REMINDER_REPEATS) {
        const schedule = presetSchedule(preset, repeat, now)
        expect(BACKEND_FORMS.some(form => form.test(schedule)), schedule).toBe(true)
      }
    }
  })

  it('pins a one-shot to the same instant, whatever timezone the backend runs in', () => {
    const at = presetDate('tomorrow', now)
    expect(new Date(isoWithOffset(at)).getTime()).toBe(at.getTime())
    expect(new Date(scheduleFor(at, 'never')).getTime()).toBe(at.getTime())
  })

  it('never schedules a preset in the past', () => {
    for (const hour of [0, 9, 17, 18, 23]) {
      const clock = new Date(2026, 8, 30, hour, 45)

      for (const preset of REMINDER_PRESETS) {
        expect(presetDate(preset, clock).getTime()).toBeGreaterThan(clock.getTime())
      }
    }
  })
})

describe('due dates', () => {
  const now = new Date(2026, 8, 30, 14, 0)

  it('orders the calendar: yesterday overdue, then today, tomorrow, later', () => {
    expect(dueKind('2026-09-29', now)).toBe('overdue')
    expect(dueKind('2026-09-30', now)).toBe('today')
    expect(dueKind('2026-10-01', now)).toBe('tomorrow')
    expect(dueKind('2026-10-05', now)).toBe('later')
  })

  it('treats a timed due that already passed today as overdue', () => {
    expect(dueKind(isoWithOffset(new Date(2026, 8, 30, 9, 0)), now)).toBe('overdue')
    expect(dueKind(isoWithOffset(new Date(2026, 8, 30, 20, 0)), now)).toBe('today')
  })
})
