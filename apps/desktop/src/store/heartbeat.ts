import { atom } from 'nanostores'

import { translateNow } from '@/i18n'
import type { Translations } from '@/i18n/types'
import { displayName } from '@/lib/text'
import {
  type CronJob,
  getCronJobLatest,
  getCronJobs,
  instantiateAutomationBlueprint,
  pauseCronJob,
  resumeCronJob,
  updateCronJob
} from '@/scout'

import { $cronChangeTick } from './live-sync'
import { dispatchNativeNotification } from './native-notifications'
import { $activeGatewayProfile, normalizeProfileKey } from './profile'
import { $gatewayState } from './session'

/** One recurring job the agent runs for the user, with its newest run that said something. */
export interface HeartbeatItem {
  job: CronJob
  latest: { at: null | number; text: null | string }
}

export interface HeartbeatState {
  items: HeartbeatItem[]
  loaded: boolean
  profile: string
}

export const $heartbeat = atom<HeartbeatState>({ items: [], loaded: false, profile: '' })

/** The "New email check" template (cron/blueprint_catalog.py). */
export const EMAIL_CHECK_BLUEPRINT = 'important-mail'

// Scheduler ticks announce themselves (cron.changed); this only covers a backend
// that can't push change events.
const FALLBACK_POLL_MS = 5 * 60_000

const seenKey = (profile: string) => `scout.heartbeat.seen.${profile}`

function readSeen(profile: string): null | Record<string, number> {
  try {
    const raw = window.localStorage.getItem(seenKey(profile))

    return raw ? (JSON.parse(raw) as Record<string, number>) : null
  } catch {
    return null
  }
}

function writeSeen(profile: string, seen: Record<string, number>) {
  try {
    window.localStorage.setItem(seenKey(profile), JSON.stringify(seen))
  } catch {
    // Unavailable storage only means the next launch re-reads without notifying.
  }
}

/** Recurring jobs only: a one-shot reminder isn't something to switch on and off. */
const isRecurring = (job: CronJob) => job.schedule?.kind !== 'once'

const DAY_MS = 86_400_000

/** A task the user asked for once, for later ("order it at 6:06"), that has run: not a Heartbeat
 *  row, but its result is news. Reminders (no prompt) announce themselves elsewhere. */
export const isFinishedTask = (job: CronJob, now = Date.now()) =>
  !isRecurring(job) &&
  Boolean(job.prompt) &&
  !job.no_agent &&
  Boolean(job.last_run_at) &&
  now - Date.parse(job.last_run_at ?? '') < DAY_MS

/** Tell the user about results newer than the last ones they were told about. The first
 *  read on this machine only records what exists, so opening the app never replays history. */
function announce(profile: string, items: HeartbeatItem[]) {
  const seen = readSeen(profile)
  const next: Record<string, number> = { ...seen }

  for (const { job, latest } of items) {
    if (latest.at == null) {
      continue
    }

    // A finished one-shot task is switched off by then; its result still counts.
    if (seen && (job.enabled || !isRecurring(job)) && latest.at > (seen[job.id] ?? 0) && latest.text) {
      dispatchNativeNotification({
        kind: 'heartbeat',
        title: job.name || translateNow('agentPanel.heartbeat.untitled'),
        body: headline(latest.text),
        global: true,
        tag: `heartbeat:${job.id}`
      })
    }

    next[job.id] = Math.max(latest.at, next[job.id] ?? 0)
  }

  writeSeen(profile, next)
}

let generation = 0

export async function refreshHeartbeat(): Promise<void> {
  const profile = normalizeProfileKey($activeGatewayProfile.get())
  const mine = ++generation
  const all = await getCronJobs(profile)

  const withLatest = (jobs: CronJob[]) =>
    Promise.all(
      jobs.map(async job => ({
        job,
        latest: await getCronJobLatest(job.id, profile).catch(() => ({ at: null, text: null }))
      }))
    )

  const [items, tasks] = await Promise.all([
    withLatest(all.filter(isRecurring)),
    withLatest(all.filter(job => isFinishedTask(job)))
  ])

  // A profile switch or a newer refresh overtook this one.
  if (mine !== generation) {
    return
  }

  announce(profile, [...items, ...tasks])
  $heartbeat.set({ items, loaded: true, profile })
}

const refreshQuietly = () => void refreshHeartbeat().catch(() => undefined)

/** Switch a job on or off. The list updates at once and rolls back if the backend refuses. */
export async function setHeartbeatEnabled(jobId: string, enabled: boolean): Promise<void> {
  const before = $heartbeat.get()
  $heartbeat.set({
    ...before,
    items: before.items.map(item => (item.job.id === jobId ? { ...item, job: { ...item.job, enabled } } : item))
  })

  try {
    await (enabled ? resumeCronJob(jobId) : pauseCronJob(jobId))
  } catch (error) {
    $heartbeat.set(before)

    throw error
  } finally {
    refreshQuietly()
  }
}

/** Replace a job's standing rules; optimistic, rolled back if the backend refuses. */
export async function setHeartbeatRules(jobId: string, rules: string[]): Promise<void> {
  const before = $heartbeat.get()
  $heartbeat.set({
    ...before,
    items: before.items.map(item => (item.job.id === jobId ? { ...item, job: { ...item.job, rules } } : item))
  })

  try {
    await updateCronJob(jobId, { rules })
  } catch (error) {
    $heartbeat.set(before)

    throw error
  }
}

/** The first line of a finding, without markdown: what a row and a notification show. */
export function headline(text: string): string {
  const first = text.split('\n').find(line => line.trim()) ?? ''

  // A leading emoji ("⏰ Reminder: …") doubles the row's own icon and crowds the text.
  return plain(first).replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '')
}

/** Markdown decoration stripped, for text shown outside a rendered message. */
export function plain(text: string): string {
  return text
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/[*_`~]+/g, '')
    .replace(/^#+\s*/, '')
    .trim()
}

const SKILL_NOT_READY = /attached skill '([^']+)' is not ready/

/** A failed run's error as the user should read it: what to fix, never the scheduler's
 *  status marker ("[blocked_config:silent]") or its developer instructions. */
export function failureText(error: string, copy: Translations['agentPanel']['heartbeat']): string {
  const skill = SKILL_NOT_READY.exec(error)?.[1]

  if (skill) {
    return skill.startsWith('google') ? copy.emailCheckNeedsGoogle : copy.failedSkill(displayName(skill))
  }

  const text = error
    .replace(/^(?:\s*\[[a-z_:]+\])+\s*/i, '')
    .replace(/\s*Provide the missing prerequisites.*$/s, '')
    .trim()

  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Turn on the "New email check" (every 30 minutes, results shown here and as notifications). */
export async function addEmailCheck(): Promise<void> {
  const profile = normalizeProfileKey($activeGatewayProfile.get())
  await instantiateAutomationBlueprint(
    { blueprint: EMAIL_CHECK_BLUEPRINT, values: { deliver: 'local', interval_min: '30' } },
    profile
  )
  await refreshHeartbeat()
}

let started = false

/** Keep the Heartbeat list (and its notifications) current for the whole app session. */
export function startHeartbeatWatch() {
  if (started) {
    return
  }

  started = true
  $cronChangeTick.listen(refreshQuietly)
  $activeGatewayProfile.listen(() => {
    generation += 1
    $heartbeat.set({ items: [], loaded: false, profile: '' })
    refreshQuietly()
  })
  $gatewayState.subscribe(state => {
    if (state === 'open') {
      refreshQuietly()
    }
  })
  window.setInterval(refreshQuietly, FALLBACK_POLL_MS)
}

const UNITS = { d: 'day', h: 'hour', m: 'minute' } as const

/** The backend's schedule text ("every 30m", "every day at 3pm") as a sentence: interval
 *  shorthand spelled out, first letter capitalised. */
export function scheduleLabel(raw: string, every: Translations['agentPanel']['heartbeat']['every']): string {
  const interval = /^every\s+(\d+)\s*([mhd])$/i.exec(raw.trim())

  if (interval) {
    return every(Number(interval[1]), UNITS[interval[2].toLowerCase() as keyof typeof UNITS])
  }

  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
