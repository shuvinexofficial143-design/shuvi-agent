# Shuvi A02 — Remote Command Contract V1 (staging; no live relay)

This contract is the first **testable, offline** boundary for the future
Vercel Web Chat → authenticated service → outbound Windows Shuvi Agent route.
It does **not** implement a server, delivery, login, cryptographic verification,
native executor, payment provider, or approval authority. **Do not represent
this as remote control working.** Existing browser drafts remain local; local
read-only native bridge stays isolated to 127.0.0.1 and its approved origin.

Source: `web-dashboard/src/remote-command-contract.mjs`
Tests: `web-dashboard/scripts/remote-command-contract.test.mjs`

## Message, identity and durable admission

`protocol=shuvi.remote.v1`, `type=user_message`, opaque owner/device/thread/
message/task IDs, increasing `sequence`, `issuedAt`, `expiresAt`,
`mode=chat|task`, and bounded natural-language `text` (2500 chars maximum).
Neither mode is a shell command; *no browser text is executable by itself*.
Expired, future-skewed, malformed, duplicate and cross-device messages fail
validation. TTL is capped at five minutes. The IDs must be generated with a
cryptographically secure random generator in the eventual authenticated client
and checked against server-issued identity; matching the ID pattern does
not establish authentication.

**Mandatory implementation gates not supplied by this module:**
- Authenticate user/device in the service using a provider-backed identity,
  TLS, authorization and carefully scoped keys. Never trust `ownerId` supplied
  by the browser as a grant. No global owner key or web API key in localStorage.
- Use a **durable, atomic** transaction/unique constraint to consume
  `messageId`, `taskId`, and monotonic `sequence` before queue admission.
  Validator checks against Sets are *illustrative only*; they do not reserve IDs.
- Bind outbound Windows agent session to the authenticated device; enforce
  TTL again on retrieval/admission; use bounded backoff and payload sizes.
- Keep chat and task conversation receipts in one thread; do not re-enable a
  separate paid Cloud AI Chat or unlock form to achieve this.
- Never retry an uncertain paid request, desktop click, file write or export
  automatically; `outcome_unknown` is a terminal state until reconciliation.

## Task receipts and approval

Receipts use the same five IDs, `revision`, `occurredAt` and status:
`received → admitted → running → succeeded` (or approved branches);
`requires_approval` may occur from admitted/running; stopped, failed and
outcome_unknown are terminal. Success is required to carry a native audit
evidence reference; only trusted agent cryptographic proof and review can
establish its authenticity. Shape checks are not evidence verification.

Approvals must match pending approval ID, task ID, owner ID, device ID and
unexpired request. Denials are supported. Before an **approve** can permit
an action, service and native side must verify authenticated human permission,
single-use nonce/journal consumption, risk-specific policy, device scope,
and task state. This validator does not authorize any Windows operation.

## Integration order (future work)

1. Decide and approve an authenticated transport and persistence solution,
   then implement server-side atomic admission and native outbound polling.
2. Add signed/verified receipts and device-specific approvals; prove replay,
   reconnect, ordering, expiry, deny, cancellation and unknown-outcome tests.
3. Connect the single Web Chat UI while preserving existing browser history
   and showing honest states (`saved locally` vs `delivered`).
4. Only with separate Windows test approval and a disposable test environment,
   verify benign read-only tasks, then app editing and exports.
5. Never deploy or merge protected branches without separate user permission.
