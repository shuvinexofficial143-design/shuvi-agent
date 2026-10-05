import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const model=readFileSync(new URL("../src-tauri/src/audition.rs",import.meta.url),"utf8");
const auditionAcceptance=readFileSync(new URL("../src-tauri/src/audition_acceptance.rs",import.meta.url),"utf8");
const bridge=readFileSync(new URL("../src-tauri/src/audition_bridge.rs",import.meta.url),"utf8");
const panel=readFileSync(new URL("../integrations/audition-cep/main.js",import.meta.url),"utf8");
const host=readFileSync(new URL("../integrations/audition-cep/jsx/ShuviAudition.jsx",import.meta.url),"utf8");
const manifest=readFileSync(new URL("../integrations/audition-cep/CSXS/manifest.xml",import.meta.url),"utf8");

test("Audition integration stays on CEP plus ExtendScript and localhost",()=>{
  assert.match(manifest,/Host Name="AUDT"/);
  assert.match(manifest,/Shuvi Audition Bridge/);
  assert.match(bridge,/AUDITION_BRIDGE_PORT: u16 = 17_362/);
  assert.match(panel,/http:\/\/127\.0\.0\.1:17362/);
  assert.match(model,/cep_plus_extendscript/);
  assert.match(model,/uxp_host_api/);
});

test("Audition host capability is discovered rather than guessed",()=>{
  assert.match(host,/Application\.reflect\.properties/);
  assert.match(host,/propertyName\.indexOf\("COMMAND_"\)/);
  assert.match(host,/app\.isCommandEnabled/);
  assert.match(host,/app\.invokeCommand/);
  assert.match(panel,/List Audition commands first/);
  assert.match(panel,/inspectedCommands/);
  assert.match(model,/property\.starts_with\("COMMAND_"\)/);
});

test("Audition playhead mutation requires native WaveDocument readback",()=>{
  assert.match(host,/doc\.reflect\.name != "WaveDocument"/);
  assert.match(host,/doc\.playheadPosition = expected/);
  assert.match(host,/Math\.abs\(observed - expected\) <= 1/);
  assert.match(host,/verified_playhead_readback/);
  assert.match(rust,/verificationStatus/);
  assert.match(rust,/verified_playhead_readback/);
});

test("Audition generic command effects never promote to verified state",()=>{
  assert.match(host,/accepted_unverified_command_side_effect/);
  assert.match(host,/retrySafe: false/);
  assert.match(rust,/"side_effect_verified":false/);
  assert.match(rust,/"retry_automatically":false/);
  assert.match(rust,/RiskLevel::High/);
});

test("Audition readiness is fail closed about unimplemented audio edits",()=>{
  assert.match(model,/source_runtime_verified":false/);
  assert.match(model,/production_ready":false/);
  assert.match(model,/noise_reduction_effect_write":"not_claimed"/);
  assert.match(model,/effect_parameter_dom":"not_claimed"/);
  assert.match(model,/multitrack_mix_write":"not_claimed"/);
});

test("Audition bridge uses bounded authenticated request routing",()=>{
  for(const action of ["inspect_context","list_commands","command_enabled","set_playhead_percent","invoke_command"]){
    assert.match(bridge,new RegExp('"' + action + '"'));
  }
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(panel,/deliveredCount >= 1024/);
  assert.match(panel,/body\.length > 220000/);
});


test("Audition Script Dictionary reflection is bounded and read only",()=>{
  assert.match(host,/\$\.dictionary\.getGroups\(\)/);
  assert.match(host,/\$\.dictionary\.getClasses/);
  assert.match(host,/\$\.dictionary\.getClass/);
  assert.match(host,/maxClasses < 1 \|\| maxClasses > 128/);
  assert.match(host,/shuviAuditionDictionaryMembers\(ref\.methods, 64\)/);
  assert.match(host,/readOnly: true/);
  assert.match(panel,/case "script_dictionary"/);
  assert.match(rust,/"audition_script_dictionary"/);
  assert.match(bridge,/"script_dictionary"/);
});

test("Script Dictionary discovery does not promote effect controls",()=>{
  assert.match(model,/effect_parameter_dom":"not_claimed"/);
  assert.match(model,/noise_reduction_effect_write":"not_claimed"/);
  assert.match(model,/multitrack_mix_write":"not_claimed"/);
  assert.doesNotMatch(rust,/AuditionSetEffect/);
});


test("Audition command search and document guards are bounded",()=>{
  assert.match(host,/function shuviAuditionSearchCommands/);
  assert.match(host,/matches\.length < 100/);
  assert.match(host,/documentSignature: "no_document"/);
  assert.match(host,/context\.documentSignature != expectedSignature/);
  assert.match(host,/Audition document changed; inspect context again/);
  assert.match(panel,/case "search_commands"/);
  assert.match(panel,/expectedDocumentSignature/);
  assert.match(rust,/"audition_search_commands"/);
  assert.match(rust,/expected_document_signature/);
  assert.match(rust,/"document_identity_guarded":true/);
});

test("Audition generic mutation still requires live inventory and unchanged document",()=>{
  assert.match(panel,/requireInspectedCommand\(args\)/);
  assert.match(host,/shuviAuditionResolveCommand\(args\.property, args\.value\)/);
  assert.match(host,/app\.isCommandEnabled\(commandValue\)/);
  assert.match(host,/expectedDocumentSignature: expectedSignature/);
  assert.match(host,/observedDocumentSignature: context\.documentSignature/);
  assert.match(host,/accepted_unverified_command_side_effect/);
});


test("Audition feature discovery remains read only and bounded",()=>{
  assert.match(rust,/"audition_discover_feature"/);
  assert.match(rust,/support_status":"discovery_only_not_verified"/);
  assert.match(rust,/mutation_performed":false/);
  assert.match(rust,/take\(20\)/);
  assert.match(rust,/take\(8\)/);
  assert.match(model,/feature_queries/);
  for(const feature of ["noise_reduction","eq","compressor","loudness","export","multitrack","voice_cleanup"]){
    assert.match(model,new RegExp('"' + feature + '"'));
  }
});

test("Script Dictionary query also searches bounded members and help",()=>{
  assert.match(host,/function shuviAuditionDictionaryClassMatches/);
  assert.match(host,/ref\.staticProperties, ref\.staticMethods, ref\.properties, ref\.methods/);
  assert.match(host,/Math\.min\(items\.length, 64\)/);
  assert.match(host,/member\.description/);
  assert.match(host,/shuviAuditionDictionaryClassMatches\(ref, className, query\)/);
});


test("Audition generic command records before-after context without semantic promotion",()=>{
  assert.match(host,/beforeContext: context/);
  assert.match(host,/afterContext: afterContext/);
  assert.match(host,/documentIdentityStableAfter/);
  assert.match(host,/verificationStatus: "accepted_unverified_command_side_effect"/);
  assert.match(host,/runtimeVerified: false/);
});


test("Audition runtime probe is read only and does not promote edit readiness",()=>{
  assert.match(rust,/"audition_runtime_probe"/);
  assert.match(rust,/"runtime_probe_completed":true/);
  assert.match(rust,/"mutation_performed":false/);
  assert.match(rust,/"edit_runtime_verified":false/);
  assert.match(rust,/"production_ready":false/);
  assert.match(rust,/"support_proven":false/);
});


test("Audition feature command invocation requires live semantic membership",()=>{
  assert.match(rust,/"audition_invoke_feature_command"/);
  assert.match(rust,/feature_membership_rechecked":true/);
  assert.match(rust,/command_enabled_rechecked":true/);
  assert.match(rust,/semantic_audio_effect_verified":false/);
  assert.match(rust,/matched_queries/);
  assert.match(rust,/Exact Audition command is not present in the current live discovery results/);
  assert.match(rust,/retry_automatically":false/);
});

test("Audition feature command route preserves stale-document protection",()=>{
  assert.match(rust,/expected_document_signature/);
  assert.match(rust,/audition::validate_document_signature/);
  assert.match(rust,/expectedDocumentSignature/);
  assert.match(rust,/document_identity_guarded":true/);
  assert.match(panel,/requireInspectedCommand\(args\)/);
  assert.match(host,/context\.documentSignature != expectedSignature/);
});


test("Audition feature discovery returns bounded ranked candidates without semantic promotion",()=>{
  assert.match(model,/pub fn rank_feature_commands/);
  assert.match(model,/ranked\.truncate\(32\)/);
  assert.match(rust,/candidate_commands/);
  assert.match(rust,/candidate_ranking_status":"keyword_evidence_only_not_semantic_verification"/);
  assert.match(rust,/audition::rank_feature_commands/);
});


test("Audition runtime probe returns bounded ranked candidates without claiming semantics",()=>{
  assert.match(rust,/top_command_candidates/);
  assert.match(rust,/candidate_semantics_verified":false/);
  assert.match(rust,/audition::rank_feature_commands/);
  assert.match(rust,/into_iter\(\)\.take\(5\)/);
  assert.match(rust,/support_proven":false/);
});


test("Audition document signature includes host version",()=>{
  assert.match(host,/\[out\.hostVersion \|\| "", out\.documentType/);
  assert.match(host,/documentSignature/);
  assert.match(host,/Audition document changed; inspect context again/);
});


test("Audition disposable acceptance registration never enables mutation automatically",()=>{
  assert.match(auditionAcceptance,/explicitly_disposable/);
  assert.match(auditionAcceptance,/Explicit disposable Audition document authorization is required/);
  assert.match(auditionAcceptance,/document_signature/);
  assert.match(auditionAcceptance,/Current Audition host\/document does not match/);
  assert.match(auditionAcceptance,/mutation_enabled_automatically":false/);
  assert.match(auditionAcceptance,/execute_one_approved_candidate/);
  assert.match(auditionAcceptance,/implemented":false/);
  assert.match(rust,/"audition_acceptance_register_disposable"/);
  assert.match(rust,/audition_acceptance::Registration::from_context/);
});

test("Audition acceptance plan remains read only before future execution support",()=>{
  assert.match(rust,/"audition_acceptance_plan"/);
  assert.match(rust,/"audition_acceptance_status"/);
  assert.match(rust,/verified_current_host_identity":true/);
  assert.match(rust,/mutation_enabled_automatically":false/);
  assert.doesNotMatch(rust,/AuditionAcceptanceExecute/);
});


test("Audition acceptance preflight is read only and exact-identity guarded",()=>{
  assert.match(rust,/"audition_acceptance_preflight"/);
  assert.match(rust,/AuditionAcceptancePreflight/);
  assert.match(rust,/Register an explicitly disposable Audition document before acceptance preflight/);
  assert.match(rust,/registration\.check\(&context\)/);
  assert.match(rust,/identity_rechecked_after_discovery":true/);
  assert.match(rust,/enabled_candidate_count/);
  assert.match(rust,/candidate_semantics_verified":false/);
  assert.match(rust,/mutation_authorized":false/);
  assert.match(rust,/mutation_performed":false/);
  assert.match(model,/acceptance_read_only_preflight":true/);
});
