# Device alarms — implementation and release checkpoint

## Purpose and scope

**Problem:** a planner notification can be missed when the app is closed or the phone is locked.
**Meaning:** let a person choose a concrete time to act on an existing planner item.
**Users:** existing BUHAY.OS account holders using the companion.
**Value:** a private, system-managed alarm rather than a timer that depends on an open web page.

The user authorized native work for alarms only and selected **true alarms on iOS 26+ only**,
with Android support. There is no notification fallback masquerading as an alarm on older iPhones.
The existing web app remains the main product; unrelated companion work remains on hold.

## Feature blueprint

| Feature | Minimal useful outcome / user action | Data and success condition | Privacy / failure handling |
| --- | --- | --- | --- |
| Set alarm | Settings → Device alarms → select task, habit or routine → enter local date/time → Set private alarm. Calendar events have a Set alarm action. | One fixed instant linked to an existing source; native scheduling must resolve successfully before showing registration. 24 records/device maximum. | Native system receives a random UUID, instant and generic label only. Unsupported builds and denied permissions fail explicitly. |
| Manage alarms | Review registration, cancel individual/all alarms; remove old records. | Keep a cancellation journal before asking the OS to schedule. A failed operation remains recoverable. | Do not discard recovery IDs after cancellation errors. Explicit recovery is offered if the local alarm journal is unreadable. |
| Account safety | Keep alarms on planner lock; cancel on sign-out or account switch. | Serialize scheduling/cleanup; invalidate in-flight saves immediately on account change. | Account transition waits for cleanup; no previous account's source names appear in the new account. Permissions/retry/recovery controls are available if cleanup fails. |

## What was changed

- Added a focused Alarms screen using existing Orbit assets, DM Sans typography, theme colors,
  accessible field/button labels and keyboard-aware scrolling. No redesign of existing screens.
- Integrated `react-native-alarm-scheduler` pinned to 1.0.1, using AlarmKit on iOS and
  AlarmManager plus a foreground ringing service on Android.
- Added the Expo-SDK-compatible development client needed for a custom native development build.
- Added a checked-in pnpm dependency patch: use the requested **fixed calendar instant** on iOS,
  reject past explicit instants on both platforms, and surface primary iOS cancellation errors
  rather than silently discarding its native recovery metadata.
- Native Android behavior preserves user volume controls, includes Stop, limits ringing to five
  minutes, and does not take over the screen. `USE_EXACT_ALARM` and `USE_FULL_SCREEN_INTENT`
  are blocked; scheduling uses the separately user-authorized `SCHEDULE_EXACT_ALARM`.
- Separate, device-only metadata lives in SecureStore under OS keychain/keystore protection.
  Entries are small and split per alarm, with a bounded ID index. They contain source IDs,
  optional occurrence date/calendar ID, alarm UUID and scheduled instant, **not source titles,
  notes, passphrases, encryption keys, tokens or Google credentials**.
- Existing ordinary task notifications are separate and retain their existing controls.
- Unlocked source reconciliation cancels alarms for deleted/completed tasks and
  deleted/completed/skipped/paused habits, and for deleted routines.

## Deliberate limits

- **One-time alarms only.** A recurring task/habit/routine does not implicitly create repeating alarms.
- Alarms are device-local, not cloud-synced, and are not included in planner JSON backups/history.
  This avoids duplicate alarms across phones and introduces no shared schema/encryption migration.
- A source's time edit does not move an alarm automatically. Calendar alarms do not poll Google or
  follow event moves/deletions: review/cancel them explicitly.
- Routine deletion is checked; finishing a routine run does not automatically cancel its alarm.
- Changes on another device cannot affect already scheduled alarms until this device syncs and
  unlocks. The separate E2EE passphrase/key is not retained to enable background decryption.
- Native OS alarm storage necessarily knows the time, random ID and generic label outside the
  E2EE snapshot. Local SecureStore reference metadata is OS-encrypted, not passphrase-encrypted.
- No snooze UI is implemented in this first pass. Stop is the native control.
- Android force-stop, power-off, revoked permissions, device restrictions and muted alarm volume
  can prevent delivery. Reboot and time-change support supplied by the native module is unverified
  on devices here. Fixed instants do not shift with a later timezone change.
- DST gaps are rejected; an ambiguous repeated local time uses its first occurrence, as disclosed
  in the form. Registration is not evidence of actual ringing.

## Run/build instructions

1. `pnpm install --frozen-lockfile` at workspace root (applies the pinned native patch).
2. Use the existing Expo workflow for ordinary Expo Go/web development. Alarms show an explicit
   unsupported-build explanation there; other planner screens remain available. With the
   development-client package installed, use Expo's `s` shortcut to switch to Expo Go when needed.
3. For true alarms use a **custom native development build**, not Expo Go. On a local build
   machine use the existing app/API public configuration described in README. Choose stable
   `ios.bundleIdentifier` and `android.package` values before creating device builds; those
   identifiers and signing credentials have **not** been invented or configured in this pass.
4. With Android Studio/SDK/JDK and a physical Android device, from this artifact directory:
   `pnpm exec expo run:android --device`.
5. On a Mac with Xcode 26+ and an iOS 26+ physical iPhone:
   `pnpm exec expo run:ios --device`. These commands generate/compile local native projects.
   Do not commit generated native projects over the config-plugin source of truth.
6. Start Metro for the installed development build using the existing workflow or
   `pnpm exec expo start --dev-client` in a correctly configured local environment.
7. Sign into the existing account, unlock with the separate planner passphrase, then enable
   access from Device alarms. Android notification and exact-alarm permissions are distinct.
   Recheck access after returning from system settings.

No native build, signing setup, production configuration change, deployment or store submission
was performed. This Linux session has no available Xcode, Swift compiler, JDK or adb executable.

## Verification evidence

- Final companion test run: **41 passed, 0 failed, 0 skipped**; companion TypeScript check passed.
- Companion unit/integration checks cover native adapter behavior with an injected test double,
  secure journal failure recovery, duplicates, limits, unsupported modules, permission denial,
  account switch/logout, in-flight races, orphan cleanup and corrupt-journal recovery.
- Timezone checks run separate Node processes for Australia/Sydney, America/New_York and UTC,
  including spring DST gaps, autumn overlap and invalid calendar dates.
- Existing companion encryption interoperability, offline merge, deletion tombstones, routine
  history, Release 2 data, widget preferences and task notification checks are included.
- Expo public config resolved the plugin and blocked-permission settings. Apple autolinking
  resolved the AlarmScheduler native module.
- Metro exported iOS, Android and web JavaScript bundles successfully. **These are not native builds.**
- The Expo workflow restarted and the unauthenticated mobile web preview rendered its existing
  sign-in screen at 402×874 without a blocking browser error. This does not verify the signed-in
  Alarms screen, native authentication or physical alarm delivery.
- Workspace logs include a non-blocking desktop React Native DevTools installation error
  (`libgtk-3.so.0` missing). Metro continues serving; no unrelated desktop GUI libraries were
  installed. Existing Expo update/peer warnings were not treated as device-build validation.
- The unchanged web app production build passed with its required local `PORT` and `BASE_PATH`.
  Existing large-chunk/sourcemap warnings remain. An initial shell build omitted those required
  variables and failed; supplying the configured values resolved it without source changes.
- No full security scan, physical-device QA, native compilation, VoiceOver/TalkBack run or new
  live Clerk/Google end-to-end test was performed. Unit account-isolation evidence is not a
  substitute for native Clerk/device verification.

## Mandatory device gates — not yet passed

- Compile the patched native module with Xcode 26+ and the Android toolchain.
- On each platform: grant/deny/revoke access, schedule a near-future alarm, lock screen,
  background and normally close the app, verify actual audible delivery and Stop.
- Check Android Doze, permission revocation, silent/DND/alarm-volume choices, reboot,
  force-stop/reopen, five-minute timeout and no full-screen permission.
- Check iPhone silent/Focus modes and iOS 25 unsupported behavior.
- Verify native Clerk logout/account A→B switch (including while an alarm is ringing),
  and lock without logout. Confirm the old account's OS alarms are removed.
- Verify save/cancel errors, permissions recovery, corrupt-index confirmation, device restart,
  past-time rejection and a fixed alarm set several days ahead.
- Verify large text, screen reader announcements, keyboard fields, touch targets and tablet layouts.

**Checkpoint: NOT READY for native alarm release or reliance on closed-app delivery** until native
compilation and physical-device gates pass. Web release status is not changed by this feature.

## Rollback

Before removing this integration or installing an older native build, use Cancel all device alarms
or sign out on every test device and verify cancellation. If cleanup fails, keep this native build
installed, grant alarm access and use the recovery controls; do not discard cancellation records
to hide the error. Then restore the previous code/lockfile checkpoint and rebuild the companion.
No cloud/planner data rollback or encryption migration is needed; existing web snapshots/backups
are unchanged. Do not deploy either artifact as part of this rollback.
