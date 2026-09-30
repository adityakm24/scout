// The Capabilities Skills-list query key, imported rather than re-spelled so an
// install shows up in the Skills tab.
import { SKILLS_QUERY_KEY } from '@/app/capabilities/skills/skills-data'
import { translateNow } from '@/i18n'
import { queryClient } from '@/lib/query-client'
import { invalidateSlashCompletions } from '@/lib/slash-completion-cache'
import { getActionStatus, installSkillFromHub, type ProfileScope, scanSkillHub } from '@/scout'
import { upsertDesktopActionTask } from '@/store/activity'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'

const POLL_MS = 1200

// An install started under profile A must not report into profile B: the epoch
// bumps on every profile switch, and an install that sees it change abandons
// quietly (its next status poll would hit B's backend and 404).
let _hubProfile: null | string = null
let _hubEpoch = 0

$activeGatewayProfile.subscribe(value => {
  const key = normalizeProfileKey(value)

  if (_hubProfile !== null && _hubProfile !== key) {
    _hubEpoch += 1
  }

  _hubProfile = key
})

/** Install a hub skill (the `scout://skill/install` deep link): spawn the install
 *  action, tail its log into the activity rail until it exits, then refresh the
 *  Skills list and the `/` completions. Rejects on a non-zero exit — a scan-gated
 *  refusal as {@link HubInstallBlockedError} — so the caller can explain it.
 *  `profile` pins the action (and its polling) to that profile's backend. */
export async function installHubSkill(identifier: string, profile?: ProfileScope): Promise<void> {
  const epoch = _hubEpoch
  const switched = () => _hubEpoch !== epoch

  try {
    const started = await installSkillFromHub(identifier, profile)
    let lines: string[] = []
    let exitCode: null | number = null

    for (;;) {
      const status = await getActionStatus(started.name, 200, profile)

      if (switched()) {
        return
      }

      upsertDesktopActionTask(status)
      lines = status.lines

      if (!status.running) {
        exitCode = status.exit_code

        break
      }

      await new Promise(resolve => setTimeout(resolve, POLL_MS))
    }

    void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY })
    // The composer's `/` list caches the command catalog for an hour.
    invalidateSlashCompletions()

    // The last log lines carry the subprocess's actual error.
    if (exitCode !== null && exitCode !== 0) {
      const blocked = parseInstallBlocked(lines)
      const detail = lines.slice(-3).join('\n').trim()

      if (blocked) {
        throw new HubInstallBlockedError(identifier, blocked.findings, blocked.unverified, detail)
      }

      throw new Error(detail || `Action exited with code ${exitCode}`)
    }
  } catch (err) {
    // A profile switch mid-install is an abandonment, not a failure.
    if (switched()) {
      return
    }

    throw err
  }
}

// `scout skills install` exits non-zero when the security scan gate refuses,
// and its printed tail is the only signal the Desktop gets, so parse it into a
// structured failure the toast can explain (tools-runtime-21). `--force` has
// no Desktop route, so the remedy offered is reading the scan, not overriding
// it. Two CLI shapes exist (`scout_cli/skills_hub.py::_scan_block_message`):
//   current: "Not installed: the security scan found 2 high-risk pattern(s) in
//            'org/skill' (listed above). Scout never installs unverified
//            skills with high-risk findings, even with --force. ..."
//            (the "never installs unverified" sentence only appears for a
//            non-official source; otherwise it says "Re-run with --force").
//   legacy:  "Installation blocked: Blocked (community source + caution
//            verdict, 2 findings). Use --force to override."
// The console may wrap the sentence, so whitespace between words is `\s+`.
const INSTALL_BLOCKED_CURRENT_RE =
  /Not installed:\s+the security scan found\s+(?:(?<findings>\d+)\s+)?high-risk\s+pattern/i

const INSTALL_BLOCKED_UNVERIFIED_RE = /never installs\s+unverified/i

const INSTALL_BLOCKED_LEGACY_RE =
  /Installation blocked:.*?\((?<source>[a-z_-]+) source \+ (?<verdict>[a-z_]+) verdict, (?<findings>\d+) findings?\)/i

export function parseInstallBlocked(lines: readonly string[]): { findings: number; unverified: boolean } | null {
  const text = lines.join('\n')
  const current = text.match(INSTALL_BLOCKED_CURRENT_RE)

  if (current?.groups) {
    return {
      findings: current.groups.findings ? Number(current.groups.findings) : 0,
      unverified: INSTALL_BLOCKED_UNVERIFIED_RE.test(text)
    }
  }

  const legacy = text.match(INSTALL_BLOCKED_LEGACY_RE)

  if (!legacy?.groups) {
    return null
  }

  return { findings: Number(legacy.groups.findings), unverified: legacy.groups.source !== 'official' }
}

export class HubInstallBlockedError extends Error {
  constructor(
    readonly identifier: string,
    readonly findings: number,
    readonly unverified: boolean,
    detail: string
  ) {
    super(detail)
    this.name = 'HubInstallBlockedError'
  }
}

/** Toast for a failed hub action: a blocked install explains the scan gate and
 *  offers "View scan"; anything else keeps the generic summary + raw tail. */
export function notifyHubActionFailed(
  err: unknown,
  fallbackTitle: string,
  skillName?: string,
  profile?: ProfileScope
): void {
  if (!(err instanceof HubInstallBlockedError)) {
    notifyError(err, fallbackTitle)

    return
  }

  const name = skillName || err.identifier

  notify({
    kind: 'error',
    title: translateNow('skills.hub.installBlockedTitle', name),
    message: translateNow('skills.hub.installBlockedMessage', err.findings, err.unverified),
    detail: err.message || undefined,
    action: {
      label: translateNow('skills.hub.viewScan'),
      onClick: () =>
        void scanSkillHub(err.identifier, typeof profile === 'object' ? profile?.profile : profile)
          .then(scan =>
            notify({
              kind: 'warning',
              title: translateNow('skills.hub.installBlockedTitle', name),
              message: scan.summary,
              detail: scan.findings.map(f => `${f.severity}: ${f.description}`).join('\n') || undefined
            })
          )
          .catch(scanErr => notifyError(scanErr, translateNow('skills.hub.scanFailed')))
    }
  })
}
