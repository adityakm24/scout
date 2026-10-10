import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'

// The backend joins entries with "\n§\n"; the budget counts the joined text.
const ENTRY_DELIMITER_LENGTH = 3

const usedChars = (entries: string[]) => {
  const kept = entries.map(entry => entry.trim()).filter(Boolean)

  return kept.reduce((sum, entry) => sum + entry.length, 0) + Math.max(0, kept.length - 1) * ENTRY_DELIMITER_LENGTH
}

interface EditorShellProps {
  children: React.ReactNode
  description: string
  disabled?: boolean
  onClose: () => void
  onSave: () => Promise<void>
  title: string
}

function EditorShell({ children, description, disabled = false, onClose, onSave, title }: EditorShellProps) {
  const { t } = useI18n()
  const copy = t.agentPanel.persona
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)

    try {
      await onSave()
      onClose()
    } catch (error) {
      notifyError(error, t.agentPanel.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={open => !open && onClose()} open>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button onClick={onClose} variant="ghost">
            {copy.cancel}
          </Button>
          <Button disabled={disabled || saving} loading={saving} onClick={() => void save()}>
            {copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** SOUL.md as one document: the agent's personality and voice. */
export function SoulEditor({
  initial,
  onClose,
  onSave
}: {
  initial: string
  onClose: () => void
  onSave: (soul: string) => Promise<void>
}) {
  const { t } = useI18n()
  const copy = t.agentPanel.persona
  const [soul, setSoul] = useState(initial)

  return (
    <EditorShell
      description={`${copy.soulCaption}. ${copy.appliesToNewChats}`}
      onClose={onClose}
      onSave={() => onSave(soul)}
      title={copy.soul}
    >
      <Textarea
        className="min-h-72 font-mono text-[0.8125rem] leading-relaxed"
        onChange={event => setSoul(event.target.value)}
        value={soul}
      />
    </EditorShell>
  )
}

/** MEMORY.md / USER.md as the entry list the memory tool keeps, inside the same character budget. */
export function MemoryEditor({
  caption,
  initial,
  limit,
  onClose,
  onSave,
  title
}: {
  caption: string
  initial: string[]
  limit: number
  onClose: () => void
  onSave: (entries: string[]) => Promise<void>
  title: string
}) {
  const { t } = useI18n()
  const copy = t.agentPanel.persona
  const [entries, setEntries] = useState(() => (initial.length ? initial : ['']))
  const used = usedChars(entries)
  const over = used > limit

  const update = (index: number, value: null | string) =>
    setEntries(current =>
      value === null ? current.filter((_, i) => i !== index) : current.map((entry, i) => (i === index ? value : entry))
    )

  return (
    <EditorShell
      description={`${caption}. ${copy.appliesToNewChats}`}
      disabled={over}
      onClose={onClose}
      onSave={() => onSave(entries.map(entry => entry.trim()).filter(Boolean))}
      title={title}
    >
      <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
        {entries.map((entry, index) => (
          <div className="group relative" key={index}>
            <Textarea
              className="min-h-14 pr-9 text-[0.8125rem] leading-relaxed"
              onChange={event => update(index, event.target.value)}
              placeholder={copy.entryPlaceholder}
              value={entry}
            />
            <button
              aria-label={copy.removeEntry}
              className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--chrome-action-hover) hover:text-foreground group-focus-within:opacity-100 group-hover:opacity-100"
              onClick={() => update(index, null)}
              type="button"
            >
              <Codicon name="close" size="0.75rem" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button onClick={() => setEntries(current => [...current, ''])} size="sm" variant="ghost">
          <Codicon name="add" />
          {copy.addEntry}
        </Button>
        <span className={cn('text-xs tabular-nums', over ? 'text-(--ui-red)' : 'text-(--ui-text-tertiary)')}>
          {over ? copy.overBudget : copy.budget(used, limit)}
        </span>
      </div>
    </EditorShell>
  )
}
