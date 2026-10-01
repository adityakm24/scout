import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { openAgentPanel } from '@/app/agent-panel/open'
import { AgentAvatar } from '@/components/chat/agent-avatar'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { $agentIdentity, agentDisplayName, ensureAgentIdentity } from '@/store/agent-identity'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { $gatewayState, $selectedStoredSessionId, $sessions, sessionMatchesStoredId } from '@/store/session'

/** iMessage-style contact header: the agent's photo and name centred over the conversation.
 *  Clicking it opens the agent panel. The thread clears it through `--thread-identity-clearance`
 *  (motion.css), set only while this header is mounted. */
export function AgentIdentityHeader() {
  const { t } = useI18n()
  const identity = useStore($agentIdentity)
  const profile = useStore($activeGatewayProfile)
  const name = agentDisplayName(identity)
  const selected = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const owner = selected ? sessions.find(row => sessionMatchesStoredId(row, selected))?.profile : undefined

  // Retry once the gateway answers: a read fired while it was still connecting found nothing.
  const gatewayOpen = useStore($gatewayState) === 'open'

  useEffect(ensureAgentIdentity, [profile, gatewayOpen])

  // A chat owned by another profile (a Bot Chat) belongs to a different agent: don't label it
  // with this one's name.
  if (owner && normalizeProfileKey(owner) !== normalizeProfileKey(profile)) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center bg-[color-mix(in_srgb,var(--ui-chat-surface-background)_80%,transparent)] pb-1 pt-1 shadow-[0_1px_0_var(--ui-stroke-quaternary)] backdrop-blur-xl"
      data-slot="agent-identity-header"
    >
      <button
        aria-label={t.agentPanel.openPanel(name)}
        className="group pointer-events-auto flex flex-col items-center gap-0 rounded-2xl px-3 py-0.5 [-webkit-app-region:no-drag]"
        onClick={openAgentPanel}
        type="button"
      >
        <AgentAvatar
          className="size-8 text-[1.15rem] transition-transform duration-300 ease-(--ease-spring) group-hover:scale-105"
          identity={identity}
        />
        <span className="flex items-center gap-0.5 text-[0.6875rem] font-medium text-(--ui-text-secondary) group-hover:text-foreground">
          {name}
          <Codicon className="opacity-60" name="chevron-right" size="0.7rem" />
        </span>
      </button>
    </div>
  )
}
