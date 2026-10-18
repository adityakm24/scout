import type { GatewayEvent } from '@scout/shared'
import type { ScoutSkin } from '@scout/shared/skin'

import { clearClarifyRequest } from '@/store/clarify'
import {
  notifyCronChanged,
  notifyPetChanged,
  notifyPlannerChanged,
  notifyProjectsChanged,
  notifySessionsChanged,
  type PetChangeMeta,
  setChangeEventsAvailable
} from '@/store/live-sync'
import { clearAllPrompts } from '@/store/prompts'
import { markRuntimeGone } from '@/store/runtime-gone'
import { dropSessionState, unbindTileRuntime } from '@/store/session-states'
// Leaf import (not the `@/themes` barrel) to avoid pulling the ThemeProvider
// module graph into the gateway event hot path.
import { ingestBackendSkin } from '@/themes/backend-sync'

import type { GatewayEventContext } from './types'

// Change-watcher broadcasts (tui_gateway change_watcher._CHANGE_WATCHES): the backend's on-disk
// signature for that store moved, so the live-sync tick its surfaces subscribe to advances.
const CHANGE_NOTIFIERS = new Map<string, (payload: unknown) => void>([
  ['pet.changed', payload => notifyPetChanged(payload as PetChangeMeta | undefined)],
  ['cron.changed', () => notifyCronChanged()],
  ['sessions.changed', () => notifySessionsChanged()],
  ['projects.changed', () => notifyProjectsChanged()],
  ['planner.changed', () => notifyPlannerChanged()]
])

/** gateway.ready / setup.ready / skin.changed / change-watcher broadcasts / session.reclaimed. */
export function handleLifecycleEvent(ctx: GatewayEventContext): boolean {
  const { deps, event, payload, fromActiveSource } = ctx

  if (event.type === 'gateway.ready') {
    const ready = (event as GatewayEvent<'gateway.ready'>).payload
    // Seed the active skin into the desktop theme registry without applying,
    // so a fresh connect never overrides the user's persisted desktop theme.
    ingestBackendSkin(ready?.skin, { apply: false })
    // Backends with the change watcher broadcast pet/cron/sessions change
    // events; consumers demote their legacy polls to slow backstops.
    setChangeEventsAvailable(Boolean(ready?.change_events))

    return true
  }

  if (event.type === 'skin.changed') {
    // A runtime skin switch (Scout activating an authored skin, or `/skin`
    // on another surface). Only the active source+profile's change repaints.
    if (fromActiveSource()) {
      ingestBackendSkin(payload as ScoutSkin | undefined, { apply: true })
    }

    return true
  }

  const notifyChange = CHANGE_NOTIFIERS.get(event.type)

  if (notifyChange) {
    // Change-watcher broadcasts (server._broadcast_watched_changes): the
    // backend's on-disk signature moved. Route to the live-sync ticks the
    // former pollers now subscribe to. Only the active source+profile's
    // changes apply — background profile sockets (and other connections'
    // gateways) watch their own homes.
    if (fromActiveSource()) {
      notifyChange(payload)
    }

    return true
  }

  if (event.type === 'session.reclaimed') {
    // The backend reclaimed a live session we may still be holding (idle
    // TTL, LRU cap, or the WS-orphan reap). Without this the runtime id
    // stays cached until something fails against it, which reads as the
    // session vanishing rather than being reclaimed. Drop the cached state
    // now — the stored row is untouched, so the sidebar keeps the
    // conversation and reopening it resumes from the DB.
    const reclaimedRuntimeId = String((payload as { session_id?: string } | undefined)?.session_id ?? '')

    if (reclaimedRuntimeId) {
      // Heal while the cached stored-id mapping is still intact, then drop.
      markRuntimeGone(reclaimedRuntimeId)
      dropSessionState(reclaimedRuntimeId)
      // A prompt keyed to the dead runtime must not outlive it. The runtime id
      // rotates on every resume (cold/lazy/eager all mint a fresh sid), so the
      // new runtime's turn-end clears can never remove an entry keyed to THIS
      // one — a stale approval would re-mount the floating "needs approval"
      // bar whenever the reclaimed conversation is reopened (#86577).
      clearAllPrompts(reclaimedRuntimeId)
      clearClarifyRequest(undefined, reclaimedRuntimeId)
      // A tile bound to the reclaimed runtime would otherwise render an
      // empty transcript forever: its view reads $sessionStates[runtime]
      // (just dropped) and its resume effect is gated on !runtimeId, so a
      // bound tile never re-resumes (#82620). Unbind it so the effect
      // refires against the intact stored session — and purge the wiring
      // cache's entry, or resumeTile's warm path would hand the dead
      // runtime straight back instead of cold-resuming a live one.
      unbindTileRuntime(reclaimedRuntimeId)
      deps.sessionStateByRuntimeIdRef.current.delete(reclaimedRuntimeId)
    }

    // The row's ended_at moved, so refresh the lists that render it.
    notifySessionsChanged()

    return true
  }

  return false
}
