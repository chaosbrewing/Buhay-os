# Buhay.OS Mobile

An Expo companion for iOS and Android. It uses the existing Buhay.OS Clerk account and the existing authenticated API; it does not introduce a second backend or planner database.

## Device alarms

See [ALARMS.md](./ALARMS.md) for the new one-time task/habit/routine/event alarm integration,
privacy boundaries, custom native build instructions and outstanding physical-device QA.
True alarms require iOS 26+ or Android and do not work in Expo Go. This integration is
**not native-release-ready** until compilation and physical delivery checks pass.

## Run in this workspace

Use the configured **Buhay.OS Mobile** Expo workflow, or run `pnpm --filter @workspace/buhay-os-mobile run dev` in a configured Replit Expo environment. For a local workspace, provide the same Clerk publishable key and API domain already used by the web project as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_DOMAIN`; never put a Clerk secret or Google OAuth secret in the app.

Sign in with the existing account, then enter the separate planner encryption passphrase used by the web planner. It is not your account password and is never stored. The credential session uses Expo SecureStore. The offline copy contains encrypted snapshots only.

## Available in this companion

- Account sign-in and verification through the existing Clerk tenant.
- Encrypted snapshot unlock and sync using the existing PBKDF2-SHA256 (310,000 iterations), AES-GCM-256 envelope.
- Today, Week, notes, local search, task completion/editing, quick capture, recurring tasks, private local task reminders, and light/dark themes.
- Projects with one-level subtasks and task priorities; the Inbox with conversion to tasks or notes; habits (yes/no and measurable, skip, pause, weekly history, streaks); routines with step-by-step runs (Space tab, `app/(app)/(tabs)/organize.tsx`).
- Creating a Google Calendar event from a task in Capture (`app/(app)/capture.tsx`), using the existing server connection.
- Release 2 records: goals, milestones, life areas, private reflections and links between records (`app/(app)/life.tsx`).
- Read-only Google Calendar event viewing through the existing server connection. Connect/reconnect Google Calendar in the web planner; no Google OAuth secret is sent to the app.
- Offline access to a previously unlocked encrypted snapshot, with revision checks and copy-preserving conflict handling.

Calendar events are not part of the encrypted planner snapshot. Account-level private content remains encrypted before it reaches the server. Search only indexes the locally decrypted planner while it is unlocked.

These capabilities use the shared planner contract (`@workspace/planner-contract`) and the same encrypted snapshot as the web planner, and their logic is covered by the unit tests below. None of them has been verified on a physical device, and the companion is on hold except for device alarms (web-first release scope). Version history, JSON backup import/export, Markdown export and the template editor remain in the web planner.

## Expo Go and development builds

The app uses Expo-managed modules and is intended to support Expo Go for core navigation, authentication, planner sync, offline cache, calendar viewing, and local task reminders. OAuth redirect setup depends on the configured Clerk tenant and may require a development build / registered native redirect URI for a device deployment. Task reminder permissions and native delivery depend on the operating system and still require physical-device QA. Tablet layouts are responsive, but no physical iOS/Android device has been certified by this workspace preview.

## Validation

Run `pnpm --filter @workspace/buhay-os-mobile run typecheck` and `pnpm --filter @workspace/buhay-os-mobile run test`. The crypto tests cross-check the mobile implementation against WebCrypto using the existing snapshot format. Device-level sign-in, biometric behavior, offline transitions, and Expo Go OAuth still require real-device QA.

The latest sign-in, encryption, and native task reminder QA status, including blocked physical-device steps and workspace checks, is recorded in [DEVICE-QA.md](./DEVICE-QA.md).

## Authenticated cloud-sync end-to-end test

The automated browser runner drives the actual Expo app in its web runtime, signs into a dedicated test Clerk instance, and talks to the existing authenticated planner API. It creates a unique task, confirms the stored API response is ciphertext, simulates an offline edit while a concurrent API write advances the revision, closes and reopens the app while still offline, unlocks from the encrypted local cache, and verifies both conflicting copies survive after reconnect. It also checks a second test account cannot see the first account’s planner and inspects saved version payloads for plaintext.

This is a browser-run integration test, not iOS/Android device certification. It exercises the app’s React Native Web runtime and browser offline handling; it does not verify native SecureStore behavior, native network transitions, background sync, OAuth redirects, or platform-specific authentication. The suite requires Chromium and an Expo web-compatible install.

### Prerequisites and configuration

1. Use a disposable, isolated test API environment whose database is not shared with production. Configure its API server with the matching Clerk **test-instance** `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. The test runner itself only needs the publishable test key; never put a Clerk secret in this file.
2. In that Clerk test instance, create two dedicated accounts with password sign-in enabled and no MFA, email-code/device-trust, or CAPTCHA challenges. Do not use a production account. The first account’s planner may contain unrelated test data; the test removes only tasks whose title includes its unique run marker. The second account must have no planner snapshot.
3. Copy `.env.e2e.example` to `.env.e2e` in this package and fill in the test-only values. Keep the separate planner passphrase distinct from both account passwords. The API origin is restricted to localhost, `.test`, `.localhost`, or HTTPS `.replit.dev` hosts; production hosts are rejected.
4. Treat the API host, database, and both test accounts as disposable test resources. The current snapshot cleanup removes only uniquely marked tasks; encrypted version history can retain those test revisions until the isolated database is destroyed. Do not point this suite at production or a shared user database.
5. Install the browser once with `pnpm --filter @workspace/buhay-os-mobile exec playwright install chromium`.

Required values are `E2E_API_BASE_URL`, `E2E_CLERK_PUBLISHABLE_KEY` (`pk_test_…`), `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_SECOND_USER_EMAIL`, `E2E_SECOND_USER_PASSWORD`, and `E2E_PLANNER_PASSPHRASE` (at least 10 characters). An optional `E2E_EXPO_PORT` selects the local Expo web port (default `8099`).

Run the suite with:

```sh
pnpm --filter @workspace/buhay-os-mobile run test:e2e
```

The runner stops before launch when test credentials are missing or the API origin is not on the allowlist. It does not provision accounts, configure a database, or call production services. On success, it removes its uniquely named tasks through the authenticated API by writing a newly encrypted snapshot, preserving unrelated planner data; version history may retain older ciphertext revisions. Keep the isolated test database disposable so leftover records from an interrupted run can be discarded safely.
