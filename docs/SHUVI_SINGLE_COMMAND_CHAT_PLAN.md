# Shuvi: one command chat, native xKiro Master (staging only)

User requirement: Vercel is the **remote command interface**, not an
independent paid AI chatbot. The real Windows Shuvi Master uses xKiro;
normal conversation and PC commands belong in **one chat**.

On this phase branch the Chat UI has one local conversation surface and no
longer mounts the unrelated Vercel Online AI Chat/Private Key unlock panel.
Existing local messages and threads remain untouched. The browser models page
shows xKiro as a **planning choice**, without inventing SOL/Claude model IDs
or API credentials. No provider is actually connected by this change.

**Important:** Current messages remain local browser drafts, NOT delivered to
Shuvi. The existing loopback bridge is authenticated read-only status and
intentionally rejects Vercel origins. No remote command, approval, AI reply
or PC action is supported yet.

A real secure command relay still requires: verified Windows agent online,
session/user authentication, task identity and idempotency, explicit native
approvals, durable receipts, status transitions, cancellation and retry-safe
unknown outcomes. Verify with harmless commands before Adobe manipulation.

Do not add Redis or Vercel cloud provider keys as prerequisites for native
command chat. Do not deploy, merge or mutate external user projects in this
staging work.
