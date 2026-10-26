import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import {
  getGoogleWorkspace,
  getUserProfile,
  type GoogleWorkspaceStatus,
  signOutGoogleWorkspace,
  type UserProfileStatus
} from '@/api/google-workspace'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { signInWithGoogle } from '@/lib/google-sign-in'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

export function AccountSettings() {
  const profile = useStore($activeGatewayProfile)
  const [userProfile, setUserProfile] = useState<UserProfileStatus | null>(null)
  const [workspace, setWorkspace] = useState<GoogleWorkspaceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)

  const reload = async () => {
    try {
      const [u, w] = await Promise.all([
        getUserProfile(profile).catch(() => null),
        getGoogleWorkspace(profile).catch(() => null)
      ])
      setUserProfile(u)
      setWorkspace(w)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [profile])

  const handleSignIn = async () => {
    setSigningIn(true)
    const controller = new AbortController()
    try {
      await signInWithGoogle(profile, controller.signal)
      notify({ kind: 'success', message: 'Signed in with Google successfully.' })
      await reload()
    } catch (err) {
      notifyError(err, 'Google sign-in failed.')
    } finally {
      setSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOutGoogleWorkspace(profile)
      notify({ kind: 'success', message: 'Signed out from Google.' })
      await reload()
    } catch (err) {
      notifyError(err, 'Failed to sign out.')
    }
  }

  const card = 'rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35 p-6'

  return (
    <div className="flex max-w-2xl flex-col gap-6 p-6">
      <div className={card}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-(--ui-bg-tertiary) text-xl font-medium text-foreground">
              {userProfile?.name ? userProfile.name.charAt(0).toUpperCase() : <Codicon name="account" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {userProfile?.name || (userProfile?.signed_in ? 'Google User' : 'Not signed in')}
              </h2>
              <p className="text-sm text-(--ui-text-secondary)">
                {userProfile?.email || 'Sign in with your Google account to personalize Scout.'}
              </p>
            </div>
          </div>
          <div>
            {userProfile?.signed_in || workspace?.signed_in ? (
              <Button onClick={() => void handleSignOut()} size="sm" variant="secondary">
                Sign out
              </Button>
            ) : (
              <Button disabled={signingIn || loading} loading={signingIn} onClick={() => void handleSignIn()} size="sm">
                Sign in with Google
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-foreground">Agent Awareness</h3>
        <p className="mt-1 text-xs text-(--ui-text-tertiary)">
          When signed in, Scout automatically populates your profile in the credential vault and synchronizes your identity to the system prompt (`USER.md`) so the agent knows who you are.
        </p>

        {userProfile?.user_md_entries && userProfile.user_md_entries.length > 0 ? (
          <div className="mt-4 rounded-xl border border-(--ui-stroke-tertiary) bg-black/20 p-4 font-mono text-xs text-(--ui-text-secondary)">
            {userProfile.user_md_entries.map((entry, i) => (
              <div className="whitespace-pre-wrap" key={i}>
                {entry}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-xs italic text-(--ui-text-tertiary)">
            No user profile entries recorded yet.
          </p>
        )}
      </div>
    </div>
  )
}
