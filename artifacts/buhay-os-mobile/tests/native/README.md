# Native recurrence UI test

`recurrence-remove-occurrence.yaml` is a Maestro UI flow for either an iOS simulator/device or an Android emulator/device. It runs against the Expo app's native runtime, so the confirmation assertions inspect the operating system's real `Alert.alert` dialog.

## Run it

1. Start the mobile Expo development workflow with `EXPO_PUBLIC_RECURRENCE_E2E=1`. Use an iOS or Android device/simulator that can reach that workflow.
2. Set `APP_ID` to the installed Expo Go or development-build app ID and `APP_URL` to the workflow's deep link for `/__e2e__/recurrence/native/week`.
   - For Expo Go, the deep link must include the Expo project's `--/` route separator.
   - For a development build, the app must be built in development mode with the fixture flag enabled.
3. Run `maestro test --env APP_ID="$APP_ID" --env APP_URL="$APP_URL" artifacts/buhay-os-mobile/tests/native/recurrence-remove-occurrence.yaml`.

The fixture begins with a daily task due today. The flow first cancels the native removal prompt and confirms the occurrence is still present. It then confirms removal, checks that today's occurrence disappears, and checks that a later occurrence remains visible next week. It uses only in-memory fixture data and makes no account or API requests.
