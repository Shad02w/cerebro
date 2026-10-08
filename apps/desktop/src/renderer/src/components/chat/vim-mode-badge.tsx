import type { Mode } from 'vim-prosemirror'
import { vimModeLetter, vimModeName } from './composer-vim'

/** One colored letter for the composer's vim mode; the full name is in the tooltip and label. */
export function VimModeBadge({ mode }: { mode: Mode }): React.JSX.Element {
  return (
    <span
      className="composer-vim-mode"
      data-testid="composer-vim-mode"
      data-mode={mode}
      role="status"
      aria-label={`Vim mode: ${vimModeName[mode]}`}
      title={`Vim mode: ${vimModeName[mode]}`}
    >
      {vimModeLetter[mode]}
    </span>
  )
}
