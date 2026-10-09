# A02 secure delivery coordinator — STAGING / INERT

New module `web-dashboard/server/remote-coordinator.mjs` extends
`web-dashboard/src/remote-command-contract.mjs` into a headless task
journal/coordinator with unit tests. It is NOT imported into a Vercel endpoint
or web UI, and it makes NO Windows calls.

## Implemented in isolation

- Actor-role-gated methods (user admit, agent poll/receipt, user approve/deny,
  cancel and list), always scoped to a verified server-side owner+device.
- Durable journal **interface** requiring serializable atomic transactions
  across all cloud workers. No default in-memory "production" transport.
- Server-time TTL, monotonic device sequences, replay/deduplication checks.
- At-least-once, bounded agent polling; expired tasks excluded.
- Authenticated device receipt state transitions and evidence references.
- Approval decisions bound to task and single-use ID (approval intent ONLY).
- Cancellation *request* never fabricates completed task receipts.

## Not done and must be implemented before any live connection

1. Choose/approve real user authentication and a device-pairing flow with
   cryptographically verified identity and scoped, revocable credentials.
   The `authenticated:true` actor parameter is a **trusted middleware output
   contract**, not a permission that can be supplied by client JSON.
2. Choose/approve a persistent transactional backend supporting dedupe and
   strong ordering across concurrent Vercel instances; make its database
   transaction durable. The test-only memory store demonstrates API usage,
   **not** production safety.
3. Build authenticated TLS API routes and an outbound native Windows agent.
   Ensure device tokens are OS-keystore protected; no inbound Windows port,
   no Redis key, private cloud AI API, or browser token shortcuts.
4. Add cryptographically authenticated native receipts and approvals,
   persistent one-time consumption, deadline enforcement, logging redaction,
   rate limiting, retention, recovery and parallelism policy. Receipt
   `native_audit` evidence in this module is shape validation, not proof.
5. Use the SAME chat UI for ordinary discussion and permitted commands;
   preserve browser draft threads until a safe, explicit migration.
6. Test in mocked environments, then on user-approved disposable Windows host.
   No provider spending, Adobe edits, preview/production deployment or main
   branch merge without explicit authorization.

The coordinator's state is keyed by owner+device and capped at 200 historical
tasks per scope; production needs documented cleanup/archiving to avoid
permanent capacity lock. Inflight unknown external effects MUST NOT be silently
retried after a disconnect.
