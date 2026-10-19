# Shuvi 41 — opt-in real Windows Blender host acceptance

This is a **developer-operated, disposable-host verification harness**, not a Shuvi ToolAction or approval bypass. It never changes the Shuvi scheduler, Desktop UI, approved source checkpoints or existing jobs. Its default is a read-only JSON readiness probe. The upstream contract CI runs no-host unit tests. A **separate disposable Windows 2022 real-Blender CI workflow** now runs the full optional eight-stage trial for relevant feature-branch worker/source changes; it uses no user's machine or native Shuvi approval.

## What it proves when a human explicitly runs it on a real Windows host

1. The existing pinned upstream shuvi-blender-agent PlanRunner executes the six typed Stage-1 steps in a real headless Blender child, independently reopens the saved Stage-1 .blend, and verifies actual saved bytes.
2. The same authenticated Blender session passes the Stage-1 dependency preflight and executes all Stage-2 steps. Stage-1 and Stage-2 cannot silently be split into unrelated sessions.
3. A different authenticated Blender child loads SHA-pinned Stage-2 source and executes bounded 64×64, one-sample CPU PNG rendering.
4. A separate Stage-2-sourced Blender child applies the Copper material, saves it and independently reopens the resulting material .blend.
5. Another new Blender child opens that SHA-pinned material scene, verifies real mesh/camera/light/copper shader properties, then produces the optional material PNG. All five output files are independently hashed again at the end.

The harness uses the exact fixed recipes from shuvi_blender_acceptance.py, the existing checked_plan, actual upstream BlenderController / PlanRunner, the independent reopen helper and material-render read-only source preflight. It never executes arbitrary model Python or shell from a plan.

**This is a direct upstream host trial:** it does **not** exercise the native Shuvi Rust ToolAction permission prompts, audit pipeline, Windows Job Object, 4 GB watchdog, scheduler, Adobe import, desktop UI or visually approve model quality. Those require separate end-to-end native acceptance.

## Strict prerequisites

- A **disposable Windows test host** with Blender installed; preserve any currently open user Blender work. Do not run against customer projects.
- Python 3.12, Git, Blender and the pinned, clean upstream checkout at SHA 96b88c2513152f772399f247989ef602d5e0a7d7.
- A clean checkout of shuvinexofficial143-design/shuvi-agent on feature/shuvi41-blender-worker (HEAD recorded in evidence).
- An explicit, existing, absolute blender.exe, upstream checkout folder, and writable absolute output parent **outside source checkouts**. No selected path may be a symlink or Windows junction. At least 512 MiB free disk space; use adequate available RAM and avoid concurrent renders.
- Do **not** install dependencies or copy credentials as part of this acceptance. The script imports the pinned upstream source already present.

## Read-only readiness (default)

From the clean Shuvi feature checkout, supply YOUR existing absolute paths:

~~~powershell
python -B integrations/blender-worker/shuvi_blender_host_acceptance.py --blender-exe "<ABSOLUTE_PATH_TO_blender.exe>" --upstream-root "<ABSOLUTE_PATH_TO_PINNED_UPSTREAM_CHECKOUT>" --output-parent "$env:TEMP"
~~~

No --run: no Blender launched, no file written, no native job submitted. On an unavailable/ambiguous host, ready=false and reasons are reported.

## Real host trial — distinct manual opt-in only

Only on the dedicated Windows fixture host, after checking the readiness JSON and ensuring no important Blender work is open, deliberately set BOTH controls:

~~~powershell
$env:SHUVI41_HOST_ACCEPTANCE = "disposable-only"
python -B integrations/blender-worker/shuvi_blender_host_acceptance.py --blender-exe "<ABSOLUTE_PATH_TO_blender.exe>" --upstream-root "<ABSOLUTE_PATH_TO_PINNED_UPSTREAM_CHECKOUT>" --output-parent "$env:TEMP" --run
Remove-Item Env:SHUVI41_HOST_ACCEPTANCE
~~~

The runner creates one new shuvi41-live-acceptance-... directory. It **does not delete or overwrite old evidence**. Every positive result is backed by actual file SHA-256 and real reopened scene/source proof, and acceptance-report.json records the five stages and the source HEAD. On failure, cancellation or partial output it writes failed_or_partial_outcome_unknown, keeps all files for manual inspection and forbids automatic retry.

The final report deliberately keeps:
- native_shuvi_action_executed=false
- native_owner_approval_reauthenticated=false
- adobe_import_performed=false
- visual_quality_verified=false

Do not interpret a CI green check or even a passing direct host trial as proof of a live Shuvi desktop-to-Blender-to-Adobe accepted workflow.


## Post-run read-only artifact review (new; does NOT launch Blender)

After a separately owner-approved disposable host trial, an operator can
recheck the five retained outputs without reopening Blender or running native
Shuvi actions. Supply the absolute path to the existing report:

~~~powershell
python -B integrations/blender-worker/shuvi_blender_host_acceptance.py --verify-report "<ABSOLUTE_PATH_TO_shuvi41-live-acceptance-DIR\acceptance-report.json>"
~~~

This standalone mode does **not** require --run, the opt-in environment variable,
Git, the pinned upstream source, or Blender. It performs no writes and never
attempts to repair missing output. It rejects:
- Missing/replaced .blend or PNG bytes, wrong absolute output paths or linked files.
- Broken Blender headers, PNG CRC/zlib/filter data, non-64×64 fixed renders.
- Incorrect five-stage order, missing receipts, mismatched Stage-2 session ID,
  reused render/material sessions and wrong source SHA lineage.
- Inflated claims that native permission, Adobe import, or visual QA occurred,
  and ambiguous/oversized/duplicate-key JSON reports.

A passing result returns current_artifacts_rehashed=true with the actual
five checked SHA-256 values. **The host report is unsigned and editable:**
this only verifies that current files agree with its historical claims.
It cannot prove that Blender generated them, authenticate the remote host,
evaluate the image aesthetically, or authorize importing into Premiere.

The run path now also executes the same post-trial byte/lineage gate *before*
accepting a success; a trial with incomplete, missing or mutated proof is
recorded as failed_or_partial_outcome_unknown with no automatic retry. The upstream source CI
covers this using synthetic files. A separately opted-in disposable Windows
runner has since executed real Blender 4.3.2 successfully; native Shuvi
owner-approval execution and Adobe acceptance remain unverified.



### Visible-pixel proof for the two fixed 64×64 demo renders

The offline verifier now **reconstructs actual pixels** for all five standard
PNG row-filter types (None/Sub/Up/Average/Paeth), for RGB8 and RGBA8 only.
The fixed trial refuses a PNG that decodes correctly but is completely
transparent, uniformly colored, or has fewer than 16 visible pixels.
It also requires the Copper material preview to differ from the base
model render in **decoded RGBA pixels**—different PNG compression or file
hashes alone do not count. Identical decoded images fail closed before a
host trial is called successful.

This is a bounded, deterministic *nonblank/different-frame* source acceptance
gate. A varied background or random image could also pass. Therefore the
output still records visual_quality_verified=false and does not claim that
the intended 3D model appears, that material shaders look professional, or
that real Windows Blender/Adobe integration has been accepted. Live visual
inspection is a distinct owner-approved step.

## Verified disposable Windows host CI (2026-10-19)

The feature-only workflow
[`Shuvi41 Disposable Windows Blender Acceptance`](https://github.com/shuvinexofficial143-design/shuvi-agent/actions/workflows/blender-windows-host-acceptance.yml)
downloads the official SHA-256-verified portable Blender 4.3.2 package on a
**temporary GitHub Windows Server 2022 runner**, uses the clean pinned upstream
commit, then deliberately runs `--run --include-motion` with its
`disposable-only` opt-in. On HEAD
`5b1db7c9e250ba824cbe4e3f581fb0eaa506bfc2`, the
[real eight-stage run](https://github.com/shuvinexofficial143-design/shuvi-agent/actions/runs/39212949621)
completed successfully with all eight saved outputs and
[independent eight-file proof](https://github.com/shuvinexofficial143-design/shuvi-agent/actions/runs/39212949621/artifacts/12168566682).
The report confirms real Blender launch, independent .blend reopen/motion
keyframes, two distinct decoded frame images and independent artifact rehash.

**Follow-up CI hardening:** For future relevant changes to Blender worker code,
native Blender Rust modules, contract workflow or source tests, the real host
workflow automatically reruns on this *exact feature branch*. It now checks
out the **immutable triggering GitHub event commit** (rather than whichever
branch tip exists when the runner begins), establishes the local feature branch
without pushing, and requires the recorded trial source SHA to match the
original event SHA. An unrelated, changed or moving checkout fails closed.
This is a CI provenance guard, not a cryptographic signature on the unsigned
JSON report.

The native Shuvi Desktop permission/ToolAction path, actual user's Windows
machine, Adobe import and artistic approval are still separate tests. Never
describe this CI trial as approval, deployment, production readiness or native
UI-to-Blender end-to-end acceptance. This PR remains draft.
