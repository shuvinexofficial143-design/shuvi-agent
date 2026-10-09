# A02 remote Vercel transport: source-complete staging, NOT DEPLOYED

- One authenticated REST API for **owner chat**: GET /api/remote-command
  (owner/device identity, lastSequence, last 25 task statuses),
  POST operation submit/cancel/decide.
- Separate device REST API: GET /api/remote-agent for outbound poll;
  POST operation receipt for native status evidence.
- All credentials are **256-bit random hex strings**. The hosted server
  has separate SHA-256 hashes for owner and agent: a browser credential
  cannot post device receipts. Agent identity cannot submit owner tasks.
  Hashes alone cannot recover tokens and do not grant native OS approval.
- Server-only Supabase/PostgREST service key, in a **dedicated Shuvi project**.
  Run SQL in docs/SHUVI_REMOTE_POSTGRES_SCHEMA.sql only AFTER choosing
  the project. No changes in Instagram DM or Open Chet databases.
- Atomic journal CAS RPC prevents two Vercel invocations from accepting
  conflicting command sequences. Strict TTL/replay/approval state machine.
- Neither endpoint invokes AI, Windows tools or any paid provider.
- No public credentials in dashboard bundle. No in-memory production
  queue and NO local-loopback bridge exposure.
- The provider must use HTTPS; disable redirects, enforce 6-second deadline.
  Cap JSON request bodies and fail closed if backend isn't configured.
- Production must add endpoint abuse/rate policies, device pairing and
  rotation, verified native audit evidence, better retention and
  real test on a disposable Windows machine. The current v1 has a
  200-task-per-device capacity guard and no archival.

## Not yet wired

Cloud database and Vercel env **are not configured** by this commit.
Windows native agent outbound GET/poll and POST/receipt are **not yet
implemented**. Vercel user UI hasn't switched from drafts to delivery.
Therefore **mobile cannot control Windows now**, even if source tests pass.
Do not merge or deploy before these are complete and user authorizes.
