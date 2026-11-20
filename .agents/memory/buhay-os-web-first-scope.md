---
name: BUHAY.OS web-first scope
description: The user's standing release boundary for the BUHAY.OS project.
---

Keep the default delivery target limited to the existing web app. The Expo/React Native iOS/Android companion is on hold except for alarm support, which the user explicitly authorized on 2026-10-16. Do not resume unrelated native development or delete existing companion work.

**Why:** the user asked.

**How to apply:** For BUHAY.OS release work, target the web app only and preserve existing companion work. Native alarm work may proceed: first verify iOS/Android support and report device/build requirements before implementing. This authorization does not include publishing or app-store submission.

The user requires alarms that work even when the planner is closed or the phone is locked, not an in-app timer presented as equivalent.

**Why:** The user selected closed-app alarms and approved resuming native work for alarms only.

**How to apply:** Distinguish true device alarms from ordinary notifications, expose unsupported OS versions and denied permissions honestly, and do not claim locked-screen delivery without physical-device verification.

For iPhone alarm compatibility, use true alarms on iOS 26+ only, with no ordinary-reminder fallback on older iPhones. Android alarms remain in scope.

**Why:** The user selected “True alarms on iOS 26+ only (recommended).”

**How to apply:** Clearly label older iPhones unsupported for true alarms; do not silently substitute notifications.
