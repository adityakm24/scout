import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { SETTINGS_ROUTE } from '@/app/routes'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { TextTabMeta } from '@/components/ui/text-tab'
import { useI18n } from '@/i18n'
import { ensureAgentIdentity } from '@/store/agent-identity'
import { $activeGatewayProfile } from '@/store/profile'
import { $approvalRequests } from '@/store/prompts'
import { $gatewayState } from '@/store/session'

import { IdentityCard } from './identity-card'
import { PermissionsTab } from './permissions-tab'
import { PersonaTab } from './persona-tab'
import { RequestsTab } from './requests-tab'

type AgentPanelTab = 'permissions' | 'persona' | 'requests'

/** The right-side panel about the agent itself: who it is (name, photo, soul, memories), what
 *  it may do (permissions) and what is waiting on the user (requests). Opened from the chat's
 *  centred name or the titlebar's right-panel toggle. */
export function AgentPanel() {
  const { t } = useI18n()
  const copy = t.agentPanel
  const navigate = useNavigate()
  const profile = useStore($activeGatewayProfile)
  const waiting = Object.values(useStore($approvalRequests)).filter(Boolean).length
  const [tab, setTab] = useState<AgentPanelTab>('persona')

  // Retry once the gateway answers: a read fired while it was still connecting found nothing.
  const gatewayOpen = useStore($gatewayState) === 'open'

  useEffect(ensureAgentIdentity, [profile, gatewayOpen])

  const content: Record<AgentPanelTab, () => ReactNode> = {
    persona: () => <PersonaTab key={profile} />,
    permissions: () => <PermissionsTab onOpenSettings={() => navigate(SETTINGS_ROUTE)} />,
    requests: () => <RequestsTab key={profile} />
  }

  return (
    <aside
      aria-label={copy.title}
      className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-(--ui-sidebar-surface-background)"
      data-slot="agent-panel"
    >
      <IdentityCard />
      <div className="flex justify-center px-4">
        <SegmentedTabs
          onChange={id => setTab(id as AgentPanelTab)}
          tabs={[
            { id: 'persona', label: copy.tabs.persona },
            { id: 'permissions', label: copy.tabs.permissions },
            {
              id: 'requests',
              label: copy.tabs.requests,
              meta: waiting > 0 ? <TextTabMeta className="text-(--theme-primary)">{waiting}</TextTabMeta> : undefined
            }
          ]}
          value={tab}
        />
      </div>
      <div className="scout-page-enter min-h-0" key={tab}>
        {content[tab]()}
      </div>
    </aside>
  )
}
