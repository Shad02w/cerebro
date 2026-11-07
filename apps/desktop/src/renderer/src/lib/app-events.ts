/** Window event that opens the command palette from chrome outside the sidebar. */
export const OPEN_COMMAND_PALETTE_EVENT = 'cerebro:open-command-palette'

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
}
