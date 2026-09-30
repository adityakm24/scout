import { describe, expect, it, vi } from 'vitest'

import type { SidebarNavItem } from '../types'

import { latestChatActions, latestSidebarActions } from './latest-actions'
import type { ChatActions, SidebarActions } from './types'

function makeChatActions(): ChatActions {
  return {
    onAddContextRef: vi.fn(),
    onAddUrl: vi.fn(),
    onAttachDroppedItems: vi.fn(),
    onAttachImageBlob: vi.fn(),
    onAttachPastedText: vi.fn(),
    onBranchInNewChat: vi.fn(),
    onCancel: vi.fn(),
    onDeleteSelectedSession: vi.fn(),
    onDismissError: vi.fn(),
    onEdit: vi.fn(),
    onPasteClipboardImage: vi.fn(),
    onPickFiles: vi.fn(),
    onPickFolders: vi.fn(),
    onPickImages: vi.fn(),
    onReload: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onRestoreToMessage: vi.fn(),
    onRetryResume: vi.fn(),
    onSteer: vi.fn(),
    onSteerHidden: vi.fn(),
    onSubmit: vi.fn(),
    onThreadMessagesChange: vi.fn(),
    onToggleSelectedPin: vi.fn()
  }
}

function makeSidebarActions(): SidebarActions {
  return {
    onArchiveSession: vi.fn(),
    onBranchSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onLoadMoreMessaging: vi.fn(),
    onLoadMoreSessions: vi.fn(),
    onRetrySessions: vi.fn(),
    onNavigate: vi.fn(),
    onNewSessionInWorkspace: vi.fn(),
    onNewSessionSplit: vi.fn(),
    onResumeSession: vi.fn()
  }
}

describe('latestActions adapters', () => {
  it('forwards every present handler — an optional one the adapter forgets never reaches ChatView', () => {
    const actions = makeChatActions()
    const adapted = latestChatActions(actions)

    for (const key of Object.keys(actions) as (keyof ChatActions)[]) {
      expect(typeof adapted[key], key).toBe('function')
    }
  })

  it('dereferences the latest steer handler from a stable actions object', async () => {
    const staleSteer = vi.fn(async () => false)
    const latestSteer = vi.fn(async () => true)
    const actions = makeChatActions()
    actions.onSteer = staleSteer
    const adapted = latestChatActions(actions)

    actions.onSteer = latestSteer

    await expect(adapted.onSteer('continue in selected session')).resolves.toBe(true)
    expect(staleSteer).not.toHaveBeenCalled()
    expect(latestSteer).toHaveBeenCalledWith('continue in selected session')
  })

  it('dereferences the latest sidebar handler from a stable actions object', () => {
    const staleNavigate = vi.fn()
    const latestNavigate = vi.fn()
    const item = { id: 'settings', icon: vi.fn(), label: 'Settings', route: '/settings' } satisfies SidebarNavItem
    const actions = makeSidebarActions()
    actions.onNavigate = staleNavigate
    const adapted = latestSidebarActions(actions)

    actions.onNavigate = latestNavigate
    adapted.onNavigate(item)

    expect(staleNavigate).not.toHaveBeenCalled()
    expect(latestNavigate).toHaveBeenCalledWith(item)
  })

  // An absent optional handler must stay absent through the adapter. Children
  // gate on PRESENCE, not just invocation: onDismissError renders the dismiss
  // button only when defined, and onRestoreToMessage gates the restore-confirm
  // flow. Wrapping an undefined field in an arrow function makes it
  // unconditionally truthy, which would paint a dead dismiss button.
  it('leaves absent optional handlers undefined instead of always-truthy wrappers', () => {
    const chat = makeChatActions()
    chat.onDismissError = undefined
    chat.onRestoreToMessage = undefined

    const adaptedChat = latestChatActions(chat)

    expect(adaptedChat.onDismissError).toBeUndefined()
    expect(adaptedChat.onRestoreToMessage).toBeUndefined()

    const sidebar = makeSidebarActions()
    sidebar.onLoadMoreMessaging = undefined

    const adaptedSidebar = latestSidebarActions(sidebar)

    expect(adaptedSidebar.onLoadMoreMessaging).toBeUndefined()
  })

  it('still late-binds a PRESENT optional handler to the latest closure', async () => {
    const staleRestore = vi.fn(async () => undefined)
    const latestRestore = vi.fn(async () => undefined)
    const actions = makeChatActions()
    actions.onRestoreToMessage = staleRestore

    const adapted = latestChatActions(actions)

    actions.onRestoreToMessage = latestRestore

    expect(adapted.onRestoreToMessage).toBeTypeOf('function')
    await adapted.onRestoreToMessage!('msg-1')
    expect(latestRestore).toHaveBeenCalledWith('msg-1')
    expect(staleRestore).not.toHaveBeenCalled()
  })
})
