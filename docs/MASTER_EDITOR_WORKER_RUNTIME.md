# Shuvi Master Editor — typed worker runtime (development branch)

## Implemented in the Windows desktop source

- Master selects tools and app families from the ordinary user editing prompt. The existing native AI tool loop makes one approved proposal at a time; it is **not** a parallel pool of AI models.
- The persistent local task graph supplies dependencies and completed native action evidence. `master-worker-queue.mjs` projects Premiere, After Effects, Remotion, Blender, browser, Windows and code work from these real steps, with a resource-lane lock hint.
- A worker step is marked verified only when its expected tool has an exact successful typed-result/Rust executed audit receipt with an action UUID. In-progress jobs are never silently promoted after restart. Approval/denial/cancellation remain Rust-owned.
- The Windows app task-progress display includes worker lane and audited/ready/running/blocked counts. The browser-only Agents page remains **planning-only** and is not the runtime.
- The master prompt guides existing verified Remotion render -> multi-frame review -> final acceptance -> approved Premiere insertion. A generated plan or local path alone does not mean an asset was rendered/imported. Actual source/project verification remains required.
- A native Blender read-only inspection action `blender_inspect` is now wired to a **fixed bundled Python adapter**. It uses the separate `shuvi_blender_agent` package's `LaunchConfig`, authenticated loopback bridge and `BlenderController`.
  - Inputs: user-approved absolute Python executable, absolute Blender executable, optional existing absolute `.blend`, and operation `scene.inspect` or `system.capabilities`.
  - The helper explicitly sets `SafetyPolicy()` (no mutation, saving, file writes or rendering).
  - The native result requires a successful authenticated host response and rejects uncorrelated or malformed evidence.
  - Python 3.11+, the separately installed `shuvi_blender_agent` package, and an accessible Blender executable are required on the Windows machine. **Nothing was installed on AntCloud in this change.**
- Fixed helper is bundled as a Tauri resource, not an AI-created or user-provided Python source string. Rust always stages the typed tool through normal permissions and the existing native action audit.
- Single native execution lease remains authoritative. Lock hints on the UI are **not** parallel execution guarantees.
- The durable Task Graph worker projection now refuses to advertise or stage a
  second native action while **any** worker is running, even if that action is
  assigned to a different app/project resource lane. Every new prepared UUID
  requires exactly one in-flight graph action, and successful typed outcomes
  also require that exclusive lease.
- The native-lease supervisor is a **read-only view of Rust-owned state**:
  awaiting preparation, prepared action in flight, ready, waiting or
  recovery-required. No fake heartbeat is inferred from a timer or model
  output. A malformed checkpoint, unverified completed action, failed step
  or impossible double-running state quarantines all new dispatches.
- After process interruption the checkpoint remains fail-closed; a previously
  running action becomes an interrupted/failed step requiring separate
  inspection, owner-approved replan and a fresh native prepared-action UUID.
  It is never automatically retried, resumed as success or run on another
  app worker. This is not an independent job daemon or concurrent AI process.


## Rust native host supervisor — read-only observation, not a fake heartbeat

- Native Tauri now exposes `native_worker_status` from actual Rust
  `ActionState.native_execution_owned` and the currently executing action's
  Rust-owned UUID/tool/start timestamp. The read-only command also inspects
  the existing disk-backed `native_recovery` journal. It neither stages
  tools nor authorizes paid model requests, approvals, retries or execution.
- Timestamps report **elapsed time since the native action was claimed**;
  they do **not** mean the Python, Blender, Premiere or After Effects worker
  has produced a new progress heartbeat. The response explicitly reports
  `progressHeartbeatVerified=false` and `safeToAutoRetry=false`.
- The status reports **ownership in this application process** only.
  Cross-process ownership is `unknown_not_probed`; it never claims the
  Windows desktop is free simply because the current Shuvi window is idle.
- An incomplete durable `executing` journal without the identical current
  lease/action ID, a stale `outcome_unknown` journal, an impossible duplicate
  action, or a running record without its Rust lease becomes
  `recovery_required`. The desktop UI samples the read-only IPC every
  four seconds and labels its observation as **not a progress heartbeat**.
- Every desktop-mutating native action or Adobe bridge lifecycle operation
  now acquires the original cross-process Windows exclusion and requires
  empty previous action records. A panic-stale record causes denial, not
  automatic lease expiration or a guessed safe restart.
- **Remaining gap:** this is not a durable independent Job Scheduler and
  does not create separate AI worker processes, in-process job queues,
  host-signed worker progress heartbeats or trusted parallel dispatch.
  A long-running action can own the native lease without making progress.
  Real per-worker heartbeat/child-process tracking must be integrated with
  native worker adapters and tested on a disposable Windows host.

## Cross-app artifact identity gate (Task Graph, development branch)

- The Master Task Graph now retains an **allowlisted artifact identity** only from a
  successful typed native result correlated with a matching Rust executed audit
  action. This is a bounded immutable projection, not a model claim.
- Remotion final acceptance requires an action-ID match, SHA-256 format, an
  absolute output path, successful final-output hash and visual-review flags,
  and the expected Rust delivery/provenance booleans. The output must identify
  the exact earlier Remotion render action.
- The approved Premiere insertion plan carries the **same accepted output path,
  SHA-256, and final acceptance action ID**, as well as an explicit
  `requires_normal_premiere_approval=true`, `automatic_execution=false`
  contract. A different path in the Premiere proposal fails before staging.
- Native acceptance and insertion-plan evidence is retained in local graph
  checkpoints. Missing/malformed identities, a different render ID, reused
  action receipts, changed path/hash or a forged saved checkpoint fail closed.
  The queue displays the import as blocked; other independent worker lanes
  are unaffected.
- For an approved `blender_run_plan`, the Rust worker's verified
  `artifact.path`, `artifact.sha256`, and bounded byte count are retained
  with the exact approved action UUID. Premiere PNG import is admitted only
  for that same verified path. A `.blend` scene file is **not** a Premiere
  media import and never satisfies the PNG handoff.
- On resume, the next worker-turn context exposes the matching source action,
  path and SHA-256 as **data only**, and the dashboard shows the bounded hash
  fingerprint. This is read-only planning information, not permission for
  automatic insertion, trusted instructions from filenames, or a parallel
  independent Worker process.
- **Live native SHA-256 recheck for receipt-bound timeline insertion.**
  `premiere_insert_media` now accepts `expected_sha256` (exact 64-character
  hexadecimal SHA-256); worker-produced Remotion/Blender media must pass the
  exact value from the audited local task graph before task admission.
  Rust validates the supplied hash, verifies the current bounded regular file
  after saving the Premiere backup and immediately before calling the bridge,
  then hashes again after Premiere's readback. A hash mismatch aborts before
  Adobe mutation, or marks an already-dispatched operation unsuccessful and
  potentially uncertain. The code limits hash-checked sources to 2 GiB.
- **Batch Premiere artifact integrity.** `premiere_import_media` and
  `premiere_create_sequence_from_media` accept an optional ordered array of
  `expected_sha256` values. When present, it must exactly match the media
  `paths` array, contain 1–100 valid SHA-256 strings with no duplicate
  paths, and each source must be a nonempty regular file of up to 2 GiB.
  Rust checks all file hashes after its project backup, just before calling
  Adobe, and again after native readback; any changed file makes the result
  unverified and non-retry-safe. Native hashing also enforces a 4 GiB
  **total batch** budget before hashing any input.
- **Cross-worker batch authority.** In the Task Graph, multiple previously
  verified `blender_run_plan` PNG outputs may be imported together only
  when *every path* and its paired hash matches a unique Rust-audited
  Blender source. The completed Premiere batch records the exact source
  step IDs, producer action IDs, paths, and hashes, and checkpoint recovery
  rejects missing/changed/duplicate provenance. The Master previews
  bounded lists of verified sources but cannot dispatch or approve them.
  Remotion final delivery intentionally cannot bypass its single-output
  final acceptance/insertion-plan sequence using the batch or
  create-sequence tools. Ordinary manual imports outside that provenance
  chain retain their existing approval-based pathway.
- **Important non-atomic boundary:** Adobe still receives a pathname rather
  than an exclusively opened source handle. Other writers can modify the file
  between checks, and a post-dispatch change can mean Premiere state is
  uncertain. Only disposable host testing can certify actual import/readback.
  Ordinary manually supplied media can still use the previous import contract
  without an expected hash; the SHA-256 policy is mandatory in the verified
  worker-to-worker Task Graph, not a blanket claim about all media files.
  The batch and sequence-from-media routes now have their own bounded
  pre/post SHA-256 checks when expected hashes are provided; other media
  manipulation routes and external Adobe changes are not atomic or covered.

## New bounded Blender editing/rendering adapter

- `blender_run_plan` accepts **one high-risk approved** declarative plan with at most 6 steps, 90-second internal plan timeout, one owned authenticated Blender session and a fixed bundled `shuvi_blender_plan.py` adapter. Python package `Plan.from_dict` validates payloads and `PlanRunner` dispatches only catalogued typed operations with independent readback.
- The caller supplies an existing absolute `Python.exe` (Python 3.11+), `Blender.exe`, optional existing `.blend`, existing output folder, explicit boolean `allow_render`, and the typed plan. User-supplied Python source and arbitrary shell commands are not permitted.
- The separate package's `SafetyPolicy(allow_mutations=True,allow_destructive=False,allow_file_writes=True,allow_rendering=allow_render)` authorizes normal modeling/animation within exactly the currently approved plan. It cannot perform destructive operations. Every plan must **end in** `file.checkpoint` (verified new `.blend`) or `render.execute` (bounded verified PNG).
- The Python worker compares verified output SHA-256 and output-folder path; Rust independently streams the artifact, enforces the exact SHA-256 and a 128 MiB cap, then returns a typed success. The final output is not imported automatically; the Master must inspect the resulting path and use Premiere's separately guarded `premiere_import_media` action for PNG inputs. Blender `.blend` is not directly importable in Premiere.
- Native Stop is bound to the worker's registered Python process and its owned Blender descendant; a 4 GB managed-RAM watchdog and 120-second process deadline guard are present. Interruptions still mean the host state or saved output may be uncertain, not automatically rolled back.
- This is **one bounded background session per approved plan**. It is not persistent Blender UI control, unrestricted 3D rendering, multiprocess parallel authoring, or a complete professional editing acceptance test. Real Windows host tests, actual installed Python package and Blender, disposable project acceptance, and verified PNG-to-Premiere insertion are still pending.

## Durable native job observation and supervisor heartbeat

- The existing Rust single-execution lease, cross-instance Windows file
  exclusion, and owner-approved action ID remain the **only native dispatch
  authority**. The new `native-worker-job.json` is an independent, bounded
  append-by-replacement journal for the most recent approved tool action, not
  a parallel scheduler and not an authorization token.
- **Before** a prepared action leaves the native permission queue, Shuvi
  persists a canonical action UUID, tool name and `running` phase. Every
  new guarded desktop entrypoint checks for an unresolved prior job. On
  interruption, a new action is refused; neither an expired timestamp nor
  process restart frees the lease automatically.
- A Rust process-owned supervisor ticks its durable observation record every
  4 seconds while that exact action future remains alive. It is a
  **supervisor process-liveness check-in only**, not proof that Adobe,
  Blender, a child process or a tool operation made any progress. A stale
  tick becomes `supervisor_tick_stale` without cancellation, automatic
  retry or a fabricated completion.
- Only after a normal native `executed`/`failed` audit record is
  durably written can the matching job transition from `running` to
  `audit_verified`, including the Boolean audit outcome. A missing,
  corrupt or orphaned worker journal fails closed rather than reverting to
  an older completed backup.
- The durable job journal now keeps a **bounded last-24 audited action
  UUID replay window**, carried forward on each new approved job and restored
  on restart. A prior action cannot be reused merely because a different
  action was audited afterward. Existing v1 records lacking this optional
  field remain readable. Malformed, duplicate, or oversized replay history
  fails closed; the 2 KiB journal is deliberately **not** an unlimited
  historical ledger. A separate native action audit remains the long-term
  audit source.
- Live supervisor attribution compares **both** the exact action UUID and
  the executing native tool against the durable job. An already-audited
  checkpoint contradicting a currently identified running native action
  is reported as `recovery_required`, not a healthy heartbeat or safe
  dispatch state. No elapsed-time or heartbeat-based auto-unlock exists.
- The read-only `native_worker_status` IPC now combines live Rust process
  attribution, the existing recovery checkpoint and the latest durable job.
  A mismatched or interrupted running journal is reported as
  `recovery_required`. The UI never treats the supervisor tick as a
  tool-progress heartbeat. A successful audit is still not proof of overall
  video editing completion or acceptance.
- **Still missing:** explicit owner-reviewed reconciliation of uncertain
  worker journals, restart-resumable multi-job scheduling, independent AI
  models per worker, autonomous parallel planning, live application
  heartbeats, and full Premiere/Blender/AE host acceptance.

## Not implemented or verified

- No complete autonomous multi-process worker dispatcher or independent AI models per worker yet. The native master still owns model calls, and one native tool executes at a time.
- The `blender_inspect` path remains **read-only**. A separate, approved bounded `blender_run_plan` now supports catalogued mutations and new verified outputs in one background session, but host acceptance, persistent Blender sessions, unrestricted tool coverage and Premiere import remain pending.
- A few Premiere/After Effects/Remotion tool families exist, but a complete cinematic editing workflow is not certified; actual application runtime acceptance needs an accessible Windows server and user-provided disposable sample projects.
- Internet asset lookup does not imply download rights or local availability.
- Work on this branch is **not** a Vercel deployment, production merge, signed installer, or AntCloud installation.

## Next controlled stages

1. Make Windows CI pass including Python bridge source checks and Rust native build.
2. Add a persistent, authorization-aware Blender session supervisor and typed mutation APIs that reuse the separate package's request/controller contracts, preserving object revision checks and readback.
3. Add evidence-bound artifact manifests and safe Premiere media import handoffs. Test on disposable projects, preserving backups.
4. Connect a durable worker-job scheduler to the mobile queue, with heartbeat, local project/resource locks, bounded retries only for known-safe reads, and explicit resume after uncertainty.
5. Add separate AI model allocation and bounded parallel planning, while serializing access to a shared desktop UI.

## Safety criteria

Never mark a graphics task or full edit complete based solely on an AI claim, a plan, a response path, a queued export, a claimed worker count, or an unaudited result. A failed/unknown Blender operation must be inspected rather than blindly replayed. This document describes source implementation, not live acceptance.
