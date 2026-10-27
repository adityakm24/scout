import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { getGlobalModelInfo, getGlobalModelOptions, setGlobalModel } from '@/api/models'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Brain, Check, RefreshCw, Sparkles } from '@/lib/icons'
import { displayModelName, formatModelPillLabel, providerDisplayName } from '@/lib/model-status-label'
import { cn } from '@/lib/utils'
import { saveScoutConfig } from '@/scout'
import { $customModels, withCustomModels } from '@/store/custom-models'
import { notify, notifyError } from '@/store/notifications'
import { $settingsRequestProfile } from '@/store/settings-scope'

import { scoutConfigCacheWriter, useScoutConfigRecord } from '../hooks/use-config-record'

import { CONTROL_TEXT } from './constants'
import { FallbackModelsField } from './fallback-models-field'
import { ModelSelect } from './model-select'

interface QuickPreset {
  provider: string
  providerLabel: string
  model: string
  badge: string
  description: string
}

const FEATURED_PRESETS: readonly QuickPreset[] = [
  {
    provider: 'nebius-token-factory',
    providerLabel: 'Nebius Token Factory',
    model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
    badge: 'DeepSeek V4.1 Flash',
    description: 'DeepSeek-V4.1-Flash-1017 hosted on Nebius Token Factory'
  },
  {
    provider: 'mistral',
    providerLabel: 'Mistral AI',
    model: 'mistral/codestral-latest',
    badge: 'Codestral Latest',
    description: 'Mistral Codestral Latest for fast code & tool execution'
  }
]

export function ModelSettings({
  onConfigSaved,
  onMainModelChanged
}: {
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
}) {
  const { t } = useI18n()
  const m = t.settings.model
  const queryClient = useQueryClient()
  const scopeProfile = useStore($settingsRequestProfile)
  const customModels = useStore($customModels)

  const modelInfoQuery = useQuery({
    queryKey: ['model-info', scopeProfile ?? 'default'],
    queryFn: () => getGlobalModelInfo(scopeProfile)
  })

  const modelOptionsQuery = useQuery({
    queryKey: ['model-options', 'global', scopeProfile ?? 'default'],
    queryFn: () => getGlobalModelOptions({ explicitOnly: true }, scopeProfile)
  })

  const { data: configData } = useScoutConfigRecord(scopeProfile)
  const writeConfigCache = scoutConfigCacheWriter(scopeProfile)

  const providers = withCustomModels(
    (modelOptionsQuery.data?.providers ?? []).filter(provider => provider.slug),
    customModels
  )

  const activeProvider =
    modelInfoQuery.data?.provider ||
    modelOptionsQuery.data?.provider ||
    (typeof configData?.model === 'object' && configData?.model
      ? String((configData.model as Record<string, unknown>).provider ?? '')
      : '') ||
    'mistral'

  const activeModel =
    modelInfoQuery.data?.model ||
    modelOptionsQuery.data?.model ||
    (typeof configData?.model === 'object' && configData?.model
      ? String((configData.model as Record<string, unknown>).default ?? '')
      : typeof configData?.model === 'string'
        ? configData.model
        : '') ||
    'mistral/codestral-latest'

  const [selectedProvider, setSelectedProvider] = useState(activeProvider)
  const [selectedModel, setSelectedModel] = useState(activeModel)
  const [applying, setApplying] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (activeProvider) {
      setSelectedProvider(activeProvider)
    }
  }, [activeProvider])

  useEffect(() => {
    if (activeModel) {
      setSelectedModel(activeModel)
    }
  }, [activeModel])

  const selectedProviderRow = providers.find(p => p.slug === selectedProvider)
  const providerModels = selectedProviderRow?.models ?? []

  const applyModelSelection = useCallback(
    async (provider: string, model: string) => {
      if (!provider || !model) {
        return
      }

      setApplying(true)
      triggerHaptic('selection')

      try {
        const res = await setGlobalModel(provider, model)

        setSelectedProvider(res.provider || provider)
        setSelectedModel(res.model || model)
        onMainModelChanged?.(res.provider || provider, res.model || model)
        onConfigSaved?.()

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['model-info'] }),
          queryClient.invalidateQueries({ queryKey: ['model-options'] })
        ])

        triggerHaptic('success')
        notify({
          kind: 'success',
          message: `Switched default model to ${displayModelName(res.model || model)} (${providerDisplayName(res.provider || provider)})`
        })
      } catch (err) {
        notifyError(err, m.loadFailed)
      } finally {
        setApplying(false)
      }
    },
    [m.loadFailed, onConfigSaved, onMainModelChanged, queryClient]
  )

  const handleRefreshCatalog = async () => {
    setRefreshing(true)
    triggerHaptic('selection')

    try {
      const fresh = await getGlobalModelOptions({ refresh: true, explicitOnly: true }, scopeProfile)
      queryClient.setQueryData(['model-options', 'global', scopeProfile ?? 'default'], fresh)
      await modelInfoQuery.refetch()
      triggerHaptic('success')
    } catch (err) {
      notifyError(err, m.loadFailed)
    } finally {
      setRefreshing(false)
    }
  }

  const handleFallbackChange = async (nextFallbacks: Record<string, unknown>[]) => {
    if (!configData) {
      return
    }

    try {
      const result = await saveScoutConfig({ fallback_providers: nextFallbacks }, scopeProfile)

      if (result.ok) {
        writeConfigCache({ ...configData, fallback_providers: nextFallbacks })
        onConfigSaved?.()
      }
    } catch (err) {
      notifyError(err, t.settings.config.autosaveFailed)
    }
  }

  const hasUnsavedSelection =
    Boolean(selectedProvider && selectedModel) &&
    (selectedProvider !== activeProvider || selectedModel !== activeModel)

  const card = 'rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35'

  return (
    <div className="flex flex-col gap-4">
      {/* Active Model Status Banner */}
      <div className={`${card} flex flex-col gap-4 px-5 py-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#007aff]/15 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#409cff]">
              <Brain className="size-5" />
            </span>
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[1rem] font-semibold text-foreground">
                  {formatModelPillLabel(activeModel)}
                </span>
                <Badge className="text-[0.7rem]" variant="secondary">
                  {selectedProviderRow?.name || providerDisplayName(activeProvider)}
                </Badge>
              </div>
              <span className="font-mono text-[0.75rem] text-(--ui-text-tertiary)">
                {activeProvider} · {activeModel}
              </span>
            </div>
          </div>

          <Button
            disabled={refreshing}
            loading={refreshing}
            onClick={() => void handleRefreshCatalog()}
            size="sm"
            type="button"
            variant="secondary"
          >
            <RefreshCw className="size-3.5" />
            {t.shell.modelMenu.refreshModels}
          </Button>
        </div>
      </div>

      {/* Quick Switch Presets (Nebius Token Factory DeepSeek & Mistral) */}
      <div className={`${card} flex flex-col gap-3 px-5 py-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Quick Switch</h3>
          </div>
          <span className="text-[0.75rem] text-(--ui-text-tertiary)">One-tap switch for active & new chats</span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {FEATURED_PRESETS.map(preset => {
            const isCurrent = activeProvider === preset.provider && activeModel === preset.model

            return (
              <button
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-all',
                  isCurrent
                    ? 'border-primary/60 bg-primary/10 shadow-xs'
                    : 'border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)/50 hover:border-(--ui-stroke-secondary) hover:bg-(--chrome-action-hover)'
                )}
                disabled={applying}
                key={`${preset.provider}:${preset.model}`}
                onClick={() => void applyModelSelection(preset.provider, preset.model)}
                type="button"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-[0.85rem] font-semibold text-foreground">
                    {formatModelPillLabel(preset.model)}
                  </span>
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[0.68rem] font-semibold text-primary">
                      <Check className="size-3" />
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-(--ui-bg-tertiary) px-2 py-0.5 text-[0.68rem] font-medium text-(--ui-text-secondary)">
                      {preset.badge}
                    </span>
                  )}
                </div>
                <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{preset.providerLabel}</span>
                <span className="line-clamp-1 font-mono text-[0.7rem] text-(--ui-text-tertiary)">{preset.model}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom Provider & Model Picker */}
      <div className={`${card} flex flex-col gap-4 px-5 py-4`}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Choose Provider & Model</h3>
          <p className="m-0 text-[0.78rem] text-(--ui-text-tertiary)">
            Select any configured provider (such as Nebius Token Factory or Mistral AI) and pick a model from its catalog or enter a custom model ID.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(11rem,14rem)_1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{m.provider}</span>
            <Select
              onValueChange={nextProvider => {
                setSelectedProvider(nextProvider)
                const nextRow = providers.find(p => p.slug === nextProvider)
                const firstModel = nextRow?.models?.[0] ?? ''
                setSelectedModel(firstModel)
              }}
              value={selectedProvider}
            >
              <SelectTrigger aria-label={m.provider} className={cn('w-full', CONTROL_TEXT)}>
                <SelectValue placeholder={m.provider} />
              </SelectTrigger>
              <SelectContent>
                {providers.map(provider => (
                  <SelectItem key={provider.slug} value={provider.slug}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{m.model}</span>
            <ModelSelect
              aria-label={m.model}
              className="w-full"
              models={providerModels}
              onValueChange={setSelectedModel}
              provider={selectedProviderRow}
              providerSlug={selectedProvider}
              value={selectedModel}
            />
          </div>

          <div className="flex items-end">
            <Button
              disabled={applying || !selectedProvider || !selectedModel || !hasUnsavedSelection}
              loading={applying}
              onClick={() => void applyModelSelection(selectedProvider, selectedModel)}
              size="sm"
              type="button"
            >
              {applying ? m.applying : 'Use Model'}
            </Button>
          </div>
        </div>
      </div>

      {/* Fallback Models Chain */}
      <div className={`${card} flex flex-col gap-3 px-5 py-4`}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Fallback Models</h3>
          <p className="m-0 text-[0.78rem] text-(--ui-text-tertiary)">
            Backup models tried automatically in order if the primary provider is rate-limited or unreachable.
          </p>
        </div>
        <FallbackModelsField
          onChange={next => void handleFallbackChange(next)}
          value={configData?.fallback_providers}
        />
      </div>
    </div>
  )
}
