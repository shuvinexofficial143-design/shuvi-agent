# Shuvi 41 — separately approved two-key Blender motion plan

**Source-only/CI milestone.** This adds a fixed optional \`motion\` recipe to
existing native read-only \`blender_build_acceptance_recipe\` and Python
\`shuvi_blender_acceptance.py --stage motion\`. Neither preview executes Blender,
writes a file, approves a ToolAction, launches Windows or starts rendering.

## Approved native sequence

A human explicitly opens a *new* owner-approved Blender session on an actual
\`shuvi41-proof-stage2.blend\` using its exact current SHA-256. The live
\`blender_session_inspect\` revision is passed to the read-only recipe builder.
A *second* separately approved \`blender_session_plan\` ToolAction must still
run the six real pinned-upstream PlanRunner operations:

1. \`objects.list\` — current-revision, exact proof-mesh prefix/type readback.
2. \`animation.insert_keyframe\` — frame 1, position (0,0,0), linear interpolation,
   target object ID/revision bound from step 1.
3. \`animation.insert_keyframe\` — frame 24, position (0,0,1.5), linear
   interpolation, target object ID/revision bound from step 2's *verified*
   actual object readback; stale object edits fail.
4. \`scene.inspect\` — read the post-keyframe scene revision.
5. \`animation.set_frame\` — seek frame 24 with the live revision from step 4,
   letting Blender evaluate and synchronize its final animated transform.
6. \`file.checkpoint\` — save \`shuvi41-proof-motion.blend\` bound to the
   verified scene revision after frame seeking.

The existing independent, **second read-only Blender process** reopens this
saved file, checks its SHA and compares the persisted named action and exact
bounded channels, frames, values, interpolation/easing, handles and object
revisions across both sessions. An unchanged static mesh alone cannot falsely
prove saved animation anymore.

Native plan lineage classifies \`motion\` only for the exact six-step source
recipe (fresh UUIDs/current inspected revision may differ). Its unique
reserved Win32 output basename cannot be claimed by generic plans, including
case or trailing-dot/space aliases. It requires an actual SHA-pinned Stage-2
input file path. Rendering remains separately permissioned; this file is
a native animated scene checkpoint, **not** a video or Premiere-importable PNG.

## Safeguards and verification

- Existing owner approval, authenticated owned process, strict 6-step/90-s
  bound, no destructive permissions, source SHA, output directory and artifact
  byte verification are reused unchanged.
- Actual pinned upstream \`Plan.from_dict\`, typed \`InsertKeyframe.parse\`,
  \`SetFrame.parse\`, and \`PlanRunner\` execute in CI against a deterministic
  fake controller. Target bindings, two distinct frames, final-frame checkpoint
  and fail-closed stale target/absent mesh are exercised.
- Python and Rust native recipe parity/shape and Win32-reserved alias policy
  have independent tests. All previous modeling, material and render recipes
  retain their original filenames, steps, permissions and acceptance chain.

**Boundaries:** CI uses no Blender/bpy, no host graphics, no real animation,
no native ToolAction invocation. The Stage-2 source must be genuinely verified
by the operator; matching a basename and current SHA alone is **not** a
cryptographic native approval attestation. Actual Windows/Blender animation
reopen, visual timeline playback, rendered frame sequence, Premiere import
and merging/deployment remain separately owner-approved work.

## Frame-1 versus frame-24 render proof (separately approved follow-up)

The optional `motion_frame1` and `motion_frame24` read-only recipe previews
extend the motion proof with two **separate native owner-approved renders**.
Neither preview runs Blender. The operator must first open the existing
`shuvi41-proof-motion.blend` in an authenticated, SHA-256-pinned Blender
session with explicitly enabled rendering; the source must be preserved.

Each four-request plan uses the *current inspected* scene revision:

1. `animation.set_frame` selects precisely frame 1 or frame 24.
2. `render.configure` binds to that seek's **verified after-revision** and
   chooses 64×64 pixels, one CPU sample.
3. `scene.inspect` reads the configured scene's latest revision.
4. `render.execute` binds to that revision and writes a fixed distinct PNG:
   `shuvi41-proof-motion-frame001.png` or
   `shuvi41-proof-motion-frame024.png`.

Native Rust recognizes only the exact fixed four-step recipes. The outputs
are reserved even against Win32 case/trailing-dot/trailing-space filename
aliases; generic plans cannot impersonate them. The native gate additionally
requires (a) an authenticated source path whose basename is exactly
`shuvi41-proof-motion.blend` and which is SHA-pinned by the session,
(b) render permission at both session and action level, and (c) the
persistent approved session path. The recipe never grants that permission.

The pinned upstream `PlanRunner`, typed `SetFrame`/`RenderConfig` parser and
mock controller tests exercise both distinct frame poses, sequential CAS
bindings, bounded render outputs and rejection of stale source revision;
Rust and Node assert plan classification and denial of wrong source,
missing permission, mismatched frames, and reserved-name aliases.

**Honest limit:** a test fixture proves protocol behavior, not that two
genuine Blender PNGs exist or differ visually. Filenames plus SHA-pinned
startup do not alone reauthenticate the creator of a provided input file.
Real independent reopening, screenshot comparison and actual host end-to-end
acceptance require separately approved Windows/Blender execution. Nothing here
merges branches, deploys, approves actions, or launches a host.

## Optional real-host eight-stage acceptance mode (source only)

The existing Windows-host acceptance script keeps its **five-stage default**
(model1, model2, render, look, look_render) unchanged. A separately approved
future operator can explicitly request `--run --include-motion`, **plus**
the pre-existing `SHUVI41_HOST_ACCEPTANCE=disposable-only` environment flag,
clean Shuvi feature branch, pinned upstream commit, chosen Blender executable,
and disposable output parent. Neither this feature's creation nor a plain
readiness probe launches or installs Blender.

If these independent prerequisites are met on an approved host, it adds three
strictly ordered stages after the original five:

1. Fresh source-SHA-bound Stage-2 session saves
   `shuvi41-proof-motion.blend`; verified .blend **independent reopen** is
   required, including the previous action/keyframe persistence checks.
2. A new independent render-authorized source-SHA-bound motion session
   seeks frame 1 and creates `shuvi41-proof-motion-frame001.png`.
3. Yet another render-authorized session seeks frame 24 and creates
   `shuvi41-proof-motion-frame024.png`.

The script checks distinct session IDs, input source SHA before/after each
stage, typed PlanRunner results, output names, bytes and SHA. Each incomplete
or interrupted stage fails without automatic retry and retains partial files.

The **read-only offline report verifier** accepts exactly five artifacts for
legacy/default results, or exactly eight when the report explicitly records
`motion_pair_requested=true`. It checks each source chain, current artifact
bytes, PNG chunks/CRC/zlib, authentic decoded 64×64 RGBA content and requires
the two animation frame images to have **different normalized RGBA pixels**.
Changing only PNG compression, row filters, metadata or file SHA cannot pass.
It rejects missing stages, reused sessions, changed checkpoints, identical
frame pixels and forged motion input SHA references.

Passing these checks would establish a bounded **visible frame difference**
for the specific trial, but not cinematic quality or full-scene semantics.
An unsigned mutable report is not an external attestation of past execution,
and the CLI bypasses native Shuvi ToolActions; it is an independent
owner-opt-in host QA harness, never a claim of native user approval.

**This milestone only adds code/tests.** No Windows host was accessed,
no Blender launched, no render actually produced, and no merge/deploy occurred.

## Saved motion semantics after independent reopen

The opt-in eight-stage host runner now rejects a motion checkpoint that merely
contains some animation keys or produces two different PNG byte streams. The
saved `shuvi41-proof-motion.blend` must pass **both** writer-side and new
read-only Blender-process inspection of the same bounded scene fingerprint,
plus a fixed motion-specific invariant:

- Exactly one animated `Shuvi41ProofMesh`, with all nine genuine XYZ\n  location/rotation/scale F-curves at frames 1 and 24, using LINEAR\n  interpolation. Its Z location moves from 0 to 1.5 while the other\n  coordinates, rotations, and scales match the fixed authored recipe.
- The saved scene is at frame 24, its actual mesh transform is approximately
  (0, 0, 1.5), and the expected camera and key light survive.
- No animation drivers or NLA tracks may override the expected action;
  duplicate/conflicting location curves and wrong/missing points are denied.
- The motion checkpoint's independently reopened proof must expressly include
  `fixed_motion_keyframes_verified=true`. The eight-stage unsigned report
  carries a matching motion-only receipt field, and offline verification rejects
  missing/false flags or flags attached to non-motion stages.
- Both frame-render stages and the motion-save stage must finish under the
  same session identity that inspected their authenticated input at launch,
  besides the existing distinct-session and SHA lineage constraints.

This closes a false-positive mode where different noisy 1-sample still renders
would otherwise count as motion. The offline verifier can check only the
retained **unsigned claim** and current files; it cannot replay historic
keyframes without authorized Blender, certify artistic motion quality, or
authenticate who produced the report. This development milestone invokes no
live Blender/Windows session and never merges or deploys.

## Real disposable Windows runner proof

A deliberately one-shot, feature-branch-only GitHub Actions Windows 2022 runner
retrieves official SHA-256-verified portable Blender 4.3.2, checks out the
pinned upstream source outside the clean Shuvi checkout, and opts into the
full eight-stage test. The report now marks `blender_launch_performed=true`
only after an actual authenticated session opens, and revokes any premature
success flags if the final offline SHA/pixel recheck fails. Separately,
`--verify-report` continues to advertise `blender_launch_performed=false`
because read-only *reverification* itself starts no new Blender process.
Artifacts are seven-day disposable CI proof files, not desktop deployment or
native Shuvi owner-action approval.
