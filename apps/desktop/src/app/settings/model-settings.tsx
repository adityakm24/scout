import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { getGlobalModelInfo, getGlobalModelOptions } from '@/api/models'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Brain, RefreshCw } from '@/lib/icons'
import { displayModelName, formatModelPillLabel, providerDisplayName } from '@/lib/model-status-label'
import { cn } from '@/lib/utils'
import { revealEnvVar, saveScoutConfig, setEnvVar } from '@/scout'
import { setMainModelAssignment } from '@/store/model-assignment'
import { notify, notifyError } from '@/store/notifications'
import { $settingsRequestProfile } from '@/store/settings-scope'

import { scoutConfigCacheWriter, useScoutConfigRecord } from '../hooks/use-config-record'

import { CONTROL_TEXT } from './constants'
import { useEnvCredentials } from './env-credentials'
import { FallbackModelsField } from './fallback-models-field'

const MODEL_PROVIDER_OPTIONS = [
  { slug: 'nebius-token-factory', label: 'Nebius' },
  { slug: 'nvidia', label: 'NVIDIA NIM' },
  { slug: 'mistral', label: 'Mistral' },
  { slug: 'custom', label: 'Other' }
] as const

const STANDARD_PROVIDER_SLUGS: Set<string> = new Set(
  MODEL_PROVIDER_OPTIONS.filter(option => option.slug !== 'custom').map(option => option.slug)
)

function providerChoice(provider: string): string {
  return STANDARD_PROVIDER_SLUGS.has(provider) ? provider : 'custom'
}

/** Known dev defaults — pre-fill when switching provider; config.yaml wins when it matches. */
const PROVIDER_HINTS: Record<string, { apiKeyEnv: string; model: string }> = {
  'nebius-token-factory': {
    apiKeyEnv: 'NEBIUS_API_KEY',
    model: 'nvidia/Nemotron-3_5-Lightning'
  },
  nvidia: {
    apiKeyEnv: 'NVIDIA_API_KEY',
    model: 'nvidia/llama-3.1-nemotron-70b-instruct'
  },
  mistral: {
    apiKeyEnv: 'MISTRAL_API_KEY',
    model: 'mistral/codestral-latest'
  }
}

function guessApiKeyEnv(providerSlug: string): string {
  return (
    PROVIDER_HINTS[providerSlug]?.apiKeyEnv ??
    `${providerSlug.replace(/-/g, '_').toUpperCase()}_API_KEY`
  )
}

function modelDefaultForProvider(
  providerSlug: string,
  config: Record<string, unknown> | undefined
): string {
  const modelBlock = config?.model

  if (typeof modelBlock === 'object' && modelBlock && String((modelBlock as Record<string, unknown>).provider) === providerSlug) {
    return String((modelBlock as Record<string, unknown>).default ?? '')
  }

  const providers = config?.providers

  if (typeof providers === 'object' && providers) {
    const entry = (providers as Record<string, Record<string, unknown>>)[providerSlug]

    if (entry?.model) {
      return String(entry.model)
    }
  }

  return PROVIDER_HINTS[providerSlug]?.model ?? ''
}

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
  const { vars } = useEnvCredentials(scopeProfile)

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

  const [draftProvider, setDraftProvider] = useState(() => providerChoice(activeProvider))
  const [draftModel, setDraftModel] = useState(activeModel)
  const [draftEndpoint, setDraftEndpoint] = useState('')
  const [draftApiKey, setDraftApiKey] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState(() => guessApiKeyEnv(providerChoice(activeProvider)))
  const [applying, setApplying] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadProviderDefaults = useCallback(
    async (providerSlug: string) => {
      const slug = providerSlug.trim()

      if (!slug) {
        return
      }

      const modelBlock = typeof configData?.model === 'object' && configData.model
        ? configData.model as Record<string, unknown>
        : undefined

      const configuredProvider = String(modelBlock?.provider ?? '')

      if (slug === 'custom') {
        const existingCustomEndpoint =
          configuredProvider === 'custom' ||
          configuredProvider === 'local' ||
          configuredProvider.startsWith('custom:') ||
          !STANDARD_PROVIDER_SLUGS.has(configuredProvider)

        setApiKeyEnv('')
        setDraftApiKey('')
        setDraftEndpoint(existingCustomEndpoint ? String(modelBlock?.base_url ?? '') : '')
        setDraftModel(prev =>
          configuredProvider === activeProvider
            ? activeModel ||
              modelDefaultForProvider(configuredProvider || slug, configData as Record<string, unknown> | undefined) ||
              prev
            : prev ||
              modelDefaultForProvider(configuredProvider || slug, configData as Record<string, unknown> | undefined)
        )

        return
      }

      const env = guessApiKeyEnv(slug)
      setApiKeyEnv(env)
      setDraftModel(prev => {
        const fromConfig = modelDefaultForProvider(slug, configData as Record<string, unknown> | undefined)

        return slug === activeProvider
          ? activeModel || fromConfig || prev
          : fromConfig || prev
      })

      if (!vars?.[env]?.is_set) {
        setDraftApiKey('')

        return
      }

      try {
        const revealed = await revealEnvVar(env, scopeProfile ?? undefined)
        setDraftApiKey(revealed.value ?? '')
      } catch {
        setDraftApiKey('')
      }
    },
    [activeModel, activeProvider, configData, scopeProfile, vars]
  )

  useEffect(() => {
    const choice = providerChoice(activeProvider)
    setDraftProvider(choice)
    setDraftModel(activeModel)
    setApiKeyEnv(guessApiKeyEnv(choice))
    void loadProviderDefaults(choice)
  }, [activeModel, activeProvider, loadProviderDefaults])

  const applySelection = useCallback(async () => {
    const provider = draftProvider.trim()
    const model = draftModel.trim()
    const isCustom = provider === 'custom'

    if (!provider || !model || (isCustom && !draftEndpoint.trim())) {
      return
    }

    setApplying(true)
    triggerHaptic('selection')

    try {
      if (draftApiKey.trim() && apiKeyEnv) {
        await setEnvVar(apiKeyEnv, draftApiKey.trim(), scopeProfile ?? undefined)
      }

      const res = isCustom
        ? await setMainModelAssignment({
            provider,
            model,
            base_url: draftEndpoint.trim(),
            ...(draftApiKey.trim() ? { api_key: draftApiKey.trim() } : {})
          }, scopeProfile)
        : await setMainModelAssignment({ provider, model }, scopeProfile)

      onMainModelChanged?.(res.provider || provider, res.model || model)
      onConfigSaved?.()

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['model-info'] }),
        queryClient.invalidateQueries({ queryKey: ['model-options'] })
      ])

      triggerHaptic('success')
      notify({
        kind: 'success',
        message: `Using ${displayModelName(res.model || model)} (${providerDisplayName(res.provider || provider)})`
      })
    } catch (err) {
      notifyError(err, m.loadFailed)
    } finally {
      setApplying(false)
    }
  }, [
    apiKeyEnv,
    draftApiKey,
    draftEndpoint,
    draftModel,
    draftProvider,
    m.loadFailed,
    onConfigSaved,
    onMainModelChanged,
    queryClient,
    scopeProfile
  ])

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

  const card = 'rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35'

  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-5 py-4`}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#007aff]/15 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#409cff]">
            <Brain className="size-5" />
          </span>
          <div className="flex flex-col">
            <span className="text-[1rem] font-semibold text-foreground">{formatModelPillLabel(activeModel)}</span>
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

      <div className={`${card} flex flex-col gap-4 px-5 py-4`}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Provider, API key & model</h3>
          <p className="m-0 text-[0.78rem] text-(--ui-text-tertiary)">
            Choose a provider, then edit its model settings.
          </p>
        </div>

        <div className="grid gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{m.provider}</span>
            <Select
              onValueChange={value => {
                setDraftProvider(value)
                void loadProviderDefaults(value)
              }}
              value={draftProvider}
            >
              <SelectTrigger aria-label={m.provider} className={cn('font-mono', CONTROL_TEXT)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_PROVIDER_OPTIONS.map(option => (
                  <SelectItem key={option.slug} value={option.slug}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {draftProvider === 'custom' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">Endpoint</span>
              <Input
                autoComplete="url"
                className={cn('font-mono', CONTROL_TEXT)}
                onChange={event => setDraftEndpoint(event.target.value)}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                type="url"
                value={draftEndpoint}
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">
              API key
              {apiKeyEnv && (
                <span className="ms-1.5 font-mono font-normal text-(--ui-text-tertiary)">({apiKeyEnv})</span>
              )}
            </span>
            <Input
              autoComplete="off"
              className={cn('font-mono', CONTROL_TEXT)}
              onChange={event => setDraftApiKey(event.target.value)}
              placeholder={
                draftProvider === 'custom'
                  ? 'Optional — leave blank to keep saved credentials'
                  : vars?.[apiKeyEnv]?.is_set
                    ? 'Key saved — edit to replace'
                    : 'Paste API key'
              }
              spellCheck={false}
              type="password"
              value={draftApiKey}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{m.model}</span>
            <Input
              className={cn('font-mono', CONTROL_TEXT)}
              onChange={event => setDraftModel(event.target.value)}
              placeholder={
                draftProvider === activeProvider
                  ? activeModel
                  : modelDefaultForProvider(
                      draftProvider,
                      configData as Record<string, unknown> | undefined
                    ) || 'Enter model ID'
              }
              spellCheck={false}
              value={draftModel}
            />
          </label>
        </div>

        <div className="flex justify-end">
          <Button
            disabled={
              applying ||
              !draftProvider.trim() ||
              !draftModel.trim() ||
              (draftProvider === 'custom' && !draftEndpoint.trim())
            }
            loading={applying}
            onClick={() => void applySelection()}
            type="button"
          >
            {applying ? m.applying : 'Save & use model'}
          </Button>
        </div>
      </div>

      <div className={`${card} flex flex-col gap-3 px-5 py-4`}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[0.875rem] font-semibold text-foreground">Fallback models</h3>
          <p className="m-0 text-[0.78rem] text-(--ui-text-tertiary)">
            Backup models tried automatically if the primary provider is rate-limited or unreachable.
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
