import { type ChangeEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'

import { getUserProfile } from '@/api/google-workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { AVATAR_MAX_BYTES, avatarDataUrl } from '@/lib/avatar-file'
import { triggerHaptic } from '@/lib/haptics'
import { ChevronLeft, ChevronRight, type IconComponent, Search, Trash2, Upload, Users, X } from '@/lib/icons'
import { readJson, storedString, writeJson } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { notify } from '@/store/notifications'

import { OVERLAY_TOP_CLEARANCE } from '../overlays/overlay-view'

import type { SettingsSearchEntry, SettingsSearchTarget } from './settings-search'
import type { SettingsView } from './types'

const USER_PROFILE_STORAGE_KEY = 'scout.desktop.userProfile'
const LEGACY_USER_NAME_STORAGE_KEY = 'scout.desktop.userName'

interface StoredUserProfile {
  avatar: null | string
  firstName: string
  lastName: string
}

function loadUserProfile(): StoredUserProfile {
  const saved = readJson<Partial<StoredUserProfile>>(USER_PROFILE_STORAGE_KEY)

  if (saved && typeof saved === 'object') {
    return {
      avatar: typeof saved.avatar === 'string' && saved.avatar ? saved.avatar : null,
      firstName: typeof saved.firstName === 'string' ? saved.firstName : 'Scout',
      lastName: typeof saved.lastName === 'string' ? saved.lastName : 'User'
    }
  }

  const legacyName = storedString(LEGACY_USER_NAME_STORAGE_KEY)?.trim()

  if (legacyName) {
    const [first = 'Scout', ...rest] = legacyName.split(/\s+/)

    return {
      avatar: null,
      firstName: first,
      lastName: rest.join(' ')
    }
  }

  return {
    avatar: null,
    firstName: 'Scout',
    lastName: 'User'
  }
}

function formatFullName(firstName: string, lastName: string, fallback: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || fallback
}

export interface SettingsShellItem {
  active: boolean
  icon: IconComponent
  id: SettingsView
  label: string
  onSelect: () => void
}

export interface SettingsShellRow {
  icon: IconComponent
  id: string
  label: string
}

const SECTION_TINT: Record<string, string> = {
  'config:advanced': '#636366',
  'config:appearance': '#5e5ce6',
  'config:browser': '#007aff',
  'config:chat': '#34c759',
  'config:memory': '#af52de',
  'config:safety': '#ff3b30',
  'config:voice': '#ff2d55',
  'config:workspace': '#ff9500',
  keybinds: '#5ac8fa',
  keys: '#eab308',
  models: '#5856d6',
  notifications: '#ff3b30',
  phone: '#34c759',
  vault: '#10b981',
  version: '#007aff'
}

function IconTile({ icon: Icon, id, tile, glyph }: { icon: IconComponent; id: string; tile: string; glyph: string }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.28)]',
        tile
      )}
      style={{ backgroundColor: SECTION_TINT[id] ?? '#8e8e93' }}
    >
      <Icon className={glyph} />
    </span>
  )
}

function UserAvatarCircle({
  avatar,
  name,
  sizeClass,
  iconClass
}: {
  avatar: null | string
  name: string
  sizeClass: string
  iconClass: string
}) {
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-linear-to-br from-[#0a84ff] to-[#5e5ce6] text-white shadow-xs',
        sizeClass
      )}
    >
      {avatar ? <img alt={name} className="size-full object-cover" src={avatar} /> : <Users className={iconClass} />}
    </span>
  )
}

export function SettingsAppleShell({
  active,
  body,
  detail,
  detailTitle,
  items,
  onBack,
  onOpenRow,
  onOpenTarget,
  onSearchChange,
  rows,
  searchInputRef,
  searchQuery,
  searchResults
}: {
  active: SettingsShellItem
  /** A pane whose content is the page itself (Phone), shown under the header card instead of rows. */
  body?: ReactNode
  detail: ReactNode | null
  detailTitle?: string
  items: SettingsShellItem[]
  onBack: () => void
  onOpenRow: (id: string) => void
  onOpenTarget: (target: SettingsSearchTarget) => void
  onSearchChange: (value: string) => void
  rows: SettingsShellRow[]
  searchInputRef: RefObject<HTMLInputElement | null>
  searchQuery: string
  searchResults: SettingsSearchEntry[]
}) {
  const { t } = useI18n()
  const intro = t.settings.paneIntro[active.id] ?? ''
  const searching = searchQuery.trim().length > 0

  const [profile, setProfile] = useState<StoredUserProfile>(loadUserProfile)
  const [profileOpen, setProfileOpen] = useState(false)
  const [draftFirstName, setDraftFirstName] = useState(profile.firstName)
  const [draftLastName, setDraftLastName] = useState(profile.lastName)
  const [draftAvatar, setDraftAvatar] = useState<null | string>(profile.avatar)
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let unmounted = false
    void getUserProfile().then(res => {
      if (unmounted || !res.signed_in || !res.name) return
      const saved = readJson<Partial<StoredUserProfile>>(USER_PROFILE_STORAGE_KEY)
      // If the user hasn't explicitly customized their local desktop profile away from default "Scout User"
      if (!saved || !saved.firstName || (saved.firstName === 'Scout' && saved.lastName === 'User')) {
        const parts = res.name.trim().split(/\s+/)
        const first = parts[0] || 'Scout'
        const last = parts.slice(1).join(' ')
        const updated: StoredUserProfile = {
          avatar: saved?.avatar ?? null,
          firstName: first,
          lastName: last
        }
        setProfile(updated)
        setDraftFirstName(first)
        setDraftLastName(last)
      }
    }).catch(() => {})
    return () => {
      unmounted = true
    }
  }, [])

  const displayName = formatFullName(profile.firstName, profile.lastName, t.settings.accountTitle)
  const draftDisplayName = formatFullName(draftFirstName, draftLastName, t.settings.accountTitle)

  const openProfilePage = () => {
    triggerHaptic('selection')
    onSearchChange('')
    setDraftFirstName(profile.firstName)
    setDraftLastName(profile.lastName)
    setDraftAvatar(profile.avatar)
    setProfileOpen(true)
  }

  const handleCancelProfile = () => {
    triggerHaptic('selection')
    setDraftFirstName(profile.firstName)
    setDraftLastName(profile.lastName)
    setDraftAvatar(profile.avatar)
    setProfileOpen(false)
  }

  const handleSaveProfile = () => {
    const next: StoredUserProfile = {
      avatar: draftAvatar,
      firstName: draftFirstName.trim() || 'Scout',
      lastName: draftLastName.trim()
    }

    setProfile(next)
    writeJson(USER_PROFILE_STORAGE_KEY, next)
    triggerHaptic('success')
    setProfileOpen(false)
  }

  const handlePhotoSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const dataUrl = await avatarDataUrl(file)

    if (!dataUrl || (dataUrl.length * 3) / 4 > AVATAR_MAX_BYTES) {
      notify({
        kind: 'error',
        message: t.agentPanel.photoTooLarge,
        title: t.agentPanel.changePhoto
      })

      return
    }

    triggerHaptic('selection')
    setDraftAvatar(dataUrl)
  }

  return (
    <div
      className="grid h-full min-h-0 flex-1 grid-cols-[15.75rem_minmax(0,1fr)] overflow-hidden max-[47.5rem]:grid-cols-1 max-[47.5rem]:grid-rows-[auto_minmax(0,1fr)]"
      data-overlay-split=""
      data-searching={searching ? '' : undefined}
    >
      <aside
        className={cn(
          'relative z-20 flex min-h-0 flex-col border-r border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background) px-3 pb-3 [-webkit-app-region:no-drag]',
          OVERLAY_TOP_CLEARANCE
        )}
        data-overlay-rail=""
        data-tour="overlay-nav"
      >
        <div
          className="relative mb-3 flex h-11 w-full shrink-0 cursor-text items-center rounded-full bg-(--ui-bg-tertiary) px-4 text-(--ui-text-tertiary) ring-1 ring-(--ui-stroke-tertiary) transition-shadow focus-within:ring-2 focus-within:ring-[#007aff] dark:focus-within:ring-[#0a84ff]"
          data-overlay-search=""
          onClick={() => searchInputRef.current?.focus()}
        >
          <Search className="size-4 shrink-0" />
          <input
            aria-label={t.settings.search.placeholder}
            className="h-full min-w-0 flex-1 appearance-none bg-transparent px-2 text-[0.875rem] text-foreground outline-none placeholder:text-(--ui-text-tertiary)"
            onChange={event => onSearchChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && searchQuery) {
                event.preventDefault()
                event.stopPropagation()
                onSearchChange('')
              }
            }}
            placeholder={t.settings.search.pill}
            ref={searchInputRef}
            type="text"
            value={searchQuery}
          />
          {searchQuery && (
            <button
              aria-label={t.common.close}
              className="grid size-5 shrink-0 place-items-center rounded-full bg-(--ui-text-tertiary)/30 text-foreground transition-colors hover:bg-(--ui-text-tertiary)/50"
              onClick={event => {
                event.stopPropagation()
                triggerHaptic('selection')
                onSearchChange('')
                searchInputRef.current?.focus()
              }}
              type="button"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        <button
          aria-current={profileOpen && !searching ? 'page' : undefined}
          className={cn(
            'mb-3 flex w-full shrink-0 items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-colors',
            profileOpen && !searching
              ? 'bg-[#007aff] text-white shadow-xs dark:bg-[#0a84ff]'
              : 'text-foreground hover:bg-(--chrome-action-hover)'
          )}
          data-overlay-nav-item=""
          data-overlay-profile=""
          onClick={openProfilePage}
          type="button"
        >
          <UserAvatarCircle avatar={profile.avatar} iconClass="size-4" name={displayName} sizeClass="size-9" />
          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold leading-tight">{displayName}</span>
        </button>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto max-[47.5rem]:flex-row max-[47.5rem]:overflow-x-auto">
          {items.map(item => (
            <button
              aria-current={item.active && !profileOpen && !searching ? 'page' : undefined}
              className={cn(
                'flex h-9 w-full shrink-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-[0.8125rem] transition-colors max-[47.5rem]:w-auto',
                item.active && !profileOpen && !searching
                  ? 'bg-[#007aff] font-medium text-white shadow-xs dark:bg-[#0a84ff]'
                  : 'text-foreground hover:bg-(--chrome-action-hover)'
              )}
              data-overlay-nav-item=""
              data-tour={`nav-${item.id}`}
              key={item.id}
              onClick={() => {
                setProfileOpen(false)
                item.onSelect()
              }}
              type="button"
            >
              <IconTile glyph="size-3.5" icon={item.icon} id={item.id} tile="size-[1.55rem] rounded-[0.45rem]" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex min-h-0 flex-col overflow-hidden bg-(--ui-chat-surface-background)" data-overlay-main="">
        {searching ? (
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-8 pb-16', OVERLAY_TOP_CLEARANCE)}>
            <div className="mx-auto w-full max-w-[38rem] pt-2">
              {searchResults.length === 0 ? (
                <p className="py-12 text-center text-[0.8125rem] text-(--ui-text-tertiary)">
                  {t.commandCenter.noResults}
                </p>
              ) : (
                <div className="divide-y divide-(--ui-stroke-tertiary) overflow-hidden rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/40">
                  {searchResults.map(entry => (
                    <button
                      className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-(--chrome-action-hover)"
                      data-overlay-search-result=""
                      key={entry.id}
                      onClick={() => {
                        triggerHaptic('selection')
                        setProfileOpen(false)
                        onOpenTarget(entry.target)
                      }}
                      type="button"
                    >
                      <IconTile
                        glyph="size-3.5"
                        icon={entry.icon}
                        id={entry.target.view}
                        tile="size-6 rounded-[0.4rem]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-medium text-foreground">
                          {entry.label}
                        </span>
                        <span className="block truncate text-[0.75rem] text-(--ui-text-tertiary)">
                          {entry.context}
                          {entry.description ? ` · ${entry.description}` : ''}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-(--ui-text-tertiary)" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : profileOpen ? (
          <>
            <div
              className={cn(
                'relative z-20 flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-6 pb-2.5 [-webkit-app-region:no-drag]',
                OVERLAY_TOP_CLEARANCE
              )}
            >
              <button
                aria-label={t.common.back}
                className="grid size-7 place-items-center rounded-lg text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
                onClick={handleCancelProfile}
                type="button"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="truncate text-[0.9375rem] font-semibold text-foreground">{draftDisplayName}</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16 pt-6">
              <div className="mx-auto w-full max-w-[38rem]">
                <div className="mb-4 flex flex-col items-center rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35 px-6 py-6 text-center">
                  <button
                    aria-label={t.agentPanel.changePhoto}
                    className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]"
                    onClick={() => photoInputRef.current?.click()}
                    type="button"
                  >
                    <UserAvatarCircle
                      avatar={draftAvatar}
                      iconClass="size-9"
                      name={draftDisplayName}
                      sizeClass="size-20 shadow-md transition-opacity group-hover:opacity-90"
                    />
                    <span className="absolute -right-0.5 bottom-0.5 grid size-7 place-items-center rounded-full border-2 border-(--ui-chat-surface-background) bg-[#007aff] text-white shadow-xs transition-transform group-hover:scale-105 dark:bg-[#0a84ff]">
                      <Upload className="size-3.5" />
                    </span>
                  </button>

                  <h1 className="mt-3 text-[1.25rem] font-semibold tracking-tight text-foreground">
                    {draftDisplayName}
                  </h1>

                  <div className="mt-3.5 flex items-center gap-2.5">
                    <Button
                      className="rounded-full bg-[#007aff]/15 px-4 py-1.5 text-[#007aff] shadow-[inset_0_0_0_1px_rgba(0,122,255,0.3)] hover:bg-[#007aff]/25 dark:bg-[#0a84ff]/20 dark:text-[#409cff] dark:shadow-[inset_0_0_0_1px_rgba(10,132,255,0.35)] dark:hover:bg-[#0a84ff]/30"
                      onClick={() => photoInputRef.current?.click()}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      <Upload className="size-3.5" />
                      {t.agentPanel.changePhoto}
                    </Button>
                    {draftAvatar && (
                      <Button
                        className="rounded-full bg-[#ff3b30]/15 px-4 py-1.5 text-[#ff3b30] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.3)] hover:bg-[#ff3b30]/25 dark:bg-[#ff453a]/20 dark:text-[#ff6961] dark:hover:bg-[#ff453a]/30"
                        onClick={() => {
                          triggerHaptic('selection')
                          setDraftAvatar(null)
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="size-3.5" />
                        {t.agentPanel.removePhoto}
                      </Button>
                    )}
                  </div>

                  <input
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={event => void handlePhotoSelect(event)}
                    ref={photoInputRef}
                    type="file"
                  />
                </div>

                <div className="divide-y divide-(--ui-stroke-tertiary) overflow-hidden rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35">
                  <label className="flex min-h-12 items-center justify-between gap-4 px-4 py-2.5">
                    <span className="text-[0.875rem] font-medium text-foreground">First Name</span>
                    <Input
                      autoCapitalize="words"
                      className="w-64 max-w-[60%] rounded-lg"
                      onChange={event => setDraftFirstName(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleSaveProfile()
                        }
                      }}
                      placeholder="First name"
                      value={draftFirstName}
                    />
                  </label>
                  <label className="flex min-h-12 items-center justify-between gap-4 px-4 py-2.5">
                    <span className="text-[0.875rem] font-medium text-foreground">Last Name</span>
                    <Input
                      autoCapitalize="words"
                      className="w-64 max-w-[60%] rounded-lg"
                      onChange={event => setDraftLastName(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleSaveProfile()
                        }
                      }}
                      placeholder="Last name"
                      value={draftLastName}
                    />
                  </label>
                </div>

                <div className="mt-5 flex items-center justify-end gap-2.5">
                  <Button
                    className="rounded-full px-5 py-2"
                    onClick={handleCancelProfile}
                    type="button"
                    variant="outline"
                  >
                    {t.common.cancel}
                  </Button>
                  <Button
                    className="rounded-full px-5 py-2"
                    onClick={handleSaveProfile}
                    type="button"
                    variant="default"
                  >
                    {t.common.save}
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : detail ? (
          <>
            <div
              className={cn(
                'relative z-20 flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-6 pb-2.5 [-webkit-app-region:no-drag]',
                OVERLAY_TOP_CLEARANCE
              )}
            >
              <button
                aria-label={active.label}
                className="grid size-7 place-items-center rounded-lg text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
                onClick={() => {
                  triggerHaptic('selection')
                  onBack()
                }}
                type="button"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="truncate text-[0.9375rem] font-semibold text-foreground">
                {detailTitle ?? active.label}
              </span>
            </div>
            <div className="min-h-0 flex-1" data-overlay-detail="">
              {detail}
            </div>
          </>
        ) : (
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-8 pb-16', OVERLAY_TOP_CLEARANCE)}>
            <div className="mx-auto w-full max-w-[38rem] pt-2">
              <div className="mb-4 flex flex-col items-center rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35 px-6 py-5 text-center">
                <IconTile glyph="size-7" icon={active.icon} id={active.id} tile="size-14 rounded-2xl shadow-xs" />
                <h1 className="mt-2.5 text-[1.25rem] font-semibold tracking-tight text-foreground">{active.label}</h1>
                {intro && (
                  <p className="mt-1 max-w-md text-[0.8125rem] leading-relaxed text-(--ui-text-tertiary)">{intro}</p>
                )}
              </div>
              {body}
              {rows.length > 0 && (
                <div className="divide-y divide-(--ui-stroke-tertiary) overflow-hidden rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35">
                  {rows.map(row => (
                    <button
                      className="flex h-11 w-full items-center gap-3 px-3.5 text-left text-[0.875rem] font-medium text-foreground transition-colors hover:bg-(--chrome-action-hover)"
                      key={row.id}
                      onClick={() => {
                        triggerHaptic('selection')
                        onOpenRow(row.id)
                      }}
                      type="button"
                    >
                      <IconTile glyph="size-3.5" icon={row.icon} id={active.id} tile="size-6 rounded-[0.4rem]" />
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <ChevronRight className="size-4 shrink-0 text-(--ui-text-tertiary)" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
