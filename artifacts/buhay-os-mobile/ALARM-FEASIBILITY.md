# BUHAY.OS closed-app alarm feasibility

Investigation date: 2026-10-16.

**Historical investigation:** implementation followed this report. The user selected true alarms
on iOS 26+ only (no older-iOS fallback). See [ALARMS.md](./ALARMS.md) for current implementation,
actual verification and remaining release gates; the “not implemented” statements below describe
the initial audit, not current source.

## Authorized scope

The user resumed existing native work for alarm support only. The requirement is an alarm that can sound while the planner is closed or the phone is locked, attached to a task, habit, routine or calendar event. Publishing, store submission, encryption changes and unrelated native work are not authorized.

This document reports investigation findings before implementation. No alarm feature, package installation, build, permission request or production change was performed during this investigation.

## Actual companion status

The companion uses Expo 57 / React Native 0.86 and expo-notifications. Its current scheduling adapter accepts task reminders only, with date-based notification triggers, sound enabled, and an Android notification channel. It schedules at most 48 upcoming reminders.

That is **local notification support**, not an AlarmKit/Android alarm-clock implementation. The native app configuration has no AlarmKit usage description or explicit exact-alarm configuration. Repository search found no AlarmKit bridge or AlarmManager alarm-clock implementation.

Existing provider reconciliation schedules from task data while unlocked. Provider unmount cleanup cancels the app's marked notifications. These lifecycle semantics must be reviewed separately for planner lock, logout/account switch, ordinary backgrounding and process termination; React cleanup is not guaranteed when the operating system kills the process.

Existing device-QA documentation marks physical permission prompts, locked-screen delivery, force-close/relaunch and device DST tests as not run. Their presence as a checklist is not evidence that those behaviors work.

## Platform findings

| Platform | Viable mechanism | Limits / requirements |
| --- | --- | --- |
| iOS/iPadOS 26+ | Apple's AlarmKit | User alarm authorization; `NSAlarmKitUsageDescription`; native Swift integration built with an appropriate Xcode 26+ SDK. Apple documents alarms that can override silent mode and Focus, plus snooze/countdown support. Requires a custom native development build, not Expo Go. |
| Older iOS/iPadOS | Existing local notifications only | They may alert with the app closed, but ordinary notification sound respects silent/Focus settings. Do not label this an equivalent persistent ringing alarm. No older-iOS true-alarm solution was established in this investigation. |
| Android | Native AlarmManager alarm-clock scheduling plus alarm delivery/audio and stop/snooze handling | Check exact-alarm access before scheduling. Request user-granted special access where required, rather than assuming it is granted. Full-screen lock-screen UI has separate permission and Play policy restrictions. Implement boot/timezone/permission-change reconciliation. |
| Web / Expo Go | Existing reminder/UI previews | Cannot validate or provide this custom native closed-app alarm requirement. |

On Android 15, a user force-stopping the app cancels its pending intents. Closing the visible app is not the same as explicitly force-stopping it in device settings. Do not promise alarm delivery after force-stop, permission revocation or when the phone is powered off.

## Minimal safe integration

1. Keep existing authentication, backend and encrypted snapshot envelope. Add only backward-compatible optional alarm configuration after finalizing the supported-OS scope.
2. Use stable source references for tasks, habits, routines and authorized calendar events, with per-device OS alarm identifiers. Calendar event access remains subject to existing Google permissions; no Google secret belongs in the native client.
3. Schedule real OS alarms while the planner is unlocked. Default OS-visible content to a generic BUHAY.OS alarm, exposing only the timing and minimum identifiers needed for delivery, not decrypted journal/task content.
4. Explain that the operating system necessarily knows the scheduled time and alarm presentation. This is device-local scheduling metadata, not plaintext planner data sent to the backend.
5. Separate planner lock from logout/account change. A deliberately scheduled generic alarm must be able to ring after planner lock; logout/account change must cancel the previous account's scheduled alarms. Stop/snooze must work without exposing encrypted planner content.
6. Reconcile edits, completions, skips, pauses, deletes, recurrence exceptions, DST/timezone changes, permission revocation and reboots. Use the shared planner schedule rules rather than duplicating business logic.
7. Be explicit about offline/E2EE limits: an already scheduled phone alarm cannot instantly learn an edit made on another device while the native planner is closed and its encryption key is unavailable. Reconcile on the next authenticated unlock; do not weaken the passphrase boundary to promise immediate background sync.
8. If native permission or OS support is missing, show an actionable unsupported/permission state. Do not report success or silently downgrade a true alarm to an ordinary notification.

## Implementation and verification gates

- Decide whether older iOS devices need ordinary-reminder fallback or whether true alarms are iOS 26+ only.
- Implement a narrowly scoped native bridge/configuration, keeping Expo Go previews explicitly unsupported for true alarms.
- Native compilation and physical iOS/Android tests are mandatory before declaring the feature functional: locked screen, normal app closure, silent/Focus behavior, denied/revoked permissions, stop/snooze, restart, account switch, edits/deletions and DST.
- Test source references, encrypted snapshot/backup compatibility and deterministic reconciliation without putting decrypted content in API requests.
- Preserve the web app. No web release or unrelated native feature is required for this work.

**Current status:** feasible with OS-specific native work, not implemented or device-verified. No application tests or native builds were run for this documentation-only investigation.

## Official sources checked

- [Apple AlarmKit](https://developer.apple.com/documentation/alarmkit)
- [Apple: scheduling an alarm with AlarmKit](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit)
- [Android: schedule alarms](https://developer.android.com/develop/background-work/services/alarms/schedule)
- [Android 14 full-screen intent restrictions](https://developer.android.com/about/versions/14/behavior-changes-14#secure-fsi)
- [Android 15 stopped-state behavior](https://developer.android.com/about/versions/15/behavior-changes-all)
- [Expo 57 notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)
- [Expo custom native code and development builds](https://docs.expo.dev/workflow/customizing/)
