import { type FormEvent, type ReactNode, useEffect, useState } from 'react'

import { ChevronLeft, ChevronRight, Globe, Lock, Plus, RefreshCw, X } from '@/lib/icons'
import { cn } from '@/lib/utils'

export interface BrowserTab {
  active: boolean
  id: string
  title: string
  url: string
}

export interface AgentCursor {
  kind: 'click' | 'move'
  seq: number
  x: number
  y: number
}

const SCREEN_W = 1280
const SCREEN_H = 800

function displayUrl(url: string): string {
  return url === 'about:blank' ? '' : url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}

/** The agent's pointer drawn over the page: it glides with the agent's moves and ripples on clicks. */
function Cursor({ cursor }: { cursor: AgentCursor | null }) {
  if (!cursor) {
    return null
  }

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-10 transition-[left,top] duration-75 ease-linear"
      style={{ left: `${(cursor.x / SCREEN_W) * 100}%`, top: `${(cursor.y / SCREEN_H) * 100}%` }}
    >
      {cursor.kind === 'click' ? (
        <span
          className="absolute -top-4 -left-4 size-8 animate-ping rounded-full bg-(--ui-accent)/40"
          key={cursor.seq}
        />
      ) : null}
      <svg className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]" height="22" viewBox="0 0 24 24" width="22">
        <path
          d="M4 2.5 19.5 12l-7 1.6-3.7 6.9z"
          fill="var(--ui-accent, #0a84ff)"
          stroke="white"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
    </span>
  )
}

interface BrowserFrameProps {
  children: ReactNode
  compact?: boolean
  cursor: AgentCursor | null
  interactive: boolean
  onCommand: (msg: Record<string, unknown>) => void
  tabs: BrowserTab[]
}

/** Chromium's frame, drawn by the app from DevTools: tabs, back/forward/reload and the address bar
 *  around the live page. The controls act only while the person holds control (`interactive`). */
export function BrowserFrame({ children, compact = false, cursor, interactive, onCommand, tabs }: BrowserFrameProps) {
  const active = tabs.find(tab => tab.active)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) {
      setAddress(displayUrl(active?.url ?? ''))
    }
  }, [active?.url, editing])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onCommand({ type: 'navigate', url: address })
    setEditing(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const button = 'grid size-7 shrink-0 place-items-center rounded-md text-[#5f6368] transition-colors enabled:hover:bg-black/[0.06] disabled:opacity-40'

  return (
    <div className="flex flex-col overflow-hidden bg-[#dfe1e5]">
      {/* Tab strip */}
      <div className={cn('flex items-end gap-0.5 px-2', compact ? 'h-7 pt-1' : 'h-10 pt-2')}>
        {tabs.map(tab => (
          <div
            className={cn(
              'group/tab flex min-w-0 max-w-56 flex-1 items-center gap-1.5 rounded-t-lg px-2.5 text-[#3c4043]',
              compact ? 'h-6 text-[0.6875rem]' : 'h-8 text-xs',
              tab.active ? 'bg-white' : 'hover:bg-white/50'
            )}
            key={tab.id}
            onClick={() => interactive && !tab.active && onCommand({ type: 'activate_tab', id: tab.id })}
          >
            <Globe className="shrink-0 opacity-60" size={compact ? 11 : 13} />
            <span className="min-w-0 flex-1 truncate">{tab.title || displayUrl(tab.url) || 'New Tab'}</span>
            {compact ? null : (
              <button
                aria-label="Close tab"
                className="grid size-4 shrink-0 place-items-center rounded-full opacity-0 transition-opacity enabled:group-hover/tab:opacity-100 enabled:hover:bg-black/10 disabled:invisible"
                disabled={!interactive}
                onClick={event => {
                  event.stopPropagation()
                  onCommand({ type: 'close_tab', id: tab.id })
                }}
                type="button"
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
        {compact ? null : (
          <button
            aria-label="New tab"
            className={cn(button, 'mb-0.5 size-7')}
            disabled={!interactive}
            onClick={() => onCommand({ type: 'new_tab' })}
            type="button"
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      {/* Toolbar */}
      <div className={cn('flex items-center gap-1 bg-white px-2', compact ? 'h-7' : 'h-10')}>
        {compact ? null : (
          <>
            <button aria-label="Back" className={button} disabled={!interactive} onClick={() => onCommand({ type: 'back' })} type="button">
              <ChevronLeft size={17} />
            </button>
            <button aria-label="Forward" className={button} disabled={!interactive} onClick={() => onCommand({ type: 'forward' })} type="button">
              <ChevronRight size={17} />
            </button>
            <button aria-label="Reload" className={button} disabled={!interactive} onClick={() => onCommand({ type: 'reload' })} type="button">
              <RefreshCw size={14} />
            </button>
          </>
        )}
        <form className="min-w-0 flex-1" onSubmit={submit}>
          <label
            className={cn(
              'flex items-center gap-2 rounded-full bg-[#f1f3f4] px-3 text-[#202124]',
              compact ? 'h-5 text-[0.6875rem]' : 'h-7 text-[0.8125rem]',
              interactive && 'focus-within:bg-white focus-within:ring-2 focus-within:ring-(--ui-accent)'
            )}
          >
            <Lock className="shrink-0 opacity-50" size={compact ? 10 : 12} />
            <input
              aria-label="Address"
              className="min-w-0 flex-1 bg-transparent outline-none disabled:cursor-default"
              disabled={!interactive}
              onBlur={() => setEditing(false)}
              onChange={event => {
                setEditing(true)
                setAddress(event.target.value)
              }}
              onFocus={event => {
                setEditing(true)
                event.target.select()
              }}
              onKeyDown={event => event.stopPropagation()}
              onKeyUp={event => event.stopPropagation()}
              placeholder="Search or type a URL"
              value={address}
            />
          </label>
        </form>
      </div>
      {/* Page */}
      <div className="relative bg-white">
        {children}
        <Cursor cursor={cursor} />
      </div>
    </div>
  )
}
