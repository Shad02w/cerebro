# Multi-agent chat integration research

Research date: 2026-09-12. Source inspection, not runtime validation of the compared applications. No implementation changes.

Planning update: the agreed direction is now a custom Cerebro chat UI, with Chat as a tab and pane kind. See the [consolidated high-level plan](agent-chat-plan.md), which supersedes this document's earlier assistant-ui recommendation and narrows initial delivery to Claude Code, Codex, and Pi RPC.

## Recommendation

Cerebro should own a transport-independent agent-session contract, implemented by native harness adapters and a shared ACP adapter. A daemon owns running sessions; the GUI renders normalized transcript items. WebSockets can carry that contract to browser, mobile, or remote clients, but are not themselves the normalization layer.

Start with Codex app-server, Claude Agent SDK, and Pi RPC. Add ACP for Cursor CLI, Grok Build, and other compatible agents. Claude subscription reuse is technically supported through the native runtime; see the updated authentication findings below.

## Scope and reproducibility

The [awesome-agent-orchestrators list](https://github.com/andyrewlee/awesome-agent-orchestrators) was used for discovery. It includes terminal products and custom agent loops as well as GUI clients of existing agents, so its provider counts are not equivalent capabilities.

Five relevant GUI projects were cloned and their adapter, protocol, and runtime source inspected:

| Project  | Inspected commit                           | Main pattern                                                                        |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| T3 Code  | `0e0ddaeedf30698bec131caf040a8e8d7b2e3f37` | Native and ACP adapters, normalized runtime events, orchestration, WebSocket RPC    |
| MonoCode | `36d6d28f50ec8ba1d7e12729e1f9a54cf383751f` | TypeScript harness registry and events; Tauri process bridge                        |
| Waku     | `968d42dd38b78d28f46c36abb3d00410a4759957` | Rust drivers; daemon-owned sessions; client RPC and event replay                    |
| Paseo    | `d1b705a0cd91617a5707fae25d80cb0be3057950` | AgentClient/AgentSession interfaces; native and ACP integrations; daemon transports |
| Kandev   | `df3c9142ab02a6c56f9e68fb3d6a836b8c5817d4` | ACP-only chat adapter factory, with provider compatibility logic                    |

This is a targeted architectural sample, not a claim that every project in the list was audited. Main-branch source can differ from installed releases. Coder's Mux, now Xum, was also checked at README level to distinguish its custom agent loop from native-agent GUI wrapping.

## What the implementations actually do

### T3 Code

Its [ProviderAdapter contract](https://github.com/pingdotgg/t3code/blob/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37/apps/server/src/provider/Services/ProviderAdapter.ts) defines session startup, sending and interrupting turns, approvals, structured questions, history, rollback, and a canonical event stream. Capabilities distinguish in-session model switching, promptless continuation, and conversation rollback.

[ClaudeAdapter](https://github.com/pingdotgg/t3code/blob/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37/apps/server/src/provider/Layers/ClaudeAdapter.ts) uses the Claude Agent SDK, including an explicit executable path, configuration sources, partial messages, resume identity, and permission callbacks. [CodexAdapter](https://github.com/pingdotgg/t3code/blob/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37/apps/server/src/provider/Layers/CodexAdapter.ts) maps app-server events. Cursor and Grok integrations use ACP with agent-specific translation.

The [WebSocket server](https://github.com/pingdotgg/t3code/blob/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37/apps/server/src/ws.ts) is separate from those adapters. An orchestration engine and event store sit between runtime events and client state. Its [provider constraints](https://github.com/pingdotgg/t3code/blob/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37/docs/internals/providers.md) explicitly separate driver kind from configured account instance.

Lesson: normalize protocol behavior before orchestration and UI. Keep accounts and runtime ownership separate from the integration's name.

### MonoCode

[HarnessAdapter](https://github.com/hardbeat920/monocode/blob/36d6d28f50ec8ba1d7e12729e1f9a54cf383751f/src/lib/harness/registry.ts) is a comparatively small registry contract: send, steer, cancel, approve, answer, bind, stop, forget, and discover models. Optional operations expose differences between agents.

[HarnessEvent](https://github.com/hardbeat920/monocode/blob/36d6d28f50ec8ba1d7e12729e1f9a54cf383751f/src/lib/harness/types.ts) contains message/reasoning deltas, tool updates, approvals, questions, plans, and context usage. [applyHarnessEvent](https://github.com/hardbeat920/monocode/blob/36d6d28f50ec8ba1d7e12729e1f9a54cf383751f/src/lib/harness/apply.ts) projects those events into common transcript blocks.

The [child-process bridge](https://github.com/hardbeat920/monocode/blob/36d6d28f50ec8ba1d7e12729e1f9a54cf383751f/src/lib/harness/child.ts) uses Tauri invoke/listen, stdout events, and SSE events. The GUI normalization does not require a WebSocket boundary. Native protocol modules handle Codex app-server, Claude streaming JSON, Pi RPC, and ACP integrations.

Lesson: useful minimal adapter and transcript-reducer examples. For Cerebro, place equivalent mutable adapter state in the persistent host service rather than coupling it to renderer lifetime.

### Waku

[Core drivers](https://github.com/egoist/waku/blob/968d42dd38b78d28f46c36abb3d00410a4759957/crates/waku-core/src/driver/mod.rs) dispatch to Codex app-server, Claude streaming JSON, Pi RPC, ACP, and OpenCode HTTP/SSE implementations. Its [wire conversion](https://github.com/egoist/waku/blob/968d42dd38b78d28f46c36abb3d00410a4759957/crates/waku-protocol/src/driver_wire.rs) serializes shared events for text, tool activity, permissions, questions, usage, and completion.

Current [desktop proxy code](https://github.com/egoist/waku/blob/968d42dd38b78d28f46c36abb3d00410a4759957/src/driver/mod.rs) starts or attaches to daemon-owned runtimes. The [server](https://github.com/egoist/waku/blob/968d42dd38b78d28f46c36abb3d00410a4759957/crates/waku-core/src/server.rs) has per-session mailboxes, runtime identities, sequence counters, bounded replay journals, and WebSocket connections. Runtime ownership is independent of a particular connection.

Its provider documentation contains older app-owned lifecycle wording; the current daemon and proxy code take precedence for this comparison. The inspected replay journal is bounded in-memory state; it must not be confused with proof of durable event recovery across daemon restart.

Lesson: especially relevant to Cerebro's persistent mux architecture. Distinguish a logical session, a process/runtime generation, and a client attachment.

### Paseo

[AgentClient and AgentSession](https://github.com/getpaseo/paseo/blob/d1b705a0cd91617a5707fae25d80cb0be3057950/packages/server/src/server/agent/agent-sdk-types.ts) separate discovery/session creation from live conversation operations. The contract includes subscriptions, streamed history, permission requests, interruption, model/mode changes, optional steering, and opaque persistence handles.

Its [registry](https://github.com/getpaseo/paseo/blob/d1b705a0cd91617a5707fae25d80cb0be3057950/packages/server/src/server/agent/provider-registry.ts) wires Claude SDK, Codex app-server, Pi RPC, OpenCode, and ACP clients. [WebSocket transport](https://github.com/getpaseo/paseo/blob/d1b705a0cd91617a5707fae25d80cb0be3057950/packages/client/src/daemon-client-websocket-transport.ts) is a separate client module. Generic toggle/select features let the UI expose provider controls without hard-coding every option.

Lesson: strong reference for extensible adapters, runtime catalogs, remote clients, and preserving native session handles.

### Kandev

The current [adapter factory](https://github.com/kdlbs/kandev/blob/df3c9142ab02a6c56f9e68fb3d6a836b8c5817d4/apps/backend/internal/agentctl/server/adapter/factory.go) accepts ACP only. Its [AgentAdapter interface](https://github.com/kdlbs/kandev/blob/df3c9142ab02a6c56f9e68fb3d6a836b8c5817d4/apps/backend/internal/agentctl/server/adapter/adapter.go) covers connecting pipes, initialization, session creation/loading, prompting, cancellation, permissions, and event updates. Claude and Codex agent definitions select external ACP bridges. Terminal passthrough remains a separate mode.

ACP does not remove semantic differences. Kandev's [shell-output normalization](https://github.com/kdlbs/kandev/blob/df3c9142ab02a6c56f9e68fb3d6a836b8c5817d4/apps/backend/internal/agentctl/server/adapter/transport/acp/shell_output.go) and [decision record](https://github.com/kdlbs/kandev/blob/df3c9142ab02a6c56f9e68fb3d6a836b8c5817d4/docs/decisions/0036-normalize-acp-shell-output-at-adapter-boundary.md) handle cumulative versus delta output, terminal metadata, truncation, and nullable exit codes. A completed tool does not necessarily mean a successful shell command.

Lesson: ACP-first is viable, but compatibility code still belongs at the adapter boundary, and unavailable upstream data cannot be reconstructed reliably.

## Harness, provider, model, and account are different identities

Use separate fields for:

- **Harness:** Claude Code, Codex, Pi, Cursor CLI, Grok Build. Owns tools, context, agent loop, and native session format.
- **Model provider:** the service selected through that harness, such as OpenAI, Anthropic, xAI, or an endpoint supported by Pi.
- **Model:** an opaque identifier scoped to that provider/harness configuration.
- **Instance:** executable/version, host, account profile, environment, and configuration.

Four of the five inspected GUI projects mix native and ACP integrations. That is the dominant pattern in this sample, not a market-share estimate.

[Xum's README](https://github.com/coder/xum) explicitly describes a custom agent loop with multiple model backends. That solves a different problem: calling a Claude model through an app-owned loop does not preserve Claude Code's complete behavior, configuration, or native sessions.

Use runtime model discovery where supported, with marked fallback catalogs. [T3's model manifest design](https://github.com/pingdotgg/t3code/blob/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37/docs/internals/model-manifest.md) illustrates this split: Codex discovers models through app-server, while Claude uses a validated manifest. Preserve option IDs, defaults, and descriptions; do not assume all agents share the same reasoning levels or that account access follows a static model list.

## Protocol choices for Cerebro

| Integration             | Suggested starting point                       | Reason                                                                                             |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Codex                   | app-server over stdio                          | Rich bidirectional session, history, approval, and event protocol                                  |
| Claude                  | TypeScript Agent SDK                           | Typed integration for a TypeScript host, configuration, streaming, permissions, and session resume |
| Pi                      | `pi --mode rpc`                                | Controls the user's installed Pi, supports structured events and native RPC controls               |
| Cursor CLI / Grok Build | Shared ACP client plus agent-specific mappings | Existing GUI implementations demonstrate this route                                                |
| OpenCode                | Native HTTP/SSE or ACP                         | Choose based on required features and tested adapter parity                                        |
| Additional ACP agents   | ACP adapter with negotiated capabilities       | Expands coverage without a new framing/parser implementation per agent                             |

[Official Codex documentation](https://learn.chatgpt.com/docs/app-server) identifies app-server as the rich-client integration path and documents stdio, WebSocket, schemas, and bidirectional requests. Its WebSocket transport is currently labeled experimental/unsupported. Prefer local stdio underneath Cerebro's own transport boundary.

[Claude SDK documentation](https://code.claude.com/docs/en/agent-sdk/overview) distinguishes the coding-agent runtime from the ordinary API client. Direct streaming JSON is another observed approach, used by Waku and MonoCode, but requires owning its protocol compatibility work.

[Pi RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) is the native integration reference. Inspect and test extension interactions against the chosen Pi version; neither Pi RPC nor ACP guarantees arbitrary terminal UI extensions will render unchanged in a chat GUI.

[ACP](https://agentclientprotocol.com/protocol/v1/overview) standardizes initialization, capabilities, sessions, prompts, updates, permissions, and optional client filesystem/terminal methods. Use its concepts, but retain a Cerebro-owned domain model for workspace identity, persistence, reconnect, and artifacts. An ACP-only MVP is reasonable if its tested feature set suffices; the hybrid approach better matches the requested native-agent fidelity.

## Proposed Cerebro boundary

```text
Chat pane / transcript / composer
              |
       Cerebro client contract
              |
Electron preload IPC -> local socket     Future web/remote client -> WebSocket
              |                                      |
              +------------ Agent service -----------+
                            | session state
                            | transcript persistence
                            | approval routing
                            | subscriptions / replay
                            |
                    Harness adapter registry
                    /       |       |       \
              Codex      Claude     Pi       ACP
              stdio       SDK      RPC    Cursor/Grok/...
```

The current checkout already has standalone ownership in `packages/mux`, an Electron bridge in `apps/desktop/src/main/mux.ts`, and typed layout in `packages/core/src/panes.ts`. Pane kinds currently include terminal and changes. `packages/mux/src/protocol.ts` uses bounded length-framed JSON over Node sockets, not WebSockets.

Proposed structure, not implemented:

- `packages/agent-protocol`: commands, events, transcript items, capability and model schemas.
- `packages/agent-runtime`: adapter registry, live sessions, turn serialization, persistence/recovery coordination.
- `packages/agent-runtime/adapters`: Codex, Claude, Pi, shared ACP support.
- `packages/mux`: host/supervise the agent service beside the existing terminal service; preserve one owner of shared storage.
- Desktop main/preload: expose typed agent operations and subscriptions.
- Renderer chat components: render the normalized transcript; attach a chat pane to a session ID.

Package names are a proposal. The essential boundary is agent session ownership outside Electron and outside a pane's mount lifetime. A pane references a session; it is not the session itself.

## What to normalize

Commands should cover create/resume, send, cancel, respond-to-permission, answer-question, set-options, and subscribe. Steering, compaction, fork, and rewind should be explicit capabilities, not pretend universal operations.

Events should cover text/reasoning blocks, tool start/update/result, plans, permissions, questions, usage, artifacts, and lifecycle outcomes. Use stable session/turn/item IDs, a runtime generation, event sequence, request correlation, and schema version. Preserve native IDs and bounded provider metadata for debugging and extensions.

Store a normalized transcript separately from the native resume handle. Native history preserves the harness's execution context; normalized history supports consistent rendering and replay. Switching models within a harness may preserve its session. Switching harnesses should create a new native session with an explicit context handoff, not claim seamless native continuity.

For rich output, use MIME-typed artifact references, filenames, sizes, and host-owned retrieval. Do not put every image or large command output into the event log. Render text, code, images, file diffs, and supported diagrams through shared components; unknown content gets a readable fallback. Do not execute arbitrary generated HTML in a privileged Electron renderer.

Distinguish display events from executable requests. A native tool notification says what the harness already did. Only an explicitly negotiated client-owned operation, such as an ACP terminal request, authorizes the client service to execute it.

## WebSockets and persistence

WebSockets are appropriate for a shared desktop/web/mobile service interface if that is an immediate requirement. They do not provide durable sessions, exactly-once prompts, replay, or provider normalization automatically. For the first local Electron milestone, the existing IPC/socket route avoids a transport migration.

Regardless of transport, implement reconnect cursors, snapshot fallback, bounded queues, and idempotent client command IDs. Persist acceptance before acknowledging a prompt where feasible. If the native dispatch outcome is unknown after a crash, surface that uncertainty instead of replaying a potentially destructive prompt. A reconnect attaches to a running session; a resume reconstructs a session after its runtime ended.

Serialize lifecycle commands per session. Keep permission replies available while cancellation is pending. Track canceled-turn events so a delayed cancellation cannot kill a replacement turn. On restart, only restore interactive requests that still have a valid native reply channel; otherwise reconcile or mark them interrupted.

## Claude subscription reuse: corrected findings

The initial research overstated the restriction by relying on the SDK overview alone. Anthropic's [Help Center update dated June 16, with a June 15 correction](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) explicitly says Agent SDK, `claude -p`, and third-party app usage continue drawing from subscription limits. The proposed separate monthly SDK credit was paused; the older material below that update is historical, not the active change.

The [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) still contains conflicting third-party login language. That inconsistency does not justify saying subscription reuse is impossible or requires API keys in all cases. Current billing guidance supports subscription-backed native runtime use; it is not a guarantee about future terms or every hosted redistribution arrangement.

The implementation mechanism is to let Claude Code authenticate its own subprocess, rather than extracting an OAuth token and using it as an ordinary Anthropic API key:

- T3 Code passes the resolved Claude binary to the Agent SDK via `pathToClaudeCodeExecutable`. Its [ClaudeHome implementation](https://github.com/pingdotgg/t3code/blob/0e0ddaeedf30698bec131caf040a8e8d7b2e3f37/apps/server/src/provider/Drivers/ClaudeHome.ts) inherits the environment by default and preserves HOME when configuring an instance, specifically so macOS Keychain OAuth lookup still works. It tells signed-out users to run `claude auth login` on the execution host.
- Paseo's [Claude session implementation](https://github.com/getpaseo/paseo/blob/d1b705a0cd91617a5707fae25d80cb0be3057950/packages/server/src/server/agent/providers/claude/agent.ts) also selects the executable for the SDK, enables partial messages, loads Claude configuration sources, and supplies native session binding and permission callbacks.
- Waku's [Claude driver](https://github.com/egoist/waku/blob/968d42dd38b78d28f46c36abb3d00410a4759957/crates/waku-core/src/driver/claude.rs) launches the CLI with streaming JSON on stdin/stdout. Its command environment helper restores the environment expected by a terminal-launched app. MonoCode similarly spawns the installed executable using its [Claude protocol argument builder](https://github.com/hardbeat920/monocode/blob/36d6d28f50ec8ba1d7e12729e1f9a54cf383751f/src/lib/harness/claudeProtocol.ts).

[Claude authentication documentation](https://code.claude.com/docs/en/team) documents saved subscription login, credential precedence, and `claude setup-token` for noninteractive hosts. For Cerebro's local desktop flow, prefer the user's saved native login. Detect conflicting API/cloud credentials and expose the selected authentication mode; do not silently turn a subscription session into API billing. Preserve the real user HOME and let Claude own refresh and credential storage.

Keep credentials host-side and scope catalogs/sessions to the configured instance. Let the native agent own its credentials and refresh lifecycle where supported. Confirm supported authentication for each shipped integration separately.

## Chat UI library and message projection

Yes, add a UI integration layer above normalized events. The flow is: native event -> harness adapter -> Cerebro event -> transcript reducer/store -> UI message projection -> component renderer. The reducer owns event ordering, stable tool/item identity, and delta/final reconciliation. The library renders the resulting state and routes user actions back to Cerebro.

Primary candidate: [assistant-ui ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store). It accepts externally owned state and custom message conversion, matching Cerebro's daemon-owned sessions. Keep the durable schema independent of assistant-ui. Supply send/cancel callbacks and custom renderers for command output, diffs, permissions, questions, plans, and artifacts. Do not enable edit/retry/branch controls unless the native adapter supports their actual semantics. Keep authoritative follow-up queues in the host rather than duplicating them in the UI library.

Alternative: [Vercel AI Elements](https://elements.ai-sdk.dev/) provides composable chat and agent UI components. Its [Tool](https://elements.ai-sdk.dev/components/tool) and [Confirmation](https://elements.ai-sdk.dev/components/confirmation) components cover tool states and approval presentation. This gives more direct ownership of transcript rendering but requires Cerebro to assemble more state and interaction behavior. Some props use AI SDK UI types; translate at the presentation boundary rather than replacing the native agent runtime with an AI SDK model loop.

Neither library automatically understands Claude, Codex, or Pi's raw events or every custom artifact. Use ordinary message parts for text, reasoning, and images; custom renderers for file diffs, command execution, plans, questions, and subagent trees; a generic fallback for unknown tool types. Approval responses must retain their native request/option identities and travel back through the harness adapter.

Recommendation: prototype assistant-ui's external-store integration with a representative recorded transcript before choosing it permanently. Include interleaved tools/text, streaming partial input, an approval, a question, a large diff, history reload, and cancellation. The library must also respect Cerebro's always-available submit controls and host-owned session lifecycle.

## First implementation milestone

Build one chat flow using Codex, Claude, and Pi behind the same contract. Verify streaming text, command/file tools, images, cancellation, native resume, pane switching, Electron reload, daemon restart, and prompt deduplication. Verify approvals/questions where the provider supports them and display capability-based limitations where it does not. Then add one ACP agent to test whether the abstraction generalizes.

Use recorded provider frames for adapter mapping tests, including delta/final deduplication, missing exit codes, rejected approvals, late cancellation, and unknown events. Add focused real Electron coverage for the chat pane. Separately run opt-in native-provider smoke tests against explicit versions/accounts; fixture tests alone do not prove integration compatibility.

No tests were run for this research-only document. Existing uncommitted application changes were left untouched.
