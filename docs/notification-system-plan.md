# Notification system: plan, decisions, and layered test plan

Builds on [agent-status-notifications-research.md](agent-status-notifications-research.md). This file records what the MVP implements, why, and how each part is tested.

## 1. Plan

```
mux AgentSessions ──onStatus──▶ server publish('agent.status')
                                        │
                              main: NotificationHub  (policy only)
                              ┌─────────┴──────────┐
                     InAppChannel            MacSystemChannel      (future: CloudChannel)
                     (renderer cards)        (Electron Notification)
                              └─────────┬──────────┘
                              user response (open / allow / deny)
                                        │
                   layout.command focus  |  chat.command reply
```

| Step                                                                 | Status                               |
| -------------------------------------------------------------------- | ------------------------------------ |
| 1. `AgentStatusEvent` / `AppNotification` types in `@cerebro/core`   | MVP                                  |
| 2. Mux emits `blocked` / `finished` / `failed` transitions           | MVP                                  |
| 3. `NotificationHub` + `NotificationChannel` interface               | MVP                                  |
| 4. In-app channel (renderer cards, Allow/Deny)                       | MVP                                  |
| 5. macOS system channel (click-to-pane, dock bounce, action buttons) | MVP, needs signed-build verification |
| 6. Settings (per-event toggles, sound, min turn duration)            | Next                                 |
| 7. Dock badge count and sidebar status icon                          | Next (see research doc section 6)    |
| 8. Persisted `seen` attention + `ack`                                | Next                                 |
| 9. Cloud/push channel                                                | Later, same interface                |

## 2. Features in the MVP

- An agent that needs a permission or an answer, finishes, or fails produces one notification per session. A newer event replaces the older one.
- Title is `<project> / <workspace>`. Body is `Cerebro needs you: <what it wants>`, `Done: <last reply>`, or `Stopped: <error>`.
- **App focused:** show an in-app card, unless the user is already looking at that exact pane (then stay silent).
- **App not focused** (blur, minimised, another app): show a macOS system notification. Falls back to in-app when the system channel is unavailable.
- Click anywhere on the notification: restore and focus the window, select the workspace, and focus the pane. If the pane was closed, the workspace is selected.
- Approval requests get Allow / Deny buttons. They send the answer back to the agent through the normal chat `reply` command. Questions have no buttons and open the pane.
- The dock icon bounces for `blocked` events while the app is in the background.
- A user pressing Stop does not notify.

## 3. Design decisions

1. **Hub owns policy, channels own presentation.** The hub has no Electron imports, so routing rules are testable without a window. New backends (cloud, Windows, Linux) are new `NotificationChannel`s.
2. **Events come from the mux, not the renderer.** The renderer only sees debounced snapshots, so it cannot tell "just became blocked". The mux emits at the transition, synchronously, and works without any window.
3. **Notification failures never affect a turn.** `notify()` swallows errors.
4. **One live notification per session** (`agent:<sessionId>`), dismissed from every channel that showed it.
5. **Visibility rule is evaluated in main** from `BrowserWindow.isFocused()`, the cached layout, and the active workspace, so no renderer round trip.
6. **Quick actions only for approvals with a bound pane.** Replying needs a pane, and free-text questions need the full UI.
7. **System buttons are an enhancement, not the primary path.** macOS only draws `actions` in the Alerts style, so click-to-open and the in-app card are always available.
8. **Finished is suppressed when a queued message auto-starts the next turn**, since the agent has not really stopped.
9. **Out of scope for the MVP:** persisted unread state, settings, badge, sidebar icon, and ACP. The event shape already carries what they need.

Known limits: macOS requires a code-signed app for notifications (electron-builder has no signing yet), so delivery is only confirmed in dev (Electron's signed binary) and must be verified on a packaged build. Action-button visibility is unverified on real hardware.

## 4. Test plan by layer

Rule of thumb: Playwright is only for whole user flows with real visible checks. Anything that mocks data is a unit or integration test.

### Unit (pure logic, no I/O, no DOM)

| Test                                                                                             | Where                            | Status                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------- | --------------------------- |
| `buildNotification`: title, body per kind, actions only for approval with a pane                 | `main/notifications/hub.test.ts` | Done (partly via hub tests) |
| Hub routing: focused vs unfocused, silent when visible, fallback, replacement, respond dismisses | `main/notifications/hub.test.ts` | Done (7 tests)              |
| `lastReply` summary truncation and whitespace collapsing                                         | `mux/src/agents/service.ts`      | To add                      |
| Response validator `isResponse` rejects malformed payloads                                       | `main/notifications/index.ts`    | To add (extract first)      |

### Integration (real service/store or mocked IPC, no layout, no Electron)

| Test                                                                                                                                                                                    | Where                              | Status                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `AgentSessions` emits `blocked`, `finished`, `failed` with pane id, request id and summary; none on user stop                                                                           | `mux/src/agents/service.test.ts`   | Done                                                             |
| Finished is not emitted when a queued message continues the turn                                                                                                                        | `service.test.ts`                  | To add                                                           |
| Server publishes `agent.status` to subscribed peers only                                                                                                                                | `mux/src/server` test              | To add                                                           |
| `handleResponse`: allow sends `chat.command reply` with `allow: true`; open sends `layout.command focus`; closed pane falls back to workspace select (mocked `muxCall`)                 | `main/notifications`               | To add                                                           |
| `AgentNotifications` component with mocked `window.cerebro`: renders card, Allow/Deny call `respondToNotification`, blocked persists, finished auto-dismisses, dismiss event removes it | renderer, Vitest + Testing Library | To add once the Vitest setup from the test-pyramid session lands |

### End-to-end (real Electron, real flow, visible checks)

Keep this to one or two tests:

1. **Blocked → system notification routing → click → right pane.** Use the fixture's `approval` prompt, blur the window, assert a notification was recorded for the system channel (test recorder under `NODE_ENV=test`), trigger its click through `electronApp.evaluate`, and assert the correct workspace, tab, and pane are visible and focused.
2. **In-app Allow.** With the window focused on a different workspace, run the `approval` prompt, press Allow on the card, and assert the agent resumes and finishes.

Manual check, outside CI: one packaged, ad-hoc-signed macOS build to confirm real delivery, Alerts-style buttons, and relaunch-after-quit.
