# Adobe Audition status

- Current transport: Shuvi -> authenticated localhost bridge -> Audition CEP panel -> ExtendScript host adapter.
- Adobe's current Audition documentation still exposes CEP extensions and ExtendScript communication; Shuvi therefore does not pretend Audition has the same UXP host API surface as Premiere.
- Source runtime verification: **not verified**.
- Production ready: **false**.

## Implemented source scope

- Windows Program Files detection for Adobe Audition.
- Managed Audition launch from the newest detected standard installation.
- Dedicated authenticated loopback bridge on 127.0.0.1:17362 with bounded payloads, expiring pairing token, replay rejection and queued-result correlation.
- CEP panel manifest for host AUDT.
- ExtendScript context inspection for active document type and WaveDocument sample-rate/duration/playhead.
- Bounded live application command inventory discovered from Application.reflect.properties where property names begin with COMMAND_.
- Exact command-enabled probe using the live Application property/value pair.
- Active-document signatures are returned by context inspection; playhead changes and generic command invocation require the same inspected signature so a stale document is rejected.
- Exact generic command invocation using app.isCommandEnabled then app.invokeCommand.
- Generic command invocation remains accepted-unverified, high-risk and non-retry-safe.
- WaveDocument playhead movement by normalized percent with native playhead sample readback.
- Separate readiness report that keeps source coding, host runtime evidence and production readiness distinct.
- Read-only live runtime probe that checks bridge connectivity, document context, command inventory, WaveDocument dictionary visibility and discovery counts for the main audio feature groups without editing audio.
- Generic command receipts now retain bounded before/after document context while still refusing to call semantic audio changes verified.
- Disposable acceptance registration is implemented for future real-host mutation testing. It stores the exact Audition version, document type/name and guarded document signature only after explicit disposable authorization.
- Acceptance status and plan are read-only. The plan explicitly keeps destructive execution, semantic result verification and recovery verification unimplemented until a safe real-host path exists.

## Intentional safety limits

- A command cannot be invoked by the CEP panel until the current pairing has listed the live command inventory and cached the exact property/value pair.
- A live Application[property] value mismatch blocks the command.
- A changed Audition document signature blocks guarded mutations.
- Disabled commands are not invoked.
- The generic command route does not claim the command's side effect was verified.
- Feature-command acceptance still does not prove that noise reduction, EQ, compression, loudness or any other semantic audio result occurred; it remains accepted-unverified until real host/output evidence exists.
- No blind retry is allowed after generic or feature-command acceptance.
- No direct effect-parameter API is claimed yet.
- Noise reduction, EQ/compressor parameter writes, diagnostics repair, Favorites execution semantics and multitrack mix writes are not yet source-complete.
- No saved/output audio is considered valid only because a host command returned.
- The runtime probe does not edit audio and cannot by itself promote edit runtime verification or production readiness.
- Real Audition mutation tests remain separate from source/model and read-only runtime-probe tests.

## Next source phase

1. Pair a compatible Audition host and run audition_runtime_probe plus feature discovery.
2. Register only a throwaway test document with audition_acceptance_register_disposable and confirm audition_acceptance_status still matches the exact host/document.
3. Review the live Script Dictionary and ranked command candidates, then add safe typed operations only for methods actually observed there.
4. Add checkpoint/output validation before any destructive acceptance execution is implemented.
5. Run a disposable real-host acceptance suite before setting runtime_verified or production_ready.
