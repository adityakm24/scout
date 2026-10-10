import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { openAgentPanel } from '@/app/agent-panel/open'
import { useSessionView } from '@/app/chat/session-view'
import { toolIconName } from '@/components/assistant-ui/tool/fallback-model'
import { toolPresentVerb } from '@/components/assistant-ui/tool/run-summary'
import { ActivityIcon, activityKindFor } from '@/components/chat/activity-icon'
import { AgentAvatar } from '@/components/chat/agent-avatar'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { $agentIdentity, agentDisplayName, ensureAgentIdentity } from '@/store/agent-identity'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { $gatewayState, $selectedStoredSessionId, $sessions, sessionMatchesStoredId } from '@/store/session'
import { sessionDraftingTool } from '@/store/tool-drafting'

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

  // What the agent is doing right now, under its name (a contact's live status): the tool it is
  // calling, or thinking. The line keeps its height when idle so the thread never jumps.
  const view = useSessionView()
  const busy = useStore(view.$busy)
  const runtimeId = useStore(view.$runtimeId)
  const drafting = useStore(useMemo(() => sessionDraftingTool(runtimeId), [runtimeId]))
  const status = busy ? (drafting?.name ? toolPresentVerb(drafting.name) : t.agentPanel.thinking) : ''

  // A chat owned by another profile (a Bot Chat) belongs to a different agent: don't label it
  // with this one's name.
  if (owner && normalizeProfileKey(owner) !== normalizeProfileKey(profile)) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center pb-1 pt-1"
      data-slot="agent-identity-header"
    >
      <button
        aria-label={t.agentPanel.openPanel(name)}
        className="group pointer-events-auto flex flex-col items-center gap-1 rounded-2xl px-3 py-0.5 [-webkit-app-region:no-drag]"
        onClick={openAgentPanel}
        type="button"
      >
        <AgentAvatar
          className="size-8 text-[1.15rem] transition-transform duration-300 ease-(--ease-spring) group-hover:scale-105"
          identity={identity}
        />
        <span className="flex items-center gap-0.5 rounded-full bg-(--ui-bg-tertiary) py-0.5 pl-2.5 pr-1.5 text-[0.6875rem] font-medium text-(--ui-text-secondary) ring-1 ring-(--ui-stroke-quaternary) transition-colors duration-200 group-hover:bg-(--chrome-action-hover) group-hover:text-foreground">
          {name}
          <Codicon className="opacity-60" name="chevron-right" size="0.65rem" />
        </span>
        <span aria-live="polite" className="flex h-3.5 items-center gap-1 text-[0.625rem] text-(--ui-text-tertiary)">
          {status && (
            <span className="scout-pop-in flex items-center gap-1" key={status}>
              <ActivityIcon
                kind={activityKindFor(drafting?.name, drafting?.name ? toolIconName(drafting.name) : undefined)}
                size="0.65rem"
              />
              {status}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}
