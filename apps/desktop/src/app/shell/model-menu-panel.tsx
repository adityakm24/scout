import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { modelOptionsQueryKey, requestModelOptions } from '@/lib/model-options'
import { cn } from '@/lib/utils'

import { dropdownMenuRow, ModelCatalogMenu } from './model-catalog-menu'
import { type ModelMenuHostProps, useModelMenuController } from './use-model-menu-controller'

/**
 * The composer's model menu: the shared `ModelCatalogMenu` bound to the
 * enclosing `SessionView` via `useModelMenuController`, plus a "Refresh models"
 * footer row.
 */
export function ModelMenuPanel(props: ModelMenuHostProps) {
  const { gateway, ownerConnectionId, profile = 'default', requestGateway } = props
  const { t } = useI18n()
  const copy = t.shell.modelMenu
  const queryClient = useQueryClient()
  const { activeSessionId, controller } = useModelMenuController(props)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)

    try {
      const fresh = await requestModelOptions({
        gateway,
        profile,
        refresh: true,
        request: requestGateway,
        sessionId: activeSessionId
      })

      queryClient.setQueryData(modelOptionsQueryKey(profile, activeSessionId, ownerConnectionId), fresh)
    } catch {
      await queryClient.invalidateQueries({
        queryKey: modelOptionsQueryKey(profile, activeSessionId, ownerConnectionId)
      })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <ModelCatalogMenu
      controller={controller}
      footer={
        <DropdownMenuItem
          className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
          disabled={refreshing}
          onSelect={event => {
            event.preventDefault()
            void handleRefresh()
          }}
        >
          <Codicon className={cn(refreshing && 'animate-spin')} name="refresh" size="0.75rem" />
          {copy.refreshModels}
        </DropdownMenuItem>
      }
      gateway={gateway}
      includeMoa
      ownerConnectionId={ownerConnectionId}
      profile={profile}
      request={requestGateway}
      sessionId={activeSessionId}
    />
  )
}
