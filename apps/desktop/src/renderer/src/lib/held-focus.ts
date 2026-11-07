const HELD = 'data-held-focus'

/**
 * Focuses `element` and keeps panes from taking focus while it stays focused.
 * Used when the command palette moves focus to a sidebar row: selecting a workspace
 * also activates its pane, which would otherwise pull focus into the composer or terminal.
 */
export function focusAndHold(element: HTMLElement): void {
  element.setAttribute(HELD, '')
  element.addEventListener('blur', () => element.removeAttribute(HELD), { once: true })
  element.focus({ preventScroll: true })
}

/** True while a row focused by `focusAndHold` still has focus. Panes skip auto-focus then. */
export function focusIsHeld(): boolean {
  return document.activeElement?.hasAttribute(HELD) ?? false
}
