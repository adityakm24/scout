import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'

import { useI18n } from '@/i18n'
import { Bell, Keyboard, KeyRound, Settings2, ShieldLock, Smartphone, Users, Wrench } from '@/lib/icons'
import { isEditableTarget } from '@/lib/keybinds/combo'
import { typeToFocusChar } from '@/lib/keybinds/composer-focus-keys'
import { $commandPaletteOpen } from '@/store/command-palette'
import { $activeConnectionId } from '@/store/connections'
import { $settingsScopeProfile } from '@/store/settings-scope'

import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { OverlayView } from '../overlays/overlay-view'

import { AccountSettings } from './account-settings'
import { AppearanceSettings } from './appearance-settings'
import { ConfigSettings } from './config-settings'
import { SECTIONS } from './constants'
import { KeybindSettings } from './keybind-settings'
import { KeysSettings, type KeysView } from './keys-settings'
import { movedSettingsTabRedirect } from './moved-tabs'
import { NotificationsSettings } from './notifications-settings'
import { PhoneSettings } from './phone-settings'
import { SettingsBreadcrumbContext } from './primitives'
import {
  filterSettingsSearchEntries,
  type SettingsSearchEntry,
  type SettingsSearchTarget,
  settingsSearchTargetQuery
} from './settings-search'
import { SettingsAppleShell } from './settings-shell'
import { settingsSubpageForLegacyLink, settingsSubpageIcon, settingsSubpages } from './subpages'
import type { SettingsPageProps, SettingsView as SettingsViewId } from './types'
import { useSettingsSearchCatalog } from './use-settings-search'
import { vaultOwnerKey, VaultSettings } from './vault-settings'

const SETTINGS_VIEWS: readonly SettingsViewId[] = [
  'account',
  ...SECTIONS.map(s => `config:${s.id}` as SettingsViewId),
  'keybinds',
  'keys',
  'vault',
  'notifications',
  'phone'
]

export function SettingsView({ onClose, onConfigSaved, onMainModelChanged }: SettingsPageProps) {
  const scopeProfile = useStore($settingsScopeProfile)
  const activeConnectionId = useStore($activeConnectionId)
  const { t } = useI18n()
  const navigate = useNavigate()
  const { hash, pathname, search } = useLocation()
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchCatalog = useSettingsSearchCatalog(true)

  // MCP and Plugins moved out of Settings into Capabilities. Keep old
  // `/settings?tab=mcp|plugins` deep links working — `useRouteEnumParam` would
  // silently coerce the unknown tab to the default view otherwise.
  useEffect(() => {
    const redirect = movedSettingsTabRedirect(search)

    if (redirect) {
      navigate(redirect, { replace: true })
    }
  }, [navigate, search])

  const [activeView] = useRouteEnumParam('tab', SETTINGS_VIEWS, 'config:chat' as SettingsViewId)

  const params = new URLSearchParams(search)
  const requestedSubpage = params.get('page')
  const pages = settingsSubpages(activeView)
  const impliedPage = settingsSubpageForLegacyLink(activeView, params)
  const pinnedPage = pages.find(page => page.id === (impliedPage ?? requestedSubpage))?.id
  const needsSubpageRedirect = Boolean(pinnedPage && pinnedPage !== requestedSubpage)
  const subpageSearch = new URLSearchParams(search)

  if (pinnedPage) {
    subpageSearch.set('page', pinnedPage)
  }

  const openSettingsPage = useCallback(
    (view: SettingsViewId, page?: string) => {
      setSearchQuery('')
      const next = new URLSearchParams(search)

      for (const key of [
        'page',
        'field',
        'setting',
        'key',
        'aux',
        'session',
        'kind',
        'label',
        'origin',
        'pview',
        'kview',
        'bview'
      ]) {
        next.delete(key)
      }

      next.set('tab', view)

      if (page) {
        next.set('page', page)
      }

      navigate({ hash, pathname, search: `?${next}` }, { replace: true })
    },
    [hash, navigate, pathname, search]
  )

  const setActiveView = useCallback((view: SettingsViewId) => openSettingsPage(view), [openSettingsPage])

  const keysParam = params.get('kview')
  const keysDetail: KeysView | null = keysParam === 'tools' || keysParam === 'settings' ? keysParam : null

  const openKeysView = useCallback(
    (view: KeysView) => {
      setSearchQuery('')
      const next = new URLSearchParams(search)

      for (const key of ['page', 'field', 'setting', 'key', 'aux', 'session', 'kind', 'label', 'origin']) {
        next.delete(key)
      }

      next.set('tab', 'keys')
      next.set('kview', view)
      navigate({ hash, pathname, search: `?${next}` }, { replace: true })
    },
    [hash, navigate, pathname, search]
  )

  const openSearchTarget = useCallback(
    (target: SettingsSearchTarget) => {
      setSearchQuery('')
      navigate({ hash, pathname, search: `?${settingsSearchTargetQuery(target)}` }, { replace: true })
    },
    [hash, navigate, pathname]
  )

  // Type-to-search: printable keystrokes on the Settings surface (outside any
  // field) focus the sidebar search input and seed it with the character.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ($commandPaletteOpen.get() || isEditableTarget(event.target)) {
        return
      }

      const char = typeToFocusChar(event)

      if (char === null || char === ' ') {
        return
      }

      event.preventDefault()
      setSearchQuery(prev => `${prev}${char}`)
      searchInputRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const shellItems = [
    {
      active: activeView === 'account',
      icon: Users,
      id: 'account' as SettingsViewId,
      label: 'Account & Profile',
      onSelect: () => setActiveView('account')
    },
    ...SECTIONS.flatMap(section => {
      const view = `config:${section.id}` as SettingsViewId

      const entry = {
        active: activeView === view,
        icon: section.icon,
        id: view,
        label: t.settings.sections[section.id] ?? section.label,
        onSelect: () => setActiveView(view)
      }

      // Credential Vault lives beside the Browser section: it feeds the
      // browser's model-blind vault fill, so the two are one mental unit.
      return section.id === 'browser'
        ? [
            entry,
            {
              active: activeView === 'vault',
              icon: ShieldLock,
              id: 'vault' as SettingsViewId,
              label: t.settings.nav.vault,
              onSelect: () => setActiveView('vault')
            }
          ]
        : [entry]
    }),
    {
      active: activeView === 'notifications',
      icon: Bell,
      id: 'notifications' as SettingsViewId,
      label: t.settings.nav.notifications,
      onSelect: () => setActiveView('notifications')
    },
    {
      active: activeView === 'phone',
      icon: Smartphone,
      id: 'phone' as SettingsViewId,
      label: t.settings.nav.phone,
      onSelect: () => setActiveView('phone')
    },
    {
      active: activeView === 'keybinds',
      icon: Keyboard,
      id: 'keybinds' as SettingsViewId,
      label: t.settings.nav.keybinds,
      onSelect: () => setActiveView('keybinds')
    },
    {
      active: activeView === 'keys',
      icon: KeyRound,
      id: 'keys' as SettingsViewId,
      label: t.settings.nav.apiKeys,
      onSelect: () => setActiveView('keys')
    }
  ]

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return []
    }

    const categoryEntries: SettingsSearchEntry[] = shellItems.map(item => ({
      context: t.commandCenter.settings,
      description: t.settings.paneIntro[item.id],
      icon: item.icon,
      id: `category:${item.id}`,
      keywords: [item.label, item.id],
      label: item.label,
      target: { view: item.id }
    }))

    return filterSettingsSearchEntries(
      [
        ...categoryEntries,
        ...searchCatalog.subpageEntries,
        ...searchCatalog.settingEntries,
        ...searchCatalog.configEntries,
        ...searchCatalog.credentialEntries
      ],
      searchQuery
    )
  }, [
    searchCatalog.configEntries,
    searchCatalog.credentialEntries,
    searchCatalog.settingEntries,
    searchCatalog.subpageEntries,
    searchQuery,
    shellItems,
    t
  ])

  const activeItem = shellItems.find(item => item.active) ?? shellItems[0]
  const showDetail = activeView === 'account' ? true : activeView === 'keys' ? keysDetail !== null : Boolean(pinnedPage)

  const rows =
    activeView === 'keys'
      ? [
          { icon: Wrench, id: 'tools', label: t.settings.nav.keysTools },
          { icon: Settings2, id: 'settings', label: t.settings.nav.keysSettings }
        ]
      : pages.map(page => ({
          icon: settingsSubpageIcon(page, activeItem.icon),
          id: page.id,
          label: t.settings.subpages[page.labelKey]
        }))

  const activeRow = rows.find(row => row.id === (activeView === 'keys' ? keysDetail : pinnedPage))

  const detail = needsSubpageRedirect ? (
    <Navigate replace to={{ hash, pathname, search: `?${subpageSearch}` }} />
  ) : activeView === 'account' ? (
    <AccountSettings />
  ) : activeView === 'config:appearance' ? (
    <AppearanceSettings subpage={pinnedPage} />
  ) : activeView === 'keybinds' ? (
    <KeybindSettings subpage={pinnedPage} />
  ) : activeView.startsWith('config:') ? (
    <ConfigSettings
      activeSectionId={activeView.slice('config:'.length)}
      onConfigSaved={onConfigSaved}
      subpage={pinnedPage}
    />
  ) : activeView === 'keys' ? (
    <KeysSettings view={keysDetail ?? 'tools'} />
  ) : activeView === 'notifications' ? (
    <NotificationsSettings subpage={pinnedPage} />
  ) : (
    <VaultSettings key={vaultOwnerKey(activeConnectionId, scopeProfile)} subpage={pinnedPage} />
  )

  return (
    <OverlayView closeLabel={t.settings.closeSettings} onClose={onClose}>
      <SettingsBreadcrumbContext.Provider value>
        <SettingsAppleShell
          active={activeItem}
          body={activeView === 'phone' ? <PhoneSettings /> : undefined}
          detail={showDetail ? detail : null}
          detailTitle={activeRow?.label}
          items={shellItems}
          onBack={() => setActiveView(activeView)}
          onOpenRow={id => {
            if (activeView === 'keys') {
              openKeysView(id as KeysView)

              return
            }

            openSettingsPage(activeView, id)
          }}
          onOpenTarget={openSearchTarget}
          onSearchChange={setSearchQuery}
          rows={rows}
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          searchResults={searchResults}
        />
      </SettingsBreadcrumbContext.Provider>
    </OverlayView>
  )
}

export { SettingsView as SettingsPage }
