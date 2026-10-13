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

export function clearTurnDurations(): void {
  durations = new Map()
  for (const listener of listeners) listener()
}

export function useTurnDuration(turnId: string | undefined): number | null {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (!turnId) return null
  return current.get(turnId) ?? null
}
