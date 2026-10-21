import { useStore } from '@nanostores/react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

import { getPhonePairing, type PhonePairing, servePhone } from '@/api/phone'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

const POLL_MS = 4000

/** Settings → Phone: a QR code that pairs the iPhone app with this backend over Tailscale, and the
 *  one step that is missing until it can. */
export function PhoneSettings() {
  const { t } = useI18n()
  const copy = t.settings.phone
  const profile = useStore($activeGatewayProfile)
  const [pairing, setPairing] = useState<null | PhonePairing>(null)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)

  // Re-check while a step is pending: installing or signing in to Tailscale happens outside Scout.
  useEffect(() => {
    let alive = true

    const check = () =>
      void getPhonePairing(profile)
        .then(next => alive && setPairing(next))
        .catch(() => undefined)

    check()
    const timer = window.setInterval(check, POLL_MS)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [profile])

  useEffect(() => {
    if (!pairing?.link) {
      setQr('')

      return
    }

    void QRCode.toDataURL(pairing.link, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then(setQr)
  }, [pairing?.link])

  const makeReachable = async () => {
    setBusy(true)

    try {
      const next = await servePhone(profile)
      setPairing(next)

      if (!next.link && next.error && !next.enable_url) {
        notifyError(new Error(next.error), copy.serveFailed)
      }
    } catch (error) {
      notifyError(error, copy.serveFailed)
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (pairing?.link) {
      await navigator.clipboard.writeText(pairing.link)
      notify({ kind: 'success', message: copy.copied })
    }
  }

  const card = 'rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35'

  if (pairing?.link && qr) {
    return (
      <div className={`${card} flex flex-col items-center gap-4 px-6 py-6 text-center`}>
        <h2 className="m-0 text-[0.9375rem] font-semibold text-foreground">{copy.ready}</h2>
        <img alt={copy.ready} className="size-56 rounded-xl bg-white p-2" src={qr} />
        <p className="m-0 max-w-sm text-[0.8125rem] text-(--ui-text-tertiary)">{copy.scanHint}</p>
        <ol className="m-0 flex flex-col gap-1 pl-0 text-left text-[0.8125rem] text-(--ui-text-secondary)">
          {copy.steps.map((step, index) => (
            <li className="flex gap-2" key={step}>
              <span className="tabular-nums text-(--ui-text-tertiary)">{index + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-2">
          <Button onClick={() => void copyLink()} size="sm" variant="secondary">
            {copy.copyLink}
          </Button>
          <span className="text-[0.75rem] text-(--ui-text-tertiary)">{pairing.host}</span>
        </div>
      </div>
    )
  }

  const messages: Partial<Record<PhonePairing['tailscale'], string>> = {
    missing: copy.missing,
    not_served: copy.notServed,
    signed_out: copy.signedOut
  }

  const message = pairing ? messages[pairing.tailscale] : null
  const enableUrl = pairing?.enable_url?.startsWith('https://login.tailscale.com/') ? pairing.enable_url : null

  return (
    <div className={`${card} flex flex-col items-center gap-4 px-6 py-6 text-center`}>
      {pairing?.error || message ? (
        <p className="m-0 max-w-md text-[0.875rem] leading-relaxed text-(--ui-text-secondary)">
          {pairing?.error || message}
        </p>
      ) : null}
      {enableUrl ? (
        <Button onClick={() => window.open(enableUrl, '_blank', 'noopener')}>{copy.enableServe}</Button>
      ) : null}
      {pairing?.tailscale === 'not_served' ? (
        <Button disabled={busy} onClick={() => void makeReachable()}>
          {copy.reachable}
        </Button>
      ) : pairing?.tailscale === 'missing' ? (
        <Button onClick={() => window.open('https://tailscale.com/download', '_blank', 'noopener')}>
          {copy.getTailscale}
        </Button>
      ) : null}
    </div>
  )
}
