# macOS releases

Cerebro currently distributes macOS builds only. Each release includes a DMG and
ZIP for Apple Silicon (`arm64`) and Intel (`x64`). Build each architecture on its
native runner: the app bundles the build host's Node runtime and native PTY.

| Build                | App ID                | Installed name | Default data    | Installed CLI |
| -------------------- | --------------------- | -------------- | --------------- | ------------- |
| Production           | `com.cerebro.app`     | Cerebro        | `~/cerebro`     | `cerebro`     |
| Packaged development | `com.cerebro.app.dev` | Cerebro Dev    | `~/cerebro-dev` | `cerebro-dev` |

The packaged channel is recorded in `package.json` as `cerebroChannel`. It does
not depend on `NODE_ENV`, `is.dev`, or a runtime environment switch. Distinct
product names also separate Electron's default user-data directories.
`CEREBRO_HOME` and `CEREBRO_DB_PATH` remain explicit overrides. Do not point both
channels at the same data if you want independent databases and mux instances.
The installed CLI launcher uses its app's data directory.

Local `pnpm dev` retains its existing data behavior and `cerebro-dev` CLI name.
A local CLI installation and a packaged dev CLI installation use the same command;
installing either updates that development launcher to the selected build.

## Automatic releases

The GitHub repository is public. Published releases and installer downloads are
available to users without repository membership.

`.github/workflows/release-mac.yml` runs on pushes to `release`, including merges.
It builds production by default. Protect that branch in GitHub if releases should
only come from reviewed pull requests. Manual workflow runs offer `dev` or
`production`; dev uploads are GitHub prereleases and never become Latest.

Every workflow run has a unique version. The desktop package version is the base:
`1.0.0` becomes `1.0.0+build.42` in production or `1.0.0-dev.42` for development.
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
identity discovery and publishes unsigned, unnotarized builds. Users may need to
attempt opening the app, then allow it through **System Settings → Privacy &
Security → Open Anyway**. macOS policy may prevent that on managed computers.

## Local packaging and verification

Run from the repository root on a Mac with Node 22.13+ (CI uses Node 24):

```sh
pnpm --filter desktop build:mac
pnpm --filter desktop build:mac:dev
# Faster unpacked production build:
pnpm --filter desktop build:unpack
# Unpacked development build:
pnpm --filter desktop exec tsx scripts/package-mac.ts dev --dir
pnpm --filter desktop exec tsx scripts/verify-mac-package.ts production
pnpm --filter desktop exec tsx scripts/verify-mac-package.ts dev
```

Outputs are in `apps/desktop/dist/production` and `apps/desktop/dist/dev`. Packaging
never publishes by itself. The verifier checks the bundle ID, opens the actual
packaged Electron app with temporary data, verifies the CLI identity and mux
connection, and stops the isolated mux afterward.

## Signing later

When a Developer ID Application certificate is available, configure the build job
with `CSC_LINK` (base64 P12 certificate), `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` from GitHub Actions secrets.
Remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` and set
`CEREBRO_REQUIRE_SIGNING: 'true'`. The packaging script then requires a valid
signature and enables Electron Builder notarization. Update the release notes to
remove the unsigned-build instructions after verifying a signed release.
