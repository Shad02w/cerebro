import type { Terminal } from '@xterm/xterm'
/** xterm 6.0's public onData mixes device replies and user input. The mux answers
 * device queries once, so preserve only events explicitly marked as user input.
 * Keep this version-pinned adapter covered when upgrading xterm. */
export function forwardUserInputOnly(terminal: Terminal): void {
  const core = (
    terminal as unknown as {
      _core: { coreService: { triggerDataEvent(data: string, wasUserInput?: boolean): void } }
    }
  )._core.coreService
  const original = core.triggerDataEvent.bind(core)
  core.triggerDataEvent = (data, wasUserInput): void => {
    if (wasUserInput) original(data, true)
  }
}
