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
