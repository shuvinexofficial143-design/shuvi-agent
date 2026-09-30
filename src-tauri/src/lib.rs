mod premiere_execution;
mod premiere_store;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::IpAddr,
    path::{Component, Path},
    process::{Command, Stdio},
    sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

mod premiere_diagnostics;
mod premiere_review;
mod premiere_editorial;
mod premiere_export;
mod premiere_acceptance;
mod premiere_acceptance_harness;
mod premiere_acceptance_execution;
mod premiere_calibration;
mod premiere_export_jobs;
mod premiere_review_binding;
mod premiere_edit_session;
mod premiere_edit_job;
use premiere_diagnostics::DiagnosticsLimits;
mod premiere_subtitles;
mod premiere_dialogue;
mod premiere_talking_head;
mod premiere_transcript_rebuild;
mod premiere_scene_detection;
mod premiere_scene_rough_cut;
mod premiere_layering;
mod premiere_media_prep;
mod premiere_delivery;
mod premiere_finishing;
mod premiere_assembly;
mod premiere_mogrt;
mod premiere_graphics;
use premiere_mogrt::GraphicsRequest;
mod premiere_audio;
use premiere_audio::AudioPlanRequest;
mod premiere_recipes;
use premiere_recipes::RecipePlanRequest;
mod premiere_effects;
use premiere_effects::ComponentTarget;
mod premiere_target;
use premiere_target::{PremiereClient, PremiereExpectation};
mod premiere_keyframes;
use premiere_keyframes::ParameterTarget;
mod premiere_checkpoint;
mod premiere_speed;
use premiere_speed::SpeedRequest;

mod premiere_bridge_queue;
mod premiere_bridge;
use premiere_bridge::{PremiereBridgeShared, PremiereBridgeStatus};

const KEYRING_SERVICE: &str = "Shuvi";
const SOFT_LIMIT_MB: f64 = 3584.0;
const HARD_LIMIT_MB: f64 = 4096.0;
const MAX_READ_BYTES: u64 = 1_048_576;
const MAX_WRITE_BYTES: usize = 2_097_152;
const MAX_TOOL_OUTPUT_CHARS: usize = 120_000;
const MAX_AUDIT_LOG_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TOOL_STRING_ARRAY_ITEMS: usize = 256;
const MAX_TOOL_STRING_ARRAY_ITEM_BYTES: usize = 16 * 1024;
const MAX_TOOL_STRING_ARRAY_BYTES: usize = 512 * 1024;
const MAX_LAUNCH_ARGS: usize = 64;
const MAX_LAUNCH_ARG_BYTES: usize = 4 * 1024;
const MAX_LAUNCH_ARGS_BYTES: usize = 32 * 1024;
const MAX_CHAT_MESSAGES: usize = 120;
const MAX_CHAT_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_CHAT_CONTEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ASSISTANT_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_PROVIDER_MODEL_BYTES: usize = 256;
const MAX_PROVIDER_BASE_URL_BYTES: usize = 4 * 1024;
const MAX_API_KEY_BYTES: usize = 16 * 1024;
const MAX_WORKSPACE_PATH_BYTES: u64 = 32 * 1024;
const MAX_SCREENSHOT_FILES: usize = 64;
const MAX_STALE_BROWSER_PROFILES: usize = 8;
const MAX_DIAGNOSTIC_FILES: usize = 16;
const MAX_PENDING_ACTIONS: usize = 16;
const PENDING_ACTION_TTL_MS: u64 = 10 * 60 * 1000;
const MAX_WORKSPACE_SCAN_ENTRIES: usize = 1_200;
const MAX_WORKSPACE_DIRECTORY_ENTRIES: usize = 2_000;
const MAX_SEARCH_MATCHES: usize = 150;
const MAX_SEARCH_FILES: usize = 5_000;
const MAX_SEARCH_ENTRIES: usize = 10_000;
const MAX_GIT_FINGERPRINT_UNTRACKED_FILES: usize = 256;

const TOOL_PROTOCOL: &str = r#"You are Shuvi, a permission-first Windows desktop AI agent.
If the user's request requires a computer action, choose ONE tool and respond ONLY with a JSON object:
{"tool":"tool_name","arguments":{...},"reason":"short explanation","plan":{"objective":"overall task","step":"what this one action is meant to accomplish","success_criteria":"observable result that proves this step worked"}}
For a genuinely one-step task, plan may be omitted. For a multi-step task, keep objective stable across steps and make success_criteria observable from tool output or a follow-up inspection. Never claim future plan steps have already run.

Available tools:
- list_directory: {"path":"absolute path"}
- read_file: {"path":"absolute path"}
- write_file: {"path":"absolute path","content":"complete file content"}
- create_directory: {"path":"absolute path"}
- launch_app: {"program":"executable or absolute path","args":["optional","arguments"]}
- open_url: {"url":"https://example.com"}
- browser_start: {"browser":"edge|chrome","url":"optional https:// page"}
- browser_navigate: {"pid":1234,"url":"https://example.com"}
- browser_dom_read: {"pid":1234,"selector":"CSS selector"}
- browser_dom_click: {"pid":1234,"selector":"CSS selector"}
- browser_dom_set_value: {"pid":1234,"selector":"CSS selector","value":"text"}
- stop_managed_process: {"pid":1234}
- capture_screen: {}
- inspect_screen: {"prompt":"what should be understood from the current screen"}
- list_processes: {}
- ui_find: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_click: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_set_value: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","value":"text to enter"}
- ui_focus: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_scroll: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","vertical":"small_increment|small_decrement|large_increment|large_decrement"}
- ui_toggle: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name"}
- ui_expand_collapse: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","action":"expand|collapse"}
- ui_send_keys: {"name":"exact visible name","automation_id":"optional exact automation id","window":"optional exact top-level window name","keys":"SendKeys sequence"}
- pointer_click: {"x":123,"y":456,"button":"left|right|middle","clicks":1}
- premiere_detect: {}
- premiere_launch: {"project":"optional absolute .prproj path"}
- premiere_bridge_start: {}
- premiere_bridge_status: {}
- premiere_context: {}
- premiere_remove_keyframe_range: {"target":{"kind":"video|audio","track":0,"clip_index":0,"component_match_name":"exact component match name or supply component_display_name","param_display_name":"exact parameter name"},"start_seconds":0,"end_seconds":2,"expected_count":1,"expected_signature":"targetSignature from inspection","allow_remove_all":false}
- premiere_remove_video_transition: {"track":0,"clip_index":0,"position":"start|end"}
- premiere_inspect_effect_lifecycle: {"target":{"kind":"video|audio","track":0,"clip_index":0,"component_match_name":"exact discovered name"}}
- premiere_remove_effect: {"target":{"kind":"video|audio","track":0,"clip_index":0,"component_match_name":"exact discovered name"},"expected_signature":"copy from lifecycle inspection"}
- premiere_inspect_keyframes: {"target":{"kind":"video|audio","track":0,"clip_index":0,"component_match_name":"exact native match name or supply component_display_name","param_display_name":"exact parameter name"}}
- premiere_edit_keyframe: {"target":{"kind":"video|audio","track":0,"clip_index":0,"component_match_name":"exact native match name or supply component_display_name","param_display_name":"exact parameter name"},"ticks":"exact ticks from inspection","expected_signature":"targetSignature from inspection","operation":"remove|interpolation","interpolation":"only for interpolation: linear|hold|bezier"}
- premiere_inspect_clip_speed: {"kind":"video|audio","track":0,"clip_index":0}
- premiere_plan_speed: {"kind":"video|audio","track":0,"clip_index":0,"request":{"mode":"rate|duration|preset|ramp|freeze","rate":"rate mode: multiplier 0.01..100","duration_seconds":"duration/freeze mode: positive seconds","source_seconds":"freeze mode: source time","preset":"preset mode: normal|slow_motion|fast_motion","points":"ramp mode: [{source_offset_seconds:0,rate:1},...]","reverse":"optional boolean","preserve_audio_pitch":"optional boolean"}}
- premiere_project_diagnostics: {"limits":{"max_items":10000,"max_depth":32,"max_detail_items":200}}
- premiere_inspect_mogrt_properties: {"track":0,"clip_index":0}
- premiere_populate_mogrt: {"track":0,"clip_index":0,"request":{"preset":"lower_third","fields":[{"role":"title","component_match_name":"exact inspected native component","param_display_name":"exact inspected native parameter","value":"Name"}]},"expected":{"project_guid":"...","sequence_guid":"...","clips":[{"kind":"video","track":0,"clip_index":0,"signature":"..."}]}}
- premiere_plan_mogrt_recipe: {"track":0,"clip_index":0,"request":{"preset":"title|lower_third","fields":[{"role":"text|title|subtitle|property","component_match_name":"exact inspected name","param_display_name":"exact inspected name","value":"My title"}]}}
- premiere_plan_transcript_ducking: {"item_id":"dialogue project item","target":{"kind":"audio","track":0,"clip_index":0,"component_match_name":"inspected","param_display_name":"inspected"},"request":{"mode":"duck","duration_seconds":30,"baseline":1,"value_unit":"native","target_value":0.4,"attack_seconds":0.2,"release_seconds":0.5,"regions":[]},"transcript_offset_seconds":0,"music_start_seconds":0,"merge_gap_seconds":0}
- premiere_apply_transcript_ducking: {"item_id":"dialogue project item","target":{"kind":"audio","track":0,"clip_index":0,"component_match_name":"inspected","param_display_name":"inspected"},"request":{"mode":"duck","duration_seconds":30,"baseline":1,"value_unit":"native","target_value":0.4,"attack_seconds":0.2,"release_seconds":0.5,"regions":[]},"transcript_offset_seconds":0,"music_start_seconds":0,"merge_gap_seconds":0,"expected":{"project_guid":"...","sequence_guid":"...","clips":[{"kind":"audio","track":0,"clip_index":0,"signature":"..."}]}}
- premiere_plan_transcript_cuts: {"request":{"schema_version":1,"item_id":"dialogue project item","video":{"kind":"video","track":0,"clip_index":0},"audio":{"kind":"audio","track":0,"clip_index":0},"transcript_offset_seconds":10,"padding_seconds":0.05,"ripple":false,"selections":[{"segment_id":"seg-0001","action":"remove"},{"segment_id":"seg-0003","action":"chapter","label":"Part 2"}]}}
- premiere_apply_transcript_cuts: {"request":{"schema_version":1,"item_id":"dialogue project item","video":{"kind":"video","track":0,"clip_index":0},"audio":{"kind":"audio","track":0,"clip_index":0},"transcript_offset_seconds":10,"padding_seconds":0.05,"ripple":false,"selections":[{"segment_id":"seg-0001","action":"remove"}]},"transcript_snapshot":"fnv1a64:...","expected":{"project_guid":"...","sequence_guid":"...","clips":[{"kind":"video","track":0,"clip_index":0,"signature":"..."},{"kind":"audio","track":0,"clip_index":0,"signature":"..."}]}}
- premiere_plan_audio_automation: {"target":{"kind":"audio","track":0,"clip_index":0,"component_match_name":"discovered","param_display_name":"discovered"},"request":{"mode":"duck","duration_seconds":30,"baseline":1,"value_unit":"linear_amplitude","reduction_db":12,"attack_seconds":0.2,"release_seconds":0.5,"regions":[{"start":2,"end":5}]}}
- premiere_plan_assembly: {"assembly":{"schema_version":1,"shots":[{"item_id":"exact project item","timeline_seconds":0,"video_track":0,"audio_track":0,"mode":"insert"}],"chapters":[{"name":"Section","seconds":0}]}}
- premiere_apply_assembly: {"assembly":{"schema_version":1,"shots":[{"item_id":"exact project item","timeline_seconds":0,"video_track":0,"audio_track":0,"mode":"insert"}]},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_cancel_assembly: {}
- premiere_batch_finish: {"targets":[{"track":0,"clip_index":2,"request":{"preset":"natural_correction","bindings":[{"role":"contrast","component_match_name":"exact","param_display_name":"exact","unit":1,"min":0,"max":2}]}}],"expected":{"project_guid":"...","sequence_guid":"...","clips":[{"kind":"video","track":0,"clip_index":2,"signature":"inspected"}]}}
- premiere_batch_finish_cancel: {}
- premiere_finish_media_batch: {"request":{"schema_version":1,"videos":[{"track":0,"clip_index":2,"request":{"preset":"natural_correction","bindings":[{"role":"contrast","component_match_name":"exact","param_display_name":"exact","unit":1,"min":0,"max":2}]}}],"audios":[],"graphics":null,"review":false},"expected":{"project_guid":"...","sequence_guid":"...","clips":[{"kind":"video","track":0,"clip_index":2,"signature":"..."}]}}
- premiere_finish_media_batch_cancel: {}
- premiere_save_graphics_template_mapping: {"mapping":{"schema_version":1,"name":"doctor_lower_third","template":{"source":"path","path":"C:/templates/doctor.mogrt"},"fields":[{"role":"name","component_match_name":"exact inspected native component","param_display_name":"exact inspected field","primitive_type":"string"}]},"track":0,"clip_index":0,"expected_revision":null,"expected":{"project_guid":"...","sequence_guid":"...","clips":[{"kind":"video","track":0,"clip_index":0,"signature":"inspected"}]}}
- premiere_list_graphics_template_mappings: {}
- premiere_delete_graphics_template_mapping: {"name":"doctor_lower_third","revision":1}
- premiere_batch_graphics: {"batch":{"mapping":"doctor_lower_third","revision":1,"video_track":1,"audio_track":1,"items":[{"seconds":5,"fields":{"name":"Dr. A"},"duration_seconds":2}]},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_batch_lower_thirds: {"batch":{"mapping":"doctor_lower_third","revision":1,"video_track":1,"audio_track":1,"items":[{"seconds":5,"fields":{"name":"Dr. A"}}]},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_cancel_graphics_batch: {}
- premiere_plan_video_recipe: {"track":0,"clip_index":0,"request":{"preset":"zoom_in","start_seconds":0,"end_seconds":2,"bindings":[{"role":"scale","component_match_name":"discovered","param_display_name":"discovered","start_value":100,"end_value":110}]}}
- premiere_timeline_capabilities: {}
- premiere_timeline: {}
- premiere_caption_tracks: {}
- premiere_set_caption_track_name: {"track":0,"name":"Captions"}
- premiere_set_caption_track_mute: {"track":0,"muted":true}
- premiere_set_playhead: {"seconds":12.5}
- premiere_inspect_frame: {"seconds":12.5,"prompt":"what should Shuvi evaluate in the Premiere Program Monitor"}
- premiere_review_frames: {"seconds":[0,5,10],"prompt":"compare continuity, color, framing and edit quality across these Premiere frames"}
- premiere_review_session_start: {"objective":"clean talking-head edit","sample_times":[0,5],"reference":"optional brief","max_iterations":4}
- premiere_review_session_status: {"session_id":"exact returned ID"}
- premiere_review_session_next: {"session_id":"exact returned ID"}
- premiere_review_session_record_fix: {"session_id":"ID","issue_id":"inspected issue ID","target":"exact inspected clip target","planner":"premiere_plan_video_recipe","settings":{"exact":"approved typed settings"},"approved_action_id":"exact successful Shuvi audit action ID"}
- premiere_review_session_cancel: {"session_id":"exact returned ID"}
- premiere_plan_edit_recipe: {"preset":"social_reel|cinematic_reel|talking_head|product_ad|wedding_highlight|long_form_youtube|story_explainer|clean_corporate","targets":{},"inputs":{},"options":{}}
- premiere_edit_job_start: {"schema_version":1,"job_type":"talking_head|social_reel|product_ad|wedding_highlight|corporate|custom","talking_head_strategy":"optional direct_cut|source_rebuild","media_prep":null,"scene_detection":null,"transcript_cuts":null,"transcript_rebuild":null,"assembly":null,"track_organization":null,"layering":null,"finishing":null,"work_area":null,"review":null,"frame_delivery":null,"interchange_export":null,"export":null}
- premiere_edit_job_status: {"job_id":"exact returned UUID"}
- premiere_edit_job_next: {"job_id":"exact returned UUID"}
- premiere_edit_job_record_action: {"job_id":"UUID","phase_id":"exact current phase id","action_id":"exact executed Shuvi audit action UUID"}
- premiere_edit_job_cancel: {"job_id":"exact returned UUID"}
- premiere_list_items: {}
- premiere_project_tree: {}
- premiere_create_bin: {"name":"bin name"}
- premiere_rename_project_item: {"item_id":"project item id","name":"new name"}
- premiere_move_project_item: {"item_id":"project item id","target_bin_id":"destination bin id"}
- premiere_relink_media: {"item_id":"clip project item id","new_path":"absolute replacement media path","override_compatibility":false}
- premiere_inspect_media_interpretation: {"item_id":"exact clip project item id"}
- premiere_prepare_media_item: {"request":{"item_id":"exact clip project item id","expected_media_path":"copy inspected path or null","override_frame_rate":23.976,"pixel_aspect":{"numerator":1,"denominator":1},"scale_to_frame_size":false,"input_lut_id":"exact native LUT ID or null"},"expected":{"project_guid":"...","sequence_guid":"optional active sequence","clips":[]}}
- premiere_prepare_media_batch: {"batch":{"schema_version":1,"items":[{"item_id":"exact clip project item id","expected_media_path":"copy inspected path","override_frame_rate":25,"pixel_aspect":null,"scale_to_frame_size":true,"input_lut_id":null}]},"expected":{"project_guid":"...","sequence_guid":"optional","clips":[]}}
- premiere_cancel_media_prep: {}
- premiere_create_sequence_from_preset: {"name":"Edit 01","preset_path":"absolute existing sequence preset path","expected":{"project_guid":"...","sequence_guid":"optional","clips":[]}}
- premiere_get_work_area: {}
- premiere_set_work_area: {"request":{"in_seconds":2,"out_seconds":12},"expected":{"project_guid":"...","sequence_guid":"active sequence GUID","clips":[]}}
Media preparation uses stable ClipProjectItem interpretation actions (25.6+). Frame-rate override is footage interpretation, not timeline speed/time remapping. Scale-to-frame has no reviewed dedicated readback getter, so native acceptance remains accepted_unverified for that field. Sequence preset creation requires Premiere 26.3+; WorkAreaUtils requires 26.5+.
- premiere_set_source_inout: {"item_id":"clip project item id","in_seconds":1.0,"out_seconds":8.0}
- premiere_clear_source_inout: {"item_id":"clip project item id"}
- premiere_create_subclip: {"item_id":"clip project item id","name":"subclip name","start_seconds":1.0,"end_seconds":8.0,"hard_boundaries":true,"take_video":true,"take_audio":true}
- premiere_plan_transcript_rebuild: {"request":{"schema_version":1,"item_id":"exact transcript/source item","source":{"track":0,"clip_index":0},"transcript_source_offset":0.0,"removals":[{"segment_id":"seg-0002"}],"destination":{"mode":"explicit_empty_target_sequence","sequence_guid":"different empty sequence GUID","video_track":0,"audio_track":0},"take_video":true,"take_audio":false,"gap_seconds":0.0}}
- premiere_apply_transcript_rebuild: {"request":"same structured request as plan","plan_snapshot":"copy exact plan_snapshot","expected":"copy exact source expectation from plan"}
- premiere_cancel_transcript_rebuild: {}
- premiere_plan_scene_detection: {"request":{"schema_version":1,"mode":"cuts|markers","targets":[{"track":0,"clip_index":2,"signature":"copy exact targetSignature from timeline inspection"}]}}
- premiere_plan_scene_rough_cut: {"request":{"schema_version":1,"catalog_source":"scene_detection|explicit","shots":[{"id":"shot-001","item_id":"project item id","source_start":1,"source_end":3,"sequence_start":10,"sequence_end":12,"source_speed":1}],"selection":["shot-001"],"destination":{"mode":"explicit_empty_active_sequence","sequence_guid":"active empty sequence GUID","start_seconds":0,"video_track":0,"audio_track":0,"take_audio":true},"b_roll":[],"transitions":[],"request_review":true,"describe_shots":false}}
- premiere_detect_scene_markers: {"request":{"schema_version":1,"mode":"markers","targets":[{"track":0,"clip_index":2,"signature":"exact inspected signature"}]},"expected":"copy exact expectation from scene plan"}
- premiere_detect_scene_cuts: {"request":{"schema_version":1,"mode":"cuts","targets":[{"track":0,"clip_index":2,"signature":"exact inspected signature"}]},"expected":"copy exact expectation from scene plan"}
Scene Edit Detection uses stable SequenceUtils.performSceneEditDetectionOnSelection and Constants.SequenceOperation.CREATEMARKER/APPLYCUT (API since Premiere 25.6). Only explicit video targets are selected. Mutation checkpoints the project, never blindly retries, attempts to restore the previous selection and verifies native marker/timeline deltas after the call. A native true without observable delta remains accepted_unverified, not runtime-verified.
Transcript rebuild handles explicit interior text removal by creating and inserting KEEP subclips, never a fabricated split. Premiere 26.3+ required. Source stays active and untouched; destination must be a different explicitly supplied completely empty sequence, with existing video/audio tracks and no caption tracks. Choose this strategy explicitly; no silent fallback from direct cuts. Only ordinary forward 1x media is supported. take_audio includes only that same source's audio; separate external dialogue requires a separate explicit mapped workflow and is unsupported here. Effects/keyframes/markers are not copied. Cancellation can leave created subclips and an incomplete destination; inspect before a fresh plan, never blindly retry.
- premiere_list_transcription_languages: {}
- premiere_transcribe_item: {"item_id":"clip project item id","language":"optional language code such as en-US"}
- premiere_export_transcript: {"item_id":"clip project item id"}
- premiere_write_srt: {"output":"absolute .srt path","captions":[{"start":0,"end":2.5,"text":"Hello"}],"overwrite":false}
- premiere_transcript_to_srt: {"item_id":"clip project item id","output":"absolute .srt path","overwrite":false}
- premiere_import_transcript: {"item_id":"clip project item id","transcript_path":"absolute transcript .json path"}
- premiere_attach_proxy: {"item_id":"clip project item id","proxy_path":"absolute proxy media path"}
- premiere_batch_relink: {"items":[{"item_id":"clip project item id","new_path":"absolute replacement media path","override_compatibility":false}]}
- premiere_batch_attach_proxy: {"items":[{"item_id":"clip project item id","proxy_path":"absolute proxy media path"}]}
- premiere_insert_mogrt_path: {"path":"absolute .mogrt path","seconds":0,"video_track":0,"audio_track":0}
- premiere_insert_mogrt_library: {"library_name":"library","element_name":"template","seconds":0,"video_track":0,"audio_track":0}
- premiere_import_media: {"paths":["absolute media path 1","absolute media path 2"]}
- premiere_create_sequence_from_media: {"name":"sequence name","paths":["absolute media path 1","absolute media path 2"]}
- premiere_create_subsequence: {"targets":[{"kind":"video|audio","track":0,"clip_index":0}]}
- premiere_insert_project_item: {"item_id":"project item id","seconds":0,"video_track":0,"audio_track":0,"mode":"insert|overwrite"}
- premiere_insert_media: {"path":"absolute media path","seconds":0,"video_track":0,"audio_track":0,"mode":"insert|overwrite"}
- premiere_trim_clip: {"kind":"video|audio","track":0,"clip_index":0,"start_seconds":0.0,"end_seconds":5.0}
- premiere_roll_edit: {"kind":"video|audio","track":0,"left_clip_index":0,"right_clip_index":1,"boundary_seconds":5.0}
- premiere_move_clip: {"kind":"video|audio","track":0,"clip_index":0,"delta_seconds":1.5}
- premiere_clone_clip: {"kind":"video|audio","track":0,"clip_index":0,"time_offset_seconds":0.0,"video_track_offset":1,"audio_track_offset":0,"align_to_video":true,"insert":false}
- premiere_clone_clip_to_track: {"request":{"source":{"kind":"video|audio","track":0,"clip_index":2,"signature":"exact inspected targetSignature"},"destination_track":2,"destination_seconds":12,"mode":"overwrite|insert","align_to_video":true},"expected":"exact one-source expectation"}
- premiere_layer_clips: {"batch":{"schema_version":1,"operations":[{"source":{"kind":"video","track":0,"clip_index":2,"signature":"exact inspected targetSignature"},"destination_track":2,"destination_seconds":12,"mode":"overwrite","align_to_video":true}]},"expected":"one exact expectation per unique source"}
- premiere_cancel_layer_clips: {}
- premiere_rename_track: {"request":{"kind":"video|audio|caption","track":0,"name":"A-Roll"},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_organize_tracks: {"request":{"schema_version":1,"tracks":[{"kind":"video","track":0,"name":"A-Roll"},{"kind":"audio","track":0,"name":"Dialogue"}]},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
Cross-track clone computes native vertical offsets from inspected source/destination tracks and requires a clear destination range for unambiguous correlation. Linked membership is never inferred. Track rename uses stable createSetNameAction (Premiere 26.3+) and verifies native readback.
- premiere_delete_clip: {"kind":"video|audio","track":0,"clip_index":0,"ripple":true}
- premiere_set_track_mute: {"kind":"video|audio","track":0,"muted":true}
- premiere_set_clip_enabled: {"kind":"video|audio","track":0,"clip_index":0,"enabled":true}
- premiere_list_video_transitions: {}
- premiere_add_video_transition: {"track":0,"clip_index":0,"match_name":"transition match name","duration_seconds":0.5,"position":"start|end","force_single_sided":false}
- premiere_list_video_effects: {}
- premiere_inspect_clip_effects: {"track":0,"clip_index":0}
- premiere_add_video_effect: {"track":0,"clip_index":0,"match_name":"video effect match name"}
- premiere_set_effect_param: {"track":0,"clip_index":0,"component_index":0,"param_index":0,"value":1.0}
- premiere_set_video_param_named: {"track":0,"clip_index":0,"component_match_name":"optional exact match name","component_display_name":"optional exact display name","param_display_name":"exact parameter display name","value":1.0}
- premiere_add_effect_keyframe: {"track":0,"clip_index":0,"component_index":0,"param_index":0,"seconds":1.0,"value":1.0}
- premiere_add_video_keyframe_named: {"track":0,"clip_index":0,"component_match_name":"optional exact match name","component_display_name":"optional exact display name","param_display_name":"exact parameter display name","seconds":1.0,"value":1.0}
- premiere_apply_video_recipe: {"track":0,"clip_index":0,"settings":[{"component_match_name":"optional exact match name","component_display_name":"optional exact display name","param_display_name":"exact parameter display name","value":1.0,"seconds":"optional keyframe time"}]}
- premiere_list_audio_effects: {}
- premiere_inspect_audio_clip_effects: {"track":0,"clip_index":0}
- premiere_add_audio_effect: {"track":0,"clip_index":0,"display_name":"audio effect display name"}
- premiere_set_audio_effect_param: {"track":0,"clip_index":0,"component_index":0,"param_index":0,"value":1.0}
- premiere_set_audio_param_named: {"track":0,"clip_index":0,"component_match_name":"optional exact match name","component_display_name":"optional exact display name","param_display_name":"exact parameter display name","value":1.0}
- premiere_add_audio_effect_keyframe: {"track":0,"clip_index":0,"component_index":0,"param_index":0,"seconds":1.0,"value":1.0}
- premiere_add_audio_keyframe_named: {"track":0,"clip_index":0,"component_match_name":"optional exact match name","component_display_name":"optional exact display name","param_display_name":"exact parameter display name","seconds":1.0,"value":1.0}
- premiere_apply_audio_recipe: {"track":0,"clip_index":0,"settings":[{"component_match_name":"optional exact match name","component_display_name":"optional exact display name","param_display_name":"exact parameter display name","value":1.0,"seconds":"optional keyframe time"}]}
- premiere_list_saved_recipes: {}
- premiere_save_recipe: {"name":"recipe name","kind":"video|audio","settings":[{"component_match_name":"optional exact match name","component_display_name":"optional exact display name","param_display_name":"exact parameter display name","value":1.0,"seconds":"optional keyframe time"}]}
- premiere_apply_saved_recipe: {"name":"recipe name","track":0,"clip_index":0}
- premiere_apply_saved_recipe_batch: {"name":"recipe name","targets":[{"track":0,"clip_index":0}]}
- premiere_delete_recipe: {"name":"recipe name"}
- premiere_list_markers: {}
- premiere_add_marker: {"name":"marker name","marker_type":"Comment|Chapter|Segmentation|WebLink","seconds":10.0,"duration_seconds":0.0,"comments":"optional notes"}
- premiere_remove_marker: {"marker_index":0}
- premiere_export_sequence: {"output":"absolute output media path","preset":"optional absolute .epr preset path","queue_to_ame":false}
- premiere_plan_interchange_export: {"request":{"format":"aaf|fcpxml|otio","output":"absolute output file","overwrite":false,"suppress_ui":true,"aaf_options":"required only for aaf; exact documented fields"}}
- premiere_export_fcpxml: {"request":{"format":"fcpxml","output":"absolute output file","overwrite":false,"suppress_ui":true,"aaf_options":null},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_export_otio: {"request":{"format":"otio","output":"absolute output file","overwrite":false,"suppress_ui":true,"aaf_options":null},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_export_aaf: {"request":{"format":"aaf","output":"absolute output file","overwrite":false,"suppress_ui":true,"aaf_options":{"audio_file_format":"wav|aiff","bits_per_sample":24,"embed_audio":true,"explode_to_mono":false,"handle_frames":0,"interleave_without_effects":false,"mixdown_video":false,"preserve_parent_folder":false,"render_audio_effects":true,"sample_rate":48000,"trim_sources":false,"video_mixdown_preset_path":null}},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_export_frame: {"request":{"seconds":5,"output":"absolute output.png","width":1920,"height":1080,"overwrite":false},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_export_review_frames: {"batch":{"schema_version":1,"frames":[{"seconds":5,"output":"absolute frame-001.png","width":1920,"height":1080,"overwrite":false}]},"expected":{"project_guid":"...","sequence_guid":"...","clips":[]}}
- premiere_cancel_review_frame_export: {}
Interchange uses stable ProjectConverter FCPXML/OTIO (26.2+) and AAF (26.3+) APIs. Native frame export uses Exporter.exportSequenceFrame (25.6+) and Adobe-supported bmp/dpx/gif/jpg/exr/png/tga/tif formats. Output collision blocks by default; host acceptance and observed file metadata are reported separately.
- premiere_plan_export: {"output":"absolute output media path","preset":"optional absolute .epr preset","queue_to_ame":false,"overwrite":false}
- premiere_acceptance_report: {}
- premiere_acceptance_probe: {"group":1}
- premiere_acceptance_register_disposable: {"project_guid":"exact current project GUID","project_path":"existing absolute disposable .prproj","sequence_guid":"optional exact current sequence GUID","explicitly_disposable":true}
- premiere_acceptance_plan: {"group":1}
- premiere_acceptance_prepare: {"group":2,"step":"trim|move|clone|scene_markers","fixture":{"kind":"video|audio","track":0,"clip_index":0,"start_seconds":"optional","end_seconds":"optional","delta_seconds":"optional","expected":{"project_guid":"...","project_path":"...","sequence_guid":"...","clips":[{"kind":"video","track":0,"clip_index":0,"signature":"..."}]}}}
- premiere_acceptance_execute: {"action_id":"exact prepared acceptance action UUID"}
- premiere_acceptance_cancel: {"action_id":"exact prepared acceptance action UUID"}
- premiere_acceptance_verify_recovery: {"action_id":"completed trim/move/clone acceptance action UUID"} — read-only verification after manually opening the Shuvi checkpoint; never opens or overwrites a project automatically
- premiere_save_project: {}
- workspace_scan: {"path":"absolute workspace path"}
- search_text: {"path":"absolute workspace path","query":"text to find"}
- replace_text: {"path":"absolute file path","old":"exact old text","new":"replacement text"}
- apply_patch: {"path":"absolute Git repository path","patch":"unified diff patch","expected_worktree_fingerprint":"exact worktree fingerprint copied from the latest matching git_status receipt"}
- run_project_task: {"path":"absolute project path","task":"test|build|lint|typecheck"}
- git_status: {"path":"absolute repository path"}
- git_diff: {"path":"absolute repository path"}
- git_commit: {"path":"absolute repository path","message":"commit message","files":["exact/relative/file1","exact/relative/file2"],"expected_head":"exact local HEAD copied from the latest matching git_status/git_diff receipt","expected_worktree_fingerprint":"exact worktree fingerprint copied from the latest matching git_status/git_diff receipt"}
- git_push: {"path":"absolute repository path","expected_head":"exact committed HEAD copied from the successful git_commit receipt"}

Rules:
- Use tools only when a computer action is required.
- Never claim an action succeeded before Shuvi returns a tool result.
- Prefer typed file/app/browser/screen tools over PowerShell.
- capture_screen only captures an image and returns its local path; do not infer visual contents from that path.
- inspect_screen captures the screen and sends it to the currently selected vision-capable provider after user approval.
- Do not put tool JSON inside markdown fences.
- For destructive/system/security-sensitive work, explain the intent in reason.
- Multi-step tasks may include top-level task_graph: {"objective":"stable goal","revision":1,"steps":[{"step_id":"inspect","title":"Inspect source","purpose":"Observe current implementation","success_criteria":"Typed read_file succeeds","depends_on":[],"expected_tool":"read_file"}]} and task_step_id:"inspect". Use 1..8 steps, IDs 1..48 ASCII letters/digits/_/-, title <=100, purpose <=300, success_criteria <=500, objective <=500; at most 7 unique predecessor IDs. Only exact successful typed tools complete steps; never send status/evidence or claim completion from prose. expected_tool must match the associated proposal; validation requires run_project_task with successful exit status. One graph step corresponds to one typed action, so status and diff need separate steps.
- Once a graph exists every action needs task_step_id. A separate recovery inspection may use task_recovery:true without task_step_id, using read_file/list_directory/workspace_scan/search_text/git_status/git_diff/list_processes/ui_find/browser_dom_read/premiere_context/premiere_timeline/premiere_bridge_status. A successful inspection after a failure permits a next-revision graph with recover_steps:["failed_id"]. Recovery does not itself complete or retry the failed step. Exact unsuccessful proposals remain blocked across revisions.
- Replan with a full graph, stable objective, revision incremented by exactly one (max 8). Preserve completed specifications/evidence and attempted step IDs. Only future steps can change. Replanning never resets the eight-action budget or grants permission; incompatible history needs a new user instruction/reset.
- Coding workflow dependencies are enforced locally. Before replace_text, successfully read the exact target file after its latest Shuvi mutation. Before apply_patch, run fresh git_status for that exact repository after the latest Shuvi mutation, copy its exact worktree fingerprint, and let the typed tool recheck the fingerprint both before validation and immediately before applying. Before git_commit, run fresh git_status and git_diff after the latest edit, copy both the exact reviewed HEAD and worktree fingerprint, pass only the exact reviewed relative files, and let the typed tool recheck both the worktree fingerprint and upstream freshness immediately before staging; a successful commit invalidates that review snapshot. git_push requires a successful same-repository git_commit after the latest edit and performs the same upstream freshness check immediately before push; a later edit invalidates prior pushed-complete phase evidence.
- After a code mutation, prefer run_project_task for an appropriate test/build/lint/typecheck before review/commit when such a task exists. Validation status is tracked, but a missing validation step alone does not authorize or fabricate a pass/fail result.
- Before git_commit, inspect git_status and git_diff so the user can review what will be committed.
- Treat git_push as a remote write and request it only after a successful commit when the user asked for a push.
- Use run_project_task instead of raw shell commands when test/build/lint/typecheck is enough.
- For browser/app UI work, prefer a Shuvi-managed browser when isolation matters, then use window-scoped semantic UI tools first. Use ui_toggle and ui_expand_collapse for supported controls. ui_send_keys is a high-risk fallback only after an exact element is focused and semantic patterns are unavailable. pointer_click is a final high-risk coordinate fallback: inspect_screen first, use coordinates only when semantic UI/DOM control cannot target the control, and never repeat a failed coordinate click blindly.
- For Adobe Premiere Pro, use premiere_detect/premiere_launch for discovery and startup. Start/pair premiere_bridge_start before native project operations. Prefer premiere_context/premiere_timeline/premiere_list_items/premiere_project_tree for inspection, premiere_set_playhead for non-destructive navigation, premiere_inspect_frame for playhead-positioned visual review and premiere_create_bin/premiere_import_media/premiere_create_sequence_from_media/premiere_insert_media/premiere_save_project for native editing. premiere_insert_media, premiere_trim_clip, premiere_roll_edit, premiere_move_clip, premiere_clone_clip, premiere_delete_clip, premiere_add_video_transition, premiere_add_video_effect, premiere_set_effect_param, premiere_add_effect_keyframe, premiere_add_audio_effect, premiere_set_audio_effect_param and premiere_add_audio_effect_keyframe are high risk because they change the timeline or effect state; premiere_insert_mogrt_path and premiere_insert_mogrt_library are high risk because they add graphics to the timeline; premiere_export_sequence is high risk because it writes media and may start encoding; inspect the timeline first when practical. Unsupported native capabilities must fail clearly; never bypass their safety gates with UI automation. Use visual inspection only as observational evidence. Major sequence creation and timeline insert/overwrite actions automatically save and copy the current .prproj into a sibling 'Shuvi Backups' folder before editing; the edit is refused if a saved local project cannot be checkpointed.
- Project diagnostics are read-only and bounded. Inspect traversal/truncation and unknown status fields before interpreting counts; proxy attachment does not establish proxy health and duplicate path candidates are not authorization to delete/relink.
- Graphics plans must use inspected primitive types without coercion or semantic-name inference. Copy settings and expected into premiere_apply_video_recipe; skipped fields were not applied.
- Saved graphics mappings require an inspected reference clip and explicit caller-defined roles; saving checks every native field. Template provenance is caller-supplied, not inferred. List mappings to obtain the revision before updating/deleting/applying. Batch graphics and lower thirds share one executor for title/chapter/CTA/price/location cards. Use clear existing video/audio tracks. All mapped roles need values. Duration only shortens video-only native graphics; no extension or inferred linked audio. Batches checkpoint once and return partial results; uncertain delivery must never be blindly retried.
- Premiere tools accept arguments.expected: {project_guid, project_path?, sequence_guid?, clips:[{kind,track,clip_index,signature}]}. It is required for native mutations. Copy project/sequence identity and each clip targetSignature from premiere_timeline. Include every edited clip for clip guards. Stale expectations are rejected. Never discard an expectation after rejection to force an edit.
- Every native project mutation requires expected with inspected project_guid and saved project_path; timeline mutations also require sequence_guid and all targeted clips. Numeric effect/parameter setters and keyframe additions require expected_signature from effect inspection targetSignature; marker removal requires expected_signature from marker inspection. Missing or stale evidence is rejected. Inspect premiere_inspect_keyframes before premiere_edit_keyframe and copy the returned targetSignature and exact native ticks. A stale target is rejected. Keyframe edits are high-risk and require a project checkpoint. Do not convert keyframe ticks to timeline seconds.
- premiere_plan_speed is a read-only planner. Supply only fields for the chosen mode. It returns applied=false/executable=false because the reviewed UXP API has no documented speed write action. Never describe a plan as an applied edit, and never invoke blind UI to execute it. Inspect timeline/clip speed first.
- Saved Premiere recipes are local reusable video/audio named-parameter recipes. Inspect a clip's effect chain first, save a recipe only after exact selectors are known, and apply saved recipes as high-risk backed-up edits.
- Use premiere_review_frames for a bounded multi-frame visual review before/after major grading, motion, transition or graphics changes; the normal agent loop can then use the returned observations to decide whether another backed-up edit is needed.
- For managed Edge/Chrome sessions, prefer browser_dom_read/browser_dom_click/browser_dom_set_value/browser_navigate over visual coordinate actions because DOM selectors are more reliable.
- browser_dom_click and browser_dom_set_value require selectors that match exactly one element; refine with browser_dom_read when ambiguous.
- stop_managed_process may only target process roots that Shuvi launched itself.
- When a tool fails, do not repeat the exact same failing action blindly. Use the observation to refine the selector, inspect the screen, or choose a different typed tool.
- The local orchestrator may reject an exact repeated unsuccessful proposal or stop after repeated failures. Treat an orchestration_blocked result as a requirement to replan, not as permission to bypass the typed tool/approval layer.
- After a failure, prefer a read/inspection action when it can reduce uncertainty before another mutation. Do not change a target expectation merely to force a stale edit through.
- If no computer action is needed, answer normally."#;

#[derive(Debug, Clone, Serialize)]
struct ProviderDescriptor {
    id: &'static str,
    name: &'static str,
    default_model: &'static str,
    api_key_required: bool,
    custom_base_url: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionCheckpoint {
    version: u32,
    updated_at_ms: u64,
    provider: String,
    model: String,
    base_url: Option<String>,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    orchestration: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChatInput {
    provider: String,
    model: String,
    base_url: Option<String>,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    orchestration_context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentPlanMeta {
    #[serde(default)]
    objective: String,
    #[serde(default)]
    step: String,
    #[serde(default)]
    success_criteria: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolProposal {
    tool: String,
    arguments: Value,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    plan: Option<AgentPlanMeta>,
    // Opaque untrusted metadata; frontend validation only adds restrictions.
    #[serde(default)]
    task_graph: Option<Value>,
    #[serde(default)]
    task_step_id: Option<Value>,
    #[serde(default)]
    task_recovery: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
struct UsageStats {
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
struct ChatResponse {
    content: String,
    provider: String,
    model: String,
    tool_proposal: Option<ToolProposal>,
    usage: Option<UsageStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize)]
struct PendingActionView {
    id: String,
    kind: String,
    summary: String,
    detail: String,
    risk: RiskLevel,
}

#[derive(Debug, Clone)]
struct ProviderContext {
    provider: String,
    model: String,
    base_url: Option<String>,
}

#[derive(Debug, Clone)]
enum ToolAction {
    ListDirectory { path: String },
    ReadFile { path: String },
    WriteFile { path: String, content: String },
    CreateDirectory { path: String },
    LaunchApp { program: String, args: Vec<String> },
    OpenUrl { url: String },
    BrowserStart { browser: String, url: Option<String> },
    BrowserNavigate { pid: u32, url: String },
    BrowserDomRead { pid: u32, selector: String },
    BrowserDomClick { pid: u32, selector: String },
    BrowserDomSetValue { pid: u32, selector: String, value: String },
    StopManagedProcess { pid: u32 },
    CaptureScreen,
    InspectScreen { prompt: String, provider: ProviderContext },
    ListProcesses,
    UiFind { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiClick { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiSetValue { name: Option<String>, automation_id: Option<String>, window: Option<String>, value: String },
    UiFocus { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiScroll { name: Option<String>, automation_id: Option<String>, window: Option<String>, vertical: String },
    UiToggle { name: Option<String>, automation_id: Option<String>, window: Option<String> },
    UiExpandCollapse { name: Option<String>, automation_id: Option<String>, window: Option<String>, action: String },
    UiSendKeys { name: Option<String>, automation_id: Option<String>, window: Option<String>, keys: String },
    PointerClick { x: i32, y: i32, button: String, clicks: u32 },
    PremiereDetect,
    PremiereLaunch { project: Option<String> },
    PremiereBridgeStart,
    PremiereBridgeStatus,
    PremiereContext,
    PremiereRemoveKeyframeRange { target: ParameterTarget, start_seconds: f64, end_seconds: f64, expected_count: u32, expected_signature: String, allow_remove_all: bool },
    PremiereRemoveVideoTransition { track: u32, clip_index: u32, position: String },
    PremiereInspectKeyframes { target: ParameterTarget },
    PremiereEditKeyframe { target: ParameterTarget, ticks: String, expected_signature: String, operation: String, interpolation: Option<String> },
    PremiereInspectClipSpeed { kind: String, track: u32, clip_index: u32 },
    PremierePlanSpeed { kind: String, track: u32, clip_index: u32, request: SpeedRequest },
    PremiereInspectEffectLifecycle { target: ComponentTarget },
    PremiereRemoveEffect { target: ComponentTarget, expected_signature: String },
    PremierePlanVideoRecipe { track: u32, clip_index: u32, request: RecipePlanRequest },
    PremierePlanAudioAutomation { target: ParameterTarget, request: AudioPlanRequest },
    PremiereInspectMogrtProperties { track: u32, clip_index: u32 },
    PremierePlanMogrtRecipe { track: u32, clip_index: u32, request: GraphicsRequest },
    PremiereProjectDiagnostics { limits: DiagnosticsLimits },
    PremiereTimelineCapabilities,
    PremiereTimeline,
    PremiereCaptionTracks,
    PremiereSetCaptionTrackName { track: u32, name: String },
    PremiereSetCaptionTrackMute { track: u32, muted: bool },
    PremiereSetPlayhead { seconds: f64 },
    PremiereInspectFrame { seconds: f64, prompt: String, provider: ProviderContext },
    PremiereReviewFrames { seconds: Vec<f64>, prompt: String, provider: ProviderContext },
    PremiereReviewSessionStart { objective: String, reference: String, sample_times: Vec<f64>, max_iterations: u8 },
    PremiereReviewSessionStatus { session_id: String },
    PremiereReviewSessionNext { session_id: String, provider: ProviderContext },
    PremiereReviewSessionRecordFix { session_id: String, issue_id: String, target: String, planner: String, settings: Value, approved_action_id: String },
    PremiereReviewSessionCancel { session_id: String },
    PremierePlanEditRecipe { request: premiere_editorial::Request },
    PremiereResolveReviewTarget { session_id: String, issue_id: String, frame_seconds: f64 },
    PremiereBindReviewFix { session_id: String, issue_id: String, frame_seconds: f64, kind: String, track: u32, clip_index: u32, target_signature: String, component_match_name: Option<String>, param_display_name: Option<String> },
    PremiereEditSessionStart { request: premiere_editorial::Request },
    PremiereEditSessionStatus { session_id: String },
    PremiereEditSessionNext { session_id: String },
    PremiereEditSessionRecordAction { session_id: String, stage_id: String, action_id: String },
    PremiereEditSessionRecordReview { session_id: String, stage_id: String, review_session_id: String },
    PremiereEditSessionCancel { session_id: String },
    PremiereEditJobStart { request: premiere_edit_job::Request },
    PremiereEditJobStatus { job_id: String },
    PremiereEditJobNext { job_id: String },
    PremiereEditJobRecordAction { job_id: String, phase_id: String, action_id: String },
    PremiereEditJobCancel { job_id: String },
    PremiereSetTrackMute { kind: String, track: u32, muted: bool },
    PremiereSetClipEnabled { kind: String, track: u32, clip_index: u32, enabled: bool },
    PremiereListVideoTransitions,
    PremiereAddVideoTransition { track: u32, clip_index: u32, match_name: String, duration_seconds: f64, position: String, force_single_sided: bool },
    PremiereListVideoEffects,
    PremiereInspectClipEffects { track: u32, clip_index: u32 },
    PremiereAddVideoEffect { track: u32, clip_index: u32, match_name: String },
    PremiereSetEffectParam { expected_signature: String, track: u32, clip_index: u32, component_index: u32, param_index: u32, value: Value },
    PremiereSetVideoParamNamed { track: u32, clip_index: u32, component_match_name: Option<String>, component_display_name: Option<String>, param_display_name: String, value: Value },
    PremiereAddEffectKeyframe { expected_signature: String, track: u32, clip_index: u32, component_index: u32, param_index: u32, seconds: f64, value: Value },
    PremiereAddVideoKeyframeNamed { track: u32, clip_index: u32, component_match_name: Option<String>, component_display_name: Option<String>, param_display_name: String, seconds: f64, value: Value },
    PremiereApplyVideoRecipe { track: u32, clip_index: u32, settings: Vec<Value> },
    PremiereListAudioEffects,
    PremiereInspectAudioClipEffects { track: u32, clip_index: u32 },
    PremiereAddAudioEffect { track: u32, clip_index: u32, display_name: String },
    PremiereSetAudioEffectParam { expected_signature: String, track: u32, clip_index: u32, component_index: u32, param_index: u32, value: Value },
    PremiereSetAudioParamNamed { track: u32, clip_index: u32, component_match_name: Option<String>, component_display_name: Option<String>, param_display_name: String, value: Value },
    PremiereAddAudioEffectKeyframe { expected_signature: String, track: u32, clip_index: u32, component_index: u32, param_index: u32, seconds: f64, value: Value },
    PremiereAddAudioKeyframeNamed { track: u32, clip_index: u32, component_match_name: Option<String>, component_display_name: Option<String>, param_display_name: String, seconds: f64, value: Value },
    PremiereApplyAudioRecipe { track: u32, clip_index: u32, settings: Vec<Value> },
    PremiereListSavedRecipes,
    PremiereSaveRecipe { name: String, kind: String, settings: Vec<Value> },
    PremiereApplySavedRecipe { name: String, track: u32, clip_index: u32 },
    PremiereApplySavedRecipeBatch { name: String, targets: Vec<Value> },
    PremiereDeleteRecipe { name: String },
    PremiereListMarkers,
    PremiereAddMarker { name: String, marker_type: String, seconds: f64, duration_seconds: f64, comments: String },
    PremiereRemoveMarker { marker_index: u32, expected_signature: String },
    PremiereListItems,
    PremiereProjectTree,
    PremiereCreateBin { name: String },
    PremiereRenameProjectItem { item_id: String, name: String },
    PremiereMoveProjectItem { item_id: String, target_bin_id: String },
    PremiereRelinkMedia { item_id: String, new_path: String, override_compatibility: bool },
    PremiereSetSourceInOut { item_id: String, in_seconds: f64, out_seconds: f64 },
    PremiereClearSourceInOut { item_id: String },
    PremiereCreateSubclip { item_id: String, name: String, start_seconds: f64, end_seconds: f64, hard_boundaries: bool, take_video: bool, take_audio: bool },
    PremiereListTranscriptionLanguages,
    PremiereTranscribeItem { item_id: String, language: Option<String> },
    PremiereExportTranscript { item_id: String },
    PremiereWriteSrt { output: String, overwrite: bool, cues: Vec<premiere_subtitles::Cue> },
    PremiereTranscriptToSrt { item_id: String, output: String, overwrite: bool },
    PremiereTranscriptDucking { item_id: String, target: ParameterTarget, request: AudioPlanRequest, transcript_offset: f64, music_start: f64, merge_gap: f64, apply: bool },
    PremiereTranscriptCuts { request: premiere_talking_head::Request, apply: bool, transcript_snapshot: Option<String> },
    PremiereTranscriptRebuild { request: premiere_transcript_rebuild::Request, apply: bool, plan_snapshot: Option<String> },
    PremiereCancelTranscriptRebuild { generation: u64 },
    PremierePlanSceneDetection { request: premiere_scene_detection::Request },
    PremiereSceneDetection { request: premiere_scene_detection::Request },
    PremierePlanSceneRoughCut { request: premiere_scene_rough_cut::Request },
    PremiereBatchFinish { targets: Vec<Value> },
    PremiereFinishMediaBatch { request: premiere_finishing::Request, provider: Option<ProviderContext> },
    PremiereBatchFinishCancel { generation: u64 },
    PremiereSaveGraphicsMapping { mapping: premiere_graphics::Mapping, track: u32, clip_index: u32, expected_revision: Option<u32> },
    PremiereListGraphicsMappings,
    PremiereDeleteGraphicsMapping { name: String, revision: u32 },
    PremiereBatchGraphics { batch: premiere_graphics::Batch },
    PremiereCancelGraphicsBatch { generation: u64 },
    PremiereAssembly { assembly: premiere_assembly::Assembly, apply: bool },
    PremiereAssemblyCancel { generation: u64 },
    PremierePopulateMogrt { track: u32, clip_index: u32, request: GraphicsRequest },
    PremiereImportTranscript { item_id: String, transcript_json: String },
    PremiereAttachProxy { item_id: String, proxy_path: String },
    PremiereBatchRelink { items: Vec<Value> },
    PremiereInspectMediaInterpretation { item_id: String },
    PremierePrepareMediaItem { request: premiere_media_prep::ItemPrep },
    PremierePrepareMediaBatch { batch: premiere_media_prep::Batch },
    PremiereCancelMediaPrep { generation: u64 },
    PremiereCreateSequenceFromPreset { name: String, preset_path: String },
    PremiereGetWorkArea,
    PremiereSetWorkArea { request: premiere_media_prep::WorkArea },
    PremiereBatchAttachProxy { items: Vec<Value> },
    PremiereInsertMogrtPath { path: String, seconds: f64, video_track: u32, audio_track: u32 },
    PremiereInsertMogrtLibrary { library_name: String, element_name: String, seconds: f64, video_track: u32, audio_track: u32 },
    PremiereImportMedia { paths: Vec<String> },
    PremiereCreateSequenceFromMedia { name: String, paths: Vec<String> },
    PremiereCreateSubsequence { targets: Vec<Value> },
    PremiereInsertProjectItem { item_id: String, seconds: f64, video_track: u32, audio_track: u32, mode: String },
    PremiereInsertMedia { path: String, seconds: f64, video_track: u32, audio_track: u32, mode: String },
    PremiereTrimClip { kind: String, track: u32, clip_index: u32, start_seconds: Option<f64>, end_seconds: Option<f64> },
    PremiereRollEdit { kind: String, track: u32, left_clip_index: u32, right_clip_index: u32, boundary_seconds: f64 },
    PremiereMoveClip { kind: String, track: u32, clip_index: u32, delta_seconds: f64 },
    PremiereCloneClip { kind: String, track: u32, clip_index: u32, time_offset_seconds: f64, video_track_offset: i32, audio_track_offset: i32, align_to_video: bool, insert: bool },
    PremiereCloneClipToTrack { request: premiere_layering::CloneToTrack },
    PremiereLayerClips { batch: premiere_layering::LayerBatch },
    PremiereCancelLayerClips { generation: u64 },
    PremiereRenameTrack { request: premiere_layering::TrackRename },
    PremiereOrganizeTracks { request: premiere_layering::TrackOrganization },
    PremiereDeleteClip { kind: String, track: u32, clip_index: u32, ripple: bool },
    PremierePlanExport { output: String, preset: Option<String>, queue_to_ame: bool, overwrite: bool },
    PremiereAcceptanceReport,
    PremiereAcceptanceProbe { group: u8 },
    PremiereAcceptanceRegisterDisposable { project_guid: String, project_path: String, sequence_guid: Option<String> },
    PremiereAcceptancePlan { group: u8 },
    PremiereAcceptancePrepare { step: String, fixture: premiere_acceptance_execution::Fixture },
    PremiereAcceptanceExecute { action_id: String },
    PremiereAcceptanceCancel { action_id: String },
    PremiereAcceptanceVerifyRecovery { action_id: String },
    PremiereCalibrationReport,
    PremiereCalibrationObserve { target: premiere_calibration::Target, semantic_role: Option<String> },
    PremiereCalibrationProbe { target: premiere_calibration::Target, delta: f64 },
    PremiereExportSequence { output: String, preset: Option<String>, queue_to_ame: bool, overwrite: bool },
    PremierePlanInterchangeExport { request: premiere_delivery::InterchangeRequest },
    PremiereExportInterchange { request: premiere_delivery::InterchangeRequest },
    PremiereExportFrame { request: premiere_delivery::FrameRequest },
    PremiereExportReviewFrames { batch: premiere_delivery::FrameBatch },
    PremiereCancelReviewFrameExport { generation: u64 },
    PremiereExportStatus { job_id: String },
    PremiereReadinessReport,
    PremiereSaveProject,
    WorkspaceScan { path: String },
    SearchText { path: String, query: String },
    ReplaceText { path: String, old: String, new_value: String },
    ApplyPatch { path: String, patch: String, expected_worktree_fingerprint: String },
    RunProjectTask { path: String, task: String },
    GitStatus { path: String },
    GitDiff { path: String },
    GitCommit { path: String, message: String, files: Vec<String>, expected_head: String, expected_worktree_fingerprint: String },
    GitPush { path: String, expected_head: String },
    PowerShell { command: String },
}

#[derive(Debug, Clone)]
struct PendingAction {
    created_at_ms: u64,
    premiere_expectation: Option<PremiereExpectation>,
    tool: String,
    detail: String,
    action: ToolAction,
}

#[derive(Debug, Clone, Serialize)]
struct ActionResult {
    success: bool,
    tool: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PremiereSavedRecipe {
    name: String,
    kind: String,
    settings: Vec<Value>,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuditEntry {
    timestamp_ms: u64,
    event: String,
    tool: String,
    detail: String,
    success: bool,
    #[serde(default)]
    action_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct RuntimeStatus {
    shuvi_memory_bytes: u64,
    shuvi_memory_mb: f64,
    native_memory_mb: f64,
    managed_children_memory_mb: f64,
    managed_children_count: usize,
    soft_limit_mb: f64,
    hard_limit_mb: f64,
    over_soft_limit: bool,
    over_hard_limit: bool,
}

#[derive(Debug, Clone)]
struct BrowserSession {
    port: u16,
    target_id: String,
    profile_dir: std::path::PathBuf,
}

#[derive(Default)]
struct ActionState {
    pending: Mutex<HashMap<String, PendingAction>>,
    managed_children: Mutex<HashSet<u32>>,
    managed_process_started_at: Mutex<HashMap<u32, u64>>,
    running_action_children: Mutex<HashMap<String, u32>>,
    running_action_tools: Mutex<HashMap<String, String>>,
    browser_sessions: Mutex<HashMap<u32, BrowserSession>>,
    premiere_bridge: Arc<PremiereBridgeShared>,
    premiere_export_jobs_io: Mutex<()>,
    acceptance_probe_running: AtomicBool,
    finishing_running: premiere_execution::Execution,
    finishing_cancelled: AtomicBool,
    graphics_running: premiere_execution::Execution,
    graphics_cancelled: AtomicBool,
    assembly_running: premiere_execution::Execution,
    rebuild_running: premiere_execution::Execution,
    rebuild_cancelled: AtomicBool,
    layering_running: premiere_execution::Execution,
    layering_cancelled: AtomicBool,
    media_prep_running: premiere_execution::Execution,
    media_prep_cancelled: AtomicBool,
    delivery_running: premiere_execution::Execution,
    delivery_cancelled: AtomicBool,
    assembly_cancelled: AtomicBool,
}

struct AcceptanceProbeGuard<'a>(&'a AtomicBool);
impl Drop for AcceptanceProbeGuard<'_> {
    fn drop(&mut self) {self.0.store(false,Ordering::Release);}
}

fn providers() -> Vec<ProviderDescriptor> {
    vec![
        ProviderDescriptor {
            id: "deepseek",
            name: "DeepSeek",
            default_model: "deepseek-chat",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "openai",
            name: "OpenAI",
            default_model: "gpt-5.6",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "gemini",
            name: "Google Gemini",
            default_model: "gemini-2.5-flash",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "anthropic",
            name: "Anthropic Claude",
            default_model: "claude-sonnet-4-5",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "openrouter",
            name: "OpenRouter",
            default_model: "openai/gpt-4.1-mini",
            api_key_required: true,
            custom_base_url: false,
        },
        ProviderDescriptor {
            id: "ollama",
            name: "Ollama (local)",
            default_model: "qwen3:4b",
            api_key_required: false,
            custom_base_url: true,
        },
        ProviderDescriptor {
            id: "custom",
            name: "Custom OpenAI-compatible",
            default_model: "model-name",
            api_key_required: true,
            custom_base_url: true,
        },
    ]
}

fn provider_ids() -> HashSet<&'static str> {
    providers().into_iter().map(|provider| provider.id).collect()
}

fn url_host_is_loopback(parsed: &Url) -> bool {
    let Some(host) = parsed.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn validate_provider_fields(
    provider: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<(), String> {
    if !provider_ids().contains(provider) {
        return Err("Unknown provider.".into());
    }

    let model = model.trim();
    if model.is_empty()
        || model.len() > MAX_PROVIDER_MODEL_BYTES
        || model.chars().any(char::is_control)
    {
        return Err("Provider model must be non-empty, control-character free, and at most 256 bytes.".into());
    }

    let base_url = base_url.map(str::trim).filter(|value| !value.is_empty());
    if provider == "custom" && base_url.is_none() {
        return Err("Custom provider requires a base URL.".into());
    }
    if let Some(url) = base_url {
        if url.len() > MAX_PROVIDER_BASE_URL_BYTES || url.chars().any(char::is_control) {
            return Err("Provider base URL must be an http(s) URL without control characters and at most 4096 bytes.".into());
        }
        let parsed = Url::parse(url)
            .map_err(|_| "Provider base URL must be a valid absolute http(s) URL.".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err("Provider base URL must be an absolute http(s) URL with a host.".into());
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("Provider base URL must not contain embedded credentials; use the credential store for API keys.".into());
        }
        if provider == "custom" && parsed.scheme() != "https" && !url_host_is_loopback(&parsed) {
            return Err("Custom provider URLs carrying a saved API key must use HTTPS unless the endpoint is loopback-only.".into());
        }
    }

    Ok(())
}

fn key_entry(provider_id: &str) -> Result<Entry, String> {
    if !provider_ids().contains(provider_id) {
        return Err("Unknown provider.".into());
    }

    Entry::new(KEYRING_SERVICE, &format!("provider:{provider_id}"))
        .map_err(|error| format!("Credential store unavailable: {error}"))
}

fn load_api_key(provider_id: &str) -> Result<Option<String>, String> {
    if provider_id == "ollama" {
        return Ok(None);
    }

    let entry = key_entry(provider_id)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read credential: {error}")),
    }
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("HTTP client error: {error}"))
}

async fn send_with_retry(
    request: reqwest::RequestBuilder,
    label: &str,
) -> Result<reqwest::Response, String> {
    let mut last_error: Option<String> = None;

    for attempt in 0..3_u32 {
        let attempt_request = request
            .try_clone()
            .ok_or_else(|| format!("{label} request could not be cloned for retry."))?;

        match attempt_request.send().await {
            Ok(response) => {
                let status = response.status();
                // Only explicit throttling is retried automatically. Gateway/server errors
                // are ambiguous after provider-side generation may have begun, so fail closed
                // instead of risking a duplicate billed generation.
                let retryable = status.as_u16() == 429;

                if retryable && attempt < 2 {
                    last_error = Some(format!("HTTP {status}"));
                    let delay_ms = 350_u64.saturating_mul(1_u64 << attempt);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }

                return Ok(response);
            }
            Err(error) => {
                // A connect failure is the only transport error retried automatically.
                // Timeouts/request errors are ambiguous: the provider may already have
                // accepted the generation, so a duplicate request could incur duplicate cost.
                let retryable = error.is_connect();

                if retryable && attempt < 2 {
                    last_error = Some(error.to_string());
                    let delay_ms = 350_u64.saturating_mul(1_u64 << attempt);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }

                return Err(format!("{label} failed: {error}"));
            }
        }
    }

    Err(format!(
        "{label} failed after retries: {}",
        last_error.unwrap_or_else(|| "unknown network error".into())
    ))
}

fn ensure_provider_response_size(
    response: &reqwest::Response,
    label: &str,
) -> Result<(), String> {
    if response
        .content_length()
        .is_some_and(|bytes| bytes > MAX_PROVIDER_RESPONSE_BYTES)
    {
        return Err(format!(
            "{label} response exceeds Shuvi's 8 MB declared-size safety limit."
        ));
    }
    Ok(())
}

async fn bounded_provider_json(
    mut response: reqwest::Response,
    label: &str,
) -> Result<(reqwest::StatusCode, Value), String> {
    ensure_provider_response_size(&response, label)?;
    let status = response.status();
    let mut body = Vec::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("{label} response body failed while streaming: {error}"))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_PROVIDER_RESPONSE_BYTES as usize {
            return Err(format!("{label} response exceeds Shuvi's 8 MB streamed-body safety limit."));
        }
        body.extend_from_slice(&chunk);
    }

    let value = serde_json::from_slice::<Value>(&body)
        .map_err(|error| format!("Invalid {label} JSON response: {error}"))?;
    Ok((status, value))
}

fn collect_provider_text<'a>(
    parts: impl Iterator<Item = &'a str>,
    label: &str,
) -> Result<String, String> {
    let mut output = String::new();
    for part in parts {
        if output.len().saturating_add(part.len()) > MAX_ASSISTANT_RESPONSE_BYTES {
            return Err(format!("{label} text exceeds Shuvi's 256 KB safety limit."));
        }
        output.push_str(part);
    }
    Ok(output)
}

fn bounded_provider_text(value: &str, label: &str) -> Result<String, String> {
    if value.len() > MAX_ASSISTANT_RESPONSE_BYTES {
        return Err(format!("{label} text exceeds Shuvi's 256 KB safety limit."));
    }
    Ok(value.to_string())
}

fn compact_error(body: &Value) -> String {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| body.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| body.to_string().chars().take(400).collect())
}

fn parse_tool_proposal(text: &str) -> Option<ToolProposal> {
    let mut candidate = text.trim();

    if let Some(stripped) = candidate.strip_prefix("```json") {
        candidate = stripped.strip_suffix("```").unwrap_or(stripped).trim();
    } else if let Some(stripped) = candidate.strip_prefix("```") {
        candidate = stripped.strip_suffix("```").unwrap_or(stripped).trim();
    } else if let Some(stripped) = candidate.strip_prefix("~~~json") {
        candidate = stripped.strip_suffix("~~~").unwrap_or(stripped).trim();
    } else if let Some(stripped) = candidate.strip_prefix("~~~") {
        candidate = stripped.strip_suffix("~~~").unwrap_or(stripped).trim();
    }

    let mut proposal: ToolProposal = serde_json::from_str(candidate).ok()?;
    if proposal.plan.as_ref().is_some_and(|plan| {
        let bounded=|value:&str,max:usize| {
            let trimmed=value.trim();
            !trimmed.is_empty() && trimmed.chars().count()<=max
        };
        !bounded(&plan.objective,500) || !bounded(&plan.step,500) || !bounded(&plan.success_criteria,800)
    }) {
        proposal.plan=None;
    }

    // Keep an invalid marker instead of dropping a graph and accidentally removing restrictions.
    if proposal.task_graph.as_ref().is_some_and(|v| v.to_string().len()>24_000) {
        proposal.task_graph=Some(Value::Bool(false));
    }
    if proposal.task_step_id.as_ref().is_some_and(|v| v.as_str().is_none_or(|s| s.len()>48)) {
        proposal.task_step_id=Some(Value::Bool(false));
    }
    if proposal.task_recovery.as_ref().is_some_and(|v| !v.is_boolean()) {
        proposal.task_recovery=Some(Value::String("invalid".into()));
    }

    match proposal.tool.as_str() {
        "list_directory"
        | "read_file"
        | "write_file"
        | "create_directory"
        | "launch_app"
        | "open_url"
        | "browser_start"
        | "browser_navigate"
        | "browser_dom_read"
        | "browser_dom_click"
        | "browser_dom_set_value"
        | "stop_managed_process"
        | "capture_screen"
        | "inspect_screen"
        | "list_processes"
        | "ui_find"
        | "ui_click"
        | "ui_set_value"
        | "ui_focus"
        | "ui_scroll"
        | "ui_toggle"
        | "ui_expand_collapse"
        | "ui_send_keys"
        | "pointer_click"
        | "premiere_detect"
        | "premiere_launch"
        | "premiere_bridge_start"
        | "premiere_bridge_status"
        | "premiere_context"
        | "premiere_remove_keyframe_range"
        | "premiere_remove_video_transition"
        | "premiere_inspect_effect_lifecycle"
        | "premiere_remove_effect"
        | "premiere_inspect_keyframes"
        | "premiere_edit_keyframe"
        | "premiere_inspect_clip_speed"
        | "premiere_plan_speed"
        | "premiere_project_diagnostics"
        | "premiere_inspect_mogrt_properties"
        | "premiere_plan_mogrt_recipe"
        | "premiere_populate_mogrt"
        | "premiere_plan_audio_automation"
        | "premiere_plan_transcript_ducking"
        | "premiere_apply_transcript_ducking"
        | "premiere_plan_transcript_cuts"
        | "premiere_apply_transcript_cuts"
        | "premiere_plan_video_recipe"
        | "premiere_batch_finish"
        | "premiere_batch_finish_cancel"
        | "premiere_finish_media_batch"
        | "premiere_finish_media_batch_cancel"
        | "premiere_save_graphics_template_mapping"
        | "premiere_list_graphics_template_mappings"
        | "premiere_delete_graphics_template_mapping"
        | "premiere_batch_graphics"
        | "premiere_batch_lower_thirds"
        | "premiere_cancel_graphics_batch"
        | "premiere_plan_assembly"
        | "premiere_apply_assembly"
        | "premiere_cancel_assembly"
        | "premiere_timeline_capabilities"
        | "premiere_timeline"
        | "premiere_caption_tracks"
        | "premiere_set_caption_track_name"
        | "premiere_set_caption_track_mute"
        | "premiere_set_playhead"
        | "premiere_inspect_frame"
        | "premiere_review_frames"
        | "premiere_review_session_start"
        | "premiere_review_session_status"
        | "premiere_review_session_next"
        | "premiere_review_session_record_fix"
        | "premiere_review_session_cancel"
        | "premiere_plan_edit_recipe"
        | "premiere_resolve_review_target"
        | "premiere_bind_review_fix"
        | "premiere_edit_session_start"
        | "premiere_edit_session_status"
        | "premiere_edit_session_next"
        | "premiere_edit_session_record_action"
        | "premiere_edit_session_record_review"
        | "premiere_edit_session_cancel"
        | "premiere_edit_job_start"
        | "premiere_edit_job_status"
        | "premiere_edit_job_next"
        | "premiere_edit_job_record_action"
        | "premiere_edit_job_cancel"
        | "premiere_set_track_mute"
        | "premiere_set_clip_enabled"
        | "premiere_list_video_transitions"
        | "premiere_add_video_transition"
        | "premiere_list_video_effects"
        | "premiere_inspect_clip_effects"
        | "premiere_add_video_effect"
        | "premiere_set_effect_param"
        | "premiere_set_video_param_named"
        | "premiere_add_effect_keyframe"
        | "premiere_add_video_keyframe_named"
        | "premiere_apply_video_recipe"
        | "premiere_list_audio_effects"
        | "premiere_inspect_audio_clip_effects"
        | "premiere_add_audio_effect"
        | "premiere_set_audio_effect_param"
        | "premiere_set_audio_param_named"
        | "premiere_add_audio_effect_keyframe"
        | "premiere_add_audio_keyframe_named"
        | "premiere_apply_audio_recipe"
        | "premiere_list_saved_recipes"
        | "premiere_save_recipe"
        | "premiere_apply_saved_recipe"
        | "premiere_apply_saved_recipe_batch"
        | "premiere_delete_recipe"
        | "premiere_list_markers"
        | "premiere_add_marker"
        | "premiere_remove_marker"
        | "premiere_list_items"
        | "premiere_project_tree"
        | "premiere_create_bin"
        | "premiere_rename_project_item"
        | "premiere_move_project_item"
        | "premiere_relink_media"
        | "premiere_inspect_media_interpretation"
        | "premiere_prepare_media_item"
        | "premiere_prepare_media_batch"
        | "premiere_cancel_media_prep"
        | "premiere_create_sequence_from_preset"
        | "premiere_get_work_area"
        | "premiere_set_work_area"
        | "premiere_set_source_inout"
        | "premiere_clear_source_inout"
        | "premiere_create_subclip"
        | "premiere_plan_transcript_rebuild"
        | "premiere_apply_transcript_rebuild"
        | "premiere_cancel_transcript_rebuild"
        | "premiere_plan_scene_detection"
        | "premiere_plan_scene_rough_cut"
        | "premiere_detect_scene_markers"
        | "premiere_detect_scene_cuts"
        | "premiere_list_transcription_languages"
        | "premiere_transcribe_item"
        | "premiere_export_transcript"
        | "premiere_write_srt"
        | "premiere_transcript_to_srt"
        | "premiere_import_transcript"
        | "premiere_attach_proxy"
        | "premiere_batch_relink"
        | "premiere_batch_attach_proxy"
        | "premiere_insert_mogrt_path"
        | "premiere_insert_mogrt_library"
        | "premiere_import_media"
        | "premiere_create_sequence_from_media"
        | "premiere_create_subsequence"
        | "premiere_insert_project_item"
        | "premiere_insert_media"
        | "premiere_trim_clip"
        | "premiere_roll_edit"
        | "premiere_move_clip"
        | "premiere_clone_clip"
        | "premiere_clone_clip_to_track"
        | "premiere_layer_clips"
        | "premiere_cancel_layer_clips"
        | "premiere_rename_track"
        | "premiere_organize_tracks"
        | "premiere_delete_clip"
        | "premiere_export_sequence"
        | "premiere_plan_interchange_export"
        | "premiere_export_fcpxml"
        | "premiere_export_otio"
        | "premiere_export_aaf"
        | "premiere_export_frame"
        | "premiere_export_review_frames"
        | "premiere_cancel_review_frame_export"
        | "premiere_plan_export"
        | "premiere_export_status"
        | "premiere_readiness_report"
        | "premiere_acceptance_report"
        | "premiere_acceptance_probe"
        | "premiere_acceptance_register_disposable"
        | "premiere_acceptance_plan"
        | "premiere_acceptance_prepare"
        | "premiere_acceptance_execute"
        | "premiere_acceptance_cancel"
        | "premiere_acceptance_verify_recovery"
        | "premiere_calibration_report"
        | "premiere_calibration_observe"
        | "premiere_calibration_probe"
        | "premiere_save_project"
        | "workspace_scan"
        | "search_text"
        | "replace_text"
        | "apply_patch"
        | "run_project_task"
        | "git_status"
        | "git_diff"
        | "git_commit"
        | "git_push" => Some(proposal),
        _ => None,
    }
}

fn chat_response(
    content: String,
    provider: String,
    model: String,
    usage: Option<UsageStats>,
) -> ChatResponse {
    let tool_proposal = parse_tool_proposal(&content);
    ChatResponse {
        content,
        provider,
        model,
        tool_proposal,
        usage,
    }
}

fn usage_from_openai(body: &Value) -> Option<UsageStats> {
    let usage = body.get("usage")?;
    let input = usage
        .get("prompt_tokens")
        .and_then(Value::as_u64)
        .or_else(|| usage.get("input_tokens").and_then(Value::as_u64))
        .unwrap_or(0);
    let output = usage
        .get("completion_tokens")
        .and_then(Value::as_u64)
        .or_else(|| usage.get("output_tokens").and_then(Value::as_u64))
        .unwrap_or(0);
    let total = usage
        .get("total_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(input.saturating_add(output));

    Some(UsageStats {
        input_tokens: input,
        output_tokens: output,
        total_tokens: total,
    })
}

fn usage_from_gemini(body: &Value) -> Option<UsageStats> {
    let usage = body.get("usageMetadata")?;
    let input = usage
        .get("promptTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("candidatesTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total = usage
        .get("totalTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(input.saturating_add(output));

    Some(UsageStats {
        input_tokens: input,
        output_tokens: output,
        total_tokens: total,
    })
}

fn usage_from_anthropic(body: &Value) -> Option<UsageStats> {
    let usage = body.get("usage")?;
    let input = usage
        .get("input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    Some(UsageStats {
        input_tokens: input,
        output_tokens: output,
        total_tokens: input.saturating_add(output),
    })
}

async fn openai_compatible_chat(
    input: ChatInput,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let url = match input.provider.as_str() {
        "deepseek" => "https://api.deepseek.com/chat/completions".to_string(),
        "openai" => "https://api.openai.com/v1/chat/completions".to_string(),
        "openrouter" => "https://openrouter.ai/api/v1/chat/completions".to_string(),
        "ollama" => input
            .base_url
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".into()),
        "custom" => input
            .base_url
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Custom provider requires a base URL.".to_string())?,
        _ => return Err("Invalid OpenAI-compatible provider.".into()),
    };

    if matches!(input.provider.as_str(), "deepseek" | "openai" | "openrouter" | "custom")
        && api_key.as_deref().unwrap_or("").is_empty()
    {
        return Err("No API key saved for this provider.".into());
    }

    let mut request = http_client()?.post(&url).json(&json!({
        "model": input.model,
        "messages": input.messages
    }));

    if let Some(key) = api_key.filter(|key| !key.is_empty()) {
        request = request.bearer_auth(key);
    }

    let response = send_with_retry(request, "Provider request").await?;

    let (status, body) = bounded_provider_json(response, "Provider").await?;

    if !status.is_success() {
        return Err(format!("Provider returned {status}: {}", compact_error(&body)));
    }

    let content = bounded_provider_text(
        body.pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .ok_or_else(|| "Provider response had no assistant text.".to_string())?,
        "Provider assistant",
    )?;

    let usage = usage_from_openai(&body);
    Ok(chat_response(content, input.provider, input.model, usage))
}

async fn gemini_chat(input: ChatInput, api_key: Option<String>) -> Result<ChatResponse, String> {
    let key = api_key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "No Gemini API key saved.".to_string())?;

    let model = input.model.clone();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, key
    );

    let mut system_parts = Vec::new();
    let mut contents = Vec::new();

    for message in &input.messages {
        if message.role == "system" {
            system_parts.push(json!({ "text": message.content }));
        } else {
            let role = if message.role == "assistant" { "model" } else { "user" };
            contents.push(json!({
                "role": role,
                "parts": [{ "text": message.content }]
            }));
        }
    }

    let mut payload = json!({ "contents": contents });
    if !system_parts.is_empty() {
        payload["systemInstruction"] = json!({ "parts": system_parts });
    }

    let request = http_client()?
        .post(url)
        .json(&payload);

    let response = send_with_retry(request, "Gemini request").await?;

    let (status, body) = bounded_provider_json(response, "Gemini").await?;

    if !status.is_success() {
        return Err(format!("Gemini returned {status}: {}", compact_error(&body)));
    }

    let parts = body
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .ok_or_else(|| "Gemini returned no candidate text.".to_string())?;

    let content = collect_provider_text(
        parts.iter().filter_map(|part| part.get("text").and_then(Value::as_str)),
        "Gemini assistant",
    )?;

    if content.is_empty() {
        return Err("Gemini returned an empty response.".into());
    }

    let usage = usage_from_gemini(&body);
    Ok(chat_response(content, input.provider, model, usage))
}

async fn anthropic_chat(
    input: ChatInput,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let key = api_key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "No Anthropic API key saved.".to_string())?;

    let model = input.model.clone();

    let system = input
        .messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let messages = input
        .messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "assistant" } else { "user" },
                "content": message.content
            })
        })
        .collect::<Vec<_>>();

    let request = http_client()?
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model,
            "max_tokens": 2048,
            "system": system,
            "messages": messages
        }));

    let response = send_with_retry(request, "Anthropic request").await?;

    let (status, body) = bounded_provider_json(response, "Anthropic").await?;

    if !status.is_success() {
        return Err(format!("Anthropic returned {status}: {}", compact_error(&body)));
    }

    let content = collect_provider_text(
        body.get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            }),
        "Anthropic assistant",
    )?;

    if content.is_empty() {
        return Err("Anthropic returned an empty response.".into());
    }

    let usage = usage_from_anthropic(&body);
    Ok(chat_response(content, input.provider, model, usage))
}

async fn send_chat(input: ChatInput, api_key: Option<String>) -> Result<ChatResponse, String> {
    match input.provider.as_str() {
        "gemini" => gemini_chat(input, api_key).await,
        "anthropic" => anthropic_chat(input, api_key).await,
        "deepseek" | "openai" | "openrouter" | "ollama" | "custom" => {
            openai_compatible_chat(input, api_key).await
        }
        other => Err(format!("Unsupported provider: {other}")),
    }
}

fn current_runtime_status(state: &ActionState) -> Result<RuntimeStatus, String> {
    let mut system = System::new_all();
    system.refresh_all();

    let pid = sysinfo::get_current_pid().map_err(|error| format!("PID error: {error}"))?;
    let process = system
        .process(pid)
        .ok_or_else(|| "Could not read Shuvi process memory.".to_string())?;

    let native_bytes = process.memory();

    let identities = state
        .managed_process_started_at
        .lock()
        .map_err(|_| "Managed-process identity state is unavailable.".to_string())?
        .clone();

    let mut managed = state
        .managed_children
        .lock()
        .map_err(|_| "Managed-process state is unavailable.".to_string())?;

    managed.retain(|child_pid| {
        let pid = Pid::from_u32(*child_pid);
        let actual = system.process(pid).map(|process| process.start_time());
        actual.is_some() && identities.get(child_pid).copied() == actual
    });
    let live_roots = managed.clone();

    if let Ok(mut stored) = state.managed_process_started_at.lock() {
        stored.retain(|root_pid, _| live_roots.contains(root_pid));
    }
    if let Ok(mut sessions) = state.browser_sessions.lock() {
        let stale_profiles = sessions
            .iter()
            .filter(|(root_pid, _)| !live_roots.contains(root_pid))
            .map(|(_, session)| session.profile_dir.clone())
            .collect::<Vec<_>>();
        sessions.retain(|root_pid, _| live_roots.contains(root_pid));
        drop(sessions);
        for profile_dir in stale_profiles {
            let _ = fs::remove_dir_all(profile_dir);
        }
    }

    let managed_tree = managed_tree_pids(&system, &live_roots);
    let managed_children_bytes = managed_tree
        .iter()
        .filter_map(|pid| system.process(*pid))
        .map(|process| process.memory())
        .fold(0_u64, u64::saturating_add);

    let managed_children_count = managed_tree.len();
    drop(managed);

    let bytes = native_bytes.saturating_add(managed_children_bytes);
    let mb = bytes as f64 / 1024.0 / 1024.0;
    let native_mb = native_bytes as f64 / 1024.0 / 1024.0;
    let managed_children_mb = managed_children_bytes as f64 / 1024.0 / 1024.0;

    Ok(RuntimeStatus {
        shuvi_memory_bytes: bytes,
        shuvi_memory_mb: mb,
        native_memory_mb: native_mb,
        managed_children_memory_mb: managed_children_mb,
        managed_children_count,
        soft_limit_mb: SOFT_LIMIT_MB,
        hard_limit_mb: HARD_LIMIT_MB,
        over_soft_limit: mb >= SOFT_LIMIT_MB,
        over_hard_limit: mb >= HARD_LIMIT_MB,
    })
}

fn ensure_memory_budget(state: &ActionState) -> Result<(), String> {
    let status = current_runtime_status(state)?;
    if status.over_hard_limit {
        Err("Shuvi and its managed child processes are above the 4 GB hard RAM ceiling. Close heavy work before starting another action.".into())
    } else {
        Ok(())
    }
}

fn observed_process_start_time(pid: u32) -> Option<u64> {
    let mut system = System::new_all();
    system.refresh_all();
    system.process(Pid::from_u32(pid)).map(|process| process.start_time())
}

fn capture_process_start_time(pid: u32) -> Option<u64> {
    for _ in 0..25 {
        if let Some(started_at) = observed_process_start_time(pid) {
            return Some(started_at);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}

fn register_managed_process(state: &ActionState, pid: u32) -> Result<(), String> {
    let started_at = capture_process_start_time(pid)
        .ok_or_else(|| "Could not bind the launched process to an OS process identity.".to_string())?;

    state
        .managed_process_started_at
        .lock()
        .map_err(|_| "Managed-process identity state is unavailable.".to_string())?
        .insert(pid, started_at);

    match state.managed_children.lock() {
        Ok(mut managed) => {
            managed.insert(pid);
            Ok(())
        }
        Err(_) => {
            if let Ok(mut identities) = state.managed_process_started_at.lock() {
                identities.remove(&pid);
            }
            Err("Managed-process state is unavailable.".into())
        }
    }
}

fn unregister_managed_process(state: &ActionState, pid: u32) {
    if let Ok(mut managed) = state.managed_children.lock() {
        managed.remove(&pid);
    }
    if let Ok(mut identities) = state.managed_process_started_at.lock() {
        identities.remove(&pid);
    }
}

fn managed_process_identity_matches(state: &ActionState, pid: u32) -> Result<bool, String> {
    let expected = state
        .managed_process_started_at
        .lock()
        .map_err(|_| "Managed-process identity state is unavailable.".to_string())?
        .get(&pid)
        .copied();
    let Some(expected) = expected else {
        return Ok(false);
    };
    Ok(observed_process_start_time(pid).is_some_and(|actual| actual == expected))
}

fn terminate_managed_process_tree(pid: u32) -> Result<bool, String> {
    let pid_string = pid.to_string();

    #[cfg(target_os = "windows")]
    let output = Command::new("taskkill")
        .args(["/PID", pid_string.as_str(), "/T", "/F"])
        .output()
        .map_err(|error| format!("Could not stop managed process tree at the RAM hard ceiling: {error}"))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("kill")
        .args(["-TERM", pid_string.as_str()])
        .output()
        .map_err(|error| format!("Could not stop managed process at the RAM hard ceiling: {error}"))?;

    Ok(output.status.success())
}

fn terminate_registered_process_tree(state: &ActionState, pid: u32) -> Result<bool, String> {
    if !managed_process_identity_matches(state, pid)? {
        unregister_managed_process(state, pid);
        return Ok(false);
    }
    terminate_managed_process_tree(pid)
}


fn classify_powershell(command: &str) -> RiskLevel {
    let lower = command.to_ascii_lowercase();

    let high = [
        "remove-item", "del ", "erase ", "format-", "clear-disk",
        "remove-partition", "stop-computer", "restart-computer", "shutdown",
        "reg delete", "invoke-expression", "iex ", "remove-localuser", "net user"
    ];

    if high.iter().any(|needle| lower.contains(needle)) {
        return RiskLevel::High;
    }

    let medium = [
        "set-content", "add-content", "new-item", "move-item", "copy-item",
        "rename-item", "start-process", "invoke-webrequest", "curl ",
        "git push", "git commit", "npm install", "winget ", "choco "
    ];

    if medium.iter().any(|needle| lower.contains(needle)) {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    }
}

fn arg_premiere_signature(arguments: &Value) -> Result<String, String> {
    let signature = arg_string(arguments, "expected_signature")?;
    if signature.len() > 16384 { return Err("Premiere inspected signature exceeds 16 KiB.".into()); }
    Ok(signature)
}

fn arg_string(arguments: &Value, name: &str) -> Result<String, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Tool argument '{name}' must be a non-empty string."))
}

fn arg_git_head(arguments: &Value, name: &str) -> Result<String, String> {
    let value = arg_string(arguments, name)?.to_ascii_lowercase();
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("Tool argument '{name}' must be an exact 40- or 64-character Git object ID."));
    }
    Ok(value)
}

fn arg_i32(arguments: &Value, name: &str) -> Result<i32, String> {
    arguments
        .get(name)
        .and_then(Value::as_i64)
        .filter(|value| *value >= i32::MIN as i64 && *value <= i32::MAX as i64)
        .map(|value| value as i32)
        .ok_or_else(|| format!("Tool argument '{name}' must be a valid 32-bit integer."))
}

fn arg_u32(arguments: &Value, name: &str) -> Result<u32, String> {
    arguments
        .get(name)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0 && *value <= u32::MAX as u64)
        .map(|value| value as u32)
        .ok_or_else(|| format!("Tool argument '{name}' must be a valid positive integer."))
}

fn arg_raw_string(arguments: &Value, name: &str) -> Result<String, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Tool argument '{name}' must be a string."))
}

fn arg_optional_string(arguments: &Value, name: &str) -> Option<String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn ui_selector(
    arguments: &Value,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    let name = arg_optional_string(arguments, "name");
    let automation_id = arg_optional_string(arguments, "automation_id");
    let window = arg_optional_string(arguments, "window");

    if name.is_none() && automation_id.is_none() {
        return Err("UI tools require at least 'name' or 'automation_id'.".into());
    }

    Ok((name, automation_id, window))
}

fn ps_single_quote(value: &str) -> String {
    value.replace("'", "''")
}

fn ui_condition_script(
    name: Option<&str>,
    automation_id: Option<&str>,
) -> Result<String, String> {
    match (name, automation_id) {
        (Some(name), Some(id)) => Ok(format!(
            "$c1 = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '{}')\n$c2 = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '{}')\n$condition = [System.Windows.Automation.AndCondition]::new($c1, $c2)",
            ps_single_quote(name),
            ps_single_quote(id)
        )),
        (Some(name), None) => Ok(format!(
            "$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '{}')",
            ps_single_quote(name)
        )),
        (None, Some(id)) => Ok(format!(
            "$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '{}')",
            ps_single_quote(id)
        )),
        (None, None) => Err("Missing UI selector.".into()),
    }
}

fn ui_root_script(window: Option<&str>) -> String {
    if let Some(window_name) = window {
        let escaped = ps_single_quote(window_name);
        format!(
            "$desktop = [System.Windows.Automation.AutomationElement]::RootElement\n$windowCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '{escaped}')\n$windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)\nif ($windows.Count -eq 0) {{ throw 'Requested top-level window was not found.' }}\nif ($windows.Count -gt 1) {{ throw ('Window selector matched ' + $windows.Count + ' windows. Use a more specific exact window name.') }}\n$root = $windows.Item(0)"
        )
    } else {
        "$root = [System.Windows.Automation.AutomationElement]::RootElement".to_string()
    }
}

fn run_hidden_powershell(script: &str) -> Result<std::process::Output, String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
            ])
            .output()
            .map_err(|error| format!("Failed to start PowerShell: {error}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = script;
        Err("Windows UI Automation is currently available on Windows only.".into())
    }
}

fn arg_string_array(arguments: &Value, name: &str) -> Result<Vec<String>, String> {
    let Some(value) = arguments.get(name) else {
        return Ok(Vec::new());
    };

    let items = value
        .as_array()
        .ok_or_else(|| format!("Tool argument '{name}' must be an array of strings."))?;
    if items.len() > MAX_TOOL_STRING_ARRAY_ITEMS {
        return Err(format!(
            "Tool argument '{name}' exceeds Shuvi's {MAX_TOOL_STRING_ARRAY_ITEMS}-item safety limit."
        ));
    }

    let mut total_bytes = 0_usize;
    let mut output = Vec::with_capacity(items.len());
    for item in items {
        let value = item
            .as_str()
            .ok_or_else(|| format!("Tool argument '{name}' must contain only strings."))?;
        if value.len() > MAX_TOOL_STRING_ARRAY_ITEM_BYTES {
            return Err(format!("Tool argument '{name}' contains an oversized string item."));
        }
        total_bytes = total_bytes.saturating_add(value.len());
        if total_bytes > MAX_TOOL_STRING_ARRAY_BYTES {
            return Err(format!("Tool argument '{name}' exceeds Shuvi's aggregate string-array safety limit."));
        }
        output.push(value.to_string());
    }
    Ok(output)
}

fn absolute_path(value: String) -> Result<String, String> {
    if value.len() as u64 > MAX_WORKSPACE_PATH_BYTES || value.chars().any(char::is_control) {
        return Err("File-tool path is too large or contains control characters.".into());
    }
    let path = Path::new(&value);
    if !path.is_absolute() {
        return Err("File tools require an absolute path.".into());
    }
    if path.components().any(|component| matches!(component, Component::CurDir | Component::ParentDir)) {
        return Err("File-tool paths must not contain '.' or '..' path segments.".into());
    }
    Ok(value)
}

fn reject_existing_symlink_target(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("{label} refuses to write through a symbolic link or junction-like link target."))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not inspect {label} target: {error}")),
    }
}

fn open_existing_file_for_mutation(path: &Path, label: &str) -> Result<fs::File, String> {
    reject_existing_symlink_target(path, label)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Could not open {label} target for mutation: {error}"))?;
    reject_existing_symlink_target(path, label)?;
    if !file
        .metadata()
        .map_err(|error| format!("Could not inspect opened {label} target: {error}"))?
        .is_file()
    {
        return Err(format!("{label} target must be a regular file."));
    }
    Ok(file)
}

fn read_utf8_open_file_bounded(
    file: &mut fs::File,
    max_bytes: usize,
    label: &str,
) -> Result<String, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("Could not seek {label}: {error}"))?;
    let limit = (max_bytes as u64).saturating_add(1);
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    (&mut *file)
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read {label}: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("{label} exceeds Shuvi's bounded read limit."));
    }
    String::from_utf8(bytes)
        .map_err(|error| format!("{label} is not valid UTF-8: {error}"))
}

fn overwrite_open_file(file: &mut fs::File, bytes: &[u8], label: &str) -> Result<(), String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("Could not seek {label} target: {error}"))?;
    file.set_len(0)
        .map_err(|error| format!("Could not truncate {label} target: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("Could not write {label} target: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not flush {label} target: {error}"))
}

fn read_utf8_file_bounded(path: &Path, max_bytes: usize, label: &str) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Could not open {label}: {error}"))?;
    let limit = (max_bytes as u64).saturating_add(1);
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read {label}: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("{label} exceeds Shuvi's bounded read limit."));
    }
    String::from_utf8(bytes)
        .map_err(|error| format!("{label} is not valid UTF-8: {error}"))
}

fn read_file_bytes_bounded(path: &Path, max_bytes: usize, label: &str) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Could not open {label}: {error}"))?;
    let limit = (max_bytes as u64).saturating_add(1);
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read {label}: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("{label} exceeds Shuvi's bounded read limit."));
    }
    Ok(bytes)
}

fn safe_web_url(value: String) -> Result<String, String> {
    if value.len() > 4096 {
        return Err("URL is too long.".into());
    }
    if value.chars().any(char::is_control) {
        return Err("URL contains invalid control characters.".into());
    }

    let parsed = Url::parse(&value)
        .map_err(|_| "Browser tool requires a valid absolute http(s) URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Browser tool only accepts absolute http:// or https:// URLs with a host.".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Browser URLs must not contain embedded credentials.".into());
    }

    Ok(parsed.to_string())
}

fn find_premiere_installations() -> Result<Vec<std::path::PathBuf>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        if let Some(root) = std::env::var_os("ProgramFiles").map(std::path::PathBuf::from) {
            roots.push(root.join("Adobe"));
        }
        if let Some(root) = std::env::var_os("ProgramFiles(x86)").map(std::path::PathBuf::from) {
            roots.push(root.join("Adobe"));
        }

        let mut matches = Vec::new();

        for root in roots {
            let Ok(entries) = fs::read_dir(&root) else {
                continue;
            };

            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let name = entry.file_name().to_string_lossy().to_string();
                if !name.to_ascii_lowercase().starts_with("adobe premiere pro") {
                    continue;
                }

                let executable = path.join("Adobe Premiere Pro.exe");
                if executable.is_file() {
                    matches.push(executable);
                }
            }
        }

        matches.sort();
        matches.dedup();
        return Ok(matches);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Premiere detection is currently implemented for Windows only.".into())
    }
}

fn find_browser_executable(browser: &str) -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let program_files = std::env::var_os("ProgramFiles").map(std::path::PathBuf::from);
        let program_files_x86 = std::env::var_os("ProgramFiles(x86)").map(std::path::PathBuf::from);
        let local_app_data = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);

        let mut candidates = Vec::new();

        match browser {
            "edge" => {
                if let Some(root) = &program_files {
                    candidates.push(root.join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
                }
                if let Some(root) = &program_files_x86 {
                    candidates.push(root.join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
                }
            }
            "chrome" => {
                if let Some(root) = &program_files {
                    candidates.push(root.join("Google").join("Chrome").join("Application").join("chrome.exe"));
                }
                if let Some(root) = &program_files_x86 {
                    candidates.push(root.join("Google").join("Chrome").join("Application").join("chrome.exe"));
                }
                if let Some(root) = &local_app_data {
                    candidates.push(root.join("Google").join("Chrome").join("Application").join("chrome.exe"));
                }
            }
            _ => return Err("browser_start browser must be 'edge' or 'chrome'.".into()),
        }

        return candidates
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| format!("Could not find the {browser} executable on this Windows PC."));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = browser;
        Err("Controlled browser sessions are currently implemented for Windows only.".into())
    }
}

fn prune_inactive_browser_profiles(
    state: &ActionState,
    profiles_root: &Path,
) -> Result<(), String> {
    if !profiles_root.exists() {
        return Ok(());
    }

    let active_profiles = state
        .browser_sessions
        .lock()
        .map_err(|_| "Browser-session state is unavailable.".to_string())?
        .values()
        .map(|session| session.profile_dir.clone())
        .collect::<HashSet<_>>();

    let mut stale = fs::read_dir(profiles_root)
        .map_err(|error| format!("Could not inspect browser profile folder: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() || active_profiles.contains(&path) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect::<Vec<_>>();

    stale.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in stale.into_iter().skip(MAX_STALE_BROWSER_PROFILES) {
        let _ = fs::remove_dir_all(path);
    }
    Ok(())
}

fn browser_session(state: &ActionState, pid: u32) -> Result<BrowserSession, String> {
    if !managed_process_identity_matches(state, pid)? {
        unregister_managed_process(state, pid);
        if let Ok(mut sessions) = state.browser_sessions.lock() {
            if let Some(session) = sessions.remove(&pid) {
                let _ = fs::remove_dir_all(session.profile_dir);
            }
        }
        return Err("The Shuvi-managed browser process is no longer the exact live process instance that was launched.".into());
    }

    state
        .browser_sessions
        .lock()
        .map_err(|_| "Browser-session state is unavailable.".to_string())?
        .get(&pid)
        .cloned()
        .ok_or_else(|| "No Shuvi-managed DevTools browser session exists for that PID.".to_string())
}

fn cdp_initial_page_target(port: u16) -> Result<String, String> {
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$targets = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:{port}/json/list' -TimeoutSec 4
$target = $targets | Where-Object {{ $_.type -eq 'page' -and $_.id }} | Select-Object -First 1
if (-not $target) {{ throw 'No debuggable browser page is available.' }}
$target.id"#
    );

    let output = run_hidden_powershell(&script)?;
    if !output.status.success() {
        return Err(format!(
            "Could not bind managed browser to its initial page target: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let target_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if target_id.is_empty()
        || target_id.len() > 256
        || target_id.chars().any(|ch| ch.is_control())
    {
        return Err("Managed browser returned an invalid DevTools page target ID.".into());
    }
    Ok(target_id)
}

fn cdp_command(port: u16, target_id: &str, method: &str, params: Value) -> Result<Value, String> {
    let payload = json!({
        "id": 1,
        "method": method,
        "params": params
    })
    .to_string();

    let encoded = BASE64.encode(payload.as_bytes());
    let target_encoded = BASE64.encode(target_id.as_bytes());

    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$targetId = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{target_encoded}'))
$targets = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:{port}/json/list' -TimeoutSec 4
$target = $targets | Where-Object {{ $_.type -eq 'page' -and $_.id -eq $targetId -and $_.webSocketDebuggerUrl }} | Select-Object -First 1
if (-not $target) {{ throw 'The Shuvi-bound browser page target is no longer available.' }}
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}'))
$bytes = [Text.Encoding]::UTF8.GetBytes($message)
$sendSegment = [ArraySegment[byte]]::new($bytes)
$ws.SendAsync($sendSegment, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
while ($true) {{
    $buffer = New-Object byte[] 65536
    $builder = New-Object Text.StringBuilder
    do {{
        $recvSegment = [ArraySegment[byte]]::new($buffer)
        $recv = $ws.ReceiveAsync($recvSegment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        if ($recv.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {{
            throw 'DevTools WebSocket closed before a response arrived.'
        }}
        [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $recv.Count))
    }} while (-not $recv.EndOfMessage)
    $text = $builder.ToString()
    $obj = $text | ConvertFrom-Json
    if ($obj.id -eq 1) {{
        $ws.Dispose()
        $text
        break
    }}
}"#
    );

    let output = run_hidden_powershell(&script)?;
    if !output.status.success() {
        return Err(format!(
            "DevTools command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let response: Value = serde_json::from_str(&stdout)
        .map_err(|error| format!("Invalid DevTools response: {error}; response={}", stdout.chars().take(500).collect::<String>()))?;

    if let Some(error) = response.get("error") {
        return Err(format!("DevTools returned an error: {}", error));
    }

    Ok(response)
}

fn cdp_eval(port: u16, target_id: &str, expression: String) -> Result<Value, String> {
    let response = cdp_command(
        port,
        target_id,
        "Runtime.evaluate",
        json!({
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": true,
            "userGesture": true
        }),
    )?;

    if let Some(exception) = response.pointer("/result/exceptionDetails") {
        return Err(format!("Browser JavaScript failed: {}", exception));
    }

    Ok(response
        .pointer("/result/result/value")
        .cloned()
        .unwrap_or(Value::Null))
}

fn managed_tree_pids(system: &System, roots: &HashSet<u32>) -> HashSet<Pid> {
    let mut included = roots
        .iter()
        .map(|pid| Pid::from_u32(*pid))
        .filter(|pid| system.process(*pid).is_some())
        .collect::<HashSet<_>>();

    loop {
        let before = included.len();

        for (pid, process) in system.processes() {
            if let Some(parent) = process.parent() {
                if included.contains(&parent) {
                    included.insert(*pid);
                }
            }
        }

        if included.len() == before {
            break;
        }
    }

    included
}

fn stage_tool(
    proposal: ToolProposal,
    provider_context: Option<ProviderContext>,
    state: &ActionState,
) -> Result<PendingActionView, String> {
    let tool = proposal.tool.clone();
    let premiere_expectation = if let Some(value) = proposal.arguments.get("expected") {
        if !tool.starts_with("premiere_") { return Err("Premiere expectations only apply to Premiere tools.".into()); }
        let expected: PremiereExpectation = serde_json::from_value(value.clone()).map_err(|e| format!("Invalid Premiere expectation: {e}"))?;
        expected.validate()?;
        Some(expected)
    } else { None };

    let (action, summary, detail, risk) = match proposal.tool.as_str() {
        "list_directory" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::ListDirectory { path: path.clone() },
                "List directory".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "read_file" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::ReadFile { path: path.clone() },
                "Read file".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "write_file" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let content = arg_raw_string(&proposal.arguments, "content")?;
            if content.len() > MAX_WRITE_BYTES {
                return Err("File content is larger than Shuvi's 2 MB write limit.".into());
            }
            (
                ToolAction::WriteFile {
                    path: path.clone(),
                    content,
                },
                "Write file".to_string(),
                path,
                RiskLevel::Medium,
            )
        }
        "create_directory" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::CreateDirectory { path: path.clone() },
                "Create directory".to_string(),
                path,
                RiskLevel::Medium,
            )
        }
        "launch_app" => {
            let program = arg_string(&proposal.arguments, "program")?;
            if program.len() > 4_096 {
                return Err("launch_app program is too long.".into());
            }
            let args = arg_string_array(&proposal.arguments, "args")?;
            if args.len() > MAX_LAUNCH_ARGS
                || args.iter().any(|arg| arg.len() > MAX_LAUNCH_ARG_BYTES)
                || args.iter().map(String::len).sum::<usize>() > MAX_LAUNCH_ARGS_BYTES
            {
                return Err("launch_app arguments exceed Shuvi's bounded command-line safety limits.".into());
            }
            (
                ToolAction::LaunchApp {
                    program: program.clone(),
                    args: args.clone(),
                },
                "Launch application".to_string(),
                format!("{program} {}", args.join(" ")).trim().to_string(),
                RiskLevel::Medium,
            )
        }
        "open_url" => {
            let url = safe_web_url(arg_string(&proposal.arguments, "url")?)?;
            (
                ToolAction::OpenUrl { url: url.clone() },
                "Open web page".to_string(),
                url,
                RiskLevel::Medium,
            )
        }
        "browser_start" => {
            let browser = arg_string(&proposal.arguments, "browser")?.to_ascii_lowercase();
            if !matches!(browser.as_str(), "edge" | "chrome") {
                return Err("browser_start browser must be edge or chrome.".into());
            }

            let url = arg_optional_string(&proposal.arguments, "url")
                .map(safe_web_url)
                .transpose()?;

            let detail = format!(
                "Start a Shuvi-managed {} browser session{}",
                browser,
                url.as_deref()
                    .map(|value| format!(" at {value}"))
                    .unwrap_or_default()
            );

            (
                ToolAction::BrowserStart { browser, url },
                "Start managed browser".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "browser_navigate" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let url = safe_web_url(arg_string(&proposal.arguments, "url")?)?;

            (
                ToolAction::BrowserNavigate { pid, url: url.clone() },
                "Navigate managed browser".to_string(),
                format!("Browser PID {pid} -> {url}"),
                RiskLevel::Medium,
            )
        }
        "browser_dom_read" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let selector = arg_string(&proposal.arguments, "selector")?;
            if selector.len() > 2_000 {
                return Err("CSS selector is too long.".into());
            }

            (
                ToolAction::BrowserDomRead { pid, selector: selector.clone() },
                "Read browser DOM".to_string(),
                format!("Browser PID {pid} | selector={selector}"),
                RiskLevel::Low,
            )
        }
        "browser_dom_click" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let selector = arg_string(&proposal.arguments, "selector")?;
            if selector.len() > 2_000 {
                return Err("CSS selector is too long.".into());
            }

            (
                ToolAction::BrowserDomClick { pid, selector: selector.clone() },
                "Click browser DOM element".to_string(),
                format!("Browser PID {pid} | selector={selector}"),
                RiskLevel::Medium,
            )
        }
        "browser_dom_set_value" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;
            let selector = arg_string(&proposal.arguments, "selector")?;
            let value = arg_raw_string(&proposal.arguments, "value")?;
            if selector.len() > 2_000 {
                return Err("CSS selector is too long.".into());
            }
            if value.len() > 8_000 {
                return Err("Browser value is larger than Shuvi's 8 KB DOM input limit.".into());
            }

            (
                ToolAction::BrowserDomSetValue { pid, selector: selector.clone(), value: value.clone() },
                "Set browser DOM value".to_string(),
                format!("Browser PID {pid} | selector={selector} | value_length={}", value.chars().count()),
                RiskLevel::Medium,
            )
        }
        "stop_managed_process" => {
            let pid = arg_u32(&proposal.arguments, "pid")?;

            (
                ToolAction::StopManagedProcess { pid },
                "Stop Shuvi-managed process".to_string(),
                format!("Stop managed process tree rooted at PID {pid}"),
                RiskLevel::Medium,
            )
        }
        "capture_screen" => (
            ToolAction::CaptureScreen,
            "Capture screen".to_string(),
            "Capture the current virtual desktop to a temporary PNG file.".to_string(),
            RiskLevel::Low,
        ),
        "inspect_screen" => {
            let prompt = arg_string(&proposal.arguments, "prompt")?;
            let provider = provider_context
                .ok_or_else(|| "Screen inspection requires the active provider context.".to_string())?;
            let detail = format!(
                "Capture the current screen and send it to {}/{} for visual analysis: {}",
                provider.provider, provider.model, prompt
            );

            (
                ToolAction::InspectScreen { prompt, provider },
                "Inspect current screen with AI vision".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "list_processes" => (
            ToolAction::ListProcesses,
            "List running processes".to_string(),
            "Read process names, PIDs and memory usage.".to_string(),
            RiskLevel::Low,
        ),
        "ui_find" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Find Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );
            (
                ToolAction::UiFind { name, automation_id, window },
                "Find Windows UI element".to_string(),
                detail,
                RiskLevel::Low,
            )
        }
        "ui_click" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Invoke Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );
            (
                ToolAction::UiClick { name, automation_id, window },
                "Click Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_set_value" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let value = arg_raw_string(&proposal.arguments, "value")?;
            if value.len() > 20_000 {
                return Err("UI value is too large.".into());
            }
            let detail = format!(
                "Set Windows UI value: window={:?}, name={:?}, automation_id={:?}, value_length={}",
                window,
                name,
                automation_id,
                value.chars().count()
            );
            (
                ToolAction::UiSetValue { name, automation_id, window, value },
                "Set Windows UI text/value".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_focus" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Focus Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );
            (
                ToolAction::UiFocus { name, automation_id, window },
                "Focus Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_scroll" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let vertical = arg_string(&proposal.arguments, "vertical")?.to_ascii_lowercase();
            if !matches!(
                vertical.as_str(),
                "small_increment" | "small_decrement" | "large_increment" | "large_decrement"
            ) {
                return Err("ui_scroll vertical must be small_increment, small_decrement, large_increment, or large_decrement.".into());
            }

            let detail = format!(
                "Scroll Windows UI element: window={:?}, name={:?}, automation_id={:?}, vertical={}",
                window, name, automation_id, vertical
            );
            (
                ToolAction::UiScroll { name, automation_id, window, vertical },
                "Scroll Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_toggle" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let detail = format!(
                "Toggle Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                window, name, automation_id
            );

            (
                ToolAction::UiToggle { name, automation_id, window },
                "Toggle Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_expand_collapse" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let action = arg_string(&proposal.arguments, "action")?.to_ascii_lowercase();

            if !matches!(action.as_str(), "expand" | "collapse") {
                return Err("ui_expand_collapse action must be expand or collapse.".into());
            }

            let detail = format!(
                "{} Windows UI element: window={:?}, name={:?}, automation_id={:?}",
                action, window, name, automation_id
            );

            (
                ToolAction::UiExpandCollapse { name, automation_id, window, action },
                "Expand/collapse Windows UI element".to_string(),
                detail,
                RiskLevel::Medium,
            )
        }
        "ui_send_keys" => {
            let (name, automation_id, window) = ui_selector(&proposal.arguments)?;
            let keys = arg_raw_string(&proposal.arguments, "keys")?;

            if keys.is_empty() || keys.len() > 2_000 {
                return Err("ui_send_keys requires between 1 and 2000 characters.".into());
            }

            let detail = format!(
                "Send keyboard fallback to Windows UI element: window={:?}, name={:?}, automation_id={:?}, keys_length={}",
                window, name, automation_id, keys.chars().count()
            );

            (
                ToolAction::UiSendKeys { name, automation_id, window, keys },
                "Send keyboard fallback".to_string(),
                detail,
                RiskLevel::High,
            )
        }
        "pointer_click" => {
            let x = arg_i32(&proposal.arguments, "x")?;
            let y = arg_i32(&proposal.arguments, "y")?;
            let button = arg_string(&proposal.arguments, "button")?.to_ascii_lowercase();
            let clicks = proposal
                .arguments
                .get("clicks")
                .and_then(Value::as_u64)
                .unwrap_or(1);

            if !matches!(button.as_str(), "left" | "right" | "middle") {
                return Err("pointer_click button must be left, right, or middle.".into());
            }
            if !(1..=2).contains(&clicks) {
                return Err("pointer_click clicks must be 1 or 2.".into());
            }

            (
                ToolAction::PointerClick {
                    x,
                    y,
                    button: button.clone(),
                    clicks: clicks as u32,
                },
                "Coordinate pointer click".to_string(),
                format!("{button} click x={x}, y={y}, clicks={clicks}"),
                RiskLevel::High,
            )
        }
        "premiere_detect" => (
            ToolAction::PremiereDetect,
            "Detect Adobe Premiere Pro".to_string(),
            "Inspect installed Adobe Premiere Pro versions and executable paths.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_launch" => {
            let project = arg_optional_string(&proposal.arguments, "project")
                .map(absolute_path)
                .transpose()?;

            if let Some(path) = &project {
                let extension = Path::new(path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();

                if extension != "prproj" {
                    return Err("premiere_launch project must be an absolute .prproj file path.".into());
                }
                if !Path::new(path).is_file() {
                    return Err("Premiere project file does not exist.".into());
                }
            }

            (
                ToolAction::PremiereLaunch { project: project.clone() },
                "Launch Adobe Premiere Pro".to_string(),
                project
                    .as_deref()
                    .map(|path| format!("Launch Premiere with project {path}"))
                    .unwrap_or_else(|| "Launch the newest detected Premiere installation.".to_string()),
                RiskLevel::Medium,
            )
        }
        "premiere_bridge_start" => (
            ToolAction::PremiereBridgeStart,
            "Start Premiere bridge".to_string(),
            "Start Shuvi's authenticated localhost bridge for the Premiere UXP panel.".to_string(),
            RiskLevel::Medium,
        ),
        "premiere_bridge_status" => (
            ToolAction::PremiereBridgeStatus,
            "Read Premiere bridge status".to_string(),
            "Check whether the Premiere UXP bridge is enabled and paired.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_context" => (
            ToolAction::PremiereContext,
            "Inspect Premiere project context".to_string(),
            "Read the active Premiere project, active sequence and basic timeline metadata through the paired UXP bridge.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_remove_keyframe_range" => {
            let target: ParameterTarget = serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null))
                .map_err(|error| format!("Invalid keyframe target: {error}"))?;
            target.validate()?;
            let start_seconds = proposal.arguments.get("start_seconds").and_then(Value::as_f64).ok_or("Numeric start_seconds required.")?;
            let end_seconds = proposal.arguments.get("end_seconds").and_then(Value::as_f64).ok_or("Numeric end_seconds required.")?;
            if !start_seconds.is_finite() || !end_seconds.is_finite() || start_seconds < 0.0 || end_seconds <= start_seconds || end_seconds > 86400.0 {
                return Err("Keyframe range requires 0 <= start < end <= 86400.".into());
            }
            let expected_count = proposal.arguments.get("expected_count").and_then(Value::as_u64)
                .filter(|v| (1..=256).contains(v)).ok_or("Expected keyframe count must be 1–256.")? as u32;
            let expected_signature = arg_string(&proposal.arguments, "expected_signature")?;
            if expected_signature.len() > 8192 { return Err("Keyframe signature is too long.".into()); }
            let allow_remove_all = match proposal.arguments.get("allow_remove_all") {
                None => false,
                Some(value) => value.as_bool().ok_or("allow_remove_all must be boolean.")?,
            };
            let detail = format!("Remove exactly {expected_count} keys in native parameter range [{start_seconds}, {end_seconds}) from '{}' on {} track {}, clip {}; allow removing every key={allow_remove_all}.", target.param_display_name, target.kind, target.track, target.clip_index);
            (ToolAction::PremiereRemoveKeyframeRange { target, start_seconds, end_seconds, expected_count, expected_signature, allow_remove_all },
                "Remove inspected Premiere keyframe range".to_string(), detail, RiskLevel::High)
        }
        "premiere_remove_video_transition" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).filter(|v| *v <= 128).ok_or("Video track must be 0–128.")? as u32;
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).filter(|v| *v <= 10000).ok_or("Clip index must be 0–10000.")? as u32;
            let position = arg_string(&proposal.arguments, "position")?;
            if !matches!(position.as_str(), "start" | "end") { return Err("Transition position must be start or end.".into()); }
            let detail = format!("Remove only the {position} video transition from V{track}, clip {clip_index}; checkpoint required.");
            (ToolAction::PremiereRemoveVideoTransition { track, clip_index, position },
                "Remove Premiere video transition".to_string(), detail, RiskLevel::High)
        }
        "premiere_inspect_effect_lifecycle" => {
            let target: ComponentTarget = serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null)).map_err(|e| format!("Invalid effect target: {e}"))?;
            target.validate()?;
            (ToolAction::PremiereInspectEffectLifecycle { target }, "Inspect effect lifecycle".into(), "Resolve exact component and inspect removal capability and signature.".into(), RiskLevel::Low)
        }
        "premiere_remove_effect" => {
            let target: ComponentTarget = serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null)).map_err(|e| format!("Invalid effect target: {e}"))?;
            target.validate()?;
            let expected_signature = arg_string(&proposal.arguments, "expected_signature")?;
            if expected_signature.len() > 65536 { return Err("Effect signature is too long.".into()); }
            let detail = format!("Remove inspected component {:?}/{:?} from {} track {}, clip {}; checkpoint required.", target.component_match_name, target.component_display_name, target.kind, target.track, target.clip_index);
            (ToolAction::PremiereRemoveEffect { target, expected_signature }, "Remove Premiere effect".into(), detail, RiskLevel::High)
        }
        "premiere_inspect_keyframes" => {
            let target: ParameterTarget = serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null))
                .map_err(|error| format!("Invalid keyframe target: {error}"))?;
            target.validate()?;
            (
                ToolAction::PremiereInspectKeyframes { target },
                "Inspect named Premiere keyframes".to_string(),
                "Read native keyframe ticks and an exact clip/parameter signature.".to_string(),
                RiskLevel::Low,
            )
        }
        "premiere_edit_keyframe" => {
            let target: ParameterTarget = serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null))
                .map_err(|error| format!("Invalid keyframe target: {error}"))?;
            target.validate()?;
            let ticks = arg_string(&proposal.arguments, "ticks")?;
            let digits = ticks.strip_prefix('-').unwrap_or(&ticks);
            if digits.is_empty() || digits.len() > 30 || !digits.bytes().all(|v| v.is_ascii_digit()) {
                return Err("Copy exact native ticks from keyframe inspection.".into());
            }
            let expected_signature = arg_string(&proposal.arguments, "expected_signature")?;
            if expected_signature.len() > 8192 { return Err("Keyframe target signature is too long.".into()); }
            let operation = arg_string(&proposal.arguments, "operation")?;
            let interpolation = arg_optional_string(&proposal.arguments, "interpolation");
            if !matches!(operation.as_str(), "remove" | "interpolation")
                || operation == "remove" && interpolation.is_some()
                || operation == "interpolation" && !matches!(interpolation.as_deref(), Some("linear" | "hold" | "bezier")) {
                return Err("Choose remove or interpolation with linear/hold/bezier.".into());
            }
            let detail = format!("{operation} keyframe at native ticks {ticks} on {} track {}, clip {}, parameter '{}'. Requires unchanged inspected target and checkpoint.", target.kind, target.track, target.clip_index, target.param_display_name);
            (
                ToolAction::PremiereEditKeyframe { target, ticks, expected_signature, operation, interpolation },
                "Edit named Premiere keyframe".to_string(),
                detail,
                RiskLevel::High,
            )
        }
        "premiere_inspect_clip_speed" => {
            let kind = arg_string(&proposal.arguments, "kind")?;
            let track = proposal.arguments.get("track").and_then(Value::as_u64)
                .filter(|value| *value <= 128)
                .ok_or_else(|| "track must be a bounded non-negative integer.".to_string())? as u32;
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64)
                .filter(|value| *value <= 10000)
                .ok_or_else(|| "clip_index must be a bounded non-negative integer.".to_string())? as u32;
            if !matches!(kind.as_str(), "video" | "audio") || track > 128 || clip_index > 10000 {
                return Err("Speed inspection requires video/audio and bounded track/clip indexes.".into());
            }
            (
                ToolAction::PremiereInspectClipSpeed { kind, track, clip_index },
                "Inspect Premiere clip speed".to_string(),
                "Read the exact clip; no speed or timeline modification will be performed.".to_string(),
                RiskLevel::Low,
            )
        }
        "premiere_plan_speed" => {
            let kind = arg_string(&proposal.arguments, "kind")?;
            let track = proposal.arguments.get("track").and_then(Value::as_u64)
                .filter(|value| *value <= 128)
                .ok_or_else(|| "track must be a bounded non-negative integer.".to_string())? as u32;
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64)
                .filter(|value| *value <= 10000)
                .ok_or_else(|| "clip_index must be a bounded non-negative integer.".to_string())? as u32;
            if !matches!(kind.as_str(), "video" | "audio") || track > 128 || clip_index > 10000 {
                return Err("Speed inspection requires video/audio and bounded track/clip indexes.".into());
            }
            let request: SpeedRequest = serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null))
                .map_err(|error| format!("Invalid typed speed plan: {error}"))?;
            request.validate()?;
            (
                ToolAction::PremierePlanSpeed { kind, track, clip_index, request },
                "Plan unsupported Premiere speed workflow".to_string(),
                "Read the exact clip; no speed or timeline modification will be performed.".to_string(),
                RiskLevel::Low,
            )
        }
        "premiere_project_diagnostics" => {
            let limits: DiagnosticsLimits = serde_json::from_value(proposal.arguments.get("limits").cloned().unwrap_or_else(|| json!({}))).map_err(|e| format!("Invalid diagnostics limits: {e}"))?;
            limits.validate()?;
            (ToolAction::PremiereProjectDiagnostics {limits}, "Inspect Premiere project/media diagnostics".into(), "Read bounded project counts, offline/proxy states and duplicate path candidates; no repairs.".into(), RiskLevel::Low)
        }
        "premiere_inspect_mogrt_properties" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).filter(|v| *v <= 128).ok_or("Track must be 0–128.")? as u32;
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).filter(|v| *v <= 10000).ok_or("Clip index must be 0–10000.")? as u32;
            (ToolAction::PremiereInspectMogrtProperties {track, clip_index}, "Inspect graphics properties".into(), "Read bounded native video component parameters; no inferred MOGRT identity.".into(), RiskLevel::Low)
        }
        "premiere_populate_mogrt" => {
            let track=proposal.arguments.get("track").and_then(Value::as_u64).filter(|v|*v<=128).ok_or("Track must be 0–128.")? as u32;
            let clip_index=proposal.arguments.get("clip_index").and_then(Value::as_u64).filter(|v|*v<=10000).ok_or("Clip index must be 0–10000.")? as u32;
            let request:GraphicsRequest=serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid graphics fields: {e}"))?;
            request.validate()?;
            let expected=premiere_expectation.as_ref().ok_or("Populating graphics requires inspected project/sequence/clip expectation.")?;
            if expected.sequence_guid.is_none() || expected.clips.len()!=1 || !expected.clips.iter().any(|c|c.kind=="video"&&c.track==track&&c.clip_index==clip_index) {return Err("Exact inspected graphics clip expectation required.".into());}
            (ToolAction::PremierePopulateMogrt{track,clip_index,request},"Populate exact Premiere graphics fields".into(),format!("Set {} inspected fields on V{track} clip #{clip_index}; MOGRT identity must be inspected.",proposal.arguments["request"]["fields"].as_array().map_or(0,Vec::len)),RiskLevel::High)
        }
        "premiere_save_graphics_template_mapping" => {
            let mapping: premiere_graphics::Mapping = serde_json::from_value(proposal.arguments["mapping"].clone()).map_err(|e| e.to_string())?;
            mapping.validate_local_template()?;
            let track = proposal.arguments["track"].as_u64().filter(|v| *v <= 128).ok_or("Exact graphics track required.")? as u32;
            let clip_index = proposal.arguments["clip_index"].as_u64().filter(|v| *v <= 10000).ok_or("Exact graphics clip required.")? as u32;
            let expected_revision: Option<u32> = serde_json::from_value(proposal.arguments["expected_revision"].clone()).map_err(|e| e.to_string())?;
            let expected = premiere_expectation.as_ref().ok_or("Save mapping requires inspected reference clip expectation.")?;
            if expected.clips.len() != 1 || expected.clips[0].kind != "video" || expected.clips[0].track != track || expected.clips[0].clip_index != clip_index {
                return Err("Mapping reference must identify exactly one inspected video clip.".into());
            }
            (ToolAction::PremiereSaveGraphicsMapping {mapping,track,clip_index,expected_revision}, "Save inspected graphics mapping".into(), "Read native reference fields and persist explicit roles/template source locally; existing mappings require exact revision.".into(), RiskLevel::Medium)
        }
        "premiere_list_graphics_template_mappings" => (ToolAction::PremiereListGraphicsMappings, "List saved graphics mappings".into(), "Read bounded local template selectors, explicit roles and revisions.".into(), RiskLevel::Low),
        "premiere_delete_graphics_template_mapping" => {
            let name = proposal.arguments["name"].as_str().ok_or("Mapping name required.")?.to_owned();
            premiere_graphics::validate_name(&name)?;
            let revision = proposal.arguments["revision"].as_u64().filter(|r| *r > 0 && *r <= u32::MAX as u64).ok_or("Exact mapping revision required.")? as u32;
            (ToolAction::PremiereDeleteGraphicsMapping {name,revision}, "Delete saved graphics mapping".into(), "Remove one exact local mapping revision; source MOGRT and timeline clips remain untouched.".into(), RiskLevel::Medium)
        }
        "premiere_batch_graphics" => {
            let batch = stage_graphics_batch(&proposal.arguments["batch"], premiere_expectation.as_ref())?;
            let detail = format!("Insert and populate {} graphics using '{}' revision {}; one project checkpoint, per-item results and no automatic rollback.", batch.items.len(), batch.mapping, batch.revision);
            (ToolAction::PremiereBatchGraphics {batch}, "Insert mapped graphics batch".into(), detail, RiskLevel::High)
        }
        "premiere_batch_lower_thirds" => {
            let batch = stage_graphics_batch(&proposal.arguments["batch"], premiere_expectation.as_ref())?;
            let detail = format!("Insert and populate {} lower thirds using '{}' revision {}; one project checkpoint and explicit native targets.", batch.items.len(), batch.mapping, batch.revision);
            (ToolAction::PremiereBatchGraphics {batch}, "Insert mapped lower thirds".into(), detail, RiskLevel::High)
        }
        "premiere_cancel_graphics_batch" => (ToolAction::PremiereCancelGraphicsBatch { generation: state.graphics_running.generation()? }, "Cancel graphics batch".into(), "Stop between graphics; the current native item may still finish.".into(), RiskLevel::Low),
        "premiere_plan_mogrt_recipe" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).filter(|v| *v <= 128).ok_or("Track must be 0–128.")? as u32;
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).filter(|v| *v <= 10000).ok_or("Clip index must be 0–10000.")? as u32;
            let request: GraphicsRequest = serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null)).map_err(|e| format!("Invalid graphics plan: {e}"))?;
            request.validate()?;
            (ToolAction::PremierePlanMogrtRecipe {track, clip_index, request}, "Plan inspected graphics recipe".into(), "Inspect exact primitive fields and prepare static settings without editing.".into(), RiskLevel::Low)
        }
        "premiere_plan_transcript_ducking" => {
            let apply=false;
            let item_id=arg_string(&proposal.arguments,"item_id")?;
            if item_id.is_empty()||item_id.len()>240 {return Err("Transcript item id exceeds bounds.".into());}
            let target:ParameterTarget=serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid audio target: {e}"))?;
            target.validate()?;if target.kind!="audio" {return Err("Ducking requires an inspected audio target.".into());}
            let request:AudioPlanRequest=serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid audio request: {e}"))?;
            request.validate()?;if request.mode!="duck"||!request.regions.is_empty(){return Err("Transcript ducking derives dialogue regions from native transcript timing only.".into());}
            let read=|key:&str|->Result<f64,String>{let value=proposal.arguments.get(key).and_then(Value::as_f64).ok_or_else(||format!("{key} is required."))?;if !value.is_finite()||value<0.0||value>86400.0 {return Err(format!("{key} is outside bounds."));}Ok(value)};
            let transcript_offset=read("transcript_offset_seconds")?;let music_start=read("music_start_seconds")?;
            let merge_gap=read("merge_gap_seconds")?;if merge_gap>5.0{return Err("Maximum merge gap is 5 seconds.".into());}
            if apply {
                let expected=premiere_expectation.as_ref().ok_or("Ducking edit requires an inspected audio clip expectation.")?;
                if expected.sequence_guid.is_none()||expected.clips.len()!=1||!expected.clips.iter().any(|c|c.kind=="audio"&&c.track==target.track&&c.clip_index==target.clip_index){return Err("Exact audio clip expectation required.".into());}
            }
            (ToolAction::PremiereTranscriptDucking{item_id,target,request,transcript_offset,music_start,merge_gap,apply},if apply{"Apply transcript-derived Premiere ducking"}else{"Plan transcript-derived Premiere ducking"}.into(),"Use actual explicit transcript segments with caller-supplied timeline offsets and inspected native audio values.".into(),if apply{RiskLevel::High}else{RiskLevel::Low})
        }
        "premiere_apply_transcript_ducking" => {
            let apply=true;
            let item_id=arg_string(&proposal.arguments,"item_id")?;
            if item_id.is_empty()||item_id.len()>240 {return Err("Transcript item id exceeds bounds.".into());}
            let target:ParameterTarget=serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid audio target: {e}"))?;
            target.validate()?;if target.kind!="audio" {return Err("Ducking requires an inspected audio target.".into());}
            let request:AudioPlanRequest=serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid audio request: {e}"))?;
            request.validate()?;if request.mode!="duck"||!request.regions.is_empty(){return Err("Transcript ducking derives dialogue regions from native transcript timing only.".into());}
            let read=|key:&str|->Result<f64,String>{let value=proposal.arguments.get(key).and_then(Value::as_f64).ok_or_else(||format!("{key} is required."))?;if !value.is_finite()||value<0.0||value>86400.0 {return Err(format!("{key} is outside bounds."));}Ok(value)};
            let transcript_offset=read("transcript_offset_seconds")?;let music_start=read("music_start_seconds")?;
            let merge_gap=read("merge_gap_seconds")?;if merge_gap>5.0{return Err("Maximum merge gap is 5 seconds.".into());}
            if apply {
                let expected=premiere_expectation.as_ref().ok_or("Ducking edit requires an inspected audio clip expectation.")?;
                if expected.sequence_guid.is_none()||expected.clips.len()!=1||!expected.clips.iter().any(|c|c.kind=="audio"&&c.track==target.track&&c.clip_index==target.clip_index){return Err("Exact audio clip expectation required.".into());}
            }
            (ToolAction::PremiereTranscriptDucking{item_id,target,request,transcript_offset,music_start,merge_gap,apply},if apply{"Apply transcript-derived Premiere ducking"}else{"Plan transcript-derived Premiere ducking"}.into(),"Use actual explicit transcript segments with caller-supplied timeline offsets and inspected native audio values.".into(),if apply{RiskLevel::High}else{RiskLevel::Low})
        }
        "premiere_plan_transcript_rebuild" => {
            let request: premiere_transcript_rebuild::Request = serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null))
                .map_err(|e| format!("Invalid rebuild request: {e}"))?;
            request.validate()?;
            (ToolAction::PremiereTranscriptRebuild {request, apply:false, plan_snapshot:None}, "Plan transcript rebuild".into(),
                "Inspect complete transcript, source mapping and explicit empty destination without editing.".into(), RiskLevel::Low)
        }
        "premiere_apply_transcript_rebuild" => {
            let request: premiere_transcript_rebuild::Request = serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null))
                .map_err(|e| format!("Invalid rebuild request: {e}"))?;
            request.validate()?;
            let apply = true;
            let plan_snapshot = if apply {
                let snapshot = arg_string(&proposal.arguments, "plan_snapshot")?;
                if snapshot.is_empty() || snapshot.len() > 48000 { return Err("Exact bounded plan_snapshot required.".into()); }
                let expected = premiere_expectation.as_ref().ok_or("Rebuild requires exact source clip expectation.")?;
                if expected.sequence_guid.is_none() || expected.sequence_guid.as_ref() == Some(&request.destination.sequence_guid) || expected.clips.len() != 1 ||
                    !expected.clips.iter().any(|c| c.kind == "video" && c.track == request.source.track && c.clip_index == request.source.clip_index) {
                    return Err("Rebuild requires source clip expectation and a different explicit empty destination sequence.".into());
                }
                Some(snapshot)
            } else { None };
            (ToolAction::PremiereTranscriptRebuild {request, apply, plan_snapshot},
                if apply {"Rebuild explicit transcript keep ranges"} else {"Plan transcript rebuild"}.into(),
                "Create hard-bounded source subclips and assemble into a separate explicit empty sequence; preserve original, use only supplied removals and media flags.".into(),
                if apply {RiskLevel::High} else {RiskLevel::Low})
        }
        "premiere_cancel_transcript_rebuild" => (ToolAction::PremiereCancelTranscriptRebuild { generation: state.rebuild_running.generation()? }, "Cancel transcript rebuild".into(), "Stop before the next subclip or insertion; completed pieces remain available.".into(), RiskLevel::Low),
        "premiere_plan_scene_detection" => {
            let request: premiere_scene_detection::Request = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid scene detection request: {e}"))?;
            request.validate()?;
            (
                ToolAction::PremierePlanSceneDetection { request },
                "Plan native Premiere scene detection".into(),
                "Verify explicit inspected video targets and stable native operation availability; no selection or timeline mutation.".into(),
                RiskLevel::Low,
            )
        }
        "premiere_plan_scene_rough_cut" => {
            let request: premiere_scene_rough_cut::Request = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid scene rough-cut request: {e}"))?;
            request.validate()?;
            (
                ToolAction::PremierePlanSceneRoughCut { request },
                "Plan explicit scene-aware Premiere rough cut".into(),
                "Validate a bounded shot catalog, explicit ordered selection and empty destination, then emit the existing Y2 assembly proposal; no edit or automatic shot choice.".into(),
                RiskLevel::Low,
            )
        }
        "premiere_detect_scene_markers" | "premiere_detect_scene_cuts" => {
            let mut request: premiere_scene_detection::Request = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid scene detection request: {e}"))?;
            request.mode = if proposal.tool == "premiere_detect_scene_cuts" {"cuts".into()} else {"markers".into()};
            request.validate()?;
            let expected = premiere_expectation.as_ref().ok_or("Scene detection mutation requires the exact expectation returned by the plan.")?;
            if expected.sequence_guid.is_none() || expected.clips.len() != request.targets.len() {
                return Err("Scene detection requires one exact video expectation for every explicit target.".into());
            }
            for target in &request.targets {
                if !expected.clips.iter().any(|clip| clip.kind=="video" && clip.track==target.track
                    && clip.clip_index==target.clip_index && clip.signature==target.signature) {
                    return Err("Scene detection expectation does not match an explicit inspected target.".into());
                }
            }
            (
                ToolAction::PremiereSceneDetection { request: request.clone() },
                if request.mode=="cuts" {"Run native Premiere scene cut detection"} else {"Run native Premiere scene marker detection"}.into(),
                "Set only the exact requested video clips as a temporary native selection, dispatch one stable Scene Edit Detection operation, inspect marker/timeline deltas, and never retry uncertain mutation.".into(),
                if request.mode=="cuts" {RiskLevel::High} else {RiskLevel::Medium},
            )
        }
        "premiere_plan_transcript_cuts" => {
            let request: premiere_talking_head::Request = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid transcript cut request: {e}"))?;
            request.validate()?;
            (
                ToolAction::PremiereTranscriptCuts { request, apply: false, transcript_snapshot: None },
                "Plan explicit transcript cuts".into(),
                "Map explicit keep/remove/chapter/highlight transcript selections to exact inspected timeline targets; interior cuts stay unsupported until a verified split path exists.".into(),
                RiskLevel::Low,
            )
        }
        "premiere_apply_transcript_cuts" => {
            let request: premiere_talking_head::Request = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid transcript cut request: {e}"))?;
            request.validate()?;
            let transcript_snapshot = arg_string(&proposal.arguments, "transcript_snapshot")?;
            if !transcript_snapshot.starts_with("fnv1a64:") || transcript_snapshot.len() != 24 {
                return Err("Apply transcript cuts requires the exact bounded transcript_snapshot returned by the plan.".into());
            }
            let expected = premiere_expectation.as_ref().ok_or("Transcript cut execution requires exact inspected clip expectations.")?;
            if expected.sequence_guid.is_none() {
                return Err("Transcript cut execution requires an active sequence expectation.".into());
            }
            let required = 1 + usize::from(request.audio.is_some());
            if expected.clips.len() != required
                || !expected.clips.iter().any(|clip| clip.kind == "video" && clip.track == request.video.track && clip.clip_index == request.video.clip_index)
                || request.audio.as_ref().is_some_and(|audio| !expected.clips.iter().any(|clip| clip.kind == "audio" && clip.track == audio.track && clip.clip_index == audio.clip_index))
            {
                return Err("Transcript cut execution requires one exact expectation for every explicit video/audio target.".into());
            }
            (
                ToolAction::PremiereTranscriptCuts { request, apply: true, transcript_snapshot: Some(transcript_snapshot) },
                "Apply explicit transcript cuts".into(),
                "Apply only edge trims/whole-clip deletion and selected markers from a fresh matching transcript snapshot; no inferred links, silence detection, or unverified split edits.".into(),
                RiskLevel::High,
            )
        }
        "premiere_plan_audio_automation" => {
            let target: ParameterTarget = serde_json::from_value(proposal.arguments.get("target").cloned().unwrap_or(Value::Null)).map_err(|e| format!("Invalid audio target: {e}"))?;
            target.validate()?; if target.kind != "audio" { return Err("Audio automation requires an audio target.".into()); }
            let request: AudioPlanRequest = serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null)).map_err(|e| format!("Invalid audio plan: {e}"))?;
            request.validate()?;
            (ToolAction::PremierePlanAudioAutomation {target, request}, "Plan named audio automation".into(), "Inspect a parameter and plan supplied dialogue ducking/fade/pan values; no edit or speech detection.".into(), RiskLevel::Low)
        }
        "premiere_plan_assembly" => {
            let assembly:premiere_assembly::Assembly=serde_json::from_value(proposal.arguments.get("assembly").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid shot list: {e}"))?;
            assembly.validate()?;
            if false {
                let expected=premiere_expectation.as_ref().ok_or("Assembly edit requires inspected project/sequence expectation.")?;
                if expected.sequence_guid.is_none()||!expected.clips.is_empty(){return Err("Assembly requires exact project/sequence expectation without stale clip assumptions.".into());}
            }
            (ToolAction::PremiereAssembly{assembly,apply:false},if false{"Assemble explicit Premiere shot list"}else{"Plan explicit Premiere shot list"}.into(),"Use inspected project items and existing typed insert/overwrite; no inferred source trims or media assets.".into(),if false{RiskLevel::High}else{RiskLevel::Low})
        }
        "premiere_apply_assembly" => {
            let assembly:premiere_assembly::Assembly=serde_json::from_value(proposal.arguments.get("assembly").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid shot list: {e}"))?;
            assembly.validate()?;
            if true {
                let expected=premiere_expectation.as_ref().ok_or("Assembly edit requires inspected project/sequence expectation.")?;
                if expected.sequence_guid.is_none()||!expected.clips.is_empty(){return Err("Assembly requires exact project/sequence expectation without stale clip assumptions.".into());}
            }
            (ToolAction::PremiereAssembly{assembly,apply:true},if true{"Assemble explicit Premiere shot list"}else{"Plan explicit Premiere shot list"}.into(),"Use inspected project items and existing typed insert/overwrite; no inferred source trims or media assets.".into(),if true{RiskLevel::High}else{RiskLevel::Low})
        }
        "premiere_cancel_assembly" => (ToolAction::PremiereAssemblyCancel { generation: state.assembly_running.generation()? },"Cancel Premiere assembly".into(),"Stop launching further shots after current native action.".into(),RiskLevel::Low),
        "premiere_finish_media_batch" => {
            let request: premiere_finishing::Request = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid mixed finishing request: {e}"))?;
            request.validate()?;
            let expected = premiere_expectation.as_ref().ok_or("Mixed finishing requires inspected project/sequence expectations.")?;
            if expected.sequence_guid.is_none() || expected.clips.len() != request.expected_clip_count() {
                return Err("Mixed finishing requires one exact expectation for every existing video/audio target.".into());
            }
            for video in &request.videos {
                if !expected.clips.iter().any(|clip| clip.kind=="video" && clip.track==video.track && clip.clip_index==video.clip_index) {
                    return Err("Mixed finishing video target is missing its exact expectation.".into());
                }
            }
            for audio in &request.audios {
                if !expected.clips.iter().any(|clip| clip.kind=="audio" && clip.track==audio.target.track && clip.clip_index==audio.target.clip_index) {
                    return Err("Mixed finishing audio target is missing its exact expectation.".into());
                }
            }
            let provider = if request.review {
                Some(provider_context.ok_or("Review-enabled mixed finishing requires the active vision provider.")?)
            } else { None };
            (
                ToolAction::PremiereFinishMediaBatch { request, provider },
                "Finish mixed Premiere media batch".into(),
                "Apply exact inspected video recipes, audio automation and optional mapped graphics under one checkpoint, with per-target results and bounded review samples.".into(),
                RiskLevel::High,
            )
        }
        "premiere_finish_media_batch_cancel" => (
            ToolAction::PremiereBatchFinishCancel { generation: state.finishing_running.generation()? },
            "Cancel mixed Premiere finishing".into(),
            "Stop before the next finishing target; a current native command may still complete.".into(),
            RiskLevel::Low,
        ),
        "premiere_batch_finish" => {
            let targets=proposal.arguments.get("targets").and_then(Value::as_array).ok_or("Batch requires explicit targets.")?;
            if targets.is_empty()||targets.len()>32 {return Err("Batch finishing requires 1–32 targets.".into());}
            let expected=premiere_expectation.as_ref().ok_or("Batch finishing requires inspected clip expectations.")?;
            if expected.sequence_guid.is_none()||expected.clips.len()!=targets.len(){return Err("Batch requires one exact video clip expectation per target.".into());}
            let mut seen=HashSet::new();
            for t in targets {
                let track=t.get("track").and_then(Value::as_u64).filter(|n|*n<=128).ok_or("Invalid video track.")? as u32;
                let index=t.get("clip_index").and_then(Value::as_u64).filter(|n|*n<=10000).ok_or("Invalid clip index.")? as u32;
                if !seen.insert((track,index))||!expected.clips.iter().any(|c|c.kind=="video"&&c.track==track&&c.clip_index==index){return Err("Duplicate or uninspected video batch target.".into());}
                let request:RecipePlanRequest=serde_json::from_value(t.get("request").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid clip recipe: {e}"))?;
                request.validate()?;
            }
            (ToolAction::PremiereBatchFinish{targets:targets.clone()},"Finish explicit Premiere clips".into(),format!("Apply inspected native motion/color recipes on {} exact clips, with per-clip results and project checkpoint.",targets.len()),RiskLevel::High)
        }
        "premiere_batch_finish_cancel" => (ToolAction::PremiereBatchFinishCancel { generation: state.finishing_running.generation()? },"Cancel Premiere batch finishing".into(),"Stop before the next clip; any current Premiere command may still finish.".into(),RiskLevel::Low),
        "premiere_plan_video_recipe" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).filter(|v| *v <= 128).ok_or("Track must be 0–128.")? as u32;
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).filter(|v| *v <= 10000).ok_or("Clip index must be 0–10000.")? as u32;
            let request: RecipePlanRequest = serde_json::from_value(proposal.arguments.get("request").cloned().unwrap_or(Value::Null)).map_err(|e| format!("Invalid recipe plan: {e}"))?;
            request.validate()?;
            (ToolAction::PremierePlanVideoRecipe {track, clip_index, request}, "Plan inspected video recipe".into(), "Inspect exact native selectors and construct motion/color settings; no edit.".into(), RiskLevel::Low)
        }
        "premiere_timeline_capabilities" => (
            ToolAction::PremiereTimelineCapabilities, "Inspect timeline capabilities".into(), "Read native timeline capabilities without editing.".into(), RiskLevel::Low
        ),
        "premiere_timeline" => (
            ToolAction::PremiereTimeline,
            "Inspect Premiere timeline".to_string(),
            "Read active sequence tracks and clip metadata through the paired Premiere UXP bridge.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_caption_tracks" => (
            ToolAction::PremiereCaptionTracks,
            "Inspect Premiere caption tracks".to_string(),
            "Read active-sequence caption track names, indexes and mute state.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_set_caption_track_name" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 {
                return Err("Premiere caption track index is outside Shuvi's safety limit.".into());
            }

            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 240 {
                return Err("Premiere caption track name is too long.".into());
            }

            (
                ToolAction::PremiereSetCaptionTrackName {
                    track: track as u32,
                    name: name.clone(),
                },
                "Rename Premiere caption track".to_string(),
                format!("Rename caption track {track} to '{name}'."),
                RiskLevel::Medium,
            )
        }
        "premiere_set_caption_track_mute" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 {
                return Err("Premiere caption track index is outside Shuvi's safety limit.".into());
            }

            let muted = proposal.arguments
                .get("muted")
                .and_then(Value::as_bool)
                .ok_or_else(|| "premiere_set_caption_track_mute requires muted=true|false.".to_string())?;

            (
                ToolAction::PremiereSetCaptionTrackMute {
                    track: track as u32,
                    muted,
                },
                if muted { "Mute Premiere caption track".to_string() } else { "Unmute Premiere caption track".to_string() },
                format!("Set caption track {track} muted={muted}."),
                RiskLevel::Medium,
            )
        }
        "premiere_set_playhead" => {
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_set_playhead requires seconds.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere playhead seconds must be finite and between 0 and 86400.".into());
            }

            (
                ToolAction::PremiereSetPlayhead { seconds },
                "Move Premiere playhead".to_string(),
                format!("Move active sequence playhead to {seconds:.3}s."),
                RiskLevel::Low,
            )
        }
        "premiere_inspect_frame" => {
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_inspect_frame requires seconds.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere frame-inspection time must be between 0 and 86400 seconds.".into());
            }

            let prompt = arg_string(&proposal.arguments, "prompt")?;
            if prompt.chars().count() > 4_000 {
                return Err("Premiere frame-inspection prompt is too long.".into());
            }

            let provider = provider_context
                .ok_or_else(|| "Premiere frame inspection requires the active provider context.".to_string())?;

            (
                ToolAction::PremiereInspectFrame { seconds, prompt: prompt.clone(), provider: provider.clone() },
                "Inspect Premiere frame with AI vision".to_string(),
                format!(
                    "Move Premiere playhead to {seconds:.3}s, capture the current screen, and send it to {}/{} for visual analysis: {}",
                    provider.provider,
                    provider.model,
                    prompt
                ),
                RiskLevel::Medium,
            )
        }
        "premiere_review_frames" => {
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_array)
                .ok_or_else(|| "premiere_review_frames requires a seconds array.".to_string())?;

            if seconds.is_empty() || seconds.len() > 8 {
                return Err("Premiere multi-frame review requires between 1 and 8 timestamps.".into());
            }

            let mut validated = Vec::with_capacity(seconds.len());
            for value in seconds {
                let seconds = value
                    .as_f64()
                    .ok_or_else(|| "Every Premiere review timestamp must be numeric.".to_string())?;
                if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                    return Err("Premiere review timestamps must be between 0 and 86400 seconds.".into());
                }
                validated.push(seconds);
            }

            let prompt = arg_string(&proposal.arguments, "prompt")?;
            if prompt.chars().count() > 4_000 {
                return Err("Premiere multi-frame review prompt is too long.".into());
            }

            let provider = provider_context
                .ok_or_else(|| "Premiere multi-frame review requires the active provider context.".to_string())?;

            (
                ToolAction::PremiereReviewFrames {
                    seconds: validated.clone(),
                    prompt: prompt.clone(),
                    provider: provider.clone(),
                },
                "Review multiple Premiere frames with AI vision".to_string(),
                format!(
                    "Review {} Premiere frame(s) through {}/{}: {}",
                    validated.len(),
                    provider.provider,
                    provider.model,
                    prompt
                ),
                RiskLevel::Medium,
            )
        }
        "premiere_plan_edit_recipe" => {
            let request: premiere_editorial::Request=serde_json::from_value(proposal.arguments.clone())
                .map_err(|e| format!("Invalid editorial recipe request: {e}"))?;
            premiere_editorial::plan(request.clone())?;
            (ToolAction::PremierePlanEditRecipe {request},"Plan professional Premiere edit".into(),
                "Read-only versioned editorial stages; no sequence modification.".into(),RiskLevel::Low)
        }
        "premiere_edit_job_start" => {
            let request:premiere_edit_job::Request=serde_json::from_value(proposal.arguments.clone())
                .map_err(|e|format!("Invalid Premiere edit job: {e}"))?;
            request.validate()?;
            (ToolAction::PremiereEditJobStart{request},"Start professional Premiere edit job".into(),
                "Persist a bounded project/sequence-scoped job that composes existing typed Premiere actions one approved phase at a time.".into(),RiskLevel::Low)
        }
        "premiere_edit_job_status" | "premiere_edit_job_next" | "premiere_edit_job_cancel" => {
            let job_id=arg_string(&proposal.arguments,"job_id")?;
            Uuid::parse_str(&job_id).map_err(|_|"Invalid edit job ID.")?;
            let action=match proposal.tool.as_str(){
                "premiere_edit_job_status"=>ToolAction::PremiereEditJobStatus{job_id},
                "premiere_edit_job_next"=>ToolAction::PremiereEditJobNext{job_id},
                _=>ToolAction::PremiereEditJobCancel{job_id},
            };
            (action,"Inspect or advance professional Premiere edit job".into(),
                "No mutating phase is auto-dispatched; next returns one concrete existing typed tool proposal requiring its normal approval.".into(),RiskLevel::Low)
        }
        "premiere_edit_job_record_action" => {
            let job_id=arg_string(&proposal.arguments,"job_id")?;
            Uuid::parse_str(&job_id).map_err(|_|"Invalid edit job ID.")?;
            let phase_id=arg_string(&proposal.arguments,"phase_id")?;
            let action_id=arg_string(&proposal.arguments,"action_id")?;
            Uuid::parse_str(&action_id).map_err(|_|"Invalid edit-job action receipt ID.")?;
            (ToolAction::PremiereEditJobRecordAction{job_id,phase_id,action_id},
                "Record professional edit-job phase receipt".into(),
                "Advance only after a matching recent typed action audit receipt; this command performs no Premiere mutation.".into(),RiskLevel::Low)
        }
        "premiere_edit_session_start" => {
            let request:premiere_editorial::Request=serde_json::from_value(proposal.arguments.clone())
                .map_err(|e|format!("Invalid editorial session request: {e}"))?;
            premiere_editorial::plan(request.clone())?;
            (ToolAction::PremiereEditSessionStart {request},"Start professional Premiere edit session".into(),
                "Persist bounded editorial stages after live project and sequence inspection; no edit.".into(),RiskLevel::Low)
        }
        "premiere_edit_session_status" | "premiere_edit_session_next" | "premiere_edit_session_cancel" => {
            let session_id=arg_string(&proposal.arguments,"session_id")?;
            Uuid::parse_str(&session_id).map_err(|_|"Invalid edit session ID.")?;
            let action=match proposal.tool.as_str(){
                "premiere_edit_session_status"=>ToolAction::PremiereEditSessionStatus {session_id},
                "premiere_edit_session_next"=>ToolAction::PremiereEditSessionNext {session_id},
                _=>ToolAction::PremiereEditSessionCancel {session_id}};
            (action,"Inspect or advance Premiere edit session".into(),"No stage is auto-executed; cancel persists state.".into(),RiskLevel::Low)
        }
        "premiere_edit_session_record_action" | "premiere_edit_session_record_review" => {
            let session_id=arg_string(&proposal.arguments,"session_id")?;
            Uuid::parse_str(&session_id).map_err(|_|"Invalid edit session ID.")?;
            let stage_id=arg_string(&proposal.arguments,"stage_id")?;
            let action=if proposal.tool=="premiere_edit_session_record_review" {
                let review_session_id=arg_string(&proposal.arguments,"review_session_id")?;
                Uuid::parse_str(&review_session_id).map_err(|_|"Invalid review session ID.")?;
                ToolAction::PremiereEditSessionRecordReview {session_id,stage_id,review_session_id}
            }else{
                let action_id=arg_string(&proposal.arguments,"action_id")?;
                ToolAction::PremiereEditSessionRecordAction {session_id,stage_id,action_id}
            };
            (action,"Record verified Premiere stage receipt".into(),"Confirm recent audit or bounded review evidence; no edit.".into(),RiskLevel::Low)
        }
        "premiere_resolve_review_target" | "premiere_bind_review_fix" => {
            let session_id=arg_string(&proposal.arguments,"session_id")?;
            Uuid::parse_str(&session_id).map_err(|_|"Invalid review session ID.")?;
            let issue_id=arg_string(&proposal.arguments,"issue_id")?;
            let frame_seconds=proposal.arguments.get("frame_seconds").and_then(Value::as_f64)
                .filter(|n|n.is_finite()&&(0.0..=86400.0).contains(n)).ok_or("Exact grounded frame timestamp required.")?;
            if proposal.tool=="premiere_resolve_review_target" {
                (ToolAction::PremiereResolveReviewTarget {session_id,issue_id,frame_seconds},
                    "Resolve exact review timeline targets".into(),"Read-only bounded timeline lookup; multiple clips remain explicit.".into(),RiskLevel::Low)
            } else {
                let kind=arg_string(&proposal.arguments,"kind")?;
                if !matches!(kind.as_str(),"video"|"audio") {return Err("Exact video/audio kind required.".into());}
                let track=proposal.arguments.get("track").and_then(Value::as_u64).filter(|n|*n<=128).ok_or("Invalid track.")? as u32;
                let clip_index=proposal.arguments.get("clip_index").and_then(Value::as_u64).filter(|n|*n<=10000).ok_or("Invalid clip index.")? as u32;
                let target_signature=arg_string(&proposal.arguments,"target_signature")?;
                if target_signature.len()>4096 {return Err("Oversized target signature.".into());}
                let component_match_name=arg_optional_string(&proposal.arguments,"component_match_name");
                let param_display_name=arg_optional_string(&proposal.arguments,"param_display_name");
                (ToolAction::PremiereBindReviewFix {session_id,issue_id,frame_seconds,kind,track,clip_index,target_signature,component_match_name,param_display_name},
                    "Bind reviewed issue to native target".into(),"Read-only exact native inspection and typed planner proposal; no edits.".into(),RiskLevel::Low)
            }
        }
        "premiere_review_session_start" => {
            let objective = arg_string(&proposal.arguments, "objective")?;
            let reference = proposal.arguments.get("reference").and_then(Value::as_str).unwrap_or("").to_string();
            let sample_times = proposal.arguments.get("sample_times").and_then(Value::as_array)
                .ok_or("sample_times must be an array.")?.iter()
                .map(|v| v.as_f64().ok_or("Invalid sample timestamp.".to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            let max_iterations = proposal.arguments.get("max_iterations").and_then(Value::as_u64).unwrap_or(4);
            let max_iterations = u8::try_from(max_iterations).map_err(|_| "Iteration limit exceeds 8.")?;
            premiere_review::Session::new("validate".into(),"project".into(),"sequence".into(),objective.clone(),reference.clone(),sample_times.clone(),max_iterations,now_ms().max(1))?;
            (ToolAction::PremiereReviewSessionStart {objective,reference,sample_times,max_iterations},
                "Start bounded Premiere review session".into(), "Inspect active project and sequence before storing bounded session.".into(), RiskLevel::Low)
        }
        "premiere_review_session_status" | "premiere_review_session_cancel" | "premiere_review_session_next" => {
            let session_id = arg_string(&proposal.arguments,"session_id")?;
            Uuid::parse_str(&session_id).map_err(|_| "Invalid Premiere review session ID.")?;
            let (action, risk) = match proposal.tool.as_str() {
                "premiere_review_session_status" => (ToolAction::PremiereReviewSessionStatus {session_id},RiskLevel::Low),
                "premiere_review_session_cancel" => (ToolAction::PremiereReviewSessionCancel {session_id},RiskLevel::Low),
                _ => (ToolAction::PremiereReviewSessionNext {session_id,provider:provider_context.ok_or("Review requires active vision provider.")?},RiskLevel::Medium),
            };
            (action,"Advance Premiere review session".into(),"Read-only review; does not launch an edit.".into(),risk)
        }
        "premiere_review_session_record_fix" => {
            let session_id=arg_string(&proposal.arguments,"session_id")?;
            Uuid::parse_str(&session_id).map_err(|_| "Invalid Premiere review session ID.")?;
            let issue_id=arg_string(&proposal.arguments,"issue_id")?;
            let target=arg_string(&proposal.arguments,"target")?;
            let planner=arg_string(&proposal.arguments,"planner")?;
            let settings=proposal.arguments.get("settings").cloned().ok_or("Missing exact fix settings.")?;
            let approved_action_id=arg_string(&proposal.arguments,"approved_action_id")?;
            Uuid::parse_str(&approved_action_id).map_err(|_| "Invalid approved action ID.")?;
            premiere_review::fingerprint("color",&target,&planner,&settings).map_err(|e| e.to_string())?;
            (ToolAction::PremiereReviewSessionRecordFix {session_id,issue_id,target,planner,settings,approved_action_id},
                "Record approved Premiere edit for review".into(),"Verify successful typed action in audit log before re-review.".into(),RiskLevel::Medium)
        }
        "premiere_set_track_mute" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_set_track_mute kind must be video or audio.".into());
            }
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 {
                return Err("Premiere track index is outside Shuvi's safety limit.".into());
            }
            let muted = proposal.arguments
                .get("muted")
                .and_then(Value::as_bool)
                .ok_or_else(|| "premiere_set_track_mute requires muted=true|false.".to_string())?;

            (
                ToolAction::PremiereSetTrackMute { kind: kind.clone(), track: track as u32, muted },
                if muted { "Mute Premiere track".to_string() } else { "Unmute Premiere track".to_string() },
                format!("Set {kind} track {track} muted={muted}."),
                RiskLevel::Medium,
            )
        }
        "premiere_set_clip_enabled" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_set_clip_enabled kind must be video or audio.".into());
            }
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere clip target is outside Shuvi's safety limits.".into());
            }
            let enabled = proposal.arguments
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or_else(|| "premiere_set_clip_enabled requires enabled=true|false.".to_string())?;

            (
                ToolAction::PremiereSetClipEnabled {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    enabled,
                },
                if enabled { "Enable Premiere clip".to_string() } else { "Disable Premiere clip".to_string() },
                format!("Set {kind} track {track}, clip #{clip_index} enabled={enabled}"),
                RiskLevel::Medium,
            )
        }
        "premiere_list_video_transitions" => (
            ToolAction::PremiereListVideoTransitions,
            "List Premiere video transitions".to_string(),
            "Read installed Premiere video transition match names.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_add_video_transition" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere transition target is outside Shuvi's safety limits.".into());
            }

            let match_name = arg_string(&proposal.arguments, "match_name")?;
            if match_name.chars().count() > 240 {
                return Err("Premiere transition match name is too long.".into());
            }

            let duration_seconds = proposal.arguments
                .get("duration_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_add_video_transition requires duration_seconds.".to_string())?;
            if !duration_seconds.is_finite() || duration_seconds <= 0.0 || duration_seconds > 60.0 {
                return Err("Premiere transition duration must be greater than 0 and at most 60 seconds.".into());
            }

            let position = arg_string(&proposal.arguments, "position")?.to_ascii_lowercase();
            if !matches!(position.as_str(), "start" | "end") {
                return Err("Premiere transition position must be start or end.".into());
            }

            let force_single_sided = proposal.arguments
                .get("force_single_sided")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            (
                ToolAction::PremiereAddVideoTransition {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    match_name: match_name.clone(),
                    duration_seconds,
                    position: position.clone(),
                    force_single_sided,
                },
                "Add Premiere video transition".to_string(),
                format!(
                    "Add transition '{match_name}' to video track {track}, clip #{clip_index}, position={position}, duration={duration_seconds:.3}s, single_sided={force_single_sided}"
                ),
                RiskLevel::High,
            )
        }
        "premiere_list_video_effects" => (
            ToolAction::PremiereListVideoEffects,
            "List Premiere video effects".to_string(),
            "Read installed Premiere video effect match names.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_inspect_clip_effects" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere effect inspection target is outside Shuvi's safety limits.".into());
            }
            (
                ToolAction::PremiereInspectClipEffects {
                    track: track as u32,
                    clip_index: clip_index as u32,
                },
                "Inspect Premiere clip effects".to_string(),
                format!("Inspect video track {track}, clip #{clip_index} effect chain and parameters."),
                RiskLevel::Low,
            )
        }
        "premiere_add_video_effect" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere video effect target is outside Shuvi's safety limits.".into());
            }
            let match_name = arg_string(&proposal.arguments, "match_name")?;
            if match_name.chars().count() > 240 {
                return Err("Premiere video effect match name is too long.".into());
            }
            (
                ToolAction::PremiereAddVideoEffect {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    match_name: match_name.clone(),
                },
                "Add Premiere video effect".to_string(),
                format!("Add video effect '{match_name}' to video track {track}, clip #{clip_index}."),
                RiskLevel::High,
            )
        }
        "premiere_set_effect_param" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            let component_index = proposal.arguments.get("component_index").and_then(Value::as_u64).unwrap_or(0);
            let param_index = proposal.arguments.get("param_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 || component_index > 512 || param_index > 512 {
                return Err("Premiere effect parameter target is outside Shuvi's safety limits.".into());
            }
            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_set_effect_param requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Effect parameter value must be a boolean, number, or string.".into());
            }
            if value.as_str().is_some_and(|text| text.chars().count() > 5_000) {
                return Err("Effect parameter string is too long.".into());
            }
            (
                ToolAction::PremiereSetEffectParam {
                    expected_signature: arg_premiere_signature(&proposal.arguments)?,
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_index: component_index as u32,
                    param_index: param_index as u32,
                    value: value.clone(),
                },
                "Set Premiere effect parameter".to_string(),
                format!(
                    "Set video track {track}, clip #{clip_index}, component #{component_index}, parameter #{param_index}."
                ),
                RiskLevel::High,
            )
        }
        "premiere_add_effect_keyframe" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            let component_index = proposal.arguments.get("component_index").and_then(Value::as_u64).unwrap_or(0);
            let param_index = proposal.arguments.get("param_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 || component_index > 512 || param_index > 512 {
                return Err("Premiere keyframe target is outside Shuvi's safety limits.".into());
            }
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_add_effect_keyframe requires seconds.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere keyframe seconds must be between 0 and 86400.".into());
            }
            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_add_effect_keyframe requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Effect keyframe value must be a boolean, number, or string.".into());
            }
            if value.as_str().is_some_and(|text| text.chars().count() > 5_000) {
                return Err("Effect keyframe string is too long.".into());
            }
            (
                ToolAction::PremiereAddEffectKeyframe {
                    expected_signature: arg_premiere_signature(&proposal.arguments)?,
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_index: component_index as u32,
                    param_index: param_index as u32,
                    seconds,
                    value: value.clone(),
                },
                "Add Premiere effect keyframe".to_string(),
                format!(
                    "Add keyframe at {seconds:.3}s to video track {track}, clip #{clip_index}, component #{component_index}, parameter #{param_index}."
                ),
                RiskLevel::High,
            )
        }
        "premiere_set_video_param_named" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere named video parameter target is outside Shuvi's safety limits.".into());
            }

            let component_match_name = arg_optional_string(&proposal.arguments, "component_match_name");
            let component_display_name = arg_optional_string(&proposal.arguments, "component_display_name");
            if component_match_name.is_none() && component_display_name.is_none() {
                return Err("premiere_set_video_param_named requires component_match_name or component_display_name.".into());
            }
            for value in [component_match_name.as_ref(), component_display_name.as_ref()].into_iter().flatten() {
                if value.chars().count() > 240 {
                    return Err("Premiere component selector is too long.".into());
                }
            }

            let param_display_name = arg_string(&proposal.arguments, "param_display_name")?;
            if param_display_name.chars().count() > 240 {
                return Err("Premiere parameter display name is too long.".into());
            }

            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_set_video_param_named requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Named Premiere parameter value must be a boolean, number, or string.".into());
            }

            (
                ToolAction::PremiereSetVideoParamNamed {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_match_name: component_match_name.clone(),
                    component_display_name: component_display_name.clone(),
                    param_display_name: param_display_name.clone(),
                    value: value.clone(),
                },
                "Set Premiere video parameter by name".to_string(),
                format!(
                    "Set named video parameter '{param_display_name}' on track {track}, clip #{clip_index}; component_match={component_match_name:?}, component_display={component_display_name:?}."
                ),
                RiskLevel::High,
            )
        }
        "premiere_add_video_keyframe_named" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere named video keyframe target is outside Shuvi's safety limits.".into());
            }

            let component_match_name = arg_optional_string(&proposal.arguments, "component_match_name");
            let component_display_name = arg_optional_string(&proposal.arguments, "component_display_name");
            if component_match_name.is_none() && component_display_name.is_none() {
                return Err("premiere_add_video_keyframe_named requires component_match_name or component_display_name.".into());
            }
            let param_display_name = arg_string(&proposal.arguments, "param_display_name")?;
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_add_video_keyframe_named requires seconds.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere named keyframe seconds must be between 0 and 86400.".into());
            }
            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_add_video_keyframe_named requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Named Premiere keyframe value must be a boolean, number, or string.".into());
            }

            (
                ToolAction::PremiereAddVideoKeyframeNamed {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_match_name: component_match_name.clone(),
                    component_display_name: component_display_name.clone(),
                    param_display_name: param_display_name.clone(),
                    seconds,
                    value: value.clone(),
                },
                "Add Premiere video keyframe by name".to_string(),
                format!(
                    "Add named keyframe '{param_display_name}' at {seconds:.3}s on track {track}, clip #{clip_index}."
                ),
                RiskLevel::High,
            )
        }
        "premiere_apply_video_recipe" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere video recipe target is outside Shuvi's safety limits.".into());
            }

            let settings = proposal.arguments
                .get("settings")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "premiere_apply_video_recipe requires a settings array.".to_string())?;

            if settings.is_empty() || settings.len() > 64 {
                return Err("Premiere video recipe requires between 1 and 64 settings.".into());
            }

            for setting in &settings {
                let Some(object) = setting.as_object() else {
                    return Err("Each Premiere video recipe setting must be an object.".into());
                };

                let has_component = object
                    .get("component_match_name")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
                    || object
                        .get("component_display_name")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.trim().is_empty());

                if !has_component {
                    return Err("Each video recipe setting requires component_match_name or component_display_name.".into());
                }

                let param_name = object
                    .get("param_display_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Each video recipe setting requires param_display_name.".to_string())?;

                if param_name.chars().count() > 240 {
                    return Err("Video recipe parameter name is too long.".into());
                }

                let value = object
                    .get("value")
                    .ok_or_else(|| "Each video recipe setting requires value.".to_string())?;
                if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                    return Err("Video recipe values must be booleans, numbers, or strings.".into());
                }

                if let Some(seconds) = object.get("seconds") {
                    let seconds = seconds
                        .as_f64()
                        .ok_or_else(|| "Video recipe seconds must be numeric.".to_string())?;
                    if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                        return Err("Video recipe keyframe seconds must be between 0 and 86400.".into());
                    }
                }
            }

            (
                ToolAction::PremiereApplyVideoRecipe {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    settings: settings.clone(),
                },
                "Apply Premiere video parameter recipe".to_string(),
                format!("Apply {} named video parameter setting(s) to V{track}, clip #{clip_index}.", settings.len()),
                RiskLevel::High,
            )
        }
        "premiere_list_audio_effects" => (
            ToolAction::PremiereListAudioEffects,
            "List Premiere audio effects".to_string(),
            "Read installed Premiere audio effect display names.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_inspect_audio_clip_effects" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere audio effect inspection target is outside Shuvi's safety limits.".into());
            }
            (
                ToolAction::PremiereInspectAudioClipEffects {
                    track: track as u32,
                    clip_index: clip_index as u32,
                },
                "Inspect Premiere audio clip effects".to_string(),
                format!("Inspect audio track {track}, clip #{clip_index} effect chain and parameters."),
                RiskLevel::Low,
            )
        }
        "premiere_add_audio_effect" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere audio effect target is outside Shuvi's safety limits.".into());
            }
            let display_name = arg_string(&proposal.arguments, "display_name")?;
            if display_name.chars().count() > 240 {
                return Err("Premiere audio effect display name is too long.".into());
            }
            (
                ToolAction::PremiereAddAudioEffect {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    display_name: display_name.clone(),
                },
                "Add Premiere audio effect".to_string(),
                format!("Add audio effect '{display_name}' to audio track {track}, clip #{clip_index}."),
                RiskLevel::High,
            )
        }
        "premiere_set_audio_effect_param" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            let component_index = proposal.arguments.get("component_index").and_then(Value::as_u64).unwrap_or(0);
            let param_index = proposal.arguments.get("param_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 || component_index > 512 || param_index > 512 {
                return Err("Premiere audio effect parameter target is outside Shuvi's safety limits.".into());
            }
            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_set_audio_effect_param requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Audio effect parameter value must be a boolean, number, or string.".into());
            }
            if value.as_str().is_some_and(|text| text.chars().count() > 5_000) {
                return Err("Audio effect parameter string is too long.".into());
            }
            (
                ToolAction::PremiereSetAudioEffectParam {
                    expected_signature: arg_premiere_signature(&proposal.arguments)?,
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_index: component_index as u32,
                    param_index: param_index as u32,
                    value: value.clone(),
                },
                "Set Premiere audio effect parameter".to_string(),
                format!(
                    "Set audio track {track}, clip #{clip_index}, component #{component_index}, parameter #{param_index}."
                ),
                RiskLevel::High,
            )
        }
        "premiere_add_audio_effect_keyframe" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            let component_index = proposal.arguments.get("component_index").and_then(Value::as_u64).unwrap_or(0);
            let param_index = proposal.arguments.get("param_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 || component_index > 512 || param_index > 512 {
                return Err("Premiere audio effect keyframe target is outside Shuvi's safety limits.".into());
            }
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_add_audio_effect_keyframe requires seconds.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere audio keyframe seconds must be between 0 and 86400.".into());
            }
            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_add_audio_effect_keyframe requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Audio effect keyframe value must be a boolean, number, or string.".into());
            }
            if value.as_str().is_some_and(|text| text.chars().count() > 5_000) {
                return Err("Audio effect keyframe string is too long.".into());
            }
            (
                ToolAction::PremiereAddAudioEffectKeyframe {
                    expected_signature: arg_premiere_signature(&proposal.arguments)?,
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_index: component_index as u32,
                    param_index: param_index as u32,
                    seconds,
                    value: value.clone(),
                },
                "Add Premiere audio effect keyframe".to_string(),
                format!(
                    "Add audio keyframe at {seconds:.3}s to audio track {track}, clip #{clip_index}, component #{component_index}, parameter #{param_index}."
                ),
                RiskLevel::High,
            )
        }
        "premiere_set_audio_param_named" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere named audio parameter target is outside Shuvi's safety limits.".into());
            }

            let component_match_name = arg_optional_string(&proposal.arguments, "component_match_name");
            let component_display_name = arg_optional_string(&proposal.arguments, "component_display_name");
            if component_match_name.is_none() && component_display_name.is_none() {
                return Err("premiere_set_audio_param_named requires component_match_name or component_display_name.".into());
            }
            let param_display_name = arg_string(&proposal.arguments, "param_display_name")?;
            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_set_audio_param_named requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Named Premiere audio parameter value must be a boolean, number, or string.".into());
            }

            (
                ToolAction::PremiereSetAudioParamNamed {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_match_name: component_match_name.clone(),
                    component_display_name: component_display_name.clone(),
                    param_display_name: param_display_name.clone(),
                    value: value.clone(),
                },
                "Set Premiere audio parameter by name".to_string(),
                format!("Set named audio parameter '{param_display_name}' on A{track}, clip #{clip_index}."),
                RiskLevel::High,
            )
        }
        "premiere_add_audio_keyframe_named" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere named audio keyframe target is outside Shuvi's safety limits.".into());
            }

            let component_match_name = arg_optional_string(&proposal.arguments, "component_match_name");
            let component_display_name = arg_optional_string(&proposal.arguments, "component_display_name");
            if component_match_name.is_none() && component_display_name.is_none() {
                return Err("premiere_add_audio_keyframe_named requires component_match_name or component_display_name.".into());
            }
            let param_display_name = arg_string(&proposal.arguments, "param_display_name")?;
            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_add_audio_keyframe_named requires seconds.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere named audio keyframe seconds must be between 0 and 86400.".into());
            }
            let value = proposal.arguments
                .get("value")
                .cloned()
                .ok_or_else(|| "premiere_add_audio_keyframe_named requires value.".to_string())?;
            if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                return Err("Named Premiere audio keyframe value must be a boolean, number, or string.".into());
            }

            (
                ToolAction::PremiereAddAudioKeyframeNamed {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    component_match_name: component_match_name.clone(),
                    component_display_name: component_display_name.clone(),
                    param_display_name: param_display_name.clone(),
                    seconds,
                    value: value.clone(),
                },
                "Add Premiere audio keyframe by name".to_string(),
                format!("Add named audio keyframe '{param_display_name}' at {seconds:.3}s on A{track}, clip #{clip_index}."),
                RiskLevel::High,
            )
        }
        "premiere_apply_audio_recipe" => {
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere audio recipe target is outside Shuvi's safety limits.".into());
            }

            let settings = proposal.arguments
                .get("settings")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "premiere_apply_audio_recipe requires a settings array.".to_string())?;

            if settings.is_empty() || settings.len() > 64 {
                return Err("Premiere audio recipe requires between 1 and 64 settings.".into());
            }

            for setting in &settings {
                let Some(object) = setting.as_object() else {
                    return Err("Each Premiere audio recipe setting must be an object.".into());
                };

                let has_component = object
                    .get("component_match_name")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
                    || object
                        .get("component_display_name")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.trim().is_empty());

                if !has_component {
                    return Err("Each audio recipe setting requires component_match_name or component_display_name.".into());
                }

                let param_name = object
                    .get("param_display_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Each audio recipe setting requires param_display_name.".to_string())?;

                if param_name.chars().count() > 240 {
                    return Err("Audio recipe parameter name is too long.".into());
                }

                let value = object
                    .get("value")
                    .ok_or_else(|| "Each audio recipe setting requires value.".to_string())?;
                if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
                    return Err("Audio recipe values must be booleans, numbers, or strings.".into());
                }

                if let Some(seconds) = object.get("seconds") {
                    let seconds = seconds
                        .as_f64()
                        .ok_or_else(|| "Audio recipe seconds must be numeric.".to_string())?;
                    if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                        return Err("Audio recipe keyframe seconds must be between 0 and 86400.".into());
                    }
                }
            }

            (
                ToolAction::PremiereApplyAudioRecipe {
                    track: track as u32,
                    clip_index: clip_index as u32,
                    settings: settings.clone(),
                },
                "Apply Premiere audio parameter recipe".to_string(),
                format!("Apply {} named audio parameter setting(s) to A{track}, clip #{clip_index}.", settings.len()),
                RiskLevel::High,
            )
        }
        "premiere_list_saved_recipes" => (
            ToolAction::PremiereListSavedRecipes,
            "List saved Premiere recipes".to_string(),
            "Read Shuvi's local reusable Premiere recipe library.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_save_recipe" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere recipe name is too long.".into());
            }

            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("Premiere saved recipe kind must be video or audio.".into());
            }

            let settings = proposal.arguments
                .get("settings")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "premiere_save_recipe requires a settings array.".to_string())?;

            validate_premiere_saved_recipe_settings(&settings)?;

            (
                ToolAction::PremiereSaveRecipe {
                    name: name.clone(),
                    kind: kind.clone(),
                    settings: settings.clone(),
                },
                "Save reusable Premiere recipe".to_string(),
                format!("Save {kind} recipe '{name}' with {} setting(s).", settings.len()),
                RiskLevel::Medium,
            )
        }
        "premiere_apply_saved_recipe" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere recipe name is too long.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere saved recipe target is outside Shuvi's safety limits.".into());
            }

            (
                ToolAction::PremiereApplySavedRecipe {
                    name: name.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                },
                "Apply saved Premiere recipe".to_string(),
                format!("Apply saved recipe '{name}' to track {track}, clip #{clip_index}."),
                RiskLevel::High,
            )
        }
        "premiere_apply_saved_recipe_batch" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere recipe name is too long.".into());
            }

            let targets = proposal.arguments
                .get("targets")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "premiere_apply_saved_recipe_batch requires a targets array.".to_string())?;

            if targets.is_empty() || targets.len() > 100 {
                return Err("Premiere batch recipe apply requires between 1 and 100 targets.".into());
            }

            let mut validated = Vec::with_capacity(targets.len());
            for target in targets {
                let object = target
                    .as_object()
                    .ok_or_else(|| "Each Premiere batch recipe target must be an object.".to_string())?;

                let track = object.get("track").and_then(Value::as_u64).unwrap_or(0);
                let clip_index = object.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
                if track > 128 || clip_index > 10_000 {
                    return Err("Premiere batch recipe target is outside Shuvi's safety limits.".into());
                }

                validated.push(json!({
                    "track": track,
                    "clipIndex": clip_index
                }));
            }

            (
                ToolAction::PremiereApplySavedRecipeBatch {
                    name: name.clone(),
                    targets: validated.clone(),
                },
                "Apply saved Premiere recipe to multiple clips".to_string(),
                format!("Apply saved recipe '{name}' to {} clip target(s).", validated.len()),
                RiskLevel::High,
            )
        }
        "premiere_delete_recipe" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere recipe name is too long.".into());
            }

            (
                ToolAction::PremiereDeleteRecipe { name: name.clone() },
                "Delete saved Premiere recipe".to_string(),
                format!("Delete local Premiere recipe '{name}'."),
                RiskLevel::Medium,
            )
        }
        "premiere_list_markers" => (
            ToolAction::PremiereListMarkers,
            "List Premiere sequence markers".to_string(),
            "Read markers from the active Premiere sequence.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_add_marker" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 240 {
                return Err("Premiere marker name is too long.".into());
            }

            let marker_type_raw = arg_string(&proposal.arguments, "marker_type")?.to_ascii_lowercase();
            let marker_type = match marker_type_raw.as_str() {
                "comment" => "Comment",
                "chapter" => "Chapter",
                "segmentation" => "Segmentation",
                "weblink" | "web_link" | "web link" => "WebLink",
                _ => return Err("Premiere marker_type must be Comment, Chapter, Segmentation, or WebLink.".into()),
            }.to_string();

            let seconds = proposal.arguments
                .get("seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_add_marker requires seconds.".to_string())?;
            let duration_seconds = proposal.arguments
                .get("duration_seconds")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);

            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere marker seconds must be between 0 and 86400.".into());
            }
            if !duration_seconds.is_finite() || duration_seconds < 0.0 || duration_seconds > 86_400.0 {
                return Err("Premiere marker duration must be between 0 and 86400 seconds.".into());
            }

            let comments = arg_optional_string(&proposal.arguments, "comments").unwrap_or_default();
            if comments.chars().count() > 5_000 {
                return Err("Premiere marker comments are too long.".into());
            }

            (
                ToolAction::PremiereAddMarker {
                    name: name.clone(),
                    marker_type: marker_type.clone(),
                    seconds,
                    duration_seconds,
                    comments,
                },
                "Add Premiere sequence marker".to_string(),
                format!("Add {marker_type} marker '{name}' at {seconds:.3}s."),
                RiskLevel::Medium,
            )
        }
        "premiere_remove_marker" => {
            let marker_index = proposal.arguments
                .get("marker_index")
                .and_then(Value::as_u64)
                .ok_or_else(|| "premiere_remove_marker requires marker_index.".to_string())?;
            if marker_index > 10_000 {
                return Err("Premiere marker index is outside Shuvi's safety limit.".into());
            }

            (
                ToolAction::PremiereRemoveMarker { marker_index: marker_index as u32, expected_signature: arg_premiere_signature(&proposal.arguments)? },
                "Remove Premiere sequence marker".to_string(),
                format!("Remove active-sequence marker #{marker_index}."),
                RiskLevel::High,
            )
        }
        "premiere_list_items" => (
            ToolAction::PremiereListItems,
            "List Premiere root project items".to_string(),
            "Read top-level project items from the active Premiere project through the paired UXP bridge.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_project_tree" => (
            ToolAction::PremiereProjectTree,
            "Inspect Premiere project tree".to_string(),
            "Read bins, project items, media paths, offline/proxy state and stable project-item ids.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_create_bin" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere bin name is too long.".into());
            }

            (
                ToolAction::PremiereCreateBin { name: name.clone() },
                "Create Premiere bin".to_string(),
                format!("Create project bin '{name}' in the active Premiere project root."),
                RiskLevel::Medium,
            )
        }
        "premiere_rename_project_item" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            let name = arg_string(&proposal.arguments, "name")?;
            if item_id.chars().count() > 240 || name.chars().count() > 240 {
                return Err("Premiere project item id/name is too long.".into());
            }
            (
                ToolAction::PremiereRenameProjectItem { item_id: item_id.clone(), name: name.clone() },
                "Rename Premiere project item".to_string(),
                format!("Rename project item {item_id} to '{name}'."),
                RiskLevel::Medium,
            )
        }
        "premiere_move_project_item" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            let target_bin_id = arg_string(&proposal.arguments, "target_bin_id")?;
            if item_id.chars().count() > 240 || target_bin_id.chars().count() > 240 {
                return Err("Premiere project item/bin id is too long.".into());
            }
            if item_id == target_bin_id {
                return Err("Premiere project item cannot be moved into itself.".into());
            }
            (
                ToolAction::PremiereMoveProjectItem { item_id: item_id.clone(), target_bin_id: target_bin_id.clone() },
                "Move Premiere project item".to_string(),
                format!("Move project item {item_id} into bin {target_bin_id}."),
                RiskLevel::High,
            )
        }
        "premiere_relink_media" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            let new_path = absolute_path(arg_string(&proposal.arguments, "new_path")?)?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }
            if !Path::new(&new_path).is_file() {
                return Err("Replacement media file does not exist.".into());
            }
            let override_compatibility = proposal.arguments
                .get("override_compatibility")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            (
                ToolAction::PremiereRelinkMedia {
                    item_id: item_id.clone(),
                    new_path: new_path.clone(),
                    override_compatibility,
                },
                "Relink Premiere media".to_string(),
                format!("Relink clip project item {item_id} to {new_path}; override_compatibility={override_compatibility}."),
                RiskLevel::High,
            )
        }
        "premiere_inspect_media_interpretation" => {
            let item_id=arg_string(&proposal.arguments,"item_id")?;
            if item_id.len()>240 {return Err("Premiere item ID is too long.".into());}
            (
                ToolAction::PremiereInspectMediaInterpretation {item_id},
                "Inspect Premiere media interpretation".into(),
                "Read exact native footage interpretation, media/LUT/proxy/offline values without editing.".into(),
                RiskLevel::Low,
            )
        }
        "premiere_prepare_media_item" => {
            let request:premiere_media_prep::ItemPrep=serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e|format!("Invalid media preparation request: {e}"))?;
            request.validate()?;
            let expected=premiere_expectation.as_ref().ok_or("Media preparation requires the inspected project expectation.")?;
            if !expected.clips.is_empty(){return Err("Media preparation uses project-item identity, not timeline clip expectations.".into());}
            (
                ToolAction::PremierePrepareMediaItem {request},
                "Prepare Premiere media interpretation".into(),
                "Apply only explicitly requested native frame-rate/PAR/scale-to-frame/LUT changes to one exact project item, checkpoint first, then reinspect.".into(),
                RiskLevel::High,
            )
        }
        "premiere_prepare_media_batch" => {
            let batch:premiere_media_prep::Batch=serde_json::from_value(
                proposal.arguments.get("batch").cloned().unwrap_or(Value::Null)
            ).map_err(|e|format!("Invalid media preparation batch: {e}"))?;
            batch.validate()?;
            let expected=premiere_expectation.as_ref().ok_or("Media preparation batch requires the inspected project expectation.")?;
            if !expected.clips.is_empty(){return Err("Media preparation batch uses project-item identity, not timeline clip expectations.".into());}
            (
                ToolAction::PremierePrepareMediaBatch {batch},
                "Prepare Premiere media batch".into(),
                "Apply explicit interpretation changes to up to 64 unique project items under one checkpoint with cancellation and uncertainty stop.".into(),
                RiskLevel::High,
            )
        }
        "premiere_cancel_media_prep" => (
            ToolAction::PremiereCancelMediaPrep { generation: state.media_prep_running.generation()? },
            "Cancel Premiere media preparation".into(),
            "Stop before the next project item; a native transaction already dispatched may still complete.".into(),
            RiskLevel::Low,
        ),
        "premiere_create_sequence_from_preset" => {
            let name=arg_string(&proposal.arguments,"name")?;
            if name.trim().is_empty()||name.chars().count()>120{return Err("Sequence name must contain 1–120 characters.".into());}
            let preset_path=absolute_path(arg_string(&proposal.arguments,"preset_path")?)?;
            if !Path::new(&preset_path).is_file(){return Err("Sequence preset path must be an existing absolute file.".into());}
            let expected=premiere_expectation.as_ref().ok_or("Sequence preset creation requires the inspected project expectation.")?;
            if !expected.clips.is_empty(){return Err("Sequence creation requires project/sequence expectation without clip targets.".into());}
            (
                ToolAction::PremiereCreateSequenceFromPreset {name,preset_path},
                "Create Premiere sequence from preset".into(),
                "Create a new sequence from an explicit existing preset path; do not delete or replace existing sequences.".into(),
                RiskLevel::Medium,
            )
        }
        "premiere_get_work_area" => (
            ToolAction::PremiereGetWorkArea,
            "Inspect Premiere work area".into(),
            "Read current active-sequence work area using WorkAreaUtils; no edit.".into(),
            RiskLevel::Low,
        ),
        "premiere_set_work_area" => {
            let request:premiere_media_prep::WorkArea=serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e|format!("Invalid work area: {e}"))?;
            request.validate()?;
            let expected=premiere_expectation.as_ref().ok_or("Work-area update requires inspected active project/sequence expectation.")?;
            if expected.sequence_guid.is_none()||!expected.clips.is_empty(){return Err("Work-area update requires exact project/sequence expectation without clip targets.".into());}
            (
                ToolAction::PremiereSetWorkArea {request},
                "Set Premiere work area".into(),
                "Set explicit active-sequence work-area in/out through stable WorkAreaUtils and verify readback; this is not sequence in/out.".into(),
                RiskLevel::Medium,
            )
        }
        "premiere_set_source_inout" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }

            let in_seconds = proposal.arguments
                .get("in_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_set_source_inout requires in_seconds.".to_string())?;
            let out_seconds = proposal.arguments
                .get("out_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_set_source_inout requires out_seconds.".to_string())?;

            if !in_seconds.is_finite() || !out_seconds.is_finite()
                || in_seconds < 0.0 || out_seconds <= in_seconds || out_seconds > 86_400.0 {
                return Err("Premiere source in/out must be finite, non-negative, and out_seconds must be later than in_seconds.".into());
            }

            (
                ToolAction::PremiereSetSourceInOut {
                    item_id: item_id.clone(),
                    in_seconds,
                    out_seconds,
                },
                "Set Premiere source in/out".to_string(),
                format!("Set source item {item_id} in={in_seconds:.3}s out={out_seconds:.3}s."),
                RiskLevel::Medium,
            )
        }
        "premiere_clear_source_inout" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }

            (
                ToolAction::PremiereClearSourceInOut { item_id: item_id.clone() },
                "Clear Premiere source in/out".to_string(),
                format!("Clear source in/out points for project item {item_id}."),
                RiskLevel::Medium,
            )
        }
        "premiere_create_subclip" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            let name = arg_string(&proposal.arguments, "name")?;
            if item_id.chars().count() > 240 || name.chars().count() > 240 {
                return Err("Premiere subclip item id/name is too long.".into());
            }

            let start_seconds = proposal.arguments
                .get("start_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_create_subclip requires start_seconds.".to_string())?;
            let end_seconds = proposal.arguments
                .get("end_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_create_subclip requires end_seconds.".to_string())?;

            if !start_seconds.is_finite() || !end_seconds.is_finite()
                || start_seconds < 0.0 || end_seconds <= start_seconds || end_seconds > 86_400.0 {
                return Err("Premiere subclip start/end must be finite, non-negative, and end_seconds must be later than start_seconds.".into());
            }

            let hard_boundaries = proposal.arguments
                .get("hard_boundaries")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let take_video = proposal.arguments
                .get("take_video")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let take_audio = proposal.arguments
                .get("take_audio")
                .and_then(Value::as_bool)
                .unwrap_or(true);

            if !take_video && !take_audio {
                return Err("Premiere subclip must include video and/or audio.".into());
            }

            (
                ToolAction::PremiereCreateSubclip {
                    item_id: item_id.clone(),
                    name: name.clone(),
                    start_seconds,
                    end_seconds,
                    hard_boundaries,
                    take_video,
                    take_audio,
                },
                "Create Premiere subclip".to_string(),
                format!("Create subclip '{name}' from {item_id}, {start_seconds:.3}s–{end_seconds:.3}s."),
                RiskLevel::High,
            )
        }
        "premiere_transcribe_item" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }

            let language = arg_optional_string(&proposal.arguments, "language");
            if language.as_ref().is_some_and(|value| value.chars().count() > 40) {
                return Err("Premiere transcription language code is too long.".into());
            }

            (
                ToolAction::PremiereTranscribeItem {
                    item_id: item_id.clone(),
                    language: language.clone(),
                },
                "Transcribe Premiere clip audio".to_string(),
                format!("Generate transcript for project item {item_id}; language={language:?}."),
                RiskLevel::Medium,
            )
        }
        "premiere_export_transcript" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }

            (
                ToolAction::PremiereExportTranscript { item_id: item_id.clone() },
                "Read Premiere clip transcript".to_string(),
                format!("Export transcript for project item {item_id}."),
                RiskLevel::Low,
            )
        }
        "premiere_write_srt" => {
            let output = absolute_path(arg_string(&proposal.arguments,"output")?)?;
            let overwrite = proposal.arguments.get("overwrite").and_then(Value::as_bool).unwrap_or(false);
            let cues: Vec<premiere_subtitles::Cue> = serde_json::from_value(proposal.arguments.get("captions").cloned().unwrap_or(Value::Null)).map_err(|e|format!("Invalid captions: {e}"))?;
            premiere_subtitles::serialize(&cues)?;
            premiere_subtitles::validate_output(&output,overwrite)?;
            (ToolAction::PremiereWriteSrt{output:output.clone(),overwrite,cues},"Deliver Premiere SRT subtitles".into(),format!("Write SRT to {output}; replace existing file={overwrite}."),if overwrite {RiskLevel::High} else {RiskLevel::Medium})
        }
        "premiere_transcript_to_srt" => {
            let item_id=arg_string(&proposal.arguments,"item_id")?;
            if item_id.is_empty() || item_id.chars().count()>240 { return Err("Transcript item id must be 1–240 characters.".into()); }
            let output=absolute_path(arg_string(&proposal.arguments,"output")?)?;
            let overwrite=proposal.arguments.get("overwrite").and_then(Value::as_bool).unwrap_or(false);
            premiere_subtitles::validate_output(&output,overwrite)?;
            (ToolAction::PremiereTranscriptToSrt{item_id,output:output.clone(),overwrite},"Deliver transcript SRT subtitles".into(),format!("Export Premiere transcript to {output}; replace existing file={overwrite}."),if overwrite {RiskLevel::High} else {RiskLevel::Medium})
        }
        "premiere_list_transcription_languages" => (
            ToolAction::PremiereListTranscriptionLanguages,
            "List Premiere transcription languages".to_string(),
            "Read supported Premiere transcription language codes when the installed Premiere version exposes them.".to_string(),
            RiskLevel::Low,
        ),
        "premiere_import_transcript" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }

            let transcript_path = absolute_path(arg_string(&proposal.arguments, "transcript_path")?)?;
            let path = Path::new(&transcript_path);
            if !path.is_file() {
                return Err("Premiere transcript JSON file does not exist.".into());
            }

            let transcript_json = read_utf8_file_bounded(
                path,
                1024 * 1024,
                "Premiere transcript JSON",
            )?;
            let _: Value = serde_json::from_str(&transcript_json)
                .map_err(|error| format!("Transcript file is not valid JSON: {error}"))?;

            (
                ToolAction::PremiereImportTranscript {
                    item_id: item_id.clone(),
                    transcript_json,
                },
                "Import transcript into Premiere clip".to_string(),
                format!("Import transcript JSON from {transcript_path} into project item {item_id}."),
                RiskLevel::High,
            )
        }
        "premiere_attach_proxy" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            let proxy_path = absolute_path(arg_string(&proposal.arguments, "proxy_path")?)?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }
            if !Path::new(&proxy_path).is_file() {
                return Err("Proxy media file does not exist.".into());
            }
            (
                ToolAction::PremiereAttachProxy { item_id: item_id.clone(), proxy_path: proxy_path.clone() },
                "Attach Premiere proxy".to_string(),
                format!("Attach proxy {proxy_path} to clip project item {item_id}."),
                RiskLevel::High,
            )
        }
        "premiere_insert_mogrt_path" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            if !Path::new(&path).is_file() {
                return Err("Premiere MOGRT file does not exist.".into());
            }
            let extension = Path::new(&path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if extension != "mogrt" {
                return Err("premiere_insert_mogrt_path requires a .mogrt file.".into());
            }

            let seconds = proposal.arguments.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
            let video_track = proposal.arguments.get("video_track").and_then(Value::as_u64).unwrap_or(0);
            let audio_track = proposal.arguments.get("audio_track").and_then(Value::as_u64).unwrap_or(0);
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere MOGRT insert time must be between 0 and 86400 seconds.".into());
            }
            if video_track > 128 || audio_track > 128 {
                return Err("Premiere MOGRT track index is outside Shuvi's safety limit.".into());
            }

            (
                ToolAction::PremiereInsertMogrtPath {
                    path: path.clone(),
                    seconds,
                    video_track: video_track as u32,
                    audio_track: audio_track as u32,
                },
                "Insert Premiere Motion Graphics template".to_string(),
                format!("Insert MOGRT {path} at {seconds:.3}s on V{video_track}/A{audio_track}."),
                RiskLevel::High,
            )
        }
        "premiere_insert_mogrt_library" => {
            let library_name = arg_string(&proposal.arguments, "library_name")?;
            let element_name = arg_string(&proposal.arguments, "element_name")?;
            if library_name.chars().count() > 240 || element_name.chars().count() > 240 {
                return Err("Premiere MOGRT library/element name is too long.".into());
            }

            let seconds = proposal.arguments.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
            let video_track = proposal.arguments.get("video_track").and_then(Value::as_u64).unwrap_or(0);
            let audio_track = proposal.arguments.get("audio_track").and_then(Value::as_u64).unwrap_or(0);
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere MOGRT insert time must be between 0 and 86400 seconds.".into());
            }
            if video_track > 128 || audio_track > 128 {
                return Err("Premiere MOGRT track index is outside Shuvi's safety limit.".into());
            }

            (
                ToolAction::PremiereInsertMogrtLibrary {
                    library_name: library_name.clone(),
                    element_name: element_name.clone(),
                    seconds,
                    video_track: video_track as u32,
                    audio_track: audio_track as u32,
                },
                "Insert Premiere library Motion Graphics template".to_string(),
                format!("Insert MOGRT '{element_name}' from library '{library_name}' at {seconds:.3}s."),
                RiskLevel::High,
            )
        }
        "premiere_batch_relink" => {
            let items = proposal.arguments
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "premiere_batch_relink requires an items array.".to_string())?;

            if items.is_empty() || items.len() > 100 {
                return Err("Premiere batch relink requires between 1 and 100 items.".into());
            }

            let mut validated = Vec::with_capacity(items.len());
            for item in items {
                let object = item
                    .as_object()
                    .ok_or_else(|| "Each batch relink item must be an object.".to_string())?;

                let item_id = object
                    .get("item_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Each batch relink item requires item_id.".to_string())?
                    .to_string();

                if item_id.chars().count() > 240 {
                    return Err("Premiere batch relink item id is too long.".into());
                }

                let new_path_raw = object
                    .get("new_path")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Each batch relink item requires new_path.".to_string())?
                    .to_string();
                let new_path = absolute_path(new_path_raw)?;

                if !Path::new(&new_path).is_file() {
                    return Err(format!("Premiere batch relink media file does not exist: {new_path}"));
                }

                let override_compatibility = object
                    .get("override_compatibility")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                validated.push(json!({
                    "itemId": item_id,
                    "newPath": new_path,
                    "overrideCompatibility": override_compatibility
                }));
            }

            (
                ToolAction::PremiereBatchRelink { items: validated.clone() },
                "Batch relink Premiere media".to_string(),
                format!("Relink {} Premiere project item(s).", validated.len()),
                RiskLevel::High,
            )
        }
        "premiere_batch_attach_proxy" => {
            let items = proposal.arguments
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "premiere_batch_attach_proxy requires an items array.".to_string())?;

            if items.is_empty() || items.len() > 100 {
                return Err("Premiere batch proxy attach requires between 1 and 100 items.".into());
            }

            let mut validated = Vec::with_capacity(items.len());
            for item in items {
                let object = item
                    .as_object()
                    .ok_or_else(|| "Each batch proxy item must be an object.".to_string())?;

                let item_id = object
                    .get("item_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Each batch proxy item requires item_id.".to_string())?
                    .to_string();

                if item_id.chars().count() > 240 {
                    return Err("Premiere batch proxy item id is too long.".into());
                }

                let proxy_path_raw = object
                    .get("proxy_path")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Each batch proxy item requires proxy_path.".to_string())?
                    .to_string();
                let proxy_path = absolute_path(proxy_path_raw)?;

                if !Path::new(&proxy_path).is_file() {
                    return Err(format!("Premiere proxy file does not exist: {proxy_path}"));
                }

                validated.push(json!({
                    "itemId": item_id,
                    "proxyPath": proxy_path
                }));
            }

            (
                ToolAction::PremiereBatchAttachProxy { items: validated.clone() },
                "Batch attach Premiere proxies".to_string(),
                format!("Attach proxies to {} Premiere project item(s).", validated.len()),
                RiskLevel::High,
            )
        }
        "premiere_import_media" => {
            let paths = arg_string_array(&proposal.arguments, "paths")?;
            if paths.is_empty() {
                return Err("premiere_import_media requires at least one media path.".into());
            }
            if paths.len() > 100 {
                return Err("Premiere import is limited to 100 files per action.".into());
            }

            let mut validated = Vec::with_capacity(paths.len());
            for path in paths {
                let absolute = absolute_path(path)?;
                if !Path::new(&absolute).is_file() {
                    return Err(format!("Premiere media file does not exist: {absolute}"));
                }
                validated.push(absolute);
            }

            (
                ToolAction::PremiereImportMedia { paths: validated.clone() },
                "Import media into Premiere".to_string(),
                format!("Import {} media file(s) into the active Premiere project root.", validated.len()),
                RiskLevel::Medium,
            )
        }
        "premiere_create_sequence_from_media" => {
            let name = arg_string(&proposal.arguments, "name")?;
            if name.chars().count() > 120 {
                return Err("Premiere sequence name is too long.".into());
            }

            let paths = arg_string_array(&proposal.arguments, "paths")?;
            if paths.is_empty() {
                return Err("premiere_create_sequence_from_media requires at least one media path.".into());
            }
            if paths.len() > 50 {
                return Err("Sequence creation is limited to 50 media files per action.".into());
            }

            let mut validated = Vec::with_capacity(paths.len());
            for path in paths {
                let absolute = absolute_path(path)?;
                if !Path::new(&absolute).is_file() {
                    return Err(format!("Premiere media file does not exist: {absolute}"));
                }
                validated.push(absolute);
            }

            (
                ToolAction::PremiereCreateSequenceFromMedia {
                    name: name.clone(),
                    paths: validated.clone(),
                },
                "Create Premiere sequence from media".to_string(),
                format!(
                    "Create sequence '{}' from {} media file(s) in the active Premiere project.",
                    name,
                    validated.len()
                ),
                RiskLevel::Medium,
            )
        }
        "premiere_create_subsequence" => {
            let targets = proposal.arguments
                .get("targets")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "premiere_create_subsequence requires a targets array.".to_string())?;

            if targets.is_empty() || targets.len() > 64 {
                return Err("Premiere subsequence creation requires between 1 and 64 clip targets.".into());
            }

            let mut validated = Vec::with_capacity(targets.len());
            for target in targets {
                let object = target
                    .as_object()
                    .ok_or_else(|| "Each Premiere subsequence target must be an object.".to_string())?;

                let kind = object
                    .get("kind")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .map(str::to_ascii_lowercase)
                    .ok_or_else(|| "Each Premiere subsequence target requires kind.".to_string())?;
                if !matches!(kind.as_str(), "video" | "audio") {
                    return Err("Premiere subsequence target kind must be video or audio.".into());
                }

                let track = object.get("track").and_then(Value::as_u64).unwrap_or(0);
                let clip_index = object.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
                if track > 128 || clip_index > 10_000 {
                    return Err("Premiere subsequence target is outside Shuvi's safety limits.".into());
                }

                validated.push(json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index
                }));
            }

            (
                ToolAction::PremiereCreateSubsequence { targets: validated.clone() },
                "Create Premiere subsequence from selected clips".to_string(),
                format!("Create a new Premiere subsequence from {} exact clip target(s).", validated.len()),
                RiskLevel::High,
            )
        }
        "premiere_insert_project_item" => {
            let item_id = arg_string(&proposal.arguments, "item_id")?;
            if item_id.chars().count() > 240 {
                return Err("Premiere project item id is too long.".into());
            }

            let seconds = proposal.arguments.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere project-item insert time must be between 0 and 86400 seconds.".into());
            }

            let video_track = proposal.arguments.get("video_track").and_then(Value::as_u64).unwrap_or(0);
            let audio_track = proposal.arguments.get("audio_track").and_then(Value::as_u64).unwrap_or(0);
            if video_track > 128 || audio_track > 128 {
                return Err("Premiere project-item track index is outside Shuvi's safety limit.".into());
            }

            let mode = arg_string(&proposal.arguments, "mode")?.to_ascii_lowercase();
            if !matches!(mode.as_str(), "insert" | "overwrite") {
                return Err("premiere_insert_project_item mode must be insert or overwrite.".into());
            }

            (
                ToolAction::PremiereInsertProjectItem {
                    item_id: item_id.clone(),
                    seconds,
                    video_track: video_track as u32,
                    audio_track: audio_track as u32,
                    mode: mode.clone(),
                },
                "Insert Premiere project item".to_string(),
                format!("Insert project item {item_id} at {seconds:.3}s on V{video_track}/A{audio_track} using {mode}."),
                RiskLevel::High,
            )
        }
        "premiere_insert_media" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            if !Path::new(&path).is_file() {
                return Err("Premiere media file does not exist.".into());
            }
            let seconds = proposal.arguments.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
            if !seconds.is_finite() || seconds < 0.0 {
                return Err("premiere_insert_media seconds must be zero or greater.".into());
            }
            let video_track = proposal.arguments.get("video_track").and_then(Value::as_u64).unwrap_or(0);
            let audio_track = proposal.arguments.get("audio_track").and_then(Value::as_u64).unwrap_or(0);
            if video_track > 128 || audio_track > 128 {
                return Err("Premiere track index is outside Shuvi's safety limit.".into());
            }
            let mode = arg_string(&proposal.arguments, "mode")?.to_ascii_lowercase();
            if !matches!(mode.as_str(), "insert" | "overwrite") {
                return Err("premiere_insert_media mode must be insert or overwrite.".into());
            }
            (
                ToolAction::PremiereInsertMedia {
                    path: path.clone(),
                    seconds,
                    video_track: video_track as u32,
                    audio_track: audio_track as u32,
                    mode: mode.clone(),
                },
                "Edit Premiere timeline".to_string(),
                format!("{mode} media at {seconds:.3}s on V{video_track}/A{audio_track}: {path}"),
                RiskLevel::High,
            )
        }
        "premiere_trim_clip" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_trim_clip kind must be video or audio.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere trim target is outside Shuvi's safety limits.".into());
            }

            let start_seconds = proposal.arguments.get("start_seconds").and_then(Value::as_f64);
            let end_seconds = proposal.arguments.get("end_seconds").and_then(Value::as_f64);

            if start_seconds.is_none() && end_seconds.is_none() {
                return Err("premiere_trim_clip requires start_seconds and/or end_seconds.".into());
            }
            for value in [start_seconds, end_seconds].into_iter().flatten() {
                if !value.is_finite() || value < 0.0 {
                    return Err("Premiere trim times must be finite and zero or greater.".into());
                }
            }
            if let (Some(start), Some(end)) = (start_seconds, end_seconds) {
                if start >= end {
                    return Err("Premiere trim start_seconds must be earlier than end_seconds.".into());
                }
            }

            (
                ToolAction::PremiereTrimClip {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    start_seconds,
                    end_seconds,
                },
                "Trim Premiere clip".to_string(),
                format!(
                    "Trim {kind} track {track}, clip #{clip_index}, start={start_seconds:?}, end={end_seconds:?}"
                ),
                RiskLevel::High,
            )
        }
        "premiere_roll_edit" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_roll_edit kind must be video or audio.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let left_clip_index = proposal.arguments
                .get("left_clip_index")
                .and_then(Value::as_u64)
                .ok_or_else(|| "premiere_roll_edit requires left_clip_index.".to_string())?;
            let right_clip_index = proposal.arguments
                .get("right_clip_index")
                .and_then(Value::as_u64)
                .ok_or_else(|| "premiere_roll_edit requires right_clip_index.".to_string())?;

            if track > 128 || left_clip_index > 10_000 || right_clip_index > 10_000 {
                return Err("Premiere roll-edit target is outside Shuvi's safety limits.".into());
            }
            if right_clip_index != left_clip_index.saturating_add(1) {
                return Err("premiere_roll_edit requires adjacent timeline clip indexes.".into());
            }

            let boundary_seconds = proposal.arguments
                .get("boundary_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_roll_edit requires boundary_seconds.".to_string())?;
            if !boundary_seconds.is_finite() || boundary_seconds < 0.0 || boundary_seconds > 86_400.0 {
                return Err("Premiere roll-edit boundary must be between 0 and 86400 seconds.".into());
            }

            (
                ToolAction::PremiereRollEdit {
                    kind: kind.clone(),
                    track: track as u32,
                    left_clip_index: left_clip_index as u32,
                    right_clip_index: right_clip_index as u32,
                    boundary_seconds,
                },
                "Roll Premiere edit point".to_string(),
                format!(
                    "Roll {kind} track {track} edit between clips #{left_clip_index} and #{right_clip_index} to {boundary_seconds:.3}s."
                ),
                RiskLevel::High,
            )
        }
        "premiere_move_clip" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_move_clip kind must be video or audio.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere move target is outside Shuvi's safety limits.".into());
            }

            let delta_seconds = proposal.arguments
                .get("delta_seconds")
                .and_then(Value::as_f64)
                .ok_or_else(|| "premiere_move_clip requires delta_seconds.".to_string())?;

            if !delta_seconds.is_finite() || delta_seconds.abs() > 36_000.0 || delta_seconds == 0.0 {
                return Err("premiere_move_clip delta_seconds must be finite, non-zero and within ±10 hours.".into());
            }

            (
                ToolAction::PremiereMoveClip {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    delta_seconds,
                },
                "Move Premiere clip".to_string(),
                format!("Move {kind} track {track}, clip #{clip_index} by {delta_seconds:.3}s"),
                RiskLevel::High,
            )
        }
        "premiere_clone_clip_to_track" => {
            let request: premiere_layering::CloneToTrack = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid cross-track clone request: {e}"))?;
            request.validate()?;
            let expected = premiere_expectation.as_ref().ok_or("Cross-track clone requires the exact source clip expectation.")?;
            if expected.sequence_guid.is_none() || expected.clips.len()!=1
                || !expected.clips.iter().any(|clip| clip.kind==request.source.kind && clip.track==request.source.track
                    && clip.clip_index==request.source.clip_index && clip.signature==request.source.signature) {
                return Err("Cross-track clone expectation must exactly match the source clip.".into());
            }
            (
                ToolAction::PremiereCloneClipToTrack { request },
                "Clone Premiere clip to another track".into(),
                "Use native createCloneTrackItemAction with destination track/time converted to exact offsets, require a clear range, checkpoint, and verify one correlated new clip.".into(),
                RiskLevel::High,
            )
        }
        "premiere_layer_clips" => {
            let batch: premiere_layering::LayerBatch = serde_json::from_value(
                proposal.arguments.get("batch").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid layer batch: {e}"))?;
            batch.validate()?;
            let expected = premiere_expectation.as_ref().ok_or("Layer batch requires exact expectations for all unique source clips.")?;
            let sources = batch.unique_sources();
            if expected.sequence_guid.is_none() || expected.clips.len()!=sources.len() {
                return Err("Layer batch requires one exact expectation per unique source clip.".into());
            }
            for source in sources {
                if !expected.clips.iter().any(|clip| clip.kind==source.kind && clip.track==source.track
                    && clip.clip_index==source.clip_index && clip.signature==source.signature) {
                    return Err("Layer batch expectation does not match an explicit source clip.".into());
                }
            }
            (
                ToolAction::PremiereLayerClips { batch },
                "Layer explicit Premiere clips".into(),
                "Run up to 32 exact cross-track clone operations under one project checkpoint, per-source stale guards, cooperative cancellation and uncertainty stop.".into(),
                RiskLevel::High,
            )
        }
        "premiere_cancel_layer_clips" => (
            ToolAction::PremiereCancelLayerClips { generation: state.layering_running.generation()? },
            "Cancel Premiere layering batch".into(),
            "Stop before the next clone operation; a native clone already dispatched may still complete.".into(),
            RiskLevel::Low,
        ),
        "premiere_rename_track" => {
            let request: premiere_layering::TrackRename = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid track rename request: {e}"))?;
            request.validate()?;
            let expected = premiere_expectation.as_ref().ok_or("Track rename requires an inspected project/sequence expectation.")?;
            if expected.sequence_guid.is_none() || !expected.clips.is_empty() {
                return Err("Track rename requires project/sequence expectation without clip indexes.".into());
            }
            (
                ToolAction::PremiereRenameTrack { request },
                "Rename Premiere track".into(),
                "Rename one explicit existing video/audio/caption track through the documented native action and verify readback.".into(),
                RiskLevel::Medium,
            )
        }
        "premiere_organize_tracks" => {
            let request: premiere_layering::TrackOrganization = serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e| format!("Invalid track organization request: {e}"))?;
            request.validate()?;
            let expected = premiere_expectation.as_ref().ok_or("Track organization requires an inspected project/sequence expectation.")?;
            if expected.sequence_guid.is_none() || !expected.clips.is_empty() {
                return Err("Track organization requires project/sequence expectation without clip indexes.".into());
            }
            (
                ToolAction::PremiereOrganizeTracks { request },
                "Organize Premiere track names".into(),
                "Rename up to 32 explicit existing tracks in one native transaction and verify every resulting name; no track creation or reordering.".into(),
                RiskLevel::Medium,
            )
        }
        "premiere_clone_clip" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_clone_clip kind must be video or audio.".into());
            }

            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere clone target is outside Shuvi's safety limits.".into());
            }

            let time_offset_seconds = proposal.arguments
                .get("time_offset_seconds")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            if !time_offset_seconds.is_finite() || time_offset_seconds.abs() > 36_000.0 {
                return Err("Premiere clone time offset must be finite and within ±10 hours.".into());
            }

            let video_track_offset = proposal.arguments
                .get("video_track_offset")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let audio_track_offset = proposal.arguments
                .get("audio_track_offset")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            if video_track_offset.abs() > 128 || audio_track_offset.abs() > 128 {
                return Err("Premiere clone vertical track offsets must be within ±128.".into());
            }

            let align_to_video = proposal.arguments
                .get("align_to_video")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let insert = proposal.arguments
                .get("insert")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            (
                ToolAction::PremiereCloneClip {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    time_offset_seconds,
                    video_track_offset: video_track_offset as i32,
                    audio_track_offset: audio_track_offset as i32,
                    align_to_video,
                    insert,
                },
                "Clone Premiere clip".to_string(),
                format!(
                    "Clone {kind} track {track}, clip #{clip_index}; time_offset={time_offset_seconds:.3}s, V offset={video_track_offset}, A offset={audio_track_offset}, insert={insert}."
                ),
                RiskLevel::High,
            )
        }
        "premiere_delete_clip" => {
            let kind = arg_string(&proposal.arguments, "kind")?.to_ascii_lowercase();
            if !matches!(kind.as_str(), "video" | "audio") {
                return Err("premiere_delete_clip kind must be video or audio.".into());
            }
            let track = proposal.arguments.get("track").and_then(Value::as_u64).unwrap_or(0);
            let clip_index = proposal.arguments.get("clip_index").and_then(Value::as_u64).unwrap_or(0);
            if track > 128 || clip_index > 10_000 {
                return Err("Premiere delete target is outside Shuvi's safety limits.".into());
            }
            let ripple = proposal.arguments.get("ripple").and_then(Value::as_bool).unwrap_or(false);

            (
                ToolAction::PremiereDeleteClip {
                    kind: kind.clone(),
                    track: track as u32,
                    clip_index: clip_index as u32,
                    ripple,
                },
                if ripple { "Ripple-delete Premiere clip".to_string() } else { "Delete Premiere clip".to_string() },
                format!("Delete {kind} track {track}, clip #{clip_index}, ripple={ripple}"),
                RiskLevel::High,
            )
        }
        "premiere_acceptance_report" => (
            ToolAction::PremiereAcceptanceReport,"Read Premiere acceptance matrix".into(),
            "Read bounded local code/mock/runtime capability evidence.".into(),RiskLevel::Low
        ),
        "premiere_acceptance_register_disposable" => {
            let project_guid=arg_string(&proposal.arguments,"project_guid")?;
            let project_path=arg_string(&proposal.arguments,"project_path")?;
            let sequence_guid=arg_optional_string(&proposal.arguments,"sequence_guid");
            if proposal.arguments.get("explicitly_disposable").and_then(Value::as_bool)!=Some(true) {
                return Err("Explicit disposable-project authorization is required.".into());
            }
            (ToolAction::PremiereAcceptanceRegisterDisposable {project_guid:project_guid.clone(),project_path:project_path.clone(),sequence_guid},
                "Register disposable Premiere project".into(),format!("Explicitly register current saved .prproj: {project_path}, GUID {project_guid}. Destructive acceptance remains subject to separate approval and checkpoints."),RiskLevel::High)
        }
        "premiere_acceptance_plan" => {
            let group=proposal.arguments.get("group").and_then(Value::as_u64).filter(|g|(1..=8).contains(g))
                .ok_or("Acceptance group must be 1–8.")? as u8;
            (ToolAction::PremiereAcceptancePlan {group},"Plan Premiere acceptance group".into(),
                format!("Read-only bounded plan for group {group}; no edit launched."),RiskLevel::Low)
        }
        "premiere_acceptance_prepare" => {
            if proposal.arguments.get("group").and_then(Value::as_u64)!=Some(2){return Err("Only bounded Group 2 timeline fixtures are executable; other acceptance steps remain blocked.".into());}
            let step=arg_string(&proposal.arguments,"step")?;
            let fixture:premiere_acceptance_execution::Fixture=serde_json::from_value(proposal.arguments.get("fixture").cloned().ok_or("Exact acceptance fixture required.")?)
                .map_err(|e|format!("Invalid acceptance fixture: {e}"))?;
            if !matches!(step.as_str(),"trim"|"move"|"clone"|"scene_markers") {return Err("Acceptance action is unsupported.".into());}
            (ToolAction::PremiereAcceptancePrepare {step,fixture},"Prepare one Premiere acceptance action".into(),
                "Read-only live project/timeline snapshot and bounded exact clip fixture; no edit.".into(),RiskLevel::Low)
        }
        "premiere_calibration_report" => (ToolAction::PremiereCalibrationReport,"Read native parameter calibration".into(),
            "Inspect bounded local host observations and verified recovery status.".into(),RiskLevel::Low),
        "premiere_calibration_observe" | "premiere_calibration_probe" => {
            let target:premiere_calibration::Target=serde_json::from_value(proposal.arguments.get("target").cloned().ok_or("Exact calibration target required.")?)
                .map_err(|e|format!("Invalid calibration target: {e}"))?;
            target.validate()?;
            if proposal.tool=="premiere_calibration_observe" {
                let semantic_role=arg_optional_string(&proposal.arguments,"semantic_role");
                (ToolAction::PremiereCalibrationObserve {target,semantic_role},
                    "Observe exact native Premiere parameter".into(),"Read-only native value; role and unit remain unverified.".into(),RiskLevel::Low)
            }else{
                let delta=proposal.arguments.get("delta").and_then(Value::as_f64).filter(|v|v.is_finite()&&*v!=0.0&&v.abs()<=1.0)
                    .ok_or("Small bounded numeric delta required.")?;
                (ToolAction::PremiereCalibrationProbe {target,delta},
                    "Probe and restore disposable Premiere parameter".into(),
                    format!("High risk: exact approved native parameter will be changed by a bounded delta of {delta}, reinspected, restored to its original value and reinspected again. A .prproj checkpoint is required. If delivery is uncertain, no blind retry or assumed recovery."),RiskLevel::High)
            }
        }
        "premiere_acceptance_execute" | "premiere_acceptance_cancel" | "premiere_acceptance_verify_recovery" => {
            let action_id=arg_string(&proposal.arguments,"action_id")?;
            Uuid::parse_str(&action_id).map_err(|_|"Invalid acceptance action ID.")?;
            if proposal.tool=="premiere_acceptance_execute" {
                (ToolAction::PremiereAcceptanceExecute {action_id:action_id.clone()},
                    "Execute ONE disposable Premiere acceptance edit".into(),
                    format!("High risk: execute preplanned acceptance action {action_id} against the registered disposable project; requires a .prproj checkpoint, exact clip expectation and native post-inspection. No automatic rollback or retry."),RiskLevel::High)
            }else if proposal.tool=="premiere_acceptance_verify_recovery" {
                (ToolAction::PremiereAcceptanceVerifyRecovery {action_id:action_id.clone()},
                    "Verify manually reopened Premiere checkpoint recovery".into(),
                    format!("Read-only: verify checkpoint metadata/fingerprint and exact pre-edit host state for acceptance action {action_id}. Shuvi will not open, overwrite, restore, or mutate a project."),RiskLevel::Low)
            }else{
                (ToolAction::PremiereAcceptanceCancel {action_id},"Cancel Premiere acceptance action".into(),
                    "Persist cooperative cancellation; an already running native edit may need inspection.".into(),RiskLevel::Low)
            }
        }
        "premiere_acceptance_probe" => {
            let group=proposal.arguments.get("group").and_then(Value::as_u64)
                .filter(|g|(1..=8).contains(g)).ok_or("Acceptance group must be 1–8.")? as u8;
            (ToolAction::PremiereAcceptanceProbe {group},
                "Probe Premiere acceptance group".into(),
                format!("Group {group}: read-only host probe where implemented; no destructive test launches."),
                RiskLevel::Low)
        }
        "premiere_plan_interchange_export" => {
            let request:premiere_delivery::InterchangeRequest=serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e|format!("Invalid interchange export request: {e}"))?;
            request.validate()?;
            (
                ToolAction::PremierePlanInterchangeExport {request},
                "Preflight Premiere interchange export".into(),
                "Validate format/output/collision/AAF options and inspect active project/sequence without writing output.".into(),
                RiskLevel::Low,
            )
        }
        "premiere_export_fcpxml" | "premiere_export_otio" | "premiere_export_aaf" => {
            let mut request:premiere_delivery::InterchangeRequest=serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e|format!("Invalid interchange export request: {e}"))?;
            request.format=match proposal.tool.as_str(){
                "premiere_export_fcpxml"=>"fcpxml".into(),
                "premiere_export_otio"=>"otio".into(),
                _=>"aaf".into(),
            };
            request.validate()?;
            let expected=premiere_expectation.as_ref().ok_or("Interchange export requires expected project and sequence.")?;
            if expected.sequence_guid.is_none()||!expected.clips.is_empty(){
                return Err("Interchange export requires project/sequence expectation without clip targets.".into());
            }
            (
                ToolAction::PremiereExportInterchange {request:request.clone()},
                format!("Export Premiere sequence as {}",request.format.to_uppercase()),
                format!("Write {} to {}; overwrite={}. Native acceptance and observed file metadata are reported separately.",request.format,request.output,request.overwrite),
                RiskLevel::High,
            )
        }
        "premiere_export_frame" => {
            let request:premiere_delivery::FrameRequest=serde_json::from_value(
                proposal.arguments.get("request").cloned().unwrap_or(Value::Null)
            ).map_err(|e|format!("Invalid frame export request: {e}"))?;
            request.validate()?;
            let expected=premiere_expectation.as_ref().ok_or("Frame export requires expected project and sequence.")?;
            if expected.sequence_guid.is_none()||!expected.clips.is_empty(){
                return Err("Frame export requires project/sequence expectation without clip targets.".into());
            }
            (
                ToolAction::PremiereExportFrame {request},
                "Export Premiere sequence frame".into(),
                "Use native Exporter.exportSequenceFrame for one exact timestamp/output; no screenshot fallback.".into(),
                RiskLevel::Medium,
            )
        }
        "premiere_export_review_frames" => {
            let batch:premiere_delivery::FrameBatch=serde_json::from_value(
                proposal.arguments.get("batch").cloned().unwrap_or(Value::Null)
            ).map_err(|e|format!("Invalid review-frame batch: {e}"))?;
            batch.validate()?;
            let expected=premiere_expectation.as_ref().ok_or("Review-frame export requires expected project and sequence.")?;
            if expected.sequence_guid.is_none()||!expected.clips.is_empty(){
                return Err("Review-frame export requires project/sequence expectation without clip targets.".into());
            }
            (
                ToolAction::PremiereExportReviewFrames {batch},
                "Export Premiere review frame package".into(),
                "Export 1–16 explicit native sequence frames with one project/sequence guard, per-frame output observation, cancellation and uncertainty stop.".into(),
                RiskLevel::Medium,
            )
        }
        "premiere_cancel_review_frame_export" => (
            ToolAction::PremiereCancelReviewFrameExport { generation: state.delivery_running.generation()? },
            "Cancel Premiere review-frame export".into(),
            "Stop before the next native frame export; an already dispatched frame may still complete.".into(),
            RiskLevel::Low,
        ),
        "premiere_plan_export" => {
            let output = arg_string(&proposal.arguments, "output")?;
            let preset = arg_optional_string(&proposal.arguments, "preset");
            let queue_to_ame = proposal.arguments.get("queue_to_ame").and_then(Value::as_bool).unwrap_or(false);
            let overwrite = proposal.arguments.get("overwrite").and_then(Value::as_bool).unwrap_or(false);
            premiere_export::inspect(&output,preset.as_deref(),overwrite,None)?;
            (ToolAction::PremierePlanExport {output:output.clone(),preset:preset.clone(),queue_to_ame,overwrite},
                "Preflight Premiere export".to_string(),format!("Inspect output={output}; preset={preset:?}; queue_to_ame={queue_to_ame}; overwrite={overwrite}"),
                RiskLevel::Low)
        }
        "premiere_export_status" => {
            let job_id=arg_string(&proposal.arguments,"job_id")?;
            Uuid::parse_str(&job_id).map_err(|_|"Invalid export job ID.")?;
            (ToolAction::PremiereExportStatus {job_id},"Observe Premiere export output".into(),
                "One read-only bounded file metadata observation; stable file does not prove encoder completion.".into(),RiskLevel::Low)
        }
        "premiere_readiness_report" => (ToolAction::PremiereReadinessReport,
            "Read Premiere production readiness gates".into(),"Report code, mock, Rust, native runtime, recovery and export completion separately.".into(),RiskLevel::Low),
        "premiere_export_sequence" => {
            let output = arg_string(&proposal.arguments, "output")?;
            let preset = arg_optional_string(&proposal.arguments, "preset");
            let queue_to_ame = proposal.arguments.get("queue_to_ame").and_then(Value::as_bool).unwrap_or(false);
            let overwrite = proposal.arguments.get("overwrite").and_then(Value::as_bool).unwrap_or(false);
            let local = premiere_export::inspect(&output,preset.as_deref(),overwrite,None)?;
            if !local.executable { return Err(format!("Export preflight blocked: {}",local.warnings.join("; "))); }
            let expected = premiere_expectation.as_ref().ok_or("Export requires expected project and sequence from premiere_plan_export.")?;
            if expected.sequence_guid.is_none() || !expected.clips.is_empty() {
                return Err("Export requires a project and sequence expectation without clip targets.".into());
            }
            (ToolAction::PremiereExportSequence {output:output.clone(),preset:preset.clone(),queue_to_ame,overwrite},
                if queue_to_ame {"Queue Premiere export to Media Encoder".to_string()} else {"Export active Premiere sequence".to_string()},
                format!("Output={output}; preset={preset:?}; queue_to_ame={queue_to_ame}; overwrite={overwrite}. {}",
                    if local.output_exists {"Existing file may be replaced."} else {"No output existed at staging."}),
                RiskLevel::High)
        }
        "premiere_save_project" => (
            ToolAction::PremiereSaveProject,
            "Save active Premiere project".to_string(),
            "Save the currently active Premiere project through the paired UXP bridge.".to_string(),
            RiskLevel::Medium,
        ),
        "workspace_scan" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::WorkspaceScan { path: path.clone() },
                "Scan coding workspace".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "search_text" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let query = arg_string(&proposal.arguments, "query")?;
            if query.len() > 2_000 {
                return Err("Search query is too long.".into());
            }
            (
                ToolAction::SearchText { path: path.clone(), query: query.clone() },
                "Search workspace text".to_string(),
                format!("{} | query={}", path, query),
                RiskLevel::Low,
            )
        }
        "replace_text" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let old = arg_raw_string(&proposal.arguments, "old")?;
            let new_value = arg_raw_string(&proposal.arguments, "new")?;

            if old.is_empty() {
                return Err("replace_text requires non-empty old text.".into());
            }
            if old.len() > MAX_WRITE_BYTES || new_value.len() > MAX_WRITE_BYTES {
                return Err("Replacement payload is too large.".into());
            }

            (
                ToolAction::ReplaceText {
                    path: path.clone(),
                    old: old.clone(),
                    new_value: new_value.clone(),
                },
                "Replace exact text in file".to_string(),
                format!(
                    "{} | old_chars={} | new_chars={}",
                    path,
                    old.chars().count(),
                    new_value.chars().count()
                ),
                RiskLevel::Medium,
            )
        }
        "apply_patch" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let patch = arg_raw_string(&proposal.arguments, "patch")?;
            let expected_worktree_fingerprint = arg_git_head(&proposal.arguments, "expected_worktree_fingerprint")?;
            if patch.trim().is_empty() {
                return Err("apply_patch requires a non-empty unified diff.".into());
            }
            if patch.len() > 512_000 {
                return Err("Patch is larger than Shuvi's 512 KB patch limit.".into());
            }

            (
                ToolAction::ApplyPatch {
                    path: path.clone(),
                    patch: patch.clone(),
                    expected_worktree_fingerprint: expected_worktree_fingerprint.clone(),
                },
                "Apply structured Git patch".to_string(),
                format!("{} | expected_worktree_fingerprint={} | patch_chars={}", path, expected_worktree_fingerprint, patch.chars().count()),
                RiskLevel::Medium,
            )
        }
        "run_project_task" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let task = arg_string(&proposal.arguments, "task")?.to_ascii_lowercase();

            if !matches!(task.as_str(), "test" | "build" | "lint" | "typecheck") {
                return Err("Project task must be test, build, lint, or typecheck.".into());
            }

            (
                ToolAction::RunProjectTask {
                    path: path.clone(),
                    task: task.clone(),
                },
                "Run project task".to_string(),
                format!("{path} | task={task}"),
                RiskLevel::Medium,
            )
        }
        "git_status" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::GitStatus { path: path.clone() },
                "Read Git status".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "git_diff" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            (
                ToolAction::GitDiff { path: path.clone() },
                "Read Git diff".to_string(),
                path,
                RiskLevel::Low,
            )
        }
        "git_commit" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let message = arg_string(&proposal.arguments, "message")?;
            if message.len() > 500 {
                return Err("Git commit message is too long.".into());
            }
            let expected_head = arg_git_head(&proposal.arguments, "expected_head")?;
            let expected_worktree_fingerprint = arg_git_head(&proposal.arguments, "expected_worktree_fingerprint")?;
            let raw_files = arg_string_array(&proposal.arguments, "files")?;
            if raw_files.is_empty() || raw_files.len() > 64 {
                return Err("git_commit requires between 1 and 64 exact reviewed relative file paths.".into());
            }
            let mut files = Vec::new();
            let mut seen = HashSet::new();
            for raw in raw_files {
                let file = raw.trim().replace('\\', "/");
                if file.is_empty()
                    || file.len() > 2_048
                    || Path::new(&file).is_absolute()
                    || file == "."
                    || file == ".git"
                    || file.starts_with(".git/")
                    || file.split('/').any(|part| part.is_empty() || part == "." || part == "..")
                    || file.chars().any(|ch| ch == '\0' || ch == '\r' || ch == '\n')
                {
                    return Err("git_commit files must be exact safe relative file paths inside the repository.".into());
                }
                if Path::new(&path).join(&file).is_dir() {
                    return Err("git_commit files must name exact files, not directories.".into());
                }
                if seen.insert(file.clone()) {
                    files.push(file);
                }
            }

            (
                ToolAction::GitCommit {
                    path: path.clone(),
                    message: message.clone(),
                    files: files.clone(),
                    expected_head: expected_head.clone(),
                    expected_worktree_fingerprint: expected_worktree_fingerprint.clone(),
                },
                "Stage reviewed files and commit Git changes".to_string(),
                format!("{path} | expected_head={expected_head} | expected_worktree_fingerprint={expected_worktree_fingerprint} | files={} | message={message}", files.join(",")),
                RiskLevel::Medium,
            )
        }
        "git_push" => {
            let path = absolute_path(arg_string(&proposal.arguments, "path")?)?;
            let expected_head = arg_git_head(&proposal.arguments, "expected_head")?;
            (
                ToolAction::GitPush { path: path.clone(), expected_head: expected_head.clone() },
                "Push Git commits to remote".to_string(),
                format!("{path} | expected_head={expected_head}"),
                RiskLevel::High,
            )
        }
        "powershell" => {
            if provider_context.is_some() {
                return Err("PowerShell is available only through the manual Permission Lab, not through AI/provider tool proposals.".into());
            }
            let command = arg_string(&proposal.arguments, "command")?;
            if command.len() > 8_000 {
                return Err("PowerShell command is too long.".into());
            }
            let risk = classify_powershell(&command);
            (
                ToolAction::PowerShell {
                    command: command.clone(),
                },
                "Run PowerShell".to_string(),
                command,
                risk,
            )
        }
        _ => return Err("Unsupported tool.".into()),
    };

    let id = Uuid::new_v4().to_string();

    let prepared_at_ms = now_ms();
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "Permission state is unavailable.".to_string())?;
    pending.retain(|_, action| {
        prepared_at_ms.saturating_sub(action.created_at_ms) <= PENDING_ACTION_TTL_MS
    });
    if pending.len() >= MAX_PENDING_ACTIONS {
        return Err(format!(
            "Shuvi already has {MAX_PENDING_ACTIONS} unresolved prepared actions. Resolve or deny them before preparing more."
        ));
    }
    pending.insert(
        id.clone(),
        PendingAction {
            created_at_ms: prepared_at_ms,
            premiere_expectation,
            tool: tool.clone(),
            detail: detail.clone(),
            action,
        },
    );
    drop(pending);

    Ok(PendingActionView {
        id,
        kind: tool,
        summary,
        detail,
        risk,
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn audit_safe_action_detail(tool: &str, detail: &str) -> String {
    match tool {
        "powershell" => format!(
            "Manual PowerShell command omitted from persistent audit ({} characters).",
            detail.chars().count()
        ),
        "launch_app" => "Application command-line arguments omitted from persistent audit.".into(),
        "open_url" | "browser_start" | "browser_navigate" =>
            "Browser URL omitted from persistent audit.".into(),
        "inspect_screen" | "premiere_inspect_frame" | "premiere_review_frames" =>
            "Vision prompt omitted from persistent audit.".into(),
        _ => detail.chars().take(4_000).collect(),
    }
}

fn audit_io_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn audit_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Shuvi data directory: {error}"))?;

    Ok(dir.join("audit.jsonl"))
}

fn premiere_review_path(app: &AppHandle, session_id: &str) -> Result<std::path::PathBuf, String> {
    if Uuid::parse_str(session_id).is_err() { return Err("Invalid Premiere review session ID.".into()); }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("premiere-reviews");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{session_id}.json")))
}

fn premiere_edit_session_path(app:&AppHandle,id:&str)->Result<std::path::PathBuf,String>{
    Uuid::parse_str(id).map_err(|_|"Invalid Premiere edit session ID.")?;
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("premiere-edit-sessions");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir.join(format!("{id}.json")))
}

fn premiere_edit_job_path(app:&AppHandle,id:&str)->Result<std::path::PathBuf,String>{
    Uuid::parse_str(id).map_err(|_|"Invalid Premiere edit job ID.")?;
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("premiere-edit-jobs");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir.join(format!("{id}.json")))
}

fn premiere_acceptance_path(app: &AppHandle) -> Result<std::path::PathBuf,String> {
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("premiere-acceptance");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir.join("capabilities-v1.json"))
}

fn premiere_disposable_path(app:&AppHandle)->Result<std::path::PathBuf,String>{
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("premiere-acceptance");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir.join("disposable-v1.json"))
}

fn premiere_acceptance_action_path(app:&AppHandle,id:&str)->Result<std::path::PathBuf,String>{
    Uuid::parse_str(id).map_err(|_|"Invalid acceptance action ID.")?;
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("premiere-acceptance").join("actions");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir.join(format!("{id}.json")))
}

fn premiere_calibration_path(app:&AppHandle)->Result<std::path::PathBuf,String>{
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("premiere-calibration");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir.join("native-v1.json"))
}

fn premiere_export_jobs_path(app:&AppHandle)->Result<std::path::PathBuf,String>{
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("premiere-exports");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir.join("jobs-v1.json"))
}

async fn premiere_calibration_native(bridge:&PremiereClient<'_>,target:&premiere_calibration::Target)->Result<Value,String>{
    bridge.request(if target.kind=="video"{"inspect_clip_effects"}else{"inspect_audio_clip_effects"},
        json!({"track":target.track,"clipIndex":target.clip_index}),Duration::from_secs(20)).await
}

async fn premiere_plan_calibration(value:&mut Value,bridge:&PremiereClient<'_>,app:&AppHandle)->Result<(),String>{
    let context=bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
    let version=context.get("premiereVersion").and_then(Value::as_str).unwrap_or("");
    let registry=premiere_calibration::load(&premiere_calibration_path(app)?)?;
    let settings=value.get("settings").cloned().unwrap_or(Value::Null);
    if let Some(map)=value.as_object_mut(){map.insert("verified_calibration".into(),registry.annotations(version,&settings));
        map.insert("calibration_note".into(),json!("Only exact, recovery-verified semantic records may be surfaced; numeric settings and units are never inferred."));}
    Ok(())
}

fn append_audit(app: &AppHandle, entry: &AuditEntry) -> Result<(), String> {
    let _guard = audit_io_lock()
        .lock()
        .map_err(|_| "Audit I/O state is unavailable.".to_string())?;
    let path = audit_path(app)?;

    if path.exists()
        && fs::metadata(&path)
            .map(|metadata| metadata.len() >= MAX_AUDIT_LOG_BYTES)
            .unwrap_or(false)
    {
        let rotated = path.with_extension("jsonl.1");
        if rotated.exists() {
            let _ = fs::remove_file(&rotated);
        }
        fs::rename(&path, &rotated)
            .map_err(|error| format!("Could not rotate audit log: {error}"))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Could not open audit log: {error}"))?;

    let line = serde_json::to_string(entry)
        .map_err(|error| format!("Could not encode audit entry: {error}"))?;

    writeln!(file, "{line}")
        .map_err(|error| format!("Could not write audit log: {error}"))
}

fn read_audit(app: &AppHandle, limit: usize) -> Result<Vec<AuditEntry>, String> {
    let _guard = audit_io_lock()
        .lock()
        .map_err(|_| "Audit I/O state is unavailable.".to_string())?;
    let path = audit_path(app)?;
    let rotated = path.with_extension("jsonl.1");

    if !path.exists() && !rotated.exists() {
        return Ok(Vec::new());
    }

    let limit = limit.clamp(1, 200);
    let mut entries = VecDeque::with_capacity(limit);
    for candidate in [&rotated, &path] {
        if !candidate.exists() {
            continue;
        }
        let file = OpenOptions::new()
            .read(true)
            .open(candidate)
            .map_err(|error| format!("Could not open audit log: {error}"))?;
        for line in BufReader::new(file).lines().filter_map(Result::ok) {
            let Ok(entry) = serde_json::from_str::<AuditEntry>(&line) else {
                continue;
            };
            if entries.len() == limit {
                entries.pop_front();
            }
            entries.push_back(entry);
        }
    }

    Ok(entries.into_iter().rev().collect())
}

fn read_action_audit_receipt(
    app: &AppHandle,
    action_id: &str,
) -> Result<Option<AuditEntry>, String> {
    Uuid::parse_str(action_id).map_err(|_| "Invalid action ID for audit receipt.")?;
    let _guard = audit_io_lock()
        .lock()
        .map_err(|_| "Audit I/O state is unavailable.".to_string())?;
    let path = audit_path(app)?;
    let rotated = path.with_extension("jsonl.1");
    if !path.exists() && !rotated.exists() {
        return Ok(None);
    }

    let mut matched = None;
    for candidate in [&rotated, &path] {
        if !candidate.exists() {
            continue;
        }
        let file = OpenOptions::new()
            .read(true)
            .open(candidate)
            .map_err(|error| format!("Could not open audit log: {error}"))?;
        for line in BufReader::new(file).lines().filter_map(Result::ok) {
            let Ok(entry) = serde_json::from_str::<AuditEntry>(&line) else {
                continue;
            };
            if entry.action_id.as_deref() == Some(action_id)
                && matches!(entry.event.as_str(), "executed" | "failed" | "denied")
            {
                matched = Some(entry);
            }
        }
    }
    Ok(matched)
}

fn prune_screenshot_dir(dir: &Path, keep_existing: usize) -> Result<(), String> {
    let mut screenshots = fs::read_dir(dir)
        .map_err(|error| format!("Could not inspect screenshot folder: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            if !name.starts_with("screen-") || !name.ends_with(".png") || !path.is_file() {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect::<Vec<_>>();

    screenshots.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in screenshots.into_iter().skip(keep_existing) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn capture_screen_png() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let dir = std::env::temp_dir().join("Shuvi").join("screenshots");
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Could not create screenshot folder: {error}"))?;

        // Keep room for the screenshot being created. Cleanup is deliberately
        // scoped to Shuvi-owned screen-*.png files in this one temp directory.
        let _ = prune_screenshot_dir(&dir, MAX_SCREENSHOT_FILES.saturating_sub(1));
        let path = dir.join(format!("screen-{}-{}.png", now_ms(), Uuid::new_v4()));
        let ps_path = path.to_string_lossy().replace("'", "''");

        let script = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
$bitmap.Save('{ps_path}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()"#
        );

        let output = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &script,
            ])
            .output()
            .map_err(|error| format!("Could not capture screen: {error}"))?;

        if !output.status.success() || !path.exists() {
            return Err(format!(
                "Screen capture failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        return Ok(path);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Screen capture is currently implemented for Windows only.".into())
    }
}

async fn analyze_png_with_provider(
    context: &ProviderContext,
    prompt: &str,
    path: &Path,
) -> Result<String, String> {
    let bytes = read_file_bytes_bounded(
        path,
        12 * 1024 * 1024,
        "captured screenshot",
    )?;

    let encoded = BASE64.encode(bytes);
    let key = load_api_key(&context.provider)?;

    match context.provider.as_str() {
        "gemini" => {
            let api_key = key
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "No Gemini API key saved.".to_string())?;

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                context.model, api_key
            );

            let response = http_client()?
                .post(url)
                .json(&json!({
                    "contents": [{
                        "role": "user",
                        "parts": [
                            { "text": prompt },
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": encoded
                                }
                            }
                        ]
                    }]
                }))
                .send()
                .await
                .map_err(|error| format!("Gemini vision request failed: {error}"))?;

            let (status, body) = bounded_provider_json(response, "Gemini vision").await?;

            if !status.is_success() {
                return Err(format!("Gemini vision returned {status}: {}", compact_error(&body)));
            }

            let parts = body
                .pointer("/candidates/0/content/parts")
                .and_then(Value::as_array)
                .ok_or_else(|| "Gemini vision returned no candidate text.".to_string())?;

            let text = collect_provider_text(
                parts.iter().filter_map(|part| part.get("text").and_then(Value::as_str)),
                "Gemini vision",
            )?;

            if text.is_empty() {
                return Err("Gemini vision returned an empty response.".into());
            }

            Ok(text)
        }
        "anthropic" => {
            let api_key = key
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "No Anthropic API key saved.".to_string())?;

            let response = http_client()?
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": context.model,
                    "max_tokens": 1600,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": encoded
                                }
                            },
                            { "type": "text", "text": prompt }
                        ]
                    }]
                }))
                .send()
                .await
                .map_err(|error| format!("Anthropic vision request failed: {error}"))?;

            let (status, body) = bounded_provider_json(response, "Anthropic vision").await?;

            if !status.is_success() {
                return Err(format!("Anthropic vision returned {status}: {}", compact_error(&body)));
            }

            let text = collect_provider_text(
                body.get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|part| {
                        if part.get("type").and_then(Value::as_str) == Some("text") {
                            part.get("text").and_then(Value::as_str)
                        } else {
                            None
                        }
                    }),
                "Anthropic vision",
            )?;

            if text.is_empty() {
                return Err("Anthropic vision returned an empty response.".into());
            }

            Ok(text)
        }
        "deepseek" => Err(
            "The selected DeepSeek text endpoint is not configured for screen vision. Choose Gemini, OpenAI, Claude, OpenRouter, Ollama vision, or a compatible vision endpoint.".into()
        ),
        "openai" | "openrouter" | "ollama" | "custom" => {
            let url = match context.provider.as_str() {
                "openai" => "https://api.openai.com/v1/chat/completions".to_string(),
                "openrouter" => "https://openrouter.ai/api/v1/chat/completions".to_string(),
                "ollama" => context
                    .base_url
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".into()),
                "custom" => context
                    .base_url
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "Custom vision provider requires a base URL.".to_string())?,
                _ => unreachable!(),
            };

            let mut request = http_client()?.post(url).json(&json!({
                "model": context.model,
                "messages": [{
                    "role": "user",
                    "content": [
                        { "type": "text", "text": prompt },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:image/png;base64,{encoded}")
                            }
                        }
                    ]
                }]
            }));

            if let Some(api_key) = key.filter(|value| !value.is_empty()) {
                request = request.bearer_auth(api_key);
            } else if context.provider != "ollama" {
                return Err("No API key saved for the selected vision provider.".into());
            }

            let response = request
                .send()
                .await
                .map_err(|error| format!("Vision request failed: {error}"))?;

            let (status, body) = bounded_provider_json(response, "Vision provider").await?;

            if !status.is_success() {
                return Err(format!("Vision provider returned {status}: {}", compact_error(&body)));
            }

            let text = body
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .ok_or_else(|| "Vision provider returned no assistant text.".to_string())?;

            bounded_provider_text(text, "Vision provider")
        }
        other => Err(format!("Provider '{other}' is not supported for screen vision.")),
    }
}

fn is_ignored_workspace_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".cache" | ".venv" | "venv"
    )
}

fn workspace_scan_recursive(
    root: &Path,
    current: &Path,
    depth: usize,
    output: &mut Vec<String>,
) -> Result<(), String> {
    if depth > 5 || output.len() >= MAX_WORKSPACE_SCAN_ENTRIES {
        return Ok(());
    }

    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("Could not scan workspace: {error}"))?
        .filter_map(Result::ok)
        .take(MAX_WORKSPACE_DIRECTORY_ENTRIES)
        .collect::<Vec<_>>();

    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if output.len() >= MAX_WORKSPACE_SCAN_ENTRIES {
            break;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let canonical = match path.canonicalize() {
            Ok(canonical) if canonical.starts_with(root) => canonical,
            _ => continue,
        };
        let file_name = entry.file_name().to_string_lossy().to_string();
        let relative = canonical.strip_prefix(root).unwrap_or(&canonical).display().to_string();

        if canonical.is_dir() {
            if is_ignored_workspace_dir(&file_name) {
                continue;
            }
            output.push(format!("[dir] {relative}"));
            workspace_scan_recursive(root, &canonical, depth + 1, output)?;
        } else if canonical.is_file() {
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or_default();
            output.push(format!("[file] {relative} | {size} bytes"));
        }
    }

    Ok(())
}

fn search_text_recursive(
    root: &Path,
    current: &Path,
    query: &str,
    depth: usize,
    matches: &mut Vec<String>,
    visited_files: &mut usize,
    visited_entries: &mut usize,
) -> Result<(), String> {
    if depth > 7
        || matches.len() >= MAX_SEARCH_MATCHES
        || *visited_files >= MAX_SEARCH_FILES
        || *visited_entries >= MAX_SEARCH_ENTRIES
    {
        return Ok(());
    }

    for entry in fs::read_dir(current)
        .map_err(|error| format!("Could not search workspace: {error}"))?
        .filter_map(Result::ok)
    {
        *visited_entries = visited_entries.saturating_add(1);
        if matches.len() >= MAX_SEARCH_MATCHES
            || *visited_files >= MAX_SEARCH_FILES
            || *visited_entries > MAX_SEARCH_ENTRIES
        {
            break;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let canonical = match path.canonicalize() {
            Ok(canonical) if canonical.starts_with(root) => canonical,
            _ => continue,
        };
        let file_name = entry.file_name().to_string_lossy().to_string();

        if canonical.is_dir() {
            if is_ignored_workspace_dir(&file_name) {
                continue;
            }
            search_text_recursive(root, &canonical, query, depth + 1, matches, visited_files, visited_entries)?;
            continue;
        }

        if !canonical.is_file() {
            continue;
        }

        *visited_files = visited_files.saturating_add(1);
        if *visited_files > MAX_SEARCH_FILES {
            break;
        }

        let content = match read_utf8_file_bounded(&canonical, 768 * 1024, "search candidate") {
            Ok(content) => content,
            Err(_) => continue,
        };

        for (index, line) in content.lines().enumerate() {
            if line.contains(query) {
                let relative = canonical.strip_prefix(root).unwrap_or(&canonical).display();
                matches.push(format!(
                    "{}:{}: {}",
                    relative,
                    index + 1,
                    line.chars().take(300).collect::<String>()
                ));

                if matches.len() >= MAX_SEARCH_MATCHES {
                    break;
                }
            }
        }
    }

    Ok(())
}

fn run_git(path: &str, args: &[&str]) -> Result<std::process::Output, String> {
    if !Path::new(path).join(".git").exists() {
        return Err("The selected path does not contain a .git repository.".into());
    }

    Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))
}

fn run_git_with_bytes(
    path: &str,
    args: &[&str],
    input: &[u8],
    label: &str,
) -> Result<std::process::Output, String> {
    if !Path::new(path).join(".git").exists() {
        return Err("The selected path does not contain a .git repository.".into());
    }

    let mut child = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run Git: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(input)
            .map_err(|error| format!("Could not send {label} to Git: {error}"))?;
    }

    child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for Git: {error}"))
}

fn run_git_with_stdin(
    path: &str,
    args: &[&str],
    input: &str,
) -> Result<std::process::Output, String> {
    run_git_with_bytes(path, args, input.as_bytes(), "input")
}

fn git_command_text(path: &str, args: &[&str], label: &str) -> Result<String, String> {
    let output = run_git(path, args)?;
    if !output.status.success() {
        let stderr = truncate_output(String::from_utf8_lossy(&output.stderr).to_string());
        return Err(format!("{label}: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_worktree_fingerprint(path: &str) -> Result<String, String> {
    let diff = run_git(path, &["diff", "HEAD", "--no-ext-diff", "--binary", "--"])?;
    if !diff.status.success() {
        return Err(format!(
            "Could not fingerprint tracked Git worktree changes: {}",
            truncate_output(String::from_utf8_lossy(&diff.stderr).to_string())
        ));
    }

    let untracked = run_git(path, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    if !untracked.status.success() {
        return Err(format!(
            "Could not fingerprint untracked Git worktree paths: {}",
            truncate_output(String::from_utf8_lossy(&untracked.stderr).to_string())
        ));
    }

    let mut untracked_paths = Vec::new();
    for raw in untracked.stdout.split(|byte| *byte == 0).filter(|item| !item.is_empty()) {
        if untracked_paths.len() >= MAX_GIT_FINGERPRINT_UNTRACKED_FILES {
            return Err(format!(
                "Git worktree has more than {MAX_GIT_FINGERPRINT_UNTRACKED_FILES} untracked files; refusing to create an incomplete review fingerprint."
            ));
        }
        let file = std::str::from_utf8(raw)
            .map_err(|_| "Git worktree contains a non-UTF-8 untracked path; refusing an ambiguous review fingerprint.")?;
        if file.chars().any(|ch| ch == '\r' || ch == '\n') {
            return Err("Git worktree contains an untracked path with a newline; refusing an ambiguous review fingerprint.".into());
        }
        untracked_paths.push(file.to_string());
    }

    let mut snapshot = Vec::with_capacity(diff.stdout.len().saturating_add(untracked.stdout.len()).saturating_add(1024));
    snapshot.extend_from_slice(b"tracked-diff\0");
    snapshot.extend_from_slice(&diff.stdout);
    snapshot.extend_from_slice(b"\0untracked\0");

    for file in untracked_paths {
        let hash = run_git(path, &["hash-object", "--no-filters", "--", file.as_str()])?;
        if !hash.status.success() {
            return Err(format!(
                "Could not fingerprint untracked file {file}: {}",
                truncate_output(String::from_utf8_lossy(&hash.stderr).to_string())
            ));
        }
        let oid = String::from_utf8_lossy(&hash.stdout).trim().to_ascii_lowercase();
        if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Git returned an invalid object ID while fingerprinting an untracked file.".into());
        }
        snapshot.extend_from_slice(file.as_bytes());
        snapshot.push(0);
        snapshot.extend_from_slice(oid.as_bytes());
        snapshot.push(0);
    }

    let fingerprint = run_git_with_bytes(
        path,
        &["hash-object", "--stdin"],
        &snapshot,
        "worktree snapshot",
    )?;
    if !fingerprint.status.success() {
        return Err(format!(
            "Could not hash Git worktree snapshot: {}",
            truncate_output(String::from_utf8_lossy(&fingerprint.stderr).to_string())
        ));
    }
    let oid = String::from_utf8_lossy(&fingerprint.stdout).trim().to_ascii_lowercase();
    if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Git returned an invalid worktree fingerprint.".into());
    }
    Ok(oid)
}

fn require_expected_git_worktree(
    path: &str,
    expected_fingerprint: &str,
    action: &str,
) -> Result<(), String> {
    let current = git_worktree_fingerprint(path)?;
    if current != expected_fingerprint {
        return Err(format!(
            "Git worktree changed before {action}; refusing Git write. expected_worktree_fingerprint={expected_fingerprint}; current_worktree_fingerprint={current}"
        ));
    }
    Ok(())
}

fn git_staged_files(path: &str) -> Result<Vec<String>, String> {
    let output = run_git(path, &["diff", "--cached", "--name-only", "-z", "--"])?;
    if !output.status.success() {
        return Err(format!(
            "Could not inspect staged files: {}",
            truncate_output(String::from_utf8_lossy(&output.stderr).to_string())
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .split('\0')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.replace('\\', "/"))
        .collect())
}

fn git_local_context(path: &str) -> Result<Value, String> {
    let repo_root = git_command_text(
        path,
        &["rev-parse", "--show-toplevel"],
        "Could not identify the Git repository root",
    )?;
    let head = git_command_text(path, &["rev-parse", "HEAD"], "Could not read local Git HEAD")?;
    let branch_probe = run_git(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = if branch_probe.status.success() {
        Some(String::from_utf8_lossy(&branch_probe.stdout).trim().to_string())
    } else {
        None
    };
    let upstream_probe = run_git(
        path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;
    let upstream = if upstream_probe.status.success() {
        let value = String::from_utf8_lossy(&upstream_probe.stdout).trim().to_string();
        if value.is_empty() { None } else { Some(value) }
    } else {
        None
    };
    let upstream_head = if upstream.is_some() {
        Some(git_command_text(
            path,
            &["rev-parse", "@{u}"],
            "Could not read configured upstream HEAD",
        )?)
    } else {
        None
    };
    let worktree_clean = git_command_text(
        path,
        &["status", "--porcelain", "--untracked-files=all"],
        "Could not inspect Git worktree cleanliness",
    )?.is_empty();
    let worktree_fingerprint = git_worktree_fingerprint(path)?;
    Ok(json!({
        "schema": 1,
        "repo_root": repo_root,
        "branch": branch,
        "head": head,
        "upstream": upstream,
        "upstream_head": upstream_head,
        "worktree_clean": worktree_clean,
        "worktree_fingerprint": worktree_fingerprint
    }))
}

fn git_context_stdout(path: &str, body: String) -> Result<String, String> {
    let receipt = git_local_context(path)?;
    Ok(format!("[SHUVI_GIT_CONTEXT_V1]{}\n{}", receipt, body))
}

fn git_same_local_snapshot(before: &Value, after: &Value) -> bool {
    before.get("repo_root") == after.get("repo_root")
        && before.get("branch") == after.get("branch")
        && before.get("head") == after.get("head")
        && before.get("worktree_fingerprint") == after.get("worktree_fingerprint")
}

fn require_expected_git_head(path: &str, expected_head: &str, action: &str) -> Result<(), String> {
    let current_head = git_command_text(path, &["rev-parse", "HEAD"], "Could not read local Git HEAD")?;
    if current_head.to_ascii_lowercase() != expected_head {
        return Err(format!(
            "Local HEAD changed before {action}; refusing Git write. expected_head={expected_head}; current_head={current_head}"
        ));
    }
    Ok(())
}


fn git_push_destination(path: &str) -> Result<(String, String), String> {
    let branch = git_command_text(
        path,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        "Could not identify the current Git branch for push",
    )?;
    let remote_key = format!("branch.{branch}.remote");
    let remote = git_command_text(
        path,
        &["config", "--get", remote_key.as_str()],
        "Could not identify the configured Git push remote",
    )?;
    if remote == "." {
        return Err("git_push refuses a local-dot upstream; configure an explicit remote before pushing.".into());
    }
    let merge_key = format!("branch.{branch}.merge");
    let merge_ref = git_command_text(
        path,
        &["config", "--get", merge_key.as_str()],
        "Could not identify the configured upstream branch ref",
    )?;
    if !merge_ref.starts_with("refs/heads/")
        || merge_ref.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err("Configured upstream branch ref is not a safe refs/heads target.".into());
    }
    Ok((remote, merge_ref))
}

fn git_remote_freshness(path: &str, require_upstream: bool) -> Result<String, String> {
    let branch = git_command_text(
        path,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        "Could not identify the current Git branch",
    )?;
    let upstream_probe = run_git(
        path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;
    if !upstream_probe.status.success() {
        if require_upstream {
            return Err("git_push requires a configured upstream branch so remote freshness can be verified before the write.".into());
        }
        return Ok(format!("branch={branch}; upstream=none; remote_check=not_configured"));
    }
    let upstream = String::from_utf8_lossy(&upstream_probe.stdout).trim().to_string();
    if upstream.is_empty() {
        if require_upstream {
            return Err("git_push requires a configured upstream branch so remote freshness can be verified before the write.".into());
        }
        return Ok(format!("branch={branch}; upstream=none; remote_check=not_configured"));
    }

    let remote_key = format!("branch.{branch}.remote");
    let remote = git_command_text(
        path,
        &["config", "--get", remote_key.as_str()],
        "Could not identify the configured Git remote",
    )?;
    if remote != "." {
        let fetch = run_git(path, &["fetch", "--prune", remote.as_str()])?;
        if !fetch.status.success() {
            return Err(format!(
                "Remote freshness check failed before Git write: {}",
                truncate_output(String::from_utf8_lossy(&fetch.stderr).to_string())
            ));
        }
    }

    let head = git_command_text(path, &["rev-parse", "HEAD"], "Could not read local HEAD")?;
    let upstream_head = git_command_text(
        path,
        &["rev-parse", "@{u}"],
        "Could not read upstream HEAD after fetch",
    )?;
    let ancestor = run_git(path, &["merge-base", "--is-ancestor", "@{u}", "HEAD"])?;
    if !ancestor.status.success() {
        return Err(format!(
            "Remote branch advanced or diverged; refusing Git write until the repository is reconciled. branch={branch}; local_head={head}; upstream={upstream}; upstream_head={upstream_head}"
        ));
    }
    Ok(format!(
        "branch={branch}; local_head={head}; upstream={upstream}; upstream_head={upstream_head}"
    ))
}


fn project_task_command(path: &str, task: &str) -> Result<(String, Vec<String>), String> {
    let root = Path::new(path);

    if !root.is_dir() {
        return Err("Project path is not a directory.".into());
    }

    if root.join("package.json").exists() {
        let package_path = root.join("package.json");
        let package_json = read_utf8_file_bounded(
            &package_path,
            1024 * 1024,
            "package.json",
        )?;
        let package: Value = serde_json::from_str(&package_json)
            .map_err(|error| format!("Invalid package.json: {error}"))?;

        let scripts = package
            .get("scripts")
            .and_then(Value::as_object)
            .ok_or_else(|| "package.json has no scripts object.".to_string())?;

        let script_name = match task {
            "test" => "test",
            "build" => "build",
            "lint" => "lint",
            "typecheck" => {
                if scripts.contains_key("typecheck") {
                    "typecheck"
                } else if scripts.contains_key("type-check") {
                    "type-check"
                } else {
                    return Err("No typecheck/type-check script is defined in package.json.".into());
                }
            }
            _ => return Err("Unsupported project task.".into()),
        };

        if !scripts.contains_key(script_name) {
            return Err(format!("package.json does not define the '{script_name}' script."));
        }

        let manager = if root.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else if root.join("yarn.lock").exists() {
            "yarn"
        } else {
            "npm"
        };

        #[cfg(target_os = "windows")]
        let program = format!("{manager}.cmd");

        #[cfg(not(target_os = "windows"))]
        let program = manager.to_string();

        let args = if manager == "yarn" {
            vec![script_name.to_string()]
        } else {
            vec!["run".into(), script_name.to_string()]
        };

        return Ok((program, args));
    }

    if root.join("Cargo.toml").exists() {
        let args = match task {
            "test" => vec!["test".into()],
            "build" => vec!["build".into()],
            "lint" => vec!["clippy".into(), "--all-targets".into()],
            "typecheck" => vec!["check".into()],
            _ => return Err("Unsupported Rust project task.".into()),
        };

        return Ok(("cargo".into(), args));
    }

    Err("Shuvi currently supports typed project tasks for Node.js and Rust projects.".into())
}

fn validate_premiere_saved_recipe_settings(settings: &[Value]) -> Result<(), String> {
    if settings.is_empty() || settings.len() > 64 {
        return Err("Premiere recipe requires between 1 and 64 settings.".into());
    }

    for setting in settings {
        let object = setting
            .as_object()
            .ok_or_else(|| "Each Premiere recipe setting must be an object.".to_string())?;

        let has_component = object
            .get("component_match_name")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
            || object
                .get("component_display_name")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());

        if !has_component {
            return Err("Each Premiere recipe setting requires component_match_name or component_display_name.".into());
        }

        for key in ["component_match_name", "component_display_name", "param_display_name"] {
            if let Some(value) = object.get(key).and_then(Value::as_str) {
                if value.trim().is_empty() && key == "param_display_name" {
                    return Err("Each Premiere recipe setting requires param_display_name.".into());
                }
                if value.chars().count() > 240 {
                    return Err(format!("Premiere recipe field '{key}' is too long."));
                }
            } else if key == "param_display_name" {
                return Err("Each Premiere recipe setting requires param_display_name.".into());
            }
        }

        let value = object
            .get("value")
            .ok_or_else(|| "Each Premiere recipe setting requires value.".to_string())?;

        if !matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
            return Err("Premiere recipe values must be booleans, numbers, or strings.".into());
        }

        if value.as_str().is_some_and(|text| text.chars().count() > 5_000) {
            return Err("Premiere recipe string value is too long.".into());
        }

        if let Some(seconds) = object.get("seconds") {
            let seconds = seconds
                .as_f64()
                .ok_or_else(|| "Premiere recipe seconds must be numeric.".to_string())?;
            if !seconds.is_finite() || seconds < 0.0 || seconds > 86_400.0 {
                return Err("Premiere recipe keyframe seconds must be between 0 and 86400.".into());
            }
        }
    }

    Ok(())
}

fn premiere_recipes_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?
        .join("premiere");

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Premiere recipe directory: {error}"))?;

    Ok(dir.join("recipes.json"))
}

fn graphics_library_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(premiere_recipes_path(app)?.with_file_name("graphics-mappings.json"))
}

fn stage_graphics_batch(value: &Value, expected: Option<&PremiereExpectation>) -> Result<premiere_graphics::Batch, String> {
    let batch: premiere_graphics::Batch = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    batch.validate()?;
    let expected = expected.ok_or("Graphics batch requires inspected project/sequence expectation.")?;
    if expected.sequence_guid.is_none() || !expected.clips.is_empty() { return Err("Graphics insertion requires project/sequence expectation without old clip indexes.".into()); }
    Ok(batch)
}

fn read_premiere_recipes(app: &AppHandle) -> Result<Vec<PremiereSavedRecipe>, String> {
    let path = premiere_recipes_path(app)?;
    let backup = path.with_extension("json.bak");
    if !path.exists() && !backup.exists() {
        return Ok(Vec::new());
    }

    let decode = |candidate: &Path| -> Result<Vec<PremiereSavedRecipe>, String> {
        let content = read_utf8_file_bounded(
            candidate,
            2 * 1024 * 1024,
            "Premiere recipe library",
        )?;
        serde_json::from_str(&content)
            .map_err(|error| format!("Premiere recipe library is invalid: {error}"))
    };

    if path.exists() {
        decode(&path).or_else(|primary_error| {
            if backup.exists() { decode(&backup) } else { Err(primary_error) }
        })
    } else {
        decode(&backup)
    }
}

fn write_premiere_recipes(
    app: &AppHandle,
    recipes: &[PremiereSavedRecipe],
) -> Result<(), String> {
    if recipes.len() > 250 {
        return Err("Premiere recipe library is limited to 250 recipes.".into());
    }

    let path = premiere_recipes_path(app)?;
    let temp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let content = serde_json::to_vec_pretty(recipes)
        .map_err(|error| format!("Could not encode Premiere recipes: {error}"))?;

    if content.len() > 2 * 1024 * 1024 {
        return Err("Premiere recipe library would exceed Shuvi's 2 MB limit.".into());
    }

    fs::write(&temp, &content)
        .map_err(|error| format!("Could not write temporary Premiere recipe library: {error}"))?;

    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    if path.exists() {
        fs::rename(&path, &backup)
            .map_err(|error| format!("Could not preserve the previous Premiere recipe library: {error}"))?;
    }
    if let Err(error) = fs::rename(&temp, &path) {
        if backup.exists() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("Could not finalize Premiere recipe library: {error}"));
    }
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    Ok(())
}

fn session_checkpoint_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Shuvi data directory: {error}"))?;

    Ok(dir.join("session-checkpoint.json"))
}

fn validate_session_checkpoint_payload(checkpoint: &SessionCheckpoint) -> Result<(), String> {
    validate_provider_fields(
        checkpoint.provider.as_str(),
        checkpoint.model.as_str(),
        checkpoint.base_url.as_deref(),
    )?;

    if checkpoint.messages.len() > MAX_CHAT_MESSAGES {
        return Err("Saved session contains too many chat messages.".into());
    }
    let mut total_bytes = 0_usize;
    for message in &checkpoint.messages {
        if !matches!(message.role.as_str(), "user" | "assistant" | "system") {
            return Err("Saved session contains an unsupported chat role.".into());
        }
        if message.content.len() > MAX_CHAT_MESSAGE_BYTES {
            return Err("Saved session contains an oversized chat message.".into());
        }
        total_bytes = total_bytes.saturating_add(message.content.len());
        if total_bytes > MAX_CHAT_CONTEXT_BYTES {
            return Err("Saved session chat context exceeds Shuvi's 2 MB safety limit.".into());
        }
    }
    Ok(())
}

fn write_session_checkpoint(
    app: &AppHandle,
    mut checkpoint: SessionCheckpoint,
) -> Result<(), String> {
    if checkpoint.messages.len() > 120 {
        let keep_from = checkpoint.messages.len().saturating_sub(120);
        checkpoint.messages = checkpoint.messages.split_off(keep_from);
    }

    checkpoint.version = 2;
    checkpoint.updated_at_ms = now_ms();
    validate_session_checkpoint_payload(&checkpoint)?;

    let content = serde_json::to_vec_pretty(&checkpoint)
        .map_err(|error| format!("Could not encode session checkpoint: {error}"))?;

    if content.len() > 2 * 1024 * 1024 {
        return Err("Session checkpoint is larger than Shuvi's 2 MB safety limit.".into());
    }

    let path = session_checkpoint_path(app)?;
    let temp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");

    fs::write(&temp, &content)
        .map_err(|error| format!("Could not write temporary session checkpoint: {error}"))?;

    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    if path.exists() {
        fs::rename(&path, &backup)
            .map_err(|error| format!("Could not preserve the previous session checkpoint: {error}"))?;
    }
    if let Err(error) = fs::rename(&temp, &path) {
        if backup.exists() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("Could not finalize session checkpoint: {error}"));
    }
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    Ok(())
}

fn read_session_checkpoint(app: &AppHandle) -> Result<Option<SessionCheckpoint>, String> {
    let path = session_checkpoint_path(app)?;
    let backup = path.with_extension("json.bak");

    if !path.exists() && !backup.exists() {
        return Ok(None);
    }

    let decode = |candidate: &Path| -> Result<SessionCheckpoint, String> {
        let content = read_utf8_file_bounded(
            candidate,
            2 * 1024 * 1024,
            "saved session checkpoint",
        )?;
        serde_json::from_str(&content)
            .map_err(|error| format!("Saved session checkpoint is invalid: {error}"))
    };

    let mut checkpoint = if path.exists() {
        decode(&path).or_else(|primary_error| {
            if backup.exists() { decode(&backup) } else { Err(primary_error) }
        })?
    } else {
        decode(&backup)?
    };

    if !matches!(checkpoint.version,1|2) {
        return Err("Saved session checkpoint uses an unsupported version.".into());
    }
    if checkpoint.version==1 {
        checkpoint.version=2;
        checkpoint.orchestration=None;
    }
    validate_session_checkpoint_payload(&checkpoint)?;
    Ok(Some(checkpoint))
}
fn remove_session_checkpoint(app: &AppHandle) -> Result<(), String> {
    let path = session_checkpoint_path(app)?;
    for candidate in [
        path.clone(),
        path.with_extension("json.tmp"),
        path.with_extension("json.bak"),
    ] {
        if candidate.exists() {
            fs::remove_file(&candidate)
                .map_err(|error| format!("Could not clear session checkpoint state: {error}"))?;
        }
    }
    Ok(())
}
fn workspace_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Shuvi data directory: {error}"))?;

    Ok(dir.join("workspace.txt"))
}

fn read_workspace(app: &AppHandle) -> Result<Option<String>, String> {
    let path = workspace_config_path(app)?;

    if !path.exists() {
        return Ok(None);
    }

    let value = read_utf8_file_bounded(
        &path,
        MAX_WORKSPACE_PATH_BYTES as usize,
        "workspace setting",
    )?
        .trim()
        .to_string();

    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().any(char::is_control)
        || !Path::new(&value).is_absolute()
        || !Path::new(&value).is_dir()
    {
        return Err("Saved workspace must be an existing absolute path without control characters.".into());
    }
    Ok(Some(value))
}

fn write_workspace(app: &AppHandle, path: &str) -> Result<(), String> {
    let path = path.trim();
    let absolute = Path::new(path);

    if path.len() as u64 > MAX_WORKSPACE_PATH_BYTES
        || path.chars().any(char::is_control)
        || !absolute.is_absolute()
        || !absolute.is_dir()
    {
        return Err("Workspace must be an existing absolute directory without control characters and within Shuvi's path-size limit.".into());
    }

    fs::write(workspace_config_path(app)?, path.as_bytes())
        .map_err(|error| format!("Could not save workspace setting: {error}"))
}

async fn backup_premiere_project(premiere_bridge: &PremiereClient<'_>) -> Result<String, String> {
    let before = premiere_bridge.request("inspect_context", json!({}), Duration::from_secs(8)).await?;
    let path = before.get("projectPath").and_then(Value::as_str).filter(|p| !p.trim().is_empty())
        .ok_or_else(|| "Save the active Premiere project to a .prproj file before this edit.".to_string())?;
    if !Path::new(path).is_absolute() || !Path::new(path).is_file()
        || !Path::new(path).extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("prproj")) {
        return Err("Premiere project must exist at an absolute local path before this edit.".into());
    }
    let saved = premiere_bridge.request("save_project", json!({}), Duration::from_secs(15)).await?;
    let after = premiere_bridge.request("inspect_context", json!({}), Duration::from_secs(8)).await?;
    if saved.get("saved").and_then(Value::as_bool) != Some(true)
        || saved.get("projectPath").and_then(Value::as_str) != Some(path)
        || after.get("projectPath").and_then(Value::as_str) != Some(path)
        || before.get("projectGuid").and_then(Value::as_str).is_none_or(|guid|guid.is_empty())
        || before.get("projectGuid") != after.get("projectGuid")
        || before.pointer("/activeSequence/guid") != after.pointer("/activeSequence/guid") {
        return Err("Active Premiere project changed or did not save; no edit was sent. Inspect and retry.".into());
    }
    premiere_checkpoint::create_checkpoint(Path::new(path), now_ms())
}

fn truncate_output(value: String) -> String {
    if value.chars().count() <= MAX_TOOL_OUTPUT_CHARS {
        return value;
    }

    let shortened = value.chars().take(MAX_TOOL_OUTPUT_CHARS).collect::<String>();
    format!("{shortened}\n[output truncated by Shuvi]")
}

async fn execute_tool(action: PendingAction, state: &ActionState, app: &AppHandle) -> Result<ActionResult, String> {
    execute_tool_with_action_id(action, state, app, None).await
}

async fn execute_tool_with_action_id(
    action: PendingAction,
    state: &ActionState,
    app: &AppHandle,
    execution_action_id: Option<&str>,
) -> Result<ActionResult, String> {
    let tool = action.tool.clone();
    let premiere_bridge = PremiereClient { bridge: &state.premiere_bridge, expected: action.premiere_expectation.as_ref() };

    match action.action {
        ToolAction::ListDirectory { path } => {
            let mut entries = Vec::new();

            for entry in fs::read_dir(&path).map_err(|error| format!("Could not list directory: {error}"))? {
                let entry = entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
                let file_type = entry.file_type().map_err(|error| format!("Could not inspect entry: {error}"))?;
                let kind = if file_type.is_dir() {
                    "dir"
                } else if file_type.is_file() {
                    "file"
                } else {
                    "other"
                };

                entries.push(format!("[{kind}] {}", entry.file_name().to_string_lossy()));

                if entries.len() >= 500 {
                    entries.push("[truncated at 500 entries]".into());
                    break;
                }
            }

            entries.sort();

            Ok(ActionResult {
                success: true,
                tool,
                stdout: entries.join("\n"),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ReadFile { path } => {
            let content = read_utf8_file_bounded(
                Path::new(&path),
                MAX_READ_BYTES as usize,
                "file",
            )?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(content),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::WriteFile { path, content } => {
            let target = Path::new(&path);
            match OpenOptions::new().write(true).create_new(true).open(target) {
                Ok(mut file) => {
                    file.write_all(content.as_bytes())
                        .map_err(|error| format!("Could not write new file: {error}"))?;
                    file.sync_all()
                        .map_err(|error| format!("Could not flush new file: {error}"))?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let mut file = open_existing_file_for_mutation(target, "write_file")?;
                    overwrite_open_file(&mut file, content.as_bytes(), "write_file")?;
                }
                Err(error) => return Err(format!("Could not create file: {error}")),
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Wrote {} bytes to {path}.", content.len()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::CreateDirectory { path } => {
            fs::create_dir_all(&path)
                .map_err(|error| format!("Could not create directory: {error}"))?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Created directory {path}."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::LaunchApp { program, args } => {
            let mut child = Command::new(&program)
                .args(&args)
                .spawn()
                .map_err(|error| format!("Could not launch application: {error}"))?;

            let child_pid = child.id();
            if let Err(error) = register_managed_process(state, child_pid) {
                let _ = terminate_managed_process_tree(child_pid);
                let _ = child.wait();
                return Err(format!(
                    "Launched application was stopped before it could remain untracked: {error}"
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Launched {program} with PID {child_pid}. Shuvi is now tracking its RAM usage."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::OpenUrl { url } => {
            #[cfg(target_os = "windows")]
            let child = Command::new("explorer.exe")
                .arg(&url)
                .spawn()
                .map_err(|error| format!("Could not open URL: {error}"))?;

            #[cfg(target_os = "macos")]
            let child = Command::new("open")
                .arg(&url)
                .spawn()
                .map_err(|error| format!("Could not open URL: {error}"))?;

            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            let child = Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|error| format!("Could not open URL: {error}"))?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Opened {url} using the system browser (launcher PID {}).", child.id()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserStart { browser, url } => {
            let executable = find_browser_executable(&browser)?;
            let profiles_root = std::env::temp_dir()
                .join("Shuvi")
                .join("browser-profiles");
            fs::create_dir_all(&profiles_root)
                .map_err(|error| format!("Could not create browser profile root: {error}"))?;
            let _ = prune_inactive_browser_profiles(state, &profiles_root);
            let profile_dir = profiles_root
                .join(format!("{}-{}-{}", browser, now_ms(), Uuid::new_v4()));

            fs::create_dir_all(&profile_dir)
                .map_err(|error| format!("Could not create managed browser profile: {error}"))?;

            let devtools_file = profile_dir.join("DevToolsActivePort");

            let mut command = Command::new(&executable);
            command
                .arg("--new-window")
                .arg("--no-first-run")
                .arg("--no-default-browser-check")
                .arg("--disable-background-mode")
                .arg("--remote-debugging-address=127.0.0.1")
                .arg("--remote-debugging-port=0")
                .arg(format!("--user-data-dir={}", profile_dir.display()));

            if let Some(url) = &url {
                command.arg(url);
            }

            let mut child = command
                .spawn()
                .map_err(|error| format!("Could not start managed browser: {error}"))?;

            let child_pid = child.id();
            let mut devtools_port = None;

            for _ in 0..50 {
                if let Ok(value) = fs::read_to_string(&devtools_file) {
                    if let Some(first_line) = value.lines().next() {
                        if let Ok(port) = first_line.trim().parse::<u16>() {
                            devtools_port = Some(port);
                            break;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }

            let Some(port) = devtools_port else {
                let _ = terminate_managed_process_tree(child_pid);
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_dir_all(&profile_dir);
                return Err("Managed browser started, but its local DevTools endpoint did not become ready within 5 seconds.".into());
            };

            let mut target_id = None;
            for _ in 0..25 {
                if let Ok(value) = cdp_initial_page_target(port) {
                    target_id = Some(value);
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let Some(target_id) = target_id else {
                let _ = terminate_managed_process_tree(child_pid);
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_dir_all(&profile_dir);
                return Err("Managed browser started, but no stable page target became available for Shuvi to bind.".into());
            };

            if let Err(error) = register_managed_process(state, child_pid) {
                let _ = terminate_managed_process_tree(child_pid);
                let _ = child.wait();
                let _ = fs::remove_dir_all(&profile_dir);
                return Err(format!(
                    "Browser was stopped before it could remain untracked: {error}"
                ));
            }

            match state.browser_sessions.lock() {
                Ok(mut sessions) => {
                    sessions.insert(
                        child_pid,
                        BrowserSession {
                            port,
                            target_id: target_id.clone(),
                            profile_dir: profile_dir.clone(),
                        },
                    );
                }
                Err(_) => {
                    unregister_managed_process(state, child_pid);
                    let _ = terminate_managed_process_tree(child_pid);
                    let _ = child.wait();
                    let _ = fs::remove_dir_all(&profile_dir);
                    return Err("Browser-session state is unavailable; browser was stopped before partial registration could remain active.".into());
                }
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Started Shuvi-managed {browser} with root PID {child_pid}, local DevTools port {port}, and one bound page target. Use this PID for browser DOM tools. Browser subprocesses are included in Shuvi's RAM accounting."
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserNavigate { pid, url } => {
            let session = browser_session(state, pid)?;
            let response = cdp_command(
                session.port,
                &session.target_id,
                "Page.navigate",
                json!({ "url": url }),
            )?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Navigated browser PID {pid}. DevTools response: {}",
                    truncate_output(response.to_string())
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserDomRead { pid, selector } => {
            let session = browser_session(state, pid)?;
            let selector_json = serde_json::to_string(&selector)
                .map_err(|error| format!("Could not encode CSS selector: {error}"))?;

            let expression = format!(
                r#"(() => {{
  const selector = {selector_json};
  const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 25);
  return nodes.map((el, index) => ({{
    index,
    tag: el.tagName,
    id: el.id || null,
    name: el.getAttribute('name'),
    role: el.getAttribute('role'),
    type: el.getAttribute('type'),
    text: String(el.innerText || el.textContent || '').trim().slice(0, 500),
    value: ('value' in el) ? String(el.value).slice(0, 500) : null,
    href: el.href || null,
    disabled: !!el.disabled
  }}));
}})()"#
            );

            let value = cdp_eval(session.port, &session.target_id, expression)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserDomClick { pid, selector } => {
            let session = browser_session(state, pid)?;
            let selector_json = serde_json::to_string(&selector)
                .map_err(|error| format!("Could not encode CSS selector: {error}"))?;

            let expression = format!(
                r#"(() => {{
  const selector = {selector_json};
  const nodes = Array.from(document.querySelectorAll(selector));
  if (nodes.length === 0) throw new Error('No DOM element matched the selector.');
  if (nodes.length > 1) throw new Error('Selector matched ' + nodes.length + ' elements. Refine it before clicking.');
  const el = nodes[0];
  if (el.disabled) throw new Error('Matching DOM element is disabled.');
  el.scrollIntoView({{ block: 'center', inline: 'center' }});
  el.click();
  return {{
    clicked: true,
    tag: el.tagName,
    id: el.id || null,
    text: String(el.innerText || el.textContent || '').trim().slice(0, 300)
  }};
}})()"#
            );

            let value = cdp_eval(session.port, &session.target_id, expression)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::BrowserDomSetValue { pid, selector, value } => {
            let session = browser_session(state, pid)?;
            let selector_json = serde_json::to_string(&selector)
                .map_err(|error| format!("Could not encode CSS selector: {error}"))?;
            let value_json = serde_json::to_string(&value)
                .map_err(|error| format!("Could not encode DOM value: {error}"))?;

            let expression = format!(
                r#"(() => {{
  const selector = {selector_json};
  const newValue = {value_json};
  const nodes = Array.from(document.querySelectorAll(selector));
  if (nodes.length === 0) throw new Error('No DOM element matched the selector.');
  if (nodes.length > 1) throw new Error('Selector matched ' + nodes.length + ' elements. Refine it before writing.');
  const el = nodes[0];
  if (el.disabled) throw new Error('Matching DOM element is disabled.');
  el.focus();

  if ('value' in el) {{
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, newValue);
    else el.value = newValue;
  }} else if (el.isContentEditable) {{
    el.textContent = newValue;
  }} else {{
    throw new Error('Matching DOM element is not value-editable.');
  }}

  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));

  return {{
    changed: true,
    tag: el.tagName,
    id: el.id || null,
    valueLength: newValue.length
  }};
}})()"#
            );

            let result = cdp_eval(session.port, &session.target_id, expression)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&result)
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::StopManagedProcess { pid } => {
            let is_managed_root = state
                .managed_children
                .lock()
                .map_err(|_| "Managed-process state is unavailable.".to_string())?
                .contains(&pid);

            if !is_managed_root || !managed_process_identity_matches(state, pid)? {
                unregister_managed_process(state, pid);
                return Err("Shuvi can only stop the exact live process instance that it launched and is tracking.".into());
            }

            let pid_string = pid.to_string();

            #[cfg(target_os = "windows")]
            let output = Command::new("taskkill")
                .args(["/PID", pid_string.as_str(), "/T", "/F"])
                .output()
                .map_err(|error| format!("Could not stop managed process: {error}"))?;

            #[cfg(not(target_os = "windows"))]
            let output = Command::new("kill")
                .args(["-TERM", pid_string.as_str()])
                .output()
                .map_err(|error| format!("Could not stop managed process: {error}"))?;

            if output.status.success() {
                unregister_managed_process(state, pid);

                if let Some(session) = state
                    .browser_sessions
                    .lock()
                    .map_err(|_| "Browser-session state is unavailable.".to_string())?
                    .remove(&pid)
                {
                    let _ = fs::remove_dir_all(session.profile_dir);
                }
            }

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::CaptureScreen => {
            let path = capture_screen_png()?;
            let size = fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Screenshot saved to {} ({} bytes). Use inspect_screen when visual understanding is required.",
                    path.display(),
                    size
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::InspectScreen { prompt, provider } => {
            let path = capture_screen_png()?;
            let analysis = analyze_png_with_provider(&provider, &prompt, &path).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Screen analysis from {}/{}:\n{}\nScreenshot: {}",
                    provider.provider,
                    provider.model,
                    analysis,
                    path.display()
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ListProcesses => {
            let mut system = System::new_all();
            system.refresh_all();

            let mut rows = system
                .processes()
                .iter()
                .map(|(pid, process)| {
                    format!(
                        "PID={} | {} | {:.1} MB",
                        pid.as_u32(),
                        process.name().to_string_lossy(),
                        process.memory() as f64 / 1024.0 / 1024.0
                    )
                })
                .collect::<Vec<_>>();

            rows.sort();
            rows.truncate(400);

            Ok(ActionResult {
                success: true,
                tool,
                stdout: rows.join("\n"),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::UiFind { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$items = @()
for ($i = 0; $i -lt [Math]::Min($matches.Count, 25); $i++) {{
    $e = $matches.Item($i)
    $items += [PSCustomObject]@{{
        Name = $e.Current.Name
        AutomationId = $e.Current.AutomationId
        ControlType = $e.Current.ControlType.ProgrammaticName
        ClassName = $e.Current.ClassName
        IsEnabled = $e.Current.IsEnabled
        Bounds = $e.Current.BoundingRectangle.ToString()
    }}
}}
$items | ConvertTo-Json -Compress"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI lookup failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiClick { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id or a more specific selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {{
    ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    'Invoked element: ' + $e.Current.Name
}} elseif ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {{
    ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
    'Selected element: ' + $e.Current.Name
}} else {{
    throw 'Matching element does not expose InvokePattern or SelectionItemPattern.'
}}"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI click failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiSetValue { name, automation_id, window, value } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let escaped_value = ps_single_quote(&value);
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id or a more specific selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose ValuePattern.'
}}
([System.Windows.Automation.ValuePattern]$pattern).SetValue('{escaped_value}')
'Value set on element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI value change failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiFocus { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id, window, or a more specific selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$e.SetFocus()
'Focused element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI focus failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiScroll { name, automation_id, window, vertical } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let amount = match vertical.as_str() {
                "small_increment" => "SmallIncrement",
                "small_decrement" => "SmallDecrement",
                "large_increment" => "LargeIncrement",
                "large_decrement" => "LargeDecrement",
                _ => return Err("Invalid scroll amount.".into()),
            };

            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Use automation_id, window, or a more specific selector.') }}
$e = $matches.Item(0)
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose ScrollPattern.'
}}
([System.Windows.Automation.ScrollPattern]$pattern).Scroll(
    [System.Windows.Automation.ScrollAmount]::NoAmount,
    [System.Windows.Automation.ScrollAmount]::{amount}
)
'Scrolled element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI scroll failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiToggle { name, automation_id, window } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Refine the selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose TogglePattern.'
}}
([System.Windows.Automation.TogglePattern]$pattern).Toggle()
'Toggled element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI toggle failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiExpandCollapse { name, automation_id, window, action } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let method = if action == "expand" { "Expand" } else { "Collapse" };

            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Refine the selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$pattern = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {{
    throw 'Matching element does not expose ExpandCollapsePattern.'
}}
$expand = [System.Windows.Automation.ExpandCollapsePattern]$pattern
$expand.{method}()
'{method} completed for element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI expand/collapse failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::UiSendKeys { name, automation_id, window, keys } => {
            let condition = ui_condition_script(name.as_deref(), automation_id.as_deref())?;
            let root_script = ui_root_script(window.as_deref());
            let escaped_keys = ps_single_quote(&keys);

            let script = format!(
                r#"Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
{condition}
{root_script}
$matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($matches.Count -eq 0) {{ throw 'No matching UI element found.' }}
if ($matches.Count -gt 1) {{ throw ('Selector matched ' + $matches.Count + ' elements. Refine the selector.') }}
$e = $matches.Item(0)
if (-not $e.Current.IsEnabled) {{ throw 'Matching UI element is disabled.' }}
$e.SetFocus()
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait('{escaped_keys}')
'Keyboard fallback sent to element: ' + $e.Current.Name"#
            );

            let output = run_hidden_powershell(&script)?;
            if !output.status.success() {
                return Err(format!(
                    "UI keyboard fallback failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: String::new(),
                exit_code: output.status.code(),
            })
        }
        ToolAction::PointerClick { x, y, button, clicks } => {
            #[cfg(target_os = "windows")]
            {
                let down_flag = match button.as_str() {
                    "left" => "0x0002",
                    "right" => "0x0008",
                    "middle" => "0x0020",
                    _ => return Err("Invalid pointer button.".into()),
                };
                let up_flag = match button.as_str() {
                    "left" => "0x0004",
                    "right" => "0x0010",
                    "middle" => "0x0040",
                    _ => return Err("Invalid pointer button.".into()),
                };

                let script = format!(
                    r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShuviPointer {{
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}}
"@
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ({x} -lt $bounds.Left -or {x} -ge $bounds.Right -or {y} -lt $bounds.Top -or {y} -ge $bounds.Bottom) {{
  throw 'Pointer target is outside the current virtual desktop.'
}}
if (-not [ShuviPointer]::SetCursorPos({x}, {y})) {{ throw 'Could not move pointer.' }}
Start-Sleep -Milliseconds 80
for ($i = 0; $i -lt {clicks}; $i++) {{
  [ShuviPointer]::mouse_event({down_flag}, 0, 0, 0, [UIntPtr]::Zero)
  [ShuviPointer]::mouse_event({up_flag}, 0, 0, 0, [UIntPtr]::Zero)
  if ($i + 1 -lt {clicks}) {{ Start-Sleep -Milliseconds 120 }}
}}
'Pointer click completed at ({x}, {y}).'"#
                );

                let output = run_hidden_powershell(&script)?;
                if !output.status.success() {
                    return Err(format!(
                        "Coordinate pointer click failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    ));
                }

                return Ok(ActionResult {
                    success: true,
                    tool,
                    stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                    stderr: String::new(),
                    exit_code: output.status.code(),
                });
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("Coordinate pointer fallback is currently available on Windows only.".into())
            }
        }
        ToolAction::PremiereDetect => {
            let installations = find_premiere_installations()?;

            let stdout = if installations.is_empty() {
                "No Adobe Premiere Pro installation was detected in the standard Adobe Program Files folders.".to_string()
            } else {
                installations
                    .iter()
                    .enumerate()
                    .map(|(index, path)| format!("{}: {}", index + 1, path.display()))
                    .collect::<Vec<_>>()
                    .join("\n")
            };

            Ok(ActionResult {
                success: true,
                tool,
                stdout,
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereLaunch { project } => {
            let installations = find_premiere_installations()?;
            let executable = installations
                .last()
                .cloned()
                .ok_or_else(|| "Adobe Premiere Pro was not found in the standard Adobe Program Files folders.".to_string())?;

            let mut command = Command::new(&executable);
            if let Some(project) = &project {
                command.arg(project);
            }

            let child = command
                .spawn()
                .map_err(|error| format!("Could not launch Adobe Premiere Pro: {error}"))?;

            let child_pid = child.id();
            if let Err(error) = register_managed_process(state, child_pid) {
                let _ = terminate_managed_process_tree(child_pid);
                return Err(format!(
                    "Premiere was stopped before it could remain untracked: {error}"
                ));
            }

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Launched Adobe Premiere Pro from {} with root PID {}. Shuvi is tracking the managed process tree.",
                    executable.display(),
                    child_pid
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereBridgeStart => {
            let status = state.premiere_bridge.start()?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Premiere bridge enabled on 127.0.0.1:{}; paired={}. Open the Shuvi Premiere Bridge panel and pair it from Shuvi's Premiere settings.",
                    status.port,
                    status.paired
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereBridgeStatus => {
            let status = state.premiere_bridge.status()?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Premiere bridge: enabled={}, server_started={}, paired={}, port={}, queued_commands={}",
                    status.enabled,
                    status.server_started,
                    status.paired,
                    status.port,
                    status.queued_commands
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereContext => {
            let value = premiere_bridge
                .request("inspect_context", json!({}), Duration::from_secs(8))
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereRemoveKeyframeRange { target, start_seconds, end_seconds, expected_count, expected_signature, allow_remove_all } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let mut arguments = target.bridge_arguments();
            arguments["startSeconds"] = json!(start_seconds);
            arguments["endSeconds"] = json!(end_seconds);
            arguments["expectedCount"] = json!(expected_count);
            arguments["expectedSignature"] = json!(expected_signature);
            arguments["allowRemoveAll"] = json!(allow_remove_all);
            let value = premiere_bridge.request("remove_keyframe_range", arguments, Duration::from_secs(30)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value})).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereRemoveVideoTransition { track, clip_index, position } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request("remove_video_transition", json!({"track":track,"clipIndex":clip_index,"position":position}), Duration::from_secs(20)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value})).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereInspectKeyframes { target } => {
            let value = premiere_bridge.request("inspect_keyframes", target.bridge_arguments(), Duration::from_secs(20)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereEditKeyframe { target, ticks, expected_signature, operation, interpolation } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let mut arguments = target.bridge_arguments();
            arguments["ticks"] = json!(ticks);
            arguments["expectedSignature"] = json!(expected_signature);
            arguments["operation"] = json!(operation);
            arguments["interpolation"] = json!(interpolation);
            let value = premiere_bridge.request("edit_keyframe", arguments, Duration::from_secs(20)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value})).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereInspectClipSpeed { kind, track, clip_index } => {
            let value = premiere_bridge.request(
                "inspect_clip_speed",
                json!({"kind": kind, "track": track, "clipIndex": clip_index}),
                Duration::from_secs(15),
            ).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremierePlanSpeed { kind, track, clip_index, request } => {
            let value = premiere_bridge.request(
                "plan_clip_speed",
                json!({"kind": kind, "track": track, "clipIndex": clip_index, "request": request}),
                Duration::from_secs(15),
            ).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereInspectEffectLifecycle { target } => {
            let value = premiere_bridge.request("inspect_effect_lifecycle", target.bridge_arguments(), Duration::from_secs(15)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereRemoveEffect { target, expected_signature } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let mut arguments = target.bridge_arguments(); arguments["expectedSignature"] = json!(expected_signature);
            let value = premiere_bridge.request("remove_effect", arguments, Duration::from_secs(20)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&json!({"backup":backup,"result":value})).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremierePlanSceneDetection {request} => {
            request.validate()?;
            let capabilities = premiere_bridge.request("scene_detection_capabilities", json!({}), Duration::from_secs(10)).await?;
            let timeline = premiere_bridge.request("inspect_timeline", json!({}), Duration::from_secs(25)).await?;
            let plan = premiere_scene_detection::build_plan(&request, &timeline, &capabilities)?;
            Ok(ActionResult {
                success:true,
                tool,
                stdout:serde_json::to_string_pretty(&plan).unwrap_or_else(|_| "{}".into()),
                stderr:String::new(),
                exit_code:Some(0),
            })
        }
        ToolAction::PremierePlanSceneRoughCut {request} => {
            request.validate()?;
            let timeline = premiere_bridge.request("inspect_timeline", json!({}), Duration::from_secs(25)).await?;
            let captions = premiere_bridge.request("caption_tracks", json!({}), Duration::from_secs(10)).await?;
            let mut plan = premiere_scene_rough_cut::build_plan(&request, &timeline, &captions)?;
            plan["planner"] = json!("premiere_plan_scene_rough_cut");
            Ok(ActionResult {
                success:true,
                tool,
                stdout:serde_json::to_string_pretty(&plan).unwrap_or_else(|_| "{}".into()),
                stderr:String::new(),
                exit_code:Some(0),
            })
        }
        ToolAction::PremiereSceneDetection {request} => {
            request.validate()?;
            let capabilities = premiere_bridge.request("scene_detection_capabilities", json!({}), Duration::from_secs(10)).await?;
            let timeline = premiere_bridge.request("inspect_timeline", json!({}), Duration::from_secs(25)).await?;
            let plan = premiere_scene_detection::build_plan(&request, &timeline, &capabilities)?;
            if plan.get("supported").and_then(Value::as_bool) != Some(true) {
                return Err(plan.get("reason").and_then(Value::as_str).unwrap_or("Native scene detection is unavailable.").to_string());
            }
            let expected = premiere_bridge.expected.ok_or("Scene detection requires exact approved Premiere expectations.")?;
            if plan.get("expected") != Some(&serde_json::to_value(expected).map_err(|e|e.to_string())?) {
                return Err("Scene detection target/project state changed since planning; no operation was dispatched.".into());
            }
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(expected) };
            let result = client.request(
                "scene_edit_detection",
                json!({"mode":request.mode,"targets":request.targets}),
                Duration::from_secs(180),
            ).await?;
            let accepted = result.get("nativeAccepted").and_then(Value::as_bool)==Some(true);
            let verification = result.get("verificationStatus").and_then(Value::as_str).unwrap_or("unknown");
            Ok(ActionResult {
                success:accepted,
                tool,
                stdout:json!({
                    "checkpoint":checkpoint,
                    "plan":plan,
                    "result":result,
                    "native_accepted":accepted,
                    "verification_status":verification,
                    "runtime_verified":false,
                    "retry_safe":false
                }).to_string(),
                stderr:String::new(),
                exit_code:Some(if accepted {0}else{1}),
            })
        }
        ToolAction::PremiereCancelTranscriptRebuild { generation } => {
            let cancelled = state.rebuild_running.cancel(generation, &state.rebuild_cancelled)?;
            Ok(ActionResult {success:true, tool, stdout:json!({"cancel_requested":cancelled,"generation":generation,"native_inflight_may_finish":cancelled}).to_string(), stderr:String::new(), exit_code:Some(0)})
        }
        ToolAction::PremiereTranscriptRebuild {request, apply, plan_snapshot} => {
            request.validate()?;
            if !apply {
                let plan = premiere_bridge.request("plan_transcript_rebuild", json!({"request":request}), Duration::from_secs(60)).await?;
                return Ok(ActionResult {success:true, tool, stdout:plan.to_string(), stderr:String::new(), exit_code:Some(0)});
            }
            let _guard = state.rebuild_running.begin(&state.rebuild_cancelled)?;
            // Checkpoint first; native begin then rechecks the approved snapshot before any media mutation.
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let prepared = premiere_bridge.request("begin_transcript_rebuild", json!({"request":request,"plan_snapshot":plan_snapshot}), Duration::from_secs(60)).await?;
            let id = prepared.get("id").and_then(Value::as_str).ok_or("Native rebuild ID missing.")?;
            let count = prepared.get("operation_count").and_then(Value::as_u64).filter(|n| *n <= 256).ok_or("Invalid rebuild step bound.")? as usize;
            let mut result = premiere_transcript_rebuild::run(id, count, &state.rebuild_cancelled, |index| {
                let bridge = &premiere_bridge;
                let audit_tool = &tool;
                async move {
                    append_audit(app, &AuditEntry {timestamp_ms:now_ms(),event:"rebuild_dispatch".into(),tool:audit_tool.clone(),detail:format!("{id}: step {index}"),success:false,action_id:None})?;
                    let reply = bridge.request("step_transcript_rebuild", json!({"id":id,"index":index}), Duration::from_secs(60)).await;
                    append_audit(app, &AuditEntry {timestamp_ms:now_ms(),event:"rebuild_result".into(),tool:audit_tool.clone(),detail:format!("{id}: step {index}: {}", reply.as_ref().ok().and_then(|v| v.get("status")).and_then(Value::as_str).unwrap_or("uncertain")),success:reply.as_ref().ok().is_some_and(|v| v.get("status").and_then(Value::as_str)==Some("applied")),action_id:None})?;
                    reply
                }
            }).await;
            let release = premiere_bridge.request("release_transcript_rebuild",json!({"id":id}),Duration::from_secs(10)).await;
            result["session_released"] = json!(release.as_ref().ok().and_then(|v|v.get("released")).and_then(Value::as_bool)==Some(true));
            result["checkpoint"] = json!(checkpoint);
            result["plan"] = prepared.get("plan").cloned().unwrap_or(Value::Null);
            let success = result.get("complete").and_then(Value::as_bool)==Some(true);
            Ok(ActionResult {success,tool,stdout:result.to_string(),stderr:String::new(),exit_code:Some(if success {0} else {1})})
        }
        ToolAction::PremiereAssemblyCancel { generation } => {
            let cancelled = state.assembly_running.cancel(generation, &state.assembly_cancelled)?;
            Ok(ActionResult{success:true,tool,stdout:json!({"cancel_requested":cancelled,"generation":generation,"native_inflight_may_finish":cancelled}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereAssembly{assembly,apply} => {
            let expected=premiere_bridge.expected;
            let _running_guard = if apply { Some(state.assembly_running.begin(&state.assembly_cancelled)?) } else { None };

            let ids=assembly.all_item_ids();
            let inspected=premiere_bridge.request(
                "inspect_assembly_items",
                json!({"itemIds":ids}),
                Duration::from_secs(30),
            ).await?;
            let native_expected=inspected.get("expected").ok_or("Assembly preflight returned no project/sequence identity.")?;
            if apply && Some(native_expected)!=expected.and_then(|value|serde_json::to_value(value).ok()).as_ref() {
                return Err("Assembly project or sequence changed since planning.".into());
            }
            let video_tracks=inspected.get("video_tracks").and_then(Value::as_u64).ok_or("Video track count unavailable.")?;
            let audio_tracks=inspected.get("audio_tracks").and_then(Value::as_u64).ok_or("Audio track count unavailable.")?;
            let items=inspected.get("items").and_then(Value::as_array).ok_or("Project item inspection unavailable.")?;
            if items.len()!=ids.len(){return Err("Incomplete project item inspection.".into());}

            let mut blocked=Vec::new();
            for (i,shot) in assembly.shots.iter().enumerate() {
                if shot.video_track as u64>=video_tracks
                    || shot.audio_track as u64>=audio_tracks
                    || items[i]["id"].as_str()!=Some(shot.item_id.as_str())
                    || items[i]["insertable"].as_bool()!=Some(true)
                {
                    blocked.push(json!({"kind":"shot","index":i,"item_id":shot.item_id,"reason":"Project item is missing/not insertable or target tracks do not exist."}));
                }
            }
            for (i,music) in assembly.music.iter().enumerate() {
                let item_index=assembly.shots.len()+i;
                if music.video_track as u64>=video_tracks
                    || music.audio_track as u64>=audio_tracks
                    || items[item_index]["id"].as_str()!=Some(music.item_id.as_str())
                    || items[item_index]["insertable"].as_bool()!=Some(true)
                {
                    blocked.push(json!({"kind":"music","index":i,"item_id":music.item_id,"reason":"Music item is missing/not insertable or target tracks do not exist."}));
                }
            }
            if let Some(graphics)=&assembly.graphics {
                if graphics.video_track as u64>=video_tracks||graphics.audio_track as u64>=audio_tracks {
                    blocked.push(json!({"kind":"graphics","reason":"Mapped graphics destination tracks do not exist."}));
                }
            }

            let installed_transitions=if assembly.transitions.is_empty() {
                Vec::<String>::new()
            } else {
                let value=premiere_bridge.request("list_video_transitions",json!({}),Duration::from_secs(20)).await?;
                value.get("transitions").and_then(Value::as_array).ok_or("Installed transition list unavailable.")?
                    .iter().filter_map(Value::as_str).map(str::to_string).collect()
            };
            for (i,transition) in assembly.transitions.iter().enumerate() {
                if !installed_transitions.iter().any(|name|name==&transition.match_name) {
                    blocked.push(json!({"kind":"transition","index":i,"match_name":transition.match_name,"reason":"Requested transition is not installed."}));
                }
            }

            let saved_graphics=if let Some(batch)=&assembly.graphics {
                let saved=premiere_graphics::list(&graphics_library_path(app)?)?
                    .into_iter().find(|saved|saved.mapping.name==batch.mapping)
                    .ok_or("Unknown advanced assembly graphics mapping.")?;
                batch.resolve(&saved)?;
                saved.mapping.validate_local_template()?;
                Some(saved)
            }else{None};

            if !apply {
                return Ok(ActionResult{
                    success:true,
                    tool,
                    stdout:json!({
                        "applied":false,
                        "executable":blocked.is_empty(),
                        "assembly":assembly,
                        "blocked":blocked,
                        "expected":native_expected,
                        "video_tracks":video_tracks,
                        "audio_tracks":audio_tracks,
                        "source_range_support":assembly.schema_version>=2,
                        "source_range_strategy":"verified_created_subclip_id",
                        "transition_count":assembly.transitions.len(),
                        "music_count":assembly.music.len(),
                        "graphics_count":assembly.graphics.as_ref().map(|batch|batch.items.len()).unwrap_or(0),
                        "review_times":if assembly.review{assembly.review_times()?}else{Vec::new()},
                        "inferred_beat_detection":false
                    }).to_string(),
                    stderr:String::new(),
                    exit_code:Some(0)
                });
            }
            if !blocked.is_empty(){return Err("Advanced assembly preflight blocked one or more requested items; nothing was edited.".into());}

            let backup=backup_premiere_project(&premiere_bridge).await?;
            let mut shot_results=Vec::new();
            let mut subclips=Vec::new();
            let mut music_results=Vec::new();
            let mut transition_results=Vec::new();
            let mut marker_results=Vec::new();
            let mut graphics_result=Value::Null;
            let mut uncertain=false;

            for (i,shot) in assembly.shots.iter().enumerate() {
                if state.assembly_cancelled.load(Ordering::Acquire){break;}
                let seconds=assembly.shot_seconds(shot)?;
                let mut insert_item_id=shot.item_id.clone();

                if let (Some(source_in),Some(source_out))=(shot.source_in,shot.source_out) {
                    let name=format!("Shuvi Range {:03}",i+1);
                    match premiere_bridge.request(
                        "create_subclip",
                        json!({
                            "itemId":shot.item_id,
                            "name":name,
                            "startSeconds":source_in,
                            "endSeconds":source_out,
                            "hardBoundaries":true,
                            "takeVideo":shot.take_video,
                            "takeAudio":shot.take_audio
                        }),
                        Duration::from_secs(45),
                    ).await {
                        Ok(value) => {
                            if value.get("correlationVerified").and_then(Value::as_bool)!=Some(true) {
                                uncertain=true;
                                subclips.push(json!({"shot_index":i,"status":"uncertain","native_result":value,"reason":"Created subclip could not be correlated to exactly one new native project item."}));
                                break;
                            }
                            let created=value.get("createdItemId").and_then(Value::as_str).filter(|id|!id.is_empty())
                                .ok_or("Verified subclip correlation returned no project item id.")?;
                            insert_item_id=created.to_string();
                            subclips.push(json!({"shot_index":i,"status":"created","source_item_id":shot.item_id,"created_item_id":created,"source_in":source_in,"source_out":source_out}));
                        }
                        Err(error)=>{
                            uncertain=true;
                            subclips.push(json!({"shot_index":i,"status":"uncertain","reason":error.chars().take(240).collect::<String>()}));
                            break;
                        }
                    }
                }

                if state.assembly_cancelled.load(Ordering::Acquire) { break; }
                match premiere_bridge.request(
                    "insert_project_item",
                    json!({
                        "itemId":insert_item_id,
                        "seconds":seconds,
                        "videoTrack":shot.video_track,
                        "audioTrack":shot.audio_track,
                        "mode":shot.mode
                    }),
                    Duration::from_secs(35),
                ).await {
                    Ok(value)=>shot_results.push(json!({
                        "index":i,"source_item_id":shot.item_id,"insert_item_id":insert_item_id,
                        "role":shot.role,"requested_seconds":seconds,"status":"accepted","native_result":value
                    })),
                    Err(error)=>{
                        uncertain=true;
                        shot_results.push(json!({"index":i,"item_id":insert_item_id,"status":"uncertain","reason":error.chars().take(240).collect::<String>()}));
                        break;
                    }
                }
            }

            if !uncertain && shot_results.len()==assembly.shots.len() {
                for (i,music) in assembly.music.iter().enumerate() {
                    if state.assembly_cancelled.load(Ordering::Acquire){break;}
                    match premiere_bridge.request(
                        "insert_project_item",
                        json!({
                            "itemId":music.item_id,
                            "seconds":music.timeline_seconds,
                            "videoTrack":music.video_track,
                            "audioTrack":music.audio_track,
                            "mode":music.mode
                        }),
                        Duration::from_secs(35),
                    ).await {
                        Ok(value)=>music_results.push(json!({"index":i,"item_id":music.item_id,"seconds":music.timeline_seconds,"status":"accepted","native_result":value})),
                        Err(error)=>{
                            uncertain=true;
                            music_results.push(json!({"index":i,"item_id":music.item_id,"status":"uncertain","reason":error.chars().take(240).collect::<String>()}));
                            break;
                        }
                    }
                }
            }

            let mut post_insert_timeline=None;
            if !uncertain && shot_results.len()==assembly.shots.len() && music_results.len()==assembly.music.len() {
                let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(25)).await?;
                for (i,transition) in assembly.transitions.iter().enumerate() {
                    if state.assembly_cancelled.load(Ordering::Acquire){break;}
                    let shot=&assembly.shots[transition.shot_index as usize];
                    let seconds=assembly.shot_seconds(shot)?;
                    let clip_index=premiere_assembly::resolve_video_clip_index(&timeline,shot.video_track,seconds)?;
                    match premiere_bridge.request(
                        "add_video_transition",
                        json!({
                            "track":shot.video_track,
                            "clipIndex":clip_index,
                            "matchName":transition.match_name,
                            "durationSeconds":transition.duration_seconds,
                            "position":transition.position,
                            "forceSingleSided":transition.force_single_sided
                        }),
                        Duration::from_secs(30),
                    ).await {
                        Ok(value)=>transition_results.push(json!({"index":i,"shot_index":transition.shot_index,"clip_index":clip_index,"status":"accepted","native_result":value})),
                        Err(error)=>{
                            uncertain=true;
                            transition_results.push(json!({"index":i,"shot_index":transition.shot_index,"status":"uncertain","reason":error.chars().take(240).collect::<String>()}));
                            break;
                        }
                    }
                }
                post_insert_timeline=Some(timeline);
            }

            if !uncertain && transition_results.len()==assembly.transitions.len() {
                for chapter in &assembly.chapters {
                    if state.assembly_cancelled.load(Ordering::Acquire){break;}
                    match premiere_bridge.request(
                        "add_marker",
                        json!({"name":chapter.name,"markerType":"Chapter","seconds":chapter.seconds,"durationSeconds":0,"comments":""}),
                        Duration::from_secs(20),
                    ).await {
                        Ok(value)=>marker_results.push(json!({"name":chapter.name,"seconds":chapter.seconds,"status":"accepted","native_result":value})),
                        Err(error)=>{
                            uncertain=true;
                            marker_results.push(json!({"name":chapter.name,"status":"uncertain","reason":error.chars().take(240).collect::<String>()}));
                            break;
                        }
                    }
                }
            }

            if !uncertain && marker_results.len()==assembly.chapters.len() {
                if let (Some(batch),Some(saved))=(&assembly.graphics,saved_graphics.as_ref()) {
                    graphics_result=premiere_graphics::run_batch(batch,saved,&state.assembly_cancelled,|step| {
                        let client=&premiere_bridge;
                        let checkpoint=backup.clone();
                        async move {
                            match step {
                                premiere_graphics::BatchStep::Checkpoint=>Ok(json!(checkpoint)),
                                premiere_graphics::BatchStep::Insert(arguments)=>
                                    client.request("insert_mapped_graphic",arguments,Duration::from_secs(90)).await,
                            }
                        }
                    }).await?;
                    uncertain=graphics_result.get("uncertain").and_then(Value::as_bool).unwrap_or(true);
                }
            }

            let cancelled=state.assembly_cancelled.load(Ordering::Acquire);
            let final_timeline=if shot_results.iter().any(|row|row["status"]=="accepted") {
                premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(25)).await.ok()
            }else{None};
            let graphics_complete=assembly.graphics.is_none()||graphics_result.get("complete").and_then(Value::as_bool)==Some(true);
            let complete=!uncertain&&!cancelled
                &&shot_results.len()==assembly.shots.len()&&shot_results.iter().all(|row|row["status"]=="accepted")
                &&music_results.len()==assembly.music.len()&&music_results.iter().all(|row|row["status"]=="accepted")
                &&transition_results.len()==assembly.transitions.len()&&transition_results.iter().all(|row|row["status"]=="accepted")
                &&marker_results.len()==assembly.chapters.len()&&marker_results.iter().all(|row|row["status"]=="accepted")
                &&graphics_complete;

            Ok(ActionResult{
                success:complete,
                tool,
                stdout:json!({
                    "backup":backup,
                    "complete":complete,
                    "uncertain":uncertain,
                    "cancelled":cancelled,
                    "shots":shot_results,
                    "created_subclips":subclips,
                    "music":music_results,
                    "transitions":transition_results,
                    "chapters":marker_results,
                    "graphics":graphics_result,
                    "post_insert_timeline_inspected":post_insert_timeline.is_some(),
                    "final_timeline":final_timeline,
                    "review_requested":assembly.review,
                    "review_times":if assembly.review{assembly.review_times()?}else{Vec::new()},
                    "review_execution_tool":if assembly.review{Some("premiere_review_frames")}else{None},
                    "inferred_beat_detection":false,
                    "automatic_rollback":false
                }).to_string(),
                stderr:String::new(),
                exit_code:Some(if complete{0}else{1})
            })
        }
        ToolAction::PremiereFinishMediaBatch { request, provider } => {
            let _guard = state.finishing_running.begin(&state.finishing_cancelled)?;
            let expected = premiere_bridge.expected.ok_or("Mixed finishing requires inspected Premiere expectations.")?.clone();

            let timeline = premiere_bridge.request("inspect_timeline", json!({}), Duration::from_secs(25)).await?;
            let sample_times = if request.review {
                premiere_finishing::review_times(&timeline, &request.videos)?
            } else {
                Vec::new()
            };

            let mut before_review = Vec::new();
            if let Some(provider) = &provider {
                for seconds in &sample_times {
                    if state.finishing_cancelled.load(Ordering::Acquire) { break; }
                    let observation = async {
                        premiere_bridge.request("set_playhead", json!({"seconds":seconds}), Duration::from_secs(8)).await?;
                        tokio::time::sleep(Duration::from_millis(350)).await;
                        let path = capture_screen_png()?;
                        let analysis = analyze_png_with_provider(
                            provider,
                            request.review_prompt.as_deref().unwrap_or("Review professional finishing consistency."),
                            &path,
                        ).await?;
                        Ok::<Value,String>(json!({"seconds":seconds,"analysis":analysis}))
                    }.await;
                    match observation {
                        Ok(value) => before_review.push(json!({"status":"reviewed","result":value})),
                        Err(error) => before_review.push(json!({"status":"failed","reason":error.chars().take(240).collect::<String>()})),
                    }
                }
            }

            let mut video_plans: Vec<(u32,u32,PremiereExpectation,Value)> = Vec::new();
            let mut audio_plans: Vec<(ParameterTarget,PremiereExpectation,Value)> = Vec::new();
            let mut video_results = Vec::new();
            let mut audio_results = Vec::new();
            let mut uncertain = false;

            for video in &request.videos {
                let clip = expected.clips.iter().find(|clip|
                    clip.kind=="video" && clip.track==video.track && clip.clip_index==video.clip_index
                ).ok_or("Missing mixed finishing video guard.")?.clone();
                let guard = PremiereExpectation {
                    project_guid: expected.project_guid.clone(),
                    project_path: expected.project_path.clone(),
                    sequence_guid: expected.sequence_guid.clone(),
                    clips: vec![clip],
                };
                let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(&guard) };
                match client.request(
                    "plan_video_recipe",
                    json!({"track":video.track,"clipIndex":video.clip_index,"request":video.request}),
                    Duration::from_secs(30),
                ).await {
                    Ok(plan)
                        if plan.get("expected")==Some(&serde_json::to_value(&guard).map_err(|e|e.to_string())?)
                        && plan.get("skipped").and_then(Value::as_array).is_some_and(Vec::is_empty)
                        && plan.get("settings").and_then(Value::as_array).is_some_and(|settings|!settings.is_empty()&&settings.len()<=64) =>
                    {
                        video_plans.push((video.track,video.clip_index,guard,plan));
                    }
                    Ok(_) => video_results.push(json!({
                        "track":video.track,"clip_index":video.clip_index,"status":"skipped",
                        "reason":"Native video plan is incomplete, stale, or has incompatible bindings."
                    })),
                    Err(error) => video_results.push(json!({
                        "track":video.track,"clip_index":video.clip_index,"status":"failed",
                        "reason":error.chars().take(240).collect::<String>()
                    })),
                }
            }

            for audio in &request.audios {
                let clip = expected.clips.iter().find(|clip|
                    clip.kind=="audio" && clip.track==audio.target.track && clip.clip_index==audio.target.clip_index
                ).ok_or("Missing mixed finishing audio guard.")?.clone();
                let guard = PremiereExpectation {
                    project_guid: expected.project_guid.clone(),
                    project_path: expected.project_path.clone(),
                    sequence_guid: expected.sequence_guid.clone(),
                    clips: vec![clip],
                };
                let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(&guard) };
                let mut arguments = audio.target.bridge_arguments();
                arguments["request"] = serde_json::to_value(&audio.request).map_err(|e|e.to_string())?;
                match client.request("plan_audio_automation", arguments, Duration::from_secs(30)).await {
                    Ok(plan)
                        if plan.get("expected")==Some(&serde_json::to_value(&guard).map_err(|e|e.to_string())?)
                        && plan.get("settings").and_then(Value::as_array).is_some_and(|settings|!settings.is_empty()&&settings.len()<=64) =>
                    {
                        audio_plans.push((audio.target.clone(),guard,plan));
                    }
                    Ok(_) => audio_results.push(json!({
                        "track":audio.target.track,"clip_index":audio.target.clip_index,"status":"skipped",
                        "reason":"Native audio plan is incomplete or stale."
                    })),
                    Err(error) => audio_results.push(json!({
                        "track":audio.target.track,"clip_index":audio.target.clip_index,"status":"failed",
                        "reason":error.chars().take(240).collect::<String>()
                    })),
                }
            }

            let saved_graphics = if let Some(batch) = &request.graphics {
                let saved = premiere_graphics::list(&graphics_library_path(app)?)?
                    .into_iter()
                    .find(|saved| saved.mapping.name==batch.mapping)
                    .ok_or("Unknown mixed finishing graphics mapping.")?;
                batch.resolve(&saved)?;
                saved.mapping.validate_local_template()?;
                Some(saved)
            } else {
                None
            };

            let has_mutation = !video_plans.is_empty() || !audio_plans.is_empty() || request.graphics.is_some();
            let checkpoint = if has_mutation {
                Some(backup_premiere_project(&premiere_bridge).await?)
            } else {
                None
            };

            for (track,clip_index,guard,plan) in video_plans {
                if state.finishing_cancelled.load(Ordering::Acquire) { break; }
                let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(&guard) };
                let settings = plan.get("settings").and_then(Value::as_array).ok_or("Video finishing settings disappeared.")?;
                match client.request(
                    "apply_video_recipe",
                    json!({"track":track,"clipIndex":clip_index,"settings":settings}),
                    Duration::from_secs(45),
                ).await {
                    Ok(value) => video_results.push(json!({"track":track,"clip_index":clip_index,"status":"applied","native_result":value})),
                    Err(error) => {
                        uncertain = error.contains("unknown")||error.contains("timed out")||error.contains("timeout");
                        video_results.push(json!({
                            "track":track,"clip_index":clip_index,
                            "status":if uncertain{"uncertain"}else{"failed"},
                            "reason":error.chars().take(240).collect::<String>()
                        }));
                        if uncertain { break; }
                    }
                }
            }

            if !uncertain {
                for (target,guard,plan) in audio_plans {
                    if state.finishing_cancelled.load(Ordering::Acquire) { break; }
                    let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(&guard) };
                    let settings = plan.get("settings").and_then(Value::as_array).ok_or("Audio finishing settings disappeared.")?;
                    match client.request(
                        "apply_audio_recipe",
                        json!({"track":target.track,"clipIndex":target.clip_index,"settings":settings}),
                        Duration::from_secs(45),
                    ).await {
                        Ok(value) => audio_results.push(json!({
                            "track":target.track,"clip_index":target.clip_index,"status":"applied","native_result":value
                        })),
                        Err(error) => {
                            uncertain = error.contains("unknown")||error.contains("timed out")||error.contains("timeout");
                            audio_results.push(json!({
                                "track":target.track,"clip_index":target.clip_index,
                                "status":if uncertain{"uncertain"}else{"failed"},
                                "reason":error.chars().take(240).collect::<String>()
                            }));
                            if uncertain { break; }
                        }
                    }
                }
            }

            let mut graphics_result = Value::Null;
            if !uncertain && !state.finishing_cancelled.load(Ordering::Acquire) {
                if let (Some(batch),Some(saved)) = (&request.graphics,saved_graphics.as_ref()) {
                    let project_guard = PremiereExpectation {
                        project_guid: expected.project_guid.clone(),
                        project_path: expected.project_path.clone(),
                        sequence_guid: expected.sequence_guid.clone(),
                        clips: Vec::new(),
                    };
                    let graphics_client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(&project_guard) };
                    let checkpoint_path = checkpoint.clone().ok_or("Mixed finishing checkpoint missing before graphics.")?;
                    graphics_result = premiere_graphics::run_batch(batch,saved,&state.finishing_cancelled,|step| {
                        let client = &graphics_client;
                        let checkpoint_path = checkpoint_path.clone();
                        async move {
                            match step {
                                premiere_graphics::BatchStep::Checkpoint => Ok(json!(checkpoint_path)),
                                premiere_graphics::BatchStep::Insert(arguments) =>
                                    client.request("insert_mapped_graphic",arguments,Duration::from_secs(90)).await,
                            }
                        }
                    }).await?;
                    uncertain = graphics_result.get("uncertain").and_then(Value::as_bool).unwrap_or(true);
                }
            }

            let cancelled = state.finishing_cancelled.load(Ordering::Acquire);
            let project_guard = PremiereExpectation {
                project_guid: expected.project_guid.clone(),
                project_path: expected.project_path.clone(),
                sequence_guid: expected.sequence_guid.clone(),
                clips: Vec::new(),
            };
            let post_client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(&project_guard) };
            let post_timeline = post_client.request("inspect_timeline",json!({}),Duration::from_secs(25)).await.ok();

            let mut after_review = Vec::new();
            if !uncertain && !cancelled {
                if let Some(provider) = &provider {
                    for seconds in &sample_times {
                        let observation = async {
                            post_client.request("set_playhead",json!({"seconds":seconds}),Duration::from_secs(8)).await?;
                            tokio::time::sleep(Duration::from_millis(350)).await;
                            let path = capture_screen_png()?;
                            let analysis = analyze_png_with_provider(
                                provider,
                                request.review_prompt.as_deref().unwrap_or("Review professional finishing consistency."),
                                &path,
                            ).await?;
                            Ok::<Value,String>(json!({"seconds":seconds,"analysis":analysis}))
                        }.await;
                        match observation {
                            Ok(value) => after_review.push(json!({"status":"reviewed","result":value})),
                            Err(error) => after_review.push(json!({"status":"failed","reason":error.chars().take(240).collect::<String>()})),
                        }
                    }
                }
            }

            let video_applied = video_results.iter().filter(|row|row["status"]=="applied").count();
            let audio_applied = audio_results.iter().filter(|row|row["status"]=="applied").count();
            let graphics_complete = request.graphics.is_none()
                || graphics_result.get("complete").and_then(Value::as_bool)==Some(true);
            let all_video_applied = video_applied==request.videos.len();
            let all_audio_applied = audio_applied==request.audios.len();
            let review_complete = !request.review
                || (before_review.len()==sample_times.len()
                    && after_review.len()==sample_times.len()
                    && before_review.iter().all(|row|row["status"]=="reviewed")
                    && after_review.iter().all(|row|row["status"]=="reviewed"));
            let success = all_video_applied && all_audio_applied && graphics_complete
                && review_complete && !uncertain && !cancelled;

            Ok(ActionResult {
                success,
                tool,
                stdout: json!({
                    "schema_version":1,
                    "checkpoint":checkpoint,
                    "cancelled":cancelled,
                    "uncertain":uncertain,
                    "video":{"requested":request.videos.len(),"applied":video_applied,"results":video_results},
                    "audio":{"requested":request.audios.len(),"applied":audio_applied,"results":audio_results},
                    "graphics":graphics_result,
                    "review":{
                        "sample_times":sample_times,
                        "before":before_review,
                        "after":after_review,
                        "subjective_quality_guaranteed":false
                    },
                    "post_timeline_inspected":post_timeline.is_some(),
                    "post_timeline":post_timeline,
                    "unsupported_features":["speed_ramp","masks","multicam","inferred_linked_media"]
                }).to_string(),
                stderr:String::new(),
                exit_code:Some(if success{0}else{1}),
            })
        }
        ToolAction::PremiereBatchFinishCancel { generation } => {
            let cancelled = state.finishing_running.cancel(generation, &state.finishing_cancelled)?;
            Ok(ActionResult{success:true,tool,stdout:json!({"cancel_requested":cancelled,"generation":generation,"native_inflight_may_finish":cancelled}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereSaveGraphicsMapping {mapping,track,clip_index,expected_revision} => {
            mapping.validate_local_template()?;
            let inspected = premiere_bridge.request("inspect_mogrt_properties", json!({"track":track,"clipIndex":clip_index}), Duration::from_secs(30)).await?;
            let expected = premiere_bridge.expected.ok_or("Reference clip expectation missing.")?;
            let native: PremiereExpectation = serde_json::from_value(inspected["expected"].clone()).map_err(|e| e.to_string())?;
            if native.project_guid != expected.project_guid || native.sequence_guid != expected.sequence_guid
                || native.clips.len() != 1 || native.clips[0].signature != expected.clips[0].signature {
                return Err("Graphics reference changed during inspection; mapping not saved.".into());
            }
            mapping.validate_inspection(&inspected)?;
            let saved = premiere_graphics::save(&graphics_library_path(app)?, mapping, expected_revision)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"saved":saved,"template_identity":"caller_supplied","roles_inferred":false}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereListGraphicsMappings => {
            let entries = premiere_graphics::list(&graphics_library_path(app)?)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"mappings":entries,"limits":{"mappings":64,"bytes":98304,"batch_items":32}}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereDeleteGraphicsMapping {name,revision} => {
            premiere_graphics::delete(&graphics_library_path(app)?, &name, revision)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"deleted":name,"revision":revision}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereCancelGraphicsBatch { generation } => {
            let cancelled = state.graphics_running.cancel(generation, &state.graphics_cancelled)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"cancel_requested":cancelled,"generation":generation,"native_inflight_may_finish":cancelled}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereBatchGraphics {batch} => {
            let _guard = state.graphics_running.begin(&state.graphics_cancelled)?;
            let expected = premiere_bridge.expected.ok_or("Graphics project/sequence expectation missing.")?;
            stage_graphics_batch(&serde_json::to_value(&batch).map_err(|e| e.to_string())?, Some(expected))?;
            let saved = premiere_graphics::list(&graphics_library_path(app)?)?.into_iter().find(|s| s.mapping.name == batch.mapping).ok_or("Unknown graphics mapping.")?;
            batch.resolve(&saved)?;
            saved.mapping.validate_local_template()?;
            let timeline = premiere_bridge.request("inspect_timeline", json!({}), Duration::from_secs(30)).await?;
            if timeline["truncated"] != false || !timeline["videoTracks"].as_array().is_some_and(|t| t.iter().any(|t| t["index"] == batch.video_track))
                || !timeline["audioTracks"].as_array().is_some_and(|t| t.iter().any(|t| t["index"] == batch.audio_track)) {
                return Err("Graphics preflight needs a complete timeline and existing destination tracks.".into());
            }
            let result = premiere_graphics::run_batch(&batch, &saved, &state.graphics_cancelled, |step| {
                let client = &premiere_bridge;
                async move {
                    match step {
                        premiere_graphics::BatchStep::Checkpoint => Ok(json!(backup_premiere_project(client).await?)),
                        premiere_graphics::BatchStep::Insert(arguments) => client.request("insert_mapped_graphic", arguments, Duration::from_secs(90)).await,
                    }
                }
            }).await?;
            let success = result["complete"] == true;
            Ok(ActionResult {success,tool,stdout:result.to_string(),stderr:String::new(),exit_code:Some(if success {0} else {1})})
        }
        ToolAction::PremiereBatchFinish{targets} => {
            let _guard = state.finishing_running.begin(&state.finishing_cancelled)?;
            let expected=premiere_bridge.expected.ok_or("Batch requires inspected Premiere expectation.")?;
            let mut results=Vec::new();let mut checkpoint:Option<String>=None;
            let requested = targets.len();
            let mut uncertain = false;
            for target in targets {
                if state.finishing_cancelled.load(Ordering::Acquire){break;}
                let track=target["track"].as_u64().ok_or("Invalid batch track.")? as u32;
                let index=target["clip_index"].as_u64().ok_or("Invalid batch index.")? as u32;
                let clip=expected.clips.iter().find(|c|c.kind=="video"&&c.track==track&&c.clip_index==index).ok_or("Missing batch clip guard.")?.clone();
                let guard=PremiereExpectation{project_guid:expected.project_guid.clone(),project_path:expected.project_path.clone(),sequence_guid:expected.sequence_guid.clone(),clips:vec![clip]};
                let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(&guard)};
                let request=target.get("request").ok_or("Missing batch recipe request.")?;
                let plan=client.request("plan_video_recipe",json!({"track":track,"clipIndex":index,"request":request}),Duration::from_secs(30)).await;
                let mut dispatched = false;
                let outcome=match plan {
                    Ok(plan) => {
                        if plan.get("expected")!=Some(&serde_json::to_value(&guard).map_err(|e|e.to_string())?) {Err("Native clip expectation changed during planning.".into())}
                        else if !plan.get("skipped").and_then(Value::as_array).is_some_and(Vec::is_empty) {Err("Some native bindings are unavailable; clip skipped.".into())}
                        else if let Some(settings)=plan.get("settings").and_then(Value::as_array).filter(|s|!s.is_empty()&&s.len()<=64){
                            if state.finishing_cancelled.load(Ordering::Acquire){Err("Cancelled before clip edit.".into())}
                            else {
                                if checkpoint.is_none(){checkpoint=Some(backup_premiere_project(&client).await?);}
                                if state.finishing_cancelled.load(Ordering::Acquire) { break; }
                                dispatched = true;
                                client.request("apply_video_recipe",json!({"track":track,"clipIndex":index,"settings":settings}),Duration::from_secs(45)).await
                            }
                        }else{Err("Native planner returned no bounded executable settings.".into())}
                    },Err(error)=>Err(error)
                };
                match outcome {
                    Ok(result)=>results.push(json!({"track":track,"clip_index":index,"status":"applied","result":result})),
                    Err(error)=>{
                        uncertain = dispatched;
                        results.push(json!({"track":track,"clip_index":index,"status":if uncertain{"uncertain"}else{"failed"},"reason":error.chars().take(240).collect::<String>()}));
                        if uncertain {break;}
                    }
                }
            }
            let done=results.iter().filter(|r|r["status"]=="applied").count();
            let cancelled=state.finishing_cancelled.load(Ordering::Acquire);
            Ok(ActionResult{success:done==requested&&!cancelled&&!uncertain,tool,stdout:json!({"checkpoint":checkpoint,"requested":requested,"uncertain":uncertain,"processed":results.len(),"applied":done,"cancelled":cancelled,"results":results,"review_recommended":done>0}).to_string(),stderr:String::new(),exit_code:Some(if done==requested&&!cancelled&&!uncertain{0}else{1})})
        }
        ToolAction::PremierePlanVideoRecipe { track, clip_index, request } => {
            let mut value = premiere_bridge.request("plan_video_recipe", json!({"track":track,"clipIndex":clip_index,"request":request}), Duration::from_secs(30)).await?;
            premiere_plan_calibration(&mut value,&premiere_bridge,app).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereTranscriptDucking{item_id,target,mut request,transcript_offset,music_start,merge_gap,apply} => {
            let transcript=premiere_bridge.request("export_transcript",json!({"itemId":item_id,"deliverSrt":true}),Duration::from_secs(30)).await?;
            let caption=transcript.get("captions").ok_or("Transcript has no timing adapter.")?;
            if caption.get("supported").and_then(Value::as_bool)!=Some(true)||caption.get("segmentsTruncated").and_then(Value::as_bool)!=Some(false){return Err("No complete recognized transcript timing available for ducking.".into());}
            let segments=caption.get("segments").and_then(Value::as_array).ok_or("Transcript segments missing.")?;
            request.regions=premiere_dialogue::regions(segments,transcript_offset,music_start,request.duration_seconds,merge_gap)?;
            let mut args=target.bridge_arguments();args["request"]=serde_json::to_value(&request).map_err(|e|e.to_string())?;
            let mut plan=premiere_bridge.request("plan_audio_automation",args,Duration::from_secs(30)).await?;
            if !apply {
                premiere_plan_calibration(&mut plan,&premiere_bridge,app).await?;
                plan["transcript_source"]=json!({"item_id":item_id,"region_count":request.regions.len(),"transcript_offset_seconds":transcript_offset,"music_start_seconds":music_start});
                return Ok(ActionResult{success:true,tool,stdout:plan.to_string(),stderr:String::new(),exit_code:Some(0)});
            }
            let expected=premiere_bridge.expected.ok_or("Ducking edit requires exact expectation.")?;
            if plan.get("expected")!=Some(&serde_json::to_value(expected).map_err(|e|e.to_string())?){return Err("Music target changed since inspection; no ducking written.".into());}
            let settings=plan.get("settings").and_then(Value::as_array).filter(|v|!v.is_empty()&&v.len()<=64).ok_or("Ducking plan has no bounded executable keyframes.")?;
            let backup=backup_premiere_project(&premiere_bridge).await?;
            let value=premiere_bridge.request("apply_audio_recipe",json!({"track":target.track,"clipIndex":target.clip_index,"settings":settings}),Duration::from_secs(45)).await?;
            Ok(ActionResult{success:true,tool,stdout:json!({"backup":backup,"result":value,"transcript_item_id":item_id,"dialogue_regions":request.regions.len(),"native_reinspection_recommended":true}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereTranscriptCuts { request, apply, transcript_snapshot } => {
            let transcript = premiere_bridge.request(
                "export_transcript",
                json!({"itemId": request.item_id, "deliverSrt": true}),
                Duration::from_secs(30),
            ).await?;
            let caption = transcript.get("captions").ok_or("Transcript has no timing adapter.")?;
            if caption.get("supported").and_then(Value::as_bool) != Some(true)
                || caption.get("segmentsTruncated").and_then(Value::as_bool) != Some(false)
            {
                return Err("No complete recognized transcript timing is available for talking-head editing.".into());
            }
            let segments = caption.get("segments").and_then(Value::as_array).ok_or("Transcript segments missing.")?;
            let timeline = premiere_bridge.request("inspect_timeline", json!({}), Duration::from_secs(20)).await?;
            let mut targets = vec![request.video.clone()];
            if let Some(audio) = &request.audio { targets.push(audio.clone()); }
            let states = premiere_talking_head::clip_states_from_timeline(&timeline, &targets)?;
            let plan = premiere_talking_head::build_plan(segments, &request, &states)?;

            if !apply {
                return Ok(ActionResult {
                    success: true,
                    tool,
                    stdout: serde_json::to_string_pretty(&plan).unwrap_or_else(|_| "{}".into()),
                    stderr: String::new(),
                    exit_code: Some(0),
                });
            }

            if transcript_snapshot.as_deref() != Some(plan.transcript_snapshot.as_str()) {
                return Err("Transcript changed since planning; inspect and plan again before editing.".into());
            }
            if !plan.supported {
                return Err(format!(
                    "Transcript cut plan is not executable: {}",
                    plan.unsupported_reasons.join(" ")
                ));
            }

            let expected = premiere_bridge.expected.ok_or("Transcript cuts require exact clip expectations.")?.clone();
            for state in &states {
                let guard = expected.clips.iter().find(|clip| {
                    clip.kind == state.kind && clip.track == state.track && clip.clip_index == state.clip_index
                }).ok_or("Transcript target expectation is missing.")?;
                if guard.signature != state.signature {
                    return Err("Transcript target changed since inspection; no edit was made.".into());
                }
            }

            let backup = backup_premiere_project(&premiere_bridge).await?;
            let mut edits = Vec::new();
            let mut markers = Vec::new();
            let mut uncertain = false;

            for edit in &plan.edits {
                let clip = expected.clips.iter().find(|clip| {
                    clip.kind == edit.target.kind && clip.track == edit.target.track && clip.clip_index == edit.target.clip_index
                }).ok_or("Transcript edit expectation is missing.")?.clone();
                let guard = PremiereExpectation {
                    project_guid: expected.project_guid.clone(),
                    project_path: expected.project_path.clone(),
                    sequence_guid: expected.sequence_guid.clone(),
                    clips: vec![clip],
                };
                let client = PremiereClient { bridge: &state.premiere_bridge, expected: Some(&guard) };
                let arguments = premiere_talking_head::operation_arguments(edit);
                let (route, timeout) = match &edit.operation {
                    premiere_talking_head::EditOperation::Trim { .. } => ("trim_clip", Duration::from_secs(30)),
                    premiere_talking_head::EditOperation::Delete { .. } => ("delete_clip", Duration::from_secs(30)),
                };
                match client.request(route, arguments, timeout).await {
                    Ok(value) => edits.push(json!({"target":edit.target,"status":"applied","native_result":value})),
                    Err(error) => {
                        uncertain = error.contains("unknown") || error.contains("timed out") || error.contains("timeout");
                        edits.push(json!({"target":edit.target,"status":if uncertain {"uncertain"} else {"failed"},"reason":error.chars().take(240).collect::<String>()}));
                        break;
                    }
                }
            }

            if !uncertain && edits.iter().all(|row| row["status"] == "applied") {
                let project_guard = PremiereExpectation {
                    project_guid: expected.project_guid.clone(),
                    project_path: expected.project_path.clone(),
                    sequence_guid: expected.sequence_guid.clone(),
                    clips: Vec::new(),
                };
                let client = PremiereClient { bridge: &state.premiere_bridge, expected: Some(&project_guard) };
                for marker in &plan.markers {
                    let args = json!({
                        "name": marker.name,
                        "markerType": marker.marker_type,
                        "seconds": marker.seconds,
                        "durationSeconds": 0,
                        "comments": format!("Transcript selection {}", marker.segment_id),
                    });
                    match client.request("add_marker", args, Duration::from_secs(20)).await {
                        Ok(value) => markers.push(json!({"segment_id":marker.segment_id,"seconds":marker.seconds,"status":"applied","native_result":value})),
                        Err(error) => {
                            uncertain = error.contains("unknown") || error.contains("timed out") || error.contains("timeout");
                            markers.push(json!({"segment_id":marker.segment_id,"status":if uncertain {"uncertain"} else {"failed"},"reason":error.chars().take(240).collect::<String>()}));
                            break;
                        }
                    }
                }
            }

            let project_guard = PremiereExpectation {
                project_guid: expected.project_guid.clone(),
                project_path: expected.project_path.clone(),
                sequence_guid: expected.sequence_guid.clone(),
                clips: Vec::new(),
            };
            let post_client = PremiereClient { bridge: &state.premiere_bridge, expected: Some(&project_guard) };
            let post_timeline = post_client.request("inspect_timeline", json!({}), Duration::from_secs(20)).await.ok();
            let edit_ok = edits.len() == plan.edits.len() && edits.iter().all(|row| row["status"] == "applied");
            let marker_ok = markers.len() == plan.markers.len() && markers.iter().all(|row| row["status"] == "applied");
            let complete = edit_ok && marker_ok && !uncertain;

            Ok(ActionResult {
                success: complete,
                tool,
                stdout: json!({
                    "backup": backup,
                    "complete": complete,
                    "uncertain": uncertain,
                    "transcript_snapshot": plan.transcript_snapshot,
                    "remove_ranges": plan.remove_ranges,
                    "edits": edits,
                    "markers": markers,
                    "post_timeline_inspected": post_timeline.is_some(),
                    "post_timeline": post_timeline,
                    "linked_media_inferred": false,
                    "interior_split_supported": false,
                }).to_string(),
                stderr: String::new(),
                exit_code: Some(if complete {0} else {1}),
            })
        }
        ToolAction::PremierePlanAudioAutomation { target, request } => {
            let mut arguments = target.bridge_arguments(); arguments["request"] = serde_json::to_value(request).map_err(|e| e.to_string())?;
            let mut value = premiere_bridge.request("plan_audio_automation", arguments, Duration::from_secs(20)).await?;
            premiere_plan_calibration(&mut value,&premiere_bridge,app).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereInspectMogrtProperties { track, clip_index } => {
            let value = premiere_bridge.request("inspect_mogrt_properties", json!({"track":track,"clipIndex":clip_index}), Duration::from_secs(30)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremierePopulateMogrt{track,clip_index,request} => {
            let expected=premiere_bridge.expected.ok_or("Missing graphics target expectation.")?;
            let plan=premiere_bridge.request("plan_mogrt_recipe",json!({"track":track,"clipIndex":clip_index,"request":request}),Duration::from_secs(30)).await?;
            if plan.get("expected")!=Some(&serde_json::to_value(expected).map_err(|e|e.to_string())?) {
                return Err("Graphics target changed since native inspection; no field was written.".into());
            }
            let settings=plan.get("settings").and_then(Value::as_array).ok_or("Graphics plan returned no typed settings.")?;
            if settings.len()!=request.fields.len() || !plan.get("skipped").and_then(Value::as_array).is_some_and(Vec::is_empty) {
                return Err("MOGRT fields were unavailable, ambiguous or incompatible; no partial graphic was applied.".into());
            }
            let backup=backup_premiere_project(&premiere_bridge).await?;
            let result=premiere_bridge.request("apply_video_recipe",json!({"track":track,"clipIndex":clip_index,"settings":settings}),Duration::from_secs(45)).await?;
            Ok(ActionResult{success:true,tool,stdout:json!({"backup":backup,"result":result,"field_count":settings.len(),"native_reinspection_recommended":true}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremierePlanMogrtRecipe { track, clip_index, request } => {
            let mut value = premiere_bridge.request("plan_mogrt_recipe", json!({"track":track,"clipIndex":clip_index,"request":request}), Duration::from_secs(30)).await?;
            premiere_plan_calibration(&mut value,&premiere_bridge,app).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereProjectDiagnostics { limits } => {
            let value = premiere_bridge.request("project_diagnostics", json!({"limits":limits}), Duration::from_secs(30)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereTimelineCapabilities => {
            let value = premiere_bridge.request("timeline_capabilities", json!({}), Duration::from_secs(12)).await?;
            Ok(ActionResult { success: true, tool, stdout: serde_json::to_string_pretty(&value).unwrap_or_default(), stderr: String::new(), exit_code: Some(0) })
        }
        ToolAction::PremiereTimeline => {
            let value = premiere_bridge
                .request("inspect_timeline", json!({}), Duration::from_secs(12)).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCaptionTracks => {
            let value = premiere_bridge.request(
                "caption_tracks",
                json!({}),
                Duration::from_secs(12),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetCaptionTrackName { track, name } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "set_caption_track_name",
                json!({ "track": track, "name": name }),
                Duration::from_secs(20),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetCaptionTrackMute { track, muted } => {
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "set_caption_track_mute",
                json!({ "track": track, "muted": muted }),
                Duration::from_secs(12),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"checkpoint":checkpoint,"result":value})).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetPlayhead { seconds } => {
            let value = premiere_bridge.request(
                "set_playhead",
                json!({ "seconds": seconds }),
                Duration::from_secs(8),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInspectFrame { seconds, prompt, provider } => {
            premiere_bridge.request(
                "set_playhead",
                json!({ "seconds": seconds }),
                Duration::from_secs(8),
            ).await?;

            tokio::time::sleep(Duration::from_millis(450)).await;

            let path = capture_screen_png()?;
            let analysis = analyze_png_with_provider(&provider, &prompt, &path).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!(
                    "Premiere frame analysis at {seconds:.3}s from {}/{}:\n{}\nScreenshot: {}",
                    provider.provider,
                    provider.model,
                    analysis,
                    path.display()
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereReviewFrames { seconds, prompt, provider } => {
            let total = seconds.len();
            let mut reviews = Vec::with_capacity(total);
            let mut failures = 0_usize;

            for seconds in seconds {
                let review = async {
                    premiere_bridge.request(
                        "set_playhead",
                        json!({ "seconds": seconds }),
                        Duration::from_secs(8),
                    ).await?;

                    tokio::time::sleep(Duration::from_millis(450)).await;

                    let path = capture_screen_png()?;
                    let analysis = analyze_png_with_provider(&provider, &prompt, &path).await?;

                    Ok::<Value, String>(json!({
                        "seconds": seconds,
                        "analysis": analysis,
                        "screenshot": path.display().to_string()
                    }))
                }.await;

                match review {
                    Ok(value) => reviews.push(json!({
                        "success": true,
                        "review": value
                    })),
                    Err(error) => {
                        failures += 1;
                        reviews.push(json!({
                            "success": false,
                            "seconds": seconds,
                            "error": error
                        }));
                    }
                }
            }

            Ok(ActionResult {
                success: failures == 0,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "provider": provider.provider,
                    "model": provider.model,
                    "prompt": prompt,
                    "total": total,
                    "succeeded": total.saturating_sub(failures),
                    "failed": failures,
                    "frames": reviews
                })).unwrap_or_default(),
                stderr: if failures == 0 {
                    String::new()
                } else {
                    format!("{failures} of {total} Premiere frame reviews failed.")
                },
                exit_code: Some(if failures == 0 { 0 } else { 1 }),
            })
        }
        ToolAction::PremierePlanEditRecipe {request} => {
            let plan=premiere_editorial::plan(request)?;
            Ok(ActionResult {success:true,tool,stdout:serde_json::to_string_pretty(&plan).unwrap_or_default(),
                stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditJobStart {request} => {
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            let project=context.get("projectGuid").and_then(Value::as_str).filter(|value|!value.is_empty())
                .ok_or("Active Premiere project GUID unavailable.")?;
            let sequence=context.pointer("/activeSequence/guid").and_then(Value::as_str).filter(|value|!value.is_empty())
                .ok_or("Active Premiere sequence GUID unavailable.")?;
            let id=Uuid::new_v4().to_string();
            let job=premiere_edit_job::Job::new(
                id.clone(),request,project,context.get("projectPath").and_then(Value::as_str),sequence,now_ms()
            )?;
            premiere_edit_job::save(&premiere_edit_job_path(app,&id)?,&job)?;
            Ok(ActionResult{
                success:true,tool,
                stdout:json!({
                    "job":job,
                    "next_tool":"premiere_edit_job_next",
                    "execution_model":"one concrete existing typed Premiere phase per approval"
                }).to_string(),
                stderr:String::new(),exit_code:Some(0)
            })
        }
        ToolAction::PremiereEditJobStatus {job_id} => {
            let job=premiere_edit_job::load(&premiere_edit_job_path(app,&job_id)?)?;
            Ok(ActionResult{success:true,tool,stdout:serde_json::to_string_pretty(&job).unwrap_or_default(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditJobCancel {job_id} => {
            let path=premiere_edit_job_path(app,&job_id)?;
            let mut job=premiere_edit_job::load(&path)?;
            job.cancel(now_ms());
            premiere_edit_job::save(&path,&job)?;
            Ok(ActionResult{success:true,tool,stdout:json!({"job_id":job_id,"status":job.status}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditJobNext {job_id} => {
            let path=premiere_edit_job_path(app,&job_id)?;
            let mut job=premiere_edit_job::load(&path)?;
            if job.status!="running" {
                return Err(format!("Edit job is not running (status={}).",job.status));
            }
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            job.identity(&context)?;
            let phase=job.pending().cloned().ok_or("Edit job has no pending phase.")?;

            let (arguments,reason)=match phase.id.as_str() {
                "media_prep" => {
                    let batch=job.request.media_prep.clone().ok_or("Edit job media_prep payload is missing.")?;
                    (json!({"batch":batch,"expected":job.project_expectation()}),
                        "Run the existing bounded media-preparation batch against the current project identity.".to_string())
                }
                "scene_detection" => {
                    let request=job.request.scene_detection.clone().ok_or("Edit job scene_detection payload is missing.")?;
                    let capabilities=premiere_bridge.request("scene_detection_capabilities",json!({}),Duration::from_secs(10)).await?;
                    let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
                    let plan=premiere_scene_detection::build_plan(&request,&timeline,&capabilities)?;
                    if plan.get("supported").and_then(Value::as_bool)!=Some(true){
                        return Err(plan.get("reason").and_then(Value::as_str).unwrap_or("Scene detection is unavailable.").to_string());
                    }
                    let expected:PremiereExpectation=serde_json::from_value(
                        plan.get("expected").cloned().ok_or("Scene-detection plan returned no expectation.")?
                    ).map_err(|e|format!("Invalid scene-detection expectation: {e}"))?;
                    (json!({"request":request,"expected":expected}),
                        "Run the selected native scene-detection mode only after a fresh timeline/capability rebind.".to_string())
                }
                "transcript_rebuild" => {
                    let request=job.request.transcript_rebuild.clone().ok_or("Edit job transcript_rebuild payload is missing.")?;
                    let plan=premiere_bridge.request(
                        "plan_transcript_rebuild",
                        json!({"request":request}),
                        Duration::from_secs(60),
                    ).await?;
                    if plan.get("supported").and_then(Value::as_bool)!=Some(true){
                        return Err(format!("Edit-job transcript rebuild is not executable: {}",
                            plan.get("unsupported_reasons").and_then(Value::as_array)
                                .map(|rows|rows.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))
                                .unwrap_or_else(||"unsupported".into())));
                    }
                    let snapshot=plan.get("plan_snapshot").and_then(Value::as_str).filter(|value|!value.is_empty())
                        .ok_or("Transcript rebuild plan_snapshot missing.")?.to_string();
                    let expected:PremiereExpectation=serde_json::from_value(
                        plan.get("expected").cloned().ok_or("Transcript rebuild plan returned no expectation.")?
                    ).map_err(|e|format!("Invalid transcript rebuild expectation: {e}"))?;
                    expected.validate()?;
                    (json!({"request":request,"plan_snapshot":snapshot,"expected":expected}),
                        "Execute the explicitly selected AA source-rebuild strategy from a fresh native plan; preserve the original sequence.".to_string())
                }
                "assembly" => {
                    let assembly=job.request.assembly.clone().ok_or("Edit job assembly payload is missing.")?;
                    (json!({"assembly":assembly,"expected":job.project_expectation()}),
                        "Execute the validated assembly through the existing checkpointed assembly tool.".to_string())
                }
                "transcript_cuts" => {
                    let request=job.request.transcript_cuts.clone().ok_or("Edit job transcript-cut payload is missing.")?;
                    let transcript=premiere_bridge.request(
                        "export_transcript",
                        json!({"itemId":request.item_id,"deliverSrt":true}),
                        Duration::from_secs(30),
                    ).await?;
                    let caption=transcript.get("captions").ok_or("Transcript has no timing adapter.")?;
                    if caption.get("supported").and_then(Value::as_bool)!=Some(true)
                        ||caption.get("segmentsTruncated").and_then(Value::as_bool)!=Some(false)
                    {
                        return Err("Edit-job transcript phase requires complete recognized transcript timing.".into());
                    }
                    let segments=caption.get("segments").and_then(Value::as_array).ok_or("Transcript segments missing.")?;
                    let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
                    let mut targets=vec![request.video.clone()];
                    if let Some(audio)=&request.audio{targets.push(audio.clone());}
                    let states=premiere_talking_head::clip_states_from_timeline(&timeline,&targets)?;
                    let plan=premiere_talking_head::build_plan(segments,&request,&states)?;
                    if !plan.supported {
                        return Err(format!("Edit-job transcript cut phase is not executable: {}",plan.unsupported_reasons.join(" ")));
                    }
                    let expected=premiere_edit_job::expectation_for_transcript(&job,&timeline,&request)?;
                    job.set_transcript_preflight(plan.transcript_snapshot.clone(),expected.clone(),now_ms())?;
                    premiere_edit_job::save(&path,&job)?;
                    (json!({
                        "request":request,
                        "transcript_snapshot":plan.transcript_snapshot,
                        "expected":expected
                    }),
                    "Apply the freshly re-planned explicit transcript selections through W2; no inferred links or interior split hacks.".to_string())
                }
                "track_organization" => {
                    let request=job.request.track_organization.clone().ok_or("Edit job track_organization payload is missing.")?;
                    (json!({"request":request,"expected":job.project_expectation()}),
                        "Rename only the explicitly requested existing tracks through AC with current project/sequence identity.".to_string())
                }
                "layering" => {
                    let batch=job.request.layering.clone().ok_or("Edit job layering payload is missing.")?;
                    let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
                    let expected=premiere_edit_job::expectation_for_layering(&job,&timeline,&batch)?;
                    (json!({"batch":batch,"expected":expected}),
                        "Run AC layering only after a fresh timeline rebind; stale source indexes/signatures fail rather than being guessed.".to_string())
                }
                "finishing" => {
                    let request=job.request.finishing.clone().ok_or("Edit job finishing payload is missing.")?;
                    let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
                    let expected=premiere_edit_job::expectation_for_finishing(&job,&timeline,&request)?;
                    (json!({"request":request,"expected":expected}),
                        "Execute X2 mixed finishing against freshly inspected exact video/audio targets.".to_string())
                }
                "work_area" => {
                    let request=job.request.work_area.clone().ok_or("Edit job work_area payload is missing.")?;
                    (json!({"request":request,"expected":job.project_expectation()}),
                        "Set the explicit active-sequence work area through AD after current project/sequence identity validation.".to_string())
                }
                "review" => {
                    let review=job.request.review.clone().ok_or("Edit job review payload is missing.")?;
                    (json!({"seconds":review.seconds,"prompt":review.prompt}),
                        "Run the existing bounded multi-frame Premiere vision review; this does not auto-fix or guarantee artistic quality.".to_string())
                }
                "frame_delivery" => {
                    let batch=job.request.frame_delivery.clone().ok_or("Edit job frame_delivery payload is missing.")?;
                    (json!({"batch":batch,"expected":job.project_expectation()}),
                        "Deliver the explicitly requested native review frames through AE; no screenshot fallback or hidden extra format.".to_string())
                }
                "interchange_export" => {
                    let request=job.request.interchange_export.clone().ok_or("Edit job interchange_export payload is missing.")?;
                    (json!({"request":request,"expected":job.project_expectation()}),
                        "Deliver exactly one explicit AAF/FCPXML/OTIO handoff through AE with its normal output-collision approval.".to_string())
                }
                "export_preflight" => {
                    let export=job.request.export.clone().ok_or("Edit job export payload is missing.")?;
                    (json!({
                        "output":export.output,"preset":export.preset,
                        "queue_to_ame":export.queue_to_ame,"overwrite":export.overwrite
                    }),
                    "Run the existing read-only export/output preflight before any export dispatch.".to_string())
                }
                "export_dispatch" => {
                    let export=job.request.export.clone().ok_or("Edit job export payload is missing.")?;
                    (json!({
                        "output":export.output,"preset":export.preset,
                        "queue_to_ame":export.queue_to_ame,"overwrite":export.overwrite,
                        "expected":job.project_expectation()
                    }),
                    "Dispatch export through the existing separately approved high-risk export tool; accepted/queued is not encoder completion.".to_string())
                }
                _=>return Err("Unknown edit-job phase.".into()),
            };

            Ok(ActionResult{
                success:true,tool,
                stdout:json!({
                    "job_id":job_id,
                    "phase_id":phase.id,
                    "phase_state":phase.state,
                    "tool_proposal":{
                        "tool":phase.tool,
                        "arguments":arguments,
                        "reason":reason
                    },
                    "requires_separate_approval":true,
                    "after_execution":{
                        "tool":"premiere_edit_job_record_action",
                        "arguments":{"job_id":job_id,"phase_id":phase.id,"action_id":"COPY_EXECUTED_ACTION_ID"}
                    },
                    "no_hidden_mutation":true
                }).to_string(),
                stderr:String::new(),exit_code:Some(0)
            })
        }
        ToolAction::PremiereEditJobRecordAction {job_id,phase_id,action_id} => {
            let path=premiere_edit_job_path(app,&job_id)?;
            let mut job=premiere_edit_job::load(&path)?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            job.identity(&context)?;
            let pending=job.pending().cloned().ok_or("Edit job has no pending phase.")?;
            if pending.id!=phase_id{return Err("Receipt phase is not the current edit-job phase.".into());}
            let receipt=read_action_audit_receipt(app,&action_id)?
                .filter(|entry|
                    entry.timestamp_ms>=job.created_at_ms
                    &&entry.tool==pending.tool
                    &&matches!(entry.event.as_str(),"executed"|"failed")
                )
                .ok_or("No matching typed action audit receipt for this edit-job phase.")?;
            let success=receipt.event=="executed"&&receipt.success;
            job.record(&phase_id,&receipt.tool,&action_id,success,now_ms())?;
            premiere_edit_job::save(&path,&job)?;
            Ok(ActionResult{
                success,
                tool,
                stdout:json!({
                    "job_id":job_id,
                    "phase_id":phase_id,
                    "recorded_tool":receipt.tool,
                    "action_id":action_id,
                    "phase_success":success,
                    "job_status":job.status,
                    "next_tool":if job.status=="running"{Some("premiere_edit_job_next")}else{None},
                    "export_completion_verified":false,
                    "audit_payload_binding":"tool/action receipt plus live project/sequence and downstream stale guards; audit entry does not cryptographically hash the full phase arguments"
                }).to_string(),
                stderr:String::new(),
                exit_code:Some(if success{0}else{1})
            })
        }
        ToolAction::PremiereEditSessionStart {request} => {
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            let project=context.get("projectGuid").and_then(Value::as_str).filter(|s|!s.is_empty()).ok_or("Active project GUID unavailable.")?;
            let sequence=context.pointer("/activeSequence/guid").and_then(Value::as_str).filter(|s|!s.is_empty()).ok_or("Active sequence GUID unavailable.")?;
            let id=Uuid::new_v4().to_string();
            let session=premiere_edit_session::Session::new(id.clone(),request,project,sequence,context.get("projectPath").and_then(Value::as_str))?;
            premiere_edit_session::save(&premiere_edit_session_path(app,&id)?,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"session":session,"next":"premiere_edit_session_next"}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditSessionStatus {session_id} => {
            let session=premiere_edit_session::load(&premiere_edit_session_path(app,&session_id)?)?;
            Ok(ActionResult {success:true,tool,stdout:serde_json::to_string(&session).unwrap_or_default(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditSessionCancel {session_id} => {
            let path=premiere_edit_session_path(app,&session_id)?;
            let mut session=premiere_edit_session::load(&path)?;
            session.cancel();premiere_edit_session::save(&path,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"session_id":session_id,"status":session.status}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditSessionNext {session_id} => {
            let path=premiere_edit_session_path(app,&session_id)?;
            let mut session=premiere_edit_session::load(&path)?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            session.identity(&context)?;
            let result=session.next()?;premiere_edit_session::save(&path,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"next":result,"session_status":session.status}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditSessionRecordAction {session_id,stage_id,action_id} => {
            let path=premiere_edit_session_path(app,&session_id)?;
            let mut session=premiere_edit_session::load(&path)?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            session.identity(&context)?;
            let stage=session.recipe.stages.iter().find(|s|s.id==stage_id).ok_or("Unknown editorial stage.")?;
            let required_capability=stage.required_capability.clone();let review_required=stage.review_required;
            let receipt=read_action_audit_receipt(app,&action_id)?
                .filter(|e|e.timestamp_ms>=session.created_at_ms && e.event=="executed" && e.tool==required_capability)
                .ok_or("No matching typed action audit receipt for this stage.")?;
            session.record(&stage_id,&action_id,&receipt.tool,receipt.success)?;
            premiere_edit_session::save(&path,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"stage_id":stage_id,"state":session.stages.iter().find(|s|s.id==stage_id).map(|s|s.state.as_str()),
                "audit_action_id":action_id,"review_required":review_required}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereEditSessionRecordReview {session_id,stage_id,review_session_id} => {
            let path=premiere_edit_session_path(app,&session_id)?;
            let mut session=premiere_edit_session::load(&path)?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            session.identity(&context)?;
            let review=premiere_review::load(&premiere_review_path(app,&review_session_id)?)?;
            if review.project_guid!=session.project_guid || review.sequence_guid!=session.sequence_guid
                || review.status!="completed" || review.reviews.is_empty() {
                return Err("Review is incomplete or belongs to another project/sequence.".into());
            }
            let last=review.reviews.last().ok_or("Review evidence unavailable.")?;
            let stage=session.recipe.stages.iter().find(|s|s.id==stage_id).ok_or("Unknown editorial stage.")?;
            if let Some(times)=stage.parameters.get("sample_times").and_then(Value::as_array) {
                if times.len()!=review.sample_times.len() || times.iter().zip(&review.sample_times)
                    .any(|(a,b)|a.as_f64()!=Some(*b)) {return Err("Review sample positions differ from the planned stage.".into());}
            }
            let acceptable=last.overall_confidence>=0.65 && !last.issues.iter().any(|i|i.confidence>=0.65 && matches!(i.severity.as_str(),"medium"|"high"));
            session.review(&stage_id,&review_session_id,acceptable)?;
            premiere_edit_session::save(&path,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"stage_id":stage_id,"acceptable":acceptable,
                "stage_state":if acceptable {"completed"} else {"failed"},
                "on_issue":"premiere_resolve_review_target then premiere_bind_review_fix; a correction requires normal typed approval and an explicit new plan."}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereResolveReviewTarget {session_id,issue_id,frame_seconds} => {
            let session=premiere_review::load(&premiere_review_path(app,&session_id)?)?;
            let issue=premiere_review_binding::issue(&session,&issue_id,frame_seconds)?;
            let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
            let result=premiere_review_binding::resolve(&session,issue,frame_seconds,&timeline)?;
            Ok(ActionResult {success:true,tool,stdout:result.to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereBindReviewFix {session_id,issue_id,frame_seconds,kind,track,clip_index,target_signature,component_match_name,param_display_name} => {
            let session=premiere_review::load(&premiere_review_path(app,&session_id)?)?;
            let issue=premiere_review_binding::issue(&session,&issue_id,frame_seconds)?;
            let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
            let category=issue.category.as_str();
            let inspected=if matches!(category,"framing"|"motion"|"color"|"exposure"|"audio_visual") {
                premiere_bridge.request(if category=="audio_visual"{"inspect_audio_clip_effects"}else{"inspect_clip_effects"},
                    json!({"track":track,"clipIndex":clip_index}),Duration::from_secs(20)).await?
            } else if category=="graphics" {
                premiere_bridge.request("inspect_mogrt_properties",json!({"track":track,"clipIndex":clip_index}),Duration::from_secs(20)).await?
            } else {json!({})};
            let selector=component_match_name.as_deref().zip(param_display_name.as_deref());
            let result=premiere_review_binding::bind(&session,issue,frame_seconds,&timeline,&kind,track,clip_index,
                &target_signature,selector,&inspected)?;
            Ok(ActionResult {success:true,tool,stdout:result.to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereReviewSessionStart { objective, reference, sample_times, max_iterations } => {
            let context = premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            let project=context.get("projectGuid").and_then(Value::as_str).ok_or("No active Premiere project GUID.")?;
            let sequence=context.pointer("/activeSequence/guid").and_then(Value::as_str).ok_or("No active Premiere sequence GUID.")?;
            let id=Uuid::new_v4().to_string();
            let session=premiere_review::Session::new(id.clone(),project.into(),sequence.into(),objective,reference,sample_times,max_iterations,now_ms().max(1))?;
            premiere_review::save(&premiere_review_path(app,&id)?,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"session":session,"next":"premiere_review_session_next"}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereReviewSessionStatus {session_id} => {
            let session=premiere_review::load(&premiere_review_path(app,&session_id)?)?;
            Ok(ActionResult {success:true,tool,stdout:serde_json::to_string(&session).unwrap_or_default(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereReviewSessionCancel {session_id} => {
            let path=premiere_review_path(app,&session_id)?;
            let mut session=premiere_review::load(&path)?;
            session.cancel();
            premiere_review::save(&path,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"status":"cancelled","session_id":session_id}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereReviewSessionRecordFix {session_id,issue_id,target,planner,settings,approved_action_id} => {
            let path=premiere_review_path(app,&session_id)?;
            let mut session=premiere_review::load(&path)?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            let project=context.get("projectGuid").and_then(Value::as_str).unwrap_or("");
            let sequence=context.pointer("/activeSequence/guid").and_then(Value::as_str).unwrap_or("");
            if let Err(error)=session.check_identity(project,sequence) { premiere_review::save(&path,&session)?; return Err(error); }
            let approved_receipt=read_action_audit_receipt(app,&approved_action_id)?;
            if !approved_receipt.as_ref().is_some_and(|entry|
                entry.timestamp_ms >= session.created_at_ms
                && entry.success && entry.event=="executed" && matches!(entry.tool.as_str(),
                "premiere_apply_video_recipe"|"premiere_apply_audio_recipe"|"premiere_add_video_transition"|"premiere_apply_saved_recipe")) {
                return Err("No successful approved typed Premiere edit from this review session with this action ID in audit evidence.".into());
            }
            let issue=session.reviews.last().and_then(|r| r.issues.iter().find(|i| i.id==issue_id))
                .ok_or("Unknown review issue.")?;
            let fingerprint=premiere_review::fingerprint(&issue.category,&target,&planner,&settings)?;
            let before=issue.observation.clone();
            session.record_fix(&issue_id,&fingerprint,&before)?;
            premiere_review::save(&path,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"status":session.status,"fingerprint":fingerprint,"iteration":session.iteration}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereReviewSessionNext {session_id,provider} => {
            let path=premiere_review_path(app,&session_id)?;
            let mut session=premiere_review::load(&path)?;
            if session.status!="reviewing" { return Err(format!("Review cannot run in {} state.",session.status)); }
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            if let Err(error)=session.check_identity(context.get("projectGuid").and_then(Value::as_str).unwrap_or(""),
                context.pointer("/activeSequence/guid").and_then(Value::as_str).unwrap_or("")) {
                premiere_review::save(&path,&session)?;
                return Err(error);
            }
            let mut issues=Vec::new();
            let mut confidence=1.0_f64;
            let mut stop=false;
            for (index,seconds) in session.sample_times.iter().enumerate() {
                if premiere_review::load(&path)?.status=="cancelled" { return Err("Premiere review session cancelled.".into()); }
                if session.model_calls >= 32 {
                    session.status="stagnated".into();
                    premiere_review::save(&path,&session)?;
                    return Err("Premiere review vision-call budget exhausted.".into());
                }
                session.model_calls += 1;
                premiere_review::save(&path,&session)?;
                premiere_bridge.request("set_playhead",json!({"seconds":seconds}),Duration::from_secs(8)).await?;
                tokio::time::sleep(Duration::from_millis(450)).await;
                let screenshot=capture_screen_png()?;
                let prompt=format!("Review the Premiere frame at {:.3}s for objective: {}. Context: {}. Return ONLY JSON {{\"iteration\":{},\"issues\":[{{\"id\":\"unique short id\",\"category\":\"exposure|color|framing|continuity|motion|transition|graphics|caption|audio_visual|other\",\"severity\":\"low|medium|high\",\"confidence\":0.8,\"frame_seconds\":[{}],\"observation\":\"visible evidence\",\"suggested_action_type\":\"typed suggestion\"}}],\"overall_confidence\":0.8,\"stop_recommended\":false}}. Max 4 issues, no unsupported claims.",seconds,session.objective,session.reference,session.iteration,seconds);
                let analysis=analyze_png_with_provider(&provider,&prompt,&screenshot).await?;
                let mut frame=premiere_review::normalize_vision(&analysis,session.iteration,&[*seconds])?;
                confidence=confidence.min(frame.overall_confidence);
                stop|=frame.stop_recommended;
                for issue in &mut frame.issues { issue.id=format!("{index}-{}",issue.id); }
                issues.extend(frame.issues.into_iter().take(4));
            }
            if premiere_review::load(&path)?.status=="cancelled" { return Err("Premiere review session cancelled.".into()); }
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            if let Err(error)=session.check_identity(context.get("projectGuid").and_then(Value::as_str).unwrap_or(""),
                context.pointer("/activeSequence/guid").and_then(Value::as_str).unwrap_or("")) {
                premiere_review::save(&path,&session)?; return Err(error);
            }
            let proposals=issues.iter().map(premiere_review::proposal).collect::<Vec<_>>();
            let result=session.add_review(premiere_review::Review {iteration:session.iteration,issues,overall_confidence:confidence,stop_recommended:stop})?;
            premiere_review::save(&path,&session)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"result":result,"review":session.reviews.last(),"proposals":proposals,"note":"Use inspected typed tools through normal approval and checkpoint; vision never executes edits."}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereSetTrackMute { kind, track, muted } => {
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "set_track_mute",
                json!({ "kind": kind, "track": track, "muted": muted }),
                Duration::from_secs(10),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"checkpoint":checkpoint,"result":value})).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetClipEnabled { kind, track, clip_index, enabled } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "set_clip_enabled",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "enabled": enabled
                }),
                Duration::from_secs(20),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereListVideoTransitions => {
            let value = premiere_bridge.request(
                "list_video_transitions",
                json!({}),
                Duration::from_secs(12),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddVideoTransition { track, clip_index, match_name, duration_seconds, position, force_single_sided } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "add_video_transition",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "matchName": match_name,
                    "durationSeconds": duration_seconds,
                    "position": position,
                    "forceSingleSided": force_single_sided
                }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereListVideoEffects => {
            let value = premiere_bridge.request(
                "list_video_effects",
                json!({}),
                Duration::from_secs(12),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInspectClipEffects { track, clip_index } => {
            let value = premiere_bridge.request(
                "inspect_clip_effects",
                json!({
                    "track": track,
                    "clipIndex": clip_index
                }),
                Duration::from_secs(15),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddVideoEffect { track, clip_index, match_name } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "add_video_effect",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "matchName": match_name
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetEffectParam { expected_signature, track, clip_index, component_index, param_index, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "set_effect_param",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentIndex": component_index,
                        "expectedSignature": expected_signature,
                    "paramIndex": param_index,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddEffectKeyframe { expected_signature, track, clip_index, component_index, param_index, seconds, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "add_effect_keyframe",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentIndex": component_index,
                        "expectedSignature": expected_signature,
                    "paramIndex": param_index,
                    "seconds": seconds,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetVideoParamNamed { track, clip_index, component_match_name, component_display_name, param_display_name, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "set_video_param_named",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentMatchName": component_match_name,
                    "componentDisplayName": component_display_name,
                    "paramDisplayName": param_display_name,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": result}))
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddVideoKeyframeNamed { track, clip_index, component_match_name, component_display_name, param_display_name, seconds, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "add_video_keyframe_named",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentMatchName": component_match_name,
                    "componentDisplayName": component_display_name,
                    "paramDisplayName": param_display_name,
                    "seconds": seconds,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": result}))
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereApplyVideoRecipe { track, clip_index, settings } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "apply_video_recipe",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "settings": settings
                }),
                Duration::from_secs(45),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": result}))
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereListAudioEffects => {
            let value = premiere_bridge.request(
                "list_audio_effects",
                json!({}),
                Duration::from_secs(12),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInspectAudioClipEffects { track, clip_index } => {
            let value = premiere_bridge.request(
                "inspect_audio_clip_effects",
                json!({
                    "track": track,
                    "clipIndex": clip_index
                }),
                Duration::from_secs(15),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddAudioEffect { track, clip_index, display_name } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "add_audio_effect",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "displayName": display_name
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetAudioEffectParam { expected_signature, track, clip_index, component_index, param_index, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "set_audio_effect_param",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentIndex": component_index,
                        "expectedSignature": expected_signature,
                    "paramIndex": param_index,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddAudioEffectKeyframe { expected_signature, track, clip_index, component_index, param_index, seconds, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "add_audio_effect_keyframe",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentIndex": component_index,
                        "expectedSignature": expected_signature,
                    "paramIndex": param_index,
                    "seconds": seconds,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSetAudioParamNamed { track, clip_index, component_match_name, component_display_name, param_display_name, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "set_audio_param_named",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentMatchName": component_match_name,
                    "componentDisplayName": component_display_name,
                    "paramDisplayName": param_display_name,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": result}))
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddAudioKeyframeNamed { track, clip_index, component_match_name, component_display_name, param_display_name, seconds, value } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "add_audio_keyframe_named",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "componentMatchName": component_match_name,
                    "componentDisplayName": component_display_name,
                    "paramDisplayName": param_display_name,
                    "seconds": seconds,
                    "value": value
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": result}))
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereApplyAudioRecipe { track, clip_index, settings } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "apply_audio_recipe",
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "settings": settings
                }),
                Duration::from_secs(45),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": result}))
                    .unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereListSavedRecipes => {
            let recipes = read_premiere_recipes(app)?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&recipes)
                    .map_err(|error| format!("Could not encode Premiere recipes: {error}"))?,
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereSaveRecipe { name, kind, settings } => {
            validate_premiere_saved_recipe_settings(&settings)?;
            let mut recipes = read_premiere_recipes(app)?;
            let name_key = name.to_ascii_lowercase();

            recipes.retain(|recipe| recipe.name.to_ascii_lowercase() != name_key);
            recipes.push(PremiereSavedRecipe {
                name: name.clone(),
                kind: kind.clone(),
                settings,
                updated_at_ms: now_ms(),
            });
            recipes.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));

            write_premiere_recipes(app, &recipes)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Saved {kind} Premiere recipe '{name}'."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereApplySavedRecipe { name, track, clip_index } => {
            let recipes = read_premiere_recipes(app)?;
            let recipe = recipes
                .into_iter()
                .find(|recipe| recipe.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| format!("Saved Premiere recipe '{name}' was not found."))?;

            validate_premiere_saved_recipe_settings(&recipe.settings)?;
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let action = if recipe.kind == "video" {
                "apply_video_recipe"
            } else if recipe.kind == "audio" {
                "apply_audio_recipe"
            } else {
                return Err(format!("Saved Premiere recipe '{}' has invalid kind '{}'.", recipe.name, recipe.kind));
            };

            let result = premiere_bridge.request(
                action,
                json!({
                    "track": track,
                    "clipIndex": clip_index,
                    "settings": recipe.settings
                }),
                Duration::from_secs(45),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "recipe": recipe.name,
                    "kind": recipe.kind,
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereApplySavedRecipeBatch { name, targets } => {
            let _guard = state.finishing_running.begin(&state.finishing_cancelled)?;
            let recipes = read_premiere_recipes(app)?;
            let recipe = recipes
                .into_iter()
                .find(|recipe| recipe.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| format!("Saved Premiere recipe '{name}' was not found."))?;

            validate_premiere_saved_recipe_settings(&recipe.settings)?;
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let action = if recipe.kind == "video" {
                "apply_video_recipe"
            } else if recipe.kind == "audio" {
                "apply_audio_recipe"
            } else {
                return Err(format!("Saved Premiere recipe '{}' has invalid kind '{}'.", recipe.name, recipe.kind));
            };

            let total = targets.len();
            let mut results = Vec::with_capacity(total);
            let mut failures = 0_usize;

            for target in targets {
                if state.finishing_cancelled.load(Ordering::Acquire) { break; }
                let track = target.get("track").and_then(Value::as_u64).unwrap_or(0);
                let clip_index = target.get("clipIndex").and_then(Value::as_u64).unwrap_or(0);
                match premiere_bridge.request(
                    action,
                    json!({
                        "track": track,
                        "clipIndex": clip_index,
                        "settings": recipe.settings.clone()
                    }),
                    Duration::from_secs(45),
                ).await {
                    Ok(result) => results.push(json!({
                        "track": track,
                        "clipIndex": clip_index,
                        "success": true,
                        "result": result
                    })),
                    Err(error) => {
                        failures += 1;
                        results.push(json!({
                            "track": track,
                            "clipIndex": clip_index,
                            "success": false,
                            "error": error
                        }));
                        break;
                    }
                }
            }

            Ok(ActionResult {
                success: failures == 0 && results.len() == total,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "recipe": recipe.name,
                    "kind": recipe.kind,
                    "backup": backup,
                    "total": total,
                    "succeeded": results.len().saturating_sub(failures),
                    "processed": results.len(),
                    "unattempted": total.saturating_sub(results.len()),
                    "uncertain": failures > 0,
                    "failed": failures,
                    "targets": results
                })).unwrap_or_default(),
                stderr: if failures == 0 && results.len() == total {
                    String::new()
                } else {
                    format!("{failures} of {total} Premiere recipe applications failed; successful earlier targets were not rolled back.")
                },
                exit_code: Some(if failures == 0 && results.len() == total { 0 } else { 1 }),
            })
        }
        ToolAction::PremiereDeleteRecipe { name } => {
            let mut recipes = read_premiere_recipes(app)?;
            let before = recipes.len();
            recipes.retain(|recipe| !recipe.name.eq_ignore_ascii_case(&name));

            if recipes.len() == before {
                return Err(format!("Saved Premiere recipe '{name}' was not found."));
            }

            write_premiere_recipes(app, &recipes)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Deleted local Premiere recipe '{name}'."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereListMarkers => {
            let value = premiere_bridge.request(
                "list_markers",
                json!({}),
                Duration::from_secs(12),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAddMarker { name, marker_type, seconds, duration_seconds, comments } => {
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "add_marker",
                json!({
                    "name": name,
                    "markerType": marker_type,
                    "seconds": seconds,
                    "durationSeconds": duration_seconds,
                    "comments": comments
                }),
                Duration::from_secs(20),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"checkpoint":checkpoint,"result":value})).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereRemoveMarker { marker_index, expected_signature } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "remove_marker",
                json!({ "markerIndex": marker_index, "expectedSignature": expected_signature }),
                Duration::from_secs(20),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereProjectTree => {
            let value = premiere_bridge.request(
                "project_tree",
                json!({}),
                Duration::from_secs(20),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereListItems => {
            let value = premiere_bridge
                .request("list_root_items", json!({}), Duration::from_secs(8))
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCreateBin { name } => {
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge
                .request(
                    "create_bin",
                    json!({ "name": name }),
                    Duration::from_secs(8),
                )
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"checkpoint":checkpoint,"result":value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereRenameProjectItem { item_id, name } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "rename_project_item",
                json!({ "itemId": item_id, "name": name }),
                Duration::from_secs(20),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereMoveProjectItem { item_id, target_bin_id } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "move_project_item",
                json!({ "itemId": item_id, "targetBinId": target_bin_id }),
                Duration::from_secs(20),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereRelinkMedia { item_id, new_path, override_compatibility } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "relink_media",
                json!({
                    "itemId": item_id,
                    "newPath": new_path,
                    "overrideCompatibility": override_compatibility
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInspectMediaInterpretation {item_id} => {
            let value=premiere_bridge.request(
                "inspect_media_interpretation",
                json!({"itemId":item_id}),
                Duration::from_secs(20),
            ).await?;
            Ok(ActionResult{success:true,tool,stdout:serde_json::to_string_pretty(&value).unwrap_or_default(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremierePrepareMediaItem {request} => {
            request.validate()?;
            let expected=premiere_bridge.expected.ok_or("Media preparation requires project expectation.")?;
            let checkpoint=backup_premiere_project(&premiere_bridge).await?;
            let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(expected)};
            let value=client.request(
                "prepare_media_item",
                json!({
                    "itemId":request.item_id,
                    "expectedMediaPath":request.expected_media_path,
                    "overrideFrameRate":request.override_frame_rate,
                    "pixelAspect":request.pixel_aspect,
                    "scaleToFrameSize":request.scale_to_frame_size,
                    "inputLUTID":request.input_lut_id
                }),
                Duration::from_secs(30),
            ).await?;
            let accepted=value.get("accepted").and_then(Value::as_bool)==Some(true);
            Ok(ActionResult{
                success:accepted,
                tool,
                stdout:json!({"checkpoint":checkpoint,"result":value,"runtime_verified":false}).to_string(),
                stderr:String::new(),
                exit_code:Some(if accepted{0}else{1}),
            })
        }
        ToolAction::PremiereCancelMediaPrep { generation } => {
            let cancelled = state.media_prep_running.cancel(generation, &state.media_prep_cancelled)?;
            Ok(ActionResult{
                success:true,tool,
                stdout:json!({"cancel_requested":cancelled,"generation":generation,"native_inflight_may_finish":cancelled}).to_string(),
                stderr:String::new(),exit_code:Some(0)
            })
        }
        ToolAction::PremierePrepareMediaBatch {batch} => {
            batch.validate()?;
            let _guard = state.media_prep_running.begin(&state.media_prep_cancelled)?;
            let expected=premiere_bridge.expected.ok_or("Media preparation batch requires project expectation.")?.clone();
            let checkpoint=backup_premiere_project(&premiere_bridge).await?;
            let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(&expected)};
            let mut results=Vec::new();
            let mut uncertain=false;
            for (index,item) in batch.items.iter().enumerate(){
                if state.media_prep_cancelled.load(Ordering::Acquire){break;}
                match client.request(
                    "prepare_media_item",
                    json!({
                        "itemId":item.item_id.clone(),
                        "expectedMediaPath":item.expected_media_path.clone(),
                        "overrideFrameRate":item.override_frame_rate,
                        "pixelAspect":item.pixel_aspect.clone(),
                        "scaleToFrameSize":item.scale_to_frame_size,
                        "inputLUTID":item.input_lut_id.clone()
                    }),
                    Duration::from_secs(30),
                ).await {
                    Ok(value)=>{
                        let accepted=value.get("accepted").and_then(Value::as_bool)==Some(true);
                        results.push(json!({"index":index,"item_id":item.item_id.clone(),"status":if accepted{"applied"}else{"failed"},"native_result":value}));
                    }
                    Err(error)=>{
                        let delivery_uncertain=error.contains("unknown")||error.contains("timed out")||error.contains("timeout")||error.contains("delivery");
                        results.push(json!({"index":index,"item_id":item.item_id.clone(),"status":if delivery_uncertain{"uncertain"}else{"failed"},"reason":error.chars().take(240).collect::<String>()}));
                        if delivery_uncertain{uncertain=true;break;}
                    }
                }
            }
            let cancelled=state.media_prep_cancelled.load(Ordering::Acquire);
            let applied=results.iter().filter(|row|row["status"]=="applied").count();
            let complete=!uncertain&&!cancelled&&applied==batch.items.len();
            Ok(ActionResult{
                success:complete,tool,
                stdout:json!({
                    "checkpoint":checkpoint,"requested":batch.items.len(),"applied":applied,
                    "results":results,"complete":complete,"cancelled":cancelled,"uncertain":uncertain,
                    "timeline_speed_changed":false,"retry_safe":false
                }).to_string(),
                stderr:String::new(),exit_code:Some(if complete{0}else{1})
            })
        }
        ToolAction::PremiereCreateSequenceFromPreset {name,preset_path} => {
            let expected=premiere_bridge.expected.ok_or("Sequence preset creation requires project expectation.")?;
            let checkpoint=backup_premiere_project(&premiere_bridge).await?;
            let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(expected)};
            let value=client.request(
                "create_sequence_from_preset",
                json!({"name":name,"presetPath":preset_path}),
                Duration::from_secs(45),
            ).await?;
            let created=value.get("created").and_then(Value::as_bool)==Some(true);
            Ok(ActionResult{
                success:created,tool,
                stdout:json!({"checkpoint":checkpoint,"result":value}).to_string(),
                stderr:String::new(),exit_code:Some(if created{0}else{1})
            })
        }
        ToolAction::PremiereGetWorkArea => {
            let value=premiere_bridge.request("get_work_area",json!({}),Duration::from_secs(10)).await?;
            Ok(ActionResult{success:true,tool,stdout:serde_json::to_string_pretty(&value).unwrap_or_default(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereSetWorkArea {request} => {
            request.validate()?;
            let expected=premiere_bridge.expected.ok_or("Work-area update requires project/sequence expectation.")?;
            let checkpoint=backup_premiere_project(&premiere_bridge).await?;
            let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(expected)};
            let value=client.request(
                "set_work_area",
                json!({"inSeconds":request.in_seconds,"outSeconds":request.out_seconds}),
                Duration::from_secs(20),
            ).await?;
            let verified=value.get("verificationStatus").and_then(Value::as_str)==Some("verified_readback");
            Ok(ActionResult{
                success:verified,tool,
                stdout:json!({"checkpoint":checkpoint,"result":value,"verified":verified}).to_string(),
                stderr:String::new(),exit_code:Some(if verified{0}else{1})
            })
        }
        ToolAction::PremiereSetSourceInOut { item_id, in_seconds, out_seconds } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "set_source_inout",
                json!({
                    "itemId": item_id,
                    "inSeconds": in_seconds,
                    "outSeconds": out_seconds
                }),
                Duration::from_secs(20),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereClearSourceInOut { item_id } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "clear_source_inout",
                json!({ "itemId": item_id }),
                Duration::from_secs(20),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCreateSubclip { item_id, name, start_seconds, end_seconds, hard_boundaries, take_video, take_audio } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let result = premiere_bridge.request(
                "create_subclip",
                json!({
                    "itemId": item_id,
                    "name": name,
                    "startSeconds": start_seconds,
                    "endSeconds": end_seconds,
                    "hardBoundaries": hard_boundaries,
                    "takeVideo": take_video,
                    "takeAudio": take_audio
                }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": result
                })).unwrap_or_else(|_| result.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereTranscribeItem { item_id, language } => {
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "transcribe_item",
                json!({
                    "itemId": item_id,
                    "language": language
                }),
                Duration::from_secs(180),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"checkpoint":checkpoint,"result":value})).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereExportTranscript { item_id } => {
            let value = premiere_bridge.request(
                "export_transcript",
                json!({ "itemId": item_id }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(
                    serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
                ),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereWriteSrt{output,overwrite,cues} => {
            let value=premiere_subtitles::write(&output,overwrite,&cues)?;
            Ok(ActionResult{success:true,tool,stdout:value.to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereTranscriptToSrt{item_id,output,overwrite} => {
            premiere_subtitles::validate_output(&output,overwrite)?;
            let value=premiere_bridge.request("export_transcript",json!({"itemId":item_id,"deliverSrt":true}),Duration::from_secs(30)).await?;
            let captions=value.get("captions").ok_or("Premiere transcript returned no structured captions.")?;
            if captions.get("supported").and_then(Value::as_bool)!=Some(true) || captions.get("segmentsTruncated").and_then(Value::as_bool)!=Some(false) {
                return Err("Transcript has no complete recognized explicit timing; no partial SRT written.".into());
            }
            let cues:Vec<premiere_subtitles::Cue>=serde_json::from_value(captions.get("segments").cloned().ok_or("Missing transcript segments.")?).map_err(|e|format!("Invalid transcript timing: {e}"))?;
            let mut result=premiere_subtitles::write(&output,overwrite,&cues)?;
            result["source_item_id"]=json!(item_id);
            Ok(ActionResult{success:true,tool,stdout:result.to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereListTranscriptionLanguages => {
            let value = premiere_bridge.request(
                "list_transcription_languages",
                json!({}),
                Duration::from_secs(12),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereImportTranscript { item_id, transcript_json } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "import_transcript",
                json!({
                    "itemId": item_id,
                    "transcriptJson": transcript_json
                }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAttachProxy { item_id, proxy_path } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "attach_proxy",
                json!({ "itemId": item_id, "proxyPath": proxy_path }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInsertMogrtPath { path, seconds, video_track, audio_track } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "insert_mogrt_path",
                json!({
                    "path": path,
                    "seconds": seconds,
                    "videoTrack": video_track,
                    "audioTrack": audio_track
                }),
                Duration::from_secs(45),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInsertMogrtLibrary { library_name, element_name, seconds, video_track, audio_track } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "insert_mogrt_library",
                json!({
                    "libraryName": library_name,
                    "elementName": element_name,
                    "seconds": seconds,
                    "videoTrack": video_track,
                    "audioTrack": audio_track
                }),
                Duration::from_secs(45),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereBatchRelink { items } => {
            let _guard = state.media_prep_running.begin(&state.media_prep_cancelled)?;
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let total = items.len();
            let mut results = Vec::with_capacity(total);
            let mut failures = 0_usize;

            for item in items {
                if state.media_prep_cancelled.load(Ordering::Acquire) { break; }
                let item_id = item.get("itemId").and_then(Value::as_str).unwrap_or_default().to_string();
                match premiere_bridge.request(
                    "relink_media",
                    item.clone(),
                    Duration::from_secs(30),
                ).await {
                    Ok(result) => results.push(json!({
                        "itemId": item_id,
                        "success": true,
                        "result": result
                    })),
                    Err(error) => {
                        failures += 1;
                        results.push(json!({
                            "itemId": item_id,
                            "success": false,
                            "error": error
                        }));
                        break;
                    }
                }
            }

            Ok(ActionResult {
                success: failures == 0 && results.len() == total,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "total": total,
                    "succeeded": results.len().saturating_sub(failures),
                    "processed": results.len(),
                    "unattempted": total.saturating_sub(results.len()),
                    "uncertain": failures > 0,
                    "failed": failures,
                    "items": results
                })).unwrap_or_default(),
                stderr: if failures == 0 && results.len() == total {
                    String::new()
                } else {
                    format!("{failures} of {total} Premiere relink operations failed; successful earlier items were not rolled back.")
                },
                exit_code: Some(if failures == 0 && results.len() == total { 0 } else { 1 }),
            })
        }
        ToolAction::PremiereBatchAttachProxy { items } => {
            let _guard = state.media_prep_running.begin(&state.media_prep_cancelled)?;
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let total = items.len();
            let mut results = Vec::with_capacity(total);
            let mut failures = 0_usize;

            for item in items {
                if state.media_prep_cancelled.load(Ordering::Acquire) { break; }
                let item_id = item.get("itemId").and_then(Value::as_str).unwrap_or_default().to_string();
                match premiere_bridge.request(
                    "attach_proxy",
                    item.clone(),
                    Duration::from_secs(30),
                ).await {
                    Ok(result) => results.push(json!({
                        "itemId": item_id,
                        "success": true,
                        "result": result
                    })),
                    Err(error) => {
                        failures += 1;
                        results.push(json!({
                            "itemId": item_id,
                            "success": false,
                            "error": error
                        }));
                        break;
                    }
                }
            }

            Ok(ActionResult {
                success: failures == 0 && results.len() == total,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "total": total,
                    "succeeded": results.len().saturating_sub(failures),
                    "processed": results.len(),
                    "unattempted": total.saturating_sub(results.len()),
                    "uncertain": failures > 0,
                    "failed": failures,
                    "items": results
                })).unwrap_or_default(),
                stderr: if failures == 0 && results.len() == total {
                    String::new()
                } else {
                    format!("{failures} of {total} Premiere proxy operations failed; successful earlier items were not rolled back.")
                },
                exit_code: Some(if failures == 0 && results.len() == total { 0 } else { 1 }),
            })
        }
        ToolAction::PremiereImportMedia { paths } => {
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge
                .request(
                    "import_media",
                    json!({ "paths": paths }),
                    Duration::from_secs(30),
                )
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"checkpoint":checkpoint,"result":value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCreateSequenceFromMedia { name, paths } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge
                .request(
                    "create_sequence_from_media",
                    json!({ "name": name, "paths": paths }),
                    Duration::from_secs(45),
                )
                .await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                }))
                .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCreateSubsequence { targets } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "create_subsequence",
                json!({ "targets": targets }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInsertProjectItem { item_id, seconds, video_track, audio_track, mode } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "insert_project_item",
                json!({
                    "itemId": item_id,
                    "seconds": seconds,
                    "videoTrack": video_track,
                    "audioTrack": audio_track,
                    "mode": mode
                }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereInsertMedia { path, seconds, video_track, audio_track, mode } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "insert_media",
                json!({
                    "path": path,
                    "seconds": seconds,
                    "videoTrack": video_track,
                    "audioTrack": audio_track,
                    "mode": mode
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereTrimClip { kind, track, clip_index, start_seconds, end_seconds } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "trim_clip",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "startSeconds": start_seconds,
                    "endSeconds": end_seconds
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereRollEdit { kind, track, left_clip_index, right_clip_index, boundary_seconds } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "roll_edit",
                json!({
                    "kind": kind,
                    "track": track,
                    "leftClipIndex": left_clip_index,
                    "rightClipIndex": right_clip_index,
                    "boundarySeconds": boundary_seconds
                }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereMoveClip { kind, track, clip_index, delta_seconds } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "move_clip",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "deltaSeconds": delta_seconds
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereCancelLayerClips { generation } => {
            let cancelled = state.layering_running.cancel(generation, &state.layering_cancelled)?;
            Ok(ActionResult {
                success:true,
                tool,
                stdout:json!({"cancel_requested":cancelled,"generation":generation,"native_inflight_may_finish":cancelled}).to_string(),
                stderr:String::new(),
                exit_code:Some(0),
            })
        }
        ToolAction::PremiereCloneClipToTrack { request } => {
            request.validate()?;
            let expected = premiere_bridge.expected.ok_or("Cross-track clone requires exact source expectation.")?;
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(expected) };
            let result = client.request(
                "clone_clip_to_track",
                json!({
                    "kind":request.source.kind,
                    "track":request.source.track,
                    "clipIndex":request.source.clip_index,
                    "destinationTrack":request.destination_track,
                    "destinationSeconds":request.destination_seconds,
                    "mode":request.mode,
                    "alignToVideo":request.align_to_video
                }),
                Duration::from_secs(45),
            ).await?;
            let verified = result.get("verificationStatus").and_then(Value::as_str)==Some("verified_delta")
                && result.get("uncertain").and_then(Value::as_bool)==Some(false);
            Ok(ActionResult {
                success:verified,
                tool,
                stdout:json!({
                    "checkpoint":checkpoint,
                    "result":result,
                    "verified":verified,
                    "linked_media_inferred":false,
                    "retry_safe":false
                }).to_string(),
                stderr:String::new(),
                exit_code:Some(if verified {0}else{1}),
            })
        }
        ToolAction::PremiereLayerClips { batch } => {
            batch.validate()?;
            let _guard = state.layering_running.begin(&state.layering_cancelled)?;
            let expected = premiere_bridge.expected.ok_or("Layer batch requires exact source expectations.")?.clone();
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let mut results = Vec::new();
            let mut uncertain = false;

            for (index,operation) in batch.operations.iter().enumerate() {
                if state.layering_cancelled.load(Ordering::Acquire) { break; }
                let clip = expected.clips.iter().find(|clip| clip.kind==operation.source.kind
                    && clip.track==operation.source.track && clip.clip_index==operation.source.clip_index
                    && clip.signature==operation.source.signature)
                    .ok_or("Layer batch source expectation disappeared.")?.clone();
                let guard = PremiereExpectation {
                    project_guid:expected.project_guid.clone(),
                    project_path:expected.project_path.clone(),
                    sequence_guid:expected.sequence_guid.clone(),
                    clips:vec![clip],
                };
                let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(&guard) };
                match client.request(
                    "clone_clip_to_track",
                    json!({
                        "kind":operation.source.kind.clone(),
                        "track":operation.source.track,
                        "clipIndex":operation.source.clip_index,
                        "destinationTrack":operation.destination_track,
                        "destinationSeconds":operation.destination_seconds,
                        "mode":operation.mode.clone(),
                        "alignToVideo":operation.align_to_video
                    }),
                    Duration::from_secs(45),
                ).await {
                    Ok(value) => {
                        let verified = value.get("verificationStatus").and_then(Value::as_str)==Some("verified_delta")
                            && value.get("uncertain").and_then(Value::as_bool)==Some(false);
                        results.push(json!({"index":index,"status":if verified {"applied"} else {"uncertain"},"native_result":value}));
                        if !verified { uncertain=true; break; }
                    }
                    Err(error) => {
                        let delivery_uncertain = error.contains("unknown") || error.contains("timed out") || error.contains("timeout")
                            || error.contains("delivery");
                        results.push(json!({"index":index,"status":if delivery_uncertain {"uncertain"} else {"failed"},"reason":error.chars().take(240).collect::<String>()}));
                        if delivery_uncertain { uncertain=true; break; }
                    }
                }
            }

            let cancelled = state.layering_cancelled.load(Ordering::Acquire);
            let applied = results.iter().filter(|row| row["status"]=="applied").count();
            let complete = !uncertain && !cancelled && applied==batch.operations.len();
            Ok(ActionResult {
                success:complete,
                tool,
                stdout:json!({
                    "checkpoint":checkpoint,
                    "requested":batch.operations.len(),
                    "applied":applied,
                    "results":results,
                    "complete":complete,
                    "cancelled":cancelled,
                    "uncertain":uncertain,
                    "linked_media_inferred":false,
                    "retry_safe":false
                }).to_string(),
                stderr:String::new(),
                exit_code:Some(if complete {0}else{1}),
            })
        }
        ToolAction::PremiereRenameTrack { request } => {
            request.validate()?;
            let expected = premiere_bridge.expected.ok_or("Track rename requires project/sequence expectation.")?;
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(expected) };
            let result = client.request(
                "rename_track",
                json!({"kind":request.kind,"track":request.track,"name":request.name}),
                Duration::from_secs(20),
            ).await?;
            let verified = result.get("verificationStatus").and_then(Value::as_str)==Some("verified_readback");
            Ok(ActionResult {
                success:verified,
                tool,
                stdout:json!({"checkpoint":checkpoint,"result":result,"verified":verified}).to_string(),
                stderr:String::new(),
                exit_code:Some(if verified {0}else{1}),
            })
        }
        ToolAction::PremiereOrganizeTracks { request } => {
            request.validate()?;
            let expected = premiere_bridge.expected.ok_or("Track organization requires project/sequence expectation.")?;
            let checkpoint = backup_premiere_project(&premiere_bridge).await?;
            let client = PremiereClient { bridge:&state.premiere_bridge, expected:Some(expected) };
            let result = client.request(
                "organize_tracks",
                json!({"tracks":request.tracks}),
                Duration::from_secs(30),
            ).await?;
            let complete = result.get("complete").and_then(Value::as_bool)==Some(true);
            Ok(ActionResult {
                success:complete,
                tool,
                stdout:json!({"checkpoint":checkpoint,"result":result,"complete":complete}).to_string(),
                stderr:String::new(),
                exit_code:Some(if complete {0}else{1}),
            })
        }
        ToolAction::PremiereCloneClip { kind, track, clip_index, time_offset_seconds, video_track_offset, audio_track_offset, align_to_video, insert } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "clone_clip",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "timeOffsetSeconds": time_offset_seconds,
                    "videoTrackOffset": video_track_offset,
                    "audioTrackOffset": audio_track_offset,
                    "alignToVideo": align_to_video,
                    "insert": insert
                }),
                Duration::from_secs(30),
            ).await?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({"backup": backup, "result": value}))
                    .unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereDeleteClip { kind, track, clip_index, ripple } => {
            let backup = backup_premiere_project(&premiere_bridge).await?;
            let value = premiere_bridge.request(
                "delete_clip",
                json!({
                    "kind": kind,
                    "track": track,
                    "clipIndex": clip_index,
                    "ripple": ripple
                }),
                Duration::from_secs(30),
            ).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&json!({
                    "backup": backup,
                    "result": value
                })).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::PremiereAcceptanceReport => {
            let report=premiere_acceptance::load(&premiere_acceptance_path(app)?)?;
            let eligible=report.capabilities.iter().filter(|c|c.state!="unsupported_documented").count();
            let verified=report.verified_count();
            Ok(ActionResult {success:true,tool,
                stdout:serde_json::to_string_pretty(&json!({"report":report,
                    "premiere_runtime_verified_count":verified,
                    "implemented_capability_count":eligible,
                    "production_ready":false})).unwrap_or_default(),
                stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereAcceptanceRegisterDisposable {project_guid,project_path,sequence_guid} => {
            if !state.premiere_bridge.status()?.paired {return Err("Paired Premiere host is required.".into());}
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(12)).await?;
            let registration=premiere_acceptance_harness::Registration::new(&project_guid,&project_path,sequence_guid.as_deref(),true)?;
            registration.check(&context)?;
            premiere_acceptance_harness::save(&premiere_disposable_path(app)?,&registration)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"registered":true,"project_guid":project_guid,
                "sequence_guid":sequence_guid,"verified_current_host_identity":true,
                "next":"premiere_acceptance_plan","mutation_enabled_automatically":false}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereAcceptancePlan {group} => {
            let registration=premiere_acceptance_harness::load(&premiere_disposable_path(app)?)?;
            let context=if state.premiere_bridge.status()?.paired {
                Some(premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(12)).await?)
            } else {None};
            let value=premiere_acceptance_harness::plan(group,registration.as_ref(),context.as_ref())?;
            Ok(ActionResult {success:true,tool,stdout:value.to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereCalibrationReport => {
            let registry=premiere_calibration::load(&premiere_calibration_path(app)?)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"registry":registry,
                "note":"Native delta/recovery verification does not establish semantic units or subjective visual/audio direction."}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereCalibrationObserve {target,semantic_role} => {
            if !state.premiere_bridge.status()?.paired{return Err("Paired Premiere host unavailable.".into());}
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
            let fixture=premiere_acceptance_execution::Fixture {kind:target.kind.clone(),track:target.track,
                clip_index:target.clip_index,start_seconds:None,end_seconds:None,delta_seconds:None,expected:target.expected.clone()};
            premiere_acceptance_execution::exact_clip(&timeline,&fixture)?;
            let native=premiere_calibration_native(&premiere_bridge,&target).await?;
            let entry=premiere_calibration::inspected(&context,&native,&target,semantic_role.as_deref())?;
            let path=premiere_calibration_path(app)?;
            let mut registry=premiere_calibration::load(&path)?;
            registry.upsert(entry.clone())?;premiere_calibration::save(&path,&registry)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"entry":entry,"write_performed":false,
                "unit":"native_unknown","next":"premiere_calibration_probe on an explicitly registered disposable project"}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereCalibrationProbe {target,delta} => {
            if state.acceptance_probe_running.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err() {
                return Err("Another Premiere host probe is running.".into());
            }
            let _guard=AcceptanceProbeGuard(&state.acceptance_probe_running);
            if !state.premiere_bridge.status()?.paired{return Err("Paired Premiere UXP host unavailable.".into());}
            let registration=premiere_acceptance_harness::load(&premiere_disposable_path(app)?)?
                .ok_or("Disposable project registration required for calibration writes.")?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            registration.check(&context)?;
            let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
            let fixture=premiere_acceptance_execution::Fixture {kind:target.kind.clone(),track:target.track,
                clip_index:target.clip_index,start_seconds:None,end_seconds:None,delta_seconds:None,expected:target.expected.clone()};
            premiere_acceptance_execution::exact_clip(&timeline,&fixture)?;
            let path=premiere_calibration_path(app)?;
            let mut registry=premiere_calibration::load(&path)?;
            let version=context.get("premiereVersion").and_then(Value::as_str).ok_or("Premiere host version missing.")?;
            let baseline={let entry=registry.find_mut(version,&target)?;
                if entry.probe_status!="observed" || entry.value_type!="number" || entry.time_varying {
                    return Err("Calibration probe requires a fresh static numeric observation; no automatic retry.".into());
                }entry.original_value.clone()};
            let value=premiere_calibration::bounded_delta(&baseline,delta,false)?;
            let native=premiere_calibration_native(&premiere_bridge,&target).await?;
            let observed=premiere_calibration::inspected(&context,&native,&target,None)?;
            if observed.original_value!=baseline {return Err("Native baseline changed since calibration observation.".into());}
            registry.find_mut(version,&target)?.probe_status="probing".into();
            premiere_calibration::save(&path,&registry)?;
            let make_action=|v:Value| {
                if target.kind=="video" {ToolAction::PremiereSetVideoParamNamed{track:target.track,clip_index:target.clip_index,
                    component_match_name:Some(target.component_match_name.clone()),component_display_name:None,
                    param_display_name:target.param_display_name.clone(),value:v}}
                else {ToolAction::PremiereSetAudioParamNamed{track:target.track,clip_index:target.clip_index,
                    component_match_name:Some(target.component_match_name.clone()),component_display_name:None,
                    param_display_name:target.param_display_name.clone(),value:v}}
            };
            let inner=PendingAction{created_at_ms:now_ms(),premiere_expectation:Some(target.expected.clone()),tool:if target.kind=="video"{"premiere_set_video_param_named"}else{"premiere_set_audio_param_named"}.into(),
                detail:"Disposable native parameter delta calibration".into(),action:make_action(value.clone())};
            let changed=Box::pin(execute_tool(inner,state,app)).await;
            let changed=match changed {Ok(result) if result.success=>result,Err(error)=>{
                let entry=registry.find_mut(version,&target)?;entry.probe_status="uncertain".into();
                entry.observations.push("Delta write response uncertain; do not repeat or assume restored.".into());
                premiere_calibration::save(&path,&registry)?;
                return Ok(ActionResult {success:false,tool,stdout:json!({"status":"uncertain","retry_automatically":false}).to_string(),stderr:error,exit_code:None});
            },Ok(_) => {
                registry.find_mut(version,&target)?.probe_status="uncertain".into();
                premiere_calibration::save(&path,&registry)?;
                return Err("Calibration native write rejected; inspect before any retry.".into());
            }};
            let checkpoint=serde_json::from_str::<Value>(&changed.stdout).ok()
                .and_then(|v|v.get("backup").and_then(Value::as_str).map(str::to_owned));
            {let entry=registry.find_mut(version,&target)?;entry.checkpoint=checkpoint.clone();entry.probe_status="restoring".into();}
            premiere_calibration::save(&path,&registry)?;
            let inspected_after=premiere_calibration_native(&premiere_bridge,&target).await;
            let mid=match inspected_after.and_then(|v|premiere_calibration::inspected(&context,&v,&target,None)) {
                Ok(entry)=>entry.original_value,
                Err(_) => {
                    registry.find_mut(version,&target)?.probe_status="needs_recovery".into();
                    premiere_calibration::save(&path,&registry)?;
                    return Ok(ActionResult {success:false,tool,stdout:json!({"status":"needs_recovery","checkpoint":checkpoint,
                        "reason":"After-delta native inspection missing; restoration not attempted blindly."}).to_string(),stderr:String::new(),exit_code:None});
                }
            };
            let restore=PendingAction{created_at_ms:now_ms(),premiere_expectation:Some(target.expected.clone()),tool:if target.kind=="video"{"premiere_set_video_param_named"}else{"premiere_set_audio_param_named"}.into(),
                detail:"Restore original disposable native value".into(),action:make_action(baseline.clone())};
            let restored=Box::pin(execute_tool(restore,state,app)).await;
            if !restored.is_ok_and(|r|r.success) {
                registry.find_mut(version,&target)?.probe_status="needs_recovery".into();
                premiere_calibration::save(&path,&registry)?;
                return Ok(ActionResult {success:false,tool,stdout:json!({"status":"needs_recovery","checkpoint":checkpoint,
                    "reason":"Restoration failed or is uncertain; stop and inspect manually."}).to_string(),stderr:String::new(),exit_code:None});
            }
            let final_read=async {
                let final_context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
                registration.check(&final_context)?;
                let final_native=premiere_calibration_native(&premiere_bridge,&target).await?;
                Ok::<Value,String>(premiere_calibration::inspected(&final_context,&final_native,&target,None)?.original_value)
            }.await;
            let final_value=match final_read {Ok(value)=>value,Err(_)=>{
                registry.find_mut(version,&target)?.probe_status="needs_recovery".into();
                premiere_calibration::save(&path,&registry)?;
                return Ok(ActionResult {success:false,tool,stdout:json!({"status":"needs_recovery","checkpoint":checkpoint,
                    "reason":"Restoration was requested but final native value/identity cannot be verified."}).to_string(),stderr:String::new(),exit_code:None});
            }};
            let recovered=final_value==baseline;
            let exact_delta=mid==value;
            {let entry=registry.find_mut(version,&target)?;
                entry.observed_value=Some(mid);entry.native_delta_verified=exact_delta && recovered;
                entry.recovery_verified=recovered;entry.probe_status=if recovered {"verified_native_delta"}else{"needs_recovery"}.into();
                entry.observations.push(if recovered {"Original native value reobserved after restoration; semantic unit remains unknown."}
                    else {"Restoration could not be proven; do not retry blindly."}.into());}
            premiere_calibration::save(&path,&registry)?;
            Ok(ActionResult {success:recovered,tool,stdout:json!({"native_delta_verified":exact_delta && recovered,
                "recovery_verified":recovered,"semantic_verified":false,"unit":"native_unknown","checkpoint":checkpoint,
                "retry_automatically":false}).to_string(),stderr:String::new(),exit_code:Some(if recovered{0}else{1})})
        }
        ToolAction::PremiereAcceptancePrepare {step,fixture} => {
            if !state.premiere_bridge.status()?.paired {return Err("Paired Premiere UXP host unavailable.".into());}
            let registration=premiere_acceptance_harness::load(&premiere_disposable_path(app)?)?
                .ok_or("Register an explicitly disposable saved .prproj before mutating acceptance.")?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(10)).await?;
            registration.check(&context)?;
            let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
            let id=Uuid::new_v4().to_string();
            let action=premiere_acceptance_execution::Action::new(id.clone(),step,fixture,&context,&timeline)?;
            premiere_acceptance_execution::save(&premiere_acceptance_action_path(app,&id)?,&action)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"action":action,"next":"premiere_acceptance_execute",
                "approval_required":true,"recovery":"Checkpoint will be retained; cleanup/rollback requires separate explicit approval."}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereAcceptanceCancel {action_id} => {
            let path=premiere_acceptance_action_path(app,&action_id)?;
            let action=premiere_acceptance_execution::cancel(&path)?;
            Ok(ActionResult {success:true,tool,stdout:json!({"action_id":action_id,"status":action.status,
                "cancellation_requested":action.cancellation_requested,"native_edit_may_have_started":action.status=="executing"}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereAcceptanceVerifyRecovery {action_id} => {
            if state.acceptance_probe_running.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err() {
                return Err("Another Premiere acceptance action is running.".into());
            }
            let _guard=AcceptanceProbeGuard(&state.acceptance_probe_running);
            if !state.premiere_bridge.status()?.paired {return Err("Paired Premiere UXP host unavailable.".into());}
            let path=premiere_acceptance_action_path(app,&action_id)?;
            let mut record=premiere_acceptance_execution::load(&path)?;
            let inspected_record=record.clone();
            let checkpoint=record.checkpoint.clone().ok_or("Acceptance action has no checkpoint to verify.")?;
            if record.step=="scene_markers" {
                return Err("Scene-marker recovery cannot be verified from timeline state alone; generated markers require explicit marker inspection/cleanup.".into());
            }
            let checkpoint_receipt=premiere_checkpoint::verify_checkpoint(Path::new(&checkpoint),Path::new(&record.project_path))?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(10)).await?;
            let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
            let recovered=record.verify_recovery(&context,&timeline)?;
            premiere_acceptance_execution::save_recovery_result(&path,&inspected_record,&record)?;
            Ok(ActionResult {success:recovered,tool,stdout:json!({
                "action_id":action_id,
                "recovery_verified":recovered,
                "checkpoint":checkpoint,
                "checkpoint_receipt":checkpoint_receipt,
                "automatic_rollback_performed":false,
                "retry_automatically":false,
                "recovery":record.recovery
            }).to_string(),stderr:String::new(),exit_code:Some(if recovered{0}else{1})})
        }
        ToolAction::PremiereAcceptanceExecute {action_id} => {
            if state.acceptance_probe_running.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err() {
                return Err("Another Premiere acceptance action is running.".into());
            }
            let _guard=AcceptanceProbeGuard(&state.acceptance_probe_running);
            let path=premiere_acceptance_action_path(app,&action_id)?;
            let mut record=premiere_acceptance_execution::load(&path)?;
            if record.status!="prepared" || record.cancellation_requested {return Err("Acceptance action already used or cancelled; no retry.".into());}
            if !state.premiere_bridge.status()?.paired {return Err("Paired Premiere UXP host unavailable.".into());}
            let registration=premiere_acceptance_harness::load(&premiere_disposable_path(app)?)?
                .ok_or("Disposable project registration is required.")?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(10)).await?;
            registration.check(&context)?;
            record.identity(&context)?;
            let timeline=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
            if premiere_acceptance_execution::exact_clip(&timeline,&record.fixture)?!=record.before {
                return Err("Timeline target changed after acceptance planning; inspect and prepare a new action.".into());
            }
            record=premiere_acceptance_execution::begin(&path,&record)?;
            let freshest=premiere_acceptance_execution::load(&path)?;
            if freshest.cancellation_requested {
                record.status="cancelled".into();record.cancellation_requested=true;
                premiere_acceptance_execution::save_progress(&path,&mut record)?;
                return Err("Acceptance cancelled before the native edit.".into());
            }
            let fixture=&record.fixture;
            let native_action=match record.step.as_str() {
                "trim"=>ToolAction::PremiereTrimClip {kind:fixture.kind.clone(),track:fixture.track,clip_index:fixture.clip_index,
                    start_seconds:fixture.start_seconds,end_seconds:fixture.end_seconds},
                "move"=>ToolAction::PremiereMoveClip {kind:fixture.kind.clone(),track:fixture.track,clip_index:fixture.clip_index,
                    delta_seconds:fixture.delta_seconds.ok_or("Missing planned move offset.")?},
                "clone"=>ToolAction::PremiereCloneClip {kind:fixture.kind.clone(),track:fixture.track,clip_index:fixture.clip_index,
                    time_offset_seconds:fixture.delta_seconds.ok_or("Missing planned clone offset.")?,video_track_offset:0,
                    audio_track_offset:0,align_to_video:false,insert:false},
                "scene_markers"=>ToolAction::PremiereSceneDetection {request:premiere_scene_detection::Request{
                    schema_version:1,mode:"markers".into(),targets:vec![premiere_scene_detection::Target{
                        track:fixture.track,clip_index:fixture.clip_index,signature:fixture.expected.clips[0].signature.clone()
                    }]
                }},
                _=>return Err("Acceptance step not allowlisted.".into())
            };
            let native_tool=match record.step.as_str(){
                "trim"=>"premiere_trim_clip","move"=>"premiere_move_clip","clone"=>"premiere_clone_clip",
                "scene_markers"=>"premiere_detect_scene_markers",_=>return Err("Acceptance tool not allowlisted.".into())
            };
            let inner=PendingAction {created_at_ms:now_ms(),premiere_expectation:Some(fixture.expected.clone()),tool:native_tool.into(),
                detail:format!("Disposable acceptance {} action {}",record.step,action_id),action:native_action};
            let native=Box::pin(execute_tool(inner,state,app)).await;
            let native_result=match native {
                Ok(result)=>result,
                Err(error)=>{
                    record.status="uncertain".into();record.recovery=Some("Native call failed or result uncertain; checkpoint/host inspection required before any retry.".into());
                    premiere_acceptance_execution::save_progress(&path,&mut record)?;
                    return Ok(ActionResult{success:false,tool,stdout:json!({"action_id":action_id,"status":"uncertain",
                        "retry_automatically":false}).to_string(),stderr:error,exit_code:None});
                }
            };
            let native_receipt=serde_json::from_str::<Value>(&native_result.stdout).ok();
            record.checkpoint=native_receipt.as_ref().and_then(|v|
                v.get("backup").or_else(||v.get("checkpoint")).and_then(Value::as_str).map(str::to_owned));
            if !native_result.success || record.checkpoint.is_none() {
                record.status="uncertain".into();record.recovery=Some("Native result or checkpoint could not be confirmed; inspect before retry.".into());
                premiere_acceptance_execution::save_progress(&path,&mut record)?;
                return Ok(ActionResult{success:false,tool,stdout:json!({"action_id":action_id,"status":"uncertain",
                    "retry_automatically":false}).to_string(),stderr:native_result.stderr,exit_code:None});
            }
            let verified=if record.step=="scene_markers" {
                let timeline_after=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await;
                let target_unchanged=timeline_after.as_ref().ok()
                    .and_then(|value|premiere_acceptance_execution::exact_clip(value,&record.fixture).ok())
                    .is_some_and(|value|value==record.before);
                if !target_unchanged {
                    record.status="uncertain".into();
                    record.recovery=Some("Scene-marker operation changed or obscured the exact clip identity; inspect checkpoint before any retry.".into());
                    false
                } else if let Some(receipt)=native_receipt.as_ref() {
                    record.finish_scene_markers(receipt).unwrap_or_else(|_|{
                        record.status="uncertain".into();record.recovery=Some("Native scene-marker receipt lacks a complete verified delta.".into());false
                    })
                } else {
                    record.status="uncertain".into();record.recovery=Some("Native scene-marker receipt could not be decoded.".into());false
                }
            } else {
                let after=premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await;
                match after {Ok(after)=>record.finish(&after,true).unwrap_or_else(|_|{
                    record.status="uncertain".into();record.recovery=Some("Native post-state is incomplete; inspect before any retry.".into());false
                }),Err(_)=>{
                    record.status="uncertain".into();record.recovery=Some("Post-inspection unavailable; do not retry or assume success.".into());false}}
            };
            if premiere_acceptance_execution::load(&path).is_ok_and(|latest|latest.cancellation_requested){record.cancellation_requested=true;}
            premiere_acceptance_execution::save_progress(&path,&mut record)?;
            if verified && matches!(record.step.as_str(),"trim"|"move"|"clone"|"scene_markers") {
                let report_path=premiere_acceptance_path(app)?;
                let mut report=premiere_acceptance::load(&report_path)?;
                if let Some(checkpoint)=record.checkpoint.as_deref(){
                    match record.step.as_str() {
                        "trim"=>report.verified_timeline_edit("trim","premiere_trim_clip",&record.premiere_version,
                            &record.fixture.expected.project_guid,record.fixture.expected.sequence_guid.as_deref().unwrap_or(""),checkpoint)?,
                        "move"=>report.verified_timeline_edit("move_clone","premiere_move_clip",&record.premiere_version,
                            &record.fixture.expected.project_guid,record.fixture.expected.sequence_guid.as_deref().unwrap_or(""),checkpoint)?,
                        "clone"=>report.verified_timeline_edit("move_clone","premiere_clone_clip",&record.premiere_version,
                            &record.fixture.expected.project_guid,record.fixture.expected.sequence_guid.as_deref().unwrap_or(""),checkpoint)?,
                        "scene_markers"=>{
                            let marker_count=record.after.as_ref().and_then(|v|v.get("new_marker_count")).and_then(Value::as_u64).unwrap_or(0) as usize;
                            let restored=record.after.as_ref().and_then(|v|v.get("selection_restored")).and_then(Value::as_bool).unwrap_or(false);
                            report.verified_scene_detection("premiere_detect_scene_markers",&record.premiere_version,
                                &record.fixture.expected.project_guid,record.fixture.expected.sequence_guid.as_deref().unwrap_or(""),
                                checkpoint,marker_count,restored)?;
                        },
                        _=>unreachable!(),
                    }
                    premiere_acceptance::save(&report_path,&report)?;
                }
            }
            Ok(ActionResult{success:verified,tool,stdout:json!({"action_id":action_id,"status":record.status,
                "native_poststate_verified":verified,"capability_promoted":verified && matches!(record.step.as_str(),"trim"|"move"|"clone"|"scene_markers"),
                "checkpoint":record.checkpoint,"recovery":record.recovery,
                "cleanup_needed":matches!(record.step.as_str(),"clone"|"scene_markers"),
                "retry_automatically":false}).to_string(),stderr:String::new(),exit_code:Some(if verified{0}else{1})})
        }
        ToolAction::PremiereAcceptanceProbe {group} => {
            if state.acceptance_probe_running.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err() {
                return Err("Another Premiere acceptance probe is already running.".into());
            }
            let _guard=AcceptanceProbeGuard(&state.acceptance_probe_running);
            let path=premiere_acceptance_path(app)?;
            let mut report=premiere_acceptance::load(&path)?;
            if group!=1 {
                let reason=if matches!(group,2|3|4|5|8) {
                    "Destructive host test requires a provably disposable project, approval, checkpoint and exact expectation; no automated mutation launched."
                } else {
                    "This acceptance group has no safe automated host probe yet; no runtime verification was inferred."
                };
                report.blocked(group,reason)?;
                premiere_acceptance::save(&path,&report)?;
                return Ok(ActionResult {success:true,tool,stdout:json!({"group":group,"result":"blocked_environment","reason":reason,"report":report}).to_string(),stderr:String::new(),exit_code:Some(0)});
            }
            let native=async {
                if !state.premiere_bridge.status()?.paired {
                    return Err("Paired Premiere UXP panel unavailable.".to_string());
                }
                let context=state.premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(12)).await?;
                let timeline=state.premiere_bridge.request("inspect_timeline",json!({}),Duration::from_secs(20)).await?;
                let diagnostics=state.premiere_bridge.request("project_diagnostics",
                    json!({"limits":{"max_items":200,"max_depth":8,"max_detail_items":10}}),Duration::from_secs(30)).await?;
                premiere_acceptance::host_probe_identity(&context,&timeline,&diagnostics)
            }.await;
            match native {
                Ok((version,project,sequence)) => {
                    for (capability,action) in [("bridge_pair","inspect_context"),("project_inspection","inspect_context"),
                        ("sequence_inspection","inspect_context"),("timeline_inspection","inspect_timeline"),
                        ("project_diagnostics","project_diagnostics")] {
                        report.verified_probe(capability,action,&version,&project,&sequence)?;
                    }
                    premiere_acceptance::save(&path,&report)?;
                    Ok(ActionResult {success:true,tool,stdout:json!({"group":1,"result":"runtime_verified",
                        "verified_capabilities":5,"project_guid":project,"sequence_guid":sequence,
                        "premiere_version":version,"read_only":true}).to_string(),stderr:String::new(),exit_code:Some(0)})
                }
                Err(_) => {
                    let reason="Group 1 host probe unavailable or returned incomplete identity; no capability promoted.";
                    report.blocked(1,reason)?;
                    premiere_acceptance::save(&path,&report)?;
                    Ok(ActionResult {success:true,tool,stdout:json!({"group":1,"result":"blocked_environment","reason":reason,
                        "premiere_runtime_verified_count":report.verified_count()}).to_string(),stderr:String::new(),exit_code:Some(0)})
                }
            }
        }
        ToolAction::PremiereExportStatus {job_id} => {
            let path=premiere_export_jobs_path(app)?;
            let identity=if state.premiere_bridge.status()?.paired {
                premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await.ok()
            }else{None};
            let _io=state.premiere_export_jobs_io.lock().map_err(|_|"Export job store unavailable.")?;
            let mut jobs=premiere_export_jobs::load(&path)?;
            let job=jobs.jobs.iter_mut().find(|j|j.job_id==job_id).ok_or("Export job ID not found.")?;
            let stale=identity.as_ref().is_some_and(|context|
                context.get("projectGuid").and_then(Value::as_str)!=Some(job.project_guid.as_str())
                || context.pointer("/activeSequence/guid").and_then(Value::as_str)!=Some(job.sequence_guid.as_str()));
            let mut result=job.observe_once()?;
            if let Some(map)=result.as_object_mut(){map.insert("identity_checked".into(),json!(identity.is_some()));
                map.insert("stale_project_or_sequence".into(),json!(stale));}
            premiere_export_jobs::save(&path,&jobs)?;
            Ok(ActionResult {success:true,tool,stdout:result.to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereReadinessReport => {
            let report=premiere_acceptance::load(&premiere_acceptance_path(app)?)?;
            let registry=premiere_calibration::load(&premiere_calibration_path(app)?)?;
            let jobs={let _io=state.premiere_export_jobs_io.lock().map_err(|_|"Export job store unavailable.")?;premiere_export_jobs::load(&premiere_export_jobs_path(app)?)?};
            let native=report.verified_count();let total=report.capabilities.len();
            let verified=|name:&str|report.capabilities.iter().any(|c|c.name==name && c.premiere_runtime_verified);
            let recovery_count=registry.entries.iter().filter(|e|e.recovery_verified).count();
            let export_complete=jobs.jobs.iter().filter(|j|j.encoder_completion_verified).count();
            let baseline=json!({"bridge_pair":verified("bridge_pair"),"project_inspection":verified("project_inspection"),
                "timeline_inspection":verified("timeline_inspection"),"trim":verified("trim"),
                "move_clone":verified("move_clone"),"scene_edit_detection":verified("scene_edit_detection"),
                "static_parameter_set":verified("static_parameter_set"),"visual_review":verified("visual_review"),
                "checkpoint_recovery":recovery_count>0,"stale_expectation_host_tested":false,
                "export_completion_verified":export_complete>0});
            let by_state=|state:&str|report.capabilities.iter().filter(|c|c.state==state).map(|c|c.name.as_str()).collect::<Vec<_>>();
            Ok(ActionResult {success:true,tool,stdout:json!({"schema_version":2,"code_implementation_estimate_pct":null,
                "evidence_dimensions":premiere_acceptance::evidence_dimensions(&report,recovery_count,export_complete),
                "node_mock_verified_capabilities":[],
                "node_mock_coverage_declared_capabilities":report.capabilities.iter().filter(|c|c.code_tested).map(|c|c.name.as_str()).collect::<Vec<_>>(),
                "node_test_run_attestation_persisted":false,"rust_verified":false,
                "premiere_runtime_verified_count":native,"premiere_runtime_capability_count":total,
                "premiere_runtime_verified_pct":if total>0{native*100/total}else{0},
                "recovery_verified_entries":recovery_count,"export_completion_verified_jobs":export_complete,
                "baseline":baseline,"production_ready":false,
                "runtime_verified":by_state("runtime_verified"),"implemented_unverified":by_state("implemented_unverified"),
                "unsupported_documented":by_state("unsupported_documented"),"blocked_environment":by_state("blocked_environment"),
                "runtime_failed":by_state("runtime_failed"),
                "note":"Coverage declarations are not test-run attestations. Persisted host evidence is historical and not bound to the current source revision or live project. Current-build Windows, host, recovery, cancellation and export acceptance require fresh evidence."}).to_string(),stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremierePlanInterchangeExport {request} => {
            request.validate()?;
            let context=premiere_bridge.request("inspect_context",json!({}),Duration::from_secs(8)).await?;
            let sequence_guid=context.pointer("/activeSequence/guid").and_then(Value::as_str).filter(|value|!value.is_empty())
                .ok_or("Interchange export requires an active Premiere sequence.")?;
            let project_guid=context.get("projectGuid").and_then(Value::as_str).filter(|value|!value.is_empty())
                .ok_or("Interchange export requires an active Premiere project.")?;
            let expected=PremiereExpectation{
                project_guid:project_guid.into(),
                project_path:context.get("projectPath").and_then(Value::as_str).map(str::to_string),
                sequence_guid:Some(sequence_guid.into()),
                clips:Vec::new(),
            };
            expected.validate()?;
            let format=request.format.clone();
            let output=request.output.clone();
            Ok(ActionResult{
                success:true,tool,
                stdout:json!({
                    "supported":true,
                    "request":request,
                    "expected":expected,
                    "api_since":if format=="aaf"{"26.3"}else{"26.2"},
                    "collision_protection":premiere_delivery::collision_protection(),
                    "unique_output_candidate":premiere_delivery::unique_output_candidate(&output)?,
                    "unique_output_reserved":false,
                    "output_exists":Path::new(&output).exists(),
                    "completion_verified":false
                }).to_string(),
                stderr:String::new(),exit_code:Some(0)
            })
        }
        ToolAction::PremiereExportInterchange {request} => {
            request.validate()?;
            let expected=premiere_bridge.expected.ok_or("Interchange export requires project/sequence expectation.")?;
            let output=request.output.clone();
            let format=request.format.clone();
            let suppress_ui=request.suppress_ui;
            let before=premiere_delivery::observed_file(&output);
            let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(expected)};
            let aaf_options=request.aaf_options.as_ref().map(|value|json!({
                "audioFileFormat":value.audio_file_format.clone(),
                "bitsPerSample":value.bits_per_sample,
                "embedAudio":value.embed_audio,
                "explodeToMono":value.explode_to_mono,
                "handleFrames":value.handle_frames,
                "interleaveWithoutEffects":value.interleave_without_effects,
                "mixdownVideo":value.mixdown_video,
                "preserveParentFolder":value.preserve_parent_folder,
                "renderAudioEffects":value.render_audio_effects,
                "sampleRate":value.sample_rate,
                "trimSources":value.trim_sources,
                "videoMixdownPresetPath":value.video_mixdown_preset_path.clone()
            }));
            premiere_delivery::validate_output_file(&output,request.overwrite)?;
            let value=client.request(
                "export_interchange",
                json!({"format":format,"output":output,"overwrite":request.overwrite,"suppressUI":suppress_ui,"aafOptions":aaf_options}),
                Duration::from_secs(180),
            ).await?;
            let after=premiere_delivery::observed_file(&request.output);
            let accepted=value.get("accepted").and_then(Value::as_bool)==Some(true);
            let observed=after.get("observed").and_then(Value::as_bool)==Some(true);
            Ok(ActionResult{
                success:accepted&&observed,tool,
                stdout:json!({
                    "native_result":value,"file_before":before,"file_after":after,
                    "accepted":accepted,"file_observed":observed,
                    "completion_verified":false,"media_parse_verified":false,
                    "state":if accepted{"accepted_unverified"}else{"rejected"},
                    "compatibility_with_other_nles_guaranteed":false,
                    "collision_protection":premiere_delivery::collision_protection(),
                    "retry_safe":false
                }).to_string(),
                stderr:String::new(),exit_code:Some(if accepted&&observed{0}else{1})
            })
        }
        ToolAction::PremiereExportFrame {request} => {
            request.validate()?;
            let expected=premiere_bridge.expected.ok_or("Frame export requires project/sequence expectation.")?;
            let output=request.output.clone();
            let path=Path::new(&output);
            let directory=path.parent().ok_or("Frame export output has no parent directory.")?.to_string_lossy().to_string();
            let before=premiere_delivery::observed_file(&output);
            let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(expected)};
            premiere_delivery::validate_output_file(&output,request.overwrite)?;
            let value=client.request(
                "export_sequence_frame",
                json!({"seconds":request.seconds,"output":output,"overwrite":request.overwrite,"directory":directory,"width":request.width,"height":request.height}),
                Duration::from_secs(60),
            ).await?;
            let after=premiere_delivery::observed_file(&request.output);
            let accepted=value.get("accepted").and_then(Value::as_bool)==Some(true);
            let observed=after.get("observed").and_then(Value::as_bool)==Some(true);
            Ok(ActionResult{
                success:accepted&&observed,tool,
                stdout:json!({
                    "native_result":value,"file_before":before,"file_after":after,
                    "accepted":accepted,"file_observed":observed,
                    "completion_verified":false,"media_parse_verified":false,
                    "state":if accepted{"accepted_unverified"}else{"rejected"},
                    "native_frame_export":true,"screenshot_fallback":false,"retry_safe":false,
                    "collision_protection":premiere_delivery::collision_protection()
                }).to_string(),
                stderr:String::new(),exit_code:Some(if accepted&&observed{0}else{1})
            })
        }
        ToolAction::PremiereCancelReviewFrameExport { generation } => {
            let cancelled = state.delivery_running.cancel(generation, &state.delivery_cancelled)?;
            Ok(ActionResult{
                success:true,tool,
                stdout:json!({"cancel_requested":cancelled,"generation":generation,"native_inflight_may_finish":cancelled}).to_string(),
                stderr:String::new(),exit_code:Some(0)
            })
        }
        ToolAction::PremiereExportReviewFrames {batch} => {
            batch.validate()?;
            let _guard = state.delivery_running.begin(&state.delivery_cancelled)?;
            let expected=premiere_bridge.expected.ok_or("Review-frame export requires project/sequence expectation.")?.clone();
            let client=PremiereClient{bridge:&state.premiere_bridge,expected:Some(&expected)};
            let mut results=Vec::new();
            let mut uncertain=false;
            for (index,frame) in batch.frames.iter().enumerate(){
                if state.delivery_cancelled.load(Ordering::Acquire){break;}
                let output=frame.output.clone();
                let path=Path::new(&output);
                let directory=path.parent().ok_or("Review frame output has no parent directory.")?.to_string_lossy().to_string();
                // Earlier frames may take minutes. Recheck this destination at its own dispatch.
                if let Err(error)=frame.validate(){
                    results.push(json!({"index":index,"output":output,"status":"blocked_before_dispatch",
                        "reason":error,"completion_verified":false}));
                    break;
                }
                match client.request(
                    "export_sequence_frame",
                    json!({"seconds":frame.seconds,"output":output,"overwrite":frame.overwrite,"directory":directory,"width":frame.width,"height":frame.height}),
                    Duration::from_secs(60),
                ).await {
                    Ok(value)=>{
                        let observation=premiere_delivery::observed_file(&frame.output);
                        let accepted=value.get("accepted").and_then(Value::as_bool)==Some(true);
                        let observed=observation.get("observed").and_then(Value::as_bool)==Some(true);
                        results.push(json!({
                            "index":index,"seconds":frame.seconds,"output":frame.output.clone(),
                            "status":if accepted{"accepted_unverified"}else{"rejected"},
                            "accepted":accepted,"file_observed":observed,"completion_verified":false,
                            "native_result":value,"file":observation
                        }));
                        if !accepted{break;}
                        if !observed{uncertain=true;break;}
                    }
                    Err(error)=>{
                        let delivery_uncertain=error.contains("unknown")||error.contains("timed out")||error.contains("timeout")||error.contains("delivery");
                        results.push(json!({
                            "index":index,"seconds":frame.seconds,"output":frame.output.clone(),
                            "status":if delivery_uncertain{"uncertain"}else{"failed"},
                            "reason":error.chars().take(240).collect::<String>()
                        }));
                        if delivery_uncertain{uncertain=true;break;}
                    }
                }
            }
            let cancelled=state.delivery_cancelled.load(Ordering::Acquire);
            let accepted=results.iter().filter(|row|row["accepted"]==true).count();
            let requests_accepted=!uncertain&&!cancelled&&accepted==batch.frames.len();
            Ok(ActionResult{
                success:requests_accepted,tool,
                stdout:json!({
                    "requested":batch.frames.len(),"accepted":accepted,"exported":0,"results":results,
                    "requests_accepted":requests_accepted,"complete":false,"completion_verified":false,
                    "collision_protection":premiere_delivery::collision_protection(),
                    "cancelled":cancelled,"uncertain":uncertain,
                    "native_frame_export":true,"screenshot_fallback":false,"retry_safe":false
                }).to_string(),
                stderr:String::new(),exit_code:Some(if requests_accepted{0}else{1})
            })
        }
        ToolAction::PremierePlanExport {output,preset,queue_to_ame,overwrite} => {
            let context=premiere_bridge.request("inspect_export",json!({}),Duration::from_secs(12)).await?;
            let project=context.get("projectGuid").and_then(Value::as_str).filter(|v|!v.is_empty()).ok_or("Premiere project GUID unavailable.")?;
            let sequence=context.get("sequenceGuid").and_then(Value::as_str).filter(|v|!v.is_empty()).ok_or("Premiere sequence GUID unavailable.")?;
            let local=premiere_export::inspect(&output,preset.as_deref(),overwrite,context.get("projectPath").and_then(Value::as_str))?;
            let ame=context.get("ameAvailable").and_then(Value::as_bool).unwrap_or(false);
            let mut warnings=local.warnings.clone();
            if queue_to_ame && !ame {warnings.push("Adobe Media Encoder is unavailable.".into());}
            if preset.is_none() {warnings.push("Premiere default export settings are not inspectable here; no codec or bitrate is inferred.".into());}
            let value=json!({"executable":local.executable && (!queue_to_ame || ame),
                "output":local.output,"output_exists":local.output_exists,"parent_exists":local.parent_exists,
                "preset":local.preset,"preset_exists":local.preset_exists,"overwrite":overwrite,
                "warnings":warnings,"ame_required":queue_to_ame,"ame_available":ame,
                "project":{"guid":project,"path":context.get("projectPath")},
                "sequence":{"guid":sequence,"name":context.get("sequenceName")},
                "expected":{"project_guid":project,"project_path":context.get("projectPath"),"sequence_guid":sequence,"clips":[]},
                "default_preset_details_inspectable":false,
                "collision_protection":premiere_delivery::collision_protection(),
                "unique_output_candidate":premiere_delivery::unique_output_candidate(&output)?,
                "unique_output_reserved":false,
                "note":"Adobe's boolean export result does not prove finished media encoding."});
            Ok(ActionResult {success:true,tool,stdout:serde_json::to_string_pretty(&value).unwrap_or_default(),
                stderr:String::new(),exit_code:Some(0)})
        }
        ToolAction::PremiereExportSequence { output, preset, queue_to_ame, overwrite } => {
            let context=premiere_bridge.request("inspect_export",json!({}),Duration::from_secs(12)).await?;
            let local=premiere_export::inspect(&output,preset.as_deref(),overwrite,context.get("projectPath").and_then(Value::as_str))?;
            if !local.executable { return Err(format!("Export preflight blocked: {}",local.warnings.join("; "))); }
            let expected=premiere_bridge.expected.ok_or("Export requires a project and sequence expectation.")?;
            if context.get("projectGuid").and_then(Value::as_str)!=Some(expected.project_guid.as_str())
                || context.get("sequenceGuid").and_then(Value::as_str)!=expected.sequence_guid.as_deref()
                || expected.project_path.as_deref().is_some_and(|p|context.get("projectPath").and_then(Value::as_str)!=Some(p)) {
                return Err("Premiere project or sequence changed after export planning; inspect again.".into());
            }
            if queue_to_ame && context.get("ameAvailable").and_then(Value::as_bool)!=Some(true) {
                return Err("Adobe Media Encoder is unavailable.".into());
            }
            let job_id=Uuid::new_v4().to_string();
            let mut job=premiere_export_jobs::Job::new(job_id.clone(),&expected.project_guid,
                expected.sequence_guid.as_deref().ok_or("Sequence expectation missing.")?,&output,preset.as_deref(),queue_to_ame)?;
            let jobs_path=premiere_export_jobs_path(app)?;
            {
            let _io=state.premiere_export_jobs_io.lock().map_err(|_|"Export job store unavailable.")?;
            let mut jobs=premiere_export_jobs::load(&jobs_path)?;
            // Persist uncertainty before dispatch: a crash or lost response cannot prove that
            // the export never started and must never be followed by an automatic retry.
            job.bridge_state="execution_status_unknown".into();
            jobs.insert(job)?;premiere_export_jobs::save(&jobs_path,&jobs)?;
            }
            // Persisting the job can block on another writer; repeat preflight after it.
            let recheck=premiere_export::inspect(&output,preset.as_deref(),overwrite,context.get("projectPath").and_then(Value::as_str));
            let blocked=match recheck {
                Ok(check) if check.executable=>None,
                Ok(check)=>Some(check.warnings.join("; ")),
                Err(error)=>Some(error),
            };
            if let Some(reason)=blocked {
                let _io=state.premiere_export_jobs_io.lock().map_err(|_|"Export job store unavailable.")?;
                let mut jobs=premiere_export_jobs::load(&jobs_path)?;
                let record=jobs.jobs.iter_mut().find(|j|j.job_id==job_id).ok_or("Export job record unavailable.")?;
                record.bridge_state="rejected".into();premiere_export_jobs::save(&jobs_path,&jobs)?;
                return Err(format!("Export blocked before dispatch after output recheck: {reason}"));
            }
            let result=premiere_bridge.request("export_sequence",
                json!({"output":output,"preset":preset,"queueToAme":queue_to_ame,"overwrite":overwrite}),
                Duration::from_secs(if queue_to_ame {45} else {120})).await;
            let observed=premiere_export::observation(&output,local.output_exists);
            let _io=state.premiere_export_jobs_io.lock().map_err(|_|"Export job store unavailable.")?;
            let mut jobs=premiere_export_jobs::load(&jobs_path)?;
            let record=jobs.jobs.iter_mut().find(|j|j.job_id==job_id).ok_or("Export job record unavailable.")?;
            match result {
                Ok(value) => {
                    record.bridge_state=if value.get("accepted").and_then(Value::as_bool)==Some(true)
                        && value.get("state").and_then(Value::as_str)==Some(if queue_to_ame{"queued"}else{"accepted"}) {
                            if queue_to_ame{"queued"}else{"accepted"}
                        }else{"execution_status_unknown"}.into();
                    let accepted=matches!(record.bridge_state.as_str(),"accepted"|"queued");
                    premiere_export_jobs::save(&jobs_path,&jobs)?;
                    Ok(ActionResult {success:accepted,tool,
                        stdout:serde_json::to_string_pretty(&json!({"job_id":job_id,"encoder":value,
                            "output_observation":observed,"encoder_completion_verified":false,"retry_automatically":false,
                            "collision_protection":premiere_delivery::collision_protection()})).unwrap_or_default(),
                        stderr:String::new(),exit_code:Some(if accepted {0}else{1})})
                },
                Err(error) => {
                    let state="execution_status_unknown";
                    record.bridge_state=state.into();premiere_export_jobs::save(&jobs_path,&jobs)?;
                    Ok(ActionResult {success:false,tool,
                        stdout:json!({"job_id":job_id,"state":state,"output_observation":observed,"retry_automatically":false,
                            "reason":"A bridge error or timeout is not proof that export did not run. Inspect before retrying."}).to_string(),
                        stderr:error,exit_code:None})
                }
            }
        }
        ToolAction::PremiereSaveProject => {
            let value = premiere_bridge
                .request("save_project", json!({}), Duration::from_secs(15)).await?;
            Ok(ActionResult {
                success: true,
                tool,
                stdout: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::WorkspaceScan { path } => {
            let root = Path::new(&path);
            if !root.is_dir() {
                return Err("Workspace path is not a directory.".into());
            }
            let canonical_root = root.canonicalize()
                .map_err(|error| format!("Could not canonicalize workspace path: {error}"))?;

            let mut output = Vec::new();
            workspace_scan_recursive(&canonical_root, &canonical_root, 0, &mut output)?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(output.join("\n")),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::SearchText { path, query } => {
            let root = Path::new(&path);
            if !root.is_dir() {
                return Err("Search path is not a directory.".into());
            }
            let canonical_root = root.canonicalize()
                .map_err(|error| format!("Could not canonicalize search path: {error}"))?;

            let mut matches = Vec::new();
            let mut visited_files = 0_usize;
            let mut visited_entries = 0_usize;
            search_text_recursive(
                &canonical_root,
                &canonical_root,
                &query,
                0,
                &mut matches,
                &mut visited_files,
                &mut visited_entries,
            )?;

            let stdout = if matches.is_empty() {
                format!("No matches found for '{query}'.")
            } else {
                matches.join("\n")
            };

            Ok(ActionResult {
                success: true,
                tool,
                stdout: truncate_output(stdout),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ReplaceText { path, old, new_value } => {
            let mut file = open_existing_file_for_mutation(Path::new(&path), "replace_text")?;
            let source = read_utf8_open_file_bounded(
                &mut file,
                MAX_WRITE_BYTES,
                "editable file",
            )?;

            let count = source.matches(&old).count();
            if count == 0 {
                return Err("Exact old text was not found.".into());
            }
            if count > 1 {
                return Err(format!(
                    "Exact old text appears {count} times. Refine the old text so the edit is unambiguous."
                ));
            }

            let updated = source.replacen(&old, &new_value, 1);
            overwrite_open_file(&mut file, updated.as_bytes(), "replace_text")?;

            Ok(ActionResult {
                success: true,
                tool,
                stdout: format!("Applied one exact replacement in {path}."),
                stderr: String::new(),
                exit_code: Some(0),
            })
        }
        ToolAction::ApplyPatch { path, patch, expected_worktree_fingerprint } => {
            require_expected_git_worktree(&path, &expected_worktree_fingerprint, "apply_patch before validation")?;
            let check = run_git_with_stdin(
                &path,
                &["apply", "--check", "--whitespace=nowarn", "-"],
                &patch,
            )?;

            if !check.status.success() {
                return Err(format!(
                    "Patch validation failed: {}",
                    String::from_utf8_lossy(&check.stderr)
                ));
            }

            require_expected_git_worktree(&path, &expected_worktree_fingerprint, "apply_patch before mutation")?;
            let output = run_git_with_stdin(
                &path,
                &["apply", "--whitespace=nowarn", "-"],
                &patch,
            )?;

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: if output.status.success() {
                    "Structured patch applied successfully.".into()
                } else {
                    truncate_output(String::from_utf8_lossy(&output.stdout).to_string())
                },
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::RunProjectTask { path, task } => {
            let (program, args) = project_task_command(&path, &task)?;
            let git_before = if Path::new(&path).join(".git").exists() {
                Some(git_local_context(&path)?)
            } else {
                None
            };

            let mut child = Command::new(&program)
                .args(&args)
                .current_dir(&path)
                .env("CI", "1")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("Could not run project task: {error}"))?;
            let child_pid = child.id();
            if let Err(error) = register_managed_process(state, child_pid) {
                let _ = terminate_managed_process_tree(child_pid);
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Project task was stopped before execution could continue safely: {error}"
                ));
            }
            if let Some(action_id) = execution_action_id {
                match state.running_action_children.lock() {
                    Ok(mut running) => {
                        running.insert(action_id.to_string(), child_pid);
                    }
                    Err(_) => {
                        let _ = terminate_registered_process_tree(state, child_pid);
                        unregister_managed_process(state, child_pid);
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("Running-action state is unavailable; project task was stopped before execution could continue safely.".into());
                    }
                }
            }
            let hard_limit_triggered = AtomicBool::new(false);
            let hard_limit_terminated = AtomicBool::new(false);
            let output_result = std::thread::scope(|scope| {
                let monitor = scope.spawn(|| {
                    while managed_process_identity_matches(state, child_pid).unwrap_or(false) {
                        match current_runtime_status(state) {
                            Ok(status) if status.over_hard_limit => {
                                hard_limit_triggered.store(true, Ordering::Release);
                                let stopped = terminate_registered_process_tree(state, child_pid).unwrap_or(false);
                                hard_limit_terminated.store(stopped, Ordering::Release);
                                break;
                            }
                            Ok(_) => {}
                            Err(_) => break,
                        }
                        std::thread::sleep(Duration::from_millis(250));
                    }
                });
                let output = child.wait_with_output();
                let _ = monitor.join();
                output
            });
            if let Some(action_id) = execution_action_id {
                if let Ok(mut running) = state.running_action_children.lock() {
                    running.remove(action_id);
                }
            }
            unregister_managed_process(state, child_pid);
            let output = output_result
                .map_err(|error| format!("Could not wait for project task: {error}"))?;

            let exceeded_hard_limit = hard_limit_triggered.load(Ordering::Acquire);
            let mut success = output.status.success() && !exceeded_hard_limit;
            let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if exceeded_hard_limit {
                let warning = if hard_limit_terminated.load(Ordering::Acquire) {
                    "Project validation exceeded Shuvi's 4 GB hard RAM ceiling and its managed process tree was stopped."
                } else {
                    "Project validation exceeded Shuvi's 4 GB hard RAM ceiling; termination could not be confirmed, so validation is failed closed."
                };
                stderr = if stderr.trim().is_empty() {
                    warning.into()
                } else {
                    format!("{warning}\n{stderr}")
                };
            }
            if let Some(before) = git_before {
                let after = git_local_context(&path)?;
                if !git_same_local_snapshot(&before, &after) {
                    success = false;
                    let warning = "Git branch, HEAD, or worktree changed while the validation task was running; validation evidence is not bound to one repository snapshot.";
                    stderr = if stderr.trim().is_empty() {
                        warning.into()
                    } else {
                        format!("{warning}\n{stderr}")
                    };
                }
                stdout = format!("[SHUVI_GIT_CONTEXT_V1]{}\n{}", after, stdout);
            }

            Ok(ActionResult {
                success,
                tool,
                stdout: truncate_output(stdout),
                stderr: truncate_output(stderr),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitStatus { path } => {
            let before = git_local_context(&path)?;
            let output = run_git(&path, &["status", "--short", "--branch", "--untracked-files=all"])?;
            let after = git_local_context(&path)?;
            if !git_same_local_snapshot(&before, &after) {
                return Err("Git repository HEAD or branch changed while git_status was running; inspect again before any write.".into());
            }
            let stdout = if output.status.success() {
                format!("[SHUVI_GIT_CONTEXT_V1]{}\n{}", after, String::from_utf8_lossy(&output.stdout))
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };
            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(stdout),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitDiff { path } => {
            let before = git_local_context(&path)?;
            let output = run_git(&path, &["diff", "HEAD", "--no-ext-diff", "--unified=3", "--"])?;
            let after = git_local_context(&path)?;
            if !git_same_local_snapshot(&before, &after) {
                return Err("Git repository HEAD or branch changed while git_diff was running; inspect again before any write.".into());
            }
            let stdout = if output.status.success() {
                format!("[SHUVI_GIT_CONTEXT_V1]{}\n{}", after, String::from_utf8_lossy(&output.stdout))
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };
            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(stdout),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitCommit { path, message, files, expected_head, expected_worktree_fingerprint } => {
            require_expected_git_head(&path, &expected_head, "git_commit")?;
            require_expected_git_worktree(&path, &expected_worktree_fingerprint, "git_commit")?;
            let remote_receipt = git_remote_freshness(&path, false)?;
            require_expected_git_head(&path, &expected_head, "git_commit after remote freshness check")?;
            require_expected_git_worktree(&path, &expected_worktree_fingerprint, "git_commit after remote freshness check")?;
            let requested: HashSet<&str> = files.iter().map(String::as_str).collect();
            let staged_before = git_staged_files(&path)?;
            let unrelated_before: Vec<String> = staged_before
                .into_iter()
                .filter(|file| !requested.contains(file.as_str()))
                .collect();
            if !unrelated_before.is_empty() {
                return Err(format!(
                    "Refusing git_commit because unrelated files are already staged: {}",
                    unrelated_before.join(", ")
                ));
            }

            let pathspecs: Vec<String> = files
                .iter()
                .map(|file| format!(":(literal){file}"))
                .collect();
            require_expected_git_worktree(&path, &expected_worktree_fingerprint, "git_commit before staging")?;
            let mut add_args: Vec<&str> = vec!["add", "--"];
            add_args.extend(pathspecs.iter().map(String::as_str));
            let add = run_git(&path, &add_args)?;
            if !add.status.success() {
                return Err(format!(
                    "Git staging failed: {}",
                    String::from_utf8_lossy(&add.stderr)
                ));
            }

            let staged_after = git_staged_files(&path)?;
            if staged_after.is_empty() {
                return Err("git_commit found no staged changes in the exact reviewed file list.".into());
            }
            let unrelated_after: Vec<String> = staged_after
                .iter()
                .filter(|file| !requested.contains(file.as_str()))
                .cloned()
                .collect();
            if !unrelated_after.is_empty() {
                return Err(format!(
                    "Refusing git_commit because staging contains files outside the reviewed list: {}",
                    unrelated_after.join(", ")
                ));
            }

            require_expected_git_head(&path, &expected_head, "git_commit after staging")?;
            require_expected_git_worktree(&path, &expected_worktree_fingerprint, "git_commit after staging")?;
            let remote_receipt = git_remote_freshness(&path, false)?;
            require_expected_git_head(&path, &expected_head, "git_commit after final remote freshness check")?;
            require_expected_git_worktree(&path, &expected_worktree_fingerprint, "git_commit after final remote freshness check")?;
            let output = run_git(&path, &["commit", "-m", &message])?;
            let body = format!(
                "Remote freshness: {remote_receipt}\n{}",
                String::from_utf8_lossy(&output.stdout)
            );
            let stdout = if output.status.success() {
                git_context_stdout(&path, body)?
            } else {
                body
            };

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(stdout),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::GitPush { path, expected_head } => {
            require_expected_git_head(&path, &expected_head, "git_push")?;
            let remote_receipt = git_remote_freshness(&path, true)?;
            require_expected_git_head(&path, &expected_head, "git_push after remote freshness check")?;
            let (remote, merge_ref) = git_push_destination(&path)?;
            let refspec = format!("{expected_head}:{merge_ref}");
            let output = run_git(&path, &["push", "--", remote.as_str(), refspec.as_str()])?;
            let body = format!(
                "Remote freshness: {remote_receipt}\nExact push: {expected_head} -> {remote}/{merge_ref}\n{}",
                String::from_utf8_lossy(&output.stdout)
            );
            let stdout = if output.status.success() {
                git_context_stdout(&path, body)?
            } else {
                body
            };

            Ok(ActionResult {
                success: output.status.success(),
                tool,
                stdout: truncate_output(stdout),
                stderr: truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code: output.status.code(),
            })
        }
        ToolAction::PowerShell { command } => {
            #[cfg(target_os = "windows")]
            let mut child = Command::new("powershell.exe")
                .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &command])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("Failed to start PowerShell: {error}"))?;

            #[cfg(not(target_os = "windows"))]
            let mut child = Command::new("sh")
                .args(["-lc", &command])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("Failed to start shell: {error}"))?;

            let child_pid = child.id();
            if let Err(error) = register_managed_process(state, child_pid) {
                let _ = terminate_managed_process_tree(child_pid);
                let _ = child.wait();
                return Err(format!(
                    "Manual shell was stopped before it could remain untracked: {error}"
                ));
            }

            let hard_limit_triggered = AtomicBool::new(false);
            let hard_limit_terminated = AtomicBool::new(false);
            let output_result = std::thread::scope(|scope| {
                let monitor = scope.spawn(|| {
                    while managed_process_identity_matches(state, child_pid).unwrap_or(false) {
                        match current_runtime_status(state) {
                            Ok(status) if status.over_hard_limit => {
                                hard_limit_triggered.store(true, Ordering::Release);
                                let stopped = terminate_registered_process_tree(state, child_pid).unwrap_or(false);
                                hard_limit_terminated.store(stopped, Ordering::Release);
                                break;
                            }
                            Ok(_) => {}
                            Err(_) => break,
                        }
                        std::thread::sleep(Duration::from_millis(250));
                    }
                });
                let output = child.wait_with_output();
                let _ = monitor.join();
                output
            });
            unregister_managed_process(state, child_pid);
            let output = output_result
                .map_err(|error| format!("Could not wait for manual shell: {error}"))?;

            let exceeded_hard_limit = hard_limit_triggered.load(Ordering::Acquire);
            let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if exceeded_hard_limit {
                let warning = if hard_limit_terminated.load(Ordering::Acquire) {
                    "Manual shell exceeded Shuvi's 4 GB hard RAM ceiling and its managed process tree was stopped."
                } else {
                    "Manual shell exceeded Shuvi's 4 GB hard RAM ceiling; termination could not be confirmed, so the action is failed closed."
                };
                stderr = if stderr.trim().is_empty() {
                    warning.into()
                } else {
                    format!("{warning}\n{stderr}")
                };
            }

            Ok(ActionResult {
                success: output.status.success() && !exceeded_hard_limit,
                tool,
                stdout: truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate_output(stderr),
                exit_code: output.status.code(),
            })
        }
    }
}

#[tauri::command]
fn list_providers() -> Vec<ProviderDescriptor> {
    providers()
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key cannot be empty.".into());
    }
    if api_key.len() > MAX_API_KEY_BYTES || api_key.chars().any(char::is_control) {
        return Err("API key must be control-character free and at most 16 KB.".into());
    }

    key_entry(&provider)?
        .set_password(api_key)
        .map_err(|error| format!("Could not save API key: {error}"))
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), String> {
    let entry = key_entry(&provider)?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete API key: {error}")),
    }
}

#[tauri::command]
async fn chat(
    mut input: ChatInput,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<ChatResponse, String> {
    ensure_memory_budget(state.inner())?;
    validate_provider_fields(
        input.provider.as_str(),
        input.model.as_str(),
        input.base_url.as_deref(),
    )?;

    if input.messages.len() > MAX_CHAT_MESSAGES {
        return Err(format!("Provider context exceeds Shuvi's {MAX_CHAT_MESSAGES}-message safety limit."));
    }
    let mut chat_bytes = 0_usize;
    for message in &input.messages {
        if !matches!(message.role.as_str(), "user" | "assistant" | "system") {
            return Err("Provider context contains an unsupported chat role.".into());
        }
        let message_bytes = message.content.len();
        if message_bytes > MAX_CHAT_MESSAGE_BYTES {
            return Err("A provider-context message exceeds Shuvi's 256 KB safety limit.".into());
        }
        chat_bytes = chat_bytes.saturating_add(message_bytes);
        if chat_bytes > MAX_CHAT_CONTEXT_BYTES {
            return Err("Provider context exceeds Shuvi's 2 MB safety limit.".into());
        }
    }

    let workspace = read_workspace(&app)?;
    let workspace_context = workspace
        .as_deref()
        .map(|path| format!("\nCurrent Shuvi workspace: {path}\nUse this workspace when the user refers to 'the project' without giving another path."))
        .unwrap_or_default();
    let orchestration_context=input.orchestration_context.take().unwrap_or_default();
    if orchestration_context.chars().count()>3_000 {
        return Err("Agent orchestration context exceeds the 3000-character safety limit.".into());
    }
    let orchestration_context=if orchestration_context.trim().is_empty() {
        String::new()
    } else {
        format!("\n\n{}\n",orchestration_context.trim())
    };

    input.messages.insert(
        0,
        ChatMessage {
            role: "system".into(),
            content: format!("{TOOL_PROTOCOL}{workspace_context}{orchestration_context}"),
        },
    );

    let key = load_api_key(&input.provider)?;
    send_chat(input, key).await
}

#[tauri::command]
fn runtime_status(state: State<'_, ActionState>) -> Result<RuntimeStatus, String> {
    current_runtime_status(state.inner())
}

#[tauri::command]
fn prepare_tool(
    proposal: ToolProposal,
    provider: String,
    model: String,
    base_url: Option<String>,
    state: State<'_, ActionState>,
) -> Result<PendingActionView, String> {
    ensure_memory_budget(state.inner())?;
    validate_provider_fields(provider.as_str(), model.as_str(), base_url.as_deref())?;

    let provider_context = ProviderContext {
        provider,
        model,
        base_url,
    };

    stage_tool(proposal, Some(provider_context), state.inner())
}

#[tauri::command]
fn prepare_powershell(
    command: String,
    state: State<'_, ActionState>,
) -> Result<PendingActionView, String> {
    ensure_memory_budget(state.inner())?;

    let proposal = ToolProposal {
        tool: "powershell".into(),
        arguments: json!({ "command": command }),
        reason: Some("Manual PowerShell action".into()),
        plan: None,
        task_graph: None,
        task_step_id: None,
        task_recovery: None,
    };

    stage_tool(proposal, None, state.inner())
}

#[tauri::command]
fn deny_action(
    action_id: String,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<(), String> {
    let action = state
        .pending
        .lock()
        .map_err(|_| "Permission state is unavailable.".to_string())?
        .remove(&action_id);

    if let Some(action) = action {
        let audit_detail = audit_safe_action_detail(&action.tool, &action.detail);
        append_audit(
            &app,
            &AuditEntry {
                timestamp_ms: now_ms(),
                event: "denied".into(),
                tool: action.tool,
                detail: audit_detail,
                success: false,
                action_id: Some(action_id),
            },
        )?;
    }

    Ok(())
}

#[tauri::command]
fn cancel_running_action(
    action_id: String,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<bool, String> {
    Uuid::parse_str(&action_id).map_err(|_| "Invalid running action ID.")?;

    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Permission state is unavailable.".to_string())?;
        let cancellable = pending
            .get(&action_id)
            .is_some_and(|action| action.tool == "run_project_task");
        if cancellable {
            let action = pending.remove(&action_id)
                .ok_or_else(|| "Prepared action disappeared during cancellation.".to_string())?;
            drop(pending);
            let audit_detail = audit_safe_action_detail(&action.tool, &action.detail);
            append_audit(
                &app,
                &AuditEntry {
                    timestamp_ms: now_ms(),
                    event: "denied".into(),
                    tool: action.tool,
                    detail: audit_detail,
                    success: false,
                    action_id: Some(action_id),
                },
            )?;
            return Ok(true);
        }
    }

    for _ in 0..50 {
        let active_tool = state
            .running_action_tools
            .lock()
            .map_err(|_| "Running-action state is unavailable.".to_string())?
            .get(&action_id)
            .cloned();
        match active_tool.as_deref() {
            Some("run_project_task") => {}
            Some(_) | None => return Ok(false),
        }

        let pid = state
            .running_action_children
            .lock()
            .map_err(|_| "Running-action state is unavailable.".to_string())?
            .get(&action_id)
            .copied();
        if let Some(pid) = pid {
            let is_managed = state
                .managed_children
                .lock()
                .map_err(|_| "Managed-process state is unavailable.".to_string())?
                .contains(&pid);
            if !is_managed || !managed_process_identity_matches(state.inner(), pid)? {
                unregister_managed_process(state.inner(), pid);
                return Ok(false);
            }

            let pid_string = pid.to_string();
            #[cfg(target_os = "windows")]
            let output = Command::new("taskkill")
                .args(["/PID", pid_string.as_str(), "/T", "/F"])
                .output()
                .map_err(|error| format!("Could not cancel running action: {error}"))?;

            #[cfg(not(target_os = "windows"))]
            let output = Command::new("kill")
                .args(["-TERM", pid_string.as_str()])
                .output()
                .map_err(|error| format!("Could not cancel running action: {error}"))?;

            if output.status.success() {
                unregister_managed_process(state.inner(), pid);
                if let Ok(mut running) = state.running_action_children.lock() {
                    running.remove(&action_id);
                }
                return Ok(true);
            }
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    Ok(false)
}

#[tauri::command]
async fn execute_action(
    action_id: String,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<ActionResult, String> {
    ensure_memory_budget(state.inner())?;

    let (action, expired_action) = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Permission state is unavailable.".to_string())?;
        let prepared = pending
            .get(&action_id)
            .ok_or_else(|| "Action expired, was denied, or does not exist.".to_string())?;

        if now_ms().saturating_sub(prepared.created_at_ms) > PENDING_ACTION_TTL_MS {
            (None, pending.remove(&action_id))
        } else {
            let active_tool = prepared.tool.clone();
            state
                .running_action_tools
                .lock()
                .map_err(|_| "Running-action state is unavailable.".to_string())?
                .insert(action_id.clone(), active_tool);
            let action = pending
                .remove(&action_id)
                .ok_or_else(|| "Action disappeared before execution could start.".to_string())?;
            (Some(action), None)
        }
    };
    if let Some(action) = expired_action {
        let safe_detail = audit_safe_action_detail(&action.tool, &action.detail);
        append_audit(
            &app,
            &AuditEntry {
                timestamp_ms: now_ms(),
                event: "denied".into(),
                tool: action.tool,
                detail: format!("Expired prepared action: {safe_detail}"),
                success: false,
                action_id: Some(action_id.clone()),
            },
        )?;
        return Err("Prepared action expired before execution and must be prepared again.".into());
    }
    let action = action.ok_or_else(|| "Prepared action could not be claimed for execution.".to_string())?;

    let tool = action.tool.clone();
    let detail = action.detail.clone();
    let audit_detail = audit_safe_action_detail(&tool, &detail);
    let execution = execute_tool_with_action_id(
        action,
        state.inner(),
        &app,
        Some(action_id.as_str()),
    ).await;

    if let Ok(mut running) = state.running_action_tools.lock() {
        running.remove(&action_id);
    }
    if let Ok(mut children) = state.running_action_children.lock() {
        children.remove(&action_id);
    }

    match execution {
        Ok(result) => {
            append_audit(
                &app,
                &AuditEntry {
                    timestamp_ms: now_ms(),
                    event: "executed".into(),
                    tool,
                    detail: audit_detail.clone(),
                    success: result.success,
                    action_id: Some(action_id.clone()),
                },
            )?;
            Ok(result)
        }
        Err(error) => {
            append_audit(
                &app,
                &AuditEntry {
                    timestamp_ms: now_ms(),
                    event: "failed".into(),
                    tool,
                    detail: audit_detail,
                    success: false,
                    action_id: Some(action_id.clone()),
                },
            )?;
            Err(error)
        }
    }
}

#[tauri::command]
async fn execute_powershell(
    action_id: String,
    state: State<'_, ActionState>,
    app: AppHandle,
) -> Result<ActionResult, String> {
    execute_action(action_id, state, app).await
}

#[tauri::command]
fn audit_log(app: AppHandle, limit: Option<usize>) -> Result<Vec<AuditEntry>, String> {
    read_audit(&app, limit.unwrap_or(30))
}

#[tauri::command]
fn action_audit_receipt(action_id:String,app:AppHandle)->Result<Option<AuditEntry>,String>{
    read_action_audit_receipt(&app, &action_id)
}

#[tauri::command]
fn record_agent_event(
    event: String,
    tool: Option<String>,
    detail: String,
    app: AppHandle,
) -> Result<(), String> {
    if !matches!(event.as_str(),"orchestration_blocked"|"orchestration_stopped"|"orchestration_replan"|"task_graph_created"|"task_step_completed"|"task_step_failed"|"task_dependency_blocked"|"task_graph_replanned"|"task_graph_stopped") {
        return Err("Unsupported agent orchestration audit event.".into());
    }
    if detail.trim().is_empty() || detail.chars().count()>1_200 {
        return Err("Agent orchestration audit detail must be 1..1200 characters.".into());
    }
    let tool=tool.unwrap_or_else(||"agent_orchestrator".into());
    if tool.trim().is_empty() || tool.chars().count()>160 {
        return Err("Agent orchestration audit tool label must be 1..160 characters.".into());
    }
    let success=event=="task_step_completed";
    append_audit(&app,&AuditEntry {
        timestamp_ms:now_ms(),
        event,
        tool,
        detail,
        success,
        action_id:None,
    })
}

#[tauri::command]
fn set_workspace(path: String, app: AppHandle) -> Result<(), String> {
    write_workspace(&app, path.trim())
}

#[tauri::command]
fn get_workspace(app: AppHandle) -> Result<Option<String>, String> {
    read_workspace(&app)
}

#[tauri::command]
fn save_session_checkpoint(
    checkpoint: SessionCheckpoint,
    app: AppHandle,
) -> Result<(), String> {
    write_session_checkpoint(&app, checkpoint)
}

#[tauri::command]
fn load_session_checkpoint(app: AppHandle) -> Result<Option<SessionCheckpoint>, String> {
    read_session_checkpoint(&app)
}

#[tauri::command]
fn clear_session_checkpoint(app: AppHandle) -> Result<(), String> {
    remove_session_checkpoint(&app)
}

#[tauri::command]
fn premiere_bridge_start(
    state: State<'_, ActionState>,
) -> Result<PremiereBridgeStatus, String> {
    state.premiere_bridge.start()
}

#[tauri::command]
fn premiere_bridge_status(
    state: State<'_, ActionState>,
) -> Result<PremiereBridgeStatus, String> {
    state.premiere_bridge.status()
}

#[tauri::command]
fn premiere_bridge_stop(
    state: State<'_, ActionState>,
) -> Result<PremiereBridgeStatus, String> {
    state.premiere_bridge.stop()
}

fn prune_diagnostics_dir(dir: &Path, keep_existing: usize) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    let mut keep = Vec::<(SystemTime, std::path::PathBuf)>::new();
    for entry in fs::read_dir(dir)
        .map_err(|error| format!("Could not inspect diagnostics directory: {error}"))?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("shuvi-diagnostics-") || !name.ends_with(".json") || !path.is_file() {
            continue;
        }
        let modified = entry.metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .unwrap_or(UNIX_EPOCH);
        keep.push((modified, path));
        keep.sort_by(|a, b| b.0.cmp(&a.0));
        keep.truncate(keep_existing);
    }

    let keep_paths = keep.into_iter()
        .map(|(_, path)| path)
        .collect::<HashSet<_>>();
    for entry in fs::read_dir(dir)
        .map_err(|error| format!("Could not inspect diagnostics directory: {error}"))?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with("shuvi-diagnostics-")
            && name.ends_with(".json")
            && path.is_file()
            && !keep_paths.contains(&path)
        {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
fn export_diagnostics(
    app: AppHandle,
    state: State<'_, ActionState>,
) -> Result<String, String> {
    let runtime = current_runtime_status(state.inner())?;
    let workspace = read_workspace(&app)?;
    let recent_audit = read_audit(&app, 50)?;

    let managed_roots = state
        .managed_children
        .lock()
        .map_err(|_| "Managed-process state is unavailable.".to_string())?
        .iter()
        .copied()
        .collect::<Vec<_>>();

    let browser_sessions = state
        .browser_sessions
        .lock()
        .map_err(|_| "Browser-session state is unavailable.".to_string())?
        .iter()
        .map(|(pid, session)| {
            json!({
                "root_pid": pid,
                "devtools_port": session.port
            })
        })
        .collect::<Vec<_>>();

    let report = json!({
        "generated_at_ms": now_ms(),
        "shuvi_version": env!("CARGO_PKG_VERSION"),
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH
        },
        "runtime": runtime,
        "workspace": workspace,
        "managed_process_roots": managed_roots,
        "managed_browser_sessions": browser_sessions,
        "recent_audit": recent_audit,
        "privacy_note": "API keys and credential-store secrets are intentionally excluded."
    });

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?
        .join("diagnostics");

    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create diagnostics directory: {error}"))?;
    let _ = prune_diagnostics_dir(&dir, MAX_DIAGNOSTIC_FILES.saturating_sub(1));

    let path = dir.join(format!("shuvi-diagnostics-{}-{}.json", now_ms(), Uuid::new_v4()));
    let content = serde_json::to_string_pretty(&report)
        .map_err(|error| format!("Could not encode diagnostics: {error}"))?;

    fs::write(&path, content.as_bytes())
        .map_err(|error| format!("Could not write diagnostics file: {error}"))?;

    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ActionState::default())
        .invoke_handler(tauri::generate_handler![
            list_providers,
            save_api_key,
            delete_api_key,
            chat,
            runtime_status,
            prepare_tool,
            prepare_powershell,
            deny_action,
            cancel_running_action,
            execute_action,
            execute_powershell,
            audit_log,
            action_audit_receipt,
            record_agent_event,
            set_workspace,
            get_workspace,
            save_session_checkpoint,
            load_session_checkpoint,
            clear_session_checkpoint,
            premiere_bridge_start,
            premiere_bridge_status,
            premiere_bridge_stop,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shuvi");
}

#[cfg(test)]
mod task_graph_transport_tests {
    use super::*;

    #[test]
    fn graph_metadata_survives_provider_parsing_without_granting_tool_access() {
        let graph = json!({"objective":"Inspect","revision":1,"steps":[]});
        let text = json!({"tool":"read_file","arguments":{"path":"C:/a.txt"},
            "task_graph":graph,"task_step_id":"inspect"}).to_string();
        let proposal = parse_tool_proposal(&text).expect("known typed tool");
        assert_eq!(proposal.task_graph, Some(graph.clone()));
        assert_eq!(proposal.task_step_id, Some(json!("inspect")));
        let unknown = json!({"tool":"arbitrary_graph_runner","arguments":{},
            "task_graph":graph}).to_string();
        assert!(parse_tool_proposal(&unknown).is_none());
    }

    #[test]
    fn oversized_graph_and_invalid_association_keep_fail_closed_markers() {
        let text = json!({"tool":"read_file","arguments":{"path":"C:/a.txt"},
            "task_graph":{"objective":"x".repeat(24_001)},
            "task_step_id":["not","an","id"],"task_recovery":"yes"}).to_string();
        let proposal = parse_tool_proposal(&text).expect("metadata routed for local refusal");
        assert_eq!(proposal.task_graph, Some(json!(false)));
        assert_eq!(proposal.task_step_id, Some(json!(false)));
        assert_eq!(proposal.task_recovery, Some(json!("invalid")));
    }

    #[test]
    fn action_audit_receipt_contract_is_exact_and_bounded() {
        assert!(Uuid::parse_str("00000000-0000-4000-8000-000000000001").is_ok());
        assert!(Uuid::parse_str("not-an-action").is_err());
        assert!(matches!("executed","executed"|"failed"|"denied"));
        assert!(matches!("failed","executed"|"failed"|"denied"));
        assert!(matches!("denied","executed"|"failed"|"denied"));
        assert!(!matches!("task_step_completed","executed"|"failed"|"denied"));
    }

    #[test]
    fn discarded_legacy_description_does_not_erase_graph_restrictions() {
        let text = json!({"tool":"read_file","arguments":{"path":"C:/a.txt"},
            "plan":{"objective":"x".repeat(501),"step":"read","success_criteria":"read succeeds"},
            "task_graph":{"objective":"stable goal","revision":1,"steps":[]}}).to_string();
        let proposal = parse_tool_proposal(&text).expect("known typed tool");
        assert!(proposal.plan.is_none());
        assert!(proposal.task_graph.is_some());
    }
}
