# Adobe Media Encoder status

- Current source transport: Shuvi -> paired Premiere UXP -> Premiere EncoderManager -> Adobe Media Encoder.
- Source runtime verification: **not verified**.
- Production ready: **false**.
- Existing Premiere sequence export can already queue to AME with exact project/sequence guards and durable uncertain-export state.
- Added bounded AME capability inspection: installed state plus feature availability.
- Added documented launch control when Premiere exposes EncoderManager.launchEncoder (26.3+).
- Added documented batch-start control when Premiere exposes EncoderManager.startBatchEncode (26.3+).
- Added embedded/sidecar XMP setters when the 26.3+ APIs are exposed.
- Added bounded in-plugin event journal for queue, progress, complete, error and cancel events.
- Event rows retain only bounded job ID/progress/error/output-file fields.
- Event evidence is observational and is **not** treated as exact Shuvi-export correlation.
- Batch start is high risk and not blindly retry-safe.
- Host acceptance never implies completed encoding or valid/playable media.
- Direct Media Encoder UXP is not the production transport yet; Adobe documents that surface as public beta with Media Encoder 27.0+.
- No heavy Adobe install/update is performed by source code.
- Next source priorities: safe .epr extension/preset inspection, typed standalone-file/project-item encoding, stronger exact job ownership correlation, and real Windows/Premiere/AME acceptance testing.
