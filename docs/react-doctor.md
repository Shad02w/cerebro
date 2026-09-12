# React Doctor

React Doctor 0.9.13 is pinned in the root development dependencies and installed by `pnpm install`. It supplements ESLint and Electron tests with React correctness, accessibility, performance, and maintainability diagnostics.

## Workflow

From the repository root, pass explicit paths to the renderer files changed by the current task:

```bash
pnpm react:doctor apps/desktop/src/renderer/src/hooks/use-app-route.ts
```

Multiple file paths are supported. Always pass files for task validation; running without paths defaults to project discovery and can broaden the scan. Review the findings against the implementation before changing code. Fix issues introduced by the task, report remaining findings, and retain the scoped lint, formatting, and related Electron tests required by `AGENTS.md`.

For an explicitly requested full renderer audit:

```bash
pnpm react:doctor:full
```

To save its structured report locally:

```bash
mkdir -p logs/react-doctor
pnpm react:doctor:full --json --json-out logs/react-doctor/report.json
```

`logs/` is already ignored by Git. Both commands disable telemetry, remote scoring, and the separate dependency supply-chain scan (`--no-score --no-supply-chain`). Source diagnostics still run; no numerical health score is produced. The default gate exits nonzero for error findings; warnings remain advisory. Pass `--blocking warning` when a stricter gate is appropriate.

This integration adds local commands and agent instructions. It does not install Git hooks or add a CI job. CLI behavior is documented in the [official reference](https://www.react.doctor/docs/reference/cli-reference).

Version 0.9.13 may print an agent-install hint saying React Doctor is not installed. Its check looks for conventional Doctor scripts in the nearest package manifest; it does not recognize this root-level `react:doctor` integration when scanning the renderer. The pinned CLI is installed and both commands were verified.

## Baseline: September 11, 2026 (America/Toronto)

The full scan of `apps/desktop/src/renderer` detected React 19, Vite, and TypeScript. It analyzed 55 supported source files, including the UI component directory. The source scan completed with no skipped checks: **0 errors and 22 warnings across 13 files**. CLI exit status was 0 because warnings are advisory.

| Category        | Warnings |
| --------------- | -------: |
| Bugs            |        9 |
| Maintainability |        7 |
| Performance     |        4 |
| Accessibility   |        2 |
| Security        |        0 |

These are static-analysis findings, not 22 confirmed runtime defects. No application source was changed during this audit, and no Electron tests were run. Counts and line numbers below describe this snapshot; rerun the command for current results.

### Findings worth addressing

- **Accessibility:** the Changes content's `aside` has `aria-expanded`, which its implicit role does not support. The terminal tab close button is nested inside an element with `role="tab"`; review its semantics and keyboard behavior in Electron.
- **External state:** `useAppRoute` mirrors `window.location.hash` using state and an effect. `useSyncExternalStore` is the appropriate subscription primitive. The scan identifies the pattern; a stale-route failure was not reproduced.
- **List identity:** CI check keys include the array index. Prefer an upstream stable identifier if checks can reorder. The current list has no editable row state, so the scanner's warning about submitting incorrect data is not demonstrated here.
- **Maintainability:** six React functions exceed complexity thresholds. `ChangesView`, `AddWorkspaceDialog`, and the settings components are candidates for extracting focused components or hooks.
- **Small cleanup:** reuse `Intl.RelativeTimeFormat`; consider moving `updateList` outside the hook. Chained array iterations and serial font checks are optimization candidates, not measured bottlenecks.

### Findings requiring context

- **Three external-link warnings are false positives:** `ci-status.tsx` and `workspace-hover-card.tsx` intentionally call `preventDefault()` and `window.cerebro.openExternal()`. The preload bridges that call to the main process, whose handler opens the URL with Electron's `shell.openExternal()`.
- **Three mutation-cache warnings are false positives:** all three mutations in `use-github.ts` have `onSuccess: applyGitHubStatus`. That shared helper in `src/lib/query-client.ts:73` updates the GitHub cache and resets or invalidates dependent queries when the account changes.
- **The keybind callback warning is low priority:** `invoke` is memoized with `useCallback` over a stable ref supplied by the provider. Source inspection does not support the scanner's suggestion that it changes on every redraw. Resubscription when bindings or recording state change is intentional.
- **Performance advice needs measurement:** the font loop operates on a short candidate list. Preserve ordering and fallback behavior in any optimization; do not blanket-convert every sequential font operation to `Promise.all`.

No rule suppressions were added for this baseline.

### All 22 warnings

Paths are relative to `apps/desktop/src/renderer`. Each row is one diagnostic, and all have warning severity.

| File:line                                    | Rule                                  | Review                                          |
| -------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| `src/components/add-workspace-dialog.tsx:37` | `no-high-complexity-react-function`   | Refactor candidate: cyclomatic 25, cognitive 31 |
| `src/components/add-workspace-dialog.tsx:76` | `js-combine-iterations`               | Optional optimization; measure first            |
| `src/components/changes-file-list.tsx:115`   | `js-combine-iterations`               | Optional optimization; measure first            |
| `src/components/changes-view.tsx:89`         | `no-high-complexity-react-function`   | Refactor candidate: cyclomatic 22, cognitive 32 |
| `src/components/changes-view.tsx:248`        | `role-supports-aria-props`            | Unsupported `aria-expanded` on `aside`          |
| `src/components/ci-status.tsx:64`            | `no-array-index-as-key`               | Prefer stable CI check identity                 |
| `src/components/ci-status.tsx:67`            | `no-prevent-default`                  | False positive: Electron external link          |
| `src/components/ci-status.tsx:93`            | `no-prevent-default`                  | False positive: Electron external link          |
| `src/components/cli-settings.tsx:7`          | `no-high-complexity-react-function`   | Refactor candidate: cyclomatic 18, cognitive 44 |
| `src/components/settings-view.tsx:41`        | `no-high-complexity-react-function`   | Refactor candidate: cyclomatic 12, cognitive 24 |
| `src/components/settings-view.tsx:381`       | `no-high-complexity-react-function`   | Refactor candidate: cyclomatic 14, cognitive 39 |
| `src/components/terminal-tab-bar.tsx:141`    | `html-no-nested-interactive`          | Review close button inside `role="tab"`         |
| `src/components/workspace-hover-card.tsx:17` | `js-hoist-intl`                       | Reuse the relative-time formatter               |
| `src/components/workspace-hover-card.tsx:23` | `no-high-complexity-react-function`   | Refactor candidate: cyclomatic 13, cognitive 19 |
| `src/components/workspace-hover-card.tsx:94` | `no-prevent-default`                  | False positive: Electron external link          |
| `src/hooks/use-app-route.ts:5`               | `prefer-use-sync-external-store`      | Improve the external-state subscription         |
| `src/hooks/use-github.ts:17`                 | `query-mutation-missing-invalidation` | False positive: shared cache helper             |
| `src/hooks/use-github.ts:21`                 | `query-mutation-missing-invalidation` | False positive: shared cache helper             |
| `src/hooks/use-github.ts:25`                 | `query-mutation-missing-invalidation` | False positive: shared cache helper             |
| `src/hooks/use-projects.ts:104`              | `prefer-module-scope-pure-function`   | Move a non-capturing helper outside the hook    |
| `src/keybinds/provider.tsx:77`               | `prefer-use-effect-event`             | Existing callback is memoized over a stable ref |
| `src/lib/terminal-font.ts:94`                | `async-await-in-loop`                 | Optional concurrency for font enumeration       |
