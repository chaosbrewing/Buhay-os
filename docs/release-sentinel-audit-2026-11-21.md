# Release Sentinel audit: HANAY web planner and API

## 1. Objective
- **Product:** HANAY (repo `Buhay-os`), web planner (`artifacts/life-planner`) and shared API (`artifacts/api-server`). Expo/native is on hold and out of scope.
- **Candidate:** commit `2246e2ed8246337b310da87b0d113e146923629b`, branch `main`, clean tree. Artifact hash: **UNKNOWN**.
- **Environment:** local repository, read-only static inspection. Release channel: UNKNOWN. Production is a public Autoscale deployment.
- **Assessed:** 2026-11-21. Platform controls applied: universal + webapp (66 controls).
- **Inspected (OBSERVED):** `.replit`, `package.json`, `app.ts`, grep of `api-server/src` for auth/CORS/rate-limit/helmet, secret-pattern scan of tracked files (no hits), `.github` (absent), `index.html` viewport, git state.
- **Read as REPORTED (not re-verified):** `artifacts/life-planner/docs/release-2.md`, `docs/web-launch-remediation.md`.
- **NOT INSPECTED:** deployed site, production Clerk/Google config, database, backups, `planner.ts`/`calendar.ts` logic, UI behaviour, accessibility. No tests, builds or audits were run.

## 2. Current state and verdict

**NO-GO.** Coverage: 0 of 66 controls verified. 2 FAIL (both P1), 64 UNVERIFIED. No waivers.

### Stop-ship list
| ID | Control | Finding |
| --- | --- | --- |
| A-004 | CORS and origin policy | `app.ts:36` `cors({ credentials: true, origin: true })` reflects any Origin with credentials. OBSERVED. |
| U-015 | Vulnerability review | Project docs report 6 high / 4 moderate advisories open, triaged but not formally cleared. REPORTED; not re-run. |

## 3. Missing / broken / unproven

| # | Class | Controls | Finding | Fix | Acceptance test | Blocks release |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | BROKEN | A-004 | Permissive CORS with credentials. Root-cause hypothesis: dev default left in. Exploitability depends on the Clerk cookie's SameSite setting (unverified). | Allowlist production origin(s) via env config. | `Origin: https://evil.example` returns no ACAO header; real origin works; authenticated call from allowed origin succeeds. | Yes (P1) |
| 2 | UNPROVEN | U-015, U-030 | Open high advisories (braces, brace-expansion, node-forge, source-map-js, uuid). Reachability argued in docs, not cleared. | Re-run audit on this commit; upgrade where a fix exists; record approved dispositions. | `pnpm audit --prod` shows no unaccepted high/critical; dispositions signed. | Yes (P1) |
| 3 | UNPROVEN | U-001 | No artifact hash. Docs: live bundle `index-BA0qWee0.js` differs from candidate build `index-DosU2Nid.js`. | Record build hash, map to commit. | Deployed bundle hash equals candidate build hash. | Yes (HOLD) |
| 4 | MISSING (per docs) | A-017, U-031 | Production still serves old bundle and the held native route (HTTP 200). Web-only separation proposed, not applied. | Owner-approved web-only deployment target. | Native route 404 in production; production Clerk keys confirmed (docs say preview used a development key). | Yes (HOLD) |
| 5 | UNPROVEN | A-006 | No rate limiting or security headers in `api-server/src`. Edge controls not inspected. | Add limits (planner save, calendar OAuth) and security headers, or evidence edge equivalents. | Burst test on test env returns 429; response headers present. | Yes (HOLD) |
| 6 | UNPROVEN | U-026, U-027, A-020 | No CI. Reported test counts (43 / 41 / 48) were against an earlier candidate. | Add CI; run typecheck and tests on this commit. | Green CI run ID on `2246e2e`. | Yes (HOLD) |
| 7 | UNPROVEN | U-003, U-004, A-001 | Journey and account isolation tested only in development with disposable accounts (REPORTED). Release 2 isolation simulated. | Two-account test against the deployed candidate. | Account B cannot read A's envelope or DOM; reload/unlock restores A's data. | Yes (HOLD) |
| 8 | UNPROVEN | U-023, U-025, A-018 | No DB restore drill; no migrations exist; rollback written but not rehearsed. | Restore drill and staging rollback rehearsal. | Restored `planner_state` decrypts for its owner; rollback client still loads data. | Yes (HOLD) |
| 9 | UNPROVEN | U-035 / Google | Live Google OAuth, calendar selection and event writes untested; OAuth static finding (medium) unconfirmed. | Authorized test connection. | Consent, callback, selected calendars, event write and retry all observed. | Yes (HOLD) |
| 10 | UNPROVEN | U-009, U-010, A-025 | Accessibility only partially tested (import dialog, three widths). No screen-reader or contrast pass. | WCAG pass with assistive tech. | Documented keyboard and screen-reader run on core journey. | Yes (HOLD) |
| 11 | MISSING | U-032 | No in-app feedback/reporting route; no named support owner. | Name owner and path. | Test report received. | Yes (HOLD) |
| 12 | MISSING | U-037, U-038 | No independent review or production authorization record. | Founder YES/NO decision. | Dated approval artifact. | Yes |

Also noted: Release 2, UGNAY, BAKAS, Journal and TUKLAS flags are all `false` in `.replit`. Keep them off for this release unless each gets its own gates. Several binary assets were not imported from Replit (`REPLIT-IMPORT.md`); `attached_assets/buhay-os-lockup-cropped.png` is now present.

## 4. Execution plan
1. **P1 first (parallel, independent):** #1 CORS allowlist; #2 audit and dispositions.
2. **Then:** #3 hash, #6 CI (CI produces the run ID that #3 and #7 depend on).
3. **Deployment (needs owner approval):** #4 web-only target, #5 rate limits/headers. Staging first.
4. **On the deployed candidate:** #7 isolation, #9 Google, #10 accessibility, #8 restore/rollback drills, #11 support path.
5. **Close:** re-run the checker on the new candidate hash, then #12 founder decision.

Each item closes only after retest on the new candidate; a commit alone is not VERIFIED.

## 5. Verification
| Check | Result |
| --- | --- |
| Tracked-file secret pattern scan (Stripe/Google keys, private keys, DB URLs) | OBSERVED, no hits. Not a full secret audit. |
| Auth required on planner/calendar routes (`getAuth`) | OBSERVED in source only; not tested at runtime. UNVERIFIED. |
| Viewport allows zoom | OBSERVED PASS (no zoom restriction in `index.html`). |
| CORS policy | OBSERVED FAIL. |
| Tests, typecheck, build, audit | NOT RUN. |
| Browser/device matrix, journeys, performance | NOT INSPECTED (UNVERIFIED). |

Gate checker: `python scripts/evaluate_release.py` returned exit 3 (NO-GO). Input and output are in the session scratchpad (`assessment.json`, `gate.json`). The checker validates shape only.

## 6. Risks and blockers
- **Customer harm:** an overly permissive CORS policy on an API that holds users' encrypted data. Plaintext stays client-side, but ciphertext and account metadata are exposed to the risk.
- **Live/source mismatch:** users currently run an older bundle lacking the reminder-privacy fix.
- **Held native route:** publicly served, carries 2 unconfirmed static findings.
- **Recovery:** a lost passphrase is unrecoverable by design; device-only recovery copies vanish if site storage is cleared.
- **Compliance:** no legal/privacy review recorded. For professional review, not certified here.
- **Audit visibility gap:** deployed site and production config were not accessible; that is not itself a product defect.

## 7. Decisions required (Yes/No)
1. Approve web-only production target separation? 
2. Approve a production release once all gates pass? (Not self-approvable by the assessor.)
3. Waivers: none requested; none possible for the P1 items.

## 8. Next action
Replace `origin: true` with an allowlist and run `pnpm audit --prod` on this commit. Then record the artifact hash.
