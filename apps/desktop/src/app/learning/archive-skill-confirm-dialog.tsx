import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { type Translations, useI18n } from '@/i18n'
import { deleteLearningNode, type ProfileScope } from '@/scout'
import { notify } from '@/store/notifications'

export const ARCHIVE_SKILL_DESCRIPTION = 'The skill is archived and can be restored with `scout curator restore`.'

export function notifySkillArchived(t: Translations): void {
  notify({ kind: 'success', message: t.skills.skillArchivedMessage, title: t.skills.skillArchivedTitle })
}

export async function archiveLearningSkill(id: string, profile?: ProfileScope): Promise<void> {
  const res = await deleteLearningNode(id, profile)

  if (!res.ok) {
    throw new Error(res.message || 'Archive failed')
  }
}

/** Fire-and-forget a mutation whose UI already applied optimistically; a failure just rolls it back + reports. */
export function fireOptimistic(action: Promise<void>, rollback: () => void, onFailure: (err: unknown) => void): void {
  void action.catch(err => {
    rollback()
    onFailure(err)
  })
}

interface ArchiveSkillConfirmDialogProps {
  /** Apply optimistic UI updates; return rollback if the background archive fails. */
  onApply: () => () => void
  onClose: () => void
  onFailure?: (err: unknown, skillName: string) => void
  onSuccess?: () => void
  open: boolean
  /** Capabilities profile-scope override — archive against THIS profile's
   *  backend; undefined/null keeps the app-wide active profile. */
  profile?: ProfileScope
  skillId: string
  skillName: string
  /** Capabilities says Delete (the user's word for it); the star map keeps Archive. Same restorable archive. */
  verb?: 'archive' | 'delete'
}

/** Shared archive confirm for learned skills (capabilities page + memory graph). */
export function ArchiveSkillConfirmDialog({
  onApply,
  onClose,
  onFailure,
  onSuccess,
  open,
  profile,
  skillId,
  skillName,
  verb
}: ArchiveSkillConfirmDialogProps) {
  const { t } = useI18n()
  const deleting = verb === 'delete'

  return (
    <ConfirmDialog
      confirmLabel={deleting ? t.common.delete : 'Archive'}
      description={deleting ? t.skills.deleteBody : ARCHIVE_SKILL_DESCRIPTION}
      destructive
      dismissOnConfirm
      onClose={onClose}
      onConfirm={() => {
        const rollback = onApply()

        fireOptimistic(
          archiveLearningSkill(skillId, profile).then(() => {
            if (deleting) {
              notify({ kind: 'success', message: t.skills.skillArchivedMessage, title: t.skills.skillDeletedTitle })
            } else {
              notifySkillArchived(t)
            }

            onSuccess?.()
          }),
          rollback,
          err => onFailure?.(err, skillName)
        )
      }}
      open={open}
      title={deleting ? t.skills.deleteTitle(skillName) : `Archive ${skillName}?`}
    />
  )
}
