---
name: Expo Router Stack children
description: "A development web-preview failure caused by passing a React fragment directly to Expo Router Stack."
---

Keep `Stack.Screen` entries as direct children of `Stack`; do not wrap them in a fragment. In Expo Router 57's development web path, its protected-screen mapper does not flatten that fragment and stringifies the fragment's Symbol type while reporting an unexpected child, causing `Cannot convert a Symbol value to a string`.

**Why:** The mobile preview failed before rendering any route even though the app's TypeScript checks passed.

**How to apply:** For conditional stack screens, return separate `Stack` trees from the branches or render flat screen siblings. Verify the web preview as well as the native bundle.
