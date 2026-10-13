import './chat-status.css'
import { workingLabel } from './working-label'
import { useWorkingSeconds } from './working-seconds'

/** Turn-level status. Mount only while the session is running. */
export function WorkingFor(): React.JSX.Element {
  const seconds = useWorkingSeconds(true)
  return (
    <div role="status" className="text-sm text-muted-foreground">
      <span className="chat-working">{workingLabel(seconds)}</span>
    </div>
  )
}
