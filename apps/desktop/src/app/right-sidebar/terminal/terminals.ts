import { atom } from 'nanostores'

import { setTerminalTakeover } from '../store'

import { seedAgentTerminalCommand } from './agent-terminal-stream'

/** One read-only terminal tab mirroring an agent background process
 *  (`terminal(background=true)`), keyed by `procId`. Runtime-only: tabs are not
 *  persisted across launches. */
export interface TerminalEntry {
  id: string
  title: string
  procId: string
}

export const $terminals = atom<readonly TerminalEntry[]>([])
export const $activeTerminalId = atom<string | null>(null)

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// Procs we've already surfaced a tab for — so closing an agent tab doesn't
// resurrect it on the next poll while the process is still running.
const surfacedProcs = new Set<string>()

const findByProc = (procId: string) => $terminals.get().find(term => term.procId === procId)

/** Auto-surface an agent background process as a read-only tab — once. Returns
 *  the tab id, or null if it was already surfaced and the user has since closed it. */
export function ensureAgentTerminal(procId: string, title: string): string | null {
  const existing = findByProc(procId)

  if (existing) {
    return existing.id
  }

  if (surfacedProcs.has(procId)) {
    return null
  }

  surfacedProcs.add(procId)
  const id = newId()
  $terminals.set([...$terminals.get(), { id, title: title || 'agent', procId }])

  return id
}

/** Open + focus an agent process's tab (the status-stack link), recreating it if
 *  the user had closed it. Opens the pane. */
export function openAgentTerminal(procId: string, title: string): void {
  surfacedProcs.add(procId)
  seedAgentTerminalCommand(procId, title)
  let id = findByProc(procId)?.id

  if (!id) {
    id = newId()
    $terminals.set([...$terminals.get(), { id, title: title || 'agent', procId }])
  }

  $activeTerminalId.set(id)
  setTerminalTakeover(true)
}

export function selectTerminal(id: string): void {
  if ($terminals.get().some(term => term.id === id)) {
    $activeTerminalId.set(id)
  }
}

/** Move the active tab by `direction` (+1 next / -1 prev), wrapping around. */
export function cycleTerminal(direction: 1 | -1): void {
  const list = $terminals.get()

  if (list.length < 2) {
    return
  }

  const current = Math.max(
    0,
    list.findIndex(term => term.id === $activeTerminalId.get())
  )

  $activeTerminalId.set(list[(current + direction + list.length) % list.length].id)
}

/** Drop a terminal. Focus slides to the neighbor that fills its slot; closing
 *  the last one closes the whole pane. */
export function closeTerminal(id: string): void {
  const list = $terminals.get()
  const index = list.findIndex(term => term.id === id)

  if (index < 0) {
    return
  }

  const next = list.filter(term => term.id !== id)
  $terminals.set(next)

  if ($activeTerminalId.get() === id) {
    $activeTerminalId.set((next[index] ?? next[index - 1])?.id ?? null)
  }

  if (!next.length) {
    setTerminalTakeover(false)
  }
}

/** Close the read-only agent tab mirroring a background process. The agent
 *  drives this via the desktop-gated `close_terminal` tool → `terminal.close`.
 *  The process is NOT killed — only the view is dropped; `surfacedProcs` keeps
 *  it from auto-resurfacing, and the status-stack row can reopen it on demand.
 *  No-op when no such tab exists. */
export function closeAgentTerminalByProc(procId: string): boolean {
  const term = $terminals.get().find(t => t.procId === procId)

  if (!term) {
    return false
  }

  closeTerminal(term.id)

  return true
}

export function closeActiveTerminal(): void {
  const id = $activeTerminalId.get()

  if (id) {
    closeTerminal(id)
  }
}

export function closeAllTerminals(): void {
  if ($terminals.get().length === 0) {
    return
  }

  $terminals.set([])
  $activeTerminalId.set(null)
  setTerminalTakeover(false)
}

export function closeOtherTerminals(id: string): void {
  const keep = $terminals.get().find(term => term.id === id)

  if (keep) {
    $terminals.set([keep])
    $activeTerminalId.set(keep.id)
  }
}

export function renameTerminal(id: string, title: string): void {
  const trimmed = title.trim()

  $terminals.set(
    $terminals.get().map(term => (term.id === id ? { ...term, title: trimmed || term.title } : term))
  )
}
