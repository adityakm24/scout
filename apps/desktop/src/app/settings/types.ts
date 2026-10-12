import type { Dispatch, SetStateAction } from 'react'

import type { IconComponent } from '@/lib/icons'
import type { ScoutGateway } from '@/scout'
import type { EnvVarInfo } from '@/types/scout'

export type SettingsView =
  | 'about'
  | 'connections'
  | 'gateway'
  | 'keybinds'
  | 'keys'
  | 'notifications'
  | 'providers'
  | 'sessions'
  | 'vault'
  | `config:${string}`

export interface SettingsPageProps {
  gateway?: ScoutGateway | null
  onClose: () => void
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
}

export interface ProviderGroup {
  name: string
  priority: number
  entries: [string, EnvVarInfo][]
  hasAnySet: boolean
}

export interface DesktopConfigSection {
  id: string
  label: string
  icon: IconComponent
  keys: string[]
}

export interface EnvRowProps {
  varKey: string
  info: EnvVarInfo
  edits: Record<string, string>
  revealed: Record<string, string>
  saving: string | null
  setEdits: Dispatch<SetStateAction<Record<string, string>>>
  onSave: (key: string, editKey?: string) => void
  onClear: (key: string, editKey?: string) => void
  onReveal: (key: string) => void
  compact?: boolean
}
