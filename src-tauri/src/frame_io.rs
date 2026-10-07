use base64::{engine::general_purpose::URL_SAFE_NO_PAD,Engine as _};
use reqwest::Url;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use uuid::Uuid;

pub const API_ORIGIN:&str="https://api.frame.io";
pub const ME_PATH:&str="/v4/me";
pub const ACCOUNTS_PATH:&str="/v4/accounts";
pub const IMS_AUTHORIZE_URL:&str="https://ims-na1.adobelogin.com/ims/authorize/v2";
pub const IMS_TOKEN_URL:&str="https://ims-na1.adobelogin.com/ims/token/v3";
pub const OAUTH_SCOPES:&str="openid,email,profile,offline_access,additional_info.roles";
const MAX_ACCESS_TOKEN_BYTES:usize=16*1024;
const MAX_OAUTH_FIELD_BYTES:usize=4096;
const MAX_RESOURCE_ID_BYTES:usize=512;
const MAX_SUMMARY_ITEMS:usize=100;
const MAX_PENDING_AGE_SECONDS:u64=15*60;
pub const TOKEN_REFRESH_SKEW_SECONDS:u64=60;

pub fn validate_access_token(token:&str)->Result<(),String>{
    if token.is_empty()||token.len()>MAX_ACCESS_TOKEN_BYTES{
        return Err("Frame.io access token must be non-empty and at most 16 KB.".into());
    }
    if token.trim()!=token||token.chars().any(|c|c.is_control()||c.is_whitespace()){
        return Err("Frame.io access token must not contain whitespace or control characters.".into());
    }
    Ok(())
}

pub fn validate_refresh_token(token:&str)->Result<(),String>{
    validate_access_token(token).map_err(|_|"Frame.io refresh token has an invalid secret shape.".to_string())
}

pub fn validate_client_id(value:&str)->Result<(),String>{
    if value.is_empty()||value.len()>512||value.chars().any(|c|c.is_control()||c.is_whitespace()){
        return Err("Frame.io OAuth client_id must be non-empty, whitespace-free, and at most 512 bytes.".into());
    }
    Ok(())
}

pub fn validate_redirect_uri(value:&str)->Result<(),String>{
    if value.is_empty()||value.len()>2048||value.chars().any(char::is_control){
        return Err("Frame.io OAuth redirect URI is empty, oversized, or contains control characters.".into());
    }
    let url=Url::parse(value).map_err(|_|"Frame.io OAuth redirect URI must be an absolute URI.".to_string())?;
    if !url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some(){
        return Err("Frame.io OAuth redirect URI must not contain credentials, query, or fragment.".into());
    }
    let native_custom=url.scheme().starts_with("adobe+")&&url.host_str()==Some("callback");
    let loopback=url.scheme()=="http"&&url.host_str()==Some("127.0.0.1")&&url.port().is_some()&&url.path()=="/callback";
    if !native_custom&&!loopback{
        return Err("Frame.io Native App redirect must be an Adobe-assigned adobe+...://callback URI or http://127.0.0.1:<port>/callback for local development.".into());
    }
    Ok(())
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OAuthConfig{
    pub client_id:String,
    pub redirect_uri:String,
}

impl OAuthConfig{
    pub fn validate(&self)->Result<(),String>{
        validate_client_id(&self.client_id)?;
        validate_redirect_uri(&self.redirect_uri)
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OAuthPending{
    pub state:String,
    pub code_verifier:String,
    pub created_at_unix:u64,
    pub client_id:String,
    pub redirect_uri:String,
}

impl OAuthPending{
    pub fn validate(&self)->Result<(),String>{
        validate_client_id(&self.client_id)?;
        validate_redirect_uri(&self.redirect_uri)?;
        if !valid_pkce_verifier(&self.code_verifier){
            return Err("Frame.io stored PKCE code verifier is invalid.".into());
        }
        if !valid_state(&self.state){
            return Err("Frame.io stored OAuth state is invalid.".into());
        }
        Ok(())
    }
}

#[derive(Debug,Clone)]
pub struct OAuthTokens{
    pub access_token:String,
    pub refresh_token:Option<String>,
    pub expires_in:u64,
}

fn valid_state(value:&str)->bool{
    (32..=128).contains(&value.len())&&value.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'-'|'_'|'.'))
}

fn valid_pkce_verifier(value:&str)->bool{
    (43..=128).contains(&value.len())&&value.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'-'|'_'|'.'|'~'))
}

fn valid_authorization_code(value:&str)->bool{
    !value.is_empty()&&value.len()<=MAX_OAUTH_FIELD_BYTES&&!value.chars().any(|c|c.is_control()||c.is_whitespace())
}

pub fn generate_oauth_begin(config:&OAuthConfig,created_at_unix:u64)->Result<(OAuthPending,String),String>{
    config.validate()?;
    let code_verifier=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
    let state=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
    if !valid_pkce_verifier(&code_verifier)||!valid_state(&state){
        return Err("Could not generate bounded Frame.io OAuth PKCE material.".into());
    }
    let digest=Sha256::digest(code_verifier.as_bytes());
    let code_challenge=URL_SAFE_NO_PAD.encode(digest);
    let mut url=Url::parse(IMS_AUTHORIZE_URL).map_err(|e|format!("Invalid Adobe IMS authorize URL: {e}"))?;
    url.query_pairs_mut()
        .append_pair("client_id",&config.client_id)
        .append_pair("code_challenge",&code_challenge)
        .append_pair("code_challenge_method","S256")
        .append_pair("redirect_uri",&config.redirect_uri)
        .append_pair("scope",OAUTH_SCOPES)
        .append_pair("state",&state)
        .append_pair("response_type","code");
    Ok((OAuthPending{
        state,
        code_verifier,
        created_at_unix,
        client_id:config.client_id.clone(),
        redirect_uri:config.redirect_uri.clone(),
    },url.to_string()))
}

fn same_redirect_target(expected:&Url,observed:&Url)->bool{
    expected.scheme()==observed.scheme()
        &&expected.host_str()==observed.host_str()
        &&expected.port_or_known_default()==observed.port_or_known_default()
        &&expected.path()==observed.path()
}

pub fn validate_oauth_callback(
    config:&OAuthConfig,
    pending:&OAuthPending,
    callback_url:&str,
    now_unix:u64
)->Result<String,String>{
    config.validate()?;
    pending.validate()?;
    if pending.client_id!=config.client_id||pending.redirect_uri!=config.redirect_uri{
        return Err("Frame.io OAuth pending request no longer matches the configured Native App credential.".into());
    }
    if now_unix<pending.created_at_unix||now_unix.saturating_sub(pending.created_at_unix)>MAX_PENDING_AGE_SECONDS{
        return Err("Frame.io OAuth pending request expired; start a new authorization flow.".into());
    }
    if callback_url.is_empty()||callback_url.len()>MAX_OAUTH_FIELD_BYTES||callback_url.chars().any(char::is_control){
        return Err("Frame.io OAuth callback URL is empty, oversized, or contains control characters.".into());
    }
    let expected=Url::parse(&config.redirect_uri).map_err(|_|"Configured Frame.io redirect URI is invalid.".to_string())?;
    let observed=Url::parse(callback_url).map_err(|_|"Frame.io OAuth callback must be an absolute URI.".to_string())?;
    if !same_redirect_target(&expected,&observed){
        return Err("Frame.io OAuth callback target does not match the configured redirect URI.".into());
    }
    let mut states=observed.query_pairs().filter(|(k,_)|k=="state").map(|(_,v)|v.into_owned());
    let state=states.next().ok_or("Frame.io OAuth callback is missing state.")?;
    if states.next().is_some()||state!=pending.state{
        return Err("Frame.io OAuth callback state mismatch.".into());
    }
    if let Some(error)=observed.query_pairs().find(|(k,_)|k=="error").map(|(_,v)|v.into_owned()){
        return Err(format!("Adobe IMS authorization returned an OAuth error: {error}"));
    }
    let mut codes=observed.query_pairs().filter(|(k,_)|k=="code").map(|(_,v)|v.into_owned());
    let code=codes.next().ok_or("Frame.io OAuth callback is missing authorization code.")?;
    if codes.next().is_some()||!valid_authorization_code(&code){
        return Err("Frame.io OAuth authorization code is duplicated or invalid.".into());
    }
    Ok(code)
}

pub fn oauth_token_url(client_id:&str)->Result<Url,String>{
    validate_client_id(client_id)?;
    let mut url=Url::parse(IMS_TOKEN_URL).map_err(|e|format!("Invalid Adobe IMS token URL: {e}"))?;
    url.query_pairs_mut().append_pair("client_id",client_id);
    Ok(url)
}

pub fn parse_oauth_token_response(body:&Value)->Result<OAuthTokens,String>{
    let token_type=body.get("token_type").and_then(Value::as_str)
        .ok_or("Adobe IMS token response is missing token_type.")?;
    if !token_type.eq_ignore_ascii_case("bearer"){
        return Err("Adobe IMS token response token_type is not bearer.".into());
    }
    let access_token=body.get("access_token").and_then(Value::as_str)
        .ok_or("Adobe IMS token response is missing access_token.")?.to_string();
    validate_access_token(&access_token)?;
    let refresh_token=body.get("refresh_token").and_then(Value::as_str).map(str::to_string);
    if let Some(value)=refresh_token.as_deref(){validate_refresh_token(value)?;}
    let expires_in=body.get("expires_in").and_then(Value::as_u64)
        .ok_or("Adobe IMS token response is missing numeric expires_in.")?;
    if expires_in==0||expires_in>7*24*60*60{
        return Err("Adobe IMS token response expires_in is outside Shuvi's bounded acceptance range.".into());
    }
    Ok(OAuthTokens{access_token,refresh_token,expires_in})
}

pub fn token_expiry_from(issued_at_unix:u64,expires_in:u64)->Result<u64,String>{
    if expires_in==0||expires_in>7*24*60*60{return Err("Frame.io token expires_in is outside Shuvi's bounded range.".into());}
    issued_at_unix.checked_add(expires_in).ok_or_else(||"Frame.io token expiry overflowed.".to_string())
}

pub fn access_token_needs_refresh(expires_at_unix:u64,now_unix:u64)->bool{
    expires_at_unix<=now_unix.saturating_add(TOKEN_REFRESH_SKEW_SECONDS)
}

pub fn api_url(path:&str)->Result<Url,String>{
    if !matches!(path,ME_PATH|ACCOUNTS_PATH){
        return Err("Frame.io identity API helper allows only /v4/me and /v4/accounts.".into());
    }
    let url=Url::parse(&format!("{API_ORIGIN}{path}"))
        .map_err(|e|format!("Could not build Frame.io V4 URL: {e}"))?;
    assert_api_origin(&url)?;
    Ok(url)
}

fn assert_api_origin(url:&Url)->Result<(),String>{
    if url.scheme()!="https"||url.host_str()!=Some("api.frame.io")||url.port().is_some()
        ||!url.username().is_empty()||url.password().is_some(){
        return Err("Frame.io API URL must remain pinned to https://api.frame.io.".into());
    }
    Ok(())
}

fn validate_resource_id(value:&str,label:&str)->Result<(),String>{
    if value.is_empty()||value.len()>MAX_RESOURCE_ID_BYTES
        ||value.chars().any(|c|c.is_control()||c.is_whitespace()||matches!(c,'/'|'\\'|'?'|'#')){
        return Err(format!("Frame.io {label} is empty, oversized, or contains unsafe path characters."));
    }
    Ok(())
}

fn resource_url(segments:&[&str])->Result<Url,String>{
    let mut url=Url::parse(API_ORIGIN).map_err(|e|format!("Invalid Frame.io API origin: {e}"))?;
    {
        let mut path=url.path_segments_mut().map_err(|_|"Frame.io API origin cannot accept path segments.".to_string())?;
        path.clear();
        for segment in segments{path.push(segment);}
    }
    assert_api_origin(&url)?;
    Ok(url)
}

pub fn workspaces_url(account_id:&str)->Result<Url,String>{
    validate_resource_id(account_id,"account_id")?;
    resource_url(&["v4","accounts",account_id,"workspaces"])
}

pub fn projects_url(account_id:&str,workspace_id:&str)->Result<Url,String>{
    validate_resource_id(account_id,"account_id")?;
    validate_resource_id(workspace_id,"workspace_id")?;
    resource_url(&["v4","accounts",account_id,"workspaces",workspace_id,"projects"])
}

pub fn folder_children_url(account_id:&str,folder_id:&str)->Result<Url,String>{
    validate_resource_id(account_id,"account_id")?;
    validate_resource_id(folder_id,"folder_id")?;
    let mut url=resource_url(&["v4","accounts",account_id,"folders",folder_id,"children"])?;
    url.query_pairs_mut().append_pair("page_size","50");
    Ok(url)
}

pub fn file_url(account_id:&str,file_id:&str)->Result<Url,String>{
    validate_resource_id(account_id,"account_id")?;
    validate_resource_id(file_id,"file_id")?;
    resource_url(&["v4","accounts",account_id,"files",file_id])
}

pub fn capability_report()->Value{
    json!({
        "schema_version":1,
        "integration":"frame_io",
        "source_milestone_percent":60,
        "source_scope_complete":false,
        "service_type":"adobe_included_web_api",
        "api_generation":"v4",
        "api_origin":API_ORIGIN,
        "auth_model":"adobe_ims_native_app_pkce",
        "implemented":{
            "secure_access_token_storage":true,
            "secure_refresh_token_storage":true,
            "credential_status_without_secret_exposure":true,
            "strict_api_origin_binding":true,
            "read_only_identity_preflight":true,
            "native_app_pkce_authorization_begin":true,
            "native_app_pkce_code_exchange":true,
            "explicit_refresh_token_exchange":true,
            "automatic_token_refresh_before_api_reads":true,
            "token_expiry_tracking":true,
            "client_secret_required":false,
            "workspace_listing":true,
            "project_listing":true,
            "folder_children_listing":true,
            "file_metadata_inspection":true
        },
        "not_implemented":{
            "os_custom_uri_handler_registration":true,
            "media_link_download":true,
            "comments":true,
            "uploads":true,
            "shares":true,
            "project_or_asset_mutation":true,
            "pagination_auto_follow":true,
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
        "source_milestone_percent":60,
        "source_coding_status":"token_freshness_and_read_only_asset_inspection_complete",
        "api_origin":API_ORIGIN,
        "auth_model":"adobe_ims_native_app_pkce",
        "oauth_authorize_endpoint":IMS_AUTHORIZE_URL,
        "oauth_token_endpoint":IMS_TOKEN_URL,
        "oauth_scopes":OAUTH_SCOPES,
        "credential_store":"windows_native_keyring",
        "oauth_flow_implemented":"native_app_pkce_manual_callback_completion",
        "explicit_refresh_implemented":true,
        "automatic_refresh_before_api_reads":true,
        "token_refresh_skew_seconds":TOKEN_REFRESH_SKEW_SECONDS,
        "project_automation_ready":"read_only_workspace_project_folder_and_file_inspection",
        "source_runtime_verified":false,
        "production_ready":false,
        "next_source_phase":"add bounded comments/review read surfaces and explicit pagination controls while keeping uploads, shares and all mutations blocked"
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
    validate_resource_id(user_id,"user_id")?;

    let data=accounts.get("data").and_then(Value::as_array)
        .ok_or("Frame.io /v4/accounts response is missing data array.")?;
    if data.len()>MAX_SUMMARY_ITEMS{
        return Err("Frame.io account response exceeds Shuvi's bounded account summary limit.".into());
    }
    let mut account_summaries=Vec::with_capacity(data.len());
    for account in data{
        let id=account.get("id").or_else(||account.get("account_id")).and_then(Value::as_str)
            .ok_or("Frame.io account entry is missing id/account_id.")?;
        validate_resource_id(id,"account id")?;
        let display_name=bounded_text(
            account.get("display_name").or_else(||account.get("name")).and_then(Value::as_str),
            "account display_name"
        )?;
        let roles=account.get("roles").and_then(Value::as_array).map(|values|{
            values.iter().filter_map(Value::as_str).take(16).filter(|v|v.len()<=128&&!v.chars().any(char::is_control))
                .map(str::to_string).collect::<Vec<_>>()
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

fn has_next_link(body:&Value)->bool{
    body.pointer("/links/next").and_then(Value::as_str).is_some_and(|v|!v.is_empty())
}

pub fn summarize_workspaces(account_id:&str,body:&Value)->Result<Value,String>{
    validate_resource_id(account_id,"account_id")?;
    let data=body.get("data").and_then(Value::as_array)
        .ok_or("Frame.io workspace response is missing data array.")?;
    if data.len()>MAX_SUMMARY_ITEMS{
        return Err("Frame.io workspace response exceeds Shuvi's bounded summary limit.".into());
    }
    let mut items=Vec::with_capacity(data.len());
    for workspace in data{
        let id=workspace.get("id").and_then(Value::as_str).ok_or("Frame.io workspace is missing id.")?;
        validate_resource_id(id,"workspace id")?;
        let name=bounded_text(workspace.get("name").and_then(Value::as_str),"workspace name")?;
        items.push(json!({"workspace_id":id,"name":name}));
    }
    Ok(json!({
        "schema_version":1,
        "integration":"frame_io",
        "account_id":account_id,
        "workspace_count":items.len(),
        "workspaces":items,
        "pagination_has_more":has_next_link(body),
        "pagination_auto_followed":false,
        "write_operations_performed":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}

pub fn summarize_projects(account_id:&str,workspace_id:&str,body:&Value)->Result<Value,String>{
    validate_resource_id(account_id,"account_id")?;
    validate_resource_id(workspace_id,"workspace_id")?;
    let data=body.get("data").and_then(Value::as_array)
        .ok_or("Frame.io project response is missing data array.")?;
    if data.len()>MAX_SUMMARY_ITEMS{
        return Err("Frame.io project response exceeds Shuvi's bounded summary limit.".into());
    }
    let mut items=Vec::with_capacity(data.len());
    for project in data{
        let id=project.get("id").and_then(Value::as_str).ok_or("Frame.io project is missing id.")?;
        validate_resource_id(id,"project id")?;
        let name=bounded_text(project.get("name").and_then(Value::as_str),"project name")?;
        let status=bounded_text(project.get("status").and_then(Value::as_str),"project status")?;
        let root_folder_id=project.get("root_folder_id").and_then(Value::as_str)
            .map(|v|{validate_resource_id(v,"root_folder_id")?;Ok::<String,String>(v.to_string())})
            .transpose()?;
        items.push(json!({
            "project_id":id,
            "name":name,
            "status":status,
            "root_folder_id":root_folder_id
        }));
    }
    Ok(json!({
        "schema_version":1,
        "integration":"frame_io",
        "account_id":account_id,
        "workspace_id":workspace_id,
        "project_count":items.len(),
        "projects":items,
        "pagination_has_more":has_next_link(body),
        "pagination_auto_followed":false,
        "write_operations_performed":false,
        "source_runtime_verified":false,
        "production_ready":false
    }))
}


fn bounded_optional_id(value:Option<&str>,label:&str)->Result<Option<String>,String>{
    value.map(|v|{validate_resource_id(v,label)?;Ok::<String,String>(v.to_string())}).transpose()
}
pub fn summarize_folder_children(account_id:&str,folder_id:&str,body:&Value)->Result<Value,String>{
    validate_resource_id(account_id,"account_id")?; validate_resource_id(folder_id,"folder_id")?;
    let data=body.get("data").and_then(Value::as_array).ok_or("Frame.io folder children response is missing data array.")?;
    if data.len()>MAX_SUMMARY_ITEMS{return Err("Frame.io folder children response exceeds Shuvi's bounded summary limit.".into());}
    let mut items=Vec::with_capacity(data.len());
    for child in data{
        let id=child.get("id").and_then(Value::as_str).ok_or("Frame.io folder child is missing id.")?; validate_resource_id(id,"folder child id")?;
        items.push(json!({"id":id,"type":bounded_text(child.get("type").and_then(Value::as_str),"folder child type")?,"name":bounded_text(child.get("name").and_then(Value::as_str),"folder child name")?,"media_type":bounded_text(child.get("media_type").and_then(Value::as_str),"file media_type")?,"status":bounded_text(child.get("status").and_then(Value::as_str),"file status")?,"file_size":child.get("file_size").and_then(Value::as_u64),"parent_id":bounded_optional_id(child.get("parent_id").and_then(Value::as_str),"parent_id")?,"project_id":bounded_optional_id(child.get("project_id").and_then(Value::as_str),"project_id")?}));
    }
    Ok(json!({"schema_version":1,"integration":"frame_io","account_id":account_id,"folder_id":folder_id,"child_count":items.len(),"children":items,"pagination_has_more":has_next_link(body),"pagination_auto_followed":false,"media_links_exposed":false,"write_operations_performed":false,"source_runtime_verified":false,"production_ready":false}))
}
pub fn summarize_file(account_id:&str,file_id:&str,body:&Value)->Result<Value,String>{
    validate_resource_id(account_id,"account_id")?; validate_resource_id(file_id,"file_id")?;
    let file=body.get("data").and_then(Value::as_object).ok_or("Frame.io file response is missing data object.")?;
    let observed_id=file.get("id").and_then(Value::as_str).ok_or("Frame.io file response is missing id.")?; validate_resource_id(observed_id,"file id")?;
    if observed_id!=file_id{return Err("Frame.io file response id does not match the requested file_id.".into());}
    Ok(json!({"schema_version":1,"integration":"frame_io","account_id":account_id,"file_id":observed_id,"name":bounded_text(file.get("name").and_then(Value::as_str),"file name")?,"media_type":bounded_text(file.get("media_type").and_then(Value::as_str),"file media_type")?,"status":bounded_text(file.get("status").and_then(Value::as_str),"file status")?,"file_size":file.get("file_size").and_then(Value::as_u64),"parent_id":bounded_optional_id(file.get("parent_id").and_then(Value::as_str),"parent_id")?,"project_id":bounded_optional_id(file.get("project_id").and_then(Value::as_str),"project_id")?,"media_links_exposed":false,"view_url_exposed":false,"write_operations_performed":false,"source_runtime_verified":false,"production_ready":false}))
}

#[cfg(test)]
mod tests{
    use super::*;

    fn config()->OAuthConfig{
        OAuthConfig{
            client_id:"client123".into(),
            redirect_uri:"adobe+abc123://callback".into()
        }
    }

    #[test]
    fn access_token_validation_is_secret_shape_only(){
        assert!(validate_access_token("abc.def_123-XYZ").is_ok());
        assert!(validate_access_token("").is_err());
        assert!(validate_access_token(" has-space").is_err());
        assert!(validate_access_token("line\nbreak").is_err());
    }

    #[test]
    fn native_redirects_and_pkce_are_bounded(){
        assert!(validate_redirect_uri("adobe+abc123://callback").is_ok());
        assert!(validate_redirect_uri("http://127.0.0.1:49152/callback").is_ok());
        assert!(validate_redirect_uri("https://example.com/callback").is_err());
        let (pending,url)=generate_oauth_begin(&config(),100).unwrap();
        assert!(url.starts_with(IMS_AUTHORIZE_URL));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(!url.contains(&pending.code_verifier));
        let callback=format!("adobe+abc123://callback?code=code123&state={}",pending.state);
        assert_eq!(validate_oauth_callback(&config(),&pending,&callback,101).unwrap(),"code123");
        assert!(validate_oauth_callback(&config(),&pending,&callback,100+MAX_PENDING_AGE_SECONDS+1).is_err());
    }

    #[test]
    fn api_urls_are_pinned_and_resource_segments_are_encoded(){
        assert_eq!(api_url(ME_PATH).unwrap().as_str(),"https://api.frame.io/v4/me");
        assert_eq!(api_url(ACCOUNTS_PATH).unwrap().as_str(),"https://api.frame.io/v4/accounts");
        assert_eq!(
            workspaces_url("adobe:org@example").unwrap().as_str(),
            "https://api.frame.io/v4/accounts/adobe:org@example/workspaces"
        );
        assert!(workspaces_url("../escape").is_err());
        assert!(projects_url("account","bad/id").is_err());
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
    }

    #[test]
    fn workspace_and_project_summaries_are_bounded_and_read_only(){
        let workspaces=json!({"data":[{"id":"ws-1","name":"Editorial"}],"links":{"next":"/next"}});
        let w=summarize_workspaces("acct-1",&workspaces).unwrap();
        assert_eq!(w["workspace_count"],1);
        assert_eq!(w["pagination_has_more"],true);
        assert_eq!(w["pagination_auto_followed"],false);
        let projects=json!({"data":[{"id":"proj-1","name":"Launch","status":"active","root_folder_id":"root-1"}]});
        let p=summarize_projects("acct-1","ws-1",&projects).unwrap();
        assert_eq!(p["project_count"],1);
        assert_eq!(p["projects"][0]["project_id"],"proj-1");
        assert_eq!(p["write_operations_performed"],false);
    }

    #[test]
    fn token_freshness_uses_sixty_second_skew(){
        assert_eq!(token_expiry_from(1_000,3_600).unwrap(),4_600);
        assert!(!access_token_needs_refresh(4_600,4_539));
        assert!(access_token_needs_refresh(4_600,4_540));
    }

    #[test]
    fn folder_and_file_inspection_omit_signed_links(){
        let children=json!({"data":[{"id":"folder-2","type":"folder","name":"Shots","parent_id":"root-1","project_id":"proj-1"},{"id":"file-1","type":"file","name":"shot.mov","media_type":"video/quicktime","status":"created","file_size":1234,"parent_id":"root-1","project_id":"proj-1","media_links":{"original":{"download_url":"https://secret.example"}}}],"links":{"next":"/next"}});
        let list=summarize_folder_children("acct-1","root-1",&children).unwrap();
        assert_eq!(list["child_count"],2); assert_eq!(list["media_links_exposed"],false);
        let detail=json!({"data":{"id":"file-1","name":"shot.mov","media_type":"video/quicktime","status":"created","file_size":1234,"parent_id":"root-1","project_id":"proj-1","view_url":"https://next.frame.io/secret","media_links":{"original":{"download_url":"https://secret.example"}}}});
        let file=summarize_file("acct-1","file-1",&detail).unwrap();
        assert_eq!(file["file_id"],"file-1"); assert_eq!(file["media_links_exposed"],false); assert_eq!(file["view_url_exposed"],false);
    }

    #[test]
    fn reports_sixty_percent_without_runtime_claims(){
        let cap=capability_report();
        assert_eq!(cap["source_milestone_percent"],60);
        assert_eq!(cap["source_scope_complete"],false);
        assert_eq!(cap["source_runtime_verified"],false);
        assert_eq!(cap["production_ready"],false);
        let ready=readiness_report();
        assert_eq!(ready["oauth_flow_implemented"],"native_app_pkce_manual_callback_completion");
        assert_eq!(ready["automatic_refresh_before_api_reads"],true);
        assert_eq!(ready["project_automation_ready"],"read_only_workspace_project_folder_and_file_inspection");
    }
}
