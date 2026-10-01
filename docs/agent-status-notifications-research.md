# Agent status and system notifications: research

Research date: 2026-09-13. Source inspection of the current checkout, the Electron 39 `Notification` API, and the ACP prompt-turn specification. No implementation changes and no tests were run.

Goal: give every chat session a well-defined status (working, blocked, finished, and related states) across the native harness adapters and a future ACP adapter, and deliver OS-level notifications whose click brings the user to the exact workspace, tab, and pane.

## 1. Recommendation in short

1. **Keep `AgentSession.status` as the lifecycle enum and let the session service own it.** The service in `packages/mux/src/agents/service.ts` already sets `running`, `waiting`, `idle`, `failed`, and `interrupted` at the right moments. Adapters do not need to invent a status; they only need to keep emitting requests and terminal outcomes accurately, which they already do. Add a small, optional adapter delta for finer phases.
2. **Add an "attention" record beside the lifecycle status.** `idle` today means both "never ran" and "turn finished". A separate `attention` field (`blocked`, `finished`, `failed`, `interrupted`, with `seen`) gives the UI and the notifier an unread signal without changing the lifecycle enum or breaking existing tests.
3. **Emit explicit status-transition events from the mux, separate from the coalesced `chat` invalidation.** Notifications must not be reconstructed from 100 ms debounced snapshots in the renderer.
4. **The Electron main process owns OS notifications.** It already holds the mux client (`apps/desktop/src/main/mux.ts`), the window, and the app lifecycle. `Notification` is a main-process API.
5. **Reuse the existing focus pipeline for deep links.** `layout.command {action:'focus'}` already activates a tab and pane in mux state and publishes a `focus` event that the renderer turns into workspace selection. A notification click needs window restore plus that one command, with a fallback that reopens a session whose pane was closed.

## 2. What exists today

### 2.1 Session status

`packages/core/src/chat.ts` defines `AgentSession.status: 'idle' | 'running' | 'waiting' | 'interrupted' | 'failed'` and per-item `ChatItem.status: 'running' | 'completed' | 'failed' | 'interrupted'`. `AgentSessionSummary` already carries `status` to the history selector.

Transitions live in `packages/mux/src/agents/service.ts`:

| Moment | Code path | Resulting status |
| --- | --- | --- |
| Accepted `send` | `command()` before dispatch | `running` |
| Adapter calls `ask()` for approval/question | `run()` → `ask` | `waiting` |
| User `reply` | `command()` reply branch | `running`, or `waiting` if other requests remain |
| Adapter `run()` resolves | `run()` try block | `idle` |
| Adapter throws / abort | `run()` catch | `failed` or `interrupted` |
| Host restart with busy session | constructor recovery | `interrupted` with an explanatory error |

Every change calls `changed(session)`, which persists and calls `publish(workspaceId)`. The server wires that to `publish('chat', { workspaceId })` (`packages/mux/src/server.ts`), main rebroadcasts it as `IPC.chat.changed`, and `connectQueryEvents` in `apps/desktop/src/renderer/src/lib/query-client.ts` invalidates the `['chat', workspaceId]` query. The renderer therefore learns about status only by refetching a snapshot; there is no transition event and no "from → to" information.

The chat view (`apps/desktop/src/renderer/src/components/chat/chat-view.tsx`) renders `Working…` for `running`, `Waiting for your response` for `waiting`, `Ready` for `idle`, and the raw enum otherwise. The e2e spec asserts these labels.

### 2.2 Adapter signals that already map to status

| Harness | Working | Blocked | Finished | Failed / interrupted |
| --- | --- | --- | --- | --- |
| Claude (Agent SDK) | first `stream_event` / `assistant` frame | `canUseTool` callback → `ask()` | `result` with `subtype === 'success'` | `result` with `is_error` or non-success subtype; abort |
| Codex (app-server) | `turn/started` | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput` → `ask()` | `turn/completed` with `status: 'completed'` | `turn/completed` `failed` / `interrupted`; `error` without `willRetry` |
| Pi (RPC) | `message_start` | `extension_ui_request` confirm/select/input/editor → `ask()` | `agent_end` | `message_end` with `stopReason` `error` / `aborted` |

All three adapters already route blocking requests through `ask()`, so `waiting` is uniform. None of them reports "starting" (process spawn, handshake, model resolution) as distinct from "working"; the service sets `running` before the adapter even spawns the process.

### 2.3 ACP

No ACP adapter exists; `docs/agent-chat-plan.md` section 15 defers it. When added, the ACP prompt-turn lifecycle maps cleanly onto the same model:

| ACP signal | Status |
| --- | --- |
| `session/prompt` sent, first `session/update` (`agent_message_chunk`, `tool_call`, `plan`) | working |
| `session/request_permission` (server → client request) | blocked, via `ask()` |
| `session/prompt` response `stopReason: 'end_turn'` | finished |
| `stopReason: 'cancelled'` | interrupted |
| `stopReason: 'refusal'`, `'max_tokens'`, `'max_turn_requests'` | finished with a warning notice, or failed; decide per product rule |
| `tool_call_update.status` `pending` / `in_progress` / `completed` / `failed` | item status only |

Because ACP permission is a request with option IDs, it fits the existing `AgentRequest` shape (approval kind) with native option identities preserved in `request.id`.

### 2.4 Terminal status

Terminals have their own enum in `packages/mux/src/protocol.ts` (`TerminalInfo.status: 'running' | 'exited' | 'interrupted' | 'failed'`) delivered as `type: 'status'` terminal events. The renderer exposes it as `data-terminal-status`. This is a separate channel and is not a chat status; it is mentioned because a notification hub could later carry terminal signals too (shell exit, bell, OSC 9/777 notifications emitted by agents running inside a plain terminal).

### 2.5 Focus and deep-link plumbing

- `layout.command` with `action: 'focus'` (`packages/mux/src/layout.ts`) sets `tab.activePaneId` and `workspace.activeTabId`, and the pane variant finds the tab from the pane ID.
- After a focus command the server runs `registry select` for the workspace and `publish('focus', workspaceId)` (`packages/mux/src/server.ts`).
- Main rebroadcasts it as `IPC.layout.focusWorkspace` (`apps/desktop/src/main/mux.ts`); `TerminalStack` subscribes and calls `onSelectWorkspace`, which is `handleSelectWorkspace` in `App.tsx`. That handler navigates to the projects route and runs the `setActiveWorkspace` mutation.
- The renderer renders whatever `activeTabId` / `activePaneId` the layout state says, so no extra renderer work is needed to land on a pane once the command has run.
- The CLI `pane focus` command already uses exactly this path, which is why it "selects the owning workspace in the UI".

Gaps for a notification click: nothing restores or focuses the `BrowserWindow`, the main process keeps no reference to it beyond `BrowserWindow.getAllWindows()`, and there is no path that reopens a session whose chat pane was closed.

### 2.6 Notifications

No `Notification`, `app.dock`, or `setBadgeCount` usage exists in `apps/desktop/src/main` or `packages/mux`. The only in-app notice is the Radix toast in `success-toast.tsx`. `electronApp.setAppUserModelId('com.cerebro.app')` is already called in `apps/desktop/src/main/index.ts`, which Windows needs for toasts.

Relevant packaging facts from `apps/desktop/electron-builder.yml`: `hardenedRuntime: false`, `notarize: false`, no signing identity configured. Electron's docs state that macOS notifications use `UNUserNotification` and require a code-signed application. Electron's prebuilt binary used by `electron .` is signed by the Electron project, so notifications generally appear in development attributed to "Electron"; an unsigned packaged `Cerebro.app` may show nothing. Treat signing (at least ad-hoc for local builds, a Developer ID for distribution) as a prerequisite and verify with a packaged build.

## 3. Proposed status model

### 3.1 Lifecycle (keep, extend minimally)

```
idle ──send──▶ starting ──first native frame──▶ running ──ask──▶ waiting
                  │                                │  ▲            │
                  │ spawn/auth error               │  └──reply─────┘
                  ▼                                ▼
                failed ◀────────────────────── failed / interrupted
                                                   │
                                                   └──run() resolves──▶ idle
```

- `starting` is the one new lifecycle value worth adding. Startup can hang (missing executable, expired OAuth, model discovery) and today that shows as `Working…`. The service can flip `starting → running` on the first adapter `emit`, with no adapter change; adapters may optionally emit a `{ type: 'phase' }` delta for finer detail.
- Keep `idle` as "no active turn". Do not overload it with "finished"; that is what `attention` is for.
- `interrupted` stays for both user Stop and host-restart recovery, with `error` explaining which.

### 3.2 Attention (new, orthogonal)

```ts
type AgentAttention = {
  kind: 'blocked' | 'finished' | 'failed' | 'interrupted'
  at: number
  seen: boolean
  /** Short human text for badges and the notification body. */
  summary?: string
  requestId?: string
}
```

- Set by the service at the same transitions: `waiting` → `blocked`; `run()` resolved → `finished`; catch → `failed` / `interrupted`. Clear on the next accepted `send`.
- `seen` flips via a new chat command `ack` (or `seen`) that the renderer sends when the bound pane is visible and the window is focused. This is the same semantics as an unread message.
- `summary` is derived host-side: the request title for `blocked`, the last completed `text` item truncated for `finished`, the error for `failed`. This avoids sending transcript content twice.
- Persisted with the session so unread state survives Electron restart and daemon restart, and so a notification clicked after the app was quit still lands on a visibly flagged session.

The UI labels then become: `starting` → "Starting…", `running` → "Working…", `waiting` → "Needs your action", `idle` + `attention.finished` → "Finished", `idle` without attention → "Ready", `failed` → "Failed", `interrupted` → "Interrupted".

Other statuses that are cheap to derive and useful in practice: `stopping` (Stop pressed, cancellation not yet settled; today the UI cannot distinguish this), and a per-harness readiness status at catalog level (`not_installed`, `login_required`, `ready`), which already exists informally as `catalog.issues[harness]`.

### 3.3 Where each layer injects logic

| Layer | Change |
| --- | --- |
| `packages/core/src/chat.ts` | Add `starting` (and optionally `stopping`) to `status`; add `attention?: AgentAttention`; add `ack` to `ChatCommand.action`; add an `AgentStatusEvent` type; optional `{ type: 'phase', phase: 'starting' \| 'thinking' \| 'tool' \| 'responding' }` to `AgentDelta`. |
| `packages/mux/src/agents/service.ts` | Compute attention at each transition; accept a second callback `onStatus(event)` beside `publish`; call it synchronously at the transition, not inside the 100 ms timer. |
| `packages/mux/src/agents/adapters.ts` | No mandatory change. Optionally emit `phase` deltas. A future ACP adapter maps as in section 2.3. |
| `packages/mux/src/server.ts` | `publish('agent.status', event)` to subscribed peers. Include `workspaceId`, `sessionId`, `paneIds` (from `bindings.json`, may be empty), `from`, `to`, `attention`, `title`. |
| `apps/desktop/src/main` | New `notifications.ts`: listen to `client.on('agent.status')`, apply settings and suppression rules, create `Notification`, handle `click`. Rebroadcast to renderer as `IPC.chat.status` for badges. |
| Renderer | Consume `IPC.chat.status` for tab and sidebar badges; send `ack` when a pane with an unseen attention becomes visible and the window is focused (`onWindowFocus` already exists). |
| Settings | `notifications: { enabled, events: { blocked, finished, failed }, sound, onlyWhenUnfocused }` in `AppSettings` / `settings.ts`, with controls in `settings-view.tsx`. |

The `agent.status` event must also be carried by the CLI later (`cerebro chat status --workspace`) since the mux is the source of truth and runs without Electron; it costs nothing to design the event for that.

## 4. System notifications

### 4.1 API and platform behaviour (Electron 39)

- `new Notification({ title, body, subtitle, silent, icon, urgency, timeoutType, actions, hasReply })`, events `show`, `click`, `close`, `action`, `reply`, `failed`; `Notification.isSupported()`.
- macOS: requires a code-signed app (see 2.6). `actions` buttons only appear when the app's notification style is "Alerts"; do not rely on them for the primary deep link, use the whole-notification `click`. Clicking a notification for a quit app relaunches it but Electron does not surface which notification launched it, so persisted `attention` is what makes that case usable.
- Windows: needs the AppUserModelID (set) and, for packaged builds, a Start Menu shortcut with that ID (electron-builder NSIS does this). `toastXml` is available for richer layouts but not needed.
- Linux: libnotify; `urgency: 'critical'` is a reasonable choice for `blocked`.
- Complementary signals that need no signing: `app.setBadgeCount(n)` (macOS dock / Windows taskbar overlay via `setOverlayIcon`), `app.dock.bounce('critical')` for `blocked` when the window is not focused, and a tray icon if one is ever added.

### 4.2 Policy

Notify when a status transition produces an attention record and the target is not already in front of the user:

- Skip when the window is focused **and** the session's pane is the active pane of the active tab of the active workspace. Main can evaluate this from `BrowserWindow.isFocused()`, the cached `LayoutState` in `mux.ts`, and the active workspace from the registry (the renderer also knows it, but main should not depend on a round trip).
- `blocked` is the highest-value event and should default on. `finished` defaults on. `failed` defaults on. `interrupted` caused by the user's own Stop should not notify; host-restart interruption should.
- Coalesce: one notification per session per transition. Replace rather than stack when the same session transitions again (macOS `Notification.remove` by `id`, or keep one live instance per session and close it on the next event).
- Body: `"<project> / <workspace>: <session title>"` plus `attention.summary`. Keep it short; do not include tool output or file contents.

### 4.3 Click handling and deep link

Payload attached to the notification instance (not to the OS, which only returns `click`):

```ts
type NotificationTarget = { workspaceId: number; sessionId: string; paneId?: number; tabId?: number }
```

On `click`:

1. Restore the window: `win.show()`, `win.restore()` if minimized, `win.focus()`, and on macOS `app.focus({ steal: true })`; if no window exists (macOS after all windows closed), `createWindow()` and wait for `ready-to-show`. `createWindow` in `index.ts` currently discards the window reference, so keep one.
2. Resolve the pane: read the current layout for a chat pane bound to `sessionId`. Bindings live in the agent service, so expose a host method (`chat.locate { sessionId }` returning `{ workspaceId, paneId, tabId } | null`) rather than reading `bindings.json` from main.
3. If found: `muxCall('layout.command', { action: 'focus', workspaceId, paneId })`. This sets the active tab and pane in the mux and publishes `focus`, which the renderer already turns into workspace selection and a route change away from Settings.
4. If not found (pane closed): `layout.command { action: 'create', kind: 'chat' }` in that workspace, then `chat.command { action: 'open', workspaceId, paneId, sessionId }`, then focus. Both commands exist; only the sequencing is new. This is the "Chat history selector reopens saved sessions" behaviour driven from main.
5. Mark `attention.seen` through the normal renderer `ack` path once the pane is visible, so a click and an ordinary visit behave identically.

If the daemon is down at click time, `muxCall` auto-starts it (`autoStart: true` in `getMux`) and the persisted session and attention are still there; the click degrades to "open the workspace".

### 4.4 Testing

- `service.test.ts` with the fake adapter: assert the sequence of status events for send → ask → reply → finish, for a thrown error, for abort, and that `attention` persists across `new AgentSessions(...)` construction.
- Electron e2e (`chat.spec.ts`): the fixture already has `slow`, `approval`, and `question` prompts that hold sessions in `running` / `waiting`. Under `NODE_ENV=test` main should record would-be notifications in memory instead of calling `new Notification`, and expose a test-only hook so Playwright can trigger the click handler via `electronApp.evaluate` and then assert the active workspace, tab, and pane in the DOM. Headless CI cannot observe real OS notifications.
- One manual check on a packaged, ad-hoc-signed macOS build to confirm delivery and the relaunch-after-quit case.

## 5. Suggested implementation order

1. Core types: `starting`, `attention`, `ack`, `AgentStatusEvent`, optional `phase` delta.
2. Service: compute attention, emit transition events synchronously, add `ack` and `locate`.
3. Server: publish `agent.status`; add `chat.locate` and `chat.overview` methods.
4. Main: window reference, `notifications.ts`, settings plumbing, test recorder.
5. Renderer: status labels, tab badges, the sidebar workspace-row status icon (section 6), `ack` on visibility, settings controls.
6. Tests as in 4.4; docs update in `docs/agent-chat-plan.md` section 16 and `docs/mux-runtime.md`.

ACP adapter work is independent of all of the above; when it arrives it only needs to call `ask()` for `session/request_permission` and resolve or throw according to `stopReason`.

## 6. Design decision: animated agent status on sidebar workspace rows

Decided on 2026-09-13: every workspace row in the sidebar shows an agent status icon whenever a chat session in that workspace is active, and the icon is animated while an agent is working.

### 6.1 What the row shows

| Aggregate state of the workspace | Icon | Motion |
| --- | --- | --- |
| Any session `starting` or `running` | Dashed ring, `CircleDashed` from lucide, `text-sky-500` (same vocabulary as `CiStatus` "Running") | Continuous slow spin |
| Any session `waiting` (blocked) | `ShieldAlert` or `PauseCircle`, `text-amber-500` | Gentle pulse; overrides the working spin |
| No active session, but an unseen `attention.finished` | Small solid dot, `text-emerald-500` | None |
| No active session, but an unseen `attention.failed` / host-restart `interrupted` | `XCircle`, `text-red-500` | None |
| Nothing active and nothing unseen | No icon | — |

Priority when several sessions exist in one workspace: blocked > working > failed > finished. The row shows one icon; the exact per-session breakdown belongs in the existing `WorkspaceHoverCard`, which should list each session with its title, harness, and status.

The icon carries an accessible name (`aria-label`, for example "Agent working" or "Agent needs your action") and `data-workspace-agent-status` for Playwright. Motion must respect `prefers-reduced-motion` and `forced-colors`, following the pattern already used in `chat-status.css`: the reduced-motion variant is a static icon in the same colour.

### 6.2 Placement

The single-root workspace row in `app-sidebar.tsx` already reserves the left slot for `WorkspacePrPopover` (absolute, `left-2`, `size-4`) and the right slot for `WorkspaceOverflowMenu` (`pr-8`). The status icon goes in the right slot, immediately before the overflow menu, so it never competes with the PR indicator and stays visible when the row is truncated. The overflow menu appears on hover/focus; the status icon is always visible when present. Apply the same slot to `MultiRootRepoRow` and the multi-root root row, and to search results, so all four workspace-row variants behave the same.

Project rows show a muted aggregate (a single small dot) only while the project is collapsed and one of its workspaces has an active or unseen state; when expanded the workspace rows carry the icons and the project row shows nothing. This keeps the selection highlight convention intact: status is an icon in a slot, never a left accent strip or a background change on the row.

### 6.3 Data source

Chat state is currently fetched per pane through the `['chat', workspaceId]` query, which only exists for mounted chat panes. The sidebar needs an aggregate across every workspace, including ones with no open chat pane. Add a mux method `chat.overview` (backed by the in-memory `sessions` map in the service) that returns, per workspace, the counts of `starting`/`running` and `waiting` sessions plus the highest-priority unseen attention. The renderer holds it in one `['chat', 'overview']` query invalidated by the existing `chat.changed` broadcast (already routed through `connectQueryEvents`) and by the new `agent.status` event, so the icon changes within the 100 ms coalescing window without any per-workspace polling.

Because the same aggregate drives the sidebar, the dock badge count, and the notification suppression rule, computing it once in the service keeps all three consistent.

### 6.4 Interaction

Clicking the row keeps its current behaviour (select the workspace). Selecting a workspace does not by itself clear an unseen attention; the `ack` command clears it when the bound pane becomes visible, so a finished dot stays until the user actually reaches that pane. The status icon is not itself a button; the notification click path in section 4.3 is the deep link.

### 6.5 Tests

Extend `chat.spec.ts`: send the fixture's `slow` prompt and assert `[data-workspace-agent-status="working"]` on the row with a spinning icon class, then `approval` and assert `blocked`, then reply and assert the icon disappears or becomes `finished` until the pane is viewed. Screenshots of the working and blocked rows in the actual Electron app are required evidence for the UI change.

## 7. Open questions

- Should `finished` notify for very short turns (under a few seconds) while the user is still looking at the app? A minimum-duration threshold is cheap and avoids noise.
- Should `refusal` / `max_*` ACP stop reasons be `finished` with a notice or `failed`? Codex `turn/completed` with `failed` and Claude `error_max_turns` face the same choice; pick one rule for all harnesses.
- Whether the mux should be able to notify without Electron (for CLI-only users) is out of scope here; the event design does not preclude it.
