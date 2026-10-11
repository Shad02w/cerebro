import { todoListId, type TodoItem, type TodoSnapshot, type TodoStatus } from '@cerebro/core'

type RecordValue = Record<string, unknown>

const todoTools = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TodoWrite'])

const asRecord = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const field = (input: RecordValue, ...keys: string[]): unknown => {
  for (const key of keys) if (key in input) return input[key]
  return undefined
}

const asStatus = (value: unknown): TodoStatus | 'deleted' | undefined =>
  value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted'
    ? value
    : undefined

/** `null` means the call did not mention the phrase. */
const activeLabel = (input: RecordValue): string | undefined | null => {
  if (!('activeForm' in input) && !('active_form' in input)) return null
  return text(input.activeForm ?? input.active_form)
}

const row = (id: string, label: string, status: TodoStatus, phrase?: string): TodoItem => ({
  id,
  label,
  status,
  ...(phrase ? { activeLabel: phrase } : {})
})

/**
 * Codex `turn/plan/updated` as one session checklist.
 * A step has no provider id, so `id` is its index. `inProgress` becomes `in_progress`.
 * Returns undefined when the notification names a different thread.
 */
export function codexTodoSnapshot(
  sessionId: string,
  threadId: string | undefined,
  params: { threadId?: unknown; explanation?: unknown; plan?: unknown }
): TodoSnapshot | undefined {
  if (params.threadId && threadId && params.threadId !== threadId) return undefined
  const plan = Array.isArray(params.plan) ? params.plan : []
  const items = plan.map((step, index): TodoItem => {
    const entry = asRecord(step) ?? {}
    const status =
      entry.status === 'inProgress' || entry.status === 'in_progress'
        ? 'in_progress'
        : entry.status === 'completed'
          ? 'completed'
          : 'pending'
    return row(String(index), typeof entry.step === 'string' ? entry.step : '', status)
  })
  const explanation = text(params.explanation)
  return {
    kind: 'todo',
    listId: todoListId(sessionId),
    items,
    ...(explanation ? { explanation } : {})
  }
}

const inferTool = (raw: unknown): string | undefined => {
  const result = asRecord(raw)
  if (!result) return
  const task = asRecord(result.task)
  if (task && 'id' in task && !('status' in task)) return 'TaskCreate'
  if (Array.isArray(result.tasks)) return 'TaskList'
  if (Array.isArray(result.newTodos)) return 'TodoWrite'
  if (typeof result.taskId === 'string') return 'TaskUpdate'
  return undefined
}

/**
 * Folds Claude task tools into one checklist and emits the whole list.
 * Task ids arrive on `tool_use_result`; until then a create is held under its tool-use id.
 */
export class ClaudeTodoList {
  private items: TodoItem[]
  private readonly tools = new Map<string, string>()
  /** Tool-use id → task id, once `tool_use_result` has named the task. */
  private readonly alias = new Map<string, string>()

  constructor(
    private readonly sessionId: string,
    items: readonly TodoItem[] = []
  ) {
    this.items = items.map((item) => ({ ...item }))
  }

  known(toolUseId: string): boolean {
    return this.tools.has(toolUseId)
  }

  input(toolUseId: string, name: string, raw: unknown): TodoSnapshot | undefined {
    if (!todoTools.has(name)) return undefined
    this.tools.set(toolUseId, name)
    const input = asRecord(raw) ?? {}
    if (name === 'TaskCreate') return this.create(toolUseId, input)
    if (name === 'TaskUpdate') return this.update(input)
    if (name === 'TodoWrite') return this.replace(input.todos)
    return undefined
  }

  result(toolUseId: string, raw: unknown): TodoSnapshot | undefined {
    const name = this.tools.get(toolUseId) ?? inferTool(raw)
    if (!name || !todoTools.has(name)) return undefined
    this.tools.set(toolUseId, name)
    const result = asRecord(raw)
    if (!result) return undefined
    if (name === 'TaskCreate') return this.created(toolUseId, result)
    if (name === 'TaskUpdate') return this.updated(result)
    if (name === 'TaskList') return this.listed(result)
    if (name === 'TodoWrite') return this.replace(result.newTodos)
    return undefined
  }

  private snapshot(): TodoSnapshot {
    return {
      kind: 'todo',
      listId: todoListId(this.sessionId),
      items: this.items.map((item) => ({ ...item }))
    }
  }

  private create(toolUseId: string, input: RecordValue): TodoSnapshot {
    const id = this.alias.get(toolUseId) ?? toolUseId
    const label = text(field(input, 'subject', 'content')) ?? ''
    const phrase = activeLabel(input)
    const index = this.items.findIndex((item) => item.id === id)
    if (index === -1) {
      this.items.push(row(id, label, 'pending', phrase ?? undefined))
    } else {
      const current = this.items[index]
      this.items[index] = row(
        current.id,
        label || current.label,
        current.status,
        phrase === null ? current.activeLabel : phrase
      )
    }
    return this.snapshot()
  }

  private created(toolUseId: string, result: RecordValue): TodoSnapshot | undefined {
    const task = asRecord(result.task)
    const taskId = text(task?.id) ?? (task?.id != null ? String(task.id) : undefined)
    if (!taskId) return undefined
    this.alias.set(toolUseId, taskId)
    const held = this.items.findIndex((item) => item.id === toolUseId)
    const real = this.items.findIndex((item) => item.id === taskId)
    const label = text(task?.subject)
    if (held !== -1) {
      const current = this.items[held]
      this.items[held] = row(taskId, label ?? current.label, current.status, current.activeLabel)
      if (real !== -1 && real !== held) this.items.splice(real, 1)
    } else if (real !== -1) {
      const current = this.items[real]
      this.items[real] = row(taskId, label ?? current.label, current.status, current.activeLabel)
    } else {
      this.items.push(row(taskId, label ?? '', 'pending'))
    }
    return this.snapshot()
  }

  private update(input: RecordValue): TodoSnapshot | undefined {
    const rawId = field(input, 'taskId', 'task_id', 'id')
    const id = rawId == null ? '' : String(rawId)
    if (!id) return undefined
    const status = asStatus(field(input, 'status'))
    const index = this.items.findIndex((item) => item.id === id)
    if (status === 'deleted') {
      if (index === -1) return undefined
      this.items.splice(index, 1)
      return this.snapshot()
    }
    const label = text(field(input, 'subject', 'content'))
    const phrase = activeLabel(input)
    if (index === -1) {
      if (!label) return undefined
      this.items.push(row(id, label, status ?? 'pending', phrase ?? undefined))
      return this.snapshot()
    }
    const current = this.items[index]
    this.items[index] = row(
      id,
      label ?? current.label,
      status ?? current.status,
      phrase === null ? current.activeLabel : phrase
    )
    return this.snapshot()
  }

  private updated(result: RecordValue): TodoSnapshot | undefined {
    if (result.success === false) return undefined
    const taskId = result.taskId == null ? '' : String(result.taskId)
    if (!taskId) return undefined
    const change = asRecord(result.statusChange)
    const status = asStatus(change?.to)
    const index = this.items.findIndex((item) => item.id === taskId)
    if (status === 'deleted') {
      if (index === -1) return undefined
      this.items.splice(index, 1)
      return this.snapshot()
    }
    if (!status || index === -1) return undefined
    const current = this.items[index]
    this.items[index] = row(taskId, current.label, status, current.activeLabel)
    return this.snapshot()
  }

  private listed(result: RecordValue): TodoSnapshot | undefined {
    if (!Array.isArray(result.tasks)) return undefined
    const previous = new Map(this.items.map((item) => [item.id, item]))
    this.items = result.tasks.flatMap((entry) => {
      const task = asRecord(entry)
      if (!task || task.id == null) return []
      const id = String(task.id)
      const status = asStatus(task.status)
      if (status === 'deleted') return []
      const kept = previous.get(id)
      return [
        row(
          id,
          text(task.subject) ?? kept?.label ?? '',
          status ?? kept?.status ?? 'pending',
          kept?.activeLabel
        )
      ]
    })
    return this.snapshot()
  }

  private replace(raw: unknown): TodoSnapshot | undefined {
    if (!Array.isArray(raw)) return undefined
    this.items = raw.map((entry, index) => {
      const todo = asRecord(entry) ?? {}
      const status = asStatus(todo.status)
      return row(
        String(index),
        text(todo.content) ?? text(todo.subject) ?? '',
        status && status !== 'deleted' ? status : 'pending',
        text(todo.activeForm ?? todo.active_form)
      )
    })
    return this.snapshot()
  }
}
