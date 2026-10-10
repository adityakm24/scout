import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { approvePairing, getPairing } from '@/api/messaging'
import { sendApproval } from '@/components/assistant-ui/tool/approval'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import { $approvalRequests, type ApprovalRequest } from '@/store/prompts'
import type { PairingUser } from '@/types/scout'

// Pairing requests arrive from messaging platforms with no push to the desktop.
const PAIRING_POLL_MS = 15_000

function Section({ children, empty, title }: { children: React.ReactNode[]; empty: string; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">{title}</h3>
      {children.length ? children : <p className="m-0 text-xs text-(--ui-text-tertiary)">{empty}</p>}
    </section>
  )
}

/** Everything waiting on the user: command approvals from any open chat, and messaging users
 *  asking to talk to the agent. */
export function RequestsTab() {
  const { t } = useI18n()
  const copy = t.agentPanel.requests
  const profile = useStore($activeGatewayProfile)
  const approvals = Object.values(useStore($approvalRequests)).filter((r): r is ApprovalRequest => Boolean(r))
  const [pending, setPending] = useState<PairingUser[]>([])

  const loadPairing = useCallback(
    () =>
      getPairing(profile).then(
        res => setPending(res.pending ?? []),
        () => setPending([])
      ),
    [profile]
  )

  useEffect(() => {
    void loadPairing()
    const timer = window.setInterval(() => void loadPairing(), PAIRING_POLL_MS)

    return () => window.clearInterval(timer)
  }, [loadPairing])

  const answer = (request: ApprovalRequest, choice: 'deny' | 'once') =>
    void sendApproval(request, choice).catch(error => notifyError(error, t.agentPanel.saveFailed))

  return (
    <div className="flex flex-col gap-5 p-4" data-slot="agent-requests">
      <Section empty={copy.noApprovals} title={copy.approvals}>
        {approvals.map(request => (
          <div
            className="scout-stagger flex flex-col gap-2 rounded-xl border border-(--ui-stroke-quaternary) bg-(--ui-bg-elevated) p-3"
            key={`${request.sessionId}:${request.requestId}`}
          >
            {request.description && <p className="m-0 text-xs text-(--ui-text-secondary)">{request.description}</p>}
            <code className="line-clamp-3 rounded-md bg-(--ui-bg-tertiary) px-2 py-1 font-mono text-[0.75rem] break-all">
              {request.command}
            </code>
            <div className="flex gap-2">
              <Button onClick={() => answer(request, 'once')} size="sm">
                {copy.allow}
              </Button>
              <Button onClick={() => answer(request, 'deny')} size="sm" variant="ghost">
                {copy.deny}
              </Button>
            </div>
          </div>
        ))}
      </Section>

      <Section empty={copy.noPairing} title={copy.pairing}>
        {pending.map(user => (
          <div
            className="scout-stagger flex items-center gap-3 rounded-xl border border-(--ui-stroke-quaternary) bg-(--ui-bg-elevated) p-3"
            key={`${user.platform}:${user.request_id ?? user.user_id}`}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[0.8125rem] font-medium">{user.user_name || user.user_id}</span>
              <span className="text-xs capitalize text-(--ui-text-tertiary)">
                {user.platform} · {copy.waiting(Math.round(user.age_minutes ?? 0))}
              </span>
            </span>
            {user.request_id && (
              <Button
                onClick={() =>
                  void approvePairing(user.platform, user.request_id!, profile).then(loadPairing, error =>
                    notifyError(error, t.agentPanel.saveFailed)
                  )
                }
                size="sm"
              >
                {copy.approve}
              </Button>
            )}
          </div>
        ))}
      </Section>
    </div>
  )
}
