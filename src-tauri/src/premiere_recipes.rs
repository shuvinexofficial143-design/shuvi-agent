use serde::Deserialize;
use serde_json::Value;
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeBinding {
    pub role: String,
    pub component_match_name: Option<String>,
    pub component_display_name: Option<String>,
    pub param_display_name: String,
    pub start_value: Option<Value>,
    pub end_value: Option<Value>,
    pub unit: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecipePlanRequest {
    pub preset: String,
    pub bindings: Vec<RecipeBinding>,
    pub start_seconds: Option<f64>,
    pub end_seconds: Option<f64>,
    pub strength: Option<f64>,
}
impl RecipePlanRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.preset.is_empty() || self.preset.len() > 64 || self.bindings.is_empty() || self.bindings.len() > 16 {
            return Err("Recipe planning requires a preset and 1–16 inspected bindings.".into());
        }
        for binding in &self.bindings {
            if binding.role.is_empty() || binding.role.len() > 64 || binding.param_display_name.is_empty() || binding.param_display_name.len() > 960
                || binding.component_match_name.is_none() && binding.component_display_name.is_none()
                || [binding.component_match_name.as_ref(), binding.component_display_name.as_ref()].into_iter().flatten().any(|s| s.is_empty() || s.len() > 960)
                || [&binding.start_value, &binding.end_value].into_iter().flatten().any(|v| v.to_string().len() > 256) {
                return Err("Recipe bindings require bounded exact parameter selectors and values.".into());
            }
        }
        Ok(())
    }
}
