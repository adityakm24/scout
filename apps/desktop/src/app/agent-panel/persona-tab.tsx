import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import {
  describeAgent,
  getMemoryFiles,
  type MemoryFile,
  type MemoryFiles,
  type MemoryTarget,
  saveAgentSoul,
  saveMemoryFile
} from '@/api/agent-identity'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeGatewayProfile } from '@/store/profile'

import { MemoryEditor, SoulEditor } from './persona-editors'

type RowId = 'memory' | 'soul' | 'user'

const ROW_ICON: Record<RowId, string> = { soul: 'sparkle', memory: 'history', user: 'account' }

// The backend joins entries with "\n§\n"; the budget counts the joined text.
const usedChars = (file: MemoryFile) =>
  file.entries.reduce((sum, entry) => sum + entry.length, 0) + Math.max(0, file.entries.length - 1) * 3

/** First meaningful line of the soul, without markdown heading marks. */
const soulPreview = (soul: string) =>
  soul
    .split('\n')
    .map(line => line.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? ''

interface PersonaState {
  memory: MemoryFiles | null
  soul: null | string
}

interface RowModel {
  caption: string
  id: RowId
  meta?: string
  preview: string
  title: string
  usage?: number
}

/** What the agent is and what it remembers, each row previewing its own content and opening
 *  its editor. Memory rows show how full their budget is: the memory tool refuses to grow past it. */
export function PersonaTab() {
  const { t } = useI18n()
  const copy = t.agentPanel.persona
  const profile = useStore($activeGatewayProfile)
  const [state, setState] = useState<PersonaState>({ memory: null, soul: null })
  const [editing, setEditing] = useState<null | RowId>(null)

  const load = useCallback(() => {
    let live = true
    void Promise.all([describeAgent(profile).catch(() => null), getMemoryFiles(profile).catch(() => null)]).then(
      ([agent, memory]) => {
        if (live) {
          setState({ memory, soul: agent?.soul ?? null })
        }
      }
    )

    return () => {
      live = false
    }
  }, [profile])

  useEffect(load, [load])

  const memoryRow = (id: MemoryTarget, title: string, caption: string): RowModel => {
    const file = state.memory?.[id]

    return {
      caption,
      id,
      meta: file ? copy.entries(file.entries.length) : undefined,
      preview: file?.entries[0] ?? copy.never,
      title,
      usage: file && file.limit > 0 ? Math.min(1, usedChars(file) / file.limit) : undefined
    }
  }

  const rows: RowModel[] = [
    { caption: copy.soulCaption, id: 'soul', preview: soulPreview(state.soul ?? '') || copy.never, title: copy.soul },
    memoryRow('memory', copy.memory, copy.memoryCaption),
    memoryRow('user', copy.user, copy.userCaption)
  ]

  const saveMemory = (target: MemoryTarget) => async (entries: string[]) => {
    const saved = await saveMemoryFile(profile, target, entries)
    setState(current => (current.memory ? { ...current, memory: { ...current.memory, [target]: saved } } : current))
  }

  return (
    <div className="flex flex-col gap-2 p-4" data-slot="agent-persona">
      {rows.map(row => (
        <button
          className="scout-stagger group flex w-full items-start gap-3 rounded-2xl border border-(--ui-stroke-quaternary) bg-(--ui-bg-elevated) p-3 text-left transition-[border-color,translate,background-color] duration-300 ease-(--ease-spring) hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--theme-primary)_40%,transparent)]"
          data-persona-row={row.id}
          key={row.id}
          onClick={() => setEditing(row.id)}
          type="button"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--theme-primary)_14%,transparent)] text-(--theme-primary) transition-transform duration-300 ease-(--ease-spring) group-hover:scale-110">
            <Codicon name={ROW_ICON[row.id]} size="1rem" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[0.8125rem] font-semibold text-foreground">{row.title}</span>
              {row.meta && <span className="shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)">{row.meta}</span>}
            </span>
            <span className="text-[0.6875rem] text-(--ui-text-tertiary)">{row.caption}</span>
            <span className="mt-1 line-clamp-2 text-xs leading-snug text-(--ui-text-secondary)">{row.preview}</span>
            {row.usage !== undefined && (
              <span className="mt-2 h-1 overflow-hidden rounded-full bg-(--ui-bg-tertiary)">
                <span
                  className={cn(
                    'block h-full rounded-full transition-[width] duration-500 ease-(--ease-out-expo)',
                    row.usage > 0.9 ? 'bg-(--ui-orange)' : 'bg-(--theme-primary)'
                  )}
                  style={{ width: `${Math.max(row.usage * 100, row.usage > 0 ? 3 : 0)}%` }}
                />
              </span>
            )}
          </span>
          <Codicon className="mt-2.5 shrink-0 text-(--ui-text-quaternary)" name="chevron-right" size="0.75rem" />
        </button>
      ))}

      {editing === 'soul' && state.soul !== null && (
        <SoulEditor
          initial={state.soul}
          onClose={() => setEditing(null)}
          onSave={async soul => {
            await saveAgentSoul(profile, soul)
            setState(current => ({ ...current, soul }))
          }}
        />
      )}
      {(editing === 'memory' || editing === 'user') && state.memory && (
        <MemoryEditor
          caption={editing === 'memory' ? copy.memoryCaption : copy.userCaption}
          initial={state.memory[editing].entries}
          limit={state.memory[editing].limit}
          onClose={() => setEditing(null)}
          onSave={saveMemory(editing)}
          title={editing === 'memory' ? copy.memory : copy.user}
        />
      )}
    </div>
  )
}
