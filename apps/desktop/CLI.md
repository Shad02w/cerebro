# Bundled CLI

Settings → CLI installs/removes a launcher in `~/.local/bin`. If the app's PATH already
includes that directory, shell configuration is left untouched. Otherwise it adds
a marked PATH block in the current shell's startup file (zsh or bash). Linked shell profiles are updated
through their resolved targets, preserving the links. Installation refuses foreign
command files, command symlinks, and broken profile links. Removal preserves projects,
data, and unrelated shell settings.

## Development

`pnpm --filter desktop dev` builds and watches the CLI and core alongside Electron.
Install creates `cerebro-dev`, pointing at this checkout's `out/cli`; it does not
replace the released `cerebro` command. Only one checkout owns `cerebro-dev` at a time;
install/repair from another checkout switches its target.

The launcher defaults to the installing app's `CEREBRO_HOME`; an explicit terminal
environment override takes precedence. This does not create a separate dev database:
start the dev app with a distinct `CEREBRO_HOME` if you want isolated development data.
CLI use does not start Electron. Live tab/pane commands still require the app.

## Packaged app

Builds produce `out/cli/cerebro.cjs`, Node, its license, and runtime metadata.
electron-builder copies these into `Contents/Resources/cli` on macOS (and
`resources/cli` elsewhere). The installed `cerebro` launcher points there; replacing
the app updates the CLI. Moving the app requires repair from its new location.

Use an official Node distribution, version 22.13 or newer. The build copies the
build host's runtime; build separately on each target OS/architecture. Cross-target
and universal packaging are rejected. If Node's LICENSE is not beside the runtime,
set `CEREBRO_NODE_LICENSE` to its distribution LICENSE. macOS signing includes Node.

One-click installation supports macOS and Linux with zsh/bash. Windows and portable
AppImage installations display an unavailable explanation. No automatic uninstall
hook runs when a macOS app is dragged to Trash: remove the CLI in Settings first,
or delete `~/.local/bin/cerebro` and its marked shell PATH block afterward.

## Verification

`pnpm --filter desktop test:e2e settings.spec.ts` uses Electron and a temporary
installation home, covering launcher execution without system Node, shell PATH,
repair, removal, foreign-command protection, and error handling.

After `pnpm --filter desktop build:unpack`, set `CEREBRO_E2E_PACKAGED_APP` to the
absolute packaged executable path and run
`pnpm --filter desktop test:e2e:repeat settings.spec.ts --grep 'CLI settings installs'`
to exercise the production launcher with an isolated HOME.
