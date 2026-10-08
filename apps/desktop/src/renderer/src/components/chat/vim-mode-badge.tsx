import type { Mode } from 'vim-prosemirror'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { vimModeLetter, vimModeName } from './composer-vim'

/**
 * The composer's vim mode as a small ringed circle with one letter, sized and spaced like the
 * context usage ring beside it. The mode name is in the tooltip and the accessible label.
 */
export function VimModeBadge({ mode }: { mode: Mode }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="flex shrink-0 items-center rounded p-1"
            data-testid="composer-vim-mode"
            data-mode={mode}
            role="status"
            aria-label={`Vim mode: ${vimModeName[mode]}`}
          />
        }
      >
        <span className="composer-vim-mode" aria-hidden="true">
          {vimModeLetter[mode]}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        Vim mode: {vimModeName[mode]}
      </TooltipContent>
    </Tooltip>
  )
}
