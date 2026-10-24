# Buhay.OS Mobile Sign-In and Encryption QA

Device alarms have a separate implementation and physical-device gate checklist in
[ALARMS.md](./ALARMS.md). No alarm delivery/device checks have been completed here.

**Run date:** 2026-10-13
**Overall status:** Physical-device verification blocked; workspace checks recorded below.

## Device results

| Platform | Device model | OS version | Runtime | Sign-in and planner-unlock result |
| --- | --- | --- | --- | --- |
| iOS | Not available | Not available | Not available; no device attached | **Not run** |
| Android | Not available | Not available | Not available; no device attached | **Not run** |

The workspace has no registered Expo devices (`artifacts/buhay-os-mobile/.expo/devices.json` is empty). No physical-device session was available to record model, OS version, or whether the app was running in Expo Go or a development build. No account credentials, planner passphrase, or planner content were used or recorded.

## Required device steps (not run)

Repeat these steps on both a physical iOS phone and a physical Android phone using the same isolated test account and test planner:

1. Launch the existing Buhay.OS mobile app and sign in through the supported email/password flow. If Clerk requests an email verification code, request and enter it.
2. Confirm the app opens the planner unlock screen after account authentication.
3. Enter the separate planner encryption passphrase used to create the isolated test planner. Confirm the same non-sensitive test marker is visible on both phones.
4. Lock the planner and try an incorrect passphrase. Confirm the planner stays locked and no planner content is shown.
5. Record device model, OS version, Expo Go or development-build mode, steps, outcomes, and any setup limitations. Do not include credentials, passphrases, or planner contents.
6. Check Google sign-in only if the Clerk tenant has a registered native redirect for `buhay-os-mobile://`; otherwise record that it was not applicable.

## Workspace checks

- `pnpm --filter @workspace/buhay-os-mobile run test` — **Passed: 15 tests.** Includes cross-runtime WebCrypto/AES-GCM snapshot compatibility and a regression check that an incorrect passphrase cannot decrypt a snapshot.
- `pnpm --filter @workspace/buhay-os-mobile run typecheck` — **Passed.** Shared TypeScript declarations were refreshed before this run. The check does not provide device-authentication or native-runtime evidence.
- Physical Clerk sign-in, email verification delivery, opening one shared cloud snapshot on both platforms, incorrect-passphrase lock behavior in the native UI, and native Google redirect behavior — **Not run.**

## Setup limitations and interpretation

- No physical iOS or Android devices are attached or registered in this workspace.
- The device runs require an isolated Clerk test account and a matching non-production API environment. No such device session was available for this run; do not substitute a production account or production planner.
- The app is configured for the `buhay-os-mobile` scheme. Google sign-in uses an Expo AuthSession redirect and must only be tested after that native redirect is registered with the Clerk tenant.
- Automated crypto tests support compatibility of the snapshot format, but they do not certify native sign-in, native email verification, Expo Go redirects, or native unlock UI behavior.

This report records the available evidence and blockers; it is not a pass or device certification.

## Native task reminder QA

**Run date:** 2026-10-15
**Overall status:** Automated scheduling checks pass; physical-device delivery checks not run because no iOS or Android device is attached or registered.

| Platform | Device model / OS | Permission allow | Permission decline / Settings | Locked-screen delivery | App restart delivery | DST transition | Edit / off / complete / delete cancellation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iOS | Not available | Not run | Not run | Not run | Not run | Not run | Not run |
| Android | Not available | Not run | Not run | Not run | Not run | Not run | Not run |

### Steps to run on each physical platform

Use a non-production test account and planner with no sensitive content. Record the device model, OS version, app runtime (Expo Go or development build), and planner time zone. Do not record credentials, passphrases, or task titles.

1. **Allow:** Start with notification permission unset, create a task with a due date and time several minutes in the future, select a reminder, and choose **Allow notifications**. Confirm the OS prompt appears once, the app reports permission granted, and exactly one local alert arrives at the configured lead time.
2. **Decline:** Reset the app’s notification permission in OS settings, repeat setup, and decline the prompt. Confirm no alert is scheduled or delivered. If the OS blocks another prompt, use the app’s settings button and confirm it opens notification settings.
3. **Lock and restart:** Allow notifications again, create a future reminder, lock the screen and confirm delivery. Create another reminder, force-close and relaunch the app, leave the planner locked if possible, and confirm the OS still delivers the already scheduled alert.
4. **Daylight-saving change:** In a planner time zone that observes DST, create a daily recurring task at a fixed local wall-clock time spanning the next DST change. Confirm the reminder keeps the same local lead time before and after the clock change.
5. **Cancellation:** For separate future reminders, edit the due date/time or reminder lead time, turn the reminder off, complete the task, and delete the task. Confirm the old alert does not arrive in each case; for an edited task, confirm only the new alert arrives.
6. Repeat the full sequence on iOS and Android. On Android, confirm Buhay.OS task reminders remain enabled on the “Task reminders” notification channel.

### Workspace checks

- `pnpm --filter @workspace/buhay-os-mobile run test` — automated scheduler checks cover permission decline cleanup, unrelated notification preservation, reminder replacement/removal after edits/off/completion/deletion, Android channel setup, serialized updates, and a DST transition.
- `pnpm --filter @workspace/buhay-os-mobile run typecheck` — checks the Expo notification adapter and native reminder code types.
- Physical OS prompts, locked-screen delivery, force-close/relaunch delivery, and device-level DST behavior — **Not run.** The automated tests do not simulate iOS or Android notification services.

## Offline edit restart and reconnect verification

**Run date:** 2026-10-13
**Overall status:** Physical-device checks not run; no iOS or Android phone is attached or registered.

| Platform | Device model / OS | Offline edit | Close and reopen offline | Unlock encrypted cache | Reconnect and sync | Safe record |
| --- | --- | --- | --- | --- | --- | --- |
| iOS | Not available | Not run | Not run | Not run | Not run | No credentials or planner content used |
| Android | Not available | Not run | Not run | Not run | Not run | No credentials or planner content used |

The browser-based mobile test was extended to reload the Expo web app before reconnecting, confirm the unsynced edit restores from its encrypted local cache, then reconnect and exercise revision-conflict merging. This is not evidence of native AsyncStorage, native network transitions, or device restart behavior.

The authenticated sync E2E suite was not run in this workspace because no disposable test API, Clerk test instance, or dedicated test accounts were configured. The runner rejects production API origins and the README documents the test-only configuration and cleanup boundary. Do not replace the missing test setup with production credentials or production planner data.
