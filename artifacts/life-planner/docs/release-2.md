# BUHAY.OS Release 2 — Connect the Parts of Life

## Product gate

- **Chaos organized:** Goals, projects, tasks, notes, habits, and commitments are currently experienced in separate views. People need a reliable way to see how those pieces relate without re-entering or exposing private planner data.
- **Meaning created:** A person can connect intentions to daily actions, see verified progress, review their time, and find related records from one private workspace.
- **Who it serves:** Individuals balancing personal responsibilities, work, learning, projects, and everyday routines.
- **Why it matters:** It should reduce the effort of keeping a life organized and make progress easier to understand, without turning private planning into a scorecard.

The gate is consistent with BUHAY.OS's existing “Capture → Organize → Plan → Do → Review” journey. It does not authorize expanding server visibility into planner content.

## Audited baseline and constraints

The existing app stores planner content as an end-to-end encrypted snapshot. The API owns one snapshot and version history per authenticated account, and validates the ciphertext envelope without parsing planner records. The web and Expo clients decrypt locally, use the shared planner contract for normalization and conflict handling, and encrypt again before cloud save. Google Calendar details are fetched from the existing authorized API and remain outside the encrypted planner snapshot.

Release 2 records must therefore remain client-owned snapshot data. Use optional, additive collections and stable IDs; preserve unknown fields; do not add plaintext search endpoints, server-side indexes, or new database tables for private planner records. New search runs only over data the signed-in user has unlocked locally. Calendar entries in the Timeline are transient authorized results, not copied into planner snapshots.

No production-data change, database migration, encryption-contract change, deployment, or store submission is part of this work.

## Feature blueprints

### Goals and milestones

- **Problem:** Larger intentions are hard to connect to the projects and small tasks that move them forward.
- **Outcome:** A person can see which goals have concrete next steps and how much linked work is actually complete.
- **Minimum useful version:** Create, edit, and archive goals; add dated milestones; link goals and milestones to projects/tasks; calculate progress from linked task completion and project progress, not a manually entered percentage.
- **Data:** Optional `goals` and `milestones` collections with stable IDs, titles, descriptions, target dates, and status. Milestones derive completion from linked work.
- **User action:** Create a goal, define a milestone, then link existing work or create work in the existing task/project flow.
- **Success:** Progress changes when linked task/project completion changes, is consistent in both clients, and does not count a parent task and its subtasks twice.
- **Privacy:** Goal and milestone content is encrypted with the planner snapshot. No new server-readable fields.

### Life Areas

- **Problem:** Users cannot group related planner records around their own idea of a life area.
- **Outcome:** Each person can organize connections using labels that make sense to them.
- **Minimum useful version:** Create, rename, and archive user-defined areas; associate them optionally with goals, projects, tasks, notes, and habits.
- **Data:** Optional `lifeAreas` collection plus stable links to supported records.
- **User action:** Name an area and attach or remove records.
- **Success:** Areas remain optional, editable, and usable across clients; no item is moved or deleted by creating an association.
- **Privacy:** Do not seed or require sensitive categories. User-defined names and associations stay inside the encrypted snapshot.

### Smart Linking

- **Problem:** Related records are difficult to navigate between, and direct links can become stale after edits or deletion.
- **Outcome:** A person can move from a record to related records and see its backlinks.
- **Minimum useful version:** Store stable references between supported record types, show links in both directions, unlink without deleting either record, and identify unresolved references with relink/remove recovery.
- **Data:** Optional `links` collection containing typed source/target references and stable link IDs.
- **User action:** Add, follow, repair, or remove a relationship.
- **Success:** Links survive edits and conflict merges; unlinking is non-destructive; broken links never navigate to a different record by ID collision.
- **Privacy:** Relationships are encrypted with their records and remain scoped to the authenticated user's snapshot.

### Universal Timeline

- **Problem:** Dated planner activity is spread across modules.
- **Outcome:** A person can review authorized events and dated planner records chronologically.
- **Minimum useful version:** Combine dated tasks, selected Google Calendar events, habit completions, milestone target dates, and notes with filters. Do not synthesize dates for legacy task completions that have no completion timestamp.
- **Data:** Existing task due dates, habit completion date keys, note dates, milestone target dates, and transient authorized calendar event responses.
- **User action:** Choose a range/filter and open a source record.
- **Success:** Entries sort consistently; all-day values stay date-only; timed Google events use their actual instants and display the chosen local timezone; no unauthorized calendars or invented activity appear.
- **Privacy:** Calendar results remain transient; planner data is decrypted and filtered locally. Show a clear offline state when calendar data cannot be refreshed.

### Weekly and Monthly Life Reviews

- **Problem:** People lack a calm place to summarize the period and keep their own reflections.
- **Outcome:** A person can see useful completion context and write a private reflection without a performance score.
- **Minimum useful version:** Weekly/monthly summaries of available completed and unfinished tasks and habit completions, a few optional reflection prompts, and editable saved review text.
- **Data:** Derived period summaries plus optional `reviews` entries containing period bounds, reflection text, and timestamps.
- **User action:** Open a period, review the summary, and save or edit a reflection.
- **Success:** Summary counts are explainable from saved records; incomplete periods are described neutrally; reflections survive sync, backup, and restore.
- **Privacy:** Review text stays in the encrypted snapshot and is excluded from logs and server-side indexing.

### Unified Search

- **Problem:** Search only covers a subset of typed planner records.
- **Outcome:** A person can find supported unlocked records and navigate to them directly.
- **Minimum useful version:** Search supported task, note, project, inbox, habit, routine, goal, milestone, area, and review content locally; provide module filters, useful title-first ranking, and direct navigation.
- **Data:** Existing decrypted planner records; no new server data.
- **User action:** Search, refine by module, and open a result.
- **Success:** Results are scoped to the current account, filters and ranking are predictable, and a result opens the exact record or reports that it is no longer available.
- **Privacy:** Never upload decrypted content for search. Explain that locked data cannot be searched and that offline search covers the unlocked local snapshot; calendar search is not implied.

## Compatibility and verification

- Keep `goals`, `milestones`, `lifeAreas`, `links`, and `reviews` optional and absent until used. A missing schema version is treated as the existing snapshot format; no destructive rewrite is required.
- Preserve JSON backup round trips, history restore, encrypted web/mobile sync, and unknown fields.
- Add shared-contract tests for validation, one-level links, progress derivation, period boundaries, timezone/date-only behavior, backward compatibility, three-way merge, offline merge, unlink tombstones, and broken-link recovery.
- Add client coverage for account-scoped navigation, local-only search, calendar authorization/loading/error states, keyboard and screen-reader use, responsive layouts, and dark/light themes.
- Keep each Release 2 area independently disableable with a client feature flag. Flags do not change or bypass account authorization.
- The web planner supports separate `VITE_RELEASE_TWO_*` flags for `GOALS`, `LIFE_AREAS`, `LINKS`, `TIMELINE`, `REVIEWS`, and `SEARCH`. Each flag requires an explicit `true`; unset or false values disable the section. A disabled flag hides its navigation entry and shows a direct-route disabled state without changing saved data.
- Do not mark Release 2 release-ready until the existing app journeys, new regressions, migration/backup, encryption, offline conflict, calendar, accessibility, and security checks pass.

## 2026-10-15 web release closeout

### Verdict: Not ready

This is a verification closeout only. It does not authorize publishing or native work. All six Release 2 feature flags are set to `false` in the shared environment and fail closed when unset because real-account isolation has not been proven. Their navigation is hidden; direct routes display “This Release 2 area is not enabled” and state that planner data remains unchanged. The release owner can re-enable a flag only after its required gates pass.

### Verification evidence

| Check | Result |
| --- | --- |
| `pnpm run typecheck:libs` | Passed |
| `pnpm --filter @workspace/life-planner run typecheck` | Passed after refreshing workspace library declarations |
| `pnpm --filter @workspace/life-planner run test` | Passed, 29 tests |
| `pnpm --filter @workspace/planner-contract test` | Passed, 41 tests, including legacy/unknown-field preservation, offline merge, recurrence, and habit tombstones |
| `pnpm exec tsc -b artifacts/api-server/tsconfig.json && pnpm --filter @workspace/api-server typecheck && pnpm --filter @workspace/api-server test` | Passed, 48 API tests |
| `pnpm --filter @workspace/life-planner run test:e2e:calendar` | Passed, 2 calendar draft recovery tests; browser uses a mock API and simulated OAuth |
| `pnpm --filter @workspace/life-planner run test:e2e:recurrence` | Passed, 4 browser tests, including monthly 29th/30th/31st behavior and reminder preservation |
| `pnpm --filter @workspace/life-planner run test:e2e:release-two` | Passed, 5 harness tests, including disabled-route behavior, JSON backup, version restore, and transient Timeline events. Account switching is simulated, not real Clerk authentication. |
| `pnpm --filter @workspace/life-planner run test:e2e:habits` | Blocked: approved Clerk test-account variables are not configured. No credentials or mock authentication were used. |
| `PORT=21792 BASE_PATH=/ pnpm --filter @workspace/life-planner run build` | Passed with Release 2 disabled by default. Vite reports sourcemap location warnings and a 796 kB JavaScript chunk-size warning. |

### Unmet launch gates

- **Task #80 real-account isolation:** not run. There is no approved setup for two disposable Clerk accounts. The mock harness is not evidence of real Clerk identity isolation or real API ciphertext save/reload.
- **Offline and deletion durability:** planner-contract unit coverage passes, but browser-offline edits across two real web clients and a deleted habit surviving encrypted API sync/reload were not verified.
- **Timeline:** request failure/retry, reauthorization-required, disconnected, and offline UI states were not verified end-to-end. Timeline is disabled.
- **Google Calendar live behavior:** browser coverage uses mocked events and OAuth redirects. Live provider authorization, selected-calendar results, task-event linking, and live retry/duplicate safety are not certified for this release.
- **UX/accessibility:** the Release 2 UI has static checks for names, keyboard handling, and local search. A complete signed-in pass at 360×800, 768×1024, and 1440×900, including keyboard flow, contrast, reduced motion, dialogs, and browser error capture, remains unverified.
- **Clerk environment:** the public preview loads with a Clerk development key. Confirm the intended production Clerk configuration separately before any publishing decision.
- **Feedback/reporting:** no user-facing reporting route is configured in the web app. The release owner must supply the intended route.

### Privacy and security scans

- **Dependency audit:** 1 critical, 6 high, and 4 moderate findings across the workspace. The critical `proxy-addr` finding affects the API server; high findings include `braces` in the API proxy dependency and packages in the held Expo/mobile and video toolchains. `source-map-js` is also in the web build toolchain. No broad dependency update was made because that would cross the native dependency hold; all critical/high findings must be resolved or formally cleared before readiness.
- **SAST:** 1 high finding is in the held mobile server code; 1 medium finding points to the Google OAuth redirect construction in `artifacts/api-server/src/routes/calendar.ts`. The redirect destination is currently the fixed Google authorization URL, not user-controlled. The mobile finding was not changed.
- **Privacy/dataflow scan:** no findings.
- **API contract tests:** pass and confirm planner read/save endpoints preserve only the encrypted payload envelope; no decrypted planner content or passphrase is sent to the API by the tested flows.

### Setup, permissions, and support

- Run the workspace library typecheck before the web typecheck so generated declaration output is current.
- Use the existing Life Planner artifact workflow for development and production builds; its manifest supplies `PORT` and `BASE_PATH`.
- Google Calendar access is opt-in and requests `calendar.events` plus `calendar.calendarlist.readonly`; users can choose which calendars to display. Calendar data remains transient and outside the planner snapshot.
- JSON backup/export is unencrypted and user-controlled. The separate encryption passphrase is not recoverable.
- No in-app feedback/reporting route exists in this build. Do not describe the app as ready until the owner supplies and documents the intended reporting path.
