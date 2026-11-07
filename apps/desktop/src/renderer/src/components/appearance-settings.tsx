import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { SettingsGroup, SettingsRow } from '@/components/settings-layout'
import {
  setAppearance,
  UI_STYLES,
  useAppearance,
  type ColorModePreference,
  type UiStyleId
} from '@/lib/appearance'
import { cn } from '@/lib/utils'

const MODES: { value: ColorModePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor }
]

/** A miniature window drawn with the style's own tokens, so each card previews itself. */
function StylePreview({ style }: { style: UiStyleId }): React.JSX.Element {
  return (
    <div
      data-ui-style={style}
      aria-hidden="true"
      className="flex h-24 overflow-hidden bg-background font-sans text-foreground"
    >
      <div className="flex w-[34%] flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2">
        <span className="h-1.5 w-8 rounded-full bg-sidebar-foreground/40" />
        <span
          data-workspace-role="branch"
          data-active="true"
          className="mt-1 flex h-3.5 items-center rounded-sm px-1"
        >
          <span className="h-1 w-10 rounded-full bg-sidebar-foreground/70" />
        </span>
        <span className="flex h-3.5 items-center px-1">
          <span className="h-1 w-8 rounded-full bg-sidebar-foreground/30" />
        </span>
        <span className="flex h-3.5 items-center px-1">
          <span className="h-1 w-9 rounded-full bg-sidebar-foreground/30" />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-5 items-center gap-1 border-b border-border bg-header px-1.5">
          <span className="h-3 w-9 rounded-sm border border-tab-active-border bg-tab-active" />
          <span className="h-1 w-6 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <span className="h-1 w-3/4 rounded-full bg-foreground/70" />
          <span className="h-1 w-1/2 rounded-full bg-muted-foreground/50" />
          <div className="mt-auto flex items-center justify-end gap-1 rounded-sm border border-border bg-card p-1 shadow-card">
            <span className="h-1 flex-1 rounded-full bg-muted-foreground/30" />
            <span className="h-3 w-6 rounded-sm bg-primary" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings(): React.JSX.Element {
  const appearance = useAppearance()
  return (
    <section className="space-y-8" data-testid="settings-appearance">
      <SettingsGroup title="Color mode">
        <SettingsRow
          label="Mode"
          description="Light and dark use the same style. System follows your operating system."
        >
          <div
            role="radiogroup"
            aria-label="Color mode"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted p-0.5"
          >
            {MODES.map(({ value, label, Icon }) => {
              const selected = appearance.mode === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`appearance-mode-${value}`}
                  onClick={(): void => setAppearance({ mode: value })}
                  className={cn(
                    'inline-flex h-6 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                    selected && 'bg-background text-foreground shadow-card'
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </button>
              )
            })}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <div className="space-y-2">
        <h2 className="ui-eyebrow px-1 text-xs text-muted-foreground">Style</h2>
        <div
          role="radiogroup"
          aria-label="UI style"
          className="grid grid-cols-2 gap-3 lg:grid-cols-3"
        >
          {UI_STYLES.map((style) => {
            const selected = appearance.style === style.id
            return (
              <button
                key={style.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`appearance-style-${style.id}`}
                onClick={(): void => setAppearance({ style: style.id })}
                className={cn(
                  'group overflow-hidden rounded-lg border border-border bg-card text-left shadow-card transition-[box-shadow,border-color] outline-none hover:border-ring focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'border-primary ring-2 ring-primary'
                )}
              >
                <StylePreview style={style.id} />
                <div className="flex items-start gap-2 border-t border-border px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{style.label}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {style.description}
                    </p>
                  </div>
                  {selected ? (
                    <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" aria-hidden="true" />
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
