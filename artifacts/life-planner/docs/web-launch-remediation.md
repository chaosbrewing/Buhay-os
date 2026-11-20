# HANAY web launch remediation

## Release boundary

This is a finite reliability/privacy closeout, not a feature release. The existing web planner and shared API are the only delivery targets. Expo/native code is preserved and on hold. No deployment, production settings, database migration, passphrase change or encryption architecture change is authorized by this pass.

Chaos Origins gate: organize fragmented daily plans; make commitments understandable and recoverable; serve people balancing everyday responsibilities; protect their time and private records. The primary journey remains sign in → unlock → plan/capture → encrypted save → return or recover.

### Minimum independent launch scope

Ship the existing authenticated responsive web planner: Today, Week, Notes, three templates, local Search, permitted Google Calendar operations, encrypted account sync and local cache, version history, confirmed JSON backup/recovery, Markdown export, themes and navigation. Existing Release 1/2 additions remain bounded by their current feature flags and actual tested capabilities; no further release or native dependency is required.

An already loaded planner can accept offline edits and later reconcile them. A fully cold, signed-out browser starting offline has not been certified. Browser reminders require the page to remain available; this release does not promise reliable closed-browser/native alarms. Real Google operations require the user's separate Google authorization.

Out of scope: new features, native builds/stores, broad dependency upgrades, external deployment, production migrations and encryption redesign. Launch gates are all required automated checks passing, no reproducible fresh-page application error, tested recoverable data-changing flows/account isolation, documented security dispositions, an approved web-only production target, and authorized production authentication/Google smoke checks. Stop after those gates; do not proceed automatically to another release.

## Change summary

| Problem | Minimal remediation | Acceptance and privacy boundary |
| --- | --- | --- |
| Online unlock ignored offline edits | Account-owned encrypted cache bookkeeping retains the cloud baseline and dirty status; divergent copies pause for explicit recovery. | Preserve local/cloud originals, retain conflicting records, never upload plaintext or guess at an unreadable copy. |
| Draft crossed accounts | Calendar session drafts include verified ownership and use account-specific keys; logout/account changes clear drafts. | Reconnect still recovers the owner's draft; unowned legacy plaintext cannot be restored. Google drafts remain outside planner E2EE. |
| Lock restored title previews | Scheduler reads live unlocked/privacy state; disposal cancels timers and rejects already-queued callbacks. | No scheduled content while locked; settings remain in the encrypted planner. Web reminders require a running browser page. |
| Today used UTC | Shared web date helpers use local year/month/day for Today, defaults, offsets and week boundaries. | Preserve stored date-only formats; test Sydney/Melbourne, Los Angeles, Kiritimati and DST. |
| Backup selection replaced data | Accessible preview/confirmation, encrypted pre-replacement checkpoint and Settings recovery action. | No replacement on cancel or failed recovery save. Exported JSON remains explicitly unencrypted. |
| Dependency and zoom issues | Express 5.3.0 resolves proxy-addr 2.0.8; remove viewport zoom restriction. | Targeted dependency change, no native package edits or broad upgrades. |

## Storage and compatibility

- The server/API envelope remains `cryptoVersion: 1`, AES-GCM-256, PBKDF2-SHA256 with 310,000 iterations and random IVs. No schema/database change.
- New account-cache bookkeeping is browser-only; it contains encrypted current/baseline envelopes, revision and dirty metadata. The account ID is ownership metadata, not planner content.
- Older bare encrypted caches are preserved. Since they have no recorded owner, recovery requires explicit ownership confirmation and successful passphrase decryption. They are never automatically assigned to a different account.
- Malformed or undecryptable copies block replacement rather than disappearing into fresh defaults.
- Normalizers preserve optional/unknown planner fields; JSON backups and encrypted history remain compatible.
- Divergent recovery saves unique encrypted original copies before confirmation. Without a common baseline, both copies are retained; records deleted from one older copy may return. Review conflict copies after continuing.
- Import/history replacement first preserves the current planner. Settings → **Recover previous planner** restores the latest pre-replacement snapshot while also checkpointing the current state.
- Account caches are retained encrypted after logout. Clearing site storage still removes device-only recovery copies: export a private backup and finish sync before doing that.

## Verification evidence

Executed against this remediation candidate:

| Check | Result |
| --- | --- |
| `pnpm run typecheck:libs` | PASS |
| `pnpm --filter @workspace/life-planner run typecheck` | PASS |
| `pnpm --filter @workspace/life-planner test` | PASS: 43 tests |
| `pnpm --filter @workspace/planner-contract test` | PASS: 41 tests |
| `pnpm --filter @workspace/api-server run typecheck` | PASS |
| `pnpm --filter @workspace/api-server test` | PASS: 48 tests |
| Web production build with artifact PORT/BASE_PATH | PASS; large-chunk and existing source-map reporting warnings |
| API build/start through managed workflow | PASS |
| Calendar recovery Playwright suite | PASS: 2 tests |
| Recurrence Playwright suite | PASS: 4 tests |
| Release 2 Playwright suite | PASS: 4 tests; synthetic harness identities, not real account evidence |
| Unauthenticated development planner API GET | HTTP 401, `Unauthorized` |
| Dependency audit | 0 critical, 6 high, 4 moderate |
| Static-code scan | 2 high in held native server, 1 medium OAuth redirect finding |
| Privacy/dataflow scan | 0 findings; not proof of absence of all privacy issues |

The first calendar command failed before browser tests because its configuration selected every suite and requested a missing downloaded Chromium. It now selects only calendar recovery and uses the existing system Chromium when available; the subsequent 2-test run passed. This did not install or build native tooling.

### Real-account browser evidence

Two disposable programmatic Clerk accounts and synthetic planner records were used in development. Production and personal Google data were not accessed.

- Real authenticated `/api/planner/state` save and read returned HTTP 200. Save bodies had only `expectedRevision` and an encrypted `payload`; tested task/note/passphrase markers were absent from envelopes. A cookie-free API read returned 401.
- Reload/unlock restored Account A's test records. Account B's live DOM and local Search did not expose Account A's test markers; their authorized API payload fingerprints differed.
- Offline task/note edits were cached encrypted and dirty. After closing offline, adding a different cloud edit in a separate A context, reopening online and unlocking, the recovery screen appeared. Keeping both preserved device and cloud records through secure sync and another reload/unlock.
- Backup preview and cancellation left the planner intact. Confirmed replacement persisted through reload. Settings recovery restored the post-backup record; test-owned history restore also succeeded.
- A same-record conflict attempt was interrupted by a development hot update after a hook was added. React reported a hook-order/ErrorBoundary failure on already-open pages. After a full web workflow restart, fresh authenticated pages did not reproduce the failure. The controlled same-record two-client conflict then passed: both the remote record and local conflict copy survived sync, reload and re-unlock without a recovery loop.
- A browser-only quota shim made the pre-import checkpoint fail. The preview stayed open, displayed `Quota exceeded` and `Nothing has been replaced yet`, and did not replace the planner. The shim was removed before continuing.
- A browser-only Notification/timer mock verified a generic body with title previews disabled. The retained callback emitted nothing after lock. The privacy setting survived reload/unlock; the temporary reminder was removed afterward.
- Calendar draft restore/clear ownership passed with separate owner IDs at module level. The disconnected live Calendar offered no event editor; no real Google authorization, event write or live reconnect was attempted. The separate reconnect harness tests passed.
- Import Tab navigation remained inside the dialog over the checked controls; Escape closed it without replacement. Responsive authenticated views at 360×800, 768×1024 and 1440×900 had no document-level horizontal overflow. The compact bottom navigation scrolls horizontally; tablet cards wrap tightly but remain usable.
- Three template cards rendered; Today/Week/Settings navigation and dark/light theme save/sync smoke checks passed. No template was applied to real data.

These are bounded checks, not a complete WCAG/screen-reader certification or exhaustive multi-tab/offline stress test. The credential-dependent dedicated habits browser script was not run; shared habit tests passed and habits were not changed by this pass.

Representative authenticated screenshots from the testing run: `d2za6c` quota-safe import, `ich7fa` lock after stale reminder callback, `tjyj4d` phone, `fkfcau` tablet, `buh6z6` desktop, and `8ci2ki` final synced conflict copies. These are session evidence IDs, not deployed URLs.

## Security triage

- **proxy-addr:** the API dependency tree now resolves 2.0.8 through Express 5.3.0. The former critical advisory is absent from the fresh scan.
- **braces 3.0.3:** still present through http-proxy-middleware → micromatch; registry metadata reports no newer published braces version and no fixed version for the advisory. The existing Clerk proxy uses the default literal `/` path filter, not a user-provided glob. The dependency's pattern-matching code passes this literal through a string-prefix branch; request URLs are not parsed as brace patterns. The vulnerable AST walk is not reachable through this inspected configuration. Reassess if configurable glob filters are added; do not suppress the scanner finding globally.
- The other high advisories are brace-expansion, node-forge, source-map-js and uuid. The API production dependency query finds none of these; their inspected paths are Expo/tooling. Native dependency changes remain out of scope.
- Static OAuth redirect finding is not confirmed exploitable: the destination is the fixed Google authorization origin and the return path is allowlisted. Native file-path findings remain unconfirmed and outside this implementation target; the native server is nevertheless still publicly served in the existing production configuration.
- No claim that “zero findings” means the application is secure. Residual exposure/acceptance must be reviewed before publishing.

## Production separation proposal — not applied

Prepare a deployment containing only the web static output and shared API. Exclude the Expo build/run service and native preview route from the release deployment, without deleting the companion source or changing development artifacts. The film and mockup sandbox are not web-launch dependencies.

Changes to artifact/deployment selection must be performed through supported validated deployment controls after the owner approves this separation. This pass does not edit production configuration or publish anything.

The previous audit verified a live/source mismatch: the deployed bundle lacked the merged reminder-privacy property and generic notification text. The local candidate includes the remediation; production intentionally remains unchanged. A matching deployed revision, production Clerk and Google callback/consent verification remain post-approval release gates.

Read-only deployment recheck: the existing deployment is public Autoscale and reports a successful build. Its live bundle is `index-BA0qWee0.js`; the final local candidate build is `index-DosU2Nid.js`. The live native route still returns HTTP 200. Availability is not evidence that the candidate or a web-only boundary has been deployed.

## Task disposition

Task 80 remains the finite web-release closeout, not a request to start deferred features. Its description/acceptance scope was updated in the preceding Plan phase. A separate execution subsequently reported Ready; that status does not certify the current working-tree candidate, a merged change, production equivalence, or the external release gates below. This report is the current remediation evidence; no task completion/merge was performed here.

Task 78's existing merged native work is preserved. Its hold annotation was recorded in the preceding Plan phase; this pass does not unmerge it, develop it, build it or submit it. New bug-reporting/performance and other follow-up features remain deferred. Task-management mutations are not performed in this Build-mode pass.

## Rollback

1. Do not clear browser storage or replace encrypted snapshots to roll back code.
2. Preserve/export any unsynced planner and recovery copies, and allow a recovery-capable web client to finish sync first. An older web client cannot interpret the new browser cache wrapper.
3. Use the pre-remediation code checkpoint for code rollback only after device-only edits are protected. No database rollback or envelope conversion is needed.
4. Existing JSON backups and encrypted server versions remain readable. Restore through the confirmed web recovery UI, which creates a new version rather than modifying old history.
5. Retain the encryption passphrase. Neither the app nor the server can recover a lost passphrase.

## Release checkpoint

**Candidate remediation checks: PASS. Production release: NOT READY.**

Remaining gates:

1. **Confirmed production mismatch/boundary:** production serves the old bundle and still publicly serves the held native route. The candidate has not been published. Approve and apply web-only target separation before any subsequent release.
2. **Unverified external behavior:** real Google consent/callback, chosen-calendar permissions and event writes require an authorized test connection. Production Clerk account isolation/save/reload and post-release smoke have not been run against the candidate because it is not deployed.
3. **Security disposition:** six high dependency advisories and the static findings remain in the repository scan as triaged above. No new exploitable critical/high issue was verified in the candidate's web flow, but that is not a blanket security sign-off.

No destructive migration, encryption-architecture change, deployment or production configuration change was performed. Do not deploy automatically or continue to native work or new features.
