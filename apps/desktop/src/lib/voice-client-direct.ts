import { type OwnerScope, ownerScoped } from '@/api/client'
import { getApiRequestConnection, getApiRequestProfile, scoutApi } from '@/scout'

/**
 * Client-direct speech: call the active profile's text-to-speech provider
 * straight from the desktop, cutting the audio relay hop through the gateway.
 *
 * The gateway stays the single source of truth for WHICH provider and WHICH
 * credentials to use — `GET /api/audio/voice-config` returns the same
 * resolution the gateway's own relay endpoints would apply (see
 * `tools/voice_client_config.py`). This module only executes the provider
 * call locally. Direction of travel:
 *
 *   gateway → text (already streaming) → provider → speaker
 *
 * Keys live in renderer MEMORY only — never persisted, never logged. A
 * provider that can only run on the gateway host resolves to
 * `{mode:'relay'}` and callers fall back to the existing relay endpoints.
 */

export interface DirectTtsConfig {
  mode: 'direct'
  wire: 'elevenlabs-tts' | 'openai-speech'
  provider: string
  base_url: string
  api_key: string
  model: null | string
  voice: null | string
  speed: null | number
  /** tts.streaming.min_len — shortest first sentence (chars) cut on its own; absent on older backends. */
  min_len?: null | number
  /** Optional tts.openai fields the server forwards verbatim (lang_code, consent_attestation). */
  extra_body?: Record<string, unknown>
}

interface RelayConfig {
  mode: 'relay'
  reason?: string
}

export interface VoiceClientConfig {
  tts: DirectTtsConfig | RelayConfig
}

// ---------------------------------------------------------------------------
// Config fetch + cache. Keyed by (connection, profile) so a profile/backend
// switch never reuses another scope's credentials; TTL'd so a config change
// on the gateway propagates within a minute without a per-utterance fetch.
// ---------------------------------------------------------------------------

const CONFIG_TTL_MS = 60_000

let cached: { key: string; at: number; config: VoiceClientConfig } | null = null
let inflight: { key: string; promise: Promise<null | VoiceClientConfig> } | null = null

// `owner` is the speaking session's (connection, profile) — a Bot chat runs
// on its own profile, on its own gateway; missing halves → the active scope.
function scopeKey(owner?: OwnerScope): string {
  return `${owner?.connectionId || getApiRequestConnection() || 'local'}::${owner?.profile || getApiRequestProfile() || 'default'}`
}

/** Drop cached credentials (used by tests; scope changes rotate the key). */
export function clearVoiceClientConfigCache(): void {
  cached = null
  inflight = null
}

export async function fetchVoiceClientConfig(owner?: OwnerScope): Promise<null | VoiceClientConfig> {
  const key = scopeKey(owner)

  if (cached && cached.key === key && Date.now() - cached.at < CONFIG_TTL_MS) {
    return cached.config
  }

  if (inflight && inflight.key === key) {
    return inflight.promise
  }

  const promise = (async () => {
    try {
      // scoutApi carries connectionScoped(); profileScoped() adds the
      // profile — the same routing every relay audio call uses, so the
      // config comes from the backend the user is actually talking to.
      const response = await scoutApi<{ ok: boolean } & VoiceClientConfig>({
        ...ownerScoped(owner),
        path: '/api/audio/voice-config'
      })

      if (!response?.ok || !response.tts) {
        return null
      }

      const config: VoiceClientConfig = { tts: response.tts }
      cached = { key, at: Date.now(), config }

      return config
    } catch {
      // Older backend without the endpoint / transient failure → relay.
      return null
    } finally {
      inflight = null
    }
  })()

  inflight = { key, promise }

  return promise
}

async function providerErrorText(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')

  try {
    const parsed = JSON.parse(body)
    const detail = parsed?.error?.message ?? parsed?.detail ?? parsed?.error

    if (typeof detail === 'string' && detail) {
      return detail
    }
  } catch {
    // fall through to raw body
  }

  return body.slice(0, 300)
}

// ---------------------------------------------------------------------------
// TTS — text → audio bytes, provider-direct. One call per sentence/segment;
// the playback queue in voice-playback.ts owns ordering and barge-in.
// ---------------------------------------------------------------------------

/** Resolve the profile's TTS config when it is client-callable, else null. */
export async function directTtsConfig(owner?: OwnerScope): Promise<DirectTtsConfig | null> {
  const config = await fetchVoiceClientConfig(owner)

  return config?.tts && config.tts.mode === 'direct' ? config.tts : null
}

/** Synthesize one text segment to audio bytes (mp3). Throws on provider rejection. */
export async function synthesizeSpeechClientDirect(tts: DirectTtsConfig, text: string): Promise<ArrayBuffer> {
  if (tts.wire === 'openai-speech') {
    const body: Record<string, unknown> = {
      ...(tts.extra_body ?? {}),
      model: tts.model,
      voice: tts.voice,
      input: text,
      response_format: 'mp3'
    }

    if (tts.speed && tts.speed !== 1) {
      body.speed = tts.speed
    }

    const response = await fetch(`${tts.base_url.replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tts.api_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`${tts.provider} TTS error (HTTP ${response.status}): ${await providerErrorText(response)}`)
    }

    return response.arrayBuffer()
  }

  if (tts.wire === 'elevenlabs-tts') {
    const response = await fetch(
      `${tts.base_url.replace(/\/+$/, '')}/text-to-speech/${encodeURIComponent(tts.voice || '')}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': tts.api_key,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({ text, model_id: tts.model })
      }
    )

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS error (HTTP ${response.status}): ${await providerErrorText(response)}`)
    }

    return response.arrayBuffer()
  }

  throw new Error(`Unknown TTS wire: ${(tts as { wire?: string }).wire}`)
}
