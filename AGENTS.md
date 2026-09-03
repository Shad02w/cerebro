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
│  │  workspaces  │   selected workspace (or empty)     │ │
│  │  list, add   │                                     │ │
│  │              │                                     │ │
│  └──────────────┴─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

- **sidebar** — left column (`AppSidebar`). Workspace list and add-workspace. Can collapse (offcanvas).
- **content area** — everything to the right of the sidebar (`SidebarInset`). Header plus the active workspace view (`WorkspaceView`), or the empty state when nothing is selected.

### Verify UI with Playwright against Electron

When changing desktop UI, layout, styling, routing, client state, or rendered data:

- Verify in the **real Electron window** via Playwright: `pnpm --filter desktop test:e2e`.
- That script rebuilds with `electron-vite build`, then Playwright launches this project's Electron binary (`electron .` against `out/`). It is **not** Chromium pointed at the Vite URL.
- Add or extend tests under `apps/desktop/e2e/` for the flow you changed. Use the `electronApp` / `page` fixtures from `e2e/fixtures.ts` — they isolate `CEREBRO_HOME` and attach to the first `BrowserWindow`.
- Do **not** open the Vite renderer URL in Chrome, Cursor browser tools, or any other web browser. That skips main process, preload, `contextBridge`, native chrome, and window lifecycle.
- Do **not** launch Playwright's Chromium/Firefox/WebKit against `localhost`. `window.cerebro` and IPC only exist in Electron.

A screenshot or visit of the Vite page is not verification. If Playwright cannot run in this environment, say so — do not fall back to the Vite URL.
