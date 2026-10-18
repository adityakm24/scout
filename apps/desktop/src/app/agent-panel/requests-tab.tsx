import { useStore } from '@nanostores/react'

import { sendApproval } from '@/components/assistant-ui/tool/approval'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'
import { $approvalRequests, type ApprovalRequest } from '@/store/prompts'

function Section({ children, empty, title }: { children: React.ReactNode[]; empty: string; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">{title}</h3>
      {children.length ? children : <p className="m-0 text-xs text-(--ui-text-tertiary)">{empty}</p>}
    </section>
  )
}

/** Everything waiting on the user: command approvals from any open chat. */
export function RequestsTab() {
  const { t } = useI18n()
  const copy = t.agentPanel.requests
  const approvals = Object.values(useStore($approvalRequests)).filter((r): r is ApprovalRequest => Boolean(r))

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
    </div>
  )
}
