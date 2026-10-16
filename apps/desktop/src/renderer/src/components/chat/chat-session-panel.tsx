import { Fragment, useState } from 'react'
import { Bot, ListTodo, LoaderCircle, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { AgentBackgroundTask, AgentSession, AgentSubagent, TodoSnapshot } from '@cerebro/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ChatBackgroundTaskList } from './chat-background-tasks'
import { ChatSubagentStack } from './chat-subagents'
import { ChatTodoList } from './chat-todo'

type SessionStatus = {
  todo?: TodoSnapshot
  tasks?: AgentBackgroundTask[]
  agents?: AgentSubagent[]
}

/**
 * Tasks, background jobs, and agents floating over the transcript.
 * ChatView is the `@container/chat` element. At 56rem the card is shown; a narrower pane hides it.
 * It does not take a column in the layout. Collapse leaves a vertical icon list.
 */
export function ChatSessionPanel({ session }: { session: AgentSession }): React.JSX.Element | null {
  const status = sessionStatus(session)
  const [expanded, setExpanded] = useState(true)
  if (!status) return null
  return (
    <TooltipProvider>
      <aside
        data-testid="chat-session-panel"
        data-expanded={expanded ? 'true' : 'false'}
        aria-label="Session status"
        className="pointer-events-auto absolute top-8 right-3 z-20 hidden max-h-[calc(100%-11rem)] flex-col @min-[56rem]/chat:flex"
      >
        {expanded ? (
          <SessionCard status={status} onCollapse={() => setExpanded(false)} />
        ) : (
          <SessionRail status={status} onExpand={() => setExpanded(true)} />
        )}
      </aside>
    </TooltipProvider>
  )
}

function sessionStatus(session: AgentSession): SessionStatus | null {
  const todo = session.todo?.items.length ? session.todo : undefined
  const tasks = session.background?.length ? session.background : undefined
  const agents = session.subagents?.length ? session.subagents : undefined
  if (!todo && !tasks && !agents) return null
  return { todo, tasks, agents }
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function SessionCard({
  status,
  onCollapse
}: {
  status: SessionStatus
  onCollapse: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 w-80 flex-col overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">Session</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Collapse session status"
          onClick={onCollapse}
        >
          <PanelRightClose />
        </Button>
      </div>
      <Separator />
      <div className="min-h-0 overflow-y-auto">
        <SessionSections status={status} />
      </div>
    </div>
  )
}

function SessionSections({ status }: { status: SessionStatus }): React.JSX.Element {
  const blocks = [
    status.todo ? (
      <section key="tasks" data-testid="chat-session-panel-tasks" className="px-1 py-2">
        <SectionHeading title="Tasks" count={status.todo.items.length} section="tasks" />
        <ChatTodoList todo={status.todo} showHeading={false} />
      </section>
    ) : null,
    status.tasks ? (
      <section key="background" data-testid="chat-session-panel-background" className="px-1 py-2">
        <SectionHeading title="Background" count={status.tasks.length} section="background" />
        <ChatBackgroundTaskList tasks={status.tasks} />
      </section>
    ) : null,
    status.agents ? (
      <section key="agents" data-testid="chat-session-panel-agents" className="px-1 py-2">
        <SectionHeading title="Agents" count={status.agents.length} section="agents" />
        <ChatSubagentStack agents={status.agents} />
      </section>
    ) : null
  ].filter((block) => block != null)
  return (
    <>
      {blocks.map((block, index) => (
        <Fragment key={block.key}>
          {index > 0 ? <Separator /> : null}
          {block}
        </Fragment>
      ))}
    </>
  )
}

function SessionRail({
  status,
  onExpand
}: {
  status: SessionStatus
  onExpand: () => void
}): React.JSX.Element {
  const icons = [
    status.todo
      ? {
          section: 'tasks',
          count: status.todo.items.length,
          label: countLabel(status.todo.items.length, 'task', 'tasks'),
          icon: <ListTodo />
        }
      : null,
    status.tasks
      ? {
          section: 'background',
          count: status.tasks.length,
          label: `${status.tasks.length} background ${status.tasks.length === 1 ? 'job' : 'jobs'}`,
          icon: <LoaderCircle className="animate-spin" />
        }
      : null,
    status.agents
      ? {
          section: 'agents',
          count: status.agents.length,
          label: countLabel(status.agents.length, 'agent', 'agents'),
          icon: <Bot />
        }
      : null
  ].filter((item) => item != null)
  return (
    <div
      data-testid="chat-session-panel-rail"
      className="flex flex-col gap-1 rounded-xl border bg-popover p-1 shadow-lg"
    >
      <RailButton label="Expand session status" onClick={onExpand}>
        <PanelRightOpen />
      </RailButton>
      {icons.map((item) => (
        <RailButton key={item.label} label={item.label} onClick={onExpand}>
          {item.icon}
          <CountBadge count={item.count} section={item.section} corner />
        </RailButton>
      ))}
    </div>
  )
}

function SectionHeading({
  title,
  count,
  section
}: {
  title: string
  count: number
  section: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-1 pb-1">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <CountBadge count={count} section={section} />
    </div>
  )
}

/** Count pill in the theme accent. Hidden when the section is empty. */
function CountBadge({
  count,
  section,
  corner = false
}: {
  count: number
  section: string
  corner?: boolean
}): React.JSX.Element | null {
  if (count < 1) return null
  return (
    <Badge
      data-testid="chat-session-badge"
      data-section={section}
      className={cn(
        'h-4 min-w-4 border-transparent bg-[var(--sidebar-selected)] px-1 text-[10px] leading-none text-background tabular-nums',
        corner && 'pointer-events-none absolute -top-1 -right-1'
      )}
    >
      {count}
    </Badge>
  )
}

function RailButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            className="relative"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
