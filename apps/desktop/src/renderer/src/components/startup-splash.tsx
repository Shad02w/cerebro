import brainMark from '@/assets/brain.svg'
import type { ReactNode } from 'react'

export function StartupGate({
  complete,
  pending,
  error,
  children
}: {
  complete: boolean
  pending: boolean
  error?: string | null
  children: ReactNode
}): React.JSX.Element {
  if (!complete && (pending || error)) return <StartupSplash error={error} />

  return (
    <>
      {!complete ? <StartupSplash /> : null}
      <div
        data-testid="startup-app"
        className="h-full"
        style={{ opacity: complete ? 1 : 0 }}
        inert={!complete}
        aria-hidden={!complete}
      >
        {children}
      </div>
    </>
  )
}

export function StartupSplash({ error }: { error?: string | null }): React.JSX.Element {
  return (
    <div className="startup-splash" data-testid="startup-splash">
      <div className="startup-drag-region" />
      <div className="startup-content">
        <img className="startup-mark" src={brainMark} alt="" width="140" height="122" />
        <h1 className="startup-title">Cerebro</h1>
        {error ? (
          <div className="startup-error" role="alert">
            <p>Couldn’t open your workspaces</p>
            <p className="startup-detail">{error}</p>
            <button className="startup-retry" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        ) : (
          <div role="status" className="startup-status">
            <span className="startup-spinner" aria-hidden="true" />
            Opening your workspaces…
          </div>
        )}
      </div>
    </div>
  )
}
