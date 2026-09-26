# Premiere professional interchange and native frame delivery (AE)

Module AE adds real sequence handoff formats and native still-frame delivery using the current stable Premiere UXP APIs.

## Interchange exports

Shuvi exposes:

- `premiere_plan_interchange_export`
- `premiere_export_fcpxml`
- `premiere_export_otio`
- `premiere_export_aaf`

The implementation uses Adobe's stable `ProjectConverter` APIs:

- `exportAsFinalCutProXML` (Premiere 26.2+)
- `exportAsOpenTimelineIO` (Premiere 26.2+)
- `exportAAF` (Premiere 26.3+)

All exports require an active project/sequence expectation with no clip targets. Output must be an absolute file path whose parent directory already exists. Existing output is blocked by default; overwrite must be explicit.

### AAF

AAF requires explicit typed options. Shuvi maps only the documented stable fields through `AAFExportOptions` setters:

- AIFF/WAV via `Constants.AAFExportAudioFormat`
- bits per sample
- embed audio
- explode to mono
- handle frames
- interleave without effects
- mixdown video
- preserve parent folder
- render audio effects
- sample rate
- trim sources
- optional video mixdown preset path

The optional video mixdown preset must be an existing absolute file.

Shuvi does not claim that an AAF/FCPXML/OTIO file is perfectly compatible with every downstream NLE. Native acceptance and local file observation are reported separately.

## Native frame export

`premiere_export_frame` uses Adobe's stable `Exporter.exportSequenceFrame` API (Premiere 25.6+). There is no screenshot fallback.

Supported file suffixes match the documented stable list:

- bmp
- dpx
- gif
- jpg
- exr
- png
- tga
- tif

The caller supplies exact sequence seconds, width, height and absolute output file.

`premiere_export_review_frames` exports 1–16 exact timestamps as a bounded package. It preserves one project/sequence expectation for the batch, supports cooperative cancellation between frames and stops on uncertain transport. Each frame returns its native result and observed file metadata.

## Result semantics

A successful host boolean is kept separate from file observation:

- `accepted` — Premiere returned true.
- `file_observed` — the desktop can see an output file at the requested path.
- `completion_verified` — for ProjectConverter outputs, both acceptance and file observation succeeded.

This proves that a file was produced at that path; it does not guarantee semantic fidelity in another NLE.

No mutating delivery operation is marked retry-safe after uncertain result delivery.
