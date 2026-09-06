import { useEffect, useState } from 'react'
import { useHotkeyRecorder } from '@tanstack/react-hotkeys'
import type { AppSettings, AppSettingsPatch } from '@shared/types'
import {
  KEYBIND_CATALOG,
  findKeybindConflict,
  resolveKeybinds,
  type KeybindActionId,
  type KeybindOverrides
} from '@shared/keybinds'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ShortcutKbd } from './shortcut-kbd'
import { useKeybinds } from './provider'

type KeyboardSettingsProps = {
  settings: AppSettings
  error: string | null
  onUpdate: (patch: AppSettingsPatch) => Promise<AppSettings>
}

export function KeyboardSettings({
  settings,
  error,
  onUpdate
}: KeyboardSettingsProps): React.JSX.Element {
  const { setRecording } = useKeybinds()
  const bindings = resolveKeybinds(settings.keybinds)
  const [editingId, setEditingId] = useState<KeybindActionId | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const persistOverrides = async (next: KeybindOverrides): Promise<void> => {
    setSaving(true)
    setLocalError(null)
    try {
      await onUpdate({ keybinds: next })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save keyboard shortcuts.')
    } finally {
      setSaving(false)
    }
  }

  const recorder = useHotkeyRecorder({
    ignoreInputs: false,
    onRecord: (hotkey) => {
      if (!editingId) return
      const conflict = findKeybindConflict(hotkey, bindings, editingId)
      if (conflict) {
        const conflictLabel = KEYBIND_CATALOG.find((item) => item.id === conflict)?.label ?? conflict
        setLocalError(`That shortcut is already used by “${conflictLabel}”.`)
        setEditingId(null)
        setRecording(false)
        return
      }
      const action = KEYBIND_CATALOG.find((item) => item.id === editingId)
      const next: KeybindOverrides = { ...settings.keybinds }
      if (action && hotkey === action.defaultHotkey) {
        delete next[editingId]
      } else {
        next[editingId] = hotkey
      }
      setEditingId(null)
      setRecording(false)
      void persistOverrides(next)
    },
    onCancel: () => {
      setEditingId(null)
      setRecording(false)
    }
  })

  useEffect(() => {
    setRecording(editingId != null && recorder.isRecording)
    return () => {
      setRecording(false)
    }
  }, [editingId, recorder.isRecording, setRecording])

  const startEdit = (id: KeybindActionId): void => {
    setLocalError(null)
    setEditingId(id)
    recorder.startRecording()
  }

  const cancelEdit = (): void => {
    recorder.cancelRecording()
    setEditingId(null)
    setRecording(false)
  }

  const resetBinding = async (id: KeybindActionId): Promise<void> => {
    if (!(id in settings.keybinds)) return
    const next: KeybindOverrides = { ...settings.keybinds }
    delete next[id]
    await persistOverrides(next)
  }

  return (
    <section className="space-y-6" data-testid="settings-keyboard">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Click a shortcut to record a new key combination. Escape cancels. Shortcuts with modifiers
        work while the terminal is focused.
      </p>
      <div className="space-y-3">
        {KEYBIND_CATALOG.map((action) => {
          const hotkey = bindings[action.id]
          const isEditing = editingId === action.id && recorder.isRecording
          const isCustom = Boolean(settings.keybinds?.[action.id])
          return (
            <div
              key={action.id}
              className="flex items-start justify-between gap-6 rounded-lg border border-border px-4 py-3"
              data-testid={`keybind-row-${action.id}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <Label className="text-[13px] font-medium">{action.label}</Label>
                <p className="text-xs leading-relaxed text-muted-foreground">{action.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isCustom ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={saving || isEditing}
                    data-testid={`keybind-reset-${action.id}`}
                    onClick={(): void => {
                      void resetBinding(action.id)
                    }}
                  >
                    Reset
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="min-w-28 justify-center"
                  disabled={saving}
                  data-testid={`keybind-edit-${action.id}`}
                  onClick={(): void => {
                    if (isEditing) cancelEdit()
                    else startEdit(action.id)
                  }}
                >
                  {isEditing ? (
                    <span className="text-muted-foreground">Press keys…</span>
                  ) : (
                    <ShortcutKbd hotkey={hotkey} />
                  )}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {localError || error ? (
        <p className="text-sm text-destructive" data-testid="settings-keyboard-error">
          {localError ?? error}
        </p>
      ) : null}
    </section>
  )
}
