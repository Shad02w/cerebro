import { useEffect, useState } from 'react'
import { parseAppPath, pathFromHash, type AppRoute } from '@/lib/app-route'

export function useAppRoute(): AppRoute {
  const [path, setPath] = useState(() => pathFromHash(window.location.hash))

  useEffect(() => {
    const onHashChange = (): void => {
      setPath(pathFromHash(window.location.hash))
    }
    window.addEventListener('hashchange', onHashChange)
    return (): void => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return parseAppPath(path)
}
