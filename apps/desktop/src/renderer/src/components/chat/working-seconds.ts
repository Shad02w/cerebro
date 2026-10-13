import { useState, useSyncExternalStore } from 'react'

type ElapsedStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => number
}

function createElapsedStore(): ElapsedStore {
  let started = 0
  let clock = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      if (!timer) {
        started = Date.now()
        clock = started
        timer = setInterval(() => {
          clock = Date.now()
          notify()
        }, 1000)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = undefined
          started = 0
          clock = 0
        }
      }
    },
    getSnapshot() {
      if (!timer) return 0
      return Math.max(0, Math.floor((clock - started) / 1000))
    }
  }
}

function subscribeNothing(): () => void {
  return () => {}
}

/** Whole seconds since this hook's `running` flag became true. */
export function useWorkingSeconds(running: boolean): number {
  const [store] = useState(createElapsedStore)
  const seconds = useSyncExternalStore(
    running ? store.subscribe : subscribeNothing,
    store.getSnapshot,
    store.getSnapshot
  )
  return running ? seconds : 0
}
