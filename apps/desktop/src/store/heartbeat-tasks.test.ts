import { describe, expect, it } from 'vitest'

import type { CronJob } from '@/types/scout'

import { isFinishedTask } from './heartbeat'

const NOW = Date.parse('2026-10-04T18:10:00+05:30')

const job = (over: Partial<CronJob>): CronJob => ({
  enabled: false,
  id: 'j',
  last_run_at: '2026-10-04T18:06:46+05:30',
  prompt: 'Place the approved Zepto order',
  schedule: { kind: 'once' } as CronJob['schedule'],
  ...over
})

describe('finished one-shot tasks', () => {
  // A scheduled order (or any "do this later") ran: the user hears the outcome even though
  // one-shots are not Heartbeat rows.
  it('counts a recent one-shot agent task, and nothing else', () => {
    expect(isFinishedTask(job({}), NOW)).toBe(true)
    expect(isFinishedTask(job({ last_run_at: null }), NOW)).toBe(false)
    expect(isFinishedTask(job({ prompt: null }), NOW)).toBe(false) // a reminder: announced elsewhere
    expect(isFinishedTask(job({ schedule: { kind: 'interval' } as CronJob['schedule'] }), NOW)).toBe(false)
    expect(isFinishedTask(job({ last_run_at: '2026-10-01T09:00:00+05:30' }), NOW)).toBe(false)
  })
})
