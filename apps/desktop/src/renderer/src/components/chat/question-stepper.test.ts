import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentQuestion } from '@cerebro/core'
import {
  finalAnswers,
  initialStepper,
  recordedAnswers,
  reduceStepper,
  type StepperAction,
  type StepperResult,
  type StepperState
} from './question-stepper'

const storage: AgentQuestion = {
  id: '0',
  label: 'Where?',
  header: 'Storage',
  options: ['Mux database', 'JSON files']
}
const harnesses: AgentQuestion = {
  id: '1',
  label: 'Which?',
  header: 'Harnesses',
  options: ['Claude Code', 'Codex', 'Pi'],
  multiple: true
}
const name: AgentQuestion = { id: '2', label: 'Name it?' }

function run(
  questions: AgentQuestion[],
  actions: Array<StepperAction | string>,
  from: StepperState = initialStepper()
): StepperResult {
  let result: StepperResult = { state: from }
  for (const action of actions) {
    result = reduceStepper(
      result.state,
      typeof action === 'string' ? { type: 'key', key: action } : action,
      questions
    )
    if (result.outcome) return result
  }
  return result
}

test('arrow keys move the cursor down to the free-text row and back', () => {
  const result = run([storage], ['ArrowDown', 'ArrowDown', 'ArrowDown'])
  assert.equal(result.state.cursor, 2)
  assert.equal(run([storage], ['ArrowDown', 'ArrowUp', 'ArrowUp']).state.cursor, 0)
})

test('a single question is not submitted by picking, only by Enter or Next', () => {
  const picked = run([storage], ['2'])
  assert.deepEqual(picked.state.answers, { '0': ['JSON files'] })
  assert.equal(picked.state.step, 0)
  assert.equal(picked.outcome, undefined)
  assert.equal(run([storage], ['2', 'Enter']).outcome, 'submit')
  assert.equal(run([storage], ['ArrowDown', 'Enter']).state.answers['0'][0], 'JSON files')
})

test('a single choice moves on when there is another question; multi-select toggles with digits and Space', () => {
  const result = run([storage, harnesses, name], ['1', '1', 'ArrowDown', ' ', ' ', ' '])
  assert.equal(result.state.step, 1)
  assert.deepEqual(result.state.answers, { '0': ['Mux database'], '1': ['Claude Code', 'Codex'] })
})

test('the full keyboard flow walks to Review and submits there', () => {
  const questions = [storage, harnesses, name]
  const typed = run(questions, ['Enter', '2', 'Enter', { type: 'custom', text: ' 0042 ' }, 'Enter'])
  assert.equal(typed.state.step, 3)
  const done = run(questions, ['Enter'], typed.state)
  assert.equal(done.outcome, 'submit')
  assert.deepEqual(finalAnswers(questions, done.state.answers), {
    '0': ['Mux database'],
    '1': ['Codex'],
    '2': ['0042']
  })
})

test('Enter on an unanswered question shows an inline error instead of moving on', () => {
  const free = run([name], ['Enter'])
  assert.equal(free.outcome, undefined)
  assert.match(free.state.error ?? '', /Type an answer/)
  const multi = run([harnesses, name], [{ type: 'next' }])
  assert.match(multi.state.error ?? '', /Choose an option/)
  assert.equal(run([harnesses, name], [{ type: 'next' }, '1']).state.error, null)
})

test('submitting from Review jumps to the first unanswered question', () => {
  const result = run([storage, harnesses], [{ type: 'go', step: 2 }, 'Enter'])
  assert.equal(result.outcome, undefined)
  assert.equal(result.state.step, 0)
  assert.equal(result.state.error, 'Answer “Storage” before submitting.')
})

test('Esc must be pressed twice to skip, and any other key disarms it', () => {
  assert.equal(run([storage], ['Escape']).state.escArmed, true)
  assert.equal(run([storage], ['Escape']).outcome, undefined)
  assert.equal(run([storage], ['Escape', 'Escape']).outcome, 'decline')
  assert.equal(run([storage], ['Escape', 'ArrowDown', 'Escape']).outcome, undefined)
})

test('the free-text row edits a custom answer that replaces a single choice and joins a multi-select', () => {
  const single = run([storage], ['1', '3', { type: 'custom', text: 'SQLite elsewhere' }])
  assert.equal(single.state.editing, true)
  assert.deepEqual(single.state.answers, { '0': ['SQLite elsewhere'] })
  // Esc while editing leaves the row instead of arming skip.
  const left = run([storage], ['Escape'], single.state)
  assert.equal(left.state.editing, false)
  assert.equal(left.state.escArmed, false)
  const multi = run([harnesses], ['1', '4', { type: 'custom', text: 'Gemini' }])
  assert.deepEqual(multi.state.answers, { '1': ['Claude Code', 'Gemini'] })
})

test('digits and arrows type into the free-text row instead of picking', () => {
  const editing = run([storage], ['3'])
  assert.equal(editing.state.editing, true)
  const after = run([storage], ['1', 'ArrowDown', 'ArrowLeft'], editing.state)
  assert.deepEqual(after.state.answers, {})
  assert.equal(after.state.editing, true)
})

test('left and right switch questions only when there is more than one', () => {
  assert.equal(run([storage, harnesses], ['ArrowRight', 'ArrowRight', 'ArrowRight']).state.step, 2)
  assert.equal(run([storage, harnesses], [{ type: 'go', step: 2 }, 'ArrowLeft']).state.step, 1)
  assert.equal(run([storage], ['ArrowRight']).state.step, 0)
  // On a free-text question the arrows move the caret, so they stay put.
  assert.equal(run([storage, name], ['ArrowRight', 'ArrowRight']).state.step, 1)
})

test('going back to an answered question puts the cursor on its choice', () => {
  const result = run([storage, name], ['2', { type: 'go', step: 0 }])
  assert.equal(result.state.cursor, 1)
})

test('recordedAnswers reads the stored reply and rejects anything else', () => {
  assert.deepEqual(recordedAnswers('{"0":["Blue"],"1":["a",2]}'), { '0': ['Blue'], '1': ['a'] })
  assert.equal(recordedAnswers('Declined'), null)
  assert.equal(recordedAnswers('{oops'), null)
  assert.equal(recordedAnswers(''), null)
})
