# HANAY release hardening record, 2026-11-21

Follows `release-sentinel-audit-2026-11-21.md` (verdict at the time: NO-GO). This records what was fixed, how it was proved, and what is still open. It is evidence, not release authorisation; the founder's approval (audit item 12) is separate.

**Live:** web app https://hanay.today (Cloudflare Worker `hanay-web`), API https://hanay-api.vercel.app (Vercel project `hanay-api`), database Neon project `late-mud-13082559`, branch `production`.

## Changes and evidence

| Audit item | Change | Evidence |
|---|---|---|
| 1 CORS (A-004) | Exact-origin allow-list from `CORS_ALLOWED_ORIGINS` (`corsPolicy.ts`) | Live: `Origin: https://hanay.today` is echoed, `Origin: https://evil.example` gets no header. Unit tests. |
| 2 Dependencies (U-015, U-030) | `node-forge` and `decode-uri-component` pinned to patched releases in `pnpm-workspace.yaml` | `pnpm audit --prod`: 26 findings (10 high) before, 3 after. See dispositions below. |
| 5 Limits and headers (A-006) | Security headers and per-caller rate limits in the API (`security.ts`), an edge limit in the Worker, security headers on the static site (`public/_headers`) | 6 unit tests. Live: headers present on web and API; a parallel burst of 400 requests to `/api/planner` returned 161 x `429`, and the site recovered within a minute. |
| 6 CI (U-026, U-027) | `.github/workflows/ci.yml`: typecheck, unit tests, production builds, audit report, browser suites | See "CI" below. |
| 7 Isolation (U-003, U-004, A-001) | `scripts/ops/isolation-test.mjs`: two throwaway Clerk users against a local API and a Neon development branch | 13 of 13 checks pass: no cross-reads, no cross-writes, a forged `userId` in the body is ignored, stale revisions return 409, all routes need a login. Test users and rows are deleted afterwards. **API level only; a browser-level DOM check was not done.** |
| 8 Restore drill (U-023, U-025, A-018) | `scripts/ops/restore-drill.mjs`: branch, write an encrypted row, delete it, restore the branch to a timestamp, verify | PASS. The restored row decrypts to the original with the right passphrase, the ciphertext is byte-identical, a wrong passphrase is refused. The drill branches are removed. **Production was not restored; a full rollback rehearsal of the deployed client is still open.** |
| 10 Accessibility (U-009, U-010, A-025) | `tests/e2e/a11y.spec.mjs` (axe-core, WCAG 2 A/AA) on journal, planner, finances and memories in Daylight and Midnight; the landing page was scanned by hand in both themes | 8 of 8 pass, and the landing page is clean. A contrast failure seen on the Midnight landing button was a paused transition in a background tab, not a real defect. **No screen-reader or manual keyboard pass.** |
| Tests | Full run on the current code | Contract 130, web unit 132, mobile unit 41, API 62 pass. Browser suites: Journal 8, TUKLAS 8, Planner 5, Memory 15, Backup 8, Calendar 5, Release Two 5, Recurrence 4, Accessibility 8 pass. Typecheck clean across the workspace. |
| Canonical host | `www.hanay.today` redirects (301) to `hanay.today`, because Clerk is configured for the apex only | Live check. |

## Remaining advisories (production dependencies)

| Package | Severity | Where | Disposition |
|---|---|---|---|
| `zod` 3.25.76 | high | Used by the API and the web app; advisory GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections) | **Open, mitigated.** The fix exists only in zod 4.x, a major migration (`@hookform/resolvers` 3.x also targets zod 3). Mitigation: request bodies are bounded by Express's default 100 kB JSON limit and the per-caller rate limits. Recommend migrating to zod 4 as planned work. |
| `glob`, `minimatch` | moderate | Expo CLI build tooling in the mobile app only | **Accepted.** Not part of the web or API deploy or bundle. A major-version override could break the Expo build; revisit when mobile resumes. |

## Rate limit design

- API: 300 requests a minute per caller overall, 60 a minute for planner saves, 60 for calendar writes, 10 for starting Google sign-in. Counters are in memory, so on serverless hosting each instance counts separately.
- Worker: 120 requests a minute per visitor address to `/api/*`, using Cloudflare's rate limit binding; `/api/healthz` is exempt.
- The Worker passes the visitor's address as `x-hanay-client-ip`; the API accepts only a plain address from it.

## Re-running the checks

```
node scripts/ops/isolation-test.mjs     # needs the Neon CLI signed in and the development env file
node scripts/ops/restore-drill.mjs      # creates and deletes a temporary Neon branch
pnpm audit --prod
```

## CI

The workflow is in `.github/workflows/ci.yml`. Run 44892101881 on commit `6aa1260` passed both jobs: typecheck, unit tests and production builds, then the browser suites (including accessibility). The dependency audit step is report-only because the zod 3 advisory stays open.

## Still open

- Founder decisions and approvals (audit items 4, 11, 12): production target sign-off, a named support contact and path, the dated release approval.
- Legal and privacy review; name clearance for "Hanay".
- Live Google Calendar: credentials not provided, so it is untested and should stay off.
- Feature flags (Journal, TUKLAS, Memory, Release Two) are off in the deployed build.
- Screen-reader and manual keyboard accessibility pass.
- Browser-level two-account test on the live site; first real sign-in on hanay.today.
- Rollback rehearsal on a staging deployment.
- Content Security Policy for the web app (the API has a strict one); needs a careful allow-list for Clerk.
- Uptime and error monitoring; two-factor on Vercel, Cloudflare, GitHub, Clerk; rotating the live secrets.
