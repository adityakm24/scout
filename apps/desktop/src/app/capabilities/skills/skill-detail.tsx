import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { getSkillContent, type ProfileScope, profileScopeKey } from '@/scout'
import type { SkillInfo } from '@/types/scout'

import { parseFrontmatter } from './frontmatter'

/** Scout's own manual is re-seeded on every sync (agent/skill_utils.py ESSENTIAL_SKILLS). */
const ESSENTIAL_SKILLS = new Set(['scout-agent'])

export function SkillDetail({
  onDelete,
  onEdit,
  profile,
  skill
}: {
  onDelete: () => void
  onEdit: () => void
  profile?: ProfileScope
  skill: SkillInfo
}) {
  const { t } = useI18n()
  // Only the user's own skills are theirs to rewrite; built-ins can still be
  // deleted (a restorable archive). Hub skills belong to their hub install.
  const editable = skill.provenance === 'agent'
  const deletable = skill.provenance !== 'hub' && !ESSENTIAL_SKILLS.has(skill.name)

  // The FULL skill — frontmatter metadata + complete SKILL.md body — for any
  // provenance, scoped to the Capabilities profile selector. The row list only
  // carries name/description; the pane shows the whole thing.
  const contentQuery = useQuery({
    queryKey: ['skill-content', skill.name, profileScopeKey(profile)],
    queryFn: () => getSkillContent(skill.name, profile),
    staleTime: 60_000
  })

  const parsed = useMemo(
    () => (contentQuery.data ? parseFrontmatter(contentQuery.data.content) : null),
    [contentQuery.data]
  )

  return (
    <>
      {(editable || deletable) && (
        <div className="flex items-center gap-2">
          {editable && (
            <Button onClick={onEdit} size="xs" variant="text">
              {t.skills.edit}
            </Button>
          )}
          {deletable && (
            <Button className="text-destructive hover:text-destructive" onClick={onDelete} size="xs" variant="text">
              {t.common.delete}
            </Button>
          )}
        </div>
      )}
      {contentQuery.isLoading ? (
        <PageLoader className="h-40" label={t.skills.loading} />
      ) : parsed ? (
        <pre
          className="overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-[0.68rem] leading-relaxed text-(--ui-text-secondary)"
          data-selectable-text="true"
        >
          {parsed.body.trim() || t.skills.noDescription}
        </pre>
      ) : null}
    </>
  )
}
