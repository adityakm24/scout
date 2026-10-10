import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getCronJobLatest: vi.fn(),
  getCronJobs: vi.fn(),
  instantiateAutomationBlueprint: vi.fn(),
  pauseCronJob: vi.fn(),
  resumeCronJob: vi.fn()
}))

const notifications = vi.hoisted(() => ({ dispatchNativeNotification: vi.fn() }))

vi.mock('@/scout', async importOriginal => ({ ...(await importOriginal<object>()), ...api }))
vi.mock('./native-notifications', () => notifications)

import { $heartbeat, refreshHeartbeat, setHeartbeatEnabled } from './heartbeat'

const job = { enabled: true, id: 'mail', name: 'New email check', schedule: { kind: 'cron' }, script: 'gmail_watch.py' }

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  api.getCronJobs.mockResolvedValue([job])
})

describe('heartbeat', () => {
  it('announces only results newer than the last one seen, never history on first open', async () => {
    api.getCronJobLatest.mockResolvedValue({ at: 100, text: 'DBS: statement ready' })
    await refreshHeartbeat()
    expect(notifications.dispatchNativeNotification).not.toHaveBeenCalled()

    await refreshHeartbeat()
    expect(notifications.dispatchNativeNotification).not.toHaveBeenCalled()

    api.getCronJobLatest.mockResolvedValue({ at: 200, text: 'Mum: dinner Sunday?' })
    await refreshHeartbeat()
    expect(notifications.dispatchNativeNotification).toHaveBeenCalledOnce()
    expect(notifications.dispatchNativeNotification.mock.calls[0][0]).toMatchObject({
      body: 'Mum: dinner Sunday?',
      kind: 'heartbeat',
      title: 'New email check'
    })
  })

  it('switches a check off at once and restores it when the backend refuses', async () => {
    api.getCronJobLatest.mockResolvedValue({ at: null, text: null })
    await refreshHeartbeat()
    api.pauseCronJob.mockRejectedValue(new Error('offline'))

    const pending = setHeartbeatEnabled('mail', false)
    expect($heartbeat.get().items[0].job.enabled).toBe(false)

    await expect(pending).rejects.toThrow('offline')
    expect($heartbeat.get().items[0].job.enabled).toBe(true)
  })
})
