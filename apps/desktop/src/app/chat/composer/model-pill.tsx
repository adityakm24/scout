import { useStore } from '@nanostores/react'
import { useCallback, useState } from 'react'

import { ModelMenuCloseContext } from '@/app/shell/model-catalog-menu'
import { Button } from '@/components/ui/button'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { formatModelPillLabel } from '@/lib/model-status-label'
import { cn } from '@/lib/utils'
import { $currentModelSource } from '@/store/session'

import { useSessionView } from '../session-view'

import { GHOST_ICON_BTN } from './control-classes'
import type { ChatBarState } from './types'

export function ModelPill({
  compact = false,
  disabled,
  model
}: {
  compact?: boolean
  disabled: boolean
  model: ChatBarState['model']
}) {
  const { t } = useI18n()
  const c = t.composer
  const sb = t.shell.statusbar
  const view = useSessionView()
  const fastMode = useStore(view.$fast)
  const effort = useStore(view.$reasoningEffort)
  const modelSource = useStore($currentModelSource)
  const [open, setOpen] = useState(false)
  const closeMenu = useCallback(() => setOpen(false), [])

  // Only the primary surface tracks `$currentModelSource`; a tile's model
  // belongs to its session.
  const pinned = view.kind === 'primary' && modelSource === 'manual' && Boolean(model.model)

  if (model.loading) {
    return (
      <div
        aria-label={c.loadingModel}
        className="flex h-(--composer-control-size) items-center px-2"
        role="status"
      >
        <Skeleton className={cn('h-2.5 rounded-full', compact ? 'w-3' : 'w-20')} />
      </div>
    )
  }

  const label = model.model ? formatModelPillLabel(model.model, { fastMode }) : sb.modelNone
  const providerLabel = model.provider || sb.unknown
  const titleText = model.model
    ? sb.modelTitle(providerLabel, label, effort)
    : sb.openModelPicker

  const pillClass = cn(
    GHOST_ICON_BTN,
    compact
      ? 'w-auto px-1.5 font-normal'
      : 'w-auto max-w-48 gap-1 px-2 text-xs font-medium text-(--ui-text-secondary) hover:text-foreground'
  )

  const content = (
    <>
      {!compact && <span className="truncate">{label}</span>}
      {pinned && !compact && (
        <span
          aria-label={sb.modelPinned}
          className="size-1.5 shrink-0 rounded-full bg-primary/70"
          title={sb.modelPinned}
        />
      )}
      <DisclosureCaret className="size-3 shrink-0 opacity-65" open={open} />
    </>
  )

  if (!model.modelMenuContent) {
    return (
      <Tip label={titleText} placement="control">
        <Button
          aria-label={titleText}
          className={pillClass}
          disabled={disabled || !model.canSwitch}
          size="sm"
          type="button"
          variant="ghost"
        >
          {content}
        </Button>
      </Tip>
    )
  }

  return (
    <DropdownMenu modal={false} onOpenChange={setOpen} open={open}>
      <Tip label={titleText} placement="control">
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={titleText}
            className={pillClass}
            disabled={disabled || !model.canSwitch}
            size="sm"
            type="button"
            variant="ghost"
          >
            {content}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        align="end"
        className="w-72 max-w-[calc(100vw-1.5rem)] p-1"
        onCloseAutoFocus={event => event.preventDefault()}
        side="top"
        sideOffset={8}
      >
        <ModelMenuCloseContext.Provider value={closeMenu}>{model.modelMenuContent}</ModelMenuCloseContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
