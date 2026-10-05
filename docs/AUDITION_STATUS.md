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

## Intentional safety limits

- A command cannot be invoked by the CEP panel until the current pairing has listed the live command inventory and cached the exact property/value pair.
- A live Application[property] value mismatch blocks the command.
- A changed Audition document signature blocks guarded mutations.
- Disabled commands are not invoked.
- The generic command route does not claim the command's side effect was verified.
- No blind retry is allowed after generic command acceptance.
- No direct effect-parameter API is claimed yet.
- Noise reduction, EQ/compressor parameter writes, diagnostics repair, Favorites execution semantics and multitrack mix writes are not yet source-complete.
- No saved/output audio is considered valid only because a host command returned.
- Real Audition runtime tests remain separate from source/model tests.

## Next source phase

1. Run the implemented Script Dictionary inspection on a compatible Audition host and capture the real current WaveDocument/Multitrack/effect objects and methods.
2. Review those live results, then add safe typed operations only for methods actually observed there.
3. Prefer specific typed cleanup/favorite/export actions over generic command invocation.
4. Add checkpoint/output validation where a mutation can change or overwrite audio.
5. Run a disposable real-host acceptance suite before setting runtime_verified or production_ready.
