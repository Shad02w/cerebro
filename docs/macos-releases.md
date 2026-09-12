# macOS releases

Cerebro currently distributes macOS builds only. Each release includes a DMG and
ZIP for Apple Silicon (`arm64`) and Intel (`x64`). Build each architecture on its
native runner: the app bundles the build host's Node runtime and native PTY.

| Mode                | Default home    | SQLite database                |
| ------------------- | --------------- | ------------------------------ |
| Local `pnpm dev`    | `~/cerebro-dev` | `~/cerebro-dev/cerebro.sqlite` |
| Packaged production | `~/cerebro`     | `~/cerebro/cerebro.sqlite`     |

The original dev command remains `electron-vite dev --watch`. It launches the
installed Electron runtime directly. There is no custom dev launcher, copied
bundle, app-ID switching, or packaged development release channel.

Before storage initialization, unpackaged Electron sets a default `CEREBRO_HOME`
of `~/cerebro-dev`. Packaged builds retain the core default of `~/cerebro`.
This uses `app.isPackaged`, not `NODE_ENV`, so a local production-mode build used
for previews or tests still uses the development home.

`CEREBRO_HOME` overrides the home in either mode. `CEREBRO_DB_PATH` overrides the
SQLite file independently. Mux state follows the selected home; the installed CLI
launcher uses its app's home. Existing `~/cerebro` data is not moved or deleted.

## Automatic releases

The GitHub repository is public. Published releases and installer downloads are
available to users without repository membership.

`.github/workflows/release-mac.yml` runs on pushes to `release`, including merges.
It always builds production. Protect that branch in GitHub if releases should
only come from reviewed pull requests. Manual workflow runs also build production.

Every workflow run has a unique version. The desktop package version is the base:
`1.0.0` becomes `1.0.0+build.42`.
The workflow run number is also the macOS bundle build number. Increment the base
version in `apps/desktop/package.json` when the product version changes. Build
metadata distinguishes production artifacts; it does not change SemVer precedence.
This pipeline distributes downloads, not in-app automatic updates.

Both architecture builds must pass a packaged Electron smoke check before the
publish job creates a release at the triggering commit. Uploads include SHA-256
checksums. Assets are uploaded to a draft first, then published together. Reruns
can resume a draft; published releases are not overwritten. Build jobs have
read-only repository access; only the publish job has `contents: write`.

No Apple credentials are currently required. The workflow disables signing
identity discovery and explicitly ad-hoc signs the final app bundle. This seals
the modified Electron resources without an Apple certificate. Hardened runtime
is enabled only for Developer ID builds. Ad-hoc builds are not notarized and
still require user approval on first launch. Users may need to
attempt opening the app, then allow it through **System Settings → Privacy &
Security → Open Anyway**. macOS policy may prevent that on managed computers.

## Local packaging and verification

Run from the repository root on a Mac with Node 22.13+ (CI uses Node 24):

```sh
pnpm --filter desktop build:mac
# Faster unpacked production build:
pnpm --filter desktop build:unpack
pnpm --filter desktop exec tsx scripts/verify-mac-package.ts
```

Outputs are in `apps/desktop/dist/production`. Packaging
never publishes by itself. The verifier first runs `codesign --verify --deep --strict`, checks the bundle ID,
and opens the actual
packaged Electron app with temporary data, verifies the CLI identity and mux
connection, and stops the isolated mux afterward.

## Signing later

When a Developer ID Application certificate is available, configure the build job
with `CSC_LINK` (base64 P12 certificate), `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` from GitHub Actions secrets.
Remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` and set
`CEREBRO_REQUIRE_SIGNING: 'true'`. The packaging script then requires a valid
signature and enables Electron Builder notarization. Update the release notes to
remove the ad-hoc-build instructions after verifying a notarized release.

## Browser-download installation check

Executable smoke tests do not prove Gatekeeper acceptance. Before releasing a
packaging change, also download the DMG through a browser, open it in Finder,
copy Cerebro to Applications, eject the image, and open the installed app.
Keep quarantine intact and do not disable Gatekeeper. An ad-hoc build may need
an explicit Open Anyway approval; a "damaged" signature error is a release defect.
Verify opening a terminal and reopening the app after the first launch.
