import { useI18n } from '@/i18n'
import { Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface ComingSoonProps {
  className?: string
  description?: string
}

/** Placeholder for a surface that is not available yet. */
export function ComingSoon({ className, description }: ComingSoonProps) {
  const { t } = useI18n()

  return (
    <div
      className={cn('flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center', className)}
      data-slot="coming-soon"
    >
      <span className="grid size-10 place-items-center rounded-full bg-(--ui-bg-quaternary) text-(--dt-midground)">
        <Sparkles className="size-5" />
      </span>
      <p className="m-0 text-[0.9375rem] font-semibold">{t.common.comingSoon}</p>
      {description ? (
        <p className="m-0 max-w-xs text-[0.8125rem] leading-5 text-(--ui-text-tertiary)">{description}</p>
      ) : null}
    </div>
  )
}
