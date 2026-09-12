# xterm 6 upgrade and workaround audit

Status: implemented in the working tree on 2026-09-12. Targets were verified against npm metadata, the published headless tarball, and upstream tag `6.0.0` (`f447274f430fd22513f6adbf9862d19524471c04`). Existing uncommitted mux work was preserved. The audit below records the migration rationale; implementation results and rollout instructions follow.

## Recommendation and target

Upgrade browser and headless xterm together to **6.0.0**, the latest stable release. The registry also advertises 6.1 prereleases; do not substitute those automatically. Pin the following versions for the migration so the parser, renderer, and private adapters are reviewed against a fixed target.

| Package                  | Current | Target                        |
| ------------------------ | ------- | ----------------------------- |
| `@xterm/xterm`           | 5.5.0   | 6.0.0                         |
| `@xterm/headless`        | 5.5.0   | 6.0.0                         |
| `@xterm/addon-fit`       | 0.10.0  | 0.11.0                        |
| `@xterm/addon-webgl`     | 0.18.0  | 0.19.0                        |
| `@xterm/addon-serialize` | 0.13.0  | 0.14.0                        |
| `@xterm/addon-canvas`    | 0.7.0   | Remove; no v6 Canvas renderer |

The package targets were read from npm. The [6.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0) adds synchronized output, changes the viewport, and removes Canvas. The audit below distinguishes actual compatibility work from product behavior that xterm cannot replace.

## Workaround inventory and decisions

No `patchedDependencies` or `patch-package` configuration was found. The patches here are Cerebro adapters, configuration, CSS, and lifecycle safeguards.

| Existing code / behavior                                                                                                                                                         | What 6.0 changes                                                                                                                                          | Planned disposition                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TerminalOutput frame buffering](/Users/alvistse/Documents/dev/cerebro/apps/desktop/src/renderer/src/lib/terminal-output.ts)                                                     | Native DEC mode 2026 buffers screen refreshes, including a one-second safety timeout.                                                                     | **Candidate for removal, conditional.** Retain initially, then test native-only rendering before deleting it. Cursor/IME and sustained-animation caveats are below.                                                                                 |
| [TerminalColors](/Users/alvistse/Documents/dev/cerebro/packages/mux/src/terminal-colors.ts): default and indexed color queries, application overrides, snapshots                 | Headless still has no color service subscribed to its parser's color events.                                                                              | **Keep and revalidate.** Still required for OSC 4/10/11/12/104/110/111/112 and reconnects. A `theme` option on headless does not supply the missing service.                                                                                        |
| TerminalColors asynchronous OSC-handler type cast                                                                                                                                | Browser typings allow promises; the 6.0 headless declaration still says `boolean`. Its shared parser supports async handlers.                             | **Keep the narrow adapter** unless published declarations or a public alternative demonstrably remove the mismatch. Update its version comment.                                                                                                     |
| [forwardUserInputOnly](/Users/alvistse/Documents/dev/cerebro/apps/desktop/src/renderer/src/lib/terminal-input.ts) monkey-patches `coreService.triggerDataEvent`                  | Public `onData` still provides only a string. The user-input flag remains internal.                                                                       | **Keep the single-reply rule and adapter.** `onWriteParsed` is a parser-completion event, not a replacement for distinguishing input from replies. Verify paste, extended keys, focus reports, mouse reports, and read-only attachments explicitly. |
| [Theme equality guard](/Users/alvistse/Documents/dev/cerebro/apps/desktop/src/renderer/src/components/terminal-stack.tsx:183) before assigning `options.theme`                   | ThemeService still rebuilds colors and restore defaults when a theme is assigned.                                                                         | **Keep.** Reapplying the same theme after replay would still erase application colors.                                                                                                                                                              |
| [TerminalContinuation](/Users/alvistse/Documents/dev/cerebro/packages/core/src/terminal-state.ts) private state capture/restore                                                  | Serialize 0.14 still does not serialize complete parser/terminal execution state. v6 adds mixed-type private cursor fields and synchronized-output state. | **Keep, revise schema and migration.** Do not blindly cast the old shape to v6. Saved state is the highest-risk part of this upgrade.                                                                                                               |
| [VtBoundary](/Users/alvistse/Documents/dev/cerebro/packages/mux/src/vt-boundary.ts) stores incomplete escape sequences outside xterm                                             | Native synchronized output does not serialize a partially received CSI/OSC/DCS or UTF-16 surrogate.                                                       | **Keep.** Frame boundaries and parser-continuation boundaries solve different problems.                                                                                                                                                             |
| [Ctrl punctuation + Shift+Enter CSI-u encoding](/Users/alvistse/Documents/dev/cerebro/apps/desktop/src/renderer/src/lib/terminal-keys.ts) and `Unidentified` physical-key fallback | v6 Keyboard.ts still handles the legacy Ctrl C0 mappings, not general Ctrl punctuation, and still collapses Shift+Enter to CR.                              | **Keep.** No inspected stable option replaces this with a general negotiated keyboard protocol. Avoid changing Ctrl+C or Alt/Meta behavior while upgrading. Shift+Enter must keep emitting `\x1b[13;2u` for Claude Code / Codex newlines.               |
| WebGL → Canvas → DOM fallback in terminal-stack                                                                                                                                  | Canvas addon is removed.                                                                                                                                  | **Replace with WebGL → DOM.** Retain context-loss disposal/fallback. Update tests that name Canvas.                                                                                                                                                 |
| `proposeDimensions()` + `terminal.resize()` instead of `fit()`                                                                                                                   | Fit 0.11 still calls `_renderService.clear()` before resizing.                                                                                            | **Keep the no-clear resize path.** Also retain the unchanged-grid check to avoid unnecessary PTY SIGWINCH.                                                                                                                                          |
| `waitForUsableSize`, rAF scheduling, 80 ms resize settling, activation fit/refresh/focus                                                                                         | xterm cannot own Cerebro's hidden workspace/tab/BSP layout or PTY sizing.                                                                                 | **Keep initially.** A new reflow option is not a replacement for layout lifecycle. Consider removal only from a separate measured reproduction.                                                                                                     |
| [Hidden native scrollbar CSS](/Users/alvistse/Documents/dev/cerebro/apps/desktop/src/renderer/src/assets/terminal.css) targeting `.xterm-viewport`                               | v6 uses a VS Code-style scrollable element and slider. Fit reserves its scrollbar width.                                                                  | **Rewrite the CSS and assertions.** Stable v6 has slider color options, but no verified public hide-scrollbar option. `overviewRuler.width = 0` falls back to the default width; it is not a hide switch. Preserve scrollback.                      |
| [Font loading and Nerd Font detection](/Users/alvistse/Documents/dev/cerebro/apps/desktop/src/renderer/src/lib/terminal-font.ts), bundled font, `rescaleOverlappingGlyphs: true` | v6 retains rescaling; documentation excludes Nerd Font, Powerline, and emoji glyphs and says DOM does not support rescaling.                              | **Keep font selection/loading and explicit rescaling.** DOM fallback requires visual checks; it cannot promise identical glyph handling to WebGL.                                                                                                   |
| `convertEol: true`, truecolor environment, dimensions, scrollback, output acknowledgments, replay suppression                                                                    | These are terminal behavior and mux transport contracts.                                                                                                  | **Keep and align both interpreters.** Neither release notes nor renderer configuration replace persistence, flow control, or reply ownership.                                                                                                       |

Additional protections sometimes discussed for Cerebro—automatic `clearTextureAtlas()` on OS focus and a 4096-pixel atlas clamp—are **not present in this checkout**. Do not describe them as patches being removed. The historical atlas explanation was unconfirmed; this upgrade is not proof that app-switch corruption is resolved.

### Native synchronized output: conditional removal, not an automatic deletion

The [v6 RenderService](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/RenderService.ts) buffers row rendering during mode 2026. However:

- [CoreBrowserTerminal](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts) still forwards cursor-move events to the renderer and updates the IME textarea immediately.
- [WebglRenderer](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-webgl/src/WebglRenderer.ts) restarts cursor blinking on cursor-move events. Native paint synchronization does not by itself prove unchanged blink timing or IME position.
- [Issue 6071](https://github.com/xtermjs/xterm.js/issues/6071), still open at audit time, reports approximately one frame per second under continuous synchronized animation. This is a reported risk, not a reproduced Cerebro result. The source contains the described deferred-render structure.

Our current Electron regression observes IME textarea position as a proxy for the cursor. On v6, separate **visible cursor**, **blink cadence**, and **IME anchor position** assertions. Do not merely delete a failing assertion because pixel drawing is synchronized. Run the old buffering adapter and native-only path against the same split-frame input. Remove the adapter only if required behavior passes on WebGL and DOM. If not, retain it or narrow it to the proven remaining gap; document why. Avoid adding a second unconditional buffering layer permanently.

### Saved state and live daemon compatibility

[SerializeAddon 0.14](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-serialize/src/SerializeAddon.ts) handles cells, styles, buffers, and selected modes. It does not replace our saved charset, saved cursor attributes, custom tab stops, scrolling regions, and other continuation data.

[CoreService v6](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/services/CoreService.ts) includes `cursorStyle`, optional `cursorBlink`, and `synchronizedOutput` in private modes. `Record<string, boolean>` is no longer a defensible schema for that object. DECSCUSR cursor style now uses private overrides; audit both DECSCUSR and DEC mode 12 rather than treating them as identical.

Plan a versioned, explicit continuation representation with a v1 reader and a migration to the v6 representation. Enumerate supported fields instead of copying every new private property automatically. Treat an in-progress synchronized update as transient render state: define how mid-frame snapshots become a complete visible screen without restoring an indefinitely paused renderer. A headless interpreter does not have the browser RenderService timeout.

Before rollout, verify whether the current mux handshake would allow an already-running 5.5 daemon to serve a v6 renderer. Add a terminal-engine/continuation compatibility check if it does. Do not silently exchange incompatible snapshots or restart user shells to hide the incompatibility. A daemon restart starts fresh shells; never replay commands. Preserve an original snapshot/journal backup and define rollback before v6 writes new state.

## Configuration decisions

Use explicit settings where they preserve intended behavior, rather than treating configuration changes as automatic fixes. The [stable option declarations](https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm.d.ts) and [defaults](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/services/OptionsService.ts) support these decisions:

| Setting                                | Plan                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimumContrastRatio: 1`              | Make exact-color preservation explicit. Higher values intentionally alter foreground colors and may brighten faint stars. This is already the default, not a new fix.                                                             |
| `customGlyphs: true`                   | Preserve the default for supported box/block glyphs. Does not replace Nerd Fonts or select Unicode width behavior.                                                                                                                |
| `rescaleOverlappingGlyphs: true`       | Keep the current explicit WebGL setting. Include a DOM fallback check for its documented limitation.                                                                                                                              |
| `cursorBlink: true`                    | Keep the user-facing default and respect application overrides. Setting it false is not a fix for intermediate cursor positions.                                                                                                  |
| `allowTransparency: false`             | Keep current opaque rendering. Do not change palette alpha behavior as part of the upgrade.                                                                                                                                       |
| `drawBoldTextInBrightColors`           | Keep current behavior initially (default true). False is an optional color-policy change for literal ANSI colors, not an upstream fix; review separately with shell/TUI samples.                                                  |
| `reflowCursorLine: false`              | Keep this default on both headless and browser. Upstream explicitly leaves it false because shells usually redraw the cursor line. Evaluate true only against a concrete resize defect; do not enable it in just one interpreter. |
| `convertEol: true`                     | Preserve current behavior on both interpreters for this migration. Changing to the upstream default false is a separate PTY semantics decision.                                                                                   |
| `macOptionIsMeta` / Alt-arrow handling | Preserve current policy. v6 removes an Alt-to-Ctrl-arrow mapping; check expected shortcuts and add explicit handling only where Cerebro needs it. This does not solve Ctrl+semicolon.                                             |
| `windowsPty`                           | Consider matching actual ConPTY metadata on both interpreters only if Windows is in the rollout scope. Do not invent backend/build values or apply Windows settings on macOS.                                                     |

Do not add clipboard/OSC52 behavior, ligatures, Unicode addons, or a new font policy simply because the new release supports related functionality. Those change product behavior and are outside the compatibility upgrade.

## Implementation sequence

1. **Freeze the compatibility baseline.** Inventory and preserve the existing dirty changes. Record small synthetic 5.5 snapshot/journal fixtures for normal and alternate buffers, colors, saved cursor/attributes, charset, tabs, margins, mouse/input modes, incomplete sequences, and cursor visibility/style. Record current UI settings and the existing split-frame regression. Use isolated test data, not private live terminal transcripts.
2. **Upgrade the dependency cohort and adapters.** Change only desktop/mux manifests and lockfile as required. Remove Canvas; wire WebGL failure/context loss to DOM. Audit private accesses in terminal-input, terminal-colors, and terminal-state against installed v6 packages. Retain the frame adapter during this stage. Implement continuation versioning and compatibility checks before enabling new state writes.
3. **Repair layout and packaging compatibility.** Update the scrollbar selectors and geometry expectations for v6; retain no-clear fitting and layout guards. Keep font and color policies stable. Verify both renderer bundling and the actual standalone mux bundle.
4. **Evaluate native synchronization.** Exercise native-only rendering with split star frames, normal 150 ms cadence, rapid continuous frames, missing terminators, resize, background/foreground transitions, and reconnect during a frame. Compare visible cursor, blinking, IME anchor, animation cadence, memory bounds, and terminal acknowledgments. Remove or narrow TerminalOutput only after the relevant checks pass.
5. **Validate recovery and controlled rollout.** Migrate v1 fixtures, checkpoint under v6, reconnect, restart the isolated daemon, and compare state plus subsequent output interpretation. Confirm old-daemon rejection/compatibility and rollback behavior. Document the required user-controlled restart; do not kill existing sessions during development.

### Packaging detail discovered in the published artifact

The npm `@xterm/headless@6.0.0` tarball declares:

```json
{
  "main": "lib-headless/xterm-headless.js",
  "module": "lib/xterm.mjs"
}
```

Its actual JavaScript files are `lib-headless/xterm-headless.js` and `lib-headless/xterm-headless.mjs`; there is no `lib/xterm.mjs` in the inspected tarball. This is verified package evidence, not an assumption from the repository tag. It does not establish that Vite will fail—its resolver may fall back to `main`. Check the real mux build first. If necessary, use a narrowly scoped resolver adjustment to the existing entry, rather than changing global resolution order. Do not import a nonexistent ESM path.

## Validation and removal gates

These are the validation and removal gates for this migration. See the implementation results below for completed checks and remaining coverage.

- Run ESLint and Prettier with explicit paths changed by the upgrade. Run React Doctor only for changed renderer components/utilities and review its findings.
- Run the mux color and recovery cases covering modified code; extend the fixtures for v1→v6 state, transient sync state, cursor overrides, and subsequent interpretation. Do not run the entire mux suite by default.
- Run real Electron specs covering the upgrade: `terminal-colors.spec.ts`, `terminal.spec.ts`, `mux.spec.ts`, and `panes.spec.ts`; select relevant cases where appropriate. The panes flow is necessary because fitting and hidden-terminal activation depend on BSP geometry. Add only the terminal-theme cases from `settings.spec.ts` if the theme settings UI changes.
- Keep regression assertions for exact OSC replies without duplicates, palette restoration, live theme changes, color defaults, truecolor/256-color cells, Ctrl punctuation, IME/paste, normal cursor blinking, no cursor jumps, font metrics, and resize without shell restarts.
- Exercise forced WebGL initialization failure and context loss using the DOM fallback. Replace Canvas-specific assertions with meaningful DOM behavior, not just a renamed renderer label.
- Check standalone CLI/headless startup, Electron detach/reload, daemon revival, and the packaged CJS mux entry. Do not use a browser pointed at Vite as verification.
- Do not run the full local Electron suite. Do not delete compatibility helpers until their replacement meets the relevant gate. Report missing platform coverage explicitly.

The expected cleanup is **one conditional frame-buffer removal, one required renderer-fallback replacement, and one viewport CSS migration**. Most other helpers remain necessary; several are mux ownership/persistence contracts rather than xterm defects. This plan does not promise that upgrading alone removes all cursor, sizing, or color integration code.

## Source map

- [InputHandler: synchronized modes, OSC colors, cursor styles](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/InputHandler.ts)
- [Headless terminal: registered services and events](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/headless/Terminal.ts)
- [Headless public declarations](https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm-headless.d.ts)
- [Keyboard: legacy Ctrl and modifier handling](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/input/Keyboard.ts)
- [FitAddon: clear-before-resize and scrollbar width](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-fit/src/FitAddon.ts)
- [Viewport: new scrollable element](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/Viewport.ts)
- [ThemeService: palette replacement and color restore](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/ThemeService.ts)

Local upstream inspection checkout: `/tmp/cerebro-xterm-6-audit`. Published artifact evidence: `/tmp/cerebro-xterm-pack-audit/xterm-headless-6.0.0.tgz`. These temporary paths are investigation aids; the pinned upstream URLs and registry versions identify the durable sources.

## Implementation results

The browser/headless pair is pinned to 6.0.0 with Fit 0.11.0, WebGL 0.19.0, and Serialize 0.14.0. Canvas has been removed; failed WebGL initialization and context loss use the built-in DOM renderer. The viewport CSS and tests use the v6 scrollable element. Exact-color, custom-glyph and cursor-line-reflow policies are explicit.

The real standalone mux build failed on the published headless package's nonexistent ESM entry. The mux and mux-worker builds now resolve that package's valid CJS entry with `createRequire`; other resolution behavior is unchanged.

**TerminalOutput stays.** A native-only Electron run with split synchronized frames moved the IME anchor from `32px,17px` to `192px,0px` and `184px,0px`. Native synchronized painting therefore does not replace Cerebro's bounded frame adapter. The retained adapter passes the same check. OSC palette ownership, reply filtering, continuation state, VT boundaries, no-clear fitting, Ctrl punctuation, theme equality, and font readiness guards also remain for the reasons in the audit. This upgrade does not establish that every animation pattern or platform is free of cursor/rendering defects.

Continuation version 2 preserves v6 private cursor overrides and public cursor defaults, while explicitly excluding active synchronized rendering transactions. Version 1 is accepted on recovery. Six synthetic fixtures produced by the actual 5.5 engine exercise subsequent interpretation under 6.0, including alternate buffers, attributes, saved state, charset and tabs. Legacy terminal files are copied to `xterm-5.5-backup` before migration and are excluded from normal checkpoint rotation. Mux protocol 2 rejects old clients rather than silently mixing continuation formats.

Validation covers scoped color, recovery, protocol, native PTY and frame-buffer tests, plus real Electron terminal, mux, pane, theme and renderer-fallback flows. Core/mux TypeScript builds and desktop/standalone bundling succeed. Scoped ESLint and Prettier are required for the edited files. React Doctor reports no findings in the three changed renderer files, but its maintainability phase failed and is incomplete. Windows/Linux, signed distribution packaging, exhaustive crash durability, and extended high-frequency animation performance remain release checks.

## Controlled rollout and rollback

No live user daemon was stopped during implementation. A running v1 daemon is incompatible with the upgraded client. Before replacing/reloading the old app, finish any active commands and use its **Quit Completely** action (or its matching old CLI's `server stop`). This ends live shells and checkpoints their output. Start the upgraded app afterward. Do not use the new protocol-2 CLI to stop an old daemon; its compatibility check intentionally rejects it. The upgraded daemon restores terminal output and starts fresh shells, without replaying commands.

Before rollout, back up the full Cerebro data directory while the daemon is stopped. Automatic per-pane backups are an additional terminal-output recovery aid, not a backup of the registry or running processes. They are created when a legacy continuation is loaded and retained until that pane is deleted.

To roll back, stop the upgraded daemon first and preserve its current data directory separately. Restore the pre-upgrade data-directory backup and the matching old app/CLI. If recovering individual legacy terminal files instead, restore `manifest.json` and numbered snapshot/journal files from each `mux/terminals/<pane-id>/xterm-5.5-backup` into that pane directory while both daemons are stopped. This recovers pre-migration output only; output written afterward remains in the separately preserved v6 data. Never point the old engine directly at v2 continuation files.
