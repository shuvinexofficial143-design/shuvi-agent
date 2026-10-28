//! SHUVI 60 M1.2: Rust-only owner task authorization + durable audit adapter.
//!
//! This module is deliberately NOT an execution bypass or public IPC route.
//! Only a trusted native owner-consent handler may issue a scope. A future
//! executor integration must call admission AFTER Rust prepare and BEFORE
//! dispatch under the pending-action lock, and finish using the *real* Rust
//! audit receipt. No checkpoint, model text or WebView state restores authority.
//! Exact-file physical checks and Rust action audit remain mandatory.
//! M1.3 integrates a separately owner-confirmed READ-ONLY UIA path. UI clicks,
//! typing, filesystem edits and browser writes still require legacy approval.
use std::collections::{HashMap,HashSet};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

pub(crate) const MAX_DURATION_MS:u64=10*24*60*60*1000;
const MAX_ACTIVE:usize=4;
const MAX_ISSUED:usize=8_192;
const MAX_ACTIONS:u32=20_000;
const MAX_AI_REQUESTS:u32=2048;

#[derive(Clone,Copy,Debug,PartialEq,Eq,Hash,Deserialize)]
#[serde(rename_all="snake_case")]
pub(crate) enum Risk { ReadOnly, UiMutation, FileEdit }

fn risk_for(tool:&str)->Option<Risk>{
    match tool {
        "ui_windows"|"ui_discover"|"ui_find"|"list_processes"|
        "read_file"|"list_directory"|"search_text"|
        "premiere_bridge_status"|"premiere_context"|"inspect_screen"|
        "browser_page_state"|"browser_dom_read"|"git_status"|"git_diff" =>
            Some(Risk::ReadOnly),
        "premiere_launch"|"launch_app"|"browser_start"|"browser_navigate"|
        "ui_click"|"ui_set_value"|"ui_send_keys"|"ui_toggle"|
        "ui_focus"|"ui_scroll"|"ui_expand_collapse" =>
            Some(Risk::UiMutation),
        "write_file"|"replace_text"=>Some(Risk::FileEdit),
        // No shell, registry, deletion, publish, external message, financial
        // action, auth change or destructive operation can inherit this scope.
        _=>None
    }
}
fn valid_uuid(s:&str)->bool{
    Uuid::parse_str(s).map(|id|id.to_string()==s).unwrap_or(false)
}
fn label(s:&str,max:usize)->bool{
    !s.is_empty()&&s.len()<=max&&s.trim()==s&&!s.chars().any(char::is_control)
}
fn is_exact_local_windows_file(s:&str)->bool{
    let b=s.as_bytes();
    if s.len()<6||s.len()>260||b.len()<6||!b[0].is_ascii_alphabetic()||
        b[1]!=b':'||b[2]!=b'\\'||s.ends_with('\\')||s.contains('/')||
        s[2..].contains(':')||s.chars().any(char::is_control){return false;}
    let mut count=0;
    for component in s[3..].split('\\'){
        if component.is_empty()||component=="."||component==".."||
            component.ends_with('.')||component.ends_with(' ')||
            component.contains('<')||component.contains('>')||
            component.contains('"')||component.contains('|')||
            component.contains('?')||component.contains('*'){return false;}
        let stem=component.split('.').next().unwrap_or("").to_ascii_uppercase();
        if matches!(stem.as_str(),"CON"|"PRN"|"AUX"|"NUL"|
            "COM1"|"COM2"|"COM3"|"COM4"|"COM5"|"COM6"|"COM7"|"COM8"|"COM9"|
            "LPT1"|"LPT2"|"LPT3"|"LPT4"|"LPT5"|"LPT6"|"LPT7"|"LPT8"|"LPT9"){return false;}
        count+=1;
    }
    count>0
}

#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct OwnerScope {
    pub task_id:String,
    pub owner_consent_id:String,
    pub objective_digest:String, // SHA-256 hex of the reviewed task; not prose.
    pub applications:Vec<String>, // exact app names, never a wildcard
    pub exact_files:Vec<String>,  // additionally checked by existing native file guard
    #[serde(default)]
    pub exact_controls:Vec<String>, // M1.5: a single owner-reviewed AutomationId
    pub tools:Vec<String>,
    pub risks:Vec<Risk>,
    pub valid_for_ms:u64,
    pub max_actions:u32,
    pub max_ai_requests:u32,
    // An estimate guard, NOT a provider bill or guaranteed USD cap.
    // Unknown prices are always refused when this is Some.
    pub max_estimated_ai_micro_usd:Option<u64>,
}
// Never accept a claimed application from the provider or WebView. For the
// M1.3 opt-in subset, derive the exact window selector from the Rust-parsed
// ToolAction. The native UIA binding is independently required at dispatch.
pub(crate) fn native_read_target(action:&crate::ToolAction)->Option<&str>{
    match action {
        crate::ToolAction::UiDiscover{window} => Some(window.as_str()),
        crate::ToolAction::UiFind{window:Some(window),name,automation_id}
            if name.as_ref().is_some_and(|s|!s.is_empty())||
               automation_id.as_ref().is_some_and(|s|!s.is_empty())
            =>Some(window.as_str()),
        _=>None
    }
}
pub(crate) fn native_read_prepared(task:&str,id:&str,tool:&str,
    action:&crate::ToolAction)->Result<PreparedAction,String>{
    let app=native_read_target(action)
        .filter(|name|label(name,100)&&!name.contains('*')&&!name.contains('?'))
        .ok_or("Task scope does not delegate this mutating or unbound native tool.")?;
    if !matches!(tool,"ui_find"|"ui_discover"){
        return Err("Task scope action tool is not an exact prepared UIA read.".into());
    }
    Ok(PreparedAction{task_id:task.into(),action_id:id.into(),tool:tool.into(),
        application:app.into(),exact_file:None,
        control_id:match action{
            crate::ToolAction::UiFind{automation_id,..}=>automation_id.clone(),
            _=>None
        },native_root:None})
}

pub(crate) fn native_value_prepared(task:&str,id:&str,tool:&str,
    action:&crate::ToolAction,
    bound:&crate::native_uia_window_guard::NativeUiaTarget)
    ->Result<PreparedAction,String>{
    let (window,control)=match action{
        crate::ToolAction::UiSetValue{window:Some(w),automation_id:Some(c),..}
            =>(w,c),
        _=>return Err("Task mutation is not an exact native UIA ValuePattern edit.".into())
    };
    if tool!="ui_set_value"||!label(window,100)||!label(control,100)||
        control.contains('*')||control.contains('?')||
        bound.automation_id.as_str()!=control.as_str()||bound.hwnd<=0||
        bound.pid==0||bound.process_start_ticks<=0{
        return Err("Native UIA control identity does not match prepared edit.".into());
    }
    Ok(PreparedAction{
        task_id:task.into(),action_id:id.into(),tool:tool.into(),
        application:window.into(),exact_file:None,control_id:Some(control.into()),
        native_root:Some(NativeReadRoot{
            hwnd:bound.hwnd as u64,pid:bound.pid as u64,
            start_ticks:bound.process_start_ticks.to_string()
        })
    })
}

pub(crate) fn premiere_uia_prepared(task:&str,id:&str,tool:&str,
    action:&crate::ToolAction,
    bound:&crate::native_uia_window_guard::NativeUiaTarget)->Result<PreparedAction,String>{
    let (actual,window)=match action{
        crate::ToolAction::UiClick{window,..}=>("ui_click",window.as_deref()),
        crate::ToolAction::UiSetValue{window,..}=>("ui_set_value",window.as_deref()),
        crate::ToolAction::UiFocus{window,..}=>("ui_focus",window.as_deref()),
        crate::ToolAction::UiScroll{window,..}=>("ui_scroll",window.as_deref()),
        crate::ToolAction::UiToggle{window,..}=>("ui_toggle",window.as_deref()),
        crate::ToolAction::UiExpandCollapse{window,..}=>("ui_expand_collapse",window.as_deref()),
        crate::ToolAction::UiSendKeys{window,..}=>("ui_send_keys",window.as_deref()),
        _=>return Err("Not a native Premiere UIA mutation.".into())
    };
    let window=window.ok_or("Scoped UIA mutation needs named Premiere window.")?;
    let control=if bound.automation_id.is_empty(){&bound.control_name}
        else{&bound.automation_id};
    if tool!=actual||!label(window,100)||
       !window.to_ascii_lowercase().contains("premiere")||
       !label(control,180)||control.contains('*')||control.contains('?')||
       bound.hwnd<=0||bound.pid==0||bound.process_start_ticks<=0||
       bound.runtime_id.is_empty(){
        return Err("Native UIA target is not an exact prepared Premiere control.".into());
    }
    Ok(PreparedAction{task_id:task.into(),action_id:id.into(),tool:tool.into(),
        application:window.into(),exact_file:None,control_id:Some(control.clone()),
        native_root:Some(NativeReadRoot{hwnd:bound.hwnd as u64,pid:bound.pid as u64,
            start_ticks:bound.process_start_ticks.to_string()})})
}
pub(crate) fn premiere_vision_prepared(task:&str,id:&str,tool:&str,
    action:&crate::ToolAction,
    target:Option<&crate::target_window_capture::PreparedCaptureTarget>)
    ->Result<PreparedAction,String>{
    let window=match action{
        crate::ToolAction::InspectScreen{window,..} if tool=="inspect_screen"=>window,
        _=>return Err("Scoped vision is not a native prepared InspectScreen.".into())
    };
    let native=target.ok_or("Vision has no OS prepared capture target.")?;
    if !label(window,100)||!window.to_ascii_lowercase().contains("premiere")||
        native.hwnd<=0||native.pid==0||native.process_start_ticks<=0{
        return Err("Vision must target the exact consented Premiere window.".into());
    }
    Ok(PreparedAction{task_id:task.into(),action_id:id.into(),tool:tool.into(),
        application:window.clone(),exact_file:None,control_id:None,
        native_root:Some(NativeReadRoot{hwnd:native.hwnd as u64,pid:native.pid as u64,
            start_ticks:native.process_start_ticks.to_string()})})
}
impl OwnerScope {
    pub(crate) fn validate(&self)->Result<(),String>{
        if !valid_uuid(&self.task_id)||!valid_uuid(&self.owner_consent_id)||
            self.task_id==self.owner_consent_id||
            self.objective_digest.len()!=64||
            !self.objective_digest.bytes().all(|b|b.is_ascii_hexdigit()&&
                !b.is_ascii_uppercase())||
            self.valid_for_ms==0||self.valid_for_ms>MAX_DURATION_MS||
            self.max_actions==0||self.max_actions>MAX_ACTIONS||
            self.max_ai_requests==0||self.max_ai_requests>MAX_AI_REQUESTS||
            self.max_estimated_ai_micro_usd==Some(0)||
            self.applications.is_empty()||self.applications.len()>16||
            self.exact_files.len()>64||self.exact_controls.len()>1||
            self.tools.is_empty()||self.tools.len()>32||
            self.risks.is_empty()||self.risks.len()>3{
            return Err("Owner task scope or finite budgets invalid.".into());
        }
        if self.applications.iter().any(|app|!label(app,100)||app=="*"||
            app.contains('*')||app.contains('?'))||
           self.exact_files.iter().any(|p|!is_exact_local_windows_file(p))||
           self.exact_controls.iter().any(|id|!label(id,100)||
              id.contains('*')||id.contains('?'))||
           self.tools.iter().any(|t|risk_for(t).is_none())||
           self.tools.iter().any(|t|!self.risks.contains(&risk_for(t).unwrap()))||
           self.applications.iter().collect::<HashSet<_>>().len()!=self.applications.len()||
           self.exact_files.iter().collect::<HashSet<_>>().len()!=self.exact_files.len()||
           self.tools.iter().collect::<HashSet<_>>().len()!=self.tools.len()||
           self.risks.iter().collect::<HashSet<_>>().len()!=self.risks.len()||
           self.tools.iter().any(|t|t=="ui_set_value")&&
              self.exact_controls.len()!=1&&
              !(self.exact_controls.is_empty()&&self.tools.iter().any(|t|t=="ui_click")
                &&self.applications.len()==1)||
           self.tools.iter().any(|t|matches!(risk_for(t),Some(Risk::FileEdit)))&&
              self.exact_files.is_empty(){
            return Err("Owner task lists are ambiguous, risky or outside typed allowlist.".into());
        }
        Ok(())
    }
}

#[derive(Clone,Debug)]
pub(crate) struct PreparedAction {
    pub task_id:String,
    pub action_id:String, // NEW Rust-prepared UUID for every step
    pub tool:String,      // native prepared typed tool, NOT model risk assertion
    pub application:String, // must come from verified native target
    pub exact_file:Option<String>,
    pub control_id:Option<String>,
    native_root:Option<NativeReadRoot>,
}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub(crate) enum Outcome { AuditedSuccess, AuditedFailure, Unknown }
#[derive(Clone)]
struct Pending {id:String,tool:String,control_id:Option<String>}
#[derive(Clone,Debug,PartialEq,Eq)]
struct NativeReadRoot { hwnd:u64,pid:u64,start_ticks:String }
// Only a real UIA stdout blob from native execute_tool may reach this
// verifier. It cannot be populated by a model, cached screenshot or status.
fn observed_read_root(stdout:&str)->Result<NativeReadRoot,String>{
    if stdout.is_empty()||stdout.len()>250_000{
        return Err("Native UIA output absent or exceeded bounded read budget.".into());
    }
    let json:Value=serde_json::from_str(stdout)
        .map_err(|_|"Native UIA output was not a structured readback.")?;
    let rows:Vec<&Value>=match &json{
        Value::Array(items) if !items.is_empty()&&items.len()<=160=>
            items.iter().collect(),
        Value::Object(_)=>vec![&json],
        _=>return Err("Native UIA response has no bounded control rows.".into())
    };
    let mut known=None;
    for row in rows {
        let hwnd=row.get("ObservedWindowHwnd").and_then(Value::as_u64)
            .filter(|n|*n>0).ok_or("Native UIA read missing bound HWND.")?;
        let pid=row.get("ObservedWindowPid").and_then(Value::as_u64)
            .filter(|n|*n>0&&*n<=u32::MAX as u64)
            .ok_or("Native UIA read missing bound PID.")?;
        let started=row.get("ObservedWindowProcessStartTicks")
            .and_then(Value::as_str).filter(|t|!t.is_empty()&&t.len()<=24&&
                *t!="0"&&t.bytes().all(|b|b.is_ascii_digit()))
            .ok_or("Native UIA read missing process birth-time proof.")?;
        let value=NativeReadRoot{hwnd,pid,start_ticks:started.to_string()};
        if known.as_ref().is_some_and(|root|root!=&value){
            return Err("Native UIA control batch mixes multiple OS processes.".into());
        }
        known=Some(value);
    }
    known.ok_or("No verified native UIA process witness.".into())
}
struct Grant {
    scope:OwnerScope,
    scope_id:String,
    deadline_ms:u64,
    last_observed_ms:u64,
    actions:u32,
    requests:u32,
    estimated_ai_micro_usd:u64,
    observed_ids:HashSet<String>,
    pending:Option<Pending>,
    read_root:Option<NativeReadRoot>,
    awaiting_readback:Option<String>,
    confirmed_readback:bool,
    confirmed_value_edit:bool,
    paused:bool,
}
#[derive(Default)]
pub(crate) struct Store {
    active:HashMap<String,Grant>,
    issued:HashSet<String>,
    // A native owner consent event cannot be recycled to authorize a second
    // unrelated task even if its first task was revoked or expired.
    issued_owner_consents:HashSet<String>,
}
impl Store {
    /// Call ONLY after explicit owner review in the native authorization
    /// handler, not from model JSON, scheduler checkpoint or recovered WebView.
    pub(crate) fn issue(&mut self,scope:OwnerScope,now:u64)->Result<String,String>{
        scope.validate()?;
        let expiry=now.checked_add(scope.valid_for_ms)
            .ok_or("Task authorization deadline overflow.")?;
        if now==0||self.issued.contains(&scope.task_id)||
            self.issued_owner_consents.contains(&scope.owner_consent_id)||
            self.active.len()>=MAX_ACTIVE||self.issued.len()>=MAX_ISSUED{
            return Err("Owner approval identity already used or task capacity exhausted.".into());
        }
        let id=Uuid::new_v4().to_string();
        self.issued.insert(scope.task_id.clone());
        self.issued_owner_consents.insert(scope.owner_consent_id.clone());
        self.active.insert(scope.task_id.clone(),Grant{
            scope,scope_id:id.clone(),deadline_ms:expiry,last_observed_ms:now,
            actions:0,requests:0,estimated_ai_micro_usd:0,
            observed_ids:HashSet::new(),pending:None,read_root:None,awaiting_readback:None,
            confirmed_readback:false,confirmed_value_edit:false,paused:false
        });
        Ok(id)
    }
    fn grant(&mut self,task:&str,scope_id:&str,now:u64)->Result<&mut Grant,String>{
        if !valid_uuid(task)||!valid_uuid(scope_id)||now==0{
            return Err("Invalid native task authorization identity.".into());
        }
        let g=self.active.get_mut(task).ok_or("No live owner task authorization.")?;
        if g.scope_id!=scope_id||now<g.last_observed_ms||
           now>=g.deadline_ms||g.paused{
            return Err("Owner task authorization revoked, expired, paused or clock reversed.".into());
        }
        g.last_observed_ms=now;
        Ok(g)
    }
    pub(crate) fn premiere_bridge_prepared(&self,task:&str,scope:&str,
        action_id:&str,tool:&str,action:&crate::ToolAction)->Result<PreparedAction,String>{
        let eligible=matches!((tool,action),
          ("premiere_context",crate::ToolAction::PremiereContext)|
          ("premiere_bridge_status",crate::ToolAction::PremiereBridgeStatus));
        let g=self.active.get(task).filter(|g|g.scope_id==scope&&
            g.scope.tools.iter().any(|x|x=="ui_click"))
            .ok_or("No Premiere task consent for this bridge read.")?;
        if !eligible||!valid_uuid(action_id)||g.read_root.is_none()||
            g.scope.applications.len()!=1{
            return Err("Bridge inspection needs earlier real Premiere window verification.".into());
        }
        Ok(PreparedAction{task_id:task.into(),action_id:action_id.into(),
            tool:tool.into(),application:g.scope.applications[0].clone(),
            exact_file:None,control_id:None,native_root:None})
    }
    /// This is only an admission decision and a single-use reservation:
    /// it neither calls a native tool nor claims that the tool ran.
    fn reserve_prepared(&mut self,scope_id:&str,action:&PreparedAction,
        now:u64)->Result<(),String>{
        if !valid_uuid(&action.action_id){return Err("Action lacks Rust-prepared UUID.".into());}
        let g=self.grant(&action.task_id,scope_id,now)?;
        if g.pending.is_some()||g.actions>=g.scope.max_actions||
           g.observed_ids.contains(&action.action_id){
            return Err("Prepared action duplicate, already running or over task limit.".into());
        }
        let risk=risk_for(&action.tool).ok_or("Tool is not delegable by task consent.")?;
        if !g.scope.tools.iter().any(|t|t==&action.tool)||
           !g.scope.risks.contains(&risk)||
           !g.scope.applications.iter().any(|app|app==&action.application){
            return Err("Prepared tool, application or risk is outside owner scope.".into());
        }
        if let Some(control)=g.awaiting_readback.as_deref(){
            if action.tool!="ui_find"||action.control_id.as_deref()!=Some(control){
                return Err("A native ValuePattern edit needs exact separately audited UIA readback.".into());
            }
        }
        if action.tool=="ui_set_value" {
            let control=action.control_id.as_deref()
                .ok_or("Scoped SetValue lacks a native-bound exact AutomationId.")?;
            if (!g.scope.exact_controls.is_empty()&&
                !g.scope.exact_controls.iter().any(|id|id==control))||
               (g.scope.exact_controls.is_empty()&&
                !g.scope.tools.iter().any(|t|t=="ui_click"))||
                action.native_root.is_none(){
                return Err("Scoped ValuePattern edit is outside owner-reviewed control.".into());
            }
            let root=action.native_root.as_ref().unwrap();
            if g.read_root.as_ref().is_some_and(|prior|prior!=root){
                g.paused=true;
                return Err("UIA application process generation changed before editing.".into());
            }
            if g.read_root.is_none(){g.read_root=Some(root.clone());}
        }
        if g.scope.exact_controls.is_empty()&&
           g.scope.tools.iter().any(|t|t=="ui_click")&&risk==Risk::UiMutation {
            let root=action.native_root.as_ref()
                .ok_or("Scoped UIA mutation has no Rust OS process identity.")?;
            if g.read_root.as_ref().is_some_and(|old|old!=root){
                g.paused=true;
                return Err("Premiere window/process changed; task authority paused.".into());
            }
            if g.read_root.is_none(){g.read_root=Some(root.clone());}
        }
        if action.tool=="inspect_screen" {
            let root=action.native_root.as_ref()
                .ok_or("Vision missing native screenshot process identity.")?;
            if g.read_root.as_ref().is_some_and(|old|old!=root){
                g.paused=true;return Err("Vision targets another window or process.".into());
            }
            if g.read_root.is_none(){g.read_root=Some(root.clone());}
        }
        if !g.scope.exact_controls.is_empty()&&risk==Risk::ReadOnly&&
           (action.tool!="ui_find"||
            !g.scope.exact_controls.iter().any(|id|Some(id.as_str())==action.control_id.as_deref())){
            return Err("After scoped editing only the exact approved control may be inspected.".into());
        }
        match risk {
            Risk::FileEdit=>{
                let path=action.exact_file.as_deref()
                    .ok_or("Scoped edit missing approved exact file.")?;
                if !is_exact_local_windows_file(path)||
                   !g.scope.exact_files.iter().any(|approved|approved==path){
                    return Err("Edited file is outside explicit owner file scope.".into());
                }
            },
            _=>if action.exact_file.is_some(){
                return Err("A non-file action cannot smuggle a file target.".into());
            }
        }
        g.observed_ids.insert(action.action_id.clone());
        g.confirmed_value_edit=false;
        g.actions+=1; // unknown or failed dispatch still consumes the action
        g.pending=Some(Pending{id:action.action_id.clone(),tool:action.tool.clone(),
            control_id:action.control_id.clone()});
        Ok(())
    }
    /// A Tauri executor adapter calls this only after the existing Rust
    /// per-action prepared-lock has authenticated the consented task AND the
    /// durable native job/owned process lane has been checked. This does not
    /// start an action or bypass existing per-action owner consent today.
    pub(crate) fn reserve_after_native_preflight(&mut self,
        app:&tauri::AppHandle,scope_id:&str,action:&PreparedAction,
        now:u64)->Result<(),String>{
        crate::native_worker_job::require_resolved(app)?;
        // The caller must hold the existing native prepared-action lock across
        // this admission and dispatch. The disk job BEGIN itself also enforces
        // inter-process UUID exclusion and cannot be replaced by this check.
        self.reserve_prepared(scope_id,action,now)
    }
    /// Only the native executor calls this after the real read-only tool ran.
    /// Same-window title is never enough: exact root HWND, PID and process
    /// generation must match the first independently audited observation.
    pub(crate) fn verify_native_read_output(&mut self,task:&str,scope_id:&str,
        action_id:&str,tool:&str,stdout:&str,now:u64)->Result<(),String>{
        let root=observed_read_root(stdout)?;
        let grant=self.grant(task,scope_id,now)?;
        let pending=grant.pending.as_ref()
            .ok_or("Task readback has no awaiting exact native action.")?;
        if pending.id!=action_id||pending.tool!=tool||
           !matches!(tool,"ui_find"|"ui_discover"|"ui_set_value"){
            grant.paused=true;
            return Err("Foreign UIA readback cannot confirm a native task step.".into());
        }
        if tool=="ui_set_value" {
            // Only execute_tool's post-write OS-attested readback may
            // authorize audit success; WebView/model text is never accepted.
            let row:Value=serde_json::from_str(stdout)
                .map_err(|_|"Scoped UIA edit lacks structured OS readback.")?;
            if !row.is_object()||
               row.get("VerifiedValue").and_then(Value::as_bool)!=Some(true)||
               row.get("AutomationId").and_then(Value::as_str)!=
                   pending.control_id.as_deref(){
                grant.paused=true;
                return Err("Scoped UIA edit has no verified exact-control value readback.".into());
            }
            grant.confirmed_value_edit=true;
        }
        if let Some(control)=grant.awaiting_readback.as_deref(){
            let json:Value=serde_json::from_str(stdout)
                .map_err(|_|"Cannot verify post-edit UIA control.")?;
            let row=match &json{
                Value::Array(items) if items.len()==1=>&items[0],
                Value::Object(_)=>&json,
                _=>return Err("Post-edit inspection needs exactly one control.".into())
            };
            if row.get("AutomationId").and_then(Value::as_str)!=Some(control){
                grant.paused=true;
                return Err("Post-edit UIA control changed or was not observed.".into());
            }
            grant.confirmed_readback=true;
        }
        if let Some(previous)=&grant.read_root{
            if previous!=&root{
                grant.paused=true;
                return Err("Native UIA target restarted or changed; task safely paused.".into());
            }
        }else{
            grant.read_root=Some(root);
        }
        Ok(())
    }

    /// The transition is private: an external WebView, scheduler or AI plan
    /// cannot supply a claimed "success" to the M1 task scope.
    fn record_audit(&mut self,task:&str,scope_id:&str,
        action_id:&str,tool:&str,outcome:Outcome,now:u64)->Result<(),String>{
        let g=self.grant(task,scope_id,now)?;
        let pending=g.pending.as_ref().ok_or("No scoped action awaiting Rust audit.")?;
        if pending.id!=action_id||pending.tool!=tool{
            return Err("Audit has foreign action UUID or tool.".into());
        }
        if outcome==Outcome::AuditedSuccess&&tool=="ui_set_value"{
            if !g.confirmed_value_edit {
                g.paused=true;
                return Err("Scoped ValuePattern success requires Rust-verified OS readback.".into());
            }
            g.awaiting_readback=g.pending.as_ref().and_then(|p|p.control_id.clone());
            g.confirmed_readback=false;
        }else if outcome==Outcome::AuditedSuccess&&tool=="ui_find"&&
            g.awaiting_readback.is_some(){
            if !g.confirmed_readback{
                g.paused=true;
                return Err("Read did not verify post-edit control identity.".into());
            }
            g.awaiting_readback=None;
            g.confirmed_readback=false;
        }
        g.pending=None;
        g.confirmed_value_edit=false;
        if outcome!=Outcome::AuditedSuccess {g.paused=true;}
        Ok(())
    }
    // This private parser is used ONLY with a native-worker journal fetched
    // through Rust's exclusive, validated filesystem reader. Never expose a
    // public argument accepting a WebView-constructed audit record.
    fn reconcile_native_receipt(&mut self,task:&str,scope_id:&str,
        receipt:&crate::native_worker_job::NativeJob,now:u64)->Result<(),String>{
        if receipt.version!=1||!valid_uuid(&receipt.action_id)||
            receipt.started_at_ms==0||
            receipt.updated_at_ms<receipt.started_at_ms||
            now<receipt.updated_at_ms{
            return Err("Native worker audit identity or clock is invalid.".into());
        }
        let outcome=match (receipt.phase.as_str(),receipt.audit_success){
            ("audit_verified",Some(true))=>Outcome::AuditedSuccess,
            ("audit_verified",Some(false))=>Outcome::AuditedFailure,
            ("owner_reviewed_unknown",None)=>Outcome::Unknown,
            _=>return Err("Native worker has no terminal Rust audit; task remains blocked.".into())
        };
        self.record_audit(task,scope_id,&receipt.action_id,&receipt.tool,outcome,now)
    }
    /// Production audit reconciliation MUST fetch the exact native Rust
    /// journal. An action reported successful by the model is not evidence.
    /// Audit success is not independent verification of the intended effect;
    /// UIA/readback and output artifact checks remain separate mandatory gates.
    pub(crate) fn reconcile_from_rust_journal(&mut self,
        app:&tauri::AppHandle,task:&str,scope_id:&str,now:u64)
        ->Result<(),String>{
        let receipt=crate::native_worker_job::read(app)?
            .ok_or("Native worker journal missing; action remains unverified.")?;
        self.reconcile_native_receipt(task,scope_id,&receipt,now)
    }

    /// Per-request reservation is NEVER silently refunded, including HTTP
    /// 429/503 and timeouts. No provider failover without a new unique index.
    /// Actual provider billing is unknown; estimated cap is enforced only
    /// when a trusted nonzero preflight price estimate is supplied.
    pub(crate) fn reserve_ai(&mut self,task:&str,scope_id:&str,request_id:&str,
        quote_micro_usd:Option<u64>,now:u64)->Result<(),String>{
        if !valid_uuid(request_id){return Err("Paid request ID must be unique UUID.".into());}
        let g=self.grant(task,scope_id,now)?;
        if g.pending.is_some()||g.requests>=g.scope.max_ai_requests||
            g.observed_ids.contains(request_id){
            return Err("AI request duplicate, exceeds budget or overlaps native action.".into());
        }
        if g.scope.max_estimated_ai_micro_usd.is_some()&&quote_micro_usd.is_none(){
            return Err("No trusted AI cost quote; cannot enforce estimated cost cap.".into());
        }
        let cost=quote_micro_usd.unwrap_or(0);
        if cost==0&&quote_micro_usd.is_some(){
            return Err("Invalid zero-price cost estimate.".into());
        }
        let total=g.estimated_ai_micro_usd.checked_add(cost)
            .ok_or("AI estimate arithmetic overflow.")?;
        if g.scope.max_estimated_ai_micro_usd.is_some_and(|max|total>max){
            return Err("Owner-selected estimated AI spending budget exhausted.".into());
        }
        g.observed_ids.insert(request_id.into());
        g.requests+=1;
        g.estimated_ai_micro_usd=total;
        Ok(())
    }
    pub(crate) fn pause(&mut self,task:&str){if let Some(g)=self.active.get_mut(task){g.paused=true;}}
    pub(crate) fn revoke(&mut self,task:&str){self.active.remove(task);}
    /// No checkpoint or restart auto-reissues this non-durable authority.
    pub(crate) fn can_resume_without_owner(&self,_task:&str)->bool{false}
}
#[cfg(test)]
mod tests {
    use super::*;
    fn id()->String{Uuid::new_v4().to_string()}
    fn scope()->OwnerScope{
        OwnerScope{task_id:id(),owner_consent_id:id(),objective_digest:"a".repeat(64),
         applications:vec!["Adobe Premiere Pro".into(),"Notepad".into()],
         exact_files:vec![r"C:\User\Project\notes.txt".into()],
         exact_controls:vec!["Save".into()],
         tools:vec!["ui_windows".into(),"ui_find".into(),
             "ui_click".into(),"ui_set_value".into(),"write_file".into()],
         risks:vec![Risk::ReadOnly,Risk::UiMutation,Risk::FileEdit],
         valid_for_ms:MAX_DURATION_MS,max_actions:3,max_ai_requests:2,
         max_estimated_ai_micro_usd:Some(100_000)}
    }
    fn action(task:&str,tool:&str,app:&str,path:Option<&str>)->PreparedAction{
        PreparedAction{task_id:task.into(),action_id:id(),tool:tool.into(),
            application:app.into(),exact_file:path.map(str::to_owned),
            control_id:if matches!(tool,"ui_find"|"ui_set_value"){Some("Save".into())}else{None},
            native_root:if tool=="ui_set_value"{
                Some(NativeReadRoot{hwnd:42,pid:24,start_ticks:"8675309".into()})
            }else{None}}
    }
    #[test]
    fn exact_owner_consent_is_finite_and_never_renewed_silently(){
        let mut store=Store::default();let owner=scope();let t=owner.task_id.clone();
        let token=store.issue(owner.clone(),1000).unwrap();
        assert!(store.issue(owner,1001).is_err());
        assert!(store.grant(&t,&token,1000+MAX_DURATION_MS).is_err());
        store.revoke(&t);
        assert!(store.grant(&t,&token,1001).is_err());
        assert!(!store.can_resume_without_owner(&t));
        assert!(store.issue(scope(),1).is_ok());
        assert!(store.issue(OwnerScope{task_id:t,..scope()},1002).is_err());
    }
    #[test]
    fn same_task_uuid_cannot_authorize_foreign_app_tool_file_or_synthetic_id(){
        let mut s=Store::default();let o=scope();let task=o.task_id.clone();
        let grant=s.issue(o,100).unwrap();
        for bad in [
            action(&task,"powershell","Notepad",None),
            action(&task,"ui_click","Chrome",None),
            action(&task,"delete_file","Notepad",Some(r"C:\User\Project\notes.txt")),
            action(&task,"write_file","Notepad",Some(r"C:\User\Project\other.txt")),
            action(&task,"write_file","Notepad",Some(r"C:\User\Project\..\secrets.txt")),
            action(&task,"ui_windows","Notepad",Some(r"C:\User\Project\notes.txt")),
            PreparedAction{action_id:"not-a-uuid".into(),..action(&task,"ui_find","Notepad",None)}
        ]{
            assert!(s.reserve_prepared(&grant,&bad,101).is_err());
        }
        let a=action(&task,"ui_click","Notepad",None);
        s.reserve_prepared(&grant,&a,102).unwrap();
        assert!(s.reserve_prepared(&grant,&a,103).is_err());
        assert!(s.record_audit(&task,&grant,&id(),"ui_click",Outcome::AuditedSuccess,104).is_err());
        s.record_audit(&task,&grant,&a.action_id,"ui_click",Outcome::AuditedSuccess,104).unwrap();
        assert!(s.reserve_prepared(&grant,&a,105).is_err());
    }
    #[test]
    fn risk_and_duration_cannot_be_inferred_or_wildcarded(){
        let mut bad=scope();bad.valid_for_ms=MAX_DURATION_MS+1;
        assert!(bad.validate().is_err());
        let mut bad=scope();bad.applications=vec!["*".into()];assert!(bad.validate().is_err());
        let mut bad=scope();bad.tools.push("shell".into());assert!(bad.validate().is_err());
        let mut bad=scope();bad.risks.retain(|x|*x!=Risk::FileEdit);assert!(bad.validate().is_err());
        let mut bad=scope();bad.exact_files=vec![r"C:\User\..\secret.txt".into()];assert!(bad.validate().is_err());
        let mut bad=scope();bad.objective_digest="task narrative".into();assert!(bad.validate().is_err());
    }
    #[test]
    fn action_failure_and_unknown_pause_without_replay_or_reissue(){
        for outcome in [Outcome::AuditedFailure,Outcome::Unknown]{
            let mut s=Store::default();let owner=scope();
            let task=owner.task_id.clone();let token=s.issue(owner,100).unwrap();
            let a=action(&task,"ui_click","Notepad",None);
            s.reserve_prepared(&token,&a,101).unwrap();
            s.record_audit(&task,&token,&a.action_id,&a.tool,outcome,102).unwrap();
            assert!(s.reserve_prepared(&token,&self::action(&task,"ui_click","Notepad",None),103).is_err());
            assert!(s.issue(OwnerScope{task_id:task,..scope()},104).is_err());
        }
    }
    #[test]
    fn paid_request_quote_limit_no_duplicate_or_unknown_price_bypass(){
        let mut s=Store::default();let o=scope();let task=o.task_id.clone();
        let grant=s.issue(o,100).unwrap();
        let a=id();
        assert!(s.reserve_ai(&task,&grant,&a,None,101).is_err());
        s.reserve_ai(&task,&grant,&a,Some(60_000),101).unwrap();
        assert!(s.reserve_ai(&task,&grant,&a,Some(1),102).is_err());
        assert!(s.reserve_ai(&task,&grant,&id(),Some(40_001),103).is_err());
        s.reserve_ai(&task,&grant,&id(),Some(40_000),104).unwrap();
        assert!(s.reserve_ai(&task,&grant,&id(),Some(1),105).is_err());
    }
    #[test]
    fn one_premiere_approval_admits_ten_sequential_native_actions(){
        let mut o=scope();o.applications=vec!["Adobe Premiere Pro".into()];
        o.exact_controls.clear();o.exact_files.clear();
        o.tools=vec!["ui_click".into(),"ui_find".into(),"inspect_screen".into(),
            "premiere_context".into(),"premiere_bridge_status".into()];
        o.risks=vec![Risk::ReadOnly,Risk::UiMutation];
        o.max_actions=24;
        let task=o.task_id.clone();let mut s=Store::default();
        let permit=s.issue(o,100).unwrap();
        for step in 0..10 {
            let mut a=action(&task,"ui_click","Adobe Premiere Pro",None);
            a.control_id=Some(format!("Control{step}"));
            a.native_root=Some(NativeReadRoot{hwnd:42,pid:24,start_ticks:"8675309".into()});
            s.reserve_prepared(&permit,&a,101+step*2).unwrap();
            s.record_audit(&task,&permit,&a.action_id,&a.tool,
                Outcome::AuditedSuccess,102+step*2).unwrap();
            assert!(s.reserve_prepared(&permit,&a,102+step*2).is_err());
        }
        let mut different=action(&task,"ui_click","Adobe Premiere Pro",None);
        different.native_root=Some(NativeReadRoot{
            hwnd:43,pid:24,start_ticks:"8675309".into()});
        assert!(s.reserve_prepared(&permit,&different,125).is_err());
        assert!(s.reserve_prepared(&permit,&action(&task,"pointer_click",
            "Adobe Premiere Pro",None),126).is_err());
        s.revoke(&task);
        assert!(s.reserve_prepared(&permit,&different,127).is_err());
        assert!(!s.can_resume_without_owner(&task));
    }
    #[test]
    fn premiere_read_vision_bridge_continuity_is_tied_to_same_rust_grant(){
        let mut owner=scope();owner.applications=vec!["Adobe Premiere Pro".into()];
        owner.exact_controls.clear();owner.exact_files.clear();
        owner.tools=vec!["ui_click".into(),"ui_find".into(),
            "inspect_screen".into(),"premiere_context".into()];
        owner.risks=vec![Risk::ReadOnly,Risk::UiMutation];
        let task=owner.task_id.clone();let mut s=Store::default();
        let permit=s.issue(owner,100).unwrap();
        let read=action(&task,"ui_find","Adobe Premiere Pro",None);
        s.reserve_prepared(&permit,&read,101).unwrap();
        let observed=serde_json::json!([{
            "ObservedWindowHwnd":42,"ObservedWindowPid":24,
            "ObservedWindowProcessStartTicks":"8675309","AutomationId":"Save"
        }]).to_string();
        s.verify_native_read_output(&task,&permit,&read.action_id,
            "ui_find",&observed,102).unwrap();
        s.record_audit(&task,&permit,&read.action_id,"ui_find",
            Outcome::AuditedSuccess,103).unwrap();
        let mut vision=action(&task,"inspect_screen","Adobe Premiere Pro",None);
        vision.native_root=Some(NativeReadRoot{hwnd:42,pid:24,
            start_ticks:"8675309".into()});
        s.reserve_prepared(&permit,&vision,104).unwrap();
        s.record_audit(&task,&permit,&vision.action_id,"inspect_screen",
            Outcome::AuditedSuccess,105).unwrap();
        let bridge=s.premiere_bridge_prepared(&task,&permit,&id(),
            "premiere_context",&crate::ToolAction::PremiereContext).unwrap();
        s.reserve_prepared(&permit,&bridge,106).unwrap();
        s.record_audit(&task,&permit,&bridge.action_id,"premiere_context",
            Outcome::AuditedSuccess,107).unwrap();
        let mut foreign=action(&task,"inspect_screen","Adobe Premiere Pro",None);
        foreign.native_root=Some(NativeReadRoot{hwnd:42,pid:25,
            start_ticks:"8675309".into()});
        assert!(s.reserve_prepared(&permit,&foreign,108).is_err());
        s.revoke(&task);
        assert!(s.reserve_prepared(&permit,&action(&task,"ui_find",
            "Adobe Premiere Pro",None),109).is_err());
    }
    fn journal(action:&PreparedAction,phase:&str,success:Option<bool>,now:u64)
        ->crate::native_worker_job::NativeJob{
        crate::native_worker_job::NativeJob{
            version:1,action_id:action.action_id.clone(),tool:action.tool.clone(),
            phase:phase.into(),started_at_ms:now,updated_at_ms:now,
            heartbeat_seq:0,audit_success:success,prior_action_ids:vec![]
        }
    }
    #[test]
    fn owner_consent_replay_cannot_create_second_task_or_authority(){
        let mut s=Store::default();
        let first=scope();
        let shared_consent=first.owner_consent_id.clone();
        let first_task=first.task_id.clone();
        let token=s.issue(first,100).unwrap();
        s.revoke(&first_task);
        let mut second=scope();second.owner_consent_id=shared_consent;
        assert!(s.issue(second,101).is_err());
        assert!(s.grant(&first_task,&token,101).is_err());
        assert!(s.issue(scope(),102).is_ok());
    }
    #[test]
    fn native_journal_success_requires_exact_action_tool_and_terminal_rust_receipt(){
        let mut s=Store::default();let o=scope();let task=o.task_id.clone();
        let grant=s.issue(o,1000).unwrap();
        let action=action(&task,"ui_click","Notepad",None);
        s.reserve_prepared(&grant,&action,1001).unwrap();
        let running=journal(&action,"running",None,1002);
        assert!(s.reconcile_native_receipt(&task,&grant,&running,1003).is_err());
        let mut forged=journal(&action,"audit_verified",Some(true),1002);
        forged.action_id=id();
        assert!(s.reconcile_native_receipt(&task,&grant,&forged,1003).is_err());
        forged.action_id=action.action_id.clone();forged.tool="ui_focus".into();
        assert!(s.reconcile_native_receipt(&task,&grant,&forged,1003).is_err());
        forged.tool=action.tool.clone();forged.updated_at_ms=1004;
        assert!(s.reconcile_native_receipt(&task,&grant,&forged,1003).is_err());
        let good=journal(&action,"audit_verified",Some(true),1005);
        assert!(s.reconcile_native_receipt(&task,&grant,&good,1005).is_ok());
        assert!(s.reconcile_native_receipt(&task,&grant,&good,1006).is_err());
        assert!(s.reserve_prepared(&grant,&action,1007).is_err());
        // An authenticated terminal journal alone never marks user objective
        // complete, nor does it authorize another tool outside the scope.
        assert!(s.reserve_prepared(&grant,
            &self::action(&task,"delete_file","Notepad",None),1008).is_err());
    }
    #[test]
    fn failed_unknown_and_malformed_native_receipts_cannot_unlock_replay(){
        for (phase,success) in [
            ("audit_verified",Some(false)),
            ("owner_reviewed_unknown",None)
        ] {
            let mut s=Store::default();let o=scope();let task=o.task_id.clone();
            let grant=s.issue(o,100).unwrap();
            let action=action(&task,"ui_set_value","Notepad",None);
            s.reserve_prepared(&grant,&action,101).unwrap();
            let receipt=journal(&action,phase,success,102);
            s.reconcile_native_receipt(&task,&grant,&receipt,103).unwrap();
            assert!(s.reserve_prepared(&grant,&action,104).is_err());
            assert!(s.reserve_prepared(&grant,
                &self::action(&task,"ui_windows","Notepad",None),104).is_err());
        }
        for (phase,success) in [
            ("running",Some(true)),
            ("audit_verified",None),
            ("owner_reviewed_unknown",Some(true))
        ] {
            let mut s=Store::default();let o=scope();let task=o.task_id.clone();
            let grant=s.issue(o,100).unwrap();
            let action=action(&task,"ui_click","Notepad",None);
            s.reserve_prepared(&grant,&action,101).unwrap();
            assert!(s.reconcile_native_receipt(&task,&grant,
                &journal(&action,phase,success,102),103).is_err());
            assert!(s.reserve_prepared(&grant,
                &self::action(&task,"ui_click","Notepad",None),104).is_err());
        }
    }

    #[test]
    fn m13_native_read_adapter_never_accepts_mutations_or_an_unbound_window(){
        let t=id();let aid=id();
        let discover=crate::ToolAction::UiDiscover{window:"Premiere".into()};
        assert_eq!(native_read_target(&discover),Some("Premiere"));
        assert!(native_read_prepared(&t,&aid,"ui_discover",&discover).is_ok());
        assert!(native_read_prepared(&t,&aid,"ui_click",&discover).is_err());
        let find=crate::ToolAction::UiFind{window:Some("Premiere".into()),
            name:Some("Save".into()),automation_id:None};
        assert!(native_read_prepared(&t,&aid,"ui_find",&find).is_ok());
        let unbound=crate::ToolAction::UiFind{window:None,
            name:Some("Save".into()),automation_id:None};
        assert!(native_read_prepared(&t,&aid,"ui_find",&unbound).is_err());
        let mutation=crate::ToolAction::UiClick{window:Some("Premiere".into()),
            name:Some("Save".into()),automation_id:None};
        assert!(native_read_prepared(&t,&aid,"ui_click",&mutation).is_err());
    }

    #[test]
    fn bounded_native_value_edits_require_exact_control_and_new_inspection(){
        let mut owner=scope();
        owner.tools=vec!["ui_find".into(),"ui_set_value".into()];
        owner.risks=vec![Risk::ReadOnly,Risk::UiMutation];
        owner.exact_files.clear();owner.max_actions=5;
        let task=owner.task_id.clone();
        let mut store=Store::default();
        let grant=store.issue(owner,100).unwrap();
        let native_root=NativeReadRoot{hwnd:42,pid:24,start_ticks:"8675309".into()};
        let mut first=action(&task,"ui_set_value","Notepad",None);
        first.control_id=Some("Save".into());first.native_root=Some(native_root.clone());
        store.reserve_prepared(&grant,&first,101).unwrap();
        let witness=serde_json::json!({
            "ObservedWindowHwnd":42,"ObservedWindowPid":24,
            "ObservedWindowProcessStartTicks":"8675309",
            "AutomationId":"Save","VerifiedValue":true
        }).to_string();
        store.verify_native_read_output(&task,&grant,&first.action_id,
            "ui_set_value",&witness,102).unwrap();
        store.record_audit(&task,&grant,&first.action_id,"ui_set_value",
            Outcome::AuditedSuccess,102).unwrap();
        let mut second=action(&task,"ui_set_value","Notepad",None);
        second.control_id=Some("Save".into());second.native_root=Some(native_root.clone());
        assert!(store.reserve_prepared(&grant,&second,103).is_err());
        let mut wrong=action(&task,"ui_find","Notepad",None);
        wrong.control_id=Some("Another".into());
        assert!(store.reserve_prepared(&grant,&wrong,104).is_err());
        let mut read=action(&task,"ui_find","Notepad",None);
        read.control_id=Some("Save".into());
        store.reserve_prepared(&grant,&read,105).unwrap();
        let observation=serde_json::json!([{"AutomationId":"Save",
            "ObservedWindowHwnd":42,"ObservedWindowPid":24,
            "ObservedWindowProcessStartTicks":"8675309"}]).to_string();
        store.verify_native_read_output(&task,&grant,&read.action_id,
            "ui_find",&observation,106).unwrap();
        store.record_audit(&task,&grant,&read.action_id,"ui_find",
            Outcome::AuditedSuccess,107).unwrap();
        store.reserve_prepared(&grant,&second,108).unwrap();
        store.record_audit(&task,&grant,&second.action_id,"ui_set_value",
            Outcome::Unknown,109).unwrap();
        assert!(store.reserve_prepared(&grant,&read,110).is_err());
    }

    #[test]
    fn m13_real_uia_root_bindings_require_independent_exact_process_generation(){
        let good=serde_json::json!([{
            "Name":"Save","ObservedWindowHwnd":987,"ObservedWindowPid":1234,
            "ObservedWindowProcessStartTicks":"123456789012"
        }]).to_string();
        assert_eq!(observed_read_root(&good).unwrap().hwnd,987);
        for payload in [
            "[]".to_string(),
            serde_json::json!({"Name":"Save","ObservedWindowHwnd":987,
              "ObservedWindowPid":1234}).to_string(),
            serde_json::json!([{"ObservedWindowHwnd":987,"ObservedWindowPid":1234,
              "ObservedWindowProcessStartTicks":"123456789012"},
              {"ObservedWindowHwnd":988,"ObservedWindowPid":1234,
              "ObservedWindowProcessStartTicks":"123456789012"}]).to_string(),
            serde_json::json!({"ObservedWindowHwnd":987,"ObservedWindowPid":1234,
              "ObservedWindowProcessStartTicks":"FAKE"}).to_string()
        ]{
            assert!(observed_read_root(&payload).is_err());
        }
        let mut store=Store::default();let original=scope();let task=original.task_id.clone();
        let id=store.issue(original,100).unwrap();
        let a=action(&task,"ui_find","Notepad",None);
        store.reserve_prepared(&id,&a,101).unwrap();
        store.verify_native_read_output(&task,&id,&a.action_id,"ui_find",&good,102).unwrap();
        store.record_audit(&task,&id,&a.action_id,"ui_find",Outcome::AuditedSuccess,103).unwrap();
        let b=action(&task,"ui_find","Notepad",None);
        store.reserve_prepared(&id,&b,104).unwrap();
        let changed=good.replace("123456789012","123456789013");
        assert!(store.verify_native_read_output(&task,&id,&b.action_id,
            "ui_find",&changed,105).is_err());
        assert!(store.reserve_prepared(&id,&self::action(&task,"ui_find","Notepad",None),106).is_err());
    }

    #[test]
    fn scoped_value_success_requires_exact_rust_verified_native_readback(){
        let good=serde_json::json!({
            "ObservedWindowHwnd":42,"ObservedWindowPid":24,
            "ObservedWindowProcessStartTicks":"8675309",
            "AutomationId":"Save","VerifiedValue":true
        });
        let bad=[
            serde_json::json!({"message":"text verified"}),
            serde_json::json!({"ObservedWindowHwnd":42,"ObservedWindowPid":24,
                "ObservedWindowProcessStartTicks":"8675309","AutomationId":"Save"}),
            serde_json::json!({"ObservedWindowHwnd":42,"ObservedWindowPid":24,
                "ObservedWindowProcessStartTicks":"8675309","AutomationId":"Save","VerifiedValue":false}),
            serde_json::json!({"ObservedWindowHwnd":42,"ObservedWindowPid":24,
                "ObservedWindowProcessStartTicks":"8675309","AutomationId":"Other","VerifiedValue":true}),
            serde_json::json!({"ObservedWindowHwnd":43,"ObservedWindowPid":24,
                "ObservedWindowProcessStartTicks":"8675309","AutomationId":"Save","VerifiedValue":true}),
            serde_json::json!({"ObservedWindowHwnd":42,"ObservedWindowPid":24,
                "ObservedWindowProcessStartTicks":"8675310","AutomationId":"Save","VerifiedValue":true})
        ];
        for witness in bad {
            let mut owner=scope();
            owner.tools=vec!["ui_find".into(),"ui_set_value".into()];
            owner.risks=vec![Risk::ReadOnly,Risk::UiMutation];
            owner.exact_files.clear();
            let task=owner.task_id.clone();
            let mut store=Store::default();let grant=store.issue(owner,100).unwrap();
            let write=action(&task,"ui_set_value","Notepad",None);
            store.reserve_prepared(&grant,&write,101).unwrap();
            assert!(store.verify_native_read_output(&task,&grant,&write.action_id,
                "ui_set_value",&witness.to_string(),102).is_err());
            assert!(store.record_audit(&task,&grant,&write.action_id,
                "ui_set_value",Outcome::AuditedSuccess,103).is_err());
        }
        for verify in [false,true] {
            let mut owner=scope();
            owner.tools=vec!["ui_find".into(),"ui_set_value".into()];
            owner.risks=vec![Risk::ReadOnly,Risk::UiMutation];
            owner.exact_files.clear();
            let task=owner.task_id.clone();
            let mut store=Store::default();let grant=store.issue(owner,100).unwrap();
            let write=action(&task,"ui_set_value","Notepad",None);
            store.reserve_prepared(&grant,&write,101).unwrap();
            if verify {store.verify_native_read_output(&task,&grant,&write.action_id,
                "ui_set_value",&good.to_string(),102).unwrap();}
            let audited=store.record_audit(&task,&grant,&write.action_id,
                "ui_set_value",Outcome::AuditedSuccess,103);
            assert_eq!(audited.is_ok(),verify);
            if verify {
                assert!(store.reserve_prepared(&grant,
                    &action(&task,"ui_set_value","Notepad",None),104).is_err(),
                    "another write needs independent exact-control UIA inspection");
            }
        }
    }
    #[test]
    fn one_live_action_clock_reversal_and_bounded_count_fail_closed(){
        let mut s=Store::default();let o=scope();let task=o.task_id.clone();
        let token=s.issue(o,100).unwrap();
        let first=action(&task,"ui_find","Notepad",None);
        s.reserve_prepared(&token,&first,101).unwrap();
        assert!(s.reserve_prepared(&token,&self::action(&task,"ui_find","Notepad",None),102).is_err());
        assert!(s.record_audit(&task,&token,&first.action_id,"ui_windows",Outcome::AuditedSuccess,103).is_err());
        s.record_audit(&task,&token,&first.action_id,&first.tool,Outcome::AuditedSuccess,103).unwrap();
        for i in 1..3{
            let a=action(&task,"ui_find","Notepad",None);
            s.reserve_prepared(&token,&a,103+i).unwrap();
            s.record_audit(&task,&token,&a.action_id,&a.tool,Outcome::AuditedSuccess,103+i).unwrap();
        }
        assert!(s.reserve_prepared(&token,&self::action(&task,"ui_find","Notepad",None),110).is_err());
        assert!(s.grant(&task,&token,99).is_err());
    }
}
