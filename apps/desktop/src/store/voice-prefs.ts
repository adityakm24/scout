import { atom } from 'nanostores'

import { persistBoolean, readKey, storedBoolean } from '@/lib/storage'

// Desktop read-aloud is local; voice.auto_tts belongs to the messaging gateway.
const AUTO_SPEAK_KEY = 'scout.desktop.autoSpeakReplies'
export const $autoSpeakReplies = atom<boolean>(storedBoolean(AUTO_SPEAK_KEY, false))
// Best-effort persistence must not give config refresh authority again.
let autoSpeakChosen = readKey(AUTO_SPEAK_KEY) !== null

/** Migrate the legacy value once without editing the backend configuration. */
export function applyAutoSpeakFromConfig(config: { voice?: { auto_tts?: unknown } | null } | null | undefined) {
  if (config != null && !autoSpeakChosen) {
    void setAutoSpeakReplies(Boolean(config.voice?.auto_tts))
  }
}

/** Persist even an unchanged value, so migrating false is also one-time. */
export async function setAutoSpeakReplies(enabled: boolean): Promise<void> {
  autoSpeakChosen = true
  persistBoolean(AUTO_SPEAK_KEY, enabled)
  $autoSpeakReplies.set(enabled)
}
