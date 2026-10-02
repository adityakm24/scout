import { atom } from 'nanostores'

import { translateNow } from '@/i18n'
import {
  type CronJob,
  getCronJobLatest,
  getCronJobs,
  instantiateAutomationBlueprint,
  pauseCronJob,
  resumeCronJob
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

/** Tell the user about results newer than the last ones they were told about. The first
 *  read on this machine only records what exists, so opening the app never replays history. */
function announce(profile: string, items: HeartbeatItem[]) {
  const seen = readSeen(profile)
  const next: Record<string, number> = { ...seen }

  for (const { job, latest } of items) {
    if (latest.at == null) {
      continue
    }

    if (seen && job.enabled && latest.at > (seen[job.id] ?? 0) && latest.text) {
      dispatchNativeNotification({
        kind: 'heartbeat',
        title: job.name || translateNow('agentPanel.heartbeat.untitled'),
        body: latest.text.split('\n').filter(Boolean).slice(0, 3).join('\n'),
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
  const jobs = (await getCronJobs(profile)).filter(isRecurring)

  const items = await Promise.all(
    jobs.map(async job => ({
      job,
      latest: await getCronJobLatest(job.id, profile).catch(() => ({ at: null, text: null }))
    }))
  )

  // A profile switch or a newer refresh overtook this one.
  if (mine !== generation) {
    return
  }

  announce(profile, items)
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
