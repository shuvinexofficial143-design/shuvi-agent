use serde_json::{json,Value};
use reqwest::Url;

pub const API_ORIGIN:&str="https://api.frame.io";
pub const ME_PATH:&str="/v4/me";
pub const ACCOUNTS_PATH:&str="/v4/accounts";
const MAX_ACCESS_TOKEN_BYTES:usize=16*1024;
const MAX_ACCOUNT_SUMMARY:usize=100;

pub fn validate_access_token(token:&str)->Result<(),String>{
    if token.is_empty()||token.len()>MAX_ACCESS_TOKEN_BYTES{
        return Err("Frame.io access token must be non-empty and at most 16 KB.".into());
    }
    if token.trim()!=token||token.chars().any(|c|c.is_control()||c.is_whitespace()){
        return Err("Frame.io access token must not contain whitespace or control characters.".into());
    }
    Ok(())
}

pub fn api_url(path:&str)->Result<Url,String>{
    if !matches!(path,ME_PATH|ACCOUNTS_PATH){
        return Err("Frame.io 20% foundation allows only /v4/me and /v4/accounts.".into());
    }
    let url=Url::parse(&format!("{API_ORIGIN}{path}"))
        .map_err(|e|format!("Could not build Frame.io V4 URL: {e}"))?;
    if url.scheme()!="https"||url.host_str()!=Some("api.frame.io")||url.port().is_some(){
        return Err("Frame.io API URL must remain pinned to https://api.frame.io.".into());
    }
    Ok(url)
}

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"frame_io",
        "source_milestone_percent":20,
        "source_scope_complete":false,
        "service_type":"adobe_included_web_api",
        "api_generation":"v4",
        "api_origin":API_ORIGIN,
        "auth_model":"adobe_ims_oauth2_bearer",
        "implemented":{
            "secure_access_token_storage":true,
            "credential_status_without_secret_exposure":true,
            "strict_api_origin_binding":true,
            "read_only_identity_preflight":true,
            "current_user_endpoint":ME_PATH,
            "accounts_endpoint":ACCOUNTS_PATH
        },
        "not_implemented":{
            "oauth_authorization_flow":true,
            "automatic_token_refresh":true,
            "project_listing":true,
            "workspace_listing":true,
            "asset_listing":true,
            "comments":true,
            "uploads":true,
            "shares":true,
            "project_or_asset_mutation":true,
            "runtime_acceptance":true
        },
        "source_runtime_verified":false,
        "production_ready":false
    })
}

pub fn readiness_report()->Value{
    json!({
        "schema_version":1,
        "integration":"frame_io",
        "source_milestone_percent":20,
        "source_coding_status":"v4_auth_and_identity_foundation_complete",
        "api_origin":API_ORIGIN,
        "auth_model":"adobe_ims_oauth2_bearer",
        "read_only_preflight_endpoints":[ME_PATH,ACCOUNTS_PATH],
        "credential_store":"windows_native_keyring",
        "oauth_flow_implemented":false,
        "project_automation_ready":false,
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"add Adobe IMS OAuth user-auth flow and bounded account/project discovery while keeping all write operations blocked"
    })
}

fn bounded_text(value:Option<&str>,label:&str)->Result<Option<String>,String>{
    let Some(value)=value else{return Ok(None);};
    if value.len()>512||value.chars().any(char::is_control){
        return Err(format!("Frame.io {label} is oversized or contains control characters."));
    }
    Ok(Some(value.to_string()))
}

pub fn summarize_identity(me:&Value,accounts:&Value)->Result<Value,String>{
    let user_id=me.get("user_id").and_then(Value::as_str)
        .ok_or("Frame.io /v4/me response is missing user_id.")?;
    if user_id.is_empty()||user_id.len()>512||user_id.chars().any(char::is_control){
        return Err("Frame.io user_id is empty, oversized, or contains control characters.".into());
    }

    let data=accounts.get("data").and_then(Value::as_array)
        .ok_or("Frame.io /v4/accounts response is missing data array.")?;
    if data.len()>MAX_ACCOUNT_SUMMARY{
        return Err("Frame.io account response exceeds Shuvi's bounded account summary limit.".into());
    }
    let mut account_summaries=Vec::with_capacity(data.len());
    for account in data{
        let id=account.get("id").and_then(Value::as_str)
            .ok_or("Frame.io account entry is missing id.")?;
        if id.is_empty()||id.len()>512||id.chars().any(char::is_control){
            return Err("Frame.io account id is empty, oversized, or contains control characters.".into());
        }
        let display_name=bounded_text(account.get("display_name").and_then(Value::as_str),"account display_name")?;
        let roles=account.get("roles").and_then(Value::as_array).map(|values|{
            values.iter().filter_map(Value::as_str).take(16).map(str::to_string).collect::<Vec<_>>()
        }).unwrap_or_default();
        account_summaries.push(json!({
            "account_id":id,
            "display_name":display_name,
            "roles":roles
        }));
    }

    Ok(json!({
        "schema_version":1,
        "integration":"frame_io",
        "api_generation":"v4",
        "user_id":user_id,
        "account_count":account_summaries.len(),
        "accounts":account_summaries,
        "preflight_verified":true,
        "write_operations_performed":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}

#[cfg(test)]
mod tests{
    use super::*;

    #[test]
    fn access_token_validation_is_secret_shape_only(){
        assert!(validate_access_token("abc.def_123-XYZ").is_ok());
        assert!(validate_access_token("").is_err());
        assert!(validate_access_token(" has-space").is_err());
        assert!(validate_access_token("line\nbreak").is_err());
    }

    #[test]
    fn api_urls_are_pinned_to_frame_io_v4_identity_surfaces(){
        assert_eq!(api_url(ME_PATH).unwrap().as_str(),"https://api.frame.io/v4/me");
        assert_eq!(api_url(ACCOUNTS_PATH).unwrap().as_str(),"https://api.frame.io/v4/accounts");
        assert!(api_url("/v4/projects").is_err());
        assert!(api_url("https://evil.example").is_err());
    }

    #[test]
    fn identity_summary_is_read_only_and_bounded(){
        let me=json!({"user_id":"user-1","name":"Example","email":"not-returned@example.com"});
        let accounts=json!({"data":[{"id":"account-1","display_name":"Team","roles":["admin"]}]});
        let value=summarize_identity(&me,&accounts).unwrap();
        assert_eq!(value["user_id"],"user-1");
        assert_eq!(value["account_count"],1);
        assert_eq!(value["accounts"][0]["account_id"],"account-1");
        assert!(value.get("email").is_none());
        assert_eq!(value["write_operations_performed"],false);
        assert_eq!(value["source_runtime_verified"],false);
        assert_eq!(value["production_ready"],false);
    }

    #[test]
    fn reports_twenty_percent_without_runtime_claims(){
        let cap=capability_report();
        assert_eq!(cap["source_milestone_percent"],20);
        assert_eq!(cap["source_scope_complete"],false);
        assert_eq!(cap["source_runtime_verified"],false);
        assert_eq!(cap["production_ready"],false);
        let ready=readiness_report();
        assert_eq!(ready["oauth_flow_implemented"],false);
        assert_eq!(ready["project_automation_ready"],false);
    }
}
