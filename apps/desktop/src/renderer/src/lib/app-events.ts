/** Window event that opens the session search palette from chrome outside the sidebar. */
export const OPEN_SESSION_SEARCH_EVENT = 'cerebro:open-session-search'

export function openSessionSearch(): void {
  window.dispatchEvent(new Event(OPEN_SESSION_SEARCH_EVENT))
}
