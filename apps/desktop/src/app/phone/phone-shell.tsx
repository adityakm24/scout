import './phone.css'

import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { DASHBOARD_ROUTE } from '@/app/dashboard/nav'
import { openSession } from '@/app/open-session'
import {
  appViewForPath,
  CAPABILITIES_ROUTE,
  MESSAGING_ROUTE,
  navigateToWorkspacePage,
  NEW_CHAT_ROUTE,
  routePathname,
  routeSessionId,
  SETTINGS_ROUTE
} from '@/app/routes'
import { AgentAvatar } from '@/components/chat/agent-avatar'
import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import {
  ChevronLeft,
  Compose,
  MessageCircle,
  MessageCircleFilled,
  Messages,
  MessagesFilled,
  Search,
  Settings,
  SettingsFilled,
  Sparkles,
  SparklesFilled,
  Sun,
  SunFilled
} from '@/lib/icons'
import { cn } from '@/lib/utils'
import { startPhoneActivity } from '@/platform/phone-activity'
import { $agentIdentity } from '@/store/agent-identity'
import { $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/scout'

/** The Chats list sits over the workspace; a phone app opens on it, like Messages. */
export const $phoneChatsOpen = atom(true)

/** Settings on a phone: its section list first (the desktop's rail), a section's page after a tap. */
export const $phoneSettingsPage = atom(false)

type TabId = 'capabilities' | 'chats' | 'dashboard' | 'messaging' | 'settings'

const TAB_ROUTES: Record<Exclude<TabId, 'chats'>, string> = {
  capabilities: CAPABILITIES_ROUTE,
  dashboard: DASHBOARD_ROUTE,
  messaging: MESSAGING_ROUTE,
  settings: SETTINGS_ROUTE
}

function activeTab(pathname: string, chatsOpen: boolean): null | TabId {
  if (chatsOpen) {
    return 'chats'
  }

  const path = routePathname(pathname)

  return (Object.entries(TAB_ROUTES).find(([, route]) => path === route)?.[0] as TabId | undefined) ?? null
}

/** The phone's chrome around the desktop surfaces: the Chats list and the tab bar on top level
 *  screens, a back/compose header inside a conversation. Mounted instead of the titlebar. */
export function PhoneShell() {
  const { pathname } = useLocation()

  useEffect(startPhoneActivity, [])
  const chatsOpen = useStore($phoneChatsOpen)
  const inChat = !chatsOpen && appViewForPath(pathname) === 'chat'
  const inSettings = !chatsOpen && routePathname(pathname) === SETTINGS_ROUTE

  useSettingsNavigation(inSettings)

  return (
    <>
      {chatsOpen && <PhoneChats />}
      {inSettings && <PhoneSettingsHeader />}
      {inChat ? <PhoneChatHeader /> : <PhoneTabBar active={activeTab(pathname, chatsOpen)} />}
    </>
  )
}

/** Which Settings screen shows: a tap on a section in the list opens its page; arriving from
 *  anywhere but the tab (a "Set up" link to one page) opens that page directly. */
function useSettingsNavigation(inSettings: boolean) {
  const page = useStore($phoneSettingsPage)

  // Runs on arrival only: `inSettings` turning true.
  useEffect(() => {
    if (inSettings && !$settingsFromTab.get()) {
      $phoneSettingsPage.set(true)
    }

    $settingsFromTab.set(false)
  }, [inSettings])

  useEffect(() => {
    document.documentElement.dataset.phoneSettings = page ? 'page' : 'list'
  }, [page])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-overlay-rail] [data-overlay-nav-item]')) {
        $phoneSettingsPage.set(true)
      }
    }

    document.addEventListener('click', onClick)

    return () => document.removeEventListener('click', onClick)
  }, [])
}

/** Set by the Settings tab so its arrival opens the section list, not a page. */
const $settingsFromTab = atom(false)

function PhoneSettingsHeader() {
  const { t } = useI18n()
  const page = useStore($phoneSettingsPage)

  return (
    <header className="phone-settings-header" data-slot="phone-settings-header">
      {page ? (
        <button className="phone-back" onClick={() => $phoneSettingsPage.set(false)} type="button">
          <ChevronLeft className="size-7" stroke={2.25} />
          <span>{t.phone.settings}</span>
        </button>
      ) : (
        <h1 className="phone-inline-title">{t.phone.settings}</h1>
      )}
    </header>
  )
}

function useStartChat() {
  const navigate = useNavigate()

  return () => {
    $phoneChatsOpen.set(false)
    navigate(NEW_CHAT_ROUTE)
  }
}

function PhoneChatHeader() {
  const { t } = useI18n()
  const startChat = useStartChat()

  return (
    <header className="phone-chat-header" data-slot="phone-chat-header">
      <button className="phone-back" onClick={() => $phoneChatsOpen.set(true)} type="button">
        <ChevronLeft className="size-7" stroke={2.25} />
        <span>{t.phone.back}</span>
      </button>
      <button aria-label={t.phone.newChat} className="phone-icon-button" onClick={startChat} type="button">
        <Compose className="size-6" stroke={1.75} />
      </button>
    </header>
  )
}

const TABS: { filled: typeof MessageCircle; icon: typeof MessageCircle; id: TabId }[] = [
  { filled: MessageCircleFilled, icon: MessageCircle, id: 'chats' },
  { filled: SunFilled, icon: Sun, id: 'dashboard' },
  { filled: SparklesFilled, icon: Sparkles, id: 'capabilities' },
  { filled: MessagesFilled, icon: Messages, id: 'messaging' },
  { filled: SettingsFilled, icon: Settings, id: 'settings' }
]

function PhoneTabBar({ active }: { active: null | TabId }) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const select = (id: TabId) => {
    if (id === 'chats') {
      $phoneChatsOpen.set(true)

      return
    }

    $phoneChatsOpen.set(false)

    if (id === 'settings') {
      $settingsFromTab.set(true)
      $phoneSettingsPage.set(false)
      navigate(SETTINGS_ROUTE)
    } else {
      navigateToWorkspacePage(navigate, TAB_ROUTES[id])
    }
  }

  return (
    <nav aria-label={t.phone.chats} className="phone-tab-bar" data-slot="phone-tab-bar">
      {TABS.map(({ filled: Filled, icon: Icon, id }) => {
        const on = active === id

        return (
          <button
            aria-current={on ? 'page' : undefined}
            className={cn('phone-tab', on && 'phone-tab-active')}
            key={id}
            onClick={() => select(id)}
            type="button"
          >
            {on ? <Filled className="size-6.5" /> : <Icon className="size-6.5" stroke={1.6} />}
            <span>{t.phone[id]}</span>
          </button>
        )
      })}
    </nav>
  )
}

const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const yesterday = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** Messages-style row time: the time today, then "Yesterday", the weekday this week, a date. */
export function listTime(seconds: number, now = new Date()): string {
  const date = new Date(seconds * 1000)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.floor((startOfToday - date.getTime()) / 86_400_000) + 1

  if (date.getTime() >= startOfToday) {
    return timeOfDay.format(date)
  }

  if (days === 1) {
    const word = yesterday.format(-1, 'day')

    return word.charAt(0).toUpperCase() + word.slice(1)
  }

  return days < 7 ? weekday.format(date) : shortDate.format(date)
}

function PhoneChats() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const sessions = useStore($sessions)
  const identity = useStore($agentIdentity)
  const startChat = useStartChat()
  const [query, setQuery] = useState('')
  const openId = routeSessionId(routePathname(pathname))

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return sessions
      .filter(session => !session.archived && !session.hidden)
      .filter(session => !needle || `${session.title ?? ''} ${session.preview ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => (b.last_active || b.started_at || 0) - (a.last_active || a.started_at || 0))
  }, [query, sessions])

  const open = (session: SessionInfo) => {
    $phoneChatsOpen.set(false)
    openSession(session.id, navigate)
  }

  return (
    <section aria-label={t.phone.chats} className="phone-chats" data-slot="phone-chats">
      <div className="phone-chats-scroll">
        <div className="phone-chats-toolbar">
          <button aria-label={t.phone.newChat} className="phone-icon-button" onClick={startChat} type="button">
            <Compose className="size-6" stroke={1.75} />
          </button>
        </div>
        <h1 className="phone-large-title">{t.phone.chats}</h1>
        <label className="phone-search">
          <Search className="size-4.5 shrink-0" stroke={2} />
          <input
            aria-label={t.phone.searchChats}
            enterKeyHint="search"
            onChange={event => setQuery(event.target.value)}
            placeholder={t.phone.searchChats}
            type="search"
            value={query}
          />
        </label>

        {rows.length === 0 ? (
          <p className="phone-empty">{query.trim() ? t.phone.noMatches : t.phone.noChats}</p>
        ) : (
          <ul className="phone-chat-list">
            {rows.map(session => (
              <ChatRow
                active={session.id === openId}
                avatar={<AgentAvatar className="size-12 text-[1.6rem]" identity={identity} />}
                key={session.id}
                onOpen={() => open(session)}
                session={session}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The first message under the title, unless the title is just that message cut short. */
export function previewLine(session: Pick<SessionInfo, 'preview' | 'title'>): string {
  // A title is often the first message cut short ("…") or numbered apart from a twin (" #4").
  const title = squash(session.title?.replace(/(…|\s+#\d+)$/u, '') ?? '')
  const preview = session.preview?.trim() ?? ''

  return title && preview && !squash(preview).startsWith(title) ? preview : ''
}

function ChatRow({
  active,
  avatar,
  onOpen,
  session
}: {
  active: boolean
  avatar: ReactNode
  onOpen: () => void
  session: SessionInfo
}) {
  const title = sessionTitle(session)
  const preview = previewLine(session)
  const stamp = session.last_active || session.started_at

  return (
    <li>
      <button className={cn('phone-chat-row', active && 'phone-chat-row-active')} onClick={onOpen} type="button">
        <span aria-hidden="true" className={cn('phone-unread', session.unread && 'phone-unread-on')} />
        {avatar}
        <span className="phone-chat-row-text">
          <span className="phone-chat-row-top">
            <span className="phone-chat-row-title">{title}</span>
            {stamp ? <span className="phone-chat-row-time">{listTime(stamp)}</span> : null}
          </span>
          {preview ? <span className="phone-chat-row-preview">{preview}</span> : null}
        </span>
      </button>
    </li>
  )
}
