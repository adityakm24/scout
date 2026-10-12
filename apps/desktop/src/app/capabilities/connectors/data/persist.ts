import { queryClient } from '@/lib/query-client'
import { readJson, writeJson } from '@/lib/storage'
import { type ProfileScope, profileScopeKey } from '@/scout'

import { MCP_CATALOG_KEY } from '../../mcp/mcp-status'
import type { LocalServerInput } from '../types'

export type PersistedRead = 'bundled' | 'servers'

const STORAGE_PREFIX = 'scout.connectors.v4.'

const PERSIST_MAX_BYTES = 256 * 1024

interface PersistedEntry {
  at: number
  data: unknown
}

type PersistedValue = PersistedEntry['data']

type PersistedBlob = Partial<Record<PersistedRead, PersistedEntry>>

const keyFor = (scopeKey: string) => `${STORAGE_PREFIX}${scopeKey}`

function size(value: PersistedBlob | PersistedEntry): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function readBlob(scopeKey: string): PersistedBlob | null {
  const blob = readJson<PersistedBlob>(keyFor(scopeKey))

  return blob instanceof Object && !Array.isArray(blob) ? blob : null
}

export interface QuerySeed<T> {
  initialData?: T
  initialDataUpdatedAt?: number
}

export function seedOptions<T>(scopeKey: ProfileScope, read: PersistedRead): QuerySeed<T> {
  const entry = readBlob(profileScopeKey(scopeKey))?.[read]

  if (!entry || !Number.isFinite(entry.at) || entry.data === undefined || entry.data === null) {
    return {}
  }

  // SAFETY: the caller names the read whose answer it stored, so the entry holds that read's own result.
  return { initialData: entry.data as T, initialDataUpdatedAt: entry.at }
}

function store(scopeKey: string, read: PersistedRead, entry: PersistedEntry): void {
  if (size(entry) > PERSIST_MAX_BYTES) {
    return
  }

  writeJson(keyFor(scopeKey), { ...readBlob(scopeKey), [read]: entry })
}

const WRITE_DELAY_MS = 500

interface PendingWrite {
  entry: PersistedEntry
  scopeKey: string
}

/** Mirror the bundled MCP catalog into localStorage so the tab paints from the last answer on open. */
export function startConnectorPersistence(): () => void {
  const pending = new Map<string, PendingWrite>()
  const written = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null

    for (const [key, write] of pending) {
      store(write.scopeKey, 'bundled', write.entry)
      written.set(key, write.entry.at)
    }

    pending.clear()
  }

  const stopCache = queryClient.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success') {
      return
    }

    const [root, scopeKey] = event.query.queryKey
    const { data, dataUpdatedAt } = event.query.state

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- SAFETY: a react-query key is typed `readonly unknown[]`; this is where the scope segment is read back.
    if (root !== MCP_CATALOG_KEY[0] || typeof scopeKey !== 'string' || data === undefined) {
      return
    }

    if (written.get(scopeKey) === dataUpdatedAt) {
      return
    }

    pending.set(scopeKey, { entry: { at: dataUpdatedAt, data }, scopeKey })
    timer ??= setTimeout(flush, WRITE_DELAY_MS)
  })

  return () => {
    stopCache()

    if (timer !== null) {
      clearTimeout(timer)
      flush()
    }
  }
}

interface ServerSeed {
  enabled: boolean
  name: string
}

function isSeed(value: PersistedValue): value is ServerSeed {
  if (value === null || !(value instanceof Object)) {
    return false
  }

  // SAFETY: an object here; the two field checks below are what make it a ServerSeed.
  const seed = value as Partial<ServerSeed>

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- SAFETY: `seed` is a value read back from localStorage; this line is where it becomes a ServerSeed.
  return typeof seed.name === 'string' && typeof seed.enabled === 'boolean'
}

export function storeLocalServers(scope: ProfileScope, servers: readonly LocalServerInput[]): void {
  const seeds: ServerSeed[] = servers.map(({ enabled, name }) => ({ enabled, name }))

  store(profileScopeKey(scope), 'servers', { at: Date.now(), data: seeds })
}

export function seedLocalServers(scope: ProfileScope): LocalServerInput[] {
  const { initialData } = seedOptions<unknown>(scope, 'servers')

  if (!Array.isArray(initialData)) {
    return []
  }

  return initialData.filter(isSeed).map(seed => ({ ...seed, status: 'unknown', target: '' }))
}
