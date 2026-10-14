import { useImperativeHandle, useState } from 'react'
import { File } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fileIconUrl } from './file-icon'

export type FileOption = { id: string; label: string }

export type FileMenuHandle = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export function ComposerFileMenu({
  ref,
  items,
  loading,
  command
}: {
  ref?: React.Ref<FileMenuHandle>
  items: FileOption[]
  loading: boolean
  command: (item: FileOption) => void
}): React.JSX.Element {
  // TipTap clears items while an async search is in flight. Keep the last rows in state
  // so the menu does not flash empty. Adjusting state during render is how React stores
  // the previous prop without reading a ref in render.
  const [kept, setKept] = useState(items)
  if (!loading && kept !== items) setKept(items)
  const rows = loading && items.length === 0 ? kept : items
  const rowsKey = rows.map((item) => item.id).join('\0')
  const [selected, setSelected] = useState(0)
  const [seenRows, setSeenRows] = useState(rowsKey)
  if (seenRows !== rowsKey) {
    setSeenRows(rowsKey)
    setSelected(0)
  }
  const highlighted = rows.length ? selected % rows.length : 0
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setSelected((current) => (rows.length ? (current + 1) % rows.length : 0))
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected((current) => (rows.length ? (current - 1 + rows.length) % rows.length : 0))
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = rows[highlighted]
        if (item) command(item)
        return true
      }
      return false
    }
  }))
  return (
    <div
      data-testid="composer-file-menu"
      data-loading={loading || undefined}
      role="listbox"
      aria-label="Files"
      className="max-h-64 w-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Files</p>
      {rows.length ? (
        rows.map((item, index) => {
          const icon = fileIconUrl(item.label)
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              data-testid="composer-file-option"
              data-path={item.label}
              data-file-icon={icon ? 'brand' : 'file'}
              title={item.label}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left',
                index === highlighted && 'bg-accent text-accent-foreground'
              )}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                command(item)
              }}
            >
              {icon ? (
                <img src={icon} alt="" className="size-4 shrink-0" />
              ) : (
                <File className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="truncate font-mono text-xs">{item.label}</span>
            </button>
          )
        })
      ) : (
        <p className="px-2 py-3 text-center text-sm text-muted-foreground">
          {loading ? 'Searching…' : 'No matches'}
        </p>
      )}
    </div>
  )
}
