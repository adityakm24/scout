import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  dropdownMenuRow,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export interface ConnectorDialogMenuProps {
  onRefreshTools: () => void
  /** Delete the server from this computer's mcp.json (asks first). Omitted when
   *  the server isn't the user's to delete. */
  onRemove?: () => void
}

export function ConnectorDialogMenu({ onRefreshTools, onRemove }: ConnectorDialogMenuProps) {
  const { t } = useI18n()
  const copy = t.connectorsPage

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={copy.dialog.moreActions} size="icon-xs" variant="ghost">
          <Codicon name="ellipsis" size="0.8125rem" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className={dropdownMenuRow} onSelect={onRefreshTools}>
          {copy.dialog.menuRefreshTools}
        </DropdownMenuItem>
        {onRemove ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={cn(dropdownMenuRow, 'text-destructive focus:text-destructive')}
              onSelect={onRemove}
            >
              <Codicon name="trash" size="0.8125rem" />
              {t.common.delete}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
