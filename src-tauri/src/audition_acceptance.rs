use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{fs,io::Write,path::Path,sync::Mutex};

const MAX_BYTES:usize=32*1024;
static WRITES:Mutex<()>=Mutex::new(());

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    pub schema_version:u8,
    pub audition_version:String,
    pub document_signature:String,
    pub document_type:String,
    pub document_name:String,
    pub explicitly_disposable:bool,
}

impl Registration {
    pub fn from_context(context:&Value,explicitly_disposable:bool)->Result<Self,String>{
        if !explicitly_disposable {
            return Err("Explicit disposable Audition document authorization is required.".into());
        }
        if context.get("hasDocument").and_then(Value::as_bool)!=Some(true) {
            return Err("An active Audition document is required.".into());
        }
        let audition_version=context.get("hostVersion").and_then(Value::as_str)
            .filter(|s|!s.trim().is_empty()&&s.len()<=80&& !s.chars().any(char::is_control))
            .ok_or("Audition host version is unavailable or invalid.")?.to_string();
        let document_signature=context.get("documentSignature").and_then(Value::as_str)
            .filter(|s|!s.trim().is_empty()&&*s!="no_document"&&s.len()<=1200&& !s.chars().any(char::is_control))
            .ok_or("Audition document signature is unavailable or invalid.")?.to_string();
        let document_type=context.get("documentType").and_then(Value::as_str)
            .filter(|s|!s.trim().is_empty()&&s.len()<=160&& !s.chars().any(char::is_control))
            .ok_or("Audition document type is unavailable or invalid.")?.to_string();
        let document_name=context.get("documentName").and_then(Value::as_str)
            .filter(|s|!s.trim().is_empty()&&s.len()<=512&& !s.chars().any(char::is_control))
            .ok_or("Audition document name is unavailable or invalid.")?.to_string();

        let registration=Self{
            schema_version:1,
            audition_version,
            document_signature,
            document_type,
            document_name,
            explicitly_disposable:true,
        };
        registration.validate()?;
        Ok(registration)
    }

    pub fn validate(&self)->Result<(),String>{
        if self.schema_version!=1 || !self.explicitly_disposable
            || self.audition_version.trim().is_empty() || self.audition_version.len()>80
            || self.document_signature.trim().is_empty() || self.document_signature=="no_document" || self.document_signature.len()>1200
            || self.document_type.trim().is_empty() || self.document_type.len()>160
            || self.document_name.trim().is_empty() || self.document_name.len()>512
            || [&self.audition_version,&self.document_signature,&self.document_type,&self.document_name]
                .iter().any(|s|s.chars().any(char::is_control))
        {
            return Err("Invalid Audition disposable-document registration.".into());
        }
        Ok(())
    }

    pub fn check(&self,context:&Value)->Result<(),String>{
        self.validate()?;
        if context.get("hostVersion").and_then(Value::as_str)!=Some(self.audition_version.as_str())
            || context.get("documentSignature").and_then(Value::as_str)!=Some(self.document_signature.as_str())
            || context.get("documentType").and_then(Value::as_str)!=Some(self.document_type.as_str())
            || context.get("documentName").and_then(Value::as_str)!=Some(self.document_name.as_str())
        {
            return Err("Current Audition host/document does not match the registered disposable acceptance document.".into());
        }
        Ok(())
    }
}

pub fn plan(registration:Option<&Registration>,feature:Option<&str>)->Result<Value,String>{
    if let Some(feature)=feature {crate::audition::feature_queries(feature)?;}
    let registered=registration.is_some();
    Ok(json!({
        "schema_version":1,
        "feature":feature,
        "disposable_document_registered":registered,
        "mutation_enabled_automatically":false,
        "steps":[
            {"id":"pair_bridge","kind":"read_only","required":true},
            {"id":"inspect_context","kind":"read_only","required":true},
            {"id":"runtime_probe","kind":"read_only","required":true},
            {"id":"discover_feature","kind":"read_only","required":feature.is_some()},
            {"id":"register_disposable","kind":"local_registration","required":true},
            {"id":"recheck_disposable_identity","kind":"read_only","required":true},
            {"id":"acceptance_preflight","kind":"read_only","required":feature.is_some(),"implemented":true},
            {"id":"execute_one_approved_candidate","kind":"high_risk_mutation","implemented":false},
            {"id":"verify_audio_result","kind":"independent_evidence","implemented":false},
            {"id":"verify_recovery","kind":"independent_evidence","implemented":false}
        ],
        "boundaries":[
            "Registration never edits audio.",
            "A registered disposable document must match exact host version and document signature before any future mutation test.",
            "The read-only acceptance preflight may rank and recheck discovered candidates, but it never authorizes or performs mutation.",
            "No destructive acceptance execution is enabled by this planner.",
            "Command acceptance alone will never prove semantic audio quality or persisted output."
        ]
    }))
}

pub fn load(path:&Path)->Result<Option<Registration>,String>{
    let backup=path.with_extension("json.bak");
    let read=|candidate:&Path|->Result<Registration,String>{
        let bytes=crate::read_file_bytes_bounded(candidate,MAX_BYTES,"Audition acceptance registration")?;
        let registration:Registration=serde_json::from_slice(&bytes)
            .map_err(|_|"Corrupt Audition acceptance registration.")?;
        registration.validate()?;
        Ok(registration)
    };
    if path.exists(){
        match read(path){
            Ok(registration)=>return Ok(Some(registration)),
            Err(primary_error)=>{
                if backup.exists(){
                    return read(&backup).map(Some).map_err(|_|primary_error);
                }
                return Err(primary_error);
            }
        }
    }
    if backup.exists(){return read(&backup).map(Some);}
    Ok(None)
}

pub fn save(path:&Path,registration:&Registration)->Result<(),String>{
    registration.validate()?;
    let bytes=serde_json::to_vec(registration).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_BYTES{return Err("Audition acceptance registration exceeds its byte budget.".into());}
    let _guard=WRITES.lock().map_err(|_|"Audition acceptance persistence lock unavailable.")?;
    let tmp=path.with_extension("json.tmp");
    let backup=path.with_extension("json.bak");
    if tmp.exists(){return Err("Interrupted Audition acceptance write exists; inspect it before retrying.".into());}

    let read_valid=|candidate:&Path|->Result<(),String>{
        let existing=crate::read_file_bytes_bounded(candidate,MAX_BYTES,"Audition acceptance registration")?;
        let value:Registration=serde_json::from_slice(&existing)
            .map_err(|_|"Corrupt Audition acceptance registration.".to_string())?;
        value.validate()
    };
    let primary_present=path.try_exists().map_err(|e|e.to_string())?;
    let backup_present=backup.try_exists().map_err(|e|e.to_string())?;
    let primary_valid=primary_present && read_valid(path).is_ok();

    if !primary_valid && primary_present {
        if !backup_present || read_valid(&backup).is_err() {
            return Err("Existing Audition acceptance registration is corrupt and no valid backup exists; preserve it for inspection instead of overwriting.".into());
        }
    }

    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&tmp)
        .map_err(|e|format!("Could not create Audition acceptance temporary file: {e}"))?;
    file.write_all(&bytes).and_then(|_|file.flush()).and_then(|_|file.sync_all())
        .map_err(|e|format!("Could not persist Audition acceptance registration: {e}"))?;
    drop(file);

    if primary_valid {
        if backup_present {fs::remove_file(&backup).map_err(|e|e.to_string())?;}
        fs::rename(path,&backup).map_err(|e|format!("Could not rotate Audition acceptance registration: {e}"))?;
    } else if primary_present {
        fs::remove_file(path).map_err(|e|format!("Could not remove corrupt Audition acceptance primary after validating its backup: {e}"))?;
    }

    fs::rename(&tmp,path).map_err(|e|format!("Could not publish Audition acceptance registration: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;

    fn context()->Value{json!({
        "hasDocument":true,
        "hostVersion":"26.0",
        "documentSignature":"26.0|WaveDocument|fixture.wav|48000|96000",
        "documentType":"WaveDocument",
        "documentName":"fixture.wav"
    })}

    #[test]fn registration_requires_explicit_disposable_and_exact_identity(){
        assert!(Registration::from_context(&context(),false).is_err());
        let registration=Registration::from_context(&context(),true).unwrap();
        registration.check(&context()).unwrap();
        let mut changed=context();
        changed["documentSignature"]=json!("changed");
        assert!(registration.check(&changed).is_err());
    }

    #[test]fn plan_never_enables_mutation(){
        let registration=Registration::from_context(&context(),true).unwrap();
        let value=plan(Some(&registration),Some("noise_reduction")).unwrap();
        assert_eq!(value["mutation_enabled_automatically"],false);
        assert_eq!(value["steps"][6]["id"],"acceptance_preflight");
        assert_eq!(value["steps"][6]["implemented"],true);
        assert_eq!(value["steps"][7]["implemented"],false);
        assert!(plan(Some(&registration),Some("unknown")).is_err());
    }

    #[test]fn persistence_preserves_last_good_backup_and_refuses_stale_tmp(){
        let dir=std::env::temp_dir().join(format!("shuvi-audition-acceptance-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path=dir.join("disposable-v1.json");
        let backup=path.with_extension("json.bak");
        let tmp=path.with_extension("json.tmp");

        let first=Registration::from_context(&context(),true).unwrap();
        save(&path,&first).unwrap();
        let mut second_context=context();
        second_context["documentName"]=json!("fixture-2.wav");
        second_context["documentSignature"]=json!("26.0|WaveDocument|fixture-2.wav|48000|96000");
        let second=Registration::from_context(&second_context,true).unwrap();
        save(&path,&second).unwrap();
        assert!(backup.exists());

        fs::write(&tmp,b"interrupted").unwrap();
        assert!(save(&path,&first).is_err());
        fs::remove_file(&tmp).unwrap();

        fs::write(&path,b"corrupt").unwrap();
        save(&path,&first).unwrap();
        assert!(load(&path).unwrap().is_some());

        fs::write(&path,b"corrupt").unwrap();
        fs::write(&backup,b"corrupt").unwrap();
        assert!(save(&path,&second).is_err());

        let _=fs::remove_file(&path);
        let _=fs::remove_file(&backup);
        let _=fs::remove_file(&tmp);
        let _=fs::remove_dir(&dir);
    }
}
