# Shuvi AI spending-policy history (A22) — v0.1.3 update

The Shuvi-local mandatory USD budget policy and paid-attempt hard caps were
**removed from the installed AI request path in v0.1.3** at the owner's
explicit request. Existing `%LOCALAPPDATA%\Shuvi\paid-ai-budget-policy-v1.json`
files are NOT deleted or modified. They are no longer read to authorize Chat
or native Vision provider calls in v0.1.3.

The prior fixed $5/day approval form and per-model USD reservation ledger
are no longer active. The 48 per-runtime and 48 daily billable request limits
are not enforced. Receipt journals remain best-effort observational records:
failure to record optional provider-reported usage must not hide a successful
AI reply or trigger an automatic paid retry.

IMPORTANT: Shuvi does NOT enforce any provider-side spending cap.
The developer is responsible for setting spending/credit limits at xKiro or
the selected AI provider. Paid model calls may incur charges.

Important controls that REMAIN: explicit per-role exact model selection,
a locally stored API credential, provider/endpoint validation, input/output
and image size limits, no automatic HTTP retry, and separate native
computer-control/action approvals. No other provider or model is selected
silently.

This update changes code and tests; Windows installation + real xKiro Chat
responses still require separate confirmation. Archived A22 design files
may exist in historical commits but do not activate any runtime budget gate.
