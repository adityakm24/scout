import { normalize } from '@/lib/text'

const SOURCE_LABELS: Record<string, string> = {
  acp: 'ACP',
  api_server: 'API',
  cli: 'CLI',
  codex: 'Codex',
  desktop: 'Desktop',
  gateway: 'Gateway',
  homeassistant: 'Home Assistant',
  kanban: 'Kanban',
  local: 'Local',
  oneshot: 'One-shot',
  tui: 'TUI',
  webhook: 'Webhook'
}

const SOURCE_ALIASES: Record<string, string[]> = {
  cli: ['terminal'],
  desktop: ['app', 'gui'],
  local: ['machine'],
  tui: ['terminal']
}

// Sources that run on the local machine rather than an external gateway
// surface. Exported so the recents fetch can keep these in the main list while
// the gateway-surface fetch excludes them. `acp` runs as a local stdio process spawned
// by an editor, and its rows must never land in the messaging slice either.
export const LOCAL_SESSION_SOURCE_IDS = [
  'acp',
  'cli',
  'codex',
  'desktop',
  'gateway',
  'kanban',
  'local',
  'oneshot',
  'tui'
]

// External gateway surfaces that each get their own self-managed sidebar
// section (fetched separately from local recents). Mirrors the gateway platform
// adapters; keep in sync with PLATFORM_ICONS in components/platform-avatar.tsx.
export const MESSAGING_SESSION_SOURCE_IDS = ['homeassistant', 'webhook', 'api_server']
const MESSAGING_SOURCE_IDS = new Set(MESSAGING_SESSION_SOURCE_IDS)

/** True when a source id is an external gateway surface (gets its own
 *  sidebar section) rather than a local/CLI/desktop session. */
export function isMessagingSource(source: null | string | undefined): boolean {
  const id = normalizeSessionSource(source)

  return id != null && MESSAGING_SOURCE_IDS.has(id)
}

export function normalizeSessionSource(source: null | string | undefined): string | null {
  return normalize(source) || null
}

export function sessionSourceLabel(source: null | string | undefined): string | null {
  const id = normalizeSessionSource(source)

  if (!id) {
    return null
  }

  return SOURCE_LABELS[id] || id.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

export function sessionSourceSearchTerms(source: null | string | undefined): string[] {
  const id = normalizeSessionSource(source)
  const label = sessionSourceLabel(id)

  if (!id) {
    return []
  }

  return [id, label ?? '', ...(SOURCE_ALIASES[id] ?? [])].filter(Boolean)
}
