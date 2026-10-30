import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import React, { type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getGlobalModelInfo: vi.fn(),
  getGlobalModelOptions: vi.fn(),
  setMainModelAssignment: vi.fn(),
  config: { model: { provider: 'nebius-token-factory', default: 'nvidia/Nemotron-3_5-Lightning' } },
  envVars: {}
}))

vi.mock('@/api/models', () => ({
  getGlobalModelInfo: mocks.getGlobalModelInfo,
  getGlobalModelOptions: mocks.getGlobalModelOptions
}))

vi.mock('@/components/ui/select', () => {
  const SelectContent = ({ children }: { children: ReactNode }) => <>{children}</>
  const SelectItem = ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>

  return {
    Select: ({
      children,
      onValueChange,
      value
    }: {
      children: ReactNode
      onValueChange: (value: string) => void
      value: string
    }) => {
      const content = React.Children.toArray(children).find(
        (child): child is ReactElement<{ children: ReactNode }> =>
          React.isValidElement(child) && child.type === SelectContent
      )

      return (
        <select aria-label="Provider" onChange={event => onValueChange(event.target.value)} value={value}>
          {content && React.Children.map(content.props.children, child => {
            if (!React.isValidElement<{ children: ReactNode; value: string }>(child) || child.type !== SelectItem) {
              return null
            }

            return <option key={child.props.value} value={child.props.value}>{child.props.children}</option>
          })}
        </select>
      )
    },
    SelectContent,
    SelectItem,
    SelectTrigger: () => null,
    SelectValue: () => null
  }
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      settings: {
        model: {
          provider: 'Provider',
          model: 'Model',
          applying: 'Saving…',
          loadFailed: 'Could not load models'
        },
        config: { autosaveFailed: 'Could not save settings' }
      },
      shell: { modelMenu: { refreshModels: 'Refresh models' } }
    }
  })
}))

vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/scout', () => ({
  revealEnvVar: vi.fn(),
  saveScoutConfig: vi.fn(),
  setEnvVar: vi.fn()
}))
vi.mock('@/store/model-assignment', () => ({
  setMainModelAssignment: mocks.setMainModelAssignment
}))
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))
vi.mock('@/store/settings-scope', () => ({
  $settingsRequestProfile: atom<string | undefined>('default')
}))
vi.mock('../hooks/use-config-record', () => ({
  scoutConfigCacheWriter: () => vi.fn(),
  useScoutConfigRecord: () => ({
    data: mocks.config
  })
}))
vi.mock('./env-credentials', () => ({
  useEnvCredentials: () => ({ vars: mocks.envVars })
}))
vi.mock('./fallback-models-field', () => ({
  FallbackModelsField: () => null
}))

const { ModelSettings } = await import('./model-settings')

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <ModelSettings />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.config.model.default = 'deepseek-ai/DeepSeek-V4.1-Flash-1017'
  mocks.getGlobalModelInfo.mockResolvedValue({
    provider: 'nebius-token-factory',
    model: 'nvidia/Nemotron-3_5-Lightning'
  })
  mocks.getGlobalModelOptions.mockResolvedValue({
    provider: 'nebius-token-factory',
    model: 'nvidia/Nemotron-3_5-Lightning',
    providers: []
  })
  mocks.setMainModelAssignment.mockResolvedValue({
    ok: true,
    provider: 'custom',
    model: 'nvidia/Nemotron-3_5-Lightning'
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ModelSettings provider selection', () => {
  it('offers the supported providers and saves Other as a custom endpoint assignment', async () => {
    renderSettings()

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Model').value).toBe('nvidia/Nemotron-3_5-Lightning')
    })

    const provider = await screen.findByRole('combobox', { name: 'Provider' })
    fireEvent.click(provider)

    for (const label of ['Nebius', 'NVIDIA NIM', 'Mistral', 'Other']) {
      expect(await screen.findByRole('option', { name: label })).toBeTruthy()
    }

    fireEvent.change(provider, { target: { value: 'custom' } })

    const endpoint = await screen.findByLabelText('Endpoint')
    fireEvent.change(endpoint, { target: { value: 'https://models.example.com/v1' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'custom-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & use model' }))

    await waitFor(() => {
      expect(mocks.setMainModelAssignment).toHaveBeenCalledWith(
        {
          provider: 'custom',
          model: 'nvidia/Nemotron-3_5-Lightning',
          base_url: 'https://models.example.com/v1',
          api_key: 'custom-key'
        },
        'default'
      )
    })
  })

  it('requires an endpoint before allowing a custom provider to be saved', async () => {
    renderSettings()

    fireEvent.click(await screen.findByRole('combobox', { name: 'Provider' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Provider' }), { target: { value: 'custom' } })

    expect(await screen.findByLabelText('Endpoint')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save & use model' }).hasAttribute('disabled')).toBe(true)
    expect(mocks.setMainModelAssignment).not.toHaveBeenCalled()
  })
})
