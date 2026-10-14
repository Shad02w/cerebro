import { memo, useState } from 'react'
import type { AgentAnswer, AgentSkill, ChatItem as Item } from '@cerebro/core'
import { Brain, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentMarkdown } from '@/components/markdown/agent-markdown'
import { cn } from '@/lib/utils'
import './chat-status.css'
import { commandInputDetail, commandRun, toolCallSummary } from './command-preview'
import { workingHeading } from './working-label'
import { useTurnDuration } from './turn-durations'
import { ChatDiff } from './chat-diff'
import { ToolTypeIcon } from './tool-type-icon'
import { ChatTaskOutcome } from './chat-task-outcome'
import { ChatUserMessage } from './chat-user-message'

function RequestCard({
  item,
  onReply
}: {
  item: Item
  onReply: (id: string, answer: AgentAnswer) => void
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const request = item.request!
  return (
    <section
      className="rounded-xl border bg-muted/25 p-4"
      aria-label={item.title ?? 'Agent request'}
    >
      <p className="mb-2 text-sm font-medium">{item.title}</p>
      {item.text ? (
        <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {item.text}
        </pre>
      ) : null}
      {request.resolved ? (
        <p className="text-xs text-muted-foreground">Request closed</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onReply(request.id, { allow: true, answers })
          }}
          className="space-y-3"
        >
          {request.questions?.map((question) => (
            <fieldset key={question.id} className="space-y-2">
              <legend className="text-sm">{question.label}</legend>
              {question.options?.map((option) => (
                <label key={option} className="flex gap-2 text-xs">
                  <input
                    type={question.multiple ? 'checkbox' : 'radio'}
                    name={`${request.id}:${question.id}`}
                    checked={(answers[question.id] ?? []).includes(option)}
                    onChange={(e) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: question.multiple
                          ? e.target.checked
                            ? [...(current[question.id] ?? []), option]
                            : (current[question.id] ?? []).filter((v) => v !== option)
                          : [option]
                      }))
                    }
                  />
                  {option}
                </label>
              ))}
              <input
                aria-label={`Answer: ${question.label}`}
                placeholder="Type an answer…"
                value={(answers[question.id] ?? []).join(', ')}
                onChange={(e) =>
                  setAnswers((current) => ({ ...current, [question.id]: [e.target.value] }))
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button size="sm" type="submit">
              {request.kind === 'approval' ? 'Allow once' : 'Submit answer'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => onReply(request.id, { allow: false, answers: {} })}
            >
              Decline
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

/** Shared with reasoning rows so the working-section chrome cannot drift. */
const workingRowSummaryClass =
  'flex min-w-0 cursor-pointer list-none items-baseline gap-2 py-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden [&::marker]:content-none'

/** Tool output and expanded reasoning use the same body. */
const workingRowOutputClass =
  'mt-1 max-h-96 overflow-auto pl-6 text-xs leading-5 whitespace-pre-wrap break-words'

function ToolCallLine({ item }: { item: Item }): React.JSX.Element {
  const run = commandRun(item)
  const summary = toolCallSummary(item)
  const running = item.status === 'running'
  const detail = run ? commandInputDetail(item.input, run.command) : item.input
  return (
    <details className="min-w-0" data-testid={run ? 'command-run' : 'tool-call'}>
      <summary className={workingRowSummaryClass}>
        <ToolTypeIcon
          name={run ? 'shell' : undefined}
          title={run ? undefined : item.title}
          className="relative top-px"
        />
        <span className="min-w-0 flex-1">
          <span
            data-testid={run ? 'command-preview' : 'tool-summary'}
            className={cn('block w-full truncate', running && 'chat-working')}
          >
            {summary.line}
          </span>
        </span>
      </summary>
      {run?.command ? (
        <pre
          data-testid="command-full"
          className="mt-1 max-h-60 overflow-auto pl-6 font-mono text-xs leading-5 whitespace-pre-wrap break-words"
        >
          {run.command}
        </pre>
      ) : null}
      {detail ? (
        <pre className="my-1 max-h-60 overflow-auto pl-6 text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {detail}
        </pre>
      ) : null}
      {item.text ? <pre className={workingRowOutputClass}>{item.text}</pre> : null}
    </details>
  )
}

function ReasoningLine({ item }: { item: Item }): React.JSX.Element {
  const running = item.status === 'running'
  const label = item.title?.trim() || 'Reasoning'
  return (
    <details className="min-w-0" data-testid="reasoning">
      <summary className={workingRowSummaryClass}>
        <Brain aria-hidden="true" className="size-3.5 shrink-0 relative top-px" />
        <span className="min-w-0 flex-1">
          <span
            data-testid="reasoning-summary"
            className={cn('block w-full truncate', running && 'chat-working')}
          >
            {label}
          </span>
        </span>
      </summary>
      {item.text ? <pre className={workingRowOutputClass}>{item.text}</pre> : null}
    </details>
  )
}

/** Every tool call from one turn, as a single expandable once the reply has ended. */
export function WorkingGroup({
  items,
  live = false
}: {
  items: Item[]
  live?: boolean
}): React.JSX.Element {
  const seconds = useTurnDuration(items[0]?.turnId)
  if (live) {
    return (
      <div data-testid="working-live">
        {items.map((item) => (
          <WorkingEntry key={item.id} item={item} />
        ))}
      </div>
    )
  }
  return (
    <details className="group min-w-0" data-testid="working-group">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1 py-1 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden [&::marker]:content-none">
        <span className="min-w-0 truncate">{workingHeading(seconds)}</span>
        <ChevronRight
          aria-hidden
          data-testid="working-disclosure"
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <div className="pl-4">
        {items.map((item) => (
          <WorkingEntry key={item.id} item={item} />
        ))}
      </div>
    </details>
  )
}

function WorkingEntry({ item }: { item: Item }): React.JSX.Element {
  if (item.kind === 'tool') return <ToolCallLine item={item} />
  if (item.kind === 'reasoning') return <ReasoningLine item={item} />
  return <TranscriptDetails item={item} />
}

const noSkills: readonly AgentSkill[] = []

export const ChatItem = memo(function ChatItem({
  item,
  onReply,
  workspaceId,
  sessionId,
  skills = noSkills,
  streaming = false
}: {
  item: Item
  onReply: (id: string, answer: AgentAnswer) => void
  workspaceId: number
  sessionId: string
  skills?: readonly AgentSkill[]
  streaming?: boolean
}): React.JSX.Element {
  if (item.kind === 'request') return <RequestCard item={item} onReply={onReply} />
  if (item.kind === 'user')
    return (
      <ChatUserMessage
        text={item.text}
        attachments={item.attachments}
        workspaceId={workspaceId}
        sessionId={sessionId}
        skills={skills}
      />
    )
  if (item.kind === 'text') return <AgentMarkdown text={item.text} streaming={streaming} />
  if (item.kind === 'plan')
    return (
      <section className="rounded-xl border p-3">
        <p className="mb-2 text-xs font-medium">Plan</p>
        <pre className="whitespace-pre-wrap text-sm">{item.text}</pre>
      </section>
    )
  if (item.kind === 'notice' && item.task)
    return <ChatTaskOutcome task={item.task} text={item.text} />
  if (item.kind === 'notice')
    return (
      <p className="text-xs text-muted-foreground">
        {item.title ? `${item.title}: ` : ''}
        {item.text}
      </p>
    )
  if (item.kind === 'tool') return <ToolCallLine item={item} />
  if (item.kind === 'reasoning') return <ReasoningLine item={item} />
  return <TranscriptDetails item={item} />
})

function TranscriptDetails({ item }: { item: Item }): React.JSX.Element {
  return (
    <details
      className="min-w-0 rounded-xl border border-border/70 bg-muted/15 px-3 py-2"
      open={item.kind === 'diff' ? true : undefined}
    >
      <summary className="cursor-pointer truncate text-xs text-muted-foreground">
        {item.title ??
          (item.kind === 'reasoning' ? 'Reasoning' : item.kind === 'diff' ? 'Changes' : 'Tool')}
        {item.status ? ` · ${item.status}` : ''}
      </summary>
      {item.input ? (
        <pre className="my-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {item.input}
        </pre>
      ) : null}
      {item.kind === 'diff' ? (
        <ChatDiff patch={item.text} />
      ) : (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">
          {item.text}
        </pre>
      )}
    </details>
  )
}
