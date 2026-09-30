import type { PlannerReminder, PlannerTodo } from '@scout/shared'
import { atom, computed } from 'nanostores'

import { translateNow } from '@/i18n'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import { persistString, storedString } from '@/lib/storage'

import { requestGatewayForProfile } from './gateway'
import { $cronChangeTick, $plannerChangeTick } from './live-sync'
import { dispatchNativeNotification } from './native-notifications'
import { notify } from './notifications'
import { $activeGatewayProfile } from './profile'
import { $gatewayState } from './session'
import { isAuxiliaryWindow } from './windows'

// The user's planner — the SAME per-profile store the agent's `planner` tool edits
// (backend `planner/`, RPC `planner.todos` / `planner.reminders`). The backend is
// authoritative: this is a cache that paints optimistically, rolls back on a failed
// write, and re-reads whenever the backend says the store moved (`planner.changed`
// for to-dos, `cron.changed` for reminders — they are reminder-kind cron jobs).

export type { PlannerReminder, PlannerTodo }
export type PlannerPriority = 'none' | 'low' | 'medium' | 'high'

/** `unsupported`: the backend predates the planner RPCs (older Scout). */
export type PlannerStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'

export const $plannerTodos = atom<PlannerTodo[]>([])
export const $plannerReminders = atom<PlannerReminder[]>([])
export const $plannerStatus = atom<PlannerStatus>('idle')
export const $plannerError = atom<string | null>(null)

export const $openTodoCount = computed($plannerTodos, todos => todos.filter(t => t.status !== 'done').length)
export const $upcomingReminders = computed($plannerReminders, reminders =>
  reminders.filter(r => r.status === 'scheduled' || r.status === 'paused')
)

interface TodoResult {
  success: boolean
  error?: string | null
  items?: PlannerTodo[]
  item?: PlannerTodo | null
}

interface ReminderResult {
  success: boolean
  error?: string | null
  reminders?: PlannerReminder[]
  reminder?: PlannerReminder | null
}

// Generation fences: a response for a profile the user already left, or an
// older read that lands after a newer one, must never repaint the lists.
let todoGeneration = 0
let reminderGeneration = 0

const profile = () => $activeGatewayProfile.get() || 'default'

async function call<T extends { success: boolean; error?: string | null }>(
  method: 'planner.todos' | 'planner.reminders',
  params: Record<string, unknown>
): Promise<T> {
  try {
    const result = await requestGatewayForProfile<T>(profile(), method, params)

    if (!result.success) {
      throw new PlannerRequestError(result.error || 'Request failed')
    }

    return result
  } catch (error) {
    if (isMissingRpcMethod(error)) {
      $plannerStatus.set('unsupported')
    }

    throw error
  }
}

/** A request the backend rejected with a user-facing reason (bad time, empty title). */
export class PlannerRequestError extends Error {}

export async function refreshTodos(): Promise<void> {
  if ($gatewayState.get() !== 'open' || $plannerStatus.get() === 'unsupported') {
    return
  }

  const generation = ++todoGeneration
  const owner = profile()

  if ($plannerStatus.get() === 'idle') {
    $plannerStatus.set('loading')
  }

  try {
    const result = await call<TodoResult>('planner.todos', { action: 'list' })

    if (generation === todoGeneration && owner === profile()) {
      $plannerTodos.set(result.items ?? [])
      $plannerStatus.set('ready')
      $plannerError.set(null)
    }
  } catch (error) {
    if (generation === todoGeneration && $plannerStatus.get() !== 'unsupported') {
      $plannerStatus.set('error')
      $plannerError.set(error instanceof Error ? error.message : String(error))
    }
  }
}

export async function refreshReminders(): Promise<void> {
  if ($gatewayState.get() !== 'open' || $plannerStatus.get() === 'unsupported') {
    return
  }

  const generation = ++reminderGeneration
  const owner = profile()

  try {
    const result = await call<ReminderResult>('planner.reminders', { action: 'list' })

    if (generation === reminderGeneration && owner === profile()) {
      const reminders = result.reminders ?? []
      announceFiredReminders(owner, reminders)
      $plannerReminders.set(reminders)
    }
  } catch {
    // Reminders ride the cron store; a transient read failure keeps the last list.
  }
}

export function refreshPlanner(): Promise<unknown> {
  return Promise.all([refreshTodos(), refreshReminders()])
}

// ── To-dos: optimistic writes ─────────────────────────────────────────────────

async function mutateTodos(
  optimistic: (todos: PlannerTodo[]) => PlannerTodo[],
  params: Record<string, unknown>
): Promise<boolean> {
  const before = $plannerTodos.get()
  $plannerTodos.set(optimistic(before))
  todoGeneration++ // a read already in flight predates this write

  try {
    const result = await call<TodoResult>('planner.todos', params)
    $plannerTodos.set(result.items ?? [])

    return true
  } catch (error) {
    $plannerTodos.set(before)
    notify({ kind: 'error', message: error instanceof Error ? error.message : String(error) })

    return false
  }
}

const now = () => new Date().toISOString()

export function addTodo(title: string, fields: { due?: string; priority?: PlannerPriority } = {}): Promise<boolean> {
  const draft: PlannerTodo = {
    id: `pending-${Date.now()}`,
    title,
    notes: '',
    status: 'open',
    priority: fields.priority ?? 'none',
    due: fields.due || null,
    created_by: 'user',
    created_at: now(),
    updated_at: now()
  }

  return mutateTodos(todos => [draft, ...todos], { action: 'add', title, ...fields })
}

export function updateTodo(
  id: string,
  fields: Partial<Pick<PlannerTodo, 'title' | 'notes' | 'priority' | 'status'>> & { due?: string }
): Promise<boolean> {
  return mutateTodos(
    todos =>
      todos.map(t =>
        t.id === id
          ? {
              ...t,
              ...fields,
              due: fields.due === undefined ? t.due : fields.due || null,
              completed_at: fields.status === 'done' ? now() : fields.status === 'open' ? null : t.completed_at
            }
          : t
      ),
    { action: 'update', id, ...fields }
  )
}

export function toggleTodo(todo: PlannerTodo): Promise<boolean> {
  return updateTodo(todo.id, { status: todo.status === 'done' ? 'open' : 'done' })
}

export function deleteTodo(id: string): Promise<boolean> {
  return mutateTodos(todos => todos.filter(t => t.id !== id), { action: 'delete', id })
}

export function clearCompletedTodos(): Promise<boolean> {
  return mutateTodos(todos => todos.filter(t => t.status !== 'done'), { action: 'clear_completed' })
}

export function reorderTodos(ids: string[]): Promise<boolean> {
  return mutateTodos(
    todos => {
      const byId = new Map(todos.map(t => [t.id, t]))
      const head = ids.map(id => byId.get(id)).filter((t): t is PlannerTodo => Boolean(t))

      return [...head, ...todos.filter(t => !ids.includes(t.id))]
    },
    { action: 'reorder', ids }
  )
}

// ── Reminders: the backend schedules, so writes wait for its answer ───────────

async function mutateReminders(params: Record<string, unknown>): Promise<boolean> {
  reminderGeneration++

  try {
    const result = await call<ReminderResult>('planner.reminders', params)
    $plannerReminders.set(result.reminders ?? [])

    return true
  } catch (error) {
    notify({ kind: 'error', message: error instanceof Error ? error.message : String(error) })

    return false
  }
}

export const addReminder = (text: string, when: string) => mutateReminders({ action: 'add', text, when })

export const updateReminder = (id: string, fields: { text?: string; when?: string }) =>
  mutateReminders({ action: 'update', id, ...fields })

export function deleteReminder(id: string): Promise<boolean> {
  $plannerReminders.set($plannerReminders.get().filter(r => r.id !== id))

  return mutateReminders({ action: 'delete', id })
}

export const clearFiredReminders = () => mutateReminders({ action: 'clear_fired' })

// ── Fired-reminder notifications ──────────────────────────────────────────────
// A reminder fires in the backend's cron ticker; the desktop learns of it from
// `cron.changed` → a re-read where its status turned `fired`. Announced ids are
// remembered per profile so a relaunch doesn't re-announce old reminders, and
// the first read on a fresh install only records what is already fired.

const ANNOUNCED_KEY = 'scout:planner:announced'
const ANNOUNCED_CAP = 200

function announcedFor(owner: string): Set<string> | null {
  try {
    const all = JSON.parse(storedString(ANNOUNCED_KEY) || '{}') as Record<string, string[]>

    return Array.isArray(all[owner]) ? new Set(all[owner]) : null
  } catch {
    return null
  }
}

function rememberAnnounced(owner: string, ids: Set<string>): void {
  let all: Record<string, string[]> = {}

  try {
    all = JSON.parse(storedString(ANNOUNCED_KEY) || '{}') as Record<string, string[]>
  } catch {
    all = {}
  }

  all[owner] = [...ids].slice(-ANNOUNCED_CAP)
  persistString(ANNOUNCED_KEY, JSON.stringify(all))
}

/** Exported for tests: the fired reminders not yet announced. `announced === null` (nothing
 *  recorded for this profile yet) announces nothing — the first read only takes a baseline. */
export function newlyFired(reminders: PlannerReminder[], announced: Set<string> | null): PlannerReminder[] {
  if (announced === null) {
    return []
  }

  return reminders.filter(r => r.status === 'fired' && !announced.has(`${r.id}@${r.last_fired_at ?? ''}`))
}

function announceFiredReminders(owner: string, reminders: PlannerReminder[]): void {
  // One announcer per app: extra windows (New Window, HUD, popouts) stay live
  // but leave the ringing to the primary window, or each would notify.
  if (isAuxiliaryWindow()) {
    return
  }

  const announced = announcedFor(owner)
  const fresh = newlyFired(reminders, announced)
  const next = new Set(announced ?? [])

  for (const r of reminders) {
    if (r.status === 'fired') {
      next.add(`${r.id}@${r.last_fired_at ?? ''}`)
    }
  }

  for (const reminder of fresh) {
    const title = translateNow('dashboard.reminders.notificationTitle')

    dispatchNativeNotification({
      kind: 'reminder',
      title,
      body: reminder.text,
      global: true,
      tag: `reminder:${reminder.id}`,
      activate: '/dashboard'
    })

    // In front of the user too: the OS banner can be muted by Focus modes.
    if (document.hasFocus()) {
      notify({ kind: 'info', title, message: reminder.text })
    }
  }

  rememberAnnounced(owner, next)
}

// ── Live sync ────────────────────────────────────────────────────────────────
// Started once from the core contributions (controller.tsx), not by a mounted
// view: a reminder must notify even while the Dashboard is closed.

let started = false

export function startPlannerSync(): void {
  if (started) {
    return
  }

  started = true
  $plannerChangeTick.listen(() => void refreshTodos())
  $cronChangeTick.listen(() => void refreshReminders())
  $activeGatewayProfile.listen(() => {
    $plannerTodos.set([])
    $plannerReminders.set([])
    void refreshPlanner()
  })
  $gatewayState.listen(state => {
    if (state === 'open') {
      // A reconnect may land on a newer (or older) backend: re-probe support.
      if ($plannerStatus.get() === 'unsupported') {
        $plannerStatus.set('idle')
      }

      void refreshPlanner()
    }
  })

  if ($gatewayState.get() === 'open') {
    void refreshPlanner()
  }
}
