#!/usr/bin/env node
// Deterministic native-protocol fixture; no network or model credentials are used.
const { createInterface } = require('node:readline')
const mode = process.argv.includes('app-server')
  ? 'codex'
  : process.argv.includes('rpc')
    ? 'pi'
    : 'claude'
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const notify = (method, params) => send({ method, params })
let resume = false
let backgroundStarted = 0
const backgroundLive = new Map()
let accessSettings
let finishApproval
const text =
  '**Adapter connected.**\n\n- Native tools stay with the harness.\n- Cerebro renders the conversation.'
const codexDone = () => {
  notify('thread/tokenUsage/updated', {
    threadId: 'thread-test',
    turnId: 'turn-test',
    tokenUsage: {
      // Lifetime sum is intentionally larger than the latest call so a reader of `total` fails.
      total: { totalTokens: 295697, inputTokens: 280000, outputTokens: 15697 },
      last: { totalTokens: 43759, inputTokens: 42000, outputTokens: 1759 },
      modelContextWindow: 258400
    }
  })
  notify('turn/completed', {
    threadId: 'thread-test',
    turn: { id: 'turn-test', status: 'completed' }
  })
}
function codexPrompt(prompt, input) {
  if (prompt.includes('skill-wire')) {
    notify('item/completed', {
      item: { type: 'agentMessage', id: 'skills', text: JSON.stringify(input) }
    })
    codexDone()
    return
  }
  if (prompt.includes('attachments')) {
    notify('item/completed', {
      item: { type: 'agentMessage', id: 'attachments', text: JSON.stringify(input) }
    })
    codexDone()
    return
  }
  if (prompt.startsWith('markdown-rich ')) {
    const image = prompt.slice('markdown-rich '.length)
    const rich = [
      '## Rich reply',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| alpha | 1 |',
      '',
      '```ts',
      'const answer: number = 42',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      `![local shot](${image})`,
      '',
      '![remote shot](https://example.invalid/remote.png)'
    ].join('\n')
    notify('item/completed', { item: { type: 'agentMessage', id: 'rich', text: rich } })
    codexDone()
    return
  }
  if (prompt === 'pid') {
    notify('item/completed', {
      item: { type: 'agentMessage', id: 'pid', text: String(process.pid) }
    })
    codexDone()
    return
  }
  if (prompt === 'background-command' || prompt === 'background-command-fail') {
    const failed = prompt.endsWith('-fail')
    // Unified exec yields a long-running command: its item outlives the turn and completes later.
    const command = { type: 'commandExecution', id: 'bg-command', command: 'sleep 1; pwd' }
    notify('item/started', { item: { ...command, aggregatedOutput: '' } })
    notify('item/completed', {
      item: { type: 'agentMessage', id: 'bg-reply', text: 'Started in the background.' }
    })
    codexDone()
    setTimeout(() => {
      notify('item/commandExecution/outputDelta', { itemId: 'bg-command', delta: '/tmp\n' })
      notify('item/completed', {
        item: {
          ...command,
          status: failed ? 'failed' : 'completed',
          aggregatedOutput: '/tmp\n',
          exitCode: failed ? 3 : 0,
          durationMs: 1000
        }
      })
    }, 50)
    return
  }
  if (prompt === 'access-settings') {
    notify('item/completed', {
      item: { type: 'agentMessage', id: 'access', text: JSON.stringify(accessSettings) }
    })
    codexDone()
    return
  }
  if (prompt === 'plan-foreign') {
    notify('turn/plan/updated', {
      threadId: 'thread-other',
      explanation: 'Ignore this plan.',
      plan: [{ step: 'Do not keep', status: 'pending' }]
    })
    codexDone()
    return
  }
  if (prompt === 'plan-replace') {
    notify('turn/plan/updated', {
      threadId: 'thread-test',
      explanation: 'First pass.',
      plan: [{ step: 'One', status: 'pending' }]
    })
    notify('turn/plan/updated', {
      threadId: 'thread-test',
      explanation: 'Second pass.',
      plan: [
        { step: 'One', status: 'completed' },
        { step: 'Two', status: 'inProgress' }
      ]
    })
    notify('turn/plan/updated', {
      threadId: 'thread-other',
      plan: [{ step: 'Ignored', status: 'pending' }]
    })
    codexDone()
    return
  }
  if (prompt === 'plan-clear') {
    notify('turn/plan/updated', {
      threadId: 'thread-test',
      plan: []
    })
    codexDone()
    return
  }
  if (prompt === 'usage-without-last' || prompt === 'usage-without-window') {
    notify('thread/tokenUsage/updated', {
      threadId: 'thread-test',
      turnId: 'turn-test',
      tokenUsage:
        prompt === 'usage-without-last'
          ? {
              total: { totalTokens: 295697, inputTokens: 280000, outputTokens: 15697 },
              modelContextWindow: 258400
            }
          : {
              total: { totalTokens: 295697, inputTokens: 280000, outputTokens: 15697 },
              last: { totalTokens: 43759, inputTokens: 42000, outputTokens: 1759 }
            }
    })
    notify('turn/completed', {
      threadId: 'thread-test',
      turn: { id: 'turn-test', status: 'completed' }
    })
    return
  }
  notify('turn/started', { threadId: 'thread-test', turn: { id: 'turn-test' } })
  notify('item/started', { item: { type: 'agentMessage', id: 'message-test', text: '' } })
  notify('item/agentMessage/delta', {
    itemId: 'message-test',
    delta: resume ? 'Resumed native session. ' : ''
  })
  if (prompt.includes('slow')) return
  if (prompt.includes('approval')) {
    finishApproval = () => {
      notify('item/completed', {
        item: { type: 'agentMessage', id: 'message-test', text: 'Permission resolved.' }
      })
      codexDone()
    }
    send({
      id: 'approval-test',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'git status --short', threadId: 'thread-test' }
    })
    return
  }
  if (prompt.includes('question')) {
    finishApproval = () => {
      notify('item/completed', {
        item: { type: 'agentMessage', id: 'message-test', text: 'Answer received.' }
      })
      codexDone()
    }
    send({
      id: 'question-test',
      method: 'item/tool/requestUserInput',
      params: {
        questions: [
          {
            id: 'color',
            question: 'Choose a color',
            options: [{ label: 'Blue' }, { label: 'Green' }]
          }
        ]
      }
    })
    return
  }
  notify('item/agentMessage/delta', { itemId: 'message-test', delta: text })
  notify('item/completed', {
    item: {
      type: 'agentMessage',
      id: 'message-test',
      text: (resume ? 'Resumed native session. ' : '') + text
    }
  })
  notify('item/started', {
    item: {
      type: 'commandExecution',
      id: 'tool-test',
      command: 'git status --short',
      aggregatedOutput: ''
    }
  })
  notify('item/commandExecution/outputDelta', { itemId: 'tool-test', delta: ' M example.ts' })
  notify('item/completed', {
    item: {
      type: 'commandExecution',
      id: 'tool-test',
      command: 'git status --short',
      aggregatedOutput: ' M example.ts',
      exitCode: 0
    }
  })
  notify('turn/plan/updated', {
    threadId: 'thread-test',
    turnId: 'turn-test',
    explanation: 'Connecting the adapters next.',
    plan: [
      { step: 'Inspect the workspace', status: 'completed' },
      { step: 'Connect the adapters', status: 'inProgress' }
    ]
  })
  notify('turn/diff/updated', {
    diff: 'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-const mode = "terminal"\n+const mode = "chat"'
  })
  codexDone()
}
function claudePrompt(prompt, content) {
  if (prompt.includes('skill-wire')) {
    claudeFinish(prompt)
    return
  }
  if (prompt.includes('attachments')) {
    claudeFinish(JSON.stringify(content))
    return
  }
  if (prompt === 'access-settings') {
    claudeFinish(JSON.stringify(process.argv.slice(2)))
    return
  }
  if (prompt === 'pid') {
    claudeFinish(String(process.pid))
    return
  }
  if (prompt === 'todo-opt-in') {
    claudeFinish(process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS ?? 'unset')
    return
  }
  if (prompt === 'tasks') {
    send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'task-create',
      message: {
        id: 'msg-create',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_create',
            name: 'TaskCreate',
            input: { subject: 'Inspect', activeForm: 'Inspecting the workspace' }
          }
        ]
      }
    })
    send({
      type: 'user',
      session_id: 'claude-test',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_create', content: 'created' }]
      },
      tool_use_result: { task: { id: '1', subject: 'Inspect' } }
    })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'task-update',
      message: {
        id: 'msg-update',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_update',
            name: 'TaskUpdate',
            input: { taskId: '1', status: 'in_progress', activeForm: 'Inspecting the workspace' }
          }
        ]
      }
    })
    send({
      type: 'user',
      session_id: 'claude-test',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_update', content: 'updated' }]
      },
      tool_use_result: {
        success: true,
        taskId: '1',
        updatedFields: ['status', 'activeForm'],
        statusChange: { from: 'pending', to: 'in_progress' }
      }
    })
    claudeFinish('Tasks updated.')
    return
  }
  const background = /^background-task(-fail)?(?: (\d+))?$/.exec(prompt)
  if (background) {
    // Frame order and fields recorded from Claude Code: the full live set, then the task_started
    // edge. Each message starts one more task, so several can run at once.
    const failed = Boolean(background[1])
    const n = ++backgroundStarted
    const suffix = n === 1 ? '' : `-${n}`
    const task = {
      task_id: `task-test${suffix}`,
      task_type: 'local_bash',
      description: n === 1 ? 'Delayed pwd' : `Delayed pwd ${n}`
    }
    const liveSet = () => ({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [...backgroundLive.values()],
      session_id: 'claude-test'
    })
    backgroundLive.set(task.task_id, task)
    send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
    send(liveSet())
    send({
      type: 'system',
      subtype: 'task_started',
      task_id: task.task_id,
      tool_use_id: `tool-bg${suffix}`,
      description: task.description,
      is_backgrounded: true,
      task_type: 'local_bash',
      session_id: 'claude-test'
    })
    claudeFinish('Background task is running.')
    // While idle, the settled task wakes Claude for a follow-up turn nobody sent.
    setTimeout(
      () => {
        backgroundLive.delete(task.task_id)
        send({
          type: 'system',
          subtype: 'task_notification',
          task_id: task.task_id,
          tool_use_id: `tool-bg${suffix}`,
          status: failed ? 'failed' : 'completed',
          summary: failed
            ? `Background command "${task.description}" failed with exit code 3`
            : `Background command "${task.description}" completed (exit code 0)`,
          session_id: 'claude-test'
        })
        send(liveSet())
        send({
          type: 'system',
          subtype: 'init',
          session_id: 'claude-test',
          tools: [],
          model: 'test'
        })
        claudeFinish(
          failed ? 'Background task failed with exit code 3.' : 'Background task finished: /tmp'
        )
      },
      Number(background[2] ?? 50)
    )
    return
  }
  send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
  if (prompt.includes('slow')) return
  if (prompt.includes('steer')) {
    // Folds into the turn without ending it, unlike claudeFinish's terminal `result` frame.
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      event: { type: 'message_start', message: { id: 'message-test' } }
    })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: `[steered: ${prompt}]` }
      }
    })
    return
  }
  if (prompt.includes('skipped-block')) {
    // The thinking block closes in the stream but never gets its own completed `assistant` frame.
    const stream = (event) => send({ type: 'stream_event', session_id: 'claude-test', event })
    stream({ type: 'message_start', message: { id: 'message-skip' } })
    stream({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' }
    })
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'pondering' }
    })
    stream({ type: 'content_block_stop', index: 0 })
    stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ANSWER' } })
    stream({ type: 'content_block_stop', index: 1 })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'skip-1',
      message: {
        id: 'message-skip',
        role: 'assistant',
        content: [{ type: 'text', text: 'ANSWER' }]
      }
    })
    send({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ANSWER',
      session_id: 'claude-test'
    })
    return
  }
  if (prompt.includes('thinking-then-text')) {
    // Real streaming shape: one assistant frame per completed block, each with content[0] only.
    const stream = (event) => send({ type: 'stream_event', session_id: 'claude-test', event })
    stream({ type: 'message_start', message: { id: 'message-think' } })
    stream({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' }
    })
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'pondering' }
    })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'think-1',
      message: {
        id: 'message-think',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'pondering' }]
      }
    })
    stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ANSWER' } })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'think-2',
      message: {
        id: 'message-think',
        role: 'assistant',
        content: [{ type: 'text', text: 'ANSWER' }]
      }
    })
    send({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ANSWER',
      session_id: 'claude-test'
    })
    return
  }
  if (prompt.includes('approval')) {
    finishApproval = () => claudeFinish('Permission resolved.')
    send({
      type: 'control_request',
      request_id: 'claude-approval',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'git status --short' },
        tool_use_id: 'tool-test'
      }
    })
    return
  }
  if (prompt.includes('refusal-fallback')) {
    // The primary model's draft gets refused, then silently retried on a fallback model. The SDK
    // marks the replacement's `supersedes` and later confirms via a `model_refusal_fallback` notice.
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      event: { type: 'message_start', message: { id: 'refused-message' } }
    })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'REFUSED DRAFT' }
      }
    })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'refused-msg',
      message: {
        id: 'refused-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'REFUSED DRAFT' }]
      }
    })
    send({
      type: 'system',
      subtype: 'model_refusal_fallback',
      session_id: 'claude-test',
      uuid: 'refusal-notice',
      retracted_message_uuids: ['refused-msg']
    })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'fallback-msg',
      supersedes: ['refused-msg'],
      message: {
        id: 'fallback-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'FINAL ANSWER' }]
      }
    })
    send({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'FINAL ANSWER',
      session_id: 'claude-test'
    })
    return
  }
  claudeFinish(text)
}
function claudeFinish(value) {
  send({
    type: 'stream_event',
    session_id: 'claude-test',
    event: { type: 'message_start', message: { id: 'message-test' } }
  })
  send({
    type: 'stream_event',
    session_id: 'claude-test',
    event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
  })
  send({
    type: 'stream_event',
    session_id: 'claude-test',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: value } }
  })
  send({
    type: 'assistant',
    session_id: 'claude-test',
    uuid: 'chain-test',
    message: { id: 'message-test', role: 'assistant', content: [{ type: 'text', text: value }] }
  })
  send({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: value,
    session_id: 'claude-test'
  })
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line)
  if (mode === 'codex') {
    if (frame.id === 'approval-test' || frame.id === 'question-test') {
      finishApproval?.()
      return
    }
    const reply = (result) => send({ id: frame.id, result })
    switch (frame.method) {
      case 'initialize':
        reply({})
        break
      case 'skills/list':
        reply({
          data: [
            {
              cwd: frame.params?.cwds?.[0] ?? '/tmp',
              skills: [
                {
                  name: 'review',
                  description: 'Review the change',
                  enabled: true,
                  path: '/tmp/skills/review/SKILL.md',
                  interface: { shortDescription: 'Review the change' }
                },
                { name: 'hidden', description: 'Disabled', enabled: false, path: '/tmp/hidden' }
              ],
              errors: []
            }
          ]
        })
        break
      case 'model/list':
        reply({
          data: ['test-model', 'second-model'].map((id) => ({
            model: id,
            displayName: id === 'test-model' ? 'Test Model' : 'Second Model',
            supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
            inputModalities: id === 'test-model' ? ['text', 'image'] : ['text']
          })),
          nextCursor: null
        })
        break
      case 'thread/resume':
        accessSettings = frame.params
        resume = true
        reply({ thread: { id: 'thread-test' } })
        break
      case 'thread/start':
        accessSettings = frame.params
        reply({ thread: { id: 'thread-test' } })
        break
      case 'turn/start':
        reply({ turn: { id: 'turn-test' } })
        setTimeout(() => codexPrompt(frame.params.input[0].text, frame.params.input), 30)
        break
      case 'turn/interrupt':
        reply({})
        notify('turn/completed', { turn: { id: 'turn-test', status: 'interrupted' } })
        break
      case 'turn/steer':
        reply({})
        notify('item/agentMessage/delta', {
          itemId: 'message-test',
          delta: `[steered: ${frame.params.input[0].text}]`
        })
        break
    }
  } else if (mode === 'pi') {
    const reply = (data) =>
      send({ type: 'response', command: frame.type, id: frame.id, success: true, data })
    switch (frame.type) {
      case 'get_commands':
        reply({
          commands: [
            {
              name: 'skill:review',
              description: 'Review the change',
              source: 'skill',
              sourceInfo: { path: '/tmp/pi/review/SKILL.md' }
            },
            { name: 'fix-tests', description: 'Not a skill', source: 'prompt', path: '/tmp/fix.md' }
          ]
        })
        break
      case 'get_available_models':
        reply({
          models: [
            {
              id: 'test-model',
              provider: 'test-provider',
              name: 'Test Model',
              reasoning: true,
              input: ['text', 'image']
            }
          ]
        })
        break
      case 'get_state':
        reply({ sessionFile: '/tmp/pi-session-test.jsonl' })
        break
      case 'get_session_stats':
        reply({ contextUsage: { tokens: 6000, contextWindow: 200000, percent: 3 } })
        break
      case 'set_model':
      case 'set_thinking_level':
        reply({})
        break
      case 'abort':
        reply({})
        send({
          type: 'message_end',
          message: { role: 'assistant', content: [], stopReason: 'aborted' }
        })
        send({ type: 'agent_end' })
        break
      case 'prompt': {
        if (frame.streamingBehavior === 'steer') {
          reply({})
          send({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              contentIndex: 0,
              delta: `[steered: ${frame.message}]`
            }
          })
          break
        }
        const responseText =
          frame.message === 'access-settings'
            ? JSON.stringify(process.argv.slice(2))
            : frame.message === 'pid'
              ? String(process.pid)
              : frame.message.includes('attachments')
                ? JSON.stringify({ message: frame.message, images: frame.images })
                : frame.message.includes('skill-wire')
                  ? frame.message
                  : text
        reply({})
        send({ type: 'message_start', message: { role: 'assistant' } })
        if (frame.message.includes('slow')) break
        send({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: responseText }
        })
        send({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: responseText }],
            stopReason: 'stop'
          }
        })
        send({ type: 'agent_end' })
        break
      }
    }
  } else {
    if (frame.type === 'control_request' && frame.request?.subtype === 'interrupt') {
      send({
        type: 'control_response',
        response: { subtype: 'success', request_id: frame.request_id, response: {} }
      })
      send({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['[Request interrupted by user]'],
        session_id: 'claude-test'
      })
      return
    }
    if (frame.type === 'control_request' && frame.request?.subtype === 'get_context_usage')
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: frame.request_id,
          response: { totalTokens: 12345, maxTokens: 200000, rawMaxTokens: 200000, percentage: 6 }
        }
      })
    else if (frame.type === 'control_request')
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: frame.request_id,
          response: {
            models: [
              {
                value: 'test-model',
                displayName: 'Test Model',
                description: 'Test Model · fixture',
                resolvedModel: 'test-model-id',
                supportsEffort: true,
                supportedEffortLevels: ['low', 'medium', 'high']
              },
              {
                value: 'sonnet',
                displayName: 'Test Sonnet',
                // Blurb-first description (newer Claude Code) — label must still be the model name.
                description: 'Efficient for routine tasks · $2/$10 per Mtok',
                resolvedModel: 'claude-sonnet-5',
                supportsEffort: true,
                supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
              }
            ],
            commands: [],
            agents: []
          }
        }
      })
    if (frame.type === 'control_response') finishApproval?.()
    if (frame.type === 'user')
      claudePrompt(
        typeof frame.message.content === 'string'
          ? frame.message.content
          : frame.message.content[0].text,
        frame.message.content
      )
  }
})
