# Windows outbound remote inbox (A02) — staging only

Native Windows Tauri now registers remote_agent_status, remote_agent_pair,
remote_agent_disconnect, remote_agent_poll and remote_agent_receipt IPC commands.

- Endpoint pinned to Shuvi Vercel HTTPS /api/remote-agent; no inbound port.
- Native agent token must be 256-bit hex and is stored using OS keyring;
  pairing verifies the agent role with the server first.
- Network has bounded timeout, no redirects, and capped JSON response.
- Poll validates message IDs, issued/expiry timestamps and command length.
- No remote token, full cloud response or secret ever returned to browser.
- A remote poll ONLY returns an envelope to the native UI; IT DOES NOT execute
  an OS action or call an AI model without the existing native orchestrator.
- Native receipt posting cannot bypass the server's authenticated role and
  atomic receipt transition checks.

Still required: wire the Tauri UI to an opt-in, supervised receive loop,
associate approved typed-tool audit events with remote task IDs and send
honest terminal receipts, and complete mobile remote approvals. Never mark
Windows control active merely because the cloud queue accepted a task.
