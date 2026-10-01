import { memo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentAnswer, ChatItem as Item } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { ChatDiff } from './chat-diff'
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

export const ChatItem = memo(function ChatItem({
  item,
  onReply,
  workspaceId,
  sessionId
}: {
  item: Item
  onReply: (id: string, answer: AgentAnswer) => void
  workspaceId: number
  sessionId: string
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
  if (item.kind === 'text')
    return (
      <div className="chat-markdown text-sm leading-7 break-words">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  if (href && /^https?:\/\//.test(href)) void window.cerebro.openExternal(href)
                }}
                className="underline underline-offset-2"
              >
                {children}
              </a>
            ),
            img: ({ alt }) => (
              <span className="text-muted-foreground">[Image: {alt ?? 'image'}]</span>
            ),
            pre: ({ children }) => (
              <pre className="my-3 overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-5">
                {children}
              </pre>
            ),
            p: ({ children }) => <p className="my-2">{children}</p>,
            ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
            table: ({ children }) => (
              <div className="overflow-auto">
                <table className="my-2 border-collapse text-xs">{children}</table>
              </div>
            ),
            td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
            th: ({ children }) => <th className="border px-2 py-1 text-left">{children}</th>
          }}
        >
          {item.text}
        </Markdown>
      </div>
    )
  if (item.kind === 'plan')
    return (
      <section className="rounded-xl border p-3">
        <p className="mb-2 text-xs font-medium">Plan</p>
        <pre className="whitespace-pre-wrap text-sm">{item.text}</pre>
      </section>
    )
  if (item.kind === 'notice')
    return (
      <p className="text-xs text-muted-foreground">
        {item.title ? `${item.title}: ` : ''}
        {item.text}
      </p>
    )
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
