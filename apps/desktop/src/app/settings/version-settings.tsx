import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { getStatus } from '@/api/config'
import { checkScoutUpdate } from '@/api/system'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { CheckCircle2, Copy, GitBranch, Info, RefreshCw } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import { $desktopVersion, refreshDesktopVersion } from '@/store/updates'
import type { BackendUpdateCheckResponse, StatusResponse } from '@/types/scout'

/** Settings → Version: Displays the current app & backend version, release date,
 *  git build info, and whether this is the latest version available. */
export function VersionSettings() {
  const desktopVersion = useStore($desktopVersion)
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [updateCheck, setUpdateCheck] = useState<BackendUpdateCheckResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  const loadVersionData = useCallback(async (forceCheck = false) => {
    if (forceCheck) {
      setChecking(true)
      triggerHaptic('selection')
    } else {
      setLoading(true)
    }

    try {
      void refreshDesktopVersion()
      const [statusRes, checkRes] = await Promise.all([
        getStatus().catch(() => null),
        checkScoutUpdate(forceCheck).catch(() => null)
      ])

      if (statusRes) {
        setStatus(statusRes)
      }

      if (checkRes) {
        setUpdateCheck(checkRes)
      }

      if (forceCheck) {
        triggerHaptic('success')
      }
    } catch (error) {
      if (forceCheck) {
        notifyError(error, 'Could not check for updates')
      }
    } finally {
      setLoading(false)
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void loadVersionData(false)
  }, [loadVersionData])

  const appVersion =
    status?.display_version ||
    updateCheck?.current_version ||
    status?.version ||
    desktopVersion?.appVersion ||
    '1.0.0'

  const baseVersion = status?.version || desktopVersion?.appVersion || '1.0.0'
  const releaseDate = status?.release_date || 'Latest Release'
  const gitCommit = status?.git_commit ? status.git_commit.slice(0, 8) : desktopVersion?.gitSha?.slice(0, 8) || null
  const gitBranch = status?.git_branch || desktopVersion?.branch || 'main'
  const installMethod = updateCheck?.install_method || 'git'

  const isUpToDate = updateCheck ? !updateCheck.update_available && (updateCheck.behind === 0 || updateCheck.behind === null) : true
  const behindCount = typeof updateCheck?.behind === 'number' && updateCheck.behind > 0 ? updateCheck.behind : 0

  const copyVersionSummary = async () => {
    const summary = [
      `Scout v${baseVersion} (${appVersion})`,
      gitCommit ? `Commit: ${gitCommit} (${gitBranch})` : null,
      `Release Date: ${releaseDate}`,
      `Status: ${isUpToDate ? 'Latest version' : `${behindCount} commits behind`}`
    ]
      .filter(Boolean)
      .join('\n')

    await navigator.clipboard.writeText(summary)
    triggerHaptic('selection')
    notify({ kind: 'success', message: 'Version info copied to clipboard' })
  }

  const card = 'rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/35'

  return (
    <div className="flex flex-col gap-4">
      {/* Status Banner Card */}
      <div className={`${card} flex flex-col gap-4 px-5 py-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-full ${
                isUpToDate
                  ? 'bg-[#34c759]/15 text-[#34c759] dark:bg-[#30d158]/20 dark:text-[#30d158]'
                  : 'bg-[#007aff]/15 text-[#007aff] dark:bg-[#0a84ff]/20 dark:text-[#409cff]'
              }`}
            >
              {isUpToDate ? <CheckCircle2 className="size-5" /> : <Info className="size-5" />}
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[1rem] font-semibold text-foreground">
                  {loading
                    ? 'Checking version…'
                    : isUpToDate
                      ? 'Scout is up to date'
                      : 'Update available'}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[0.75rem] font-semibold ${
                    isUpToDate
                      ? 'bg-[#34c759]/15 text-[#34c759] dark:bg-[#30d158]/20 dark:text-[#30d158]'
                      : 'bg-[#ff9500]/15 text-[#ff9500] dark:bg-[#ff9f0a]/20 dark:text-[#ffd60a]'
                  }`}
                >
                  {isUpToDate ? 'Latest' : `${behindCount > 0 ? `${behindCount} behind` : 'New version'}`}
                </span>
              </div>
              <span className="text-[0.8125rem] text-(--ui-text-tertiary)">
                {updateCheck?.message ||
                  (isUpToDate
                    ? `You are running the latest version (v${baseVersion}).`
                    : `A newer version is available on ${gitBranch}.`)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              disabled={checking || loading}
              loading={checking}
              onClick={() => void loadVersionData(true)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw className="size-3.5" />
              Check for Updates
            </Button>
            <Button
              aria-label="Copy version details"
              onClick={() => void copyVersionSummary()}
              size="sm"
              type="button"
              variant="outline"
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
        </div>
      </div>

      {/* Version Details Table */}
      <div className={`${card} divide-y divide-(--ui-stroke-tertiary) overflow-hidden`}>
        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
          <span className="text-[0.875rem] font-medium text-foreground">App Version</span>
          <span className="font-mono text-[0.875rem] font-semibold text-foreground">v{baseVersion}</span>
        </div>

        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
          <span className="text-[0.875rem] font-medium text-foreground">Build Identifier</span>
          <span className="font-mono text-[0.8125rem] text-(--ui-text-secondary)">{appVersion}</span>
        </div>

        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
          <span className="text-[0.875rem] font-medium text-foreground">Latest Available Version</span>
          <span className="font-mono text-[0.8125rem] font-medium text-foreground">
            {isUpToDate
              ? `v${baseVersion} (Current)`
              : updateCheck?.commits?.[0]?.sha
                ? `v${baseVersion} (${updateCheck.commits[0].sha})`
                : 'Newer build available'}
          </span>
        </div>

        {gitCommit && (
          <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
            <span className="text-[0.875rem] font-medium text-foreground">Git Commit & Branch</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.8125rem] text-(--ui-text-secondary)">
              <GitBranch className="size-3.5 text-(--ui-text-tertiary)" />
              {gitBranch} @ {gitCommit}
            </span>
          </div>
        )}

        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
          <span className="text-[0.875rem] font-medium text-foreground">Release Date</span>
          <span className="text-[0.8125rem] text-(--ui-text-secondary)">{releaseDate}</span>
        </div>

        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
          <span className="text-[0.875rem] font-medium text-foreground">Install Method</span>
          <span className="rounded-md bg-(--ui-bg-tertiary) px-2 py-0.5 font-mono text-[0.75rem] text-(--ui-text-secondary)">
            {installMethod}
          </span>
        </div>

        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
          <span className="text-[0.875rem] font-medium text-foreground">Gateway Status</span>
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-(--ui-text-secondary)">
            <span
              className={`size-2 rounded-full ${
                status?.gateway_running ? 'bg-[#34c759]' : 'bg-[#ff9500]'
              }`}
            />
            {status?.gateway_running ? 'Connected & Running' : 'Standalone / Ready'}
          </span>
        </div>
      </div>

      {/* Recent Available Commits (if behind) */}
      {updateCheck?.commits && updateCheck.commits.length > 0 && (
        <div className={`${card} flex flex-col gap-2 px-4 py-4`}>
          <h3 className="m-0 text-[0.8125rem] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)">
            Available Updates ({updateCheck.commits.length})
          </h3>
          <div className="divide-y divide-(--ui-stroke-tertiary)">
            {updateCheck.commits.slice(0, 8).map(commit => (
              <div className="flex items-start justify-between gap-3 py-2 text-[0.8125rem]" key={commit.sha}>
                <span className="min-w-0 flex-1 text-foreground">{commit.summary}</span>
                <span className="shrink-0 font-mono text-[0.75rem] text-(--ui-text-tertiary)">{commit.sha}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
