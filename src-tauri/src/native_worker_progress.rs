//! Per-launch, private, authenticated Python-worker heartbeat evidence.
//! This is NOT a real Blender application heartbeat. Stages reflect only the
//! specific Blender readback boundaries emitted by the approved plan worker.
//! Staleness is observed using Rust monotonic time, not worker timestamps.
use std::{fs,fs::OpenOptions,io::Write,path::{Path,PathBuf},time::{Duration,Instant}};
use serde::Deserialize;
use sha2::{Digest,Sha256};
use uuid::Uuid;

const LIMIT:usize=2048;
const STARTUP:Duration=Duration::from_secs(20);
const STALE:Duration=Duration::from_secs(14);

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Pulse {
    schema_version:u32,
    action_id:String,
    plan_sha256:String,
    sequence:u64,
    stage:String,
    emitted_at_ms:u64,
    hmac_sha256:String,
}
fn hex(bytes:&[u8])->String{
    bytes.iter().map(|b|format!("{b:02x}")).collect()
}
fn hmac_sha256(key:&[u8;32],message:&[u8])->String{
    let mut inner=[0x36u8;64];
    let mut outer=[0x5cu8;64];
    for i in 0..32 {
        inner[i]^=key[i];outer[i]^=key[i];
    }
    let mut first=Sha256::new();
    first.update(inner);first.update(message);
    let middle=first.finalize();
    let mut second=Sha256::new();
    second.update(outer);second.update(middle);
    hex(&second.finalize())
}
fn stage_rank(stage:&str)->Option<u8>{
    match stage {
        "python_active"=>Some(1),
        "blender_session_attached"=>Some(2),
        "plan_verified"=>Some(3),
        "artifact_rehashed"=>Some(4),
        _=>None
    }
}
pub(crate) struct ProgressChannel{
    pulse:PathBuf,
    key_file:PathBuf,
    key:[u8;32],
    action_id:String,
    plan_sha256:String,
    started:Instant,
    last_tick:Instant,
    last_sequence:u64,
    last_stage:u8,
}
impl ProgressChannel{
    pub(crate) fn create(root:&Path,action:&str,plan_hash:&str)->Result<Self,String>{
        if !root.is_absolute()||!root.is_dir()
            ||Uuid::parse_str(action).map(|x|x.to_string()!=action).unwrap_or(true)
            ||plan_hash.len()!=64||!plan_hash.bytes().all(|b|
                b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
            return Err("Worker heartbeat requires a private folder, action UUID and approved plan hash.".into());
        }
        let random=Uuid::new_v4().to_string();
        let pulse=root.join(format!("worker-{random}.json"));
        let key_file=root.join(format!("worker-{random}.key"));
        let mut key=[0u8;32];
        key[..16].copy_from_slice(Uuid::new_v4().as_bytes());
        key[16..].copy_from_slice(Uuid::new_v4().as_bytes());
        let mut output=OpenOptions::new().write(true).create_new(true).open(&key_file)
            .map_err(|_|"Cannot create private worker key file.")?;
        output.write_all(hex(&key).as_bytes()).and_then(|_|output.sync_all())
            .map_err(|_|"Cannot flush private worker key file.")?;
        Ok(Self{pulse,key_file,key,action_id:action.into(),plan_sha256:plan_hash.into(),
            started:Instant::now(),last_tick:Instant::now(),last_sequence:0,last_stage:0})
    }
    pub(crate) fn pulse_path(&self)->&Path{&self.pulse}
    pub(crate) fn key_path(&self)->&Path{&self.key_file}
    fn verify(&self,p:&Pulse)->Result<u8,String>{
        let stage=stage_rank(&p.stage).ok_or("Unrecognized worker stage.")?;
        if p.schema_version!=1||p.action_id!=self.action_id
            ||p.plan_sha256!=self.plan_sha256||p.sequence==0
            ||p.sequence>1_000_000||p.emitted_at_ms==0
            ||p.hmac_sha256.len()!=64
            ||!p.hmac_sha256.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
            return Err("Worker pulse action, plan or sequence invalid.".into());
        }
        let payload=format!("1\n{}\n{}\n{}\n{}\n{}",
            p.action_id,p.plan_sha256,p.sequence,p.stage,p.emitted_at_ms);
        let mac=hmac_sha256(&self.key,payload.as_bytes());
        // Fixed-length, bytewise diff accumulation avoids early-exit prefix matching.
        let equal=p.hmac_sha256.as_bytes().iter().zip(mac.as_bytes())
            .fold(0u8,|diff,(a,b)|diff|(a^b))==0;
        if !equal {return Err("Worker HMAC cannot be authenticated.".into());}
        Ok(stage)
    }
    pub(crate) fn observe(&mut self)->Result<(),String>{
        if !self.pulse.exists(){
            if self.started.elapsed()>STARTUP{
                return Err("Approved Blender worker never acknowledged launch.".into());
            }
            return Ok(());
        }
        let meta=fs::symlink_metadata(&self.pulse)
            .map_err(|_|"Worker pulse metadata unavailable.")?;
        if !meta.is_file()||meta.file_type().is_symlink()
            ||meta.len()==0||meta.len()>LIMIT as u64{
            return Err("Worker pulse not a bounded regular file.".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes()&0x400!=0{
                return Err("Worker pulse reparse point rejected.".into());
            }
        }
        let raw=crate::read_file_bytes_bounded(&self.pulse,LIMIT,"worker progress pulse")?;
        let pulse:Pulse=serde_json::from_slice(&raw)
            .map_err(|_|"Worker pulse JSON corrupt.")?;
        let stage=self.verify(&pulse)?;
        if pulse.sequence<self.last_sequence||stage<self.last_stage
            ||(pulse.sequence==self.last_sequence&&stage!=self.last_stage){
            return Err("Worker heartbeat regressed or replayed a different stage.".into());
        }
        if pulse.sequence>self.last_sequence {
            self.last_sequence=pulse.sequence;
            self.last_stage=stage;
            self.last_tick=Instant::now();
        }
        if self.last_tick.elapsed()>STALE{
            return Err("Worker heartbeat has stopped while the child is still running.".into());
        }
        Ok(())
    }
    pub(crate) fn require_verified_artifact_ack(&mut self)->Result<(),String>{
        self.observe()?;
        if self.last_stage!=4 {
            return Err("Blender worker did not acknowledge independently rehashed artifact.".into());
        }
        Ok(())
    }
}
impl Drop for ProgressChannel{
    fn drop(&mut self){
        let _=fs::remove_file(&self.pulse);
        let _=fs::remove_file(&self.key_file);
        let _=fs::remove_file(self.pulse.with_extension("json.tmp"));
        self.key.fill(0);
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn pulse(channel:&ProgressChannel,seq:u64,stage:&str)->Pulse{
        let timestamp=1234567890u64;
        let payload=format!("1\n{}\n{}\n{}\n{}\n{}",
            channel.action_id,channel.plan_sha256,seq,stage,timestamp);
        Pulse{schema_version:1,action_id:channel.action_id.clone(),
            plan_sha256:channel.plan_sha256.clone(),sequence:seq,
            stage:stage.into(),emitted_at_ms:timestamp,
            hmac_sha256:hmac_sha256(&channel.key,payload.as_bytes())}
    }
    fn write(channel:&ProgressChannel,p:&Pulse){
        let raw=serde_json::json!({"schemaVersion":p.schema_version,
            "actionId":p.action_id,"planSha256":p.plan_sha256,
            "sequence":p.sequence,"stage":p.stage,"emittedAtMs":p.emitted_at_ms,
            "hmacSha256":p.hmac_sha256});
        fs::write(&channel.pulse,serde_json::to_vec(&raw).unwrap()).unwrap();
    }
    #[test]
    fn authenticated_worker_ack_advances_only_after_actual_stage_evidence(){
        let root=std::env::temp_dir();
        let mut channel=ProgressChannel::create(&root,
            "e8b36b21-1c6a-459e-9b6f-75dd5692ab81",&"a".repeat(64)).unwrap();
        assert!(channel.require_verified_artifact_ack().is_err());
        write(&channel,&pulse(&channel,1,"python_active"));
        channel.observe().unwrap();
        write(&channel,&pulse(&channel,2,"blender_session_attached"));
        channel.observe().unwrap();
        write(&channel,&pulse(&channel,3,"plan_verified"));
        channel.observe().unwrap();
        assert!(channel.require_verified_artifact_ack().is_err());
        write(&channel,&pulse(&channel,4,"artifact_rehashed"));
        channel.require_verified_artifact_ack().unwrap();
    }
    #[test]
    fn tamper_foreign_action_and_replay_cannot_invent_progress(){
        let root=std::env::temp_dir();
        let mut channel=ProgressChannel::create(&root,
            "e8b36b21-1c6a-459e-9b6f-75dd5692ab81",&"b".repeat(64)).unwrap();
        let mut forged=pulse(&channel,1,"python_active");
        forged.plan_sha256="c".repeat(64);
        write(&channel,&forged);
        assert!(channel.observe().is_err());
        let first=pulse(&channel,1,"python_active");
        write(&channel,&first);channel.observe().unwrap();
        write(&channel,&pulse(&channel,2,"plan_verified"));
        channel.observe().unwrap();
        write(&channel,&pulse(&channel,1,"python_active"));
        assert!(channel.observe().is_err());
        let mut wrong=pulse(&channel,3,"artifact_rehashed");
        wrong.action_id="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172".into();
        write(&channel,&wrong);
        assert!(channel.observe().is_err());
    }
    #[test]
    fn malformed_and_missing_evidence_cannot_unlock_worker(){
        let root=std::env::temp_dir();
        let mut channel=ProgressChannel::create(&root,
            "e8b36b21-1c6a-459e-9b6f-75dd5692ab81",&"d".repeat(64)).unwrap();
        assert!(channel.require_verified_artifact_ack().is_err());
        fs::write(&channel.pulse,b"{").unwrap();
        assert!(channel.observe().is_err());
        fs::write(&channel.pulse,vec![b'x';LIMIT+1]).unwrap();
        assert!(channel.observe().is_err());
    }
}
