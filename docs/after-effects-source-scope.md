# After Effects supported source scope

The production transport remains Rust typed requests -> bundled ExtendScript -> AfterFX.exe -r.
Declared source coding completion covers the existing bounded action set and the six source priorities below.
It does not attest Windows/Adobe runtime acceptance, visual semantics, persistence, successful rendering,
media parsing on real outputs, or production readiness. Runtime reports retain independent evidence dimensions.
CI execution evidence must be checked against the exact current Git commit, outside these static declarations.
The opt-in disposable [runtime acceptance harness](after-effects-runtime-acceptance.md) is prepared. The current
machine has no compatible trusted After Effects install; preparation/model tests do not establish real host acceptance.

## Completed source priorities

- Media: desktop file evidence and host completion remain separate from optional trusted ffprobe metadata.
  Structural PNG/JPEG/WAV/MP4 markers never establish successful parsing. The only probe install location is
  `%ProgramFiles%/ffmpeg/bin/ffprobe.exe`; executable paths reject symlinks/reparse points. No PATH search or
  installation occurs. Execution uses argument arrays, null stdin, local file/pipe protocols, 5 s per-file
  and 15 s per-batch budgets, 256 KiB stdout/16 KiB stderr bounds, bounded streams and positive timed-media
  duration. Parse evidence never establishes byte-stream decode or playability.
- Cancellation: exact request/project/revision markers are atomically published and retained. Before-start
  prevention differs from native stopping. Native stop occurs only at a render status callback after project,
  queue and output ownership checks, and requires terminal USER_STOPPED evidence. Existing native callbacks
  are respected. Callback cleanup is read back. Timeouts and partial receipts do not establish cancellation.
- Recovery: saved-file checkpoints bind backup/source fingerprints, timestamp, request and expected revision.
  Verification works when the original file is missing. The planner verifies the backup and describes exact
  recovery steps requiring separate explicit approval. It never opens/restores/overwrites a project. FNV is
  a noncryptographic integrity fingerprint. Checkpoints do not preserve unsaved in-memory host edits.
- Camera/light/3D: stable property matchNames, renderer/host availability checks, full batch preflight and
  readback cover camera iris/DOF, light shadows/falloff, material coefficients/reflection/transparency, and
  static transforms including point of interest. Existing keyframes, expressions, locked layers or separated
  dimensions are refused by the corresponding static writers. Light type changes are inspected separately.
- Presets: absolute `.ffx` files must be regular and under `<project folder>/Shuvi Assets/Presets`, with no
  symlink/reparse path, and 1..16 MiB. Bytes are copied to a fresh job-specific staging file and compared before
  host dispatch. Checkpoints precede mutation, selection is isolated and restored, and bounded before/after
  effect/property inventories report observational deltas. Complex/deep/unreadable values are omitted explicitly.
  `.ffx` semantic correctness remains unverified and application is never automatically retried.
- Templates: a read-only planner composes the existing AE action transport. Premiere recipes remain specific
  to Premiere component bindings. AE recipes accept explicit inspected binding values, 1..32 steps, <=128 KiB,
  depth <=8 and <=10,000 nodes. They exclude arbitrary file access, expressions, deletion and rendering. Each
  eventual step needs a new inspection, exact revision, unique request ID, checkpoint and reconciled readback.
  Category names such as wedding graphics describe intent; they do not prove visual output or supply assets.

## Intentional limits

- Native hand detection and unavailable native tracker controls require grounded external samples.
- General in-flight mutation abort has no reviewed safe native route. After Effects is never killed to cancel.
- Single-file render workflows refuse sequence patterns. Exact frame manifests are required before sequence
  completeness could be verified; filenames are never guessed or globbed into a validity claim.
- Probe absence/untrusted install, unsupported formats or invalid metadata leave parsing unverified.
- Byte-stream decoding, playback and rendered visual review are a separate runtime phase.
- Advanced controls exist only when the exact installed host/renderer exposes the documented property.
- UXP stays a future adapter boundary. No speculative replacement of ExtendScript is included.

## Source verification

`npm test`, `npm run validate` and `npm run build` cover repository/source behavior. AE source CI also runs
the static safety/completeness tests, executable host-model tests, Windows `cargo check` and AE Rust unit tests.
The host models are not Adobe execution. Regression tests compare every Rust action classification with the
host dispatch/mutation inventories, and exercise cancellation ownership, callback cleanup, all-before-write
preflight, trusted preset selection/deltas, metadata bounds, recovery binding and template limits.

API references: [RenderQueue](https://ae-scripting.docsforadobe.dev/renderqueue/renderqueue/),
[Layer.applyPreset](https://ae-scripting.docsforadobe.dev/layer/layer/#layerapplypreset),
[camera matchNames](https://ae-scripting.docsforadobe.dev/matchnames/layer/cameralayer/),
[light matchNames](https://ae-scripting.docsforadobe.dev/matchnames/layer/lightlayer/),
[3D material matchNames](https://ae-scripting.docsforadobe.dev/matchnames/layer/3dlayer/),
[ffprobe](https://ffmpeg.org/ffprobe.html).
