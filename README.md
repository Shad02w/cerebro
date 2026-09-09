# Cerebro

Cerebro is an Electron desktop app for organizing projects and workspaces. Its content area supports tabs containing terminal and Changes panes.

## Development

Install dependencies and start the desktop app:

```bash
pnpm install
pnpm --filter desktop dev
```

The renderer development server is used by Electron for the UI; open and test the application through the Electron window.

## CLI

The repository includes a source CLI for project, workspace, tab, and pane operations. Build its shared core dependency and the CLI with:

```bash
pnpm --filter @cerebro/core build
pnpm --filter @cerebro/cli build
```

Then run it directly from the repository:

```bash
node apps/cli/dist/index.js --help
```

Project and workspace commands operate on Cerebro's local data. Tab and pane commands require the desktop app to be running with the same `CEREBRO_HOME`.

> This README was added as a small documentation-only demo change.
