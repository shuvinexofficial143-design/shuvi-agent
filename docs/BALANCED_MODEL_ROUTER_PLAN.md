# Shuvi Balanced AI Mode — Model Router Implementation Plan
**Decision date:** 2026-10-08  
**Decision:** Balanced is the *approved default policy* for the next Shuvi multi-agent router.  
**State:** Architecture/role plan only. This document does **not** mean the multi-model router, parallel workers, Vercel remote control, or Telegram live pairing is deployed or working. Windows/AntCloud verification is pending.

## 1. Goal
Use a low-cost, low-latency model for routine requests; invoke strong reasoning or multimodal models only when the task and quality requirement justify the cost. A Shuvi **Master Router** owns task planning, worker handoff, cost controls and evidence review; the existing Rust **typed-tool / approval gate** always controls real Windows actions.

There are **11 logical roles (1 Master + 10 Specialists)**. A role is a configuration/queue destination, **not** necessarily a dedicated process, API subscription or continuously running model. Workers share adapters and may run sequentially under device constraints.

## 2. Planned role assignments
The names below are model *preferences*, not verified API model IDs or pricing claims. Resolve provider, model ID, capabilities and price from the authenticated provider on the Windows host. Never silently substitute a model that lacks the required modality/tool support.

| Role ID | Role | Preferred model family | Fallback preference | Responsibility |
|---|---|---|---|---|
| master | Master Router | SOL 6.1 | Claude Opus | Decompose hard tasks, dependencies, arbitration, verify completion evidence |
| launcher | PC Controller | Gemini Flash | DeepSeek Chat | Small app/window/file actions through typed tools |
| coding | Coding Engineer | Claude Sonnet | SOL 6.1 | Inspection → code change → test → review; no blind push |
| video | Premiere Editor | Claude Opus for complex editorial decisions; cheaper model for routine planning | Claude Sonnet | Edit plan, captions, media layout, export checks; actual Premiere mutations via native bridge |
| motion | Motion Graphics / AE | Claude Opus | SOL 6.1 | Animation/VFX planning and verified Adobe workflows |
| blender | Blender 3D Specialist | SOL 6.1 | Claude Opus | Scene/object plans, modeling steps, materials/animation; actual Blender controls permission-gated |
| vision | Vision Analyst | Gemini Pro multimodal | Any *verified* vision-capable model | Screenshot/video/reference review; approved frames only |
| image | Image Creator | Supported Google Gemini image model | Verified image model | Generate/mask media assets only when image endpoint works and costs are permitted |
| video_gen | Video Generator | Supported Veo endpoint | Verified video model | Generate requested B-roll/video clips only when enabled and budget approved |
| project | Project Manager | Gemini Flash | Claude Sonnet | Folder/project setup, asset inventory, project preparation |
| reviewer | Quality Reviewer | Claude Sonnet | Claude Opus | Independently check exports, tests, evidence, deliverable quality |

*Provider inventory found in current native Rust code:* `deepseek`, `openai`, `gemini`, `anthropic`, `openrouter`, `ollama`, `custom` (OpenAI-compatible). xKiro is **not** a separate registered native adapter in the inspected `ui-dashboard` source; check whether its actual endpoint is compatible with `custom` before mapping it. Do not invent xKiro-specific model IDs, SOL 6.1 endpoints, Gemini image IDs, Veo access, cost rates or free-credit entitlements.

*Existing web role planner:* exactly **8** browser-local roles (`master`, `launcher`, `project`, `coding`, `video`, `image`, `video_gen`, `blender`). Add `motion`, `vision`, `reviewer` later with a non-destructive settings migration and an explicit **planning-only** label until native sync works.

## 3. Balanced routing rules
1. **Preflight classifier:** Determine intent, modality, supported tools, risk, needed output quality, and budget. Prefer a fast/inexpensive model for this brief classification; deterministic keywords/safety constraints can bypass an AI call.
2. **Tier F — fast:** Launch app, browse/inspect, look up files, make folder plans, light summaries: Flash/DeepSeek where available, subject to their real capabilities.
3. **Tier B — balanced:** Code edits, ordinary video plans, structured projects, standard review: Sonnet-class model if basic tier is inadequate.
4. **Tier H — heavy:** Complicated Premiere/After Effects/Blender reasoning, critical architecture, tricky debugging: SOL 6.1 or Opus-class preference when actually available and price-allowed. Heavy model is **not** the default for every command.
5. **Modality gate:** Vision request → vision-capable model; image request → image endpoint; video generation → video endpoint. A text-only fallback must never be presented as a generated image/video.
6. **Escalation:** Upgrade only for a demonstrable gap, failed verified review, or an explicitly high-quality request. No automatic upgrade loops; log a reason.
7. **Fallback:** On unavailable/rate-limited provider, reselect a compatible alternative once according to policy. Timeout/ambiguous generation is not permission to duplicate a mutating tool action. A semantic or tool error requires inspection/replan, not blind retry.
8. **Master oversight:** Assign stable task IDs, dependency IDs, role IDs, acceptance criteria, actual audit/evidence links and user approval requirements. Mark a worker's state `completed` only after the real result is observed and checked; text claims never count as evidence.

## 4. Budget / cost policy
- Do **not** assume a flat monthly budget, free plan, xKiro token-to-dollar conversion, or Google Cloud $300 credit applies to any given model; prices must be resolved and configuration agreed.
- Maintain **user-configurable** per-task and per-day **spending caps** in the native app; warn at **80%** usage and stop *new* model invocations at **100%**, unless the user explicitly raises the cap.
- Show estimated cost **before** expensive image/video generation; if provider pricing is unknown, require explicit approval instead of treating it as free.
- Accumulate actual input/output token usage and provider-specific units where reported, with separate fields for estimated and verified spend. Do not show invented numbers.
- Cache safe task classifications and reusable media plans when appropriate; never cache API keys or confidential full prompts into the public browser.

## 5. Concurrency and safety
- Phase 1: one active native **computer UI controller / mouse/keyboard owner**. Shared desktop input is serialized under a single exclusive resource lock.
- Phase 1: maximum **two parallel inference/planning worker requests** after live verification, with queue/backpressure; heavy rendering runs in a bounded separate job slot only when RAM/GPU capacity permits.
- File/project mutations require canonical path/workspace resource locks, exact IDs, conflict checks and checkpoints. No simultaneous writers to one `.prproj` / `.blend` / repository without coordinated locking.
- Existing hard **4 GiB** Shuvi-managed RAM guard stays authoritative. Provider server-side work does not make Windows local RAM infinite.
- Existing desktop source permits **one typed tool proposal at a time** and a maximum **8 orchestration actions**. Multi-worker queues are a future layer to design/test around these constraints; do not claim this plan already enables concurrent native tool execution.
- Telegram, Windows Desktop and any future web portal eventually share **one command router and one permission gate**. Vercel is currently a browser-local planning UI and **cannot** remotely execute Windows tasks.
- Permissions remain action-scoped; high-risk actions (shell writes, destructive changes, Git push, security/account changes) always use native policy. Telegram approval must match the exact live action code; never grant a global allow-all.

## 6. Native architecture to implement
`Input (Desktop/Telegram) → Task Classifier → Policy + Capability/Price Registry → Master Plan → Durable Queue → Role Dispatcher → Provider Adapter → Verified Result → Rust prepare_tool/approval → Native Executor → Evidence/Review → Task State`

Separate identities:
- **Model registry:** provider ID, API model ID, modality/features, verified availability, last health-check time, context limits, price metadata and compatible fallback.
- **Role assignment:** role ID, primary model ref, fallback refs, task tier, concurrency cap; never save secrets here.
- **Task record:** stable ID, user goal, stage, worker owner, dependency IDs, resource locks, risk, budget limit, checkpoint, timeout, audit receipt/evidence and cancellation.
- **Shared permission boundary:** Only actual Rust native tool execution can perform host actions. A model response cannot authorize its own execution.
- **UI:** roles, source of truth, queue, running/waiting/blocked/completed, estimated/actual usage, errors, approve/deny/cancel, and a truthful offline state. Sync between Vercel and Windows requires a separate authenticated relay design and security review.

## 7. Tomorrow's Windows acceptance sequence (ordered)
1. Bring AntCloud online, verify checked-out GitHub branch and protect current local projects/unsaved creative work.
2. Verify available xKiro/OpenRouter/custom/Gemini/Claude provider connections, **real model IDs**, authenticated health tests, modality and per-unit cost. No assumptions.
3. Keep native Telegram PR separate until it compiles and passes actual paired private-chat and current-action approval tests.
4. Implement **read-only** role/capability registry and routing dry-run first. Test that simple launch routes to cheap model, coding to Sonnet-class, Blender/VFX to eligible heavy model, image/video to correct modality endpoints.
5. Add price guardrails and audit (80% warning, 100% pause), fallback policy, explicit expensive-media approval and provider-failure simulations.
6. Integrate Master → Specialist dispatch with the **existing typed-tool** policy, queue, action IDs, cancellation and resource locking. Start with serialized Windows actions; do not exceed 8-step native action budget unreviewed.
7. Execute minimal safe native tests: app status read, folder inspect, simple dry-run code plan, read-only Premiere/Blender scene inspect; verify no mutation without permission.
8. Gradually add real parallel *model planning* (max two) and independent reviewer evidence checks. Validate memory ceiling, UI lock contention, crash/restart and stale Telegram approval.
9. Only after that, update 8-role browser planner to 11-role representation with non-destructive migration. Do not imply browser-local preferences control Windows until an authenticated sync exists.
10. Finish with a measured pass/fail report and observed costs/latencies; keep production actions and web remote control disabled until acceptance succeeds.

## 8. Acceptance matrix
| Scenario | Expected result |
|---|---|
| "Open Premiere" | cheap eligible worker suggests a typed launch; native approval applies; only one UI owner |
| "Build complex AE 3D animation" | heavy reasoning role selected within budget, then reviewed host command path; no fake completion |
| "Generate 10 B-roll clips" | video endpoint and estimated cost checked, user confirms expensive generation, only genuinely created clips marked completed |
| "Modify code in repo" | inspect, permission-gated edit, tests and diff before any authorized push |
| Offline AntCloud / invalid model ID | unavailable state; queued/blocked without invented execution |
| Provider HTTP 429 | bounded compatible fallback, reason logged; no duplicate native mutation |
| Concurrent Blender + Premiere UI tasks | serialization on desktop lock; independent provider planning may overlap |
| Telegram stale / wrong action code | denied, no tool executed |
| User budget limit reached | no new paid calls unless user explicitly changes cap |
| Browser refresh | browser plan survives locally; native task truth is never fabricated from cached UI values |

## 9. Delivery scope
**Already in source:** single-provider typed agent loop, provider adapters, local approval/audit/checkpoints, browser-only 8-role model-assignment planner and Telegram native feature PR under review.

**Not yet implemented/verified:** a functioning 11-role multi-model router, provider pricing discovery, shared worker scheduler, independent parallel worker execution, web↔native authenticated remote relay, verified SOL 6.1/xKiro/Veo availability, and end-to-end Telegram live control.

**No code execution, provider calls, credential writes, Vercel release or server changes are authorized by this planning document.** All new runtime actions require explicit live acceptance and the existing Shuvi permission system.
