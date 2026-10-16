import { Fragment, useState } from 'react'
import {
  Bot,
  FileDiff,
  ListTodo,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { AgentBackgroundTask, AgentSession, AgentSubagent, TodoSnapshot } from '@cerebro/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { workspaceDiffStat, type DiffStat } from '@/lib/changed-file-count'
import { changesManifestOptions } from '@/lib/changes-query'
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
 * Tasks, background jobs, agents, and changed files floating over the transcript.
 * ChatView is the `@container/chat` element. At 56rem the card is shown; a narrower pane hides it.
 * It does not take a column in the layout. Collapse leaves a vertical icon list.
 */
export function ChatSessionPanel({
  session,
  workspaceId
}: {
  session: AgentSession | null
  workspaceId: number
}): React.JSX.Element | null {
  const listed = useQuery({
    ...changesManifestOptions(workspaceId),
    enabled: true,
    refetchInterval: 5_000
  })
  const diff = workspaceDiffStat(listed.data)
  const status = sessionStatus(session)
  const [expanded, setExpanded] = useState(true)
  if (!status && !hasDiffStat(diff)) return null
  return (
    <TooltipProvider>
      <aside
        data-testid="chat-session-panel"
        data-expanded={expanded ? 'true' : 'false'}
        aria-label="Session status"
        className="pointer-events-auto absolute top-8 right-3 z-20 hidden max-h-[calc(100%-11rem)] flex-col @min-[56rem]/chat:flex"
      >
        {expanded ? (
          <SessionCard status={status} diff={diff} onCollapse={() => setExpanded(false)} />
        ) : (
          <SessionRail status={status} diff={diff} onExpand={() => setExpanded(true)} />
        )}
      </aside>
    </TooltipProvider>
  )
}

function sessionStatus(session: AgentSession | null): SessionStatus | null {
  if (!session) return null
  const todo = session.todo?.items.length ? session.todo : undefined
  const tasks = session.background?.length ? session.background : undefined
  const agents = session.subagents?.length ? session.subagents : undefined
  if (!todo && !tasks && !agents) return null
  return { todo, tasks, agents }
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function hasDiffStat(diff: DiffStat): boolean {
  return diff.additions > 0 || diff.deletions > 0
}

function diffLabel(diff: DiffStat): string {
  return `+${diff.additions} -${diff.deletions}`
}

function SessionCard({
  status,
  diff,
  onCollapse
}: {
  status: SessionStatus | null
  diff: DiffStat
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
        <SessionSections status={status} diff={diff} />
      </div>
    </div>
  )
}

function SessionSections({
  status,
  diff
}: {
  status: SessionStatus | null
  diff: DiffStat
}): React.JSX.Element {
  const blocks = [
    status?.todo ? (
      <section key="tasks" data-testid="chat-session-panel-tasks" className="py-2">
        <SectionHeading
          title="Tasks"
          trailing={<CountBadge count={status.todo.items.length} section="tasks" />}
        />
        <ChatTodoList todo={status.todo} showHeading={false} />
      </section>
    ) : null,
    status?.tasks ? (
      <section key="background" data-testid="chat-session-panel-background" className="py-2">
        <SectionHeading
          title="Background"
          trailing={<CountBadge count={status.tasks.length} section="background" />}
        />
        <ChatBackgroundTaskList tasks={status.tasks} />
      </section>
    ) : null,
    status?.agents ? (
      <section key="agents" data-testid="chat-session-panel-agents" className="py-2">
        <SectionHeading
          title="Agents"
          trailing={<CountBadge count={status.agents.length} section="agents" />}
        />
        <ChatSubagentStack agents={status.agents} />
      </section>
    ) : null,
    hasDiffStat(diff) ? (
      <section key="changes" data-testid="chat-session-panel-changes" className="py-2">
        <SectionHeading title="Changes" trailing={<DiffStatLine diff={diff} />} />
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
  diff,
  onExpand
}: {
  status: SessionStatus | null
  diff: DiffStat
  onExpand: () => void
}): React.JSX.Element {
  const icons: Array<{
    section: string
    count: number
    label: string
    icon: React.ReactNode
    stat?: DiffStat
  } | null> = [
    status?.todo
      ? {
          section: 'tasks',
          count: status.todo.items.length,
          label: countLabel(status.todo.items.length, 'task', 'tasks'),
          icon: <ListTodo />
        }
      : null,
    status?.tasks
      ? {
          section: 'background',
          count: status.tasks.length,
          label: `${status.tasks.length} background ${status.tasks.length === 1 ? 'job' : 'jobs'}`,
          icon: <LoaderCircle className="animate-spin" />
        }
      : null,
    status?.agents
      ? {
          section: 'agents',
          count: status.agents.length,
          label: countLabel(status.agents.length, 'agent', 'agents'),
          icon: <Bot />
        }
      : null,
    hasDiffStat(diff)
      ? {
          section: 'changes',
          count: 0,
          label: diffLabel(diff),
          icon: <FileDiff />,
          stat: diff
        }
      : null
  ].filter((item) => item != null)
  return (
    <div
      data-testid="chat-session-panel-rail"
      className="box-content flex w-8 flex-col items-center gap-1 overflow-visible rounded-xl border bg-popover p-1 shadow-lg"
    >
      <RailButton label="Expand session status" onClick={onExpand}>
        <PanelRightOpen />
      </RailButton>
      {icons.map((item) => (
        <RailButton key={item.label} label={item.label} onClick={onExpand}>
          {item.icon}
          {item.stat ? (
            <ChangesRailMark diff={item.stat} />
          ) : (
            <CountBadge count={item.count} section={item.section} corner />
          )}
        </RailButton>
      ))}
    </div>
  )
}

/** Same `px-2` as the card header, so every section title shares Session's left edge. */
function SectionHeading({
  title,
  trailing
}: {
  title: string
  trailing: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-1 pb-1">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      {trailing}
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

function DiffStatLine({ diff }: { diff: DiffStat }): React.JSX.Element | null {
  if (!hasDiffStat(diff)) return null
  return (
    <span
      data-testid="chat-diff-stat"
      data-additions={diff.additions}
      data-deletions={diff.deletions}
      className="text-xs font-medium whitespace-nowrap tabular-nums"
    >
      <span className="text-green-500">+{diff.additions}</span>{' '}
      <span className="text-red-500">-{diff.deletions}</span>
    </span>
  )
}

/**
 * Presence pip on the changes icon. A full +N -M is wider than the icon and
 * stretches the rail, so the number stays on the expanded row and in the tooltip.
 */
function ChangesRailMark({ diff }: { diff: DiffStat }): React.JSX.Element | null {
  if (!hasDiffStat(diff)) return null
  return (
    <span
      data-testid="chat-diff-stat"
      data-additions={diff.additions}
      data-deletions={diff.deletions}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute -top-1 -right-1 z-10 size-2 rounded-full',
        diff.additions > 0 ? 'bg-green-500' : 'bg-red-500'
      )}
    />
  )
}

function RailButton({
  label,
  onClick,
  className,
  children
}: {
  label: string
  onClick: () => void
  className?: string
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
            className={cn('relative size-8 max-w-8 min-w-8 shrink-0 overflow-visible', className)}
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
