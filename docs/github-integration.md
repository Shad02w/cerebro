# GitHub integration

Cerebro loads local projects independently from PR data. TanStack Query owns PR caching, polling (60 seconds, including background windows), focus/reconnect refresh and invalidation. Native Electron focus events are registered once at renderer bootstrap; this flow does not use component effects. PR queries stay observed while sidebar groups are collapsed.

Queries and mutations use `networkMode: 'always'` because they call Electron IPC. Chromium's offline signal must not pause local operations or main-process provider requests; the providers report their own network failures.

PR status replaces the leading branch icon, including each repository/worktree branch in a multi-root project. Initial loading, unavailable providers and branches without a PR keep the default branch icon. Refresh has no spinner and preserves a known PR icon; stale details remain available in its tooltip and popover.

Hover a workspace row for its full branch name and relative workspace creation date. If it has a PR, the card includes a clickable PR number/title, relative PR creation date, state, review decision, mergeability and CI summary. Workspace creation means registration in Cerebro; Git does not store a reliable branch creation date. CI uses the latest PR commit's [combined check/status rollup](https://docs.github.com/en/graphql/reference/commits#statuscheckrollup). Missing check access displays “Unavailable” without discarding readable PR details.

The hover card and PR popover show individual check names, readable status labels, static colored icons and HTTP(S) detail links. Both check runs and external commit statuses are supported. Up to 20 checks are included per PR to bound polling payloads; the total count and “View all checks on GitHub” link disclose any remaining checks. Running checks have a static blue icon; queued/waiting/action-required checks are amber, passing checks green, failures/timeouts red, and cancelled/skipped/neutral checks muted. No loading spinner is shown.

## GitHub App configuration

For `cerebro-oauth-app` (or your own App):

1. Enable **Device Flow**. Keep the app public if other users need to install it.
2. Repository permissions: **Contents: read**, **Pull requests: read**, and the required **Metadata: read**. No write or organization permissions are needed for this feature.
   For CI access, include **Checks: read** and **Commit statuses: read**; see GitHub's [repository permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).
3. Keep user access token expiration enabled. Cerebro encrypts access and refresh tokens with Electron `safeStorage`, refreshes expiring tokens automatically, and persists both rotated tokens. Device-flow token renewal does not require a client secret. A refresh token that expires/revokes requires reconnecting. Existing nonexpiring tokens are also supported.
4. Install the App on the intended account/organization. Select **Only select repositories** or **All repositories**. Private repositories must be included and organization installation/permission updates may require an owner to approve them.
5. In Cerebro, connect using the device code. **Configure** opens the installation settings, or the installation page when no installation exists. Authorization of a user and installation on repositories are separate steps.
6. After changing permissions, approve the installation's new permissions. Return to Cerebro to recheck access.

The production build uses `MAIN_VITE_GITHUB_CLIENT_ID`; `CEREBRO_GITHUB_CLIENT_ID` can override it at launch. `CEREBRO_GITHUB_APP_SLUG` overrides the installation-link slug. Do not embed a client secret or App private key in the desktop application. Webhooks are not required for desktop polling.

## Provider behavior

`RepositoryService` chooses a provider separately for each capability/repository: GitHub App, then the signed-in `gh` CLI, then system Git. App tokens are renewed before falling back. A successful empty PR response is authoritative. Git cannot report PR/review states: an unsuccessful GitHub lookup is unavailable, not “no PR.” Rate limits honor GitHub's retry deadline; errors retain the previous query result with a stale indicator.

GitHub CLI credentials can authorize more repositories than the App installation selection. The PR popover identifies the provider, fallback reasons and last successful refresh. Disconnecting the App clears its cached PR results, but the independently authenticated CLI can continue providing status.

Only network Git operations use credential fallback; local worktree/database mutations execute once. App authorization is passed through the child process environment, never in clone URLs, process arguments, or saved Git remotes. Local Git operations and the standalone Cerebro CLI retain system credentials.

Each discovered checkout has its current branch and origin read from Git, including worktrees whose `.git` is a file. Multi-root children with the same remote share a PR query, while each row selects its own branch. Detached HEADs and plain folders have no branch PR. The parent folder does not pretend to have a single PR state. Matching excludes identically named branches from unrelated forks. Repository results paginate and prefer open PRs, then the most recently updated PR.

## Verification

Run only the affected tests:

```sh
pnpm --filter desktop test:integration
pnpm --filter desktop test:e2e github.spec.ts projects-github.spec.ts projects-directory.spec.ts
```

Integration tests use a real local HTTP server, a schema-validated GraphQL mock, a fake `gh` executable and temporary Git repositories. E2E tests launch Electron with an isolated `CEREBRO_HOME`; they do not use the developer's GitHub CLI login. They cover login, rotation, fallback, native focus, interval refresh, stale recovery, PR icons and multi-root/worktree matching.
