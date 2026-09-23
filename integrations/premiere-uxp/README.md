# Shuvi Premiere Bridge

Native command bridge for Shuvi's professional Adobe Premiere Pro integration.

Current scope:
- UXP manifest v5
- Premiere Pro 25.6+ host target
- dockable Shuvi panel
- read-only active project / active sequence inspection
- permission-gated timeline, project, effects, audio, graphics and export operations

Architecture:
1. Shuvi desktop agent remains the permission/risk/audit authority.
2. The UXP plugin performs Premiere-native project/timeline operations.
3. Typed commands cover imports, bins, sequence edits, effects, captions, audio and export; unsupported operations must fail explicitly.
4. Before destructive or large timeline changes, Shuvi will create a version/checkpoint and ask for permission where appropriate.

During development, load this folder with Adobe UXP Developer Tool while Premiere Pro developer mode is enabled.


## Current native command bridge

Implemented typed bridge commands:
- inspect active project / active sequence
- inspect video/audio tracks and clip timing
- list root project items
- create root bins using Premiere undoable transactions
- import media
- create a sequence from media
- insert or overwrite media at an exact sequence time/track
- save the active project

Shuvi's desktop agent creates a timestamped sibling `Shuvi Backups` copy of the current `.prproj` before major sequence creation and insert/overwrite edits when a normal project file path is available.

- trim exact video/audio clips by track + timeline clip index
- move clips on the same track by a signed time delta

- delete or ripple-delete exact clips by deterministic track/clip index
- export the active sequence immediately or queue it to Adobe Media Encoder, with an optional export preset

- discover installed video transitions and effects by Adobe match name
- inspect a video clip's effect/component chain and parameter indexes
- add video effects and transitions through Premiere transactions
- set non-time-varying effect parameters
- enable time-varying parameters and add effect keyframes

- discover and add native audio effects by Premiere display name
- inspect audio effect chains, change static parameters, and add keyframes
- list/add/remove sequence markers for edit planning, review notes and beat/scene cues

- inspect the recursive project tree with stable ids, media/offline/proxy state
- rename and move project items between bins
- relink clip media and attach proxies with desktop-side backup protection
- insert Motion Graphics templates from .mogrt paths or Creative Cloud Libraries

- set video/audio effect parameters by exact component + parameter names
- keyframe video/audio parameters by exact native names
- apply atomic named video/audio parameter recipes for grading, transform and mix workflows
- perform adjacent-clip rolling edits with project backup protection
- inspect an exact Premiere playhead frame through Shuvi's selected vision provider

- save/list/delete reusable local video or audio parameter recipes and apply them to one or many clips
- batch relink offline media and batch attach proxies with per-item results
- review up to eight Premiere frames with Shuvi vision at explicit playhead timestamps
- set/clear source in/out points and create Premiere 26.3+ subclips
- transcribe clip project items and read a bounded transcript JSON preview

- list supported transcription languages and import transcript JSON
- discover caption tracks, rename tracks (26.3+ API guarded), and set track mute
- create a subsequence from explicit video/audio clip targets while restoring selection
- insert/overwrite a project item, including a sequence project item
- clone clips with native time and track offsets

## Verification

Run npm run validate, npm test and npm run build from the repository root. Validation syntax-parses this panel and checks its routes against desktop requests. Tests use source fixtures/mocks; they do not prove Adobe runtime compatibility. Full disposable-project Premiere verification is pending. The Rust toolchain was unavailable locally during the 2026-09-23 continuation; see Windows CI for cargo check.
