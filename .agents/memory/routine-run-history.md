---
name: Routine run history
description: The sync-safe semantics for recording and merging completed routine steps.
---

Routine runs are independent of the editable routine definition: each run captures the step IDs, titles, and order as they were when it began. Legacy `completedStepIds` remain readable; intentional corrections use per-step timestamped records, and run removal uses a deletion timestamp rather than physically removing the run. Merge corrections per step by timestamp and retain deletion markers so stale offline copies cannot restore a deleted run.

**Why:** Both clients share one encrypted snapshot and can reconnect with concurrent copies. Immutable run snapshots preserve what a user followed, while explicit correction and deletion records let offline merges distinguish user intent from stale absence.

**How to apply:** Keep new run fields optional for legacy snapshots. Do not infer corrections from missing completion IDs or infer deletions from absent runs; merge the explicit timestamped records instead.
