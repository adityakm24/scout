import { useEffect, useRef, useState } from 'react'

import {
  getGoogleWorkspace,
  type GoogleServiceId,
  type GoogleWorkspaceStatus,
  saveGoogleWorkspaceClient,
  signOutGoogleWorkspace
} from '@/api/google-workspace'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { connectorIconUrl } from '@/lib/connector-tools'
import { signInWithGoogle } from '@/lib/google-sign-in'
import { cn } from '@/lib/utils'
import type { ProfileScope } from '@/scout'
import { notify, notifyError } from '@/store/notifications'

// The vendor-icon slug each service's mark is served under.
const SERVICE_ICON: Record<GoogleServiceId, string> = {
  calendar: 'googlecalendar',
  contacts: 'googlecontacts',
  docs: 'googledocs',
  drive: 'googledrive',
  gmail: 'gmail',
  sheets: 'googlesheets'
}

const SERVICE_ORDER: GoogleServiceId[] = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'contacts']

/** The service's own mark, drawn bare: the chip already frames it. */
function ServiceIcon({ className, id }: { className?: string; id: GoogleServiceId }) {
  return (
    <img
      alt=""
      className={cn('shrink-0 object-contain', className)}
      draggable={false}
      src={connectorIconUrl(SERVICE_ICON[id])}
    />
  )
}

const CLOUD_CONSOLE = 'https://console.cloud.google.com/apis/credentials'

/** Words that should surface this card from the connectors search. */
export const GOOGLE_WORKSPACE_TERMS = [
  'google',
  'workspace',
  'gmail',
  'email',
  'mail',
  'calendar',
  'drive',
  'docs',
  'sheets',
  'contacts'
]

/**
 * One Google sign-in for the google-workspace skill: Gmail, Calendar, Drive, Docs, Sheets and
 * Contacts. Sign in opens Google in the browser and the card turns connected when the browser
 * comes back — no URL to copy. Without a Google OAuth client yet, Set up asks for one first.
 */
export function GoogleWorkspaceCard({ profile }: { profile: ProfileScope }) {
  const { t } = useI18n()
  const copy = t.connectorsPage.googleWorkspace
  const [state, setState] = useState<GoogleWorkspaceStatus | null>(null)
  // Connect waits for the first status read, so it knows whether a client must be added first.
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<'out' | 'signin' | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const attempt = useRef<AbortController | null>(null)

  const refresh = async () => setState(await getGoogleWorkspace(profile))

  useEffect(() => {
    void getGoogleWorkspace(profile)
      .then(setState)
      .catch(() => setState(null))
      .finally(() => setLoaded(true))

    return () => attempt.current?.abort()
  }, [profile])

  const signIn = async () => {
    const controller = new AbortController()
    attempt.current = controller
    setBusy('signin')

    try {
      await signInWithGoogle(profile, controller.signal)
      const next = await getGoogleWorkspace(profile)
      setState(next)
      notify({ kind: 'success', title: copy.signedInTitle, message: copy.signedInMessage(next.account) })
    } catch (err) {
      if (!controller.signal.aborted) {
        notifyError(err, copy.signInFailed)
      }
    } finally {
      attempt.current = null
      setBusy(null)
    }
  }

  const signOut = async () => {
    setBusy('out')

    try {
      setState(await signOutGoogleWorkspace(profile))
    } catch (err) {
      notifyError(err, copy.signOutFailed)
    } finally {
      setBusy(null)
    }
  }

  const signedIn = state?.signed_in === true
  const configured = state?.client_configured === true

  return (
    <div
      className={cn(
        'relative grid gap-3 rounded-lg border p-4',
        signedIn
          ? 'border-(--ui-stroke-quaternary) bg-(--ui-bg-elevated)'
          : 'border-[color-mix(in_srgb,var(--theme-primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-primary)_6%,var(--ui-bg-elevated))]'
      )}
      data-slot="google-workspace-card"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="grid size-11 shrink-0 grid-cols-2 place-items-center gap-0.5 rounded-xl bg-(--ui-bg-quinary) p-1.5"
        >
          {(['gmail', 'calendar', 'drive', 'docs'] as const).map(id => (
            <ServiceIcon className="size-3.5" id={id} key={id} />
          ))}
        </div>

        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className="text-[0.9375rem] font-semibold text-(--ui-text-primary)">{copy.title}</h3>
          <p className="text-[0.72rem] leading-snug text-(--ui-text-secondary)">
            {signedIn && state.account ? copy.signedInAs(state.account) : copy.blurb}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-secondary)">
            <span
              aria-hidden
              className={cn(
                'size-[5px] rounded-full',
                signedIn ? 'bg-(--ui-green)' : busy === 'signin' ? 'bg-(--ui-yellow)' : 'bg-(--ui-text-quaternary)'
              )}
            />
            {signedIn ? copy.connected : busy === 'signin' ? copy.waiting : copy.notConnected}
          </span>

          <span className="flex items-center gap-1.5">
            {busy === 'signin' ? (
              <Button onClick={() => attempt.current?.abort()} size="xs" variant="text">
                {copy.cancel}
              </Button>
            ) : null}

            {signedIn ? (
              <Button
                disabled={busy !== null}
                loading={busy === 'out'}
                onClick={() => void signOut()}
                size="xs"
                variant="outline"
              >
                {copy.disconnect}
              </Button>
            ) : (
              <Button
                disabled={busy !== null || !loaded}
                loading={busy === 'signin'}
                onClick={() => (state && !configured ? setSetupOpen(true) : void signIn())}
                size="xs"
              >
                {copy.connect}
              </Button>
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(state?.services ?? SERVICE_ORDER.map(id => ({ granted: false, id }))).map(service => (
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem]',
              service.granted
                ? 'border-transparent bg-[color-mix(in_srgb,var(--ui-green)_12%,transparent)] text-(--ui-text-primary)'
                : 'border-(--ui-stroke-tertiary) text-(--ui-text-secondary)'
            )}
            key={service.id}
            title={signedIn && !service.granted ? copy.notGranted : undefined}
          >
            <ServiceIcon className="size-3.5" id={service.id} />
            {copy.services[service.id]}
            {service.granted ? <Codicon name="check" size="0.65rem" /> : null}
          </span>
        ))}
      </div>

      <ClientDialog
        onOpenChange={setSetupOpen}
        onSaved={async () => {
          setSetupOpen(false)
          await refresh()
          void signIn()
        }}
        open={setupOpen}
        profile={profile}
      />
    </div>
  )
}

function ClientDialog({
  onOpenChange,
  onSaved,
  open,
  profile
}: {
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
  open: boolean
  profile: ProfileScope
}) {
  const { t } = useI18n()
  const copy = t.connectorsPage.googleWorkspace
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)

    try {
      await saveGoogleWorkspaceClient(profile, clientId, clientSecret)
      setClientSecret('')
      await onSaved()
    } catch (err) {
      notifyError(err, copy.clientSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="min-w-[min(30rem,90vw)]" fitContent>
        <div className="grid gap-4 p-5">
          <div className="grid gap-1.5">
            <DialogTitle className="text-base font-semibold">{copy.clientTitle}</DialogTitle>
            <DialogDescription className="text-sm text-(--ui-text-secondary)">{copy.clientBody}</DialogDescription>
            <Button
              className="justify-self-start"
              onClick={() => void window.scoutDesktop.openExternal(CLOUD_CONSOLE)}
              size="xs"
              variant="text"
            >
              {copy.openConsole}
              <Codicon name="link-external" size="0.7rem" />
            </Button>
          </div>

          <label className="grid gap-1 text-xs font-medium text-(--ui-text-secondary)">
            {copy.clientId}
            <Input
              autoComplete="off"
              onChange={event => setClientId(event.target.value)}
              placeholder="1234-abc.apps.googleusercontent.com"
              value={clientId}
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-(--ui-text-secondary)">
            {copy.clientSecret}
            <Input
              autoComplete="off"
              onChange={event => setClientSecret(event.target.value)}
              type="password"
              value={clientSecret}
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)} size="sm" variant="outline">
              {t.common.cancel}
            </Button>
            <Button
              disabled={!clientId.trim() || !clientSecret.trim()}
              loading={saving}
              onClick={() => void save()}
              size="sm"
            >
              {copy.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
