# A22 — Approved native USD reservations (staging, Windows)

This is NOT verified vendor pricing, a final invoice meter, or an absolute payment cap.

Every metered AI text and vision request must match an explicit policy at:

%LOCALAPPDATA%\\Shuvi\\paid-ai-budget-policy-v1.json

Absent, invalid, unapproved models and endpoints fail closed. Local loopback Ollama remains exempt. The conservative per-call reservation is consumed and synchronized BEFORE network dispatch. The existing 48-attempt daily journal remains in effect. No API prices are guessed; use verified user-approved amounts.

Illustrative JSON only (these numbers are placeholders, NOT model prices):

    {"version":1,"daily_allowance_usd_micros":5000000,"models":[{"provider":"openrouter","model":"REPLACE_WITH_EXACT_MODEL","reserve_usd_micros":1000000},{"provider":"custom","model":"REPLACE_WITH_EXACT_MODEL","endpoint":"https://REPLACE_WITH_EXACT_ENDPOINT/v1/chat/completions","reserve_usd_micros":1000000}]}

One USD is one million micros. The example authorizes a $5 DAILY RESERVATION allowance, taking $1 before each call. A reserve amount is user-specified, NOT a guarantee of what the provider will bill. A third-party provider might bill more. Configure provider-side hard spend limits and verify pricing separately.

This is NOT real usage reconciliation, provider pricing retrieval, token-level cost metering, image price verification, subscription accounting or Windows host acceptance; keep A22 open.
