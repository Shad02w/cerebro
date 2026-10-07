import { useEffect, useState } from 'react'

export function useFullScreen(): boolean {
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => window.cerebro.onFullScreenChange(setFullScreen), [])
  return fullScreen
}
