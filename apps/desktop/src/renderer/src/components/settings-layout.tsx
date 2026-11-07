import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A titled settings group: an eyebrow label over one card whose rows are divided like a table. */
export function SettingsGroup({
  title,
  children,
  className
}: {
  title: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('space-y-2', className)}>
      <h2 className="px-1 text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
        {children}
      </div>
    </div>
  )
}

/** One settings row: label and help text on the left, the control on the right. */
export function SettingsRow({
  label,
  htmlFor,
  description,
  children,
  stacked = false
}: {
  label: ReactNode
  htmlFor?: string
  description?: ReactNode
  children: ReactNode
  stacked?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex gap-6 px-4 py-3',
        stacked ? 'flex-col items-stretch gap-3' : 'items-center justify-between'
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
        </label>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}
