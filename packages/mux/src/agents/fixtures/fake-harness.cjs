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
let accessSettings
let finishApproval
const text =
  '**Adapter connected.**\n\n- Native tools stay with the harness.\n- Cerebro renders the conversation.'
const codexDone = () =>
  notify('turn/completed', {
    threadId: 'thread-test',
    turn: { id: 'turn-test', status: 'completed' }
  })
function codexPrompt(prompt, input) {
  if (prompt.includes('attachments')) {
    notify('item/completed', {
      item: { type: 'agentMessage', id: 'attachments', text: JSON.stringify(input) }
    })
    codexDone()
    return
  }
  if (prompt === 'access-settings') {
    notify('item/completed', {
      item: { type: 'agentMessage', id: 'access', text: JSON.stringify(accessSettings) }
    })
    codexDone()
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
  if (prompt.includes('attachments')) {
    claudeFinish(JSON.stringify(content))
    return
  }
  if (prompt === 'access-settings') {
    claudeFinish(JSON.stringify(process.argv.slice(2)))
    return
  }
  send({ type: 'system', subtype: 'init', session_id: 'claude-test', tools: [], model: 'test' })
  if (prompt.includes('slow')) return
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
    }
  } else if (mode === 'pi') {
    const reply = (data) =>
      send({ type: 'response', command: frame.type, id: frame.id, success: true, data })
    switch (frame.type) {
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
      case 'set_model':
      case 'set_thinking_level':
      case 'abort':
        reply({})
        break
      case 'prompt': {
        const responseText =
          frame.message === 'access-settings'
            ? JSON.stringify(process.argv.slice(2))
            : frame.message.includes('attachments')
              ? JSON.stringify({ message: frame.message, images: frame.images })
              : text
        reply({})
        send({ type: 'message_start', message: { role: 'assistant' } })
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
    if (frame.type === 'control_request')
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: frame.request_id,
          response: {
            models: [{ value: 'test-model', displayName: 'Test Model' }],
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
