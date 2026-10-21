import { type ReactNode, useDeferredValue, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import type { SkillInfo } from '@/types/scout'

import { PanelEmpty } from '../../overlays/panel'
import { CatalogCard } from '../catalog/catalog-card'
import { type CatalogEntry, parseCatalog } from '../catalog/catalog-data'
import { CatalogDetail } from '../catalog/catalog-detail'
import { CatalogDetailDialog } from '../catalog/catalog-detail-dialog'

const SOURCE: Record<string, string> = { agent: 'custom', bundled: 'built-in', hub: 'hub' }

interface InstalledSkillsProps {
  skills: SkillInfo[]
  query?: string
  onQueryChange?: (value: string) => void
  /** End-of-header controls (bulk menu) beside the New skill button. */
  actions?: ReactNode
  notice?: ReactNode
  onNewSkill: () => void
  renderAction: (skill: SkillInfo) => ReactNode
  renderDetail: (skill: SkillInfo) => ReactNode
}

/** The profile's own skills as cards — the user's custom skills first, then the
 *  built-ins by name. No public library: new skills are written, not browsed. */
export function InstalledSkills({
  skills,
  query,
  onQueryChange,
  actions,
  notice,
  onNewSkill,
  renderAction,
  renderDetail
}: InstalledSkillsProps) {
  const { t } = useI18n()
  const c = t.catalog
  const deferredQuery = useDeferredValue((query ?? '').trim().toLowerCase())
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const { entries, skillById } = useMemo(() => {
    const byName = new Map(skills.map(skill => [skill.name, skill]))

    const parsed = parseCatalog(
      'skills',
      skills.map(skill => ({
        name: skill.name,
        description: skill.description,
        category: skill.category,
        source: SOURCE[skill.provenance ?? ''] ?? 'custom'
      }))
    )
      .map(entry => ({ ...entry, id: `installed:${entry.name}` }))
      .sort((a, b) => Number(a.source !== 'custom') - Number(b.source !== 'custom') || a.name.localeCompare(b.name))

    return {
      entries: parsed,
      skillById: new Map(
        parsed.flatMap(entry => {
          const skill = byName.get(entry.name)

          return skill ? [[entry.id, skill] as const] : []
        })
      )
    }
  }, [skills])

  const visible = deferredQuery ? entries.filter(entry => entry.search.toLowerCase().includes(deferredQuery)) : entries
  const selected = entries.find(entry => entry.id === selectedId) ?? null
  const skillOf = (entry: CatalogEntry) => skillById.get(entry.id)
  const selectedSkill = selected ? skillOf(selected) : undefined

  const searchFor = (value: string) => {
    onQueryChange?.(value)
    setDetailOpen(false)
  }

  const open = (entry: CatalogEntry) => {
    setSelectedId(entry.id)
    setDetailOpen(true)
  }

  const action = (entry: CatalogEntry) => {
    const skill = skillOf(entry)

    return skill ? renderAction(skill) : null
  }

  return (
    <div className="@container/catalog flex h-full min-h-0 min-w-0 flex-col gap-3 px-4 pb-2" data-catalog="skills">
      <header className="flex shrink-0 flex-col gap-3 pt-1" data-catalog-header>
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex-1 text-sm font-semibold text-(--ui-text-primary)">{t.skills.tabSkills}</h2>
          <div className="flex min-w-0 items-center justify-end gap-2" data-catalog-actions>
            {actions}
            <Button onClick={onNewSkill} size="sm">
              <Codicon name="add" />
              {t.skills.newSkill}
            </Button>
          </div>
        </div>
        <SearchField
          containerClassName="w-full min-w-0"
          onChange={value => onQueryChange?.(value)}
          placeholder={c.searchSkills}
          value={query ?? ''}
          variant="box"
        />
      </header>
      {notice}
      <div className="flex min-h-0 flex-1 flex-col pb-3">
        {visible.length === 0 ? (
          <PanelEmpty
            action={
              deferredQuery ? (
                <Button onClick={() => onQueryChange?.('')} size="sm" variant="secondary">
                  {c.clearFilters}
                </Button>
              ) : undefined
            }
            description={deferredQuery ? t.skills.emptyNothingMatches(query ?? '') : undefined}
            icon={deferredQuery ? 'search' : 'lightbulb'}
            title={deferredQuery ? c.noResults : t.skills.noSkillsTitle}
          />
        ) : (
          // The stable 0.5rem scrollbar gutter hangs into the column's padding
          // (-mr-2) so the cards share a right edge with the header.
          <div
            className="-mr-2 min-h-0 flex-1 overflow-y-auto overscroll-contain py-2 [scrollbar-gutter:stable]"
            data-catalog-scroll
          >
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3"
              data-catalog-hover-group
            >
              {visible.map((entry, index) => (
                <CatalogCard
                  accentIndex={index}
                  action={action(entry)}
                  entry={entry}
                  key={entry.id}
                  onCategory={searchFor}
                  onOpen={open}
                  onSearch={searchFor}
                  onTag={searchFor}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      {selected && (
        <CatalogDetailDialog
          onOpenChange={setDetailOpen}
          onSelect={setSelectedId}
          open={detailOpen}
          order={visible}
          selectedId={selected.id}
        >
          <CatalogDetail
            action={action(selected)}
            dialog
            entry={selected}
            kind="skills"
            management={selectedSkill ? renderDetail(selectedSkill) : null}
            onCategory={searchFor}
            onSearch={searchFor}
            onTag={searchFor}
            related={[]}
          />
        </CatalogDetailDialog>
      )}
    </div>
  )
}
