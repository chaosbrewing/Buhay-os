---
name: Live browser verification and Fast Refresh
description: Avoid confusing hook-signature hot-reload failures with production runtime failures.
---

Freeze hook structure while authenticated browser verification is running. Adding a hook during a live Vite session can leave already-open pages with hook-order or internal React errors even though fresh pages work.

**Why:** Concurrent source edits interrupted multi-account data-recovery verification with a hook-order/ErrorBoundary failure; fresh pages after the completed edit batch did not reproduce it.

**How to apply:** Finish the coherent edit batch, restart the relevant web workflow and use fresh pages before classifying a hot-update-only failure as a release blocker. Never dismiss an error that reproduces on a fresh load.
