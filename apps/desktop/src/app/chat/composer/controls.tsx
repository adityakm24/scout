import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { ArrowsMaximize, ArrowsMinimize, iconSize } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $hudMode, closeHud, resetHudLayout } from '@/store/hud'

import { ACTIVE_ICON_BTN, GHOST_ICON_BTN, PRIMARY_ICON_BTN } from './control-classes'
import { ModelPill } from './model-pill'
import type { ChatBarState } from './types'

// Re-exported: `context-menu.tsx` and other row neighbours have always reached
// for these here, and the row is where they read as belonging.
export { ACTIVE_ICON_BTN, GHOST_ICON_BTN, ICON_BTN, PRIMARY_ICON_BTN } from './control-classes'

export function ComposerControls({
  busy,
  canSubmit,
  compactModelPill = false,
  disabled,
  expanded = false,
  hasComposerPayload,
  hideModelPill = false,
  minimal = false,
  onToggleExpand,
  state
}: {
  busy: boolean
  busyAction: 'steer' | 'queue' | 'stop'
  canSubmit: boolean
  compactModelPill?: boolean
  disabled: boolean
  expanded?: boolean
  hasComposerPayload: boolean
  hideModelPill?: boolean
  minimal?: boolean
  state: ChatBarState
  onQueue: () => void
  onToggleExpand?: () => void
}) {
  const { t } = useI18n()
  const c = t.composer
  const hudMode = useStore($hudMode)

  // Steer is just send: a payload keeps the Send affordance mid-turn. Stop
  // only when the composer is empty and a turn is running.
  const showStop = busy && !hasComposerPayload
  const showSendOrStop = showStop || hasComposerPayload

  return (
    <div className="flex min-w-0 shrink items-center gap-(--composer-control-gap)">
      {!minimal && !hideModelPill ? (
        <ModelPill compact={compactModelPill} disabled={disabled} model={state.model} />
      ) : null}
      {/* Text expand/collapse toggle when typing */}
      {!minimal && hasComposerPayload && onToggleExpand ? (
        <Tip label={expanded ? c.queueCollapse : c.queueExpand} placement="control">
          <Button
            aria-label={expanded ? c.queueCollapse : c.queueExpand}
            aria-pressed={expanded}
            className={cn(GHOST_ICON_BTN, 'p-0', expanded && ACTIVE_ICON_BTN)}
            disabled={disabled}
            onClick={() => {
              triggerHaptic(expanded ? 'close' : 'open')
              onToggleExpand()
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            {expanded ? <ArrowsMinimize className={iconSize.md} /> : <ArrowsMaximize className={iconSize.md} />}
          </Button>
        </Tip>
      ) : null}
      <Tip
        label={
          showStop ? (
            <TipKeybindLabel actionId="composer.send" text={c.stop} />
          ) : (
            <TipKeybindLabel actionId="composer.send" text={c.send} />
          )
        }
        placement="control"
      >
        <Button
          aria-label={showStop ? c.stop : c.send}
          className={cn(PRIMARY_ICON_BTN, showSendOrStop ? 'scale-105' : 'scale-90')}
          disabled={disabled || !canSubmit}
          size="icon"
          tabIndex={showSendOrStop ? 0 : -1}
          type="submit"
        >
          {showStop ? (
            <span className="block size-3 rounded-[0.2rem] bg-current" />
          ) : (
            <Codicon name="arrow-up" size="1.125rem" />
          )}
        </Button>
      </Tip>
      {/* The way out of HUD mode, riding the controls row rather than floating
          above the bar: it costs no reserved space and sits with the other
          things you can press. */}
      {hudMode ? <HudWindowButtons /> : null}
    </div>
  )
}

function HudWindowButtons() {
  const { t } = useI18n()

  return (
    <>
      <Tip label={t.titlebar.resetHudLayout} placement="toolbar">
        <Button
          aria-label={t.titlebar.resetHudLayout}
          className={cn(GHOST_ICON_BTN, 'p-0')}
          onClick={resetHudLayout}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="discard" size="0.875rem" />
        </Button>
      </Tip>
      <Tip label={t.titlebar.exitHud} placement="toolbar">
        <Button
          aria-label={t.titlebar.exitHud}
          className={cn(GHOST_ICON_BTN, 'p-0')}
          onClick={closeHud}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="screen-normal" size="0.875rem" />
        </Button>
      </Tip>
    </>
  )
}
