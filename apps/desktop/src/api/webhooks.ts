import type {
  WebhookCreatePayload,
  WebhookCreateResponse,
  WebhookEnableResponse,
  WebhooksResponse
} from '@/types/scout'

import { profileScoped, scoutApi } from './client'

// -- Webhooks (subscription CRUD) --------------------------------------------
// The webhook receiver is its own gateway platform; subscriptions live in a
// shared JSON store the CLI/dashboard also drive. Enable mutates config and
// best-effort restarts the gateway; subscription changes hot-reload.

export function getWebhooks(): Promise<WebhooksResponse> {
  return scoutApi<WebhooksResponse>({
    ...profileScoped(),
    path: '/api/webhooks'
  })
}

export function enableWebhooks(): Promise<WebhookEnableResponse> {
  return scoutApi<WebhookEnableResponse>({
    ...profileScoped(),
    path: '/api/webhooks/enable',
    method: 'POST'
  })
}

export function createWebhook(body: WebhookCreatePayload): Promise<WebhookCreateResponse> {
  return scoutApi<WebhookCreateResponse>({
    ...profileScoped(),
    path: '/api/webhooks',
    method: 'POST',
    body
  })
}

export function deleteWebhook(name: string): Promise<{ ok: boolean }> {
  return scoutApi<{ ok: boolean }>({
    ...profileScoped(),
    path: `/api/webhooks/${encodeURIComponent(name)}`,
    method: 'DELETE'
  })
}

export function setWebhookEnabled(
  name: string,
  enabled: boolean
): Promise<{ enabled: boolean; name: string; ok: boolean }> {
  return scoutApi<{ enabled: boolean; name: string; ok: boolean }>({
    ...profileScoped(),
    path: `/api/webhooks/${encodeURIComponent(name)}/enabled`,
    method: 'PUT',
    body: { enabled }
  })
}
