//! Opt-in real-host acceptance. Ordinary CI must never launch Adobe.
use crate::{after_effects_runtime as runtime,after_effects_transport::{self,Request}};
use serde_json::{json,Value};
use std::{fs::{self,OpenOptions},io::Write,path::{Path,PathBuf},process::Command,time::{Duration,Instant,SystemTime}};

const FIXTURE_SCRIPT:&str=include_str!("../../integrations/after-effects-extendscript/acceptance/fixture.jsx");
const CORE_BYTES:&[u8]=include_bytes!("../../integrations/after-effects-extendscript/shuvi-ae.jsx");
fn write_new(path:&Path,bytes:&[u8])->Result<(),String>{
    let mut file=OpenOptions::new().create_new(true).write(true).open(path).map_err(|e|e.to_string())?;
    file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|e|e.to_string())
}
fn flags(request:&Request,result:&Value)->Value{
    json!({"request_accepted":result["host_receipt_ok"]==true,
        "mutation_execution_reported":request.is_mutating()&&result["result"]["native_accepted"]==true,
        "mutation_readback_verified":request.is_mutating()&&result["post_state_verified"]==true,
        "save_persistence_verified":request.action=="save_project"&&result["project_persistence_evidence"]["persistence_verified"]==true,
        "visual_semantics_verified":false,"runtime_verified":false,"production_ready":false})
}
struct Suite{
    exe:PathBuf,core:PathBuf,root:PathBuf,jobs:PathBuf,project:PathBuf,run_id:String,source_sha:String,
    events:Vec<Value>,next:usize,mutations:usize,
}
impl Suite{
    fn new()->Result<Self,String>{
        if std::env::var("SHUVI_AE_ACCEPTANCE").as_deref()!=Ok("disposable-only"){
            return Err("Real-host acceptance requires explicit SHUVI_AE_ACCEPTANCE=disposable-only opt-in.".into());
        }
        let exe=PathBuf::from(std::env::var_os("SHUVI_AE_EXE").ok_or("No trusted AE executable configured.")?);
        runtime::trusted_afterfx_exe(&exe)?;
        let repo=Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or("Repository root unavailable.")?;
        let status=Command::new("git").args(["status","--porcelain"]).current_dir(repo).output().map_err(|e|e.to_string())?;
        if !status.status.success()||!status.stdout.is_empty(){return Err("Acceptance requires a clean tracked source checkout.".into());}
        let head=Command::new("git").args(["rev-parse","HEAD"]).current_dir(repo).output().map_err(|e|e.to_string())?;
        let source_sha=String::from_utf8(head.stdout).map_err(|e|e.to_string())?.trim().to_owned();
        if !head.status.success()||source_sha.len()!=40||!source_sha.bytes().all(|b|b.is_ascii_hexdigit()){
            return Err("Exact source commit unavailable.".into());
        }
        let core=repo.join("integrations/after-effects-extendscript/shuvi-ae.jsx");
        if fs::read(&core).map_err(|e|e.to_string())?!=CORE_BYTES{return Err("Bundled adapter differs from compiled acceptance source.".into());}
        let run_id=uuid::Uuid::new_v4().simple().to_string();
        let base=std::env::var_os("SHUVI_AE_EVIDENCE_ROOT").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        if !base.is_absolute()||!base.is_dir(){return Err("Evidence parent must be an existing absolute directory.".into());}
        reject_links(&base)?;
        let root=base.join(format!("shuvi-ae-acceptance-{run_id}"));fs::create_dir(&root).map_err(|e|e.to_string())?;
        let project=root.join("acceptance.aep");let jobs=root.join("jobs");fs::create_dir(&jobs).map_err(|e|e.to_string())?;
        write_new(&root.join("owner.json"),&serde_json::to_vec(&json!({"schema_version":1,"run_id":run_id,"project_file":project,"source_sha":source_sha})).map_err(|e|e.to_string())?)?;
        Ok(Self{exe,core,root,jobs,project,run_id,source_sha,events:Vec::new(),next:0,mutations:0})
    }
    fn id(&mut self)->String{self.next+=1;format!("acceptance-{}-{}",self.run_id,self.next)}
    fn lifecycle(&mut self,phase:&str,extra:Value)->Result<Value,String>{
        let id=self.id();let receipt_path=self.root.join(format!("{id}.fixture-receipt.json"));
        let script_path=self.root.join(format!("{id}.fixture-runner.jsx"));
        let pending=self.root.join("lifecycle.pending.json");
        let mut config=json!({"schema_version":1,"run_id":self.run_id,"request_id":id,
            "phase":phase,"fixture_dir":self.root,"project_file":self.project});
        for (key,value) in extra.as_object().ok_or("Lifecycle evidence must be an object.")?{config[key]=value.clone();}
        write_new(&pending,&serde_json::to_vec(&config).map_err(|e|e.to_string())?)?;
        let script=["(function(){\n",FIXTURE_SCRIPT,"\nvar config=",&config.to_string(),";var out={schema_version:1,request_id:config.request_id,run_id:config.run_id,ok:false};try{out.result=ShuviAEAcceptanceFixture.run(config);out.ok=true;}catch(e){out.error=String(e.message||e).slice(0,2000);}var f=new File(",
            &json!(receipt_path).to_string(),");f.encoding='UTF-8';if(!f.open('w'))throw new Error('Acceptance receipt unavailable');try{f.write(JSON.stringify(out));}finally{f.close();}\n})();"].concat();
        write_new(&script_path,script.as_bytes())?;
        Command::new(&self.exe).arg("-r").arg(&script_path).spawn().map_err(|e|e.to_string())?;
        let start=Instant::now();
        while start.elapsed()<Duration::from_secs(30){
            if receipt_path.is_file(){
                let bytes=crate::read_file_bytes_bounded(&receipt_path,64*1024,"Acceptance fixture receipt")?;
                if let Ok(receipt)=serde_json::from_slice::<Value>(&bytes){
                    if receipt["schema_version"]!=1||receipt["request_id"]!=id||receipt["run_id"]!=self.run_id{
                        return Err("Fixture receipt identity mismatch; lifecycle remains unresolved.".into());
                    }
                    self.events.push(json!({"case":phase,"fixture_receipt":receipt,"retry_safe":false}));
                    fs::remove_file(&pending).map_err(|e|e.to_string())?;
                    if receipt["ok"]!=true{return Err(format!("Fixture {phase} rejected: {}",receipt["error"]));}
                    return Ok(receipt);
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Fixture timeout: outcome uncertain. Retained lifecycle marker blocks reopening/retrying this fixture.".into())
    }
    async fn dispatch(&mut self,label:&str,action:&str,args:Value,revision:Option<u64>)->Result<Value,String>{
        let request=Request{schema_version:1,request_id:self.id(),action:action.into(),args,
            expected_project_file:Some(self.project.to_string_lossy().into_owned()),expected_project_revision:revision};
        if request.is_mutating(){self.mutations+=1;if self.mutations>30{return Err("Acceptance mutation budget exhausted; preserve checkpoint retention.".into());}}
        let result=runtime::execute(&self.exe,&self.core,&self.jobs,&request,30_000).await?;
        self.events.push(json!({"case":label,"request":request,"evidence":flags(&request,&result),"execution":result}));
        if result["state"]=="execution_status_unknown"||result["host_receipt_ok"]!=true{
            return Err(format!("{label}: uncertain/rejected request; no retry: {}",result["state"]));
        }
        Ok(result)
    }
    async fn inspect(&mut self,action:&str,args:Value)->Result<Value,String>{
        let result=self.dispatch(action,action,args,None).await?;
        if result["state"]!="verified"{return Err(format!("{action}: inspection was not verified."));}Ok(result["result"].clone())
    }
    async fn context(&mut self)->Result<Value,String>{
        let value=self.inspect("inspect_context",json!({})).await?;
        if value["project_file"].as_str()!=Some(self.project.to_string_lossy().as_ref()){
            return Err("Active host project is not this disposable fixture; stop.".into());
        }Ok(value)
    }
    async fn step(&mut self,action:&str,args:Value)->Result<Value,String>{
        let context=self.context().await?;
        let revision=context["project_revision"].as_u64().ok_or("Fresh revision missing.")?;
        let result=self.dispatch(action,action,args,Some(revision)).await?;
        if result["post_state_verified"]!=true{return Err(format!("{action}: accepted but readback unverified; stop without retry."));}
        if !result["checkpoint"]["backup_path"].is_string(){return Err("Mutation checkpoint evidence missing.".into());}
        Ok(result["result"].clone())
    }
    fn report(&self,error:Option<&str>)->Value{
        json!({"schema_version":1,"run_id":self.run_id,"source_sha":self.source_sha,"project_file":self.project,
            "state":if error.is_some(){"stopped_requires_review"}else{"representative_cases_completed_remaining_pending"},
            "error":error,"events":self.events,"mutation_count":self.mutations,
            "evidence_dimensions":{"source_implementation":"implemented","static_model_tests":"external_current_revision_CI_required",
                "windows_compile":cfg!(windows),"real_after_effects_host_execution":!self.events.is_empty(),
                "extendscript_acceptance":"per_case_only","mutation_semantics":"per_case_only",
                "save_persistence":"saved_bytes_and_explicit_post_reopen_observations_only",
                "render_completion":"per_render_case_only","media_parse":"optional_probe_per_output_only",
                "visual_semantics_verified":false,"runtime_verified":false,"production_ready":false},
            "pending":["visual review","Essential media replacement with an approved source asset","renderer/version coverage",
                "preset acceptance unless explicitly supplied","render/cancellation unless explicitly enabled","full production review"],
            "fixture_cleanup":"retained_for_review_no_automatic_deletion_or_user_project_restoration"})
    }
}
fn reject_links(path:&Path)->Result<(),String>{
    for part in path.ancestors(){let meta=fs::symlink_metadata(part).map_err(|e|e.to_string())?;
        if meta.file_type().is_symlink(){return Err("Acceptance paths cannot contain symlinks.".into());}
        #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("Acceptance paths cannot contain reparse points.".into());}}
    }Ok(())
}
fn property(comp:u64,layer:u64,group:&str,name:&str)->Value{
    json!({"target":{"comp_id":comp,"layer_id":layer},"path":[{"match_name":group},{"match_name":name}]})
}
fn id(value:&Value,key:&str)->Result<u64,String>{value[key].as_u64().filter(|v|*v>0).ok_or_else(||format!("Verified created {key} missing."))}
async fn core_cases(s:&mut Suite)->Result<(),String>{
    let comp=s.step("create_comp",json!({"name":"Shuvi Acceptance","width":320,"height":180,"pixel_aspect":1.0,"duration_seconds":1.0,"frame_rate":24.0})).await?;
    let comp=id(&comp,"comp_id")?;
    let null=s.step("add_null",json!({"comp_id":comp,"name":"Acceptance Control"})).await?;let null=id(&null,"layer_id")?;
    let opacity=property(comp,null,"ADBE Transform Group","ADBE Opacity");
    s.step("set_property",json!({"property":opacity,"value":75})).await?;
    let before=s.inspect("inspect_property",json!({"property":opacity})).await?;
    if before["value"]!=75{return Err("Independent opacity inspection mismatch.".into());}
    let context=s.context().await?;let revision=context["project_revision"].as_u64().ok_or("Revision missing.")?;
    let stale=Request{schema_version:1,request_id:s.id(),action:"set_property".into(),args:json!({"property":opacity,"value":99}),
        expected_project_file:Some(s.project.to_string_lossy().into_owned()),expected_project_revision:Some(revision+1)};
    let rejected=runtime::execute(&s.exe,&s.core,&s.jobs,&stale,30_000).await?;
    let after=s.inspect("inspect_property",json!({"property":opacity})).await?;
    let guard_ok=rejected["host_receipt_ok"]==false&&rejected["host_error"].as_str().is_some_and(|v|v.contains("revision changed"))&&after["value"]==75;
    s.events.push(json!({"case":"stale_revision_rejected_without_write","request":stale,"execution":rejected,"independent_readback":after,"verified":guard_ok}));
    if !guard_ok{return Err("Stale revision guard failed or outcome uncertain.".into());}
    let position=property(comp,null,"ADBE Transform Group","ADBE Position");
    s.step("set_values_at_times",json!({"property":position,"times":[0.0,0.5],"values":[[80,90],[240,90]]})).await?;
    s.inspect("inspect_keyframes",json!({"property":position})).await?;
    s.step("set_expression",json!({"property":opacity,"expression":"75"})).await?;
    s.inspect("inspect_property",json!({"property":opacity})).await?;
    s.step("add_effect",json!({"comp_id":comp,"layer_id":null,"match_name":"ADBE Slider Control"})).await?;
    s.inspect("inspect_effects",json!({"comp_id":comp,"layer_id":null})).await?;
    let text=s.step("add_text",json!({"comp_id":comp,"text":"Shuvi Acceptance","name":"Acceptance Title"})).await?;let text=id(&text,"layer_id")?;
    s.step("set_text_style",json!({"comp_id":comp,"layer_id":text,"font_size":28})).await?;
    let shape=s.step("add_shape",json!({"comp_id":comp,"name":"Acceptance Shape"})).await?;let shape=id(&shape,"layer_id")?;
    s.step("add_shape_primitive",json!({"comp_id":comp,"layer_id":shape,"kind":"rectangle","size":[80,40],"fill_color":[0.1,0.5,1,1]})).await?;
    s.step("set_layer_parent",json!({"comp_id":comp,"layer_id":shape,"parent_layer_id":null,"preserve_visual":true})).await?;
    s.step("add_mask",json!({"comp_id":comp,"layer_id":text,"vertices":[[0,0],[320,0],[320,180],[0,180]],"closed":true})).await?;
    let duplicate=s.step("duplicate_layer",json!({"comp_id":comp,"layer_id":text})).await?;
    s.step("remove_layer",json!({"comp_id":comp,"layer_id":id(&duplicate,"created_layer_id")?})).await?;
    let precomp=s.step("precompose_layers",json!({"comp_id":comp,"layer_ids":[shape],"name":"Acceptance Nested","move_all_attributes":true})).await?;
    s.inspect("inspect_comp",json!({"comp_id":id(&precomp,"created_comp_id")?})).await?;
    let camera=s.step("add_camera",json!({"comp_id":comp,"name":"Acceptance Camera","center_point":[160,90]})).await?;let camera=id(&camera,"layer_id")?;
    let options=s.inspect("inspect_camera_options",json!({"comp_id":comp,"layer_id":camera})).await?;
    if !options["options"]["zoom"].is_null(){s.step("set_camera_options",json!({"comp_id":comp,"layer_id":camera,"zoom":500})).await?;}
    let light=s.step("add_light",json!({"comp_id":comp,"name":"Acceptance Light","center_point":[160,90]})).await?;let light=id(&light,"layer_id")?;
    s.inspect("inspect_light_options",json!({"comp_id":comp,"layer_id":light})).await?;
    s.step("set_light_options",json!({"comp_id":comp,"layer_id":light,"intensity":80})).await?;
    s.step("set_av_layer_flags",json!({"comp_id":comp,"layer_id":text,"three_d_layer":true})).await?;
    s.inspect("inspect_3d_material",json!({"comp_id":comp,"layer_id":text})).await?;
    s.step("set_layer_transform",json!({"comp_id":comp,"layer_id":text,"position":[160,90,0],"orientation":[0,0,0]})).await?;
    s.inspect("inspect_layer_transform",json!({"comp_id":comp,"layer_id":text})).await?;
    let recipe=crate::after_effects_templates::TemplatePlan{schema_version:1,name:"Acceptance title".into(),category:"title".into(),
        project_file:s.project.to_string_lossy().into_owned(),bindings:Default::default(),
        steps:vec![crate::after_effects_templates::Step{action:"set_text_style".into(),args:json!({"comp_id":comp,"layer_id":text,"font_size":32})},
            crate::after_effects_templates::Step{action:"set_layer_transform".into(),args:json!({"comp_id":comp,"layer_id":text,"z_rotation":10})}]};
    let plan=crate::after_effects_templates::plan(&recipe)?;
    for step in plan["steps"].as_array().ok_or("Template plan steps missing.")?{
        s.step(step["host_action"].as_str().ok_or("Action missing.")?,step["host_args"].clone()).await?;
    }
    s.step("save_project",json!({})).await?;
    let snapshots=[("opacity",json!({"property":opacity})),("position",json!({"property":position}))];
    let mut saved=Vec::new();for (name,args) in &snapshots{saved.push(json!({"name":name,"args":args,"value":s.inspect("inspect_property",args.clone()).await?}));}
    let before=s.context().await?;
    let checkpoint_id=s.id();
    let checkpoint=crate::after_effects_checkpoint::create_for_request(&s.project,crate::now_ms(),&checkpoint_id,before["project_revision"].as_u64().ok_or("Revision missing.")?)?;
    let backup=checkpoint["backup_path"].as_str().ok_or("Checkpoint path missing.")?;
    let recovery=crate::after_effects_checkpoint::recovery_plan(Path::new(backup),&s.project,None)?;
    let meta=fs::metadata(&s.project).map_err(|e|e.to_string())?;
    let modified=meta.modified().map_err(|e|e.to_string())?.duration_since(SystemTime::UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis();
    s.lifecycle("reopen",json!({"expected_project_revision":before["project_revision"],"saved_file_verified":true,
        "checkpoint_verified":true,"expected_size_bytes":meta.len(),"expected_modified_ms":modified}))?;
    s.context().await?;
    for snapshot in saved{
        let after=s.inspect("inspect_property",snapshot["args"].clone()).await?;
        let persisted=snapshot["value"]["value"]==after["value"]&&snapshot["value"]["num_keys"]==after["num_keys"]
            &&snapshot["value"]["expression_enabled"]==after["expression_enabled"];
        s.events.push(json!({"case":"save_reopen_property_persistence","name":snapshot["name"],"before":snapshot["value"],"after":after,"persistence_verified":persisted,"visual_semantics_verified":false}));
        if !persisted{return Err("Post-reopen property persistence mismatch.".into());}
    }
    s.events.push(json!({"case":"recovery_plan","evidence":recovery,"recovery_of_host_state_verified":false}));
    late_receipt_case(s).await?;
    Ok(())
}
async fn late_receipt_case(s:&mut Suite)->Result<(),String>{
    s.context().await?;
    let request=Request{schema_version:1,request_id:s.id(),action:"inspect_context".into(),expected_project_file:Some(s.project.to_string_lossy().into_owned()),expected_project_revision:None,args:json!({})};
    let plan=after_effects_transport::runner_plan(&s.exe,&s.core,&s.jobs,&request)?;
    let script=plan.runner_script.replace("receipt.result=ShuviAE.dispatch(request);","$.sleep(2500);receipt.result=ShuviAE.dispatch(request);");
    if script==plan.runner_script{return Err("Controlled late receipt wrapper could not be constructed.".into());}
    write_new(&plan.request_path,&serde_json::to_vec(&request).map_err(|e|e.to_string())?)?;
    write_new(&plan.runner_path,script.as_bytes())?;
    Command::new(&s.exe).args(&plan.afterfx_arguments).spawn().map_err(|e|e.to_string())?;
    tokio::time::sleep(Duration::from_millis(1000)).await;
    let pending=runtime::pending_jobs(&s.jobs,false)?;
    if pending["new_dispatch_allowed"]!=false||plan.receipt_path.exists(){return Err("Delayed wrapper did not establish real unresolved blocking.".into());}
    s.events.push(json!({"case":"controlled_delayed_read_only_wrapper","pending":pending,"origin":"acceptance_fixture_wrapper","retry_safe":false}));
    let start=Instant::now();while start.elapsed()<Duration::from_secs(15){
        let status=runtime::pending_jobs(&s.jobs,false)?;
        if status["jobs"].as_array().is_some_and(|v|v.iter().any(|j|j["state"]=="receipt_available")){
            let reconciled=runtime::pending_jobs(&s.jobs,true)?;
            if reconciled["new_dispatch_allowed"]!=true{return Err("Late receipt did not release dispatch blocking.".into());}
            s.events.push(json!({"case":"late_receipt_reconciliation","evidence":reconciled,"retry_safe":false}));return Ok(());
        }tokio::time::sleep(Duration::from_millis(100)).await;
    }Err("Late receipt remains unresolved; no retry or process kill.".into())
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn acceptance_evidence_does_not_promote_acceptance_to_readback_or_persistence(){
        let request=Request{schema_version:1,request_id:"test".into(),action:"set_property".into(),args:json!({}),expected_project_file:None,expected_project_revision:None};
        let accepted=json!({"host_receipt_ok":true,"result":{"native_accepted":true},"post_state_verified":false});
        let evidence=flags(&request,&accepted);assert_eq!(evidence["request_accepted"],true);
        assert_eq!(evidence["mutation_execution_reported"],true);assert_eq!(evidence["mutation_readback_verified"],false);
        assert_eq!(evidence["save_persistence_verified"],false);assert_eq!(evidence["production_ready"],false);
        let mut readback=accepted;readback["post_state_verified"]=json!(true);
        assert_eq!(flags(&request,&readback)["save_persistence_verified"],false);
    }
    #[test]
    #[ignore="Requires an existing compatible trusted After Effects install, explicit disposable-only opt-in and clean source checkout"]
    fn real_host_acceptance(){
        let mut suite=Suite::new().expect("Real After Effects acceptance unavailable or not explicitly enabled");
        let bootstrap=suite.lifecycle("bootstrap",json!({}));
        let outcome=bootstrap.and_then(|_|{
            let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e|e.to_string())?;
            runtime.block_on(core_cases(&mut suite))
        });
        let report=suite.report(outcome.as_ref().err().map(String::as_str));
        let bytes=serde_json::to_vec_pretty(&report).expect("Report serialization");
        assert!(bytes.len()<=8*1024*1024,"Acceptance report exceeds bound; raw receipts remain retained");
        let report_path=suite.root.join("acceptance-report.json");write_new(&report_path,&bytes).expect("Persist acceptance evidence");
        println!("AFTER_EFFECTS_ACCEPTANCE_REPORT={}",report_path.display());
        assert!(outcome.is_ok(),"Acceptance stopped: {}",outcome.unwrap_err());
    }
}
