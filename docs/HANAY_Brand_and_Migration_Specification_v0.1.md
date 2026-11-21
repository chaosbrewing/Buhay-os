# HANAY Brand and Migration Specification v0.1

**Product:** BUHAY.OS is now **HANAY** (visual wordmark: **hanay.**)
**Workflow:** CHAOS ORIGINS v2.1
**Date:** 2026-11-21
**Status:** Decisions approved by the founder. Application-level rename merged into `main` (PR #2, merge commit `0a36c75`). The GitHub repository was renamed to `hanay` on 2026-11-21 at the founder's request. Deployment, external accounts and clearance checks are **not** done and **not** authorised.

---

## 1. Decisions

| ID | Decision | Founder | Implemented |
|---|---|---|---|
| HANAY-001 | Adopt HANAY as the name of BUHAY.OS | Approved | Yes (everything a person reads) |
| HANAY-002 | Use `hanay.` as the visual wordmark | Approved | Yes (new light and dark wordmark, favicon) |
| HANAY-003 | Preserve all features and internal modules | Approved | Yes (no feature or module changed) |
| HANAY-004 | Adopt ORIGIN Glass Daylight and Midnight | Approved | Yes (tokens, wordmark switching, contrast test) |
| HANAY-005 | Preserve technical identifiers until compatibility is verified | Approved | Yes (register in section 5, pinned by tests) |
| HANAY-006 | Read-only rename audit and migration specification | Approved | Yes (this document) |

BAKAS, TUKLAS, UGNAY stay as internal capability names. IKAW is not in this codebase yet.

## 2. Identity

| Element | Value |
|---|---|
| Name in text | HANAY |
| Visual wordmark | hanay. (the period is part of the artwork only, never of code or identifiers) |
| Tagline | Make room for life. |
| Secondary tagline | Everything in its place. Life in your hands. |
| Design system | ORIGIN Glass |
| Daylight | Pearl background, sage surfaces, forest-green primary (`146 50% 24%`), muted-gold accent |
| Midnight | Deep forest and obsidian, celadon primary (`146 48% 60%`), faint static star points, restrained edge highlights |
| Wordmark files | `attached_assets/hanay-wordmark-light.png`, `attached_assets/hanay-wordmark-dark.png` |
| Favicon | `artifacts/life-planner/public/favicon.svg`, `artifacts/buhay-os-daybook-film/public/favicon.svg` |

The mark is three leaf-shaped petals in a row (a *hanay*), in sage, green and forest. It is a first draft made for this migration; a designer should review it before any public release.

## 3. Inventory (Stage A, read-only)

Before the change: **55 tracked text files and 228 mentions** of "buhay" in any case.

| Kind | Examples | Count | Treatment |
|---|---|---|---|
| Visible product name (`Buhay.OS`, `BUHAY.OS`) | page titles, meta tags, sidebar, auth and unlock screens, settings copy, calendar and memory copy, notifications, mobile screens, alarm labels, film, READMEs | 44 files | **Renamed to HANAY** |
| Logo | `buhay-os-lockup-cropped.png` used in four places | 1 asset | **Replaced** by the light and dark wordmark (old file left in place, now unreferenced) |
| Download file names | `buhay-os-backup-DATE`, `buhay-os-offline-recovery-DATE`, `buhay-os-notes-DATE` | 3 | **Renamed** to `hanay-...` (extension kept) |
| Persisted or protocol identifiers | see section 5 | about 20 | **Preserved** |
| Package and deployment names | `@workspace/buhay-os-mobile`, `@workspace/buhay-os-daybook-film`, `/buhay-os-mobile/` paths, artifact ids | 6 | **Preserved** (Stage D) |
| Historical document | `REPLIT-IMPORT.md` | 1 | **Left as written** (it records the import) |

No database table, API route, environment variable name or authentication setting contains the old name. The server never sees the product name except in one Google Calendar property (section 5).

After the change, no file a person reads contains `Buhay.OS` or `BUHAY.OS`. `src/rebrand-compat.test.mjs` fails if one reappears.

## 4. What changed

- **Web app:** titles and meta tags, landing tagline, wordmark with Daylight and Midnight variants, all copy, notification title ("HANAY reminder"), favicon.
- **Mobile companion:** display name, sign-in and settings copy, alarm and reminder labels ("HANAY alarm", "HANAY reminder"). Slug and URL scheme are unchanged.
- **Daybook film:** titles, meta tags, on-screen text, favicon.
- **Docs:** README, `replit.md`, mobile and web docs, `.agents/memory` notes.
- **Theme:** ORIGIN Glass tokens in `artifacts/life-planner/src/index.css`.
- **Tests:** new `rebrand-compat.test.mjs` and `theme-contrast.test.mjs`; one golden backup fixture; existing copy assertions updated.

## 5. Identifier register: preserved on purpose

| Identifier | Where | Why it must not change yet |
|---|---|---|
| `buhay-os-encrypted-backup` | `backup-crypto.ts` (`BACKUP_FORMAT`) | **Critical.** It is bound into the AES-GCM header, so changing it makes every existing backup undecryptable. A new name needs backup format version 2 with version 1 still readable. |
| `.buhaybackup` | export file name, import file filter | Existing files and any file association. A new extension must be added alongside, not instead. |
| `daybook.local.v1`, `daybook.encrypted-cache.v1`, `daybook.account-cache.v2:*` | web storage | Saved planners and offline caches would be orphaned. |
| `buhay-os-calendar-event-draft` | web storage | Unsent event drafts. |
| `buhay.nav.collapsed` | web storage | Only a preference; low risk, kept for consistency. |
| `buhayOsRequestKey` (Google Calendar private property), `buhay-event-*`, `buhay-task-*` | API server, web | **High.** Used to recognise events already created in people's Google calendars when a request is retried. |
| `buhay.device-alarms.v1`, `buhay.alarm.*`, `buhay.os.encrypted-cache.v1:*`, `buhayOsTaskReminder` | mobile | Scheduled alarms, reminders and the encrypted cache on devices. |
| `buhay-os-mobile` slug and URL scheme | `app.json` | OAuth return address; must match the Clerk and store configuration. |
| `@workspace/buhay-os-mobile`, `@workspace/buhay-os-daybook-film`, `/buhay-os-*/` paths, `artifact.toml` ids | workspace and deployment | Deployment routing and build commands. |
| `buhay-` web notification tag | `web-reminders.ts` | Replacing or clearing already scheduled notifications. |
| Repository name | GitHub | **Renamed** from `Buhay-os` to `chaosbrewing/hanay` on 2026-11-21 (founder's request). GitHub redirects the old URL. The separate backup repository `Buhay-os-backup` and the local folder name are unchanged. |

`src/rebrand-compat.test.mjs` pins every row that lives in code, including a backup file produced before the rename that must still decrypt.

## 6. Actions outside this codebase (need the founder)

1. **Clerk:** change the application display name in the Clerk dashboard (sign-in screens and emails).
2. **Google Cloud:** the OAuth consent screen shows the app name. Changing it may trigger re-verification; do it deliberately.
3. **Replit and any hosting:** project and deployment titles, preview paths, custom domains.
4. **Stores:** if the mobile app is ever submitted, the listing name and bundle identifiers.
5. **Repository:** done. Renamed to `hanay` on 2026-11-21, before items 1 to 4 were settled. Check anything that references the old URL (Replit import, deploy hooks, CI), and rename `Buhay-os-backup` if it should match.
6. **Clearance:** no domain, trademark, business-name or competing-product check has been run. *Hanay* is a common Filipino word meaning a row or arrangement, so a conflict with other products is plausible. **Do this before any public release.**
7. **Artwork:** a designer should review and finish the wordmark and mark.
8. **Mobile wordmark:** `artifacts/buhay-os-mobile/assets/images/wordmark.png` is referenced but is not in the repository, so mobile builds need it supplied (in HANAY artwork).

## 7. Acceptance criteria and results

| Criterion | Result |
|---|---|
| Existing accounts remain accessible | Not changed: no auth or storage identifier changed. Not exercised against a real account (needs a Clerk key). |
| Planner data intact | No data code changed. Contract tests 130/130. |
| Encrypted backups import and export | A pre-rename golden backup decrypts; backup browser suite 8/8. |
| Deleted memories cannot reappear | Unchanged; covered by restore tests and the Memory suite 15/15. |
| Offline and cloud sync compatible | No sync or storage identifier changed. Not exercised against a server. |
| Journal data contracts compatible | Journal suite 8/8; contract tests unchanged. |
| Integrations keep working | Google Calendar request keys unchanged and pinned by test. |
| Works across screen sizes | Browser suites pass; the wordmark scales within the existing logo box. Phone layouts of the new screens were checked earlier in the preview. |
| Daylight and Midnight meet accessibility requirements | `theme-contrast.test.mjs`: every text pair at least 4.5:1 in both themes, body text at least 7:1 on the faintest glass. This checks colour contrast only; no screen-reader or keyboard audit of the new artwork was done. |
| No legacy data silently migrated or deleted | True: nothing is migrated. |

**Test totals on this branch:** TypeScript clean (web, libraries, film). Contract unit tests 130, web unit tests 132, mobile unit tests 41, all passing. Browser suites: Journal 8, TUKLAS 8, Planner 5, Memory 15, Backup 8, Calendar 5, Release Two 5, Recurrence 4, all passing.

**Not run:** the API server tests (their script is POSIX-only on this machine and the route test needs bundling), the Habits browser suite (needs a Clerk key), real sign-in, native mobile builds.

## 8. Rollback

The application rename is merged into `main` as one merge commit (`0a36c75`), and the `hanay-rebrand` branch has been deleted. Reverting that merge restores the BUHAY.OS name in the app. The rename changes no stored data, so reverting after release is safe. The repository rename is reversed separately in GitHub settings.

## 9. Deliberately not done

- Package, route, storage-key, backup-format or deployment renames (the repository itself is renamed).
- The proposed navigation structure (Tasks, Habits, Routines, Memories, Insights as separate entries). It was proposed, not approved, so the current navigation is unchanged.
- New artwork beyond the wordmark, mark and favicon (app icon sets, store assets, social cards).
