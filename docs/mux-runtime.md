# Cerebro mux runtime

The standalone mux owns layouts and shell processes. Electron and the CLI are clients. Closing or reloading Electron detaches views; it does not terminate shells. Explicit tab/pane close terminates the affected shells and removes their retained output.

## Start and use

Build with `pnpm --filter desktop build`. The app and bundled CLI start the mux on demand. An installed development launcher is `cerebro-dev`; a packaged installation uses `cerebro`.

```sh
cerebro server status
cerebro project create --directory /absolute/path/to/project
cerebro workspace list --project <project-id>
cerebro workspace create --project <project-id> --branch feature --from main
cerebro tab create --workspace <workspace-id> --kind terminal
cerebro pane split --workspace <workspace-id> --pane <pane-id> --kind changes
cerebro pane capture --workspace <workspace-id> --pane <pane-id> --scrollback 10000
cerebro pane send --workspace <workspace-id> --pane <pane-id> --text 'pwd' --enter
cerebro pane restart --workspace <workspace-id> --pane <pane-id>
cerebro server stop
```

Use returned JSON IDs, replacing the angle-bracket placeholders. Workspace creation retains the existing GitHub-linked, single-root restriction. CLI Git operations use system credentials. Desktop Git operations keep the desktop provider through an operation-scoped callback.

`server status` does not start a daemon. `server stop` checkpoints and terminates shells, retaining layouts and output. It waits for shutdown. An open desktop respects an explicit stop; it reconnects after `server start`, Restart, or another explicit workspace/tab action, rather than immediately restarting the daemon in the background. A client whose staged runtime is a different and newer build (`muxHash` differs and `builtAt` is later in `runtime.json`) replaces a same-protocol daemon automatically when it connects: it requests a stop, waits for the shutdown to finish, then starts the new runtime. Older clients and builds without that metadata never downgrade a running daemon. A protocol version change still requires an explicit restart.

## Identity and state

Project, workspace and repository IDs use the existing registry. Tabs, panes and split nodes share a durable monotonic allocator. Pane repository scope uses the existing `repositoryId`; `--sub-repo` is its CLI name. Nested repository rows default to their repository. A multi-root parent defaults to the whole folder; explicit subrepo scope changes the terminal CWD and Changes filter.

Each terminal launch gets a new UUID session generation. Input and resize from an old attachment are rejected. Shell environment includes `CEREBRO_HOME`, `CEREBRO_PROJECT_ID`, `CEREBRO_WORKSPACE_ID`, `CEREBRO_WORKSPACE_PATH`, `CEREBRO_TAB_ID` and `CEREBRO_PANE_ID`; scoped panes also receive `CEREBRO_REPOSITORY_ID` and `CEREBRO_SUB_REPO_ID`. Inherited identities are cleared first.

Layouts retain mixed pane kinds, split ratios, tab order, focus and Changes selection/sidebar state. Diff bodies are re-read from Git. Only the visible tab mounts terminal renderers. Exited shells remain readable and offer Restart. Unknown stored pane kinds render a placeholder rather than being deleted.

## Files and recovery

All clients must share `CEREBRO_HOME` (default `~/cerebro`) and the optional `CEREBRO_DB_PATH`. A home already owned for another database is rejected.

| Location                                   | Contents                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `cerebro.sqlite`                           | Existing registry/settings, versioned workspace layout documents, ID allocator, bounded operation-response journal |
| `mux/ownership.sqlite`                     | Small transactional PID ownership record for simultaneous startup/crash recovery                                   |
| `mux/token`                                | Local authentication secret; owner-only access, with Windows ACL protection                                        |
| `mux/terminals/<paneId>/manifest.json`     | Current and previous checkpoint numbers                                                                            |
| `mux/terminals/<paneId>/<number>.snapshot` | Checked VT screen/history, continuation state and shell launch metadata                                            |
| `mux/terminals/<paneId>/<number>.journal`  | Checked, ordered output/resize/status records since that checkpoint                                                |
| `mux/runtimes/<fingerprint>/`              | Staged Node, daemon, worker and native PTY assets that survive app replacement                                     |
| `mux/server.log`                           | Bounded startup diagnostics                                                                                        |

The SQLite storage worker handles metadata and terminal files. It keeps synchronous filesystem/SQLite work off the PTY event loop. Git registry jobs serialize separately from layout and selection; live terminal IO and capture remain available during Git. Removal takes a layout barrier while stopping and deleting owned panes. A separate SQLite ownership record avoids the race inherent in deleting stale PID lock files.

Default retained history is 10,000 rows per terminal, plus the screen. Set `CEREBRO_SCROLLBACK` before starting the daemon to change retention (maximum 100,000). This is bounded terminal state, not a lifetime transcript. Journals checkpoint at roughly 4 MiB or after 30 seconds of further output; rotation retains two generations. Orphan pane directories are reclaimed on startup. Old staged runtime directories are retained; after stopping the mux, they may be removed if disk space is needed.

Dirty journals fsync on a one-second cadence. `durableSequence` in terminal capture/snapshot metadata is the acknowledged persistence watermark. The one-second window is a target under healthy storage, not a power-loss guarantee. Persistence failures pause the affected PTY, surface an error and retry a complete checkpoint before resuming. Replay accepts complete checked records and can fall back to the previous checkpoint.

After daemon death or reboot, capture can read interrupted output without launching anything. Activating that pane or explicitly restarting launches a **new shell**, appends a boundary and resets interactive modes. Previous commands and shell environment are never replayed. Interrupted alternate-screen contents remain available as a read-only text view. OSC 7 tracks CWD when supported; otherwise the saved launch directory is used, falling back to the workspace when missing.

Completed mutation IDs deduplicate retries (last 1,024 completed responses). Workspace creation reserves its destination in the operation record and writes its new workspace ID in the same SQLite transaction as the registry insertion. Startup reconciles committed creations whose response was interrupted. If a crash occurred during Git before metadata committed, a retry reports the reserved path for inspection; it does not repeat Git or delete an ambiguous checkout. Terminal input is never automatically retried.

## Performance and limits

PTY chunks waiting at the same stream position are batched up to 256 KiB; control operations seal a batch, preserving output/resize/snapshot order. Parser/storage backlog pauses only the producing PTY. Transport frames are 64 KiB with a 32 MiB logical message limit. Socket queues and renderer acknowledgments bound outstanding output; a lagging view detaches and restores a fresh snapshot. Only the daemon answers VT device queries.

The [daemon benchmark](mux-benchmark.json) uses actual PTYs on an Apple M1 Pro, Node 24.11.0, 12 samples per measurement and 10,000 retained rows per terminal. The largest case fills all 50 terminals, then measures a finite background-output burst:

| Terminals | Fill all histories | Reconnect p95 | Input-to-capture p95 | Daemon/worker RSS |
| --------- | ------------------ | ------------- | -------------------- | ----------------- |
| 1         | 275 ms             | 55.19 ms      | 8.14 ms              | 218 MiB           |
| 10        | 267 ms             | 44.21 ms      | 6.68 ms              | 369 MiB           |
| 50        | 1,534 ms           | 42.57 ms      | 6.34 ms              | 992 MiB           |

Input-to-capture measures daemon processing and polling, **not renderer paint**. RSS excludes shell children. These are local measurements, not cross-platform guarantees; histories consume memory per terminal. Reproduce with `pnpm --filter @cerebro/mux exec tsx src/benchmark.ts` after building the desktop runtime.

The [storage microbenchmark](mux-storage-benchmark.json) compares identical durable batches. SQLite WAL was faster at the median (1.04 ms versus 6.13 ms); p95 was 10.23 ms versus 13.79 ms. The file representation used 10.7 MiB versus SQLite's 20.1 MiB for the sample. Hybrid storage remains the default for independent history rotation, smaller retained files and keeping bulk output out of the registry database; the evidence does not establish files as universally faster. Reproduce with `pnpm --filter @cerebro/mux exec tsx src/storage-benchmark.ts`.

## Verification and release checks

Focused tests cover concurrent startup, headless CLI workspace creation, stable IDs, generation checks, operation recovery, native PTY launch, VT continuation, corrupted/torn records, retention rotation and actual Electron quit/reload/restart. The Electron device-query test checks that an attached renderer does not send a second reply. Existing BSP, Changes, themes and project/provider flows are exercised by their related specs.

Native build/smoke jobs are provided for macOS, Linux and Windows in `.github/workflows/mux.yml`. Local verification was on macOS arm64, including an unsigned packaged-app terminal smoke test. Packaging explicitly includes native PTY assets and audits their presence after copying resources. Scoped React Doctor reported one remaining ChangesView complexity warning; its maintainability checks reported incomplete results, with no remaining timer-cleanup findings. Windows/Linux jobs, distribution signing/notarization, exhaustive power-loss fault injection and renderer input-to-paint measurements remain release checks. The xterm 6.0 private continuation/input/color adapters are intentionally version-pinned and must be revalidated when upgrading xterm. Protocol 2 and continuation version 2 accompany this migration; version 1 terminal files are backed up before recovery. See [the xterm upgrade audit and controlled rollout instructions](xterm-upgrade-plan.md#controlled-rollout-and-rollback) before replacing a running v1 daemon.
