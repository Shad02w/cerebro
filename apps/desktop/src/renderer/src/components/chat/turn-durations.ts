import { useSyncExternalStore } from 'react'

let durations = new Map<string, number>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): Map<string, number> {
  return durations
}

export function recordTurnSeconds(turnId: string, seconds: number): void {
  if (durations.get(turnId) === seconds) return
  durations = new Map(durations).set(turnId, seconds)
  for (const listener of listeners) listener()
}

const runningSince = new Map<string, number>()

/** Whole seconds a watched turn ran. A turn we saw start is at least one second. */
export function elapsedSeconds(started: number, now: number): number {
  return Math.max(1, Math.round((now - started) / 1000))
}

/** Remember when a turn became busy. A later note for the same turn keeps the original start. */
export function noteTurnRunning(turnId: string, now = Date.now()): void {
  if (!runningSince.has(turnId)) runningSince.set(turnId, now)
}

/**
 * `activeIds` are the turns this view is timing. `knownIds` are every turn in that
 * view. A turn that is known but not active is settled, and an idle view settles
 * only its own turns so another pane keeps its clock.
 */
export function syncTurnClock(
  active: boolean,
  activeIds: readonly string[],
  knownIds: readonly string[],
  now = Date.now()
): void {
  const live = new Set(active ? activeIds : [])
  for (const id of live) noteTurnRunning(id, now)
  for (const id of knownIds) if (!live.has(id)) noteTurnSettled(id, now)
}

/** Store the duration for one turn that is no longer busy. */
export function noteTurnSettled(turnId: string, now = Date.now()): void {
  const started = runningSince.get(turnId)
  if (started == null) return
  runningSince.delete(turnId)
  recordTurnSeconds(turnId, elapsedSeconds(started, now))
}

export function clearTurnDurations(): void {
  durations = new Map()
  runningSince.clear()
  for (const listener of listeners) listener()
}

export function useTurnDuration(turnId: string | undefined): number | null {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (!turnId) return null
  return current.get(turnId) ?? null
}
