import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { SETTINGS_ROUTE } from '@/app/routes'
import { Codicon } from '@/components/ui/codicon'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { TextTabMeta } from '@/components/ui/text-tab'
import { useI18n } from '@/i18n'
import { Activity, Bell, ChevronLeft, Lock, Monitor, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { IS_PHONE } from '@/platform/phone'
import { ensureAgentIdentity } from '@/store/agent-identity'
import { $activeGatewayProfile } from '@/store/profile'
import { $approvalRequests } from '@/store/prompts'
import { $gatewayState } from '@/store/session'

import { ComputerTab } from './computer-tab'
import { HeartbeatTab } from './heartbeat-tab'
import { IdentityCard } from './identity-card'
import { closeAgentPanel } from './open'
import { PermissionsTab } from './permissions-tab'
import { PersonaTab } from './persona-tab'
import { RequestsTab } from './requests-tab'

type AgentPanelTab = 'computer' | 'heartbeat' | 'permissions' | 'persona' | 'requests'

const TAB_ICONS: Record<AgentPanelTab, typeof Monitor> = {
  persona: Sparkles,
  computer: Monitor,
  heartbeat: Activity,
  permissions: Lock,
  requests: Bell
}

interface PanelTabItem {
  id: AgentPanelTab
  label: string
  meta?: ReactNode
}

/** A phone has no room for five tabs in a row: three tiles above, two below, each an icon over
 *  its label. */
function PhoneTabGrid({
  onChange,
  tabs,
  value
}: {
  onChange: (id: AgentPanelTab) => void
  tabs: PanelTabItem[]
  value: AgentPanelTab
}) {
  return (
    <div className="grid grid-cols-6 gap-2 px-4" role="tablist">
      {tabs.map(({ id, label, meta }, index) => {
        const Icon = TAB_ICONS[id]
        const selected = id === value

        return (
          <button
            aria-selected={selected}
            className={cn(
              'relative flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[0.8125rem] font-medium transition-colors duration-200',
              index < 3 ? 'col-span-2' : 'col-span-3',
              selected
                ? 'bg-(--ui-accent)/15 text-(--ui-accent) ring-1 ring-(--ui-accent)/40'
                : 'bg-(--phone-fill) text-(--ui-text-secondary) active:bg-(--phone-fill)/60'
            )}
            key={id}
            onClick={() => onChange(id)}
            role="tab"
            type="button"
          >
            <Icon size={20} />
            <span className="flex items-center gap-1">
              {label}
              {meta}
            </span>
          </button>
        )
      })}
    </div>
  )
}

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
    computer: () => <ComputerTab key={profile} />,
    heartbeat: () => <HeartbeatTab key={profile} />,
    permissions: () => <PermissionsTab onOpenSettings={() => navigate(SETTINGS_ROUTE)} />,
    requests: () => <RequestsTab key={profile} />
  }

  const tabs: PanelTabItem[] = [
    { id: 'persona', label: copy.tabs.persona },
    { id: 'computer', label: copy.tabs.computer },
    { id: 'heartbeat', label: copy.tabs.heartbeat },
    { id: 'permissions', label: copy.tabs.permissions },
    {
      id: 'requests',
      label: copy.tabs.requests,
      meta: waiting > 0 ? <TextTabMeta className="text-(--theme-primary)">{waiting}</TextTabMeta> : undefined
    }
  ]

  return (
    <aside
      aria-label={copy.title}
      className="@container/agent relative flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-(--ui-sidebar-surface-background)"
      data-slot="agent-panel"
    >
      {IS_PHONE ? (
        // A phone sheet goes back to the conversation from the top left, below the status bar.
        <button className="phone-back phone-sheet-back" onClick={closeAgentPanel} type="button">
          <ChevronLeft className="size-7" stroke={2.25} />
          <span>{t.phone.backToChat}</span>
        </button>
      ) : (
        <button
          aria-label={copy.close}
          className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full text-(--ui-text-tertiary) transition-colors duration-200 hover:bg-(--chrome-action-hover) hover:text-foreground"
          onClick={closeAgentPanel}
          type="button"
        >
          <Codicon name="close" size="0.875rem" />
        </button>
      )}
      <IdentityCard />
      {IS_PHONE ? (
        <PhoneTabGrid onChange={setTab} tabs={tabs} value={tab} />
      ) : (
        // Natural-width labels spread over the row (never truncated); one size down when the panel is narrow.
        <div className="px-4 [&_[role=tab]]:px-2 @max-[27rem]/agent:[&_[role=tab]]:px-1.5 @max-[27rem]/agent:[&_[role=tab]]:text-[0.75rem]">
          <SegmentedTabs
            className="flex w-full justify-between"
            onChange={id => setTab(id as AgentPanelTab)}
            tabs={tabs}
            value={tab}
          />
        </div>
      )}
      <div className="scout-page-enter min-h-0" key={tab}>
        {content[tab]()}
      </div>
    </aside>
  )
}
