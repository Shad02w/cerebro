import { useCallback } from 'react'

/** Returns true only after the system clipboard accepts the text. */
export function useClipboard(): (text: string) => Promise<boolean> {
  return useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }, [])
}
