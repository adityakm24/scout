import { useStore } from '@nanostores/react'
import { useCallback, useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  $approvalModes,
  type ApprovalMode,
  type ApprovalModeRequester,
  setApprovalModeForProfile,
  syncApprovalModeForProfile
} from '@/store/approval-mode'
import { requestGatewayForProfile } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

const MODES: readonly ApprovalMode[] = ['manual', 'smart', 'off']

/** When the agent asks before running a command — the same setting as the status bar's ⚡ menu. */
export function PermissionsTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n()
  const copy = t.agentPanel.permissions
  const modeCopy = t.shell.approvalMode
  const profile = useStore($activeGatewayProfile)
  const mode = useStore($approvalModes)[profile.trim() || 'default'] ?? 'smart'

  // Dial the profile this panel shows, not whichever session is focused.
  const request = useCallback<ApprovalModeRequester>(
    (method, params) => requestGatewayForProfile(profile, method, params),
    [profile]
  )

  useEffect(() => {
    void syncApprovalModeForProfile(request, profile).catch(() => undefined)
  }, [profile, request])

  const labels: Record<ApprovalMode, [string, string]> = {
    manual: [modeCopy.manual, modeCopy.manualDescription],
    smart: [modeCopy.smart, modeCopy.smartDescription],
    off: [modeCopy.off, modeCopy.offDescription]
  }

  return (
    <div className="flex flex-col gap-3 p-4" data-slot="agent-permissions">
      <div>
        <h3 className="m-0 text-sm font-semibold text-foreground">{copy.title}</h3>
        <p className="m-0 mt-1 text-xs leading-relaxed text-(--ui-text-secondary)">{copy.body}</p>
      </div>
      <div className="flex flex-col gap-1.5" role="radiogroup">
        {MODES.map(value => {
          const [label, description] = labels[value]
          const active = value === mode

          return (
            <button
              aria-checked={active}
              className={cn(
                'scout-stagger flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                active
                  ? 'border-[color-mix(in_srgb,var(--theme-primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)]'
                  : 'border-(--ui-stroke-quaternary) hover:bg-(--chrome-action-hover)'
              )}
              key={value}
              onClick={() =>
                void setApprovalModeForProfile(request, profile, value).catch(error =>
                  notifyError(error, t.agentPanel.saveFailed)
                )
              }
              role="radio"
              type="button"
            >
              <span
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2',
                  active ? 'border-(--theme-primary)' : 'border-(--ui-stroke-tertiary)'
                )}
              >
                {active && <span className="size-1.5 rounded-full bg-(--theme-primary)" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[0.8125rem] font-medium text-foreground">{label}</span>
                <span className="text-xs leading-snug text-(--ui-text-tertiary)">{description}</span>
              </span>
            </button>
          )
        })}
      </div>
      <Button className="self-start" onClick={onOpenSettings} size="sm" variant="ghost">
        {copy.more}
      </Button>
    </div>
  )
}
