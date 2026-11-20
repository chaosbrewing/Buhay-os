---
name: Buhay.OS encrypted storage
description: The user's security decision for planner sync and future features.
---

Buhay.OS cloud planner snapshots and version history use end-to-end encryption. The separate encryption passphrase cannot be recovered; never send it or the derived key to the server.

**Why:** The user selected end-to-end encryption and accepted that losing the separate passphrase means losing access to synced data.

**How to apply:** Keep server-side features blind to planner plaintext. Any external AI or provider integration that requires plaintext must be explicit about what is shared and obtain the user's consent.

New planner fields must be additive and optional. Preserve unknown snapshot fields, and do not write empty defaults into an older snapshot just because the client can now represent them.

**Why:** The user requires backward compatibility and no unsafe migrations; forcing unchanged legacy snapshots through a new shape creates unnecessary rewrites and cross-client conflicts.

**How to apply:** Extend the encrypted snapshot client-side only when possible. Test that old snapshots and backups load unchanged before adding fields, and request approval before any encryption-contract or production-data change.

Habit progress, completion/uncompletion, and skip decisions are dated, optional snapshot records. Legacy completed dates can be unioned across offline copies, so explicit timestamped uncompletion decisions must override stale dates. For measurable habits, the latest progress value determines completion. When devices edit the same date or pause range offline, keep the latest timestamped choice; do not merge unskip or resume operations as simple additions.

**Why:** Undoing a completion or skip, or resuming a pause, must survive sync against an older offline copy, while remaining inside the end-to-end encrypted snapshot. Measurable progress and its derived completion state must not disagree after a concurrent same-date merge.

**How to apply:** Keep habit history merge logic client-side and timestamp-resolved. Use the progress value as the completion source for measurable habits. Do not add plaintext habit fields to API payloads or database records.

When offline and cloud copies diverge without a trustworthy shared baseline, preserve both originals and require explicit recovery. Do not treat an absent record as a deletion. An older cache without ownership metadata must not automatically be assigned to the account that next signs in.

**Why:** Cloud-first unlock can erase offline work; unowned legacy caches cannot prove account ownership. Without a baseline, silently choosing either deletions or additions invents the user's intent.

**How to apply:** Keep recovery bookkeeping client-side and encrypted, warn that baseline-free recovery can restore previously deleted records, and obtain ownership confirmation before attributing legacy data. This does not authorize encryption-envelope or production-schema changes.
