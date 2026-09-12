# Cerebro

## Validation scope

- Every task that changes code must run lint, formatting, and related test cases before completion.
- **Check only files changed by the current task.** Pass explicit changed-file paths to linters and formatters, and run only test cases covering those files. Do not run repository-wide checks or include unrelated files or pre-existing changes.
- **Do not run tests when the task makes no code changes**, including documentation-only edits and commit/push-only requests. Existing uncommitted code changes do not make a commit/push-only request a code-change task.

### React Doctor

- After changing React renderer code, run `pnpm react:doctor <file> [file...]` from the repository root with explicit paths to only the files changed by the current task. Include changed components, hooks, and renderer utilities. Always pass file paths for task validation; omit the scan when no renderer code changed.
- Review each finding against the source. Fix issues introduced by the task and report remaining findings; Electron IPC and shared query-cache helpers can produce false positives. Do not suppress rules solely to clear the report.
- `pnpm react:doctor:full` audits all of `apps/desktop/src/renderer`. Run it only when a full React audit is requested. React Doctor supplements the scoped lint, formatting, and Electron tests above.
- The pinned CLI runs with telemetry/scoring and dependency supply-chain requests disabled. See [React Doctor workflow and baseline](docs/react-doctor.md).

## Desktop app (`apps/desktop`)

`apps/desktop` is an **Electron** app. `pnpm --filter desktop dev` starts electron-vite, which boots a Vite renderer server **only so Electron can load the UI** (HMR / `ELECTRON_RENDERER_URL`). That localhost URL is not the product.

### Layout terminology

The window is two regions: **sidebar** | **content area**. Use these names, not "nav", "main", or "page". **Pane** is a split region inside a tab, not a synonym for the content area.

```
┌─────────────────────────────────────────────────────────┐
│  Electron window                                        │
│  ┌──────────────┬─────────────────────────────────────┐ │
│  │              │                                     │ │
│  │   sidebar    │          content area               │ │
│  │              │                                     │ │
│  │  projects    │   selected workspace (or empty)     │ │
│  │  list, add   │                                     │ │
│  │              │                                     │ │
│  └──────────────┴─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

- **sidebar** — left column (`AppSidebar`). Project list (expand/collapse), add project, and nested workspace rows. Can collapse (offcanvas).
- **content area** — everything to the right of the sidebar (`SidebarInset`). Header plus the selected workspace (`WorkspaceView`), or the empty state when nothing is selected. Workspace content opens in **tabs**.
- **tab** — a content surface in the content area containing a BSP (Binary Space Partitioning) tree of panes. A tab can mix Terminal and Changes panes. The tab bar lists open tabs for the selected workspace.
- **pane** — a typed leaf in a tab’s BSP tree. Adding a pane splits the active pane 50/50: right when wide, down when tall, or an explicit direction. Split directions remain fixed; dividers resize the ratio. Exactly one pane per tab is active, with a glowing border when the tab contains multiple panes. Pane IDs float at the top right; the close control is shown only for multiple panes. Inactive multi-pane edges use `--pane-border` (points at `--border`); active pane glow, workspace rows, and multi-root badges share `--sidebar-selected`. Closing a pane expands its sibling; closing the last pane closes the tab.

### Domain terminology

- **project** — a cloned Git repository, an opened folder, or a **multi-root workspace** (a folder with multiple git repositories as immediate children). Clicking the project row expands or collapses its workspaces; it does **not** open a terminal. GitHub-linked single-root projects can add worktrees via a per-project `+`.
- **workspace** — a checkout under a project: the default-branch clone or opened repo, plus each extra git worktree. In a multi-root project, the parent folder is a root workspace and each nested git repo is a default workspace.
- **workspace row** — a focusable sidebar row that selects a workspace. Not the project row. Workspace rows include:
  - **default branch workspace** — the default-branch checkout of a single-root project
  - **worktree workspace** — an extra git worktree under a project
  - **multi-root workspace** — the `root` row of a multi-root project (the parent folder)
  - **nested repo** — a child git repository under a multi-root project

  Clicking a workspace row selects it. A terminal opens when the user adds one from the tab bar, or when they press Mod+T while a workspace row is focused.

### Terminal themes

- Start with the [iTerm2-Color-Schemes Windows Terminal collection](https://github.com/mbadolato/iTerm2-Color-Schemes/tree/master/windowsterminal) for additional palettes, including Kanagawa and Vercel. These are community-sourced palettes, not built-in xterm.js themes.
- Add stable IDs and labels in `packages/core/src/terminal-themes.ts`, and xterm.js palettes in `apps/desktop/src/renderer/src/lib/terminal-themes.ts`.
- Translate `purple` → `magenta`, `brightPurple` → `brightMagenta`, and `cursorColor` → `cursor`; use the background for `cursorAccent`. Check selection contrast; some palettes also need an explicit `selectionForeground`.
- Record source filenames and adaptations in `apps/desktop/src/renderer/src/lib/terminal-theme-sources.md`, which also contains attribution and license information.
- Extend the theme coverage in `settings.spec.ts` and `terminal.spec.ts`, and verify rendering in Electron as described below.

### UI conventions

#### Selection highlights

Do not use a left border, accent strip, or one-sided inset shadow to highlight selected or active items, especially on rounded rows or cards. Use a subtle background change and, if needed, a uniform outline around the whole item.

#### Forms

Never disable a form submit button — not for empty or invalid fields, and not while loading or mutating.

- Invalid input: keep the button available and show an error message.
- Loading or mutating: keep the button available (it may show a spinner and an in-progress label). Guard the submit handler with the in-flight state so a second submit is ignored until the work finishes. Do not use `disabled` to block double-submit.

This applies to form submit controls, not to actions that are structurally unavailable (for example a default workspace Delete menu item).

### Verify UI with Playwright against Electron

When changing desktop UI, layout, styling, routing, client state, or rendered data:

- Verify in the **real Electron app** via Playwright. Tests launch this project's Electron binary (`electron .` against `out/`). It is **not** Chromium pointed at the Vite URL.
- **Never run the full e2e suite locally.** Pass only the spec file(s) that cover the files you changed. The full suite runs on GitHub Actions for pull requests into `main` and for pushes to `main`.

```bash
# Builds, then runs one spec
pnpm --filter desktop test:e2e smoke.spec.ts

# Already built: skip the rebuild
pnpm --filter desktop test:e2e:repeat smoke.spec.ts
```

A spec file is required locally. Omitting it (or passing only Playwright flags) exits 2 instead of running the full suite. `pnpm --filter … -- smoke.spec.ts` is fine: the wrapper drops a stray `--` so Playwright still treats the path as a file filter. The full suite runs on CI, or locally with `CEREBRO_E2E_ALL=1`.

Pick specs by the flow you touched:

| Changed area                      | Spec                         |
| --------------------------------- | ---------------------------- |
| app chrome, empty state, menu     | `smoke.spec.ts`              |
| settings                          | `settings.spec.ts`           |
| GitHub login / integrations       | `github.spec.ts`             |
| add local / multi-root folder     | `projects-directory.spec.ts` |
| clone from GitHub, worktrees, PRs | `projects-github.spec.ts`    |
| workspace terminal                | `terminal.spec.ts`           |
| BSP panes and tab/pane CLI        | `panes.spec.ts`              |
| Changes content                   | `changes.spec.ts`            |

If a change spans several flows, list those specs together (`settings.spec.ts smoke.spec.ts`). Do not add unrelated specs "just in case."

- Add or extend tests under `apps/desktop/e2e/` for the flow you changed. Use the `electronApp` / `page` fixtures from `e2e/fixtures.ts` — they isolate `CEREBRO_HOME` and attach to the first `BrowserWindow`.
- Electron e2e is **headless** by default (no window). To watch a run: `HEADED=1 pnpm --filter desktop test:e2e:repeat <spec>.spec.ts`.
- Do **not** open the Vite renderer URL in Chrome, Cursor browser tools, or any other web browser. That skips main process, preload, `contextBridge`, native chrome, and window lifecycle.
- Do **not** launch Playwright's Chromium/Firefox/WebKit against `localhost`. `window.cerebro` and IPC only exist in Electron.

A screenshot or visit of the Vite page is not verification. If Playwright cannot run in this environment, say so — do not fall back to the Vite URL.

If the task included screenshots, mockups, or other images of the required UI (bug, expected layout, or design), attach those same images in the final response so a human can verify the change against the original requirement. Embed them with markdown (`![description](path)`); do not only describe them.

## CLI (`apps/cli`)

The `cerebro` CLI lets agents and humans manage projects and workspaces from any terminal — including terminals that are not inside the Cerebro desktop app.

### Quick reference

```bash
cerebro project list
cerebro project create <git-url>
cerebro project create --directory <path>
cerebro project delete <project-id>
cerebro project remove <project-id>

cerebro workspace list [--project <id>]
cerebro workspace create --project <id> --branch <name>
cerebro workspace create --project <id> --branch <name> --from <base>
cerebro workspace path <workspace-id>
cerebro workspace delete <workspace-id>
cerebro workspace remove <workspace-id>

cerebro tab list --workspace <id>
cerebro tab create --workspace <id> --kind terminal
cerebro tab focus --workspace <id> --tab <id>
cerebro tab close --workspace <id> --tab <id>
cerebro tab reorder --workspace <id> --tab <id> --index 0

cerebro pane list --workspace <id> --tab <id>
cerebro pane split --workspace <id> --pane <id> --kind changes --direction auto
cerebro pane focus --workspace <id> --pane <id>
cerebro pane close --workspace <id> --pane <id>
cerebro pane resize --workspace <id> --tab <id> --split <id> --ratio 0.6

cerebro --help
cerebro project --help
cerebro workspace --help
```

### Live tabs and panes

- Project/workspace/tab/pane commands use the standalone mux, which starts on demand without the desktop app. Use the same `$CEREBRO_HOME` and `$CEREBRO_DB_PATH` as the app.
- Layout IDs and pane state persist in SQLite. Electron quit/reload detaches from live shells. Daemon restart restores output and starts a fresh shell on activation; commands are never replayed. See `docs/mux-runtime.md`.
- `tab create` starts with one pane (`terminal` by default). `tab list` includes each tab’s BSP tree, split IDs/ratios, and active pane ID.
- `pane split` targets `--pane`, or the active pane in `--tab` (the active tab when omitted). `--direction` accepts `auto`, `right`, or `down`. `--kind` accepts `terminal` or `changes`.
- `pane list` lists the selected tab’s panes. Focus commands select the owning workspace in the UI. Creation/splitting selects the new content within its workspace without switching from another workspace.
- `pane resize` changes the first child’s share of a split, from `0.1` to `0.9`. Get `--split` IDs from `tab list`.
- The tab-bar Add menu offers New tab content plus Add pane, Split right, and Split down. Mod+W continues to close the whole tab; multi-pane tabs expose a close control on each pane.
- `panes.spec.ts` builds the actual CLI and runs it against the isolated Electron fixture, covering both surfaces.

### Rules for agents

**Always capture IDs in the same shell invocation.** Variables do not survive across separate tool calls.

```bash
# Correct: capture and use in one call
# Existing branch: omit --from. New branch from a base: pass --from.
RESULT=$(cerebro workspace create --project 1 --branch my-feature --from main)
WS_ID=$(echo "$RESULT" | jq '.id')
WS_PATH=$(echo "$RESULT" | jq -r '.localPath')
```

**Never omit `--project` / `--workspace` flags** unless you are running inside a Cerebro workspace terminal — the env vars `CEREBRO_PROJECT_ID` and `CEREBRO_WORKSPACE_ID` are only injected there.

```bash
# Inside a Cerebro terminal: env vars are set automatically
echo "$CEREBRO_PROJECT_ID $CEREBRO_WORKSPACE_ID $CEREBRO_WORKSPACE_PATH"

# Outside (Cursor, Claude Code, scripts): always pass flags explicitly
cerebro workspace list --project 3
```

**Output is always JSON on stdout.** Parse with `jq`. Errors are JSON on stderr with a non-zero exit code.

```bash
# Exit 0  = success,  stdout = JSON result
# Exit 1  = operation failed, stderr = { "error": true, "code": "...", "message": "..." }
# Exit 2  = bad usage (missing required flag, unknown command)
```

**Stable error codes** in the `code` field: `not_found`, `conflict`, `create_failed`, `list_failed`, `usage`, `internal`. Mux commands also return `unavailable` for startup/connection failures.

**`workspace create` is for GitHub-linked single-root projects only.** Multi-root projects cannot add worktrees.

**`workspace create` when a workspace for that branch already exists exits 1 with `code: "conflict"`.** Check for this before retrying. Creating a new branch with `--from` also exits `conflict` if that branch already exists locally or on origin.

**`workspace delete` / `workspace remove` on a default workspace exits 1 with `code: "conflict"`.** Remove the project instead (`project delete` / `project remove`).

- `project delete` / `workspace delete` — remove worktree directories from disk (`git worktree remove`), then unregister.
- `project remove` / `workspace remove` — unregister only; directories stay on disk.
- Default checkouts and opened folders are never deleted from disk.

**Never rely on human-readable messages** to detect errors — use the `code` field and exit status.

### Context env vars (injected in Cerebro workspace terminals only)

| Variable                 | Value                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `CEREBRO_HOME`           | Data directory (default `~/cerebro`)                           |
| `CEREBRO_PROJECT_ID`     | Integer project id for this workspace                          |
| `CEREBRO_WORKSPACE_ID`   | Integer workspace id                                           |
| `CEREBRO_WORKSPACE_PATH` | Absolute checkout path (same as `cerebro workspace path <id>`) |

### Architecture notes

- The CLI and desktop coordinate layout and project/workspace mutations through the mux storage worker. SQLite holds metadata; bounded terminal snapshots/journals hold screen and scrollback.
- Clients use an authenticated local socket (macOS/Linux) or named pipe (Windows). Mux events refresh connected views. `cerebro server status|start|stop` controls the daemon; `pane capture|send|restart` controls terminals without Electron.
- GitHub tokens stored by the desktop app are encrypted by Electron `safeStorage` and are not accessible to the CLI. Private clones must use system git credentials (`gh auth`, SSH, or osxkeychain).
