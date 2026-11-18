import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  skippedForPrompt,
  type AgentAnswer,
  type AgentQuestion,
  type ChatItem
} from '@cerebro/core'
import { Check, CircleSlash, CornerDownLeft, MessageCircleQuestion, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  customAnswer,
  finalAnswers,
  hasReview,
  initialStepper,
  isAnswered,
  isFreeText,
  lastStep,
  questionName,
  recordedAnswers,
  reduceStepper,
  type QuestionAnswers,
  type StepperAction,
  type StepperState
} from './question-stepper'

export type ReplyHandler = (id: string, answer: AgentAnswer) => Promise<boolean> | void

const kbdClass =
  'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[4px] border border-foreground/15 bg-muted/60 px-1 font-sans text-[10.5px] leading-none text-muted-foreground'

/** Same teal wash and uniform ring as a selected sidebar row. */
const selectedClass =
  'bg-[color-mix(in_oklch,var(--sidebar-selected)_12%,transparent)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--sidebar-selected)_70%,transparent),0_0_10px_color-mix(in_oklch,var(--sidebar-selected)_25%,transparent)]'

const rowClass = 'flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none'

const navigationKeys = ['Enter', 'Escape', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

function Kbd({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return <kbd className={cn(kbdClass, className)}>{children}</kbd>
}

function Hint({ keys, label }: { keys: string[]; label: string }): React.JSX.Element {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      {label}
    </span>
  )
}

const tabClass = (on: boolean): string =>
  cn(
    'flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground',
    on && 'bg-muted text-foreground'
  )

function QuestionTabs({
  questions,
  state,
  onGo
}: {
  questions: AgentQuestion[]
  state: StepperState
  onGo: (step: number) => void
}): React.JSX.Element {
  return (
    <div role="tablist" aria-label="Questions" className="flex min-w-0 items-center gap-1">
      {questions.map((q, index) => (
        <button
          key={q.id}
          type="button"
          role="tab"
          tabIndex={-1}
          aria-selected={index === state.step}
          data-testid="question-tab"
          onClick={() => onGo(index)}
          className={tabClass(index === state.step)}
        >
          {isAnswered(q, state.answers) ? (
            <Check aria-hidden="true" className="size-3 shrink-0 text-emerald-500" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full bg-muted-foreground/50',
                index === state.step && 'bg-(--sidebar-selected)'
              )}
            />
          )}
          <span className="max-w-32 truncate">{questionName(q, index)}</span>
        </button>
      ))}
      <button
        type="button"
        role="tab"
        tabIndex={-1}
        aria-selected={state.step === questions.length}
        data-testid="question-tab"
        onClick={() => onGo(questions.length)}
        className={tabClass(state.step === questions.length)}
      >
        Review
      </button>
    </div>
  )
}

function QuestionOptions({
  question,
  state,
  input,
  dispatch
}: {
  question: AgentQuestion
  state: StepperState
  input: RefObject<HTMLInputElement | null>
  dispatch: (action: StepperAction) => void
}): React.JSX.Element {
  const options = question.options ?? []
  const custom = customAnswer(question, state.answers)
  const customRow = options.length
  return (
    <div
      role={question.multiple ? 'group' : 'radiogroup'}
      aria-label={question.label}
      className="space-y-1"
    >
      {options.map((option, index) => {
        const on = state.answers[question.id]?.includes(option) ?? false
        const description = question.descriptions?.[option]
        return (
          <button
            key={option}
            type="button"
            tabIndex={-1}
            role={question.multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            aria-label={option}
            data-question-row="true"
            data-testid="question-option"
            data-cursor={index === state.cursor || undefined}
            onClick={() => dispatch({ type: 'pick', index })}
            className={cn(
              rowClass,
              index === state.cursor && !on && 'bg-muted/70',
              on && selectedClass
            )}
          >
            <Kbd className={cn('mt-px', on && 'text-foreground')}>{index + 1}</Kbd>
            <span className="min-w-0 flex-1">
              <span className="block text-sm break-words">{option}</span>
              {description ? (
                <span className="block text-xs break-words text-muted-foreground">
                  {description}
                </span>
              ) : null}
            </span>
            {on ? (
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-(--sidebar-selected)"
              />
            ) : null}
          </button>
        )
      })}
      {state.editing ? (
        <div
          data-testid="question-custom"
          data-cursor="true"
          className={cn(rowClass, 'items-center', custom ? selectedClass : 'bg-muted/70')}
        >
          <Kbd>{customRow + 1}</Kbd>
          <input
            ref={input}
            autoFocus
            aria-label={`Other answer: ${question.label}`}
            value={custom ?? ''}
            onChange={(e) => dispatch({ type: 'custom', text: e.target.value })}
            onBlur={(e) => {
              if (
                !e.currentTarget.closest('[data-testid="question-card"]')?.contains(e.relatedTarget)
              )
                dispatch({ type: 'editing', editing: false })
            }}
            placeholder="Type your own answer…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          data-question-row="true"
          data-testid="question-custom"
          data-cursor={state.cursor === customRow || undefined}
          onClick={() => dispatch({ type: 'pick', index: customRow })}
          className={cn(
            rowClass,
            'items-center',
            state.cursor === customRow && !custom && 'bg-muted/70',
            custom && selectedClass
          )}
        >
          <Kbd>{customRow + 1}</Kbd>
          <span
            className={cn(
              'flex min-w-0 items-center gap-2 text-sm',
              !custom && 'text-muted-foreground'
            )}
          >
            <span className="truncate">{custom || 'Type something else…'}</span>
            {custom ? null : <Pencil aria-hidden="true" className="size-3.5 shrink-0" />}
          </span>
        </button>
      )}
    </div>
  )
}

function QuestionReview({
  questions,
  answers,
  onGo
}: {
  questions: AgentQuestion[]
  answers: QuestionAnswers
  onGo: (step: number) => void
}): React.JSX.Element {
  return (
    <>
      <p className="mb-3 text-[15px] font-medium">Review your answers</p>
      <ul
        data-testid="question-review"
        className="divide-y divide-border/70 rounded-lg border border-border/70"
      >
        {questions.map((q, index) => {
          const done = isAnswered(q, answers)
          return (
            <li key={q.id} className="flex items-baseline gap-4 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                {questionName(q, index)}
              </span>
              <span className={cn('min-w-0 flex-1 break-words', !done && 'text-destructive')}>
                {done ? finalAnswers([q], answers)[q.id].join(', ') : 'Not answered'}
              </span>
              <Button
                variant="ghost"
                size="xs"
                type="button"
                aria-label={`Edit ${questionName(q, index)}`}
                onClick={() => onGo(index)}
              >
                Edit
              </Button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function QuestionFooter({
  question,
  count,
  escArmed,
  atEnd,
  onSkip,
  onNext
}: {
  question: AgentQuestion | undefined
  count: number
  escArmed: boolean
  atEnd: boolean
  onSkip: () => void
  onNext: () => void
}): React.JSX.Element {
  const choices = question && !isFreeText(question) ? (question.options?.length ?? 0) + 1 : 0
  return (
    <div
      data-testid="question-hints"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground"
    >
      {escArmed ? (
        <span role="status" className="flex items-center gap-1 text-foreground">
          Press <Kbd>Esc</Kbd> again to skip {count > 1 ? 'these questions' : 'this question'}
        </span>
      ) : (
        <>
          {choices ? (
            <>
              <Hint keys={['↑', '↓']} label="move" />
              <Hint keys={[`1–${choices}`]} label="pick" />
              {question?.multiple ? <Hint keys={['Space']} label="toggle" /> : null}
            </>
          ) : null}
          {count > 1 ? <Hint keys={['←', '→']} label="question" /> : null}
          <Hint keys={['↵']} label={atEnd ? 'submit' : 'next'} />
          <Hint keys={['Esc ×2']} label="skip" />
        </>
      )}
      <span className="flex-1" />
      <Button variant="ghost" size="xs" type="button" onClick={onSkip}>
        Skip
      </Button>
      <Button size="xs" type="button" onClick={onNext}>
        {atEnd ? (count > 1 ? 'Submit answers' : 'Submit answer') : 'Next'}
        <CornerDownLeft aria-hidden="true" />
      </Button>
    </div>
  )
}

export function QuestionCard({
  item,
  onReply
}: {
  item: ChatItem
  onReply: ReplyHandler
}): React.JSX.Element {
  const request = item.request!
  const questions: AgentQuestion[] = request.questions ?? []
  const [state, setState] = useState(initialStepper)
  const submitting = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const question = questions[state.step]
  const freeText = question ? isFreeText(question) : false
  const typing = state.editing || freeText

  const reply = async (answer: AgentAnswer): Promise<void> => {
    if (submitting.current) return
    submitting.current = true
    try {
      await onReply(request.id, answer)
    } finally {
      submitting.current = false
    }
  }
  // Clicks keep focus on the card so the next key press still drives it.
  const dispatch = (action: StepperAction): void => {
    working.current = Boolean(root.current?.contains(document.activeElement))
    const result = reduceStepper(state, action, questions)
    setState(result.state)
    if (['pick', 'go', 'next'].includes(action.type) && !result.state.editing) root.current?.focus()
    if (result.outcome === 'submit')
      void reply({ allow: true, answers: finalAnswers(questions, result.state.answers) })
    if (result.outcome === 'decline') void reply({ allow: false, answers: {} })
  }
  const onGo = (step: number): void => dispatch({ type: 'go', step })

  // Follow the step into the text field, but only once the user is already working in the card.
  // Checked at dispatch time: leaving the field unmounts it, which drops focus to the body first.
  useEffect(() => {
    if (!working.current) return
    if (typing) input.current?.focus()
    else root.current?.focus()
  }, [typing, state.step])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    const inField = target === input.current
    if (!inField && target !== event.currentTarget && !target.dataset.questionRow) return
    const key = event.key === 'Spacebar' ? ' ' : event.key
    const handled = inField
      ? key === 'Enter' || key === 'Escape' || (key === 'ArrowUp' && !freeText)
      : navigationKeys.includes(key) || /^[1-9]$/.test(key)
    if (!handled || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    dispatch({ type: 'key', key })
  }

  return (
    <div
      ref={root}
      tabIndex={0}
      role="group"
      aria-label="Agent question"
      data-testid="question-card"
      data-step={state.step}
      onKeyDown={onKeyDown}
      className="overflow-hidden rounded-xl border bg-muted/20 outline-none transition-shadow focus-within:shadow-[0_0_0_1px_color-mix(in_oklch,var(--sidebar-selected)_55%,transparent),0_0_22px_color-mix(in_oklch,var(--sidebar-selected)_18%,transparent)] motion-reduce:transition-none"
    >
      <div className="flex min-w-0 items-center gap-1 border-b border-border/70 px-2 py-1.5">
        <MessageCircleQuestion
          aria-hidden="true"
          className="mx-1.5 size-3.5 shrink-0 text-muted-foreground"
        />
        {hasReview(questions) ? (
          <>
            <QuestionTabs questions={questions} state={state} onGo={onGo} />
            <span className="ml-auto shrink-0 pr-2 text-xs text-muted-foreground tabular-nums">
              {Math.min(state.step + 1, questions.length)} / {questions.length}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">The agent is asking</span>
        )}
      </div>

      <div className="px-4 pt-4 pb-3">
        {question ? (
          <>
            <p className="text-[15px] font-medium break-words">{question.label}</p>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
              {freeText ? 'Type an answer' : question.multiple ? 'Pick any that apply' : 'Pick one'}
            </p>
            {freeText ? (
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background/40 px-3 py-2 focus-within:border-ring">
                <input
                  ref={input}
                  aria-label={`Answer: ${question.label}`}
                  value={state.answers[question.id]?.[0] ?? ''}
                  onChange={(e) => dispatch({ type: 'custom', text: e.target.value })}
                  placeholder="Type your answer…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <CornerDownLeft aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </div>
            ) : (
              <QuestionOptions
                question={question}
                state={state}
                input={input}
                dispatch={dispatch}
              />
            )}
          </>
        ) : (
          <QuestionReview questions={questions} answers={state.answers} onGo={onGo} />
        )}
        {state.error ? (
          <p role="alert" data-testid="question-error" className="mt-3 text-xs text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>

      <QuestionFooter
        question={question}
        count={questions.length}
        escArmed={state.escArmed}
        atEnd={state.step >= lastStep(questions)}
        onSkip={() => void reply({ allow: false, answers: {} })}
        onNext={() => dispatch({ type: 'next' })}
      />
    </div>
  )
}

/** A settled question request: the answers as chips, or why there are none. */
export function QuestionAnswered({ item }: { item: ChatItem }): React.JSX.Element {
  const questions = item.request?.questions ?? []
  const answers = recordedAnswers(item.text)
  if (!answers)
    return (
      <p
        data-testid="question-skipped"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <CircleSlash aria-hidden="true" className="size-3.5" />
        {item.text === skippedForPrompt
          ? 'Skipped · you sent a new message instead'
          : item.text === 'Declined'
            ? 'Skipped · the agent continued without your answer'
            : 'Not answered · the question closed when the turn ended'}
      </p>
    )
  return (
    <section
      aria-label="Your answers"
      data-testid="question-answered"
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      <span className="mr-1 flex items-center gap-1.5 text-muted-foreground">
        <Check aria-hidden="true" className="size-3.5 text-emerald-500" /> Answered
      </span>
      {questions.map((q, index) => (
        <span
          key={q.id}
          title={q.label}
          className="max-w-full truncate rounded-full border border-border bg-muted/40 px-2.5 py-1"
        >
          <span className="text-muted-foreground">
            {questions.length > 1 || q.header ? `${questionName(q, index)}: ` : ''}
          </span>
          {(answers[q.id] ?? []).join(', ') || '—'}
        </span>
      ))}
    </section>
  )
}
