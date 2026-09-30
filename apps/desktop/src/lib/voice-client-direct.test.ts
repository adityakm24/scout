import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/scout'

import {
  clearVoiceClientConfigCache,
  type DirectTtsConfig,
  fetchVoiceClientConfig,
  synthesizeSpeechClientDirect
} from './voice-client-direct'

const directTts = {
  mode: 'direct',
  wire: 'openai-speech',
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: 'sk-test',
  model: 'gpt-4o-mini-tts',
  voice: 'alloy',
  speed: null
} as const

const relay = { mode: 'relay', reason: 'local provider' } as const

function mockDesktopApi(response: unknown) {
  const api = vi.fn(async (_request: unknown) => response)

  Object.defineProperty(window, 'scoutDesktop', {
    configurable: true,
    value: { api }
  })

  return api
}

describe('fetchVoiceClientConfig', () => {
  beforeEach(() => clearVoiceClientConfigCache())

  afterEach(() => {
    setApiRequestConnection(null)
    setApiRequestProfile(null)
    Reflect.deleteProperty(window, 'scoutDesktop')
    vi.restoreAllMocks()
  })

  it('fetches from /api/audio/voice-config with the ambient scope and caches per scope', async () => {
    const api = mockDesktopApi({ ok: true, tts: directTts })
    setApiRequestConnection('gw-remote')
    setApiRequestProfile('research')

    const first = await fetchVoiceClientConfig()
    const second = await fetchVoiceClientConfig()

    expect(first?.tts).toEqual(directTts)
    expect(second).toBe(first)
    // One fetch — the second call served from the scope cache.
    expect(api).toHaveBeenCalledTimes(1)

    const request = api.mock.calls[0][0] as { connectionId?: string; path: string; profile?: string }
    expect(request.path).toBe('/api/audio/voice-config')
    expect(request.profile).toBe('research')
    // scoutApi carries the ambient registry connection tag — the config
    // must come from the backend the user is talking to.
    expect(request.connectionId).toBe('gw-remote')
  })

  it("a scope switch never reuses another scope's credentials", async () => {
    const api = mockDesktopApi({ ok: true, tts: directTts })
    setApiRequestProfile('alpha')
    await fetchVoiceClientConfig()

    setApiRequestProfile('beta')
    await fetchVoiceClientConfig()

    expect(api).toHaveBeenCalledTimes(2)
  })

  it('resolves null on an older backend without the endpoint', async () => {
    Object.defineProperty(window, 'scoutDesktop', {
      configurable: true,
      value: { api: vi.fn(async () => Promise.reject(new Error('404'))) }
    })

    expect(await fetchVoiceClientConfig()).toBeNull()
  })
})

describe('synthesizeSpeechClientDirect', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const openaiTts: DirectTtsConfig = {
    mode: 'direct',
    wire: 'openai-speech',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk_tts',
    model: 'gpt-4o-mini-tts',
    voice: 'nova',
    speed: null
  }

  it('POSTs the openai speech shape and returns audio bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer

    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const audio = await synthesizeSpeechClientDirect(
      { ...openaiTts, extra_body: { consent_attestation: 'I own this voice' } },
      'Hello there.'
    )

    expect(new Uint8Array(audio)).toEqual(new Uint8Array([1, 2, 3]))

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/audio/speech')

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.model).toBe('gpt-4o-mini-tts')
    expect(body.voice).toBe('nova')
    expect(body.input).toBe('Hello there.')
    expect(body.speed).toBeUndefined()
    // Server-resolved tts.openai extras (consent_attestation for cloned voices) reach the wire.
    expect(body.consent_attestation).toBe('I own this voice')
  })

  it('speaks the elevenlabs tts shape with the voice in the path', async () => {
    const fetchMock = vi.fn(async () => new Response(new ArrayBuffer(4), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await synthesizeSpeechClientDirect(
      {
        ...openaiTts,
        wire: 'elevenlabs-tts',
        provider: 'elevenlabs',
        base_url: 'https://api.elevenlabs.io/v1',
        model: 'eleven_turbo_v2',
        voice: 'voice123'
      },
      'Hi.'
    )

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice123')
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('sk_tts')
  })

  it('throws on provider rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('quota exceeded', { status: 429 }))
    )

    await expect(synthesizeSpeechClientDirect(openaiTts, 'Hi.')).rejects.toThrow(/openai TTS error.*429/)
  })
})

