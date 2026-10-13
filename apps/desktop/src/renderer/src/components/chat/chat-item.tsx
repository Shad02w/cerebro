import { memo, useState } from 'react'
import type { AgentAnswer, ChatItem as Item } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { AgentMarkdown } from '@/components/markdown/agent-markdown'
import { commandInputDetail, commandRun, type CommandRun } from './command-preview'
import { ChatDiff } from './chat-diff'
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

function CommandRunRow({ item, run }: { item: Item; run: CommandRun }): React.JSX.Element {
  const detail = commandInputDetail(item.input, run.command)
  const title = item.title?.trim()
  const label = title && title !== run.command ? title : 'Command'
  return (
    <details
      className="group min-w-0 rounded-xl border border-border/70 bg-muted/15 px-3 py-2"
      data-testid="command-run"
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">
        <span className="block truncate">
          {label}
          {item.status ? ` · ${item.status}` : ''}
        </span>
        {run.preview ? (
          <span
            data-testid="command-preview"
            className="mt-1 block font-mono text-[11px] leading-4 break-all text-foreground/80 group-open:hidden"
          >
            {run.preview}
          </span>
        ) : null}
      </summary>
      {run.command ? (
        <pre
          data-testid="command-full"
          className="mt-2 max-h-60 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap break-words"
        >
          {run.command}
        </pre>
      ) : null}
      {detail ? (
        <pre className="my-2 max-h-60 overflow-auto text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {detail}
        </pre>
      ) : null}
      {item.text ? (
        <pre className="mt-2 max-h-96 overflow-auto text-xs leading-5 whitespace-pre-wrap break-words">
          {item.text}
        </pre>
      ) : null}
    </details>
  )
}

export const ChatItem = memo(function ChatItem({
  item,
  onReply,
  workspaceId,
  sessionId,
  streaming = false
}: {
  item: Item
  onReply: (id: string, answer: AgentAnswer) => void
  workspaceId: number
  sessionId: string
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
  if (item.kind === 'tool') {
    const run = commandRun(item)
    if (run) return <CommandRunRow item={item} run={run} />
  }
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
})
