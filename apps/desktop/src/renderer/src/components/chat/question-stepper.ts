import type { AgentQuestion } from '@cerebro/core'

export type QuestionAnswers = Record<string, string[]>

/**
 * One pending question request, shown one question at a time. `step` equals `questions.length`
 * on the Review step, which exists only for more than one question. `cursor` equals the option
 * count on the "Type something else" row.
 */
export type StepperState = {
  step: number
  cursor: number
  editing: boolean
  escArmed: boolean
  error: string | null
  answers: QuestionAnswers
}

export type StepperAction =
  | { type: 'key'; key: string }
  | { type: 'pick'; index: number }
  | { type: 'go'; step: number }
  | { type: 'custom'; text: string }
  | { type: 'editing'; editing: boolean }
  | { type: 'next' }

export type StepperResult = { state: StepperState; outcome?: 'submit' | 'decline' }

export const initialStepper = (): StepperState => ({
  step: 0,
  cursor: 0,
  editing: false,
  escArmed: false,
  error: null,
  answers: {}
})

export const hasReview = (questions: readonly AgentQuestion[]): boolean => questions.length > 1

export const lastStep = (questions: readonly AgentQuestion[]): number =>
  hasReview(questions) ? questions.length : questions.length - 1

export const isFreeText = (question: AgentQuestion): boolean => !question.options?.length

export const isAnswered = (question: AgentQuestion, answers: QuestionAnswers): boolean =>
  (answers[question.id] ?? []).some((value) => value.trim())

/** The typed answer, if any: a value that is not one of the offered options. */
export const customAnswer = (
  question: AgentQuestion,
  answers: QuestionAnswers
): string | undefined =>
  (answers[question.id] ?? []).find((value) => !question.options?.includes(value))

export const questionName = (question: AgentQuestion, index: number): string =>
  question.header?.trim() || `Question ${index + 1}`

/** Trimmed, non-empty values for every question, as the reply sends them. */
export function finalAnswers(
  questions: readonly AgentQuestion[],
  answers: QuestionAnswers
): QuestionAnswers {
  return Object.fromEntries(
    questions.map((q) => [
      q.id,
      (answers[q.id] ?? []).flatMap((value) => (value.trim() ? [value.trim()] : []))
    ])
  )
}

function go(state: StepperState, questions: readonly AgentQuestion[], step: number): StepperState {
  const next = Math.max(0, Math.min(lastStep(questions), step))
  const question = questions[next]
  const chosen = question?.options?.findIndex((o) => state.answers[question.id]?.includes(o)) ?? -1
  return { ...state, step: next, cursor: Math.max(0, chosen), editing: false, error: null }
}

function submit(state: StepperState, questions: readonly AgentQuestion[]): StepperResult {
  const missing = questions.findIndex((q) => !isAnswered(q, state.answers))
  if (missing < 0) return { state: { ...state, error: null }, outcome: 'submit' }
  return {
    state: {
      ...go(state, questions, missing),
      error: `Answer “${questionName(questions[missing], missing)}” before submitting.`
    }
  }
}

function next(state: StepperState, questions: readonly AgentQuestion[]): StepperResult {
  const question = questions[state.step]
  if (question && !isAnswered(question, state.answers))
    return {
      state: {
        ...state,
        error: isFreeText(question)
          ? 'Type an answer, or press Esc twice to skip.'
          : 'Choose an option or type an answer.'
      }
    }
  if (state.step < lastStep(questions)) return { state: go(state, questions, state.step + 1) }
  return submit(state, questions)
}

function setAnswer(state: StepperState, question: AgentQuestion, values: string[]): StepperState {
  return { ...state, error: null, answers: { ...state.answers, [question.id]: values } }
}

/** Selects or toggles one row. A single choice moves on when there is another question. */
function pick(
  state: StepperState,
  questions: readonly AgentQuestion[],
  index: number,
  advance: boolean
): StepperState {
  const question = questions[state.step]
  const options = question?.options ?? []
  if (!question || index < 0 || index > options.length) return state
  if (index === options.length) return { ...state, cursor: index, editing: true }
  const label = options[index]
  const values = state.answers[question.id] ?? []
  if (question.multiple)
    return {
      ...setAnswer(
        state,
        question,
        values.includes(label) ? values.filter((v) => v !== label) : [...values, label]
      ),
      cursor: index,
      editing: false
    }
  const picked = { ...setAnswer(state, question, [label]), cursor: index, editing: false }
  return advance && hasReview(questions) ? go(picked, questions, state.step + 1) : picked
}

function key(
  state: StepperState,
  questions: readonly AgentQuestion[],
  name: string
): StepperResult {
  const question = questions[state.step]
  const typing = state.editing || (question != null && isFreeText(question))
  if (name === 'Escape') {
    if (state.editing && question && !isFreeText(question))
      return { state: { ...state, editing: false } }
    if (state.escArmed) return { state: { ...state, escArmed: false }, outcome: 'decline' }
    return { state: { ...state, escArmed: true } }
  }
  const s = { ...state, escArmed: false }
  if (name === 'Enter') {
    if (!question) return submit(s, questions)
    if (typing) return next(s, questions)
    const options = question.options ?? []
    if (s.cursor === options.length) return { state: { ...s, editing: true } }
    if (question.multiple) {
      if (!(s.answers[question.id] ?? []).length)
        return { state: pick(s, questions, s.cursor, false) }
      return next(s, questions)
    }
    return next(pick(s, questions, s.cursor, false), questions)
  }
  if (name === 'ArrowLeft' || name === 'ArrowRight') {
    if (typing || !hasReview(questions)) return { state: s }
    return { state: go(s, questions, s.step + (name === 'ArrowLeft' ? -1 : 1)) }
  }
  if (!question || isFreeText(question)) return { state: s }
  const rows = (question.options ?? []).length
  if (name === 'ArrowUp') {
    if (s.editing) return { state: { ...s, editing: false, cursor: rows - 1 } }
    return { state: { ...s, cursor: Math.max(0, s.cursor - 1) } }
  }
  if (s.editing) return { state: s }
  if (name === 'ArrowDown') return { state: { ...s, cursor: Math.min(rows, s.cursor + 1) } }
  if (name === ' ') return { state: pick(s, questions, s.cursor, false) }
  if (/^[1-9]$/.test(name)) return { state: pick(s, questions, Number(name) - 1, true) }
  return { state: s }
}

export function reduceStepper(
  state: StepperState,
  action: StepperAction,
  questions: readonly AgentQuestion[]
): StepperResult {
  switch (action.type) {
    case 'key':
      return key(state, questions, action.key)
    case 'pick':
      return { state: pick({ ...state, escArmed: false }, questions, action.index, true) }
    case 'go':
      return { state: go({ ...state, escArmed: false }, questions, action.step) }
    case 'editing':
      return { state: { ...state, editing: action.editing } }
    case 'next':
      return next({ ...state, escArmed: false }, questions)
    case 'custom': {
      const question = questions[state.step]
      if (!question) return { state }
      const chosen = (state.answers[question.id] ?? []).filter((v) => question.options?.includes(v))
      return {
        state: {
          ...setAnswer(
            state,
            question,
            question.multiple ? [...chosen, action.text] : [action.text]
          ),
          editing: !isFreeText(question)
        }
      }
    }
  }
}

/** Answers recorded on a resolved request item, or null when it holds none. */
export function recordedAnswers(text: string): QuestionAnswers | null {
  if (!text.trim().startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return Object.fromEntries(
      Object.entries(parsed).map(([id, values]) => [
        id,
        Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : []
      ])
    )
  } catch {
    return null
  }
}
