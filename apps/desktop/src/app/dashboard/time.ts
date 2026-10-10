// Pure time helpers for the Dashboard. Reminder times go to the backend as cron
// schedule strings (`cron/jobs.py::parse_schedule`): one-shots as an ISO
// timestamp WITH this machine's UTC offset — the backend may run elsewhere, in
// another timezone, and a bare local time would fire at its wall clock — and
// repeats as the natural forms it parses ("every day at 09:00").

export type ReminderPreset = 'in15m' | 'in1h' | 'evening' | 'tomorrow'
export type ReminderRepeat = 'never' | 'daily' | 'weekdays' | 'weekly'

export const REMINDER_PRESETS: readonly ReminderPreset[] = ['in15m', 'in1h', 'evening', 'tomorrow']
export const REMINDER_REPEATS: readonly ReminderRepeat[] = ['never', 'daily', 'weekdays', 'weekly']

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-10-01T09:00:00+05:30` — the local wall time with its offset. */
export function isoWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** Relative presets stay relative ("in 15m") so they are exact no matter the clock skew. */
export function isRelativePreset(preset: ReminderPreset): boolean {
  return preset === 'in15m' || preset === 'in1h'
}

/** The wall-clock moment a preset lands on. "This evening" rolls to tomorrow once it's past 17:30. */
export function presetDate(preset: ReminderPreset, now: Date): Date {
  const at = new Date(now)
  at.setSeconds(0, 0)

  if (preset === 'in15m') {
    return new Date(at.getTime() + 15 * 60_000)
  }

  if (preset === 'in1h') {
    return new Date(at.getTime() + 60 * 60_000)
  }

  if (preset === 'evening') {
    const pastEvening = now.getHours() * 60 + now.getMinutes() >= 17 * 60 + 30
    at.setDate(at.getDate() + (pastEvening ? 1 : 0))
    at.setHours(18, 0)

    return at
  }

  at.setDate(at.getDate() + 1)
  at.setHours(9, 0)

  return at
}

/** The schedule string for a moment + repeat choice. */
export function scheduleFor(at: Date, repeat: ReminderRepeat): string {
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`

  if (repeat === 'daily') {
    return `every day at ${clock}`
  }

  if (repeat === 'weekdays') {
    return `weekdays at ${clock}`
  }

  if (repeat === 'weekly') {
    return `every ${WEEKDAYS[at.getDay()]} at ${clock}`
  }

  return isoWithOffset(at)
}

export function presetSchedule(preset: ReminderPreset, repeat: ReminderRepeat, now: Date): string {
  if (isRelativePreset(preset) && repeat === 'never') {
    return preset === 'in15m' ? 'in 15m' : 'in 1h'
  }

  return scheduleFor(presetDate(preset, now), repeat)
}

/** `<input type="datetime-local">` value (`2026-10-01T09:30`) → Date, or null when blank/invalid. */
export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)

  if (!match) {
    return null
  }

  const [, y, mo, d, h, mi] = match.map(Number)

  return new Date(y, mo - 1, d, h, mi)
}

/** `datetime-local` value for a Date (the picker's default: the next whole hour). */
export function toLocalDateTimeValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function nextWholeHour(now: Date): Date {
  const at = new Date(now)
  at.setHours(at.getHours() + 1, 0, 0, 0)

  return at
}

export type DueKind = 'overdue' | 'today' | 'tomorrow' | 'later'

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** Classify a to-do's due value (`2026-10-01` or an ISO datetime) against today. */
export function dueKind(due: string, now: Date): DueKind {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due)
  const at = dateOnly ? parseLocalDateTime(`${due}T00:00`) : new Date(due)

  if (!at || Number.isNaN(at.getTime())) {
    return 'later'
  }

  const dayDiff = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)

  if (dayDiff < 0 || (!dateOnly && at.getTime() < now.getTime())) {
    return 'overdue'
  }

  if (dayDiff === 0) {
    return 'today'
  }

  return dayDiff === 1 ? 'tomorrow' : 'later'
}

/** Date-only `YYYY-MM-DD` for `<input type="date">`, from any stored due value. */
export function dueInputValue(due: string | null | undefined): string {
  return due ? due.slice(0, 10) : ''
}
