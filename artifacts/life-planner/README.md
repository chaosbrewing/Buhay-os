# Buhay.OS Life Planner

Buhay.OS is a private web planner for daily and weekly plans, projects, Inbox capture, habits, routines, notes, templates, Google Calendar, and longer-term intentions. Planner content is encrypted in the browser before cloud sync. The separate encryption passphrase is not the Clerk account password and cannot be recovered.

## Web release status

**Not ready for publishing.** All Release 2 navigation and direct routes are disabled for this release because the required real-account isolation run has not been completed. The saved planner data is unchanged. See [Release 2 and web release evidence](docs/release-2.md) for the gate results, unresolved security findings, and setup blockers.

The Release 2 feature flags are set to `false` in the shared environment: `VITE_RELEASE_TWO_GOALS`, `VITE_RELEASE_TWO_LIFE_AREAS`, `VITE_RELEASE_TWO_LINKS`, `VITE_RELEASE_TWO_TIMELINE`, `VITE_RELEASE_TWO_REVIEWS`, and `VITE_RELEASE_TWO_SEARCH`. They also fail closed when unset; enable a section only by explicitly setting its flag to `true` after its account-isolation and feature gates pass.

## Run and verify

From the workspace root:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/life-planner run typecheck
pnpm --filter @workspace/life-planner run test
pnpm --filter @workspace/planner-contract test
pnpm --filter @workspace/life-planner run test:e2e:calendar
pnpm --filter @workspace/life-planner run test:e2e:recurrence
pnpm --filter @workspace/life-planner run test:e2e:release-two
pnpm --filter @workspace/life-planner run test:e2e:habits
```

The habit browser suite requires approved disposable Clerk test-account setup in `artifacts/buhay-os-mobile/.env.e2e` (`E2E_CLERK_PUBLISHABLE_KEY`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, and `E2E_PLANNER_PASSPHRASE`). Do not substitute mock sign-in for the account-isolation release gate. The recurrence, calendar recovery, and Release 2 harnesses use isolated browser test data and do not sign in through the real Clerk flow or call live Google Calendar.

The managed web artifact supplies its `PORT` and `BASE_PATH` for development and production builds. Do not edit `.replit-artifact/artifact.toml` directly.

## Privacy, sync, and recovery

- The API accepts and returns only an opaque encrypted planner payload and revision metadata. It does not parse planner records.
- Browser encryption uses PBKDF2-SHA256 and AES-GCM-256. The passphrase and derived key must never be sent to the server or written to logs.
- The encrypted offline cache stays on the device. Search is local to the currently unlocked snapshot.
- JSON backup files are unencrypted and controlled by the user. Keep them in a private location.
- Google Calendar connection is optional and explicitly authorized. The web app requests event access and calendar-list read access so users can choose calendars. Calendar data is temporary in the app; it is not copied into planner snapshots.
- Web changes do not authorize native builds, mobile dependency changes, production-data changes, migrations, or deployment.

## Known limitations and reporting

- Real Clerk sign-in, two-account isolation, real planner API save/reload, offline browser conflict convergence, and deleted-habit encrypted sync persistence still need approved-account verification.
- Live Google OAuth/provider behavior and responsive/accessibility review at the required viewport sizes are not certified by the local mock-backed browser suites.
- There is no user-facing feedback or problem-reporting route configured in this web build. The release owner must provide one before marking the release ready.
- No production deployment or publishing has been performed.
