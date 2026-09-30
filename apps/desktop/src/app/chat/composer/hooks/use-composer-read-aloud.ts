import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef } from 'react'

import { useI18n } from '@/i18n'
import { chatMessageText } from '@/lib/chat-messages'
import {
  adoptSpokenReplySession,
  assistantTurnKey,
  markAssistantIdSpoken,
  resolveSpokenReply
} from '@/lib/spoken-reply'
import { READ_ALOUD_LEASE, syncTtsLease } from '@/lib/tts-lease'
import { notifyError } from '@/store/notifications'
import { $autoSpeakReplies, setAutoSpeakReplies } from '@/store/voice-prefs'

import { useComposerScope } from '../scope'

import { useAutoSpeakReplies } from './use-auto-speak-replies'

/**
 * "Read replies aloud" for one composer: the toggle, speaking each new reply of
 * THIS composer's transcript (a tile speaks its own, not the primary chat's), and
 * the text-to-speech warm-up lease held while the toggle is on.
 */
export function useComposerReadAloud(sessionId: string | null | undefined) {
  const { t } = useI18n()
  const { $messages } = useComposerScope()
  const previousSessionIdRef = useRef(sessionId)

  // eslint-disable-next-line no-restricted-syntax -- session-id adopt token, not an atom mirror
  useEffect(() => {
    adoptSpokenReplySession(previousSessionIdRef.current, sessionId)
    previousSessionIdRef.current = sessionId
  }, [sessionId])

  /** The latest unspoken reply only — a backlog collapses to the newest. */
  const pendingResponse = () => {
    const messages = $messages.get()
    const last = messages.findLast(m => m.role === 'assistant' && !m.hidden)

    if (!last || last.id === resolveSpokenReply(sessionId, messages)?.id) {
      return null
    }

    const text = chatMessageText(last).trim()

    return text
      ? { id: last.id, pending: Boolean(last.pending), text, turnKey: assistantTurnKey(sessionId, messages, last.id) }
      : null
  }

  const markSpoken = () => {
    const messages = $messages.get()
    const last = messages.findLast(m => m.role === 'assistant' && !m.hidden)

    if (last) {
      markAssistantIdSpoken(sessionId, messages, last.id)
    }
  }

  // Held while the toggle is on (it mirrors voice.auto_tts, so this also warms
  // the engine at startup when the preference is already set).
  const autoSpeakReplies = useStore($autoSpeakReplies)

  useEffect(() => {
    void syncTtsLease(READ_ALOUD_LEASE, autoSpeakReplies)
  }, [autoSpeakReplies])

  useAutoSpeakReplies({
    failureLabel: t.assistant.thread.readAloudFailed,
    markSpoken,
    pendingReply: pendingResponse,
    sessionId
  })

  return useCallback(() => {
    void setAutoSpeakReplies(!$autoSpeakReplies.get()).catch(error =>
      notifyError(error, t.settings.config.autosaveFailed)
    )
  }, [t])
}
