import './chat-status.css'

/** Shown while a reply is still streaming. The duration waits until the reply ends. */
export function WorkingFor(): React.JSX.Element {
  return (
    <div role="status" className="text-sm text-muted-foreground">
      <span className="chat-working inline-block">Working...</span>
    </div>
  )
}
