# Premiere source hardening audit

Base inspected: `a1f2423563667e456a0162598cf28bbe1d31ce9d` (remote verified, not assumed).
This report records source contracts; it is not Premiere production acceptance.

## Native transport

Existing UUID requests, 32 pending requests, expiry, pairing-token rotation,
256 KiB HTTP body limit and no automatic mutation retry were retained.
Results now require the exact request **action and ID**, and contradictory
success/error envelopes are rejected. Update the desktop and UXP panel together;
old panels without response action correlation fail closed.

The panel remembers up to 1024 delivered IDs per pairing, including failed edits
and lost acknowledgements. It rejects duplicates and refuses new work when full;
rotate the desktop pairing token to start a new delivery session. This is replay
protection within a live panel, not durable exactly-once delivery across crashes.
Native execution errors, timeout and pairing loss remain execution-status-unknown;
inspect before any retry. Post-execution project/sequence changes cannot produce
a successful guarded result. They do not trigger rollback.

Result structure/size is checked before JSON serialization. Oversized, cyclic or
deep results return bounded uncertainty instead of truncated authorization data.
Node transport tests exercise mocked behavior. Rust queue tests cover action
mismatch and contradictory envelopes; Rust execution must be reported separately.

## Workflow cancellation

Transcript rebuild, assembly, mixed/ordinary finishing, graphics, media prep,
layering and review-frame delivery use a mutex-protected execution generation.
A cancel proposal captures the active generation when prepared. A delayed or late
cancel is a no-op after that execution ends, even if a new one starts. Start and
cancel-flag reset are atomic with respect to cancellation. Only one execution per
family is admitted. The native operation already in flight may still finish.
Advanced assembly checks cancellation again between subclip creation and insertion.
Finishing treats every error after mutation dispatch as uncertain and stops; its
success and exit status both require all requested targets to finish.
Completed edit sessions remain completed after a late cancel.

Rust execution lifecycle tests are included. Node tests check all seven call-site
bindings; these are structural checks, not a substitute for Rust or host race tests.
