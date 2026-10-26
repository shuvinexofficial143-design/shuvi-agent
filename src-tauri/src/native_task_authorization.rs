//! SHUVI 60 M1.1: Rust-only owner task authorization kernel.
//!
//! This module is deliberately NOT an execution bypass or public IPC route.
//! Only a trusted native owner-consent handler may issue a scope. A future
//! executor integration must call admission AFTER Rust prepare and BEFORE
//! dispatch under the pending-action lock, and finish using the *real* Rust
//! audit receipt. No checkpoint, model text or WebView state restores authority.
//! Existing Allow once, exact-file physical checks, UIA root binding and Rust
//! action audit remain mandatory until that integration is tested end-to-end.
use std::collections::{HashMap,HashSet};
use uuid::Uuid;

pub(crate) const MAX_DURATION_MS:u64=10*24*60*60*1000;
const MAX_ACTIVE:usize=4;
const MAX_ISSUED:usize=8_192;
const MAX_ACTIONS:u32=20_000;
const MAX_AI_REQUESTS:u32=2048;

#[derive(Clone,Copy,Debug,PartialEq,Eq,Hash)]
pub(crate) enum Risk { ReadOnly, UiMutation, FileEdit }

fn risk_for(tool:&str)->Option<Risk>{
    match tool {
        "ui_windows"|"ui_discover"|"ui_find"|"list_processes"|
        "read_file"|"list_directory"|"search_text"|
        "premiere_bridge_status"|"premiere_context"|
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

#[derive(Clone,Debug)]
pub(crate) struct OwnerScope {
    pub task_id:String,
    pub owner_consent_id:String,
    pub objective_digest:String, // SHA-256 hex of the reviewed task; not prose.
    pub applications:Vec<String>, // exact app names, never a wildcard
    pub exact_files:Vec<String>,  // additionally checked by existing native file guard
    pub tools:Vec<String>,
    pub risks:Vec<Risk>,
    pub valid_for_ms:u64,
    pub max_actions:u32,
    pub max_ai_requests:u32,
    // An estimate guard, NOT a provider bill or guaranteed USD cap.
    // Unknown prices are always refused when this is Some.
    pub max_estimated_ai_micro_usd:Option<u64>,
}
impl OwnerScope {
    fn validate(&self)->Result<(),String>{
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
            self.exact_files.len()>64||self.tools.is_empty()||self.tools.len()>32||
            self.risks.is_empty()||self.risks.len()>3{
            return Err("Owner task scope or finite budgets invalid.".into());
        }
        if self.applications.iter().any(|app|!label(app,100)||app=="*"||
            app.contains('*')||app.contains('?'))||
           self.exact_files.iter().any(|p|!is_exact_local_windows_file(p))||
           self.tools.iter().any(|t|risk_for(t).is_none())||
           self.tools.iter().any(|t|!self.risks.contains(&risk_for(t).unwrap()))||
           self.applications.iter().collect::<HashSet<_>>().len()!=self.applications.len()||
           self.exact_files.iter().collect::<HashSet<_>>().len()!=self.exact_files.len()||
           self.tools.iter().collect::<HashSet<_>>().len()!=self.tools.len()||
           self.risks.iter().collect::<HashSet<_>>().len()!=self.risks.len()||
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
}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub(crate) enum Outcome { AuditedSuccess, AuditedFailure, Unknown }
#[derive(Clone)]
struct Pending {id:String,tool:String}
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
    paused:bool,
}
#[derive(Default)]
pub(crate) struct Store {
    active:HashMap<String,Grant>,
    issued:HashSet<String>,
}
impl Store {
    /// Call ONLY after explicit owner review in the native authorization
    /// handler, not from model JSON, scheduler checkpoint or recovered WebView.
    pub(crate) fn issue(&mut self,scope:OwnerScope,now:u64)->Result<String,String>{
        scope.validate()?;
        let expiry=now.checked_add(scope.valid_for_ms)
            .ok_or("Task authorization deadline overflow.")?;
        if now==0||self.issued.contains(&scope.task_id)||
            self.active.len()>=MAX_ACTIVE||self.issued.len()>=MAX_ISSUED{
            return Err("Owner approval identity already used or task capacity exhausted.".into());
        }
        let id=Uuid::new_v4().to_string();
        self.issued.insert(scope.task_id.clone());
        self.active.insert(scope.task_id.clone(),Grant{
            scope,scope_id:id.clone(),deadline_ms:expiry,last_observed_ms:now,
            actions:0,requests:0,estimated_ai_micro_usd:0,
            observed_ids:HashSet::new(),pending:None,paused:false
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
    /// This is only an admission decision and a single-use reservation:
    /// it neither calls a native tool nor claims that the tool ran.
    pub(crate) fn reserve_prepared(&mut self,scope_id:&str,action:&PreparedAction,
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
        g.actions+=1; // unknown or failed dispatch still consumes the action
        g.pending=Some(Pending{id:action.action_id.clone(),tool:action.tool.clone()});
        Ok(())
    }
    /// Requires an independently verified native Rust audit result. Unknown
    /// or failed actions PAUSE; they cannot be blindly retried under this grant.
    pub(crate) fn record_audit(&mut self,task:&str,scope_id:&str,
        action_id:&str,tool:&str,outcome:Outcome,now:u64)->Result<(),String>{
        let g=self.grant(task,scope_id,now)?;
        let pending=g.pending.as_ref().ok_or("No scoped action awaiting Rust audit.")?;
        if pending.id!=action_id||pending.tool!=tool{
            return Err("Audit has foreign action UUID or tool.".into());
        }
        g.pending=None;
        if outcome!=Outcome::AuditedSuccess {g.paused=true;}
        Ok(())
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
         tools:vec!["ui_windows".into(),"ui_find".into(),
             "ui_click".into(),"ui_set_value".into(),"write_file".into()],
         risks:vec![Risk::ReadOnly,Risk::UiMutation,Risk::FileEdit],
         valid_for_ms:MAX_DURATION_MS,max_actions:3,max_ai_requests:2,
         max_estimated_ai_micro_usd:Some(100_000)}
    }
    fn action(task:&str,tool:&str,app:&str,path:Option<&str>)->PreparedAction{
        PreparedAction{task_id:task.into(),action_id:id(),tool:tool.into(),
            application:app.into(),exact_file:path.map(str::to_owned)}
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
            assert!(s.reserve_prepared(&token,&action(&task,"ui_click","Notepad",None),103).is_err());
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
    fn one_live_action_clock_reversal_and_bounded_count_fail_closed(){
        let mut s=Store::default();let o=scope();let task=o.task_id.clone();
        let token=s.issue(o,100).unwrap();
        let first=action(&task,"ui_find","Notepad",None);
        s.reserve_prepared(&token,&first,101).unwrap();
        assert!(s.reserve_prepared(&token,&action(&task,"ui_find","Notepad",None),102).is_err());
        assert!(s.record_audit(&task,&token,&first.action_id,"ui_windows",Outcome::AuditedSuccess,103).is_err());
        s.record_audit(&task,&token,&first.action_id,&first.tool,Outcome::AuditedSuccess,103).unwrap();
        for i in 1..3{
            let a=action(&task,"ui_find","Notepad",None);
            s.reserve_prepared(&token,&a,103+i).unwrap();
            s.record_audit(&task,&token,&a.action_id,&a.tool,Outcome::AuditedSuccess,103+i).unwrap();
        }
        assert!(s.reserve_prepared(&token,&action(&task,"ui_find","Notepad",None),110).is_err());
        assert!(s.grant(&task,&token,99).is_err());
    }
}
