# Cerebro

## Desktop app (`apps/desktop`)

`apps/desktop` is an **Electron** app. `pnpm --filter desktop dev` starts electron-vite, which boots a Vite renderer server **only so Electron can load the UI** (HMR / `ELECTRON_RENDERER_URL`). That localhost URL is not the product.

### Layout terminology

The window is two regions: **sidebar** | **content area**. Use these names, not "nav", "main", "panel", or "page".

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
- **content area** — everything to the right of the sidebar (`SidebarInset`). Header plus the selected workspace (`WorkspaceView`), or the empty state when nothing is selected.

### Domain terminology

- **project** — a cloned Git repository, an opened folder, or a **multi-root workspace** (a folder with multiple git repositories as immediate children). Clicking the project row expands or collapses its workspaces; it does **not** open a terminal. GitHub-linked single-root projects can add worktrees via a per-project `+`.
- **workspace** — a checkout under a project: the default-branch clone or opened repo, plus each extra git worktree. In a multi-root project, the parent folder is a root workspace and each nested git repo is a default workspace.
- **workspace row** — a focusable sidebar row that selects a workspace. Not the project row. Workspace rows include:
  - **default branch workspace** — the default-branch checkout of a single-root project
  - **worktree workspace** — an extra git worktree under a project
  - **multi-root workspace** — the `root` row of a multi-root project (the parent folder)
  - **nested repo** — a child git repository under a multi-root project

  Clicking a workspace row selects it. A terminal opens when the user adds one from the tab bar, or when they press Mod+T while a workspace row is focused.

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

| Changed area | Spec |
|---|---|
| app chrome, empty state, menu | `smoke.spec.ts` |
| settings | `settings.spec.ts` |
| GitHub login / integrations | `github.spec.ts` |
| add local / multi-root folder | `projects-directory.spec.ts` |
| clone from GitHub, worktrees, PRs | `projects-github.spec.ts` |
| workspace terminal | `terminal.spec.ts` |

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
cerebro workspace path <workspace-id>
cerebro workspace delete <workspace-id>
cerebro workspace remove <workspace-id>

cerebro --help
cerebro project --help
cerebro workspace --help
```

### Rules for agents

**Always capture IDs in the same shell invocation.** Variables do not survive across separate tool calls.

```bash
# Correct: capture and use in one call
RESULT=$(cerebro workspace create --project 1 --branch my-feature)
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

**Stable error codes** in the `code` field: `not_found`, `conflict`, `create_failed`, `list_failed`, `usage`, `internal`.

**`workspace create` on an existing branch exits 1 with `code: "conflict"`.** Check for this before retrying.

**`workspace delete` / `workspace remove` on a default workspace exits 1 with `code: "conflict"`.** Remove the project instead (`project delete` / `project remove`).

- `project delete` / `workspace delete` — remove worktree directories from disk (`git worktree remove`), then unregister.
- `project remove` / `workspace remove` — unregister only; directories stay on disk.
- Default checkouts and opened folders are never deleted from disk.

**Never rely on human-readable messages** to detect errors — use the `code` field and exit status.

### Context env vars (injected in Cerebro workspace terminals only)

| Variable | Value |
|---|---|
| `CEREBRO_HOME` | Data directory (default `~/cerebro`) |
| `CEREBRO_PROJECT_ID` | Integer project id for this workspace |
| `CEREBRO_WORKSPACE_ID` | Integer workspace id |
| `CEREBRO_WORKSPACE_PATH` | Absolute checkout path (same as `cerebro workspace path <id>`) |

### Architecture notes

- The CLI talks directly to `~/cerebro/cerebro.sqlite` — it works even when the desktop app is closed.
- When the desktop app is running, CLI mutations trigger a sidebar refresh via a Unix socket at `$CEREBRO_HOME/cerebro.sock`. If the socket is missing (app not running), the CLI skips the notify silently.
- GitHub tokens stored by the desktop app are encrypted by Electron `safeStorage` and are not accessible to the CLI. Private clones must use system git credentials (`gh auth`, SSH, or osxkeychain).
