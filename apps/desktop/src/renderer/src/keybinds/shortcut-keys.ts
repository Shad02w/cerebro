import { formatForDisplay } from '@tanstack/react-hotkeys'

/** Split TanStack `formatForDisplay` output into individual key chips. */
export function shortcutKeys(hotkey: string): string[] {
  const display = formatForDisplay(hotkey).trim()
  if (!display) return []
  // formatForDisplay uses spaces between modifiers/keys (e.g. "⌘ W", "Ctrl+W" may vary).
  // Prefer splitting on whitespace; also handle "+" separators.
  if (display.includes(' ')) {
    return display.split(/\s+/).filter(Boolean)
  }
  if (display.includes('+')) {
    return display
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return [display]
}
