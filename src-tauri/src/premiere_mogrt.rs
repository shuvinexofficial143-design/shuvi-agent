use serde::Deserialize;
use serde_json::Value;
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct GraphicsField {
    pub role: String,
    pub component_match_name: Option<String>,
    pub component_display_name: Option<String>,
    pub param_display_name: String,
    pub value: Value,
}
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct GraphicsRequest { pub preset: String, pub fields: Vec<GraphicsField> }
impl GraphicsRequest {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.preset.as_str(), "title" | "lower_third") || self.fields.is_empty() || self.fields.len() > 16 {
            return Err("Graphics recipe requires title/lower_third and 1–16 fields.".into());
        }
        let name_ok = |s: &str| !s.trim().is_empty() && s.encode_utf16().count() <= 240;
        for field in &self.fields {
            if !matches!(field.role.as_str(), "text" | "title" | "subtitle" | "property")
                || !name_ok(&field.param_display_name)
                || field.component_match_name.is_none() && field.component_display_name.is_none()
                || [field.component_match_name.as_ref(), field.component_display_name.as_ref()].into_iter().flatten().any(|s| !name_ok(s)) {
                return Err("Graphics fields require supported roles and exact bounded selectors.".into());
            }
            match &field.value {
                Value::Bool(_) => {},
                Value::Number(v) if v.as_f64().is_some_and(f64::is_finite) => {},
                Value::String(v) if v.encode_utf16().count() <= 2048 => {},
                _ => return Err("Graphics values must be strings up to 2048 UTF-16 units, finite numbers or booleans; no coercion.".into()),
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_complex_oversized_and_unbounded_requests() {
        let mut request: GraphicsRequest = serde_json::from_value(serde_json::json!({"preset":"title","fields":[{"role":"text","component_match_name":"exact","param_display_name":"Text","value":"Hello"}]})).unwrap();
        request.validate().unwrap();
        request.fields[0].value = serde_json::json!({"text":"complex"}); assert!(request.validate().is_err());
        request.fields[0].value = serde_json::json!("x".repeat(2049)); assert!(request.validate().is_err());
        request.fields[0].value = serde_json::json!(true); request.validate().unwrap();
        request.fields = vec![request.fields[0].clone(); 17]; assert!(request.validate().is_err());
    }
}
