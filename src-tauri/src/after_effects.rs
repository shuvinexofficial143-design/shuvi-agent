use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::path::Path;

const MAX_PROPERTY_DEPTH:usize=12;
const MAX_MATCH_NAME:usize=160;
const MAX_TRACK_SAMPLES:usize=10_000;
const MAX_SECONDS:f64=10_800.0;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub comp_id:u32,
    pub layer_id:Option<u32>,
}
impl Target {
    pub fn validate(&self)->Result<(),String>{
        if self.comp_id==0 || self.layer_id==Some(0) {
            return Err("After Effects target IDs must be non-zero persistent host IDs.".into());
        }
        Ok(())
    }
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertySegment {
    pub match_name:String,
    pub property_index:Option<u32>,
}
impl PropertySegment {
    fn validate(&self)->Result<(),String>{
        if self.match_name.is_empty() || self.match_name.len()>MAX_MATCH_NAME
            || self.match_name.chars().any(|c|c.is_control())
            || self.property_index==Some(0) || self.property_index.is_some_and(|v|v>10_000) {
            return Err("Invalid bounded After Effects property path segment.".into());
        }
        Ok(())
    }
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertyTarget {
    pub target:Target,
    pub path:Vec<PropertySegment>,
}
impl PropertyTarget {
    pub fn validate(&self)->Result<(),String>{
        self.target.validate()?;
        if self.target.layer_id.is_none() || self.path.is_empty() || self.path.len()>MAX_PROPERTY_DEPTH {
            return Err("After Effects property target requires one exact layer and a bounded property path.".into());
        }
        for part in &self.path {part.validate()?;}
        Ok(())
    }
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackSample {
    pub time_seconds:f64,
    pub point:Vec<f64>,
    #[serde(default)]
    pub confidence:Option<f64>,
}

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandTrackPlan {
    pub property:PropertyTarget,
    pub samples:Vec<TrackSample>,
    #[serde(default)]
    pub coordinate_space:Option<String>,
}
impl HandTrackPlan {
    pub fn validate(&self)->Result<(),String>{
        self.property.validate()?;
        if self.samples.is_empty() || self.samples.len()>MAX_TRACK_SAMPLES {
            return Err("Hand track requires 1..=10000 bounded samples.".into());
        }
        if self.coordinate_space.as_deref().is_some_and(|v|!matches!(v,"comp_pixels"|"layer_pixels")) {
            return Err("Hand track coordinate_space must be comp_pixels or layer_pixels.".into());
        }
        let mut previous=-1.0_f64;
        for sample in &self.samples {
            if !sample.time_seconds.is_finite() || !(0.0..=MAX_SECONDS).contains(&sample.time_seconds)
                || sample.time_seconds<=previous || !(sample.point.len()==2 || sample.point.len()==3)
                || sample.point.iter().any(|v|!v.is_finite() || v.abs()>1_000_000.0)
                || sample.confidence.is_some_and(|v|!v.is_finite() || !(0.0..=1.0).contains(&v)) {
                return Err("Invalid, non-monotonic or unbounded hand tracking sample.".into());
            }
            previous=sample.time_seconds;
        }
        Ok(())
    }
    pub fn summary(&self)->Result<Value,String>{
        self.validate()?;
        Ok(json!({
            "sample_count":self.samples.len(),
            "start_seconds":self.samples.first().map(|s|s.time_seconds),
            "end_seconds":self.samples.last().map(|s|s.time_seconds),
            "dimensions":self.samples.first().map(|s|s.point.len()),
            "coordinate_space":self.coordinate_space.as_deref().unwrap_or("comp_pixels"),
            "native_tracker_result_claimed":false,
            "write_route":"property_set_values_at_times_with_exact_readback"
        }))
    }
}

pub fn validate_project_path(path:&str)->Result<(),String>{
    if path.is_empty() || path.len()>4096 || path.chars().any(|c|c.is_control()) {
        return Err("After Effects project path is invalid or oversized.".into());
    }
    let p=Path::new(path);
    if !p.is_absolute() || !p.extension().and_then(|v|v.to_str()).is_some_and(|v|v.eq_ignore_ascii_case("aep")||v.eq_ignore_ascii_case("aepx")) {
        return Err("After Effects project path must be an absolute .aep or .aepx path.".into());
    }
    Ok(())
}

pub fn capability_report()->Value {
    json!({
        "schema_version":1,
        "source_runtime_verified":false,
        "current_transport":{
            "kind":"extendscript_afterfx_r",
            "state":"source_planned_unverified",
            "requires_afterfx_executable":true,
            "requires_script_file_access_for_bidirectional_receipts":true
        },
        "future_transport":{
            "kind":"uxp",
            "state":"announced_public_beta_not_currently_targeted",
            "adapter_boundary_reserved":true
        },
        "identity":{
            "project_item_id":"persistent_item_id",
            "layer_id":"persistent_layer_id_ae_22_plus",
            "property_identity":"match_name_plus_optional_property_index"
        },
        "features":{
            "inspect_project_comp_layers":"source_supported",
            "static_property_write":"source_supported_with_readback",
            "keyframe_write":"source_supported_with_readback",
            "bulk_tracking_keyframes":"source_supported_with_readback",
            "effect_add_by_match_name":"source_supported_with_delta_readback",
            "render_queue_inspection":"source_supported",
            "render_queue_item_add":"source_supported_with_delta_readback",
            "native_motion_tracker_control":"unsupported_documented_surface",
            "native_hand_detection":"not_provided_by_ae_scripting",
            "external_hand_tracking_apply":"source_supported_when_grounded_samples_are_supplied",
            "text_layer_create":"source_supported_with_readback",
            "expression_write":"source_supported_with_error_and_readback",
            "layer_parenting":"source_supported_with_parent_id_readback",
            "layer_duplicate":"source_supported_creation_identity_only",
            "layer_remove":"source_supported_with_absence_readback",
            "precompose_move_all_attributes":"source_supported_with_content_identity_readback",
            "mask_create":"source_supported_with_shape_readback",
            "scene_edit_detection_read":"source_supported",
            "scene_edit_markers":"source_supported_with_marker_delta_readback",
            "shape_layer_create":"source_supported_with_creation_identity",
            "solid_layer_create":"source_supported_with_source_dimension_readback",
            "camera_layer_create":"source_supported_with_creation_identity",
            "light_layer_create":"source_supported_with_creation_identity",
            "layer_state_write":"source_supported_with_readback",
            "layer_reorder":"source_supported_with_relative_index_readback",
            "track_matte":"source_supported_with_native_relationship_readback",
            "time_remap_toggle":"source_supported_with_readback",
            "source_replacement":"source_supported_with_source_item_id_readback",
            "composition_create":"source_supported_with_creation_settings_readback",
            "footage_import":"source_supported_footage_only_with_file_identity_readback",
            "project_item_layer_add":"source_supported_with_source_item_id_readback",
            "text_document_style":"source_supported_with_requested_field_readback",
            "keyframe_interpolation":"source_supported_with_in_out_type_readback",
            "keyframe_remove":"source_supported_with_time_stale_guard_and_delta_readback",
            "keyframe_temporal_ease":"source_supported_with_dimension_bound_speed_influence_readback",
            "layer_timing":"source_supported_with_start_in_out_stretch_readback",
            "effect_remove":"source_supported_with_ordered_inventory_delta",
            "marker_inspection":"source_supported_bounded_readback",
            "marker_add":"source_supported_with_time_value_delta_readback",
            "marker_remove":"source_supported_with_time_comment_stale_guard",
            "project_save_persistence":"source_supported_with_independent_file_fingerprint",
            "shape_primitive":"source_supported_rectangle_ellipse_with_fill_stroke_readback",
            "text_animator":"source_supported_allowlisted_property_with_range_selector_readback",
            "runtime_verified":"not_verified"
        },
        "safety":[
            "accepted transaction is not treated as verified state",
            "persistent comp/layer identity is rechecked before mutation",
            "property paths use stable matchName and optional propertyIndex stale guards",
            "uncertain mutation is not blindly retried",
            "native tracker results are never fabricated"
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn property()->PropertyTarget {
        PropertyTarget{
            target:Target{comp_id:12,layer_id:Some(34)},
            path:vec![
                PropertySegment{match_name:"ADBE Transform Group".into(),property_index:Some(1)},
                PropertySegment{match_name:"ADBE Position".into(),property_index:Some(2)}
            ]
        }
    }

    #[test]
    fn hand_track_requires_grounded_monotonic_bounded_samples(){
        let ok=HandTrackPlan{property:property(),coordinate_space:Some("comp_pixels".into()),samples:vec![
            TrackSample{time_seconds:0.0,point:vec![10.0,20.0],confidence:Some(0.9)},
            TrackSample{time_seconds:0.04,point:vec![11.0,21.0],confidence:Some(0.91)}
        ]};
        assert!(ok.validate().is_ok());
        let mut bad=ok.clone();bad.samples[1].time_seconds=0.0;assert!(bad.validate().is_err());
        let mut bad=ok.clone();bad.samples[0].confidence=Some(2.0);assert!(bad.validate().is_err());
        let mut bad=ok.clone();bad.samples[0].point=vec![1.0];assert!(bad.validate().is_err());
    }

    #[test]
    fn property_path_requires_exact_layer_and_bounded_match_names(){
        assert!(property().validate().is_ok());
        let mut bad=property();bad.target.layer_id=None;assert!(bad.validate().is_err());
        let mut bad=property();bad.path[0].match_name="x".repeat(MAX_MATCH_NAME+1);assert!(bad.validate().is_err());
    }

    #[test]
    fn capability_report_never_claims_runtime_or_native_hand_tracker(){
        let report=capability_report();
        assert_eq!(report["source_runtime_verified"],false);
        assert_eq!(report["features"]["native_motion_tracker_control"],"unsupported_documented_surface");
        assert_eq!(report["features"]["external_hand_tracking_apply"],"source_supported_when_grounded_samples_are_supplied");
        assert_eq!(report["features"]["runtime_verified"],"not_verified");
    }
}
