import { useStore } from '@nanostores/react'
import { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react'

import { AgentAvatar } from '@/components/chat/agent-avatar'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { AVATAR_MAX_BYTES, avatarDataUrl } from '@/lib/avatar-file'
import { cn } from '@/lib/utils'
import { $agentIdentity, agentDisplayName, changeAgentAvatar, renameAgent } from '@/store/agent-identity'
import { notify, notifyError } from '@/store/notifications'
import { $gatewayState } from '@/store/session'

/** Photo, name and connection state at the top of the agent panel. Both edits save at once. */
export function IdentityCard() {
  const { t } = useI18n()
  const copy = t.agentPanel
  const identity = useStore($agentIdentity)
  const connected = useStore($gatewayState) === 'open'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const name = agentDisplayName(identity)

  const commitName = () => {
    setEditing(false)
    const next = draft.trim()

    if (next === identity.name.trim()) {
      return
    }

    renameAgent(next).then(
      () => notify({ kind: 'info', title: copy.persona.saved, message: copy.renameHint }),
      error => notifyError(error, copy.saveFailed)
    )
  }

  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitName()
    } else if (event.key === 'Escape') {
      setEditing(false)
    }
  }

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const dataUrl = await avatarDataUrl(file)

    // Base64 is 4/3 the bytes it encodes; the backend caps the decoded image.
    if (!dataUrl || (dataUrl.length * 3) / 4 > AVATAR_MAX_BYTES) {
      notify({ kind: 'error', title: copy.changePhoto, message: copy.photoTooLarge })

      return
    }

    changeAgentAvatar(dataUrl).catch(error => notifyError(error, copy.saveFailed))
  }

  return (
    <div className="flex flex-col items-center gap-3 px-4 pb-4 pt-6 text-center" data-slot="agent-identity-card">
      <div className="relative">
        <AgentAvatar
          className="size-24 text-[2.75rem] shadow-[0_0.75rem_2rem_-1rem_var(--theme-primary)]"
          identity={identity}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={copy.changePhoto}
              className="absolute -right-0.5 bottom-0.5 grid size-8 place-items-center rounded-full border-2 border-(--ui-sidebar-surface-background) bg-(--ui-bg-elevated) text-(--ui-text-secondary) shadow-sm transition-transform duration-200 hover:scale-110 hover:text-foreground"
              type="button"
            >
              <Codicon name="edit" size="0.875rem" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}>{copy.changePhoto}</DropdownMenuItem>
            {identity.avatar && (
              <DropdownMenuItem
                onSelect={() => void changeAgentAvatar(null).catch(error => notifyError(error, copy.saveFailed))}
              >
                {copy.removePhoto}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onPhoto}
          ref={fileRef}
          type="file"
        />
      </div>

      {editing ? (
        <Input
          aria-label={copy.rename}
          autoFocus
          className="h-9 max-w-56 text-center text-lg font-semibold"
          maxLength={64}
          onBlur={commitName}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onNameKey}
          placeholder={copy.namePlaceholder}
          value={draft}
        />
      ) : (
        <button
          aria-label={copy.rename}
          className="group flex max-w-full items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-(--chrome-action-hover)"
          onClick={() => {
            setDraft(identity.name)
            setEditing(true)
          }}
          type="button"
        >
          <span className="scout-page-title truncate text-xl font-bold">{name}</span>
          <Codicon className="opacity-0 transition-opacity group-hover:opacity-60" name="edit" size="0.8rem" />
        </button>
      )}

      <span className="flex items-center gap-1.5 text-xs text-(--ui-text-secondary)">
        <span className={cn('size-2 rounded-full', connected ? 'bg-(--ui-green)' : 'bg-(--ui-text-quaternary)')} />
        {connected ? copy.connected : copy.offline}
      </span>
    </div>
  )
}
