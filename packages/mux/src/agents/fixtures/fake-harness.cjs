#!/usr/bin/env node
// Deterministic native-protocol fixture; no network or model credentials are used.
const { createInterface } = require('node:readline')
const { existsSync, readdirSync, readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const mode = process.argv.includes('app-server')
  ? 'codex'
  : process.argv.includes('rpc')
    ? 'pi'
    : 'claude'
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
let codexActive
const codexThreads = new Map()
const codexApprovals = new Map()
let codexSeq = 0
const notify = (method, params = {}) => {
  const body = { ...params }
  if (codexActive) {
    const foreign = typeof body.threadId === 'string' && body.threadId !== 'thread-test'
    body.threadId = foreign ? body.threadId : codexActive
  }
  send({ method, params: body })
}
let backgroundStarted = 0
const backgroundLive = new Map()
let finishApproval
let claudeContextMode = 'default'
let codexContextMode = 'default'
let piContextMode = 'default'
const text =
  '**Adapter connected.**\n\n- Native tools stay with the harness.\n- Cerebro renders the conversation.'
const codexDone = () => {
  const full = codexContextMode === 'full'
  notify('thread/tokenUsage/updated', {
    threadId: 'thread-test',
    turnId: 'turn-test',
    tokenUsage: full
      ? {
          // Lifetime sum is intentionally larger than the latest call so a reader of `total` fails.
          total: { totalTokens: 900000, inputTokens: 800000, outputTokens: 100000 },
          last: {
            totalTokens: 43550,
            inputTokens: 42000,
            cachedInputTokens: 28400,
            cacheWriteInputTokens: 6200,
            outputTokens: 1550,
            reasoningOutputTokens: 480
          },
          modelContextWindow: 258400
        }
      : {
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
function codexPrompt(threadId, prompt, input) {
  if (typeof prompt === 'string' && prompt.includes('context-popover-codex'))
    codexContextMode = 'full'
  codexActive = threadId
  const thread = codexThreads.get(threadId) ?? { resume: false, access: undefined }
  const resume = thread.resume
  const accessSettings = thread.access
  if (prompt === 'crash') process.exit(1)
  if (prompt === 'fatal-error') {
    notify('error', { error: { message: 'Codex rejected the turn.' }, willRetry: false })
    return
  }
  if (prompt === 'retry-then-ok') {
    notify('error', { error: { message: 'Model overloaded.' }, willRetry: true })
    // Leave the alert visible briefly, the way a real overloaded model retries.
    setTimeout(() => codexPrompt(threadId, 'hello', input), 1200)
    return
  }
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
  if (prompt === 'agents-still-running') {
    const childStartedAtMs = 1_700_000_000_000
    notify('item/started', {
      threadId: 'thread-test',
      item: {
        type: 'collabAgentToolCall',
        id: 'collab-live',
        tool: 'spawnAgent',
        status: 'inProgress',
        senderThreadId: 'thread-test',
        receiverThreadIds: ['child-zero', 'child-open', 'child-missing'],
        prompt: 'Search community workflows',
        agentsStates: {
          'child-zero': { status: 'running', startedAtMs: childStartedAtMs },
          'child-open': { status: 'running', startedAtMs: childStartedAtMs }
        }
      }
    })
    notify('item/completed', {
      threadId: 'thread-test',
      item: {
        type: 'collabAgentToolCall',
        id: 'collab-live',
        tool: 'spawnAgent',
        status: 'completed',
        senderThreadId: 'thread-test',
        receiverThreadIds: ['child-zero', 'child-open', 'child-missing'],
        prompt: 'Search community workflows',
        agentsStates: {
          'child-zero': { status: 'completed', durationMs: 0, startedAtMs: childStartedAtMs },
          'child-open': { status: 'running', startedAtMs: childStartedAtMs, durationMs: 16000 }
        }
      }
    })
    notify('item/completed', {
      threadId: 'thread-test',
      item: {
        type: 'subAgentActivity',
        id: 'activity-open',
        kind: 'interacted',
        agentThreadId: 'child-open',
        agentPath: '/root/search-blogs',
        durationMs: 0
      }
    })
    notify('item/completed', {
      item: {
        type: 'agentMessage',
        id: 'still-running',
        text: 'The research agents are running in parallel.'
      }
    })
    codexDone()
    return
  }
  if (prompt === 'subagent') {
    const parentStartedAtMs = Date.now() - 153000
    const childStartedAtMs = 1_700_000_000_000
    notify('item/started', {
      threadId: 'thread-test',
      item: {
        type: 'collabAgentToolCall',
        id: 'collab-1',
        tool: 'spawnAgent',
        status: 'inProgress',
        senderThreadId: 'thread-test',
        receiverThreadIds: ['child-thread', 'other-child'],
        prompt: 'Review the diff',
        model: 'parent-model',
        startedAtMs: parentStartedAtMs,
        agentsStates: {
          'child-thread': {
            status: 'running',
            startedAtMs: childStartedAtMs,
            model: 'gpt-test',
            effort: 'high'
          },
          'other-child': { status: 'running' }
        }
      }
    })
    notify('item/completed', {
      threadId: 'thread-test',
      item: {
        type: 'subAgentActivity',
        id: 'activity-1',
        kind: 'interacted',
        agentThreadId: 'child-thread',
        agentPath: '/root/review-diff'
      }
    })
    // A different thread's usage must not attach to this child, and is not subscribed.
    notify('thread/tokenUsage/updated', {
      threadId: 'thread-other',
      tokenUsage: { total: { totalTokens: 1, inputTokens: 1, outputTokens: 0 } }
    })
    notify('item/completed', {
      threadId: 'thread-other',
      item: {
        type: 'subAgentActivity',
        id: 'activity-foreign',
        kind: 'started',
        agentThreadId: 'foreign-thread',
        agentPath: '/root/ignore-me'
      }
    })
    notify('item/completed', {
      threadId: 'thread-test',
      item: {
        type: 'collabAgentToolCall',
        id: 'collab-1',
        tool: 'wait',
        status: 'completed',
        senderThreadId: 'thread-test',
        receiverThreadIds: ['child-thread', 'other-child'],
        startedAtMs: parentStartedAtMs,
        agentsStates: {
          'child-thread': {
            status: 'completed',
            message: 'reviewed',
            startedAtMs: childStartedAtMs,
            completedAtMs: childStartedAtMs + 153000,
            model: 'gpt-test',
            effort: 'high'
          },
          'other-child': { status: 'running' }
        }
      }
    })
    notify('thread/tokenUsage/updated', {
      threadId: 'child-thread',
      tokenUsage: {
        total: { totalTokens: 18420, inputTokens: 12104, outputTokens: 6316 },
        last: { totalTokens: 10, inputTokens: 8, outputTokens: 2 }
      }
    })
    notify('item/completed', {
      threadId: 'thread-test',
      item: { type: 'agentMessage', id: 'sub-reply', text: 'Review finished.' }
    })
    codexDone()
    return
  }
  if (prompt === 'child-not-turn') {
    notify('item/completed', {
      item: {
        type: 'collabAgentToolCall',
        id: 'collab-late',
        tool: 'spawnAgent',
        status: 'completed',
        senderThreadId: 'thread-test',
        receiverThreadIds: ['child-late'],
        prompt: 'Search tooling',
        agentsStates: {
          'child-late': {
            status: 'completed',
            model: 'gpt-test',
            effort: 'high',
            durationMs: 57000
          }
        }
      }
    })
    notify('item/completed', {
      item: {
        type: 'agentMessage',
        id: 'parent-mid',
        text: 'Parent still writing after the child.'
      }
    })
    setTimeout(() => {
      notify('item/completed', {
        item: {
          type: 'subAgentActivity',
          id: 'activity-late',
          kind: 'interrupted',
          agentThreadId: 'child-late',
          agentPath: '/root/search-tooling'
        }
      })
      notify('item/completed', {
        item: { type: 'agentMessage', id: 'parent-end', text: 'Parent recommendation.' }
      })
      codexDone()
    }, 40)
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
      send({
        method: 'item/commandExecution/outputDelta',
        params: { threadId, itemId: 'bg-command', delta: '/tmp\n' }
      })
      send({
        method: 'item/completed',
        params: {
          threadId,
          item: {
            ...command,
            status: failed ? 'failed' : 'completed',
            aggregatedOutput: '/tmp\n',
            exitCode: failed ? 3 : 0,
            durationMs: 1000
          }
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
    codexApprovals.set('approval-test', () => {
      codexActive = threadId
      notify('item/completed', {
        item: { type: 'agentMessage', id: 'message-test', text: 'Permission resolved.' }
      })
      codexDone()
    })
    send({
      id: 'approval-test',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'git status --short', threadId }
    })
    return
  }
  if (prompt.includes('question')) {
    codexApprovals.set('question-test', () => {
      codexActive = threadId
      notify('item/completed', {
        item: { type: 'agentMessage', id: 'message-test', text: 'Answer received.' }
      })
      codexDone()
    })
    send({
      id: 'question-test',
      method: 'item/tool/requestUserInput',
      params: {
        threadId,
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
  if (typeof prompt === 'string' && prompt.includes('context-popover-full'))
    claudeContextMode = 'full'
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
  if (prompt === 'agents-still-running' || prompt === 'agents-then-finish') {
    const finish = prompt === 'agents-then-finish'
    const agents = [
      {
        task_id: 'agent-community',
        tool_use_id: 'tool-community',
        description: 'Search community workflows',
        model: 'sonnet',
        effort: 'high',
        duration_ms: 29000
      },
      {
        task_id: 'agent-blogs',
        tool_use_id: 'tool-blogs',
        description: 'Search blogs and talks',
        model: 'sonnet',
        effort: 'medium',
        duration_ms: 16000
      },
      {
        task_id: 'agent-github',
        tool_use_id: 'tool-github',
        description: 'Search GitHub repos and tooling',
        duration_ms: 13000
      }
    ]
    send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'spawn-agents',
      message: {
        id: 'msg-spawn-agents',
        role: 'assistant',
        content: agents.map((agent) => ({
          type: 'tool_use',
          id: agent.tool_use_id,
          name: 'Task',
          input: {
            description: agent.description,
            prompt: agent.description,
            run_in_background: true,
            ...(agent.model ? { model: agent.model } : {}),
            ...(agent.effort ? { effort: agent.effort } : {})
          }
        }))
      }
    })
    // The live set and task_started land before the Task tool returns, so the child is already known.
    send({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: agents.map((agent) => ({
        task_id: agent.task_id,
        task_type: 'local_agent',
        description: agent.description,
        tool_use_id: agent.tool_use_id,
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.effort ? { effort: agent.effort } : {})
      })),
      session_id: 'claude-test'
    })
    for (const agent of agents)
      send({
        type: 'system',
        subtype: 'task_started',
        task_id: agent.task_id,
        tool_use_id: agent.tool_use_id,
        description: agent.description,
        task_type: 'local_agent',
        is_backgrounded: true,
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.effort ? { effort: agent.effort } : {}),
        session_id: 'claude-test'
      })
    for (const agent of agents)
      send({
        type: 'user',
        session_id: 'claude-test',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: agent.tool_use_id,
              content: `Agent "${agent.description}" is running in the background.`
            }
          ]
        },
        tool_use_result: {
          status: 'async_launched',
          agentId: agent.task_id,
          description: agent.description,
          prompt: agent.description,
          outputFile: `/tmp/${agent.task_id}.txt`
        }
      })
    for (const agent of agents)
      send({
        type: 'system',
        subtype: 'task_progress',
        task_id: agent.task_id,
        tool_use_id: agent.tool_use_id,
        description: agent.description,
        task_type: 'local_agent',
        usage: { total_tokens: 100, tool_uses: 1, duration_ms: agent.duration_ms },
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.effort ? { effort: agent.effort } : {}),
        session_id: 'claude-test'
      })
    send({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'agent-github',
      tool_use_id: 'tool-github',
      task_type: 'local_agent',
      status: 'completed',
      summary: 'Still searching.',
      description: 'Search GitHub repos and tooling',
      usage: { total_tokens: 1, tool_uses: 0, duration_ms: 0 },
      session_id: 'claude-test'
    })
    if (finish)
      send({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-community',
        tool_use_id: 'tool-community',
        task_type: 'local_agent',
        status: 'completed',
        summary: 'Found the workflows.',
        description: 'Search community workflows',
        usage: { total_tokens: 18420, tool_uses: 4, duration_ms: 31000 },
        model: 'sonnet',
        effort: 'high',
        session_id: 'claude-test'
      })
    else {
      // A completed tool_result is the placeholder handed back to the parent, not the finish.
      send({
        type: 'user',
        session_id: 'claude-test',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-blogs',
              content: 'Blogs report that must stay off the transcript.'
            }
          ]
        },
        tool_use_result: {
          status: 'completed',
          agentId: 'agent-blogs',
          totalDurationMs: 16000,
          description: 'Search blogs and talks',
          model: 'sonnet',
          effort: 'medium'
        }
      })
      // Dropping an agent from one snapshot is not a finish.
      send({
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: agents
          .filter((agent) => agent.task_id !== 'agent-blogs')
          .map((agent) => ({
            task_id: agent.task_id,
            task_type: 'local_agent',
            description: agent.description,
            tool_use_id: agent.tool_use_id
          })),
        session_id: 'claude-test'
      })
    }
    claudeFinish(
      'The research agents are running in parallel. I will consolidate when they report back.'
    )
    return
  }
  if (prompt === 'subagent' || prompt === 'subagent-fail') {
    const failed = prompt === 'subagent-fail'
    send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      uuid: 'subagent-spawn',
      message: {
        id: 'msg-subagent',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-sub',
            name: 'Task',
            input: {
              description: 'Review the diff',
              prompt: 'Look at the auth change.',
              model: 'opus',
              effort: 'max'
            }
          }
        ]
      }
    })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      parent_tool_use_id: 'tool-sub',
      event: { type: 'message_start', message: { id: 'msg-child' } }
    })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      parent_tool_use_id: 'tool-sub',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }
    })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      parent_tool_use_id: 'tool-sub',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Looking at the diff.' }
      }
    })
    send({
      type: 'user',
      session_id: 'claude-test',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-sub',
            is_error: failed,
            content: failed ? 'review failed' : 'reviewed',
            ...(failed
              ? {}
              : { usage: { input_tokens: 12104, output_tokens: 6316, total_tokens: 18420 } })
          }
        ]
      }
    })
    claudeFinish(failed ? 'The review failed.' : 'Review finished.')
    return
  }
  if (prompt === 'agent-and-shell') {
    const tasks = [
      {
        task_id: 'bash-1',
        task_type: 'local_bash',
        description: 'Delayed pwd',
        tool_use_id: 'tool-bash'
      },
      {
        task_id: 'agent-1',
        task_type: 'local_agent',
        description: 'Review the diff',
        tool_use_id: 'tool-sub',
        subagent_type: 'general-purpose',
        model: 'sonnet',
        effort: 'high'
      },
      {
        task_id: 'agent-2',
        task_type: 'remote_agent',
        description: 'Remote review',
        tool_use_id: 'tool-remote'
      }
    ]
    send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
    send({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks,
      session_id: 'claude-test'
    })
    for (const task of tasks)
      send({
        type: 'system',
        subtype: 'task_started',
        task_id: task.task_id,
        tool_use_id: task.tool_use_id,
        description: task.description,
        task_type: task.task_type,
        is_backgrounded: true,
        session_id: 'claude-test'
      })
    send({
      type: 'stream_event',
      session_id: 'claude-test',
      parent_tool_use_id: 'tool-sub',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Looking at the diff.' }
      }
    })
    send({
      type: 'assistant',
      session_id: 'claude-test',
      parent_tool_use_id: 'tool-sub',
      uuid: 'child-tool',
      message: {
        id: 'msg-child-tool',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-web',
            name: 'WebSearch',
            input: { query: 'auth change' }
          }
        ]
      }
    })
    send({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'bash-1',
      description: 'Delayed pwd',
      usage: { total_tokens: 5, tool_uses: 1, duration_ms: 1000 },
      session_id: 'claude-test'
    })
    send({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'agent-1',
      tool_use_id: 'tool-sub',
      description: 'Review the diff',
      subagent_type: 'general-purpose',
      usage: { total_tokens: 100, tool_uses: 2, duration_ms: 120000 },
      model: 'sonnet',
      effort: 'high',
      session_id: 'claude-test'
    })
    send({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'agent-1',
      tool_use_id: 'tool-sub',
      task_type: 'local_agent',
      status: 'completed',
      summary: 'Reviewed the diff.',
      description: 'Review the diff',
      usage: { total_tokens: 18420, tool_uses: 3, duration_ms: 153000 },
      model: 'sonnet',
      effort: 'high',
      session_id: 'claude-test'
    })
    claudeFinish('Review finished.')
    return
  }
  if (prompt === 'one-response') {
    const say = (id, text) =>
      send({
        type: 'assistant',
        session_id: 'claude-test',
        uuid: id,
        message: { id, role: 'assistant', content: [{ type: 'text', text }] }
      })
    const result = () =>
      send({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        session_id: 'claude-test'
      })
    const agents = [
      {
        task_id: 'agent-tooling',
        tool_use_id: 'tool-tooling',
        description: 'Search GitHub repos and tooling',
        model: 'sonnet',
        effort: 'high',
        duration_ms: 57000,
        tokens: 18420
      },
      {
        task_id: 'agent-blogs',
        tool_use_id: 'tool-blogs',
        description: 'Search blogs and talks',
        model: 'sonnet',
        effort: 'medium',
        duration_ms: 42000,
        tokens: 9000
      }
    ]
    const childResult = (toolUseId) =>
      send({
        type: 'result',
        subtype: 'success',
        is_error: false,
        parent_tool_use_id: toolUseId,
        result: 'child report',
        session_id: 'claude-test'
      })
    send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
    say('parent-1', 'Three research agents are running. I will consolidate when they report back.')
    send({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: agents.map((agent) => ({
        task_id: agent.task_id,
        task_type: 'local_agent',
        description: agent.description,
        tool_use_id: agent.tool_use_id,
        model: agent.model,
        effort: agent.effort
      })),
      session_id: 'claude-test'
    })
    for (const agent of agents)
      send({
        type: 'system',
        subtype: 'task_started',
        task_id: agent.task_id,
        tool_use_id: agent.tool_use_id,
        description: agent.description,
        task_type: 'local_agent',
        is_backgrounded: true,
        model: agent.model,
        effort: agent.effort,
        session_id: 'claude-test'
      })
    childResult('tool-tooling')
    setTimeout(() => {
      const first = agents[0]
      send({
        type: 'system',
        subtype: 'task_notification',
        task_id: first.task_id,
        tool_use_id: first.tool_use_id,
        task_type: 'local_agent',
        status: 'completed',
        summary: 'Found the repos.',
        description: first.description,
        usage: { total_tokens: first.tokens, tool_uses: 3, duration_ms: first.duration_ms },
        model: first.model,
        effort: first.effort,
        session_id: 'claude-test'
      })
      say('parent-2', 'Tooling findings. The other agent is still running.')
      childResult('tool-blogs')
      setTimeout(() => {
        const second = agents[1]
        send({
          type: 'system',
          subtype: 'task_notification',
          task_id: second.task_id,
          tool_use_id: second.tool_use_id,
          task_type: 'local_agent',
          status: 'completed',
          summary: 'Found the posts.',
          description: second.description,
          usage: { total_tokens: second.tokens, tool_uses: 2, duration_ms: second.duration_ms },
          model: second.model,
          effort: second.effort,
          session_id: 'claude-test'
        })
        say('parent-3', 'Final recommendation.')
        result()
      }, 40)
    }, 40)
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
const skillNamePattern =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:[/:][A-Za-z0-9][A-Za-z0-9_-]{0,63}){0,8}$/
function claudeFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return {}
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!field) continue
    let value = field[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1)
    fields[field[1]] = value
  }
  return fields
}
function claudeSkillFile(file, fallbackName, qualify) {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const fields = claudeFrontmatter(text)
  if (/^(false|no|0)$/i.test(fields['user-invocable'] ?? '')) return null
  const named = fields.name?.trim()
  let name = named && skillNamePattern.test(named) ? named : fallbackName
  if (qualify && !name.includes(':') && !name.includes('/')) name = `${qualify}:${name}`
  if (!skillNamePattern.test(name)) return null
  return {
    name,
    description: (fields.description ?? '').replace(/\s+/g, ' ').trim(),
    argumentHint: '',
    path: file
  }
}
function claudeEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
function collectClaudeDir(root, found) {
  for (const entry of claudeEntries(join(root, '.claude', 'skills'))) {
    if (!entry.isDirectory()) continue
    const file = join(root, '.claude', 'skills', entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const skill = claudeSkillFile(file, entry.name)
    if (skill && !found.has(skill.name)) found.set(skill.name, skill)
  }
  for (const entry of claudeEntries(join(root, '.claude', 'commands'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const skill = claudeSkillFile(
      join(root, '.claude', 'commands', entry.name),
      entry.name.slice(0, -3)
    )
    if (skill && !found.has(skill.name)) found.set(skill.name, skill)
  }
  for (const plugin of claudeEntries(join(root, '.claude', 'plugins'))) {
    if (!plugin.isDirectory()) continue
    for (const entry of claudeEntries(join(root, '.claude', 'plugins', plugin.name, 'skills'))) {
      if (!entry.isDirectory()) continue
      const file = join(root, '.claude', 'plugins', plugin.name, 'skills', entry.name, 'SKILL.md')
      if (!existsSync(file)) continue
      const skill = claudeSkillFile(file, entry.name, plugin.name)
      if (skill && !found.has(skill.name)) found.set(skill.name, skill)
    }
  }
}
function claudeProjectRoots(cwd) {
  const start = resolve(cwd)
  const chain = [start]
  let current = start
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(current, '.git'))) return chain
    const parent = dirname(current)
    if (parent === current) break
    current = parent
    chain.push(current)
  }
  return [start]
}
/** Skills this fixture reports as the ones Claude Code exposed for its cwd, including plugin skills. */
function claudeSkillList() {
  const found = new Map()
  const cwd = process.cwd()
  const home = process.env.CEREBRO_SKILL_HOME || homedir()
  for (const root of claudeProjectRoots(cwd)) collectClaudeDir(root, found)
  if (resolve(home) !== resolve(cwd)) collectClaudeDir(home, found)
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name))
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
    if (codexApprovals.has(frame.id)) {
      const finish = codexApprovals.get(frame.id)
      codexApprovals.delete(frame.id)
      finish()
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
        if (frame.params.threadId === 'missing-thread') {
          send({ id: frame.id, error: { code: -32000, message: 'Thread not found.' } })
          break
        }
        {
          const id = frame.params.threadId || `thread-${++codexSeq}`
          codexThreads.set(id, { resume: true, access: frame.params })
          reply({ thread: { id } })
        }
        break
      case 'thread/start':
        {
          const id = `thread-${++codexSeq}`
          codexThreads.set(id, { resume: false, access: frame.params })
          reply({ thread: { id } })
        }
        break
      case 'turn/start':
        reply({ turn: { id: 'turn-test' } })
        setTimeout(
          () => codexPrompt(frame.params.threadId, frame.params.input[0].text, frame.params.input),
          30
        )
        break
      case 'turn/interrupt':
        reply({})
        codexActive = frame.params.threadId
        notify('turn/completed', {
          turn: { id: frame.params.turnId ?? 'turn-test', status: 'interrupted' }
        })
        break
      case 'turn/steer':
        reply({})
        codexActive = frame.params.threadId
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
        reply(
          piContextMode === 'empty'
            ? { contextUsage: { tokens: null, contextWindow: 200000, percent: null } }
            : { contextUsage: { tokens: 6000, contextWindow: 200000, percent: 3 } }
        )
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
        if (typeof frame.message === 'string' && frame.message.includes('context-popover-empty'))
          piContextMode = 'empty'
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
        if (frame.message === 'pi-not-end') {
          reply({})
          send({ type: 'message_start', message: { role: 'assistant' } })
          send({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              contentIndex: 0,
              delta: 'Parent still writing.'
            }
          })
          send({
            type: 'tool_execution_end',
            toolCallId: 'tool-1',
            toolName: 'read',
            result: 'file',
            isError: false
          })
          setTimeout(() => {
            send({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Parent done.' }
            })
            send({
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [
                  { type: 'text', text: 'Parent still writing.' },
                  { type: 'text', text: 'Parent done.' }
                ],
                stopReason: 'stop'
              }
            })
            send({ type: 'agent_end' })
          }, 40)
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
    if (frame.type === 'control_request' && frame.request?.subtype === 'reload_skills') {
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: frame.request_id,
          response: { skills: claudeSkillList() }
        }
      })
      return
    }
    if (frame.type === 'control_request' && frame.request?.subtype === 'get_context_usage')
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: frame.request_id,
          response:
            claudeContextMode === 'full'
              ? {
                  totalTokens: 70800,
                  maxTokens: 200000,
                  rawMaxTokens: 200000,
                  percentage: 35,
                  model: 'claude-sonnet-5',
                  isAutoCompactEnabled: true,
                  categories: [
                    { name: 'System prompt', tokens: 4400, color: 'purple', kind: 'used' },
                    { name: 'System tools', tokens: 12800, color: 'blue', kind: 'used' },
                    { name: 'MCP tools', tokens: 3200, color: 'cyan', kind: 'used' },
                    { name: 'Custom agents', tokens: 1600, color: 'pink', kind: 'used' },
                    { name: 'Memory files', tokens: 2200, color: 'yellow', kind: 'used' },
                    { name: 'Skills', tokens: 1200, color: 'green', kind: 'used' },
                    { name: 'Messages', tokens: 45400, color: 'blend', kind: 'used' },
                    { name: 'Unused skills', tokens: 0, color: 'green', kind: 'used' },
                    { name: 'Free space', tokens: 116200, color: 'gray', kind: 'free' },
                    { name: 'Autocompact buffer', tokens: 13000, color: 'gray', kind: 'buffer' },
                    {
                      name: 'MCP tools (deferred)',
                      tokens: 6420,
                      color: 'gray',
                      kind: 'deferred',
                      isDeferred: true
                    }
                  ],
                  messageBreakdown: {
                    userMessageTokens: 8600,
                    assistantMessageTokens: 11200,
                    toolCallTokens: 4800,
                    toolResultTokens: 18400,
                    attachmentTokens: 2400,
                    redirectedContextTokens: 0,
                    unattributedTokens: 0,
                    toolCallsByType: [],
                    attachmentsByType: []
                  },
                  apiUsage: {
                    input_tokens: 1,
                    output_tokens: 1,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0
                  }
                }
              : { totalTokens: 12345, maxTokens: 200000, rawMaxTokens: 200000, percentage: 6 }
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
