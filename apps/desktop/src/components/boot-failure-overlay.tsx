import { useStore } from '@nanostores/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DialogCloseButton } from '@/components/ui/dialog'
import { DialogPortalContainerContext } from '@/components/ui/dialog-portal-context'
import { ErrorIcon } from '@/components/ui/error-state'
import { LogView } from '@/components/ui/log-view'
import { useI18n } from '@/i18n'
import { FileText, Loader2, RefreshCw } from '@/lib/icons'
import { $desktopBoot } from '@/store/boot'

import { isGatewayHandshakeError, isRemoteReauthError } from './boot-failure-reauth'
import { useQuietRecovery } from './boot-quiet-recovery'

// Recovery surface for a backend that never came up or went away. The app has one hosted
// backend, so the only fixes are waiting for it and retrying; the logs say why it failed.
function BootFailureModal({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const [contentNode, setContentNode] = useState<HTMLDivElement | null>(null)

  return (
    <DialogPrimitive.Root
      onOpenChange={open => {
        if (!open) {
          onDismiss()
        }
      }}
      open
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined} aria-modal="true" asChild ref={setContentNode}>
          <div
            className="fixed inset-0 z-(--z-setup) flex items-center justify-center bg-(--ui-chat-surface-background) p-6"
            // Masks the whole app on boot failure — must stay filled under window
            // glass. Contract: `[data-glass-opaque]` in styles.css.
            data-glass-opaque=""
          >
            <DialogPortalContainerContext.Provider value={contentNode}>{children}</DialogPortalContainerContext.Provider>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function BootFailureOverlay() {
  const boot = useStore($desktopBoot)
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  // Dismissal hides the modal only; a later clear or a different error shows it again.
  const [dismissedError, setDismissedError] = useState<string | null>(null)

  const visible = Boolean(boot.error) && boot.error !== dismissedError && !boot.running

  useEffect(() => {
    setDismissedError(current => (boot.running || current !== boot.error ? null : current))
  }, [boot.error, boot.running])

  useEffect(() => {
    if (!visible) {
      return
    }

    void window.scoutDesktop
      ?.getRecentLogs()
      .then(res => setLogs(res.lines ?? []))
      .catch(() => undefined)
  }, [boot.error, visible])

  const restart = useCallback(async () => {
    await window.scoutDesktop?.retryBackendConnection().catch(() => undefined)
    window.location.reload()
  }, [])

  // A dropped backend usually comes back on its own: reconnect quietly first, and bring up this
  // screen only when it stays down. A rejected session or a handshake that never opens
  // (phone WebSocket 403 while /api/status still answers) can't heal that way.
  const { quiet } = useQuietRecovery(
    Boolean(boot.error) &&
      !boot.running &&
      !isRemoteReauthError(boot.error) &&
      !isGatewayHandshakeError(boot.error),
    restart
  )

  if (!visible) {
    return null
  }

  const copy = t.boot.failure

  if (quiet) {
    return (
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[1300] flex justify-center"
        data-slot="boot-reconnecting"
      >
        <span className="scout-pop-in flex items-center gap-2 rounded-full bg-(--ui-bg-elevated) px-3.5 py-1.5 text-xs text-(--ui-text-secondary) shadow-lg ring-1 ring-(--ui-stroke-tertiary)">
          <Loader2 className="size-3.5 animate-spin" />
          {copy.reconnecting}
        </span>
      </div>
    )
  }

  const retry = async () => {
    setBusy(true)
    await restart()
  }

  return (
    <BootFailureModal onDismiss={() => setDismissedError(boot.error)}>
      <div className="relative w-full max-w-[40rem] overflow-hidden rounded-xl border border-(--stroke-spaceshipresearch) bg-(--ui-chat-bubble-background) shadow-spaceshipresearch">
        <DialogCloseButton />
        <div className="flex items-start gap-3 px-5 py-4 pr-12">
          <ErrorIcon className="mt-0.5" size="1.25rem" />
          <div>
            <DialogPrimitive.Title asChild>
              <h2 className="text-[0.9375rem] font-semibold tracking-tight">{copy.title}</h2>
            </DialogPrimitive.Title>
            <p className="mt-1 text-[0.8125rem] leading-5 text-(--ui-text-tertiary)">{copy.description}</p>
          </div>
        </div>

        <div className="grid gap-4 p-5 pt-0">
          <div
            className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs whitespace-pre-wrap text-destructive"
            data-selectable-text="true"
          >
            {boot.error}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void retry()}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {copy.retry}
            </Button>
            <Button onClick={() => void window.scoutDesktop?.revealLogs().catch(() => undefined)} variant="ghost">
              <FileText />
              {copy.openLogs}
            </Button>
          </div>

          {logs.length > 0 ? (
            <div className="grid gap-2">
              <Button
                className="-ml-2 self-start font-medium"
                onClick={() => setShowLogs(v => !v)}
                size="xs"
                type="button"
                variant="text"
              >
                {showLogs ? copy.hideRecentLogs : copy.showRecentLogs}
              </Button>
              {showLogs ? <LogView className="max-h-48">{logs.slice(-40).join('')}</LogView> : null}
            </div>
          ) : null}
        </div>
      </div>
    </BootFailureModal>
  )
}
