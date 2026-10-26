import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import {
  getUserProfile,
  type UserProfileStatus
} from '@/api/google-workspace'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { signInWithGoogle } from '@/lib/google-sign-in'
import { readKey, writeKey } from '@/lib/storage'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

const WELCOME_AUTH_DISMISSED_KEY = 'scout-google-auth-welcome-dismissed-v1'

export function GoogleAuthWelcomeDialog() {
  const profile = useStore($activeGatewayProfile)
  const [open, setOpen] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // If dismissed in this client session / machine, do not pop up automatically
    const dismissed = readKey(WELCOME_AUTH_DISMISSED_KEY) === '1'
    if (dismissed) {
      setChecked(true)
      return
    }

    let mounted = true
    void getUserProfile(profile)
      .then((status: UserProfileStatus) => {
        if (!mounted) return
        if (!status?.signed_in) {
          setOpen(true)
        }
      })
      .catch(() => {
        // If query fails, we don't block the user
      })
      .finally(() => {
        if (mounted) setChecked(true)
      })

    return () => {
      mounted = false
    }
  }, [profile])

  const handleDismiss = () => {
    writeKey(WELCOME_AUTH_DISMISSED_KEY, '1')
    setOpen(false)
  }

  const handleSignIn = async () => {
    setSigningIn(true)
    const controller = new AbortController()
    try {
      await signInWithGoogle(profile, controller.signal)
      writeKey(WELCOME_AUTH_DISMISSED_KEY, '1')
      notify({ kind: 'success', message: 'Signed in with Google successfully. User profile updated.' })
      setOpen(false)
    } catch (err) {
      notifyError(err, 'Google sign-in failed.')
    } finally {
      setSigningIn(false)
    }
  }

  if (!checked || !open) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) handleDismiss() }}>
      <DialogContent className="max-w-md p-6 sm:max-w-md">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Codicon className="text-2xl" name="account" />
          </div>

          <DialogTitle className="text-xl font-semibold text-foreground">
            Welcome to Scout
          </DialogTitle>

          <DialogDescription className="mt-2 text-sm text-(--ui-text-secondary)">
            Sign in with your Google account to set up your personal profile. Scout will save your details to personalize your workspace and keep your identity aware across sessions.
          </DialogDescription>

          <div className="mt-6 flex w-full flex-col gap-3">
            <Button
              className="w-full gap-2 font-medium"
              disabled={signingIn}
              onClick={() => void handleSignIn()}
              size="lg"
            >
              <svg className="size-4 shrink-0" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  fill="#EA4335"
                />
              </svg>
              {signingIn ? 'Connecting to Google...' : 'Sign in with Google'}
            </Button>

            <Button
              className="w-full text-(--ui-text-tertiary) hover:text-foreground"
              disabled={signingIn}
              onClick={handleDismiss}
              variant="ghost"
            >
              Continue without signing in
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
