import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Jump back to the end of the latest response. */
export function ChatScrollEndButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Scroll to end"
        title="Scroll to end"
        data-testid="chat-scroll-end"
        className="pointer-events-auto rounded-full bg-background shadow-md"
        onClick={onClick}
      >
        <ArrowDown />
      </Button>
    </div>
  )
}
