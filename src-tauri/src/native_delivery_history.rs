//! Bounded archive of completed Rust final-delivery receipts.
//! Archive metadata is not fresh file verification or app success.
use super::{DeliveryReceipt,check_bytes,check_structure,MAX_BYTES};
use serde::{Serialize,Deserialize};
use std::{collections::HashSet,fs,path::{Path,PathBuf}};
const MAX_PAST:usize=24;
const MAX_ARCHIVE_BYTES:usize=1_048_576;
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Archive{version:u32,items:Vec<DeliveryReceipt>}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct DeliveryHistoryItem{
    recorded_at_ms:u64,objective:String,revision:u32,step_count:usize,
    output_count:usize,first_action_id:String,currently_verified:bool
}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct DeliveryHistoryView{
    version:u32,items:Vec<DeliveryHistoryItem>
}
fn archive_path(last:&Path)->Result<PathBuf,String>{
    Ok(last.parent().ok_or("Missing native receipt directory.")?
        .join("native-task-delivery-history.json"))
}
fn current(last:&Path)->Result<Option<DeliveryReceipt>,String>{
    if !last.exists(){
        if last.with_extension("json.bak").exists()||last.with_extension("json.tmp").exists(){
            return Err("Interrupted last receipt requires owner review.".into());
        }
        return Ok(None);
    }
    let bytes=crate::read_file_bytes_bounded(last,MAX_BYTES,"last native delivery")?;
    check_bytes(&bytes)?;
    let receipt=serde_json::from_slice(&bytes)
        .map_err(|_|"Last native receipt could not be decoded.".to_string())?;
    Ok(Some(receipt))
}
fn validate(archive:&Archive)->Result<(),String>{
    if archive.version!=1||archive.items.len()>MAX_PAST{
        return Err("Native receipt archive exceeded bounds.".into());
    }
    let mut action_ids=HashSet::new();
    for receipt in &archive.items{
        check_structure(receipt)?;
        let size=serde_json::to_vec(receipt)
            .map_err(|_|"Historical native receipt cannot be encoded.")?.len();
        if size>MAX_BYTES{return Err("Historical native receipt too large.".into());}
        for step in &receipt.steps{
            if !action_ids.insert(step.action_id.as_str()){
                return Err("Historical native receipt reuses an action UUID.".into());
            }
        }
    }
    Ok(())
}
fn checked(bytes:&[u8])->Result<(),String>{
    if bytes.len()>MAX_ARCHIVE_BYTES{
        return Err("Native receipt archive too large.".into());
    }
    let archive:Archive=serde_json::from_slice(bytes)
        .map_err(|_|"Native receipt archive corrupt.".to_string())?;
    validate(&archive)
}
fn read_archive(path:&Path)->Result<Archive,String>{
    if !path.exists(){
        if path.with_extension("json.bak").exists()||path.with_extension("json.tmp").exists(){
            return Err("Interrupted receipt archive requires owner review.".into());
        }
        return Ok(Archive{version:1,items:vec![]});
    }
    let bytes=crate::read_file_bytes_bounded(path,MAX_ARCHIVE_BYTES,"delivery archive")?;
    checked(&bytes)?;
    serde_json::from_slice(&bytes).map_err(|_|"Native archive unreadable.".into())
}
fn append(path:&Path,receipt:&DeliveryReceipt)->Result<(),String>{
    check_structure(receipt)?;
    let mut archive=read_archive(path)?;
    let ids:HashSet<&str>=receipt.steps.iter().map(|s|s.action_id.as_str()).collect();
    for old in &archive.items{
        if old.steps.iter().any(|s|ids.contains(s.action_id.as_str())){
            if old.objective==receipt.objective&&old.revision==receipt.revision
                &&old.steps==receipt.steps{
                return Ok(()); // immutable duplicate, no timestamp rewrite
            }
            return Err("Cannot replace historical completed action UUID.".into());
        }
    }
    archive.items.push(receipt.clone());
    if archive.items.len()>MAX_PAST{archive.items.remove(0);}
    validate(&archive)?;
    let bytes=serde_json::to_vec(&archive)
        .map_err(|_|"Cannot serialize receipt archive.")?;
    checked(&bytes)?;
    crate::premiere_store::replace(path,&bytes,MAX_ARCHIVE_BYTES,checked)
}
pub(super) fn archive_predecessor(last:&Path)->Result<(),String>{
    if let Some(prior)=current(last)?{append(&archive_path(last)?,&prior)?;}
    Ok(())
}
pub(super) fn read_recent(last:&Path)->Result<DeliveryHistoryView,String>{
    let mut archived=read_archive(&archive_path(last)?)?.items;
    if let Some(latest)=current(last)?{
        let ids:HashSet<&str>=latest.steps.iter().map(|s|s.action_id.as_str()).collect();
        let mut duplicate=false;
        for older in &archived{
            if older.steps.iter().any(|step|ids.contains(step.action_id.as_str())){
                if older.objective!=latest.objective||older.revision!=latest.revision
                    ||older.steps!=latest.steps{
                    return Err("Last delivered action contradicts historical archive.".into());
                }
                duplicate=true;
            }
        }
        if !duplicate{archived.push(latest);}
    }
    Ok(DeliveryHistoryView{version:1,items:archived.iter().rev()
        .take(MAX_PAST+1).map(|r|DeliveryHistoryItem{
            recorded_at_ms:r.recorded_at_ms,objective:r.objective.chars().take(160).collect(),
            revision:r.revision,step_count:r.steps.len(),
            output_count:r.steps.iter().filter(|s|s.artifact.is_some()).count(),
            first_action_id:r.steps[0].action_id.clone(),currently_verified:false
        }).collect()})
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn temp()->PathBuf{
        let root=std::env::temp_dir().join(format!("shuvi-history-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();root
    }
    fn receipt(id:&str,label:&str,at:u64)->DeliveryReceipt{
        DeliveryReceipt{version:1,objective:label.into(),revision:1,
            recorded_at_ms:at,steps:vec![super::super::DeliveryStep{
                step_id:"inspect".into(),tool:"read_file".into(),
                action_id:id.into(),artifact:None
            }]}
    }
    #[test]
    fn previous_deliveries_survive_replacing_last_task(){
        let root=temp();let last=root.join("native-task-delivery.json");
        super::super::write_at(&last,&receipt(A,"First",1000)).unwrap();
        archive_predecessor(&last).unwrap();
        super::super::write_at(&last,&receipt(B,"Second",2000)).unwrap();
        let a=read_recent(&last).unwrap();
        assert_eq!(a.items.len(),2);
        assert_eq!(a.items[0].objective,"Second");
        assert_eq!(a.items[1].objective,"First");
        assert!(a.items.iter().all(|v|!v.currently_verified));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn last_receipt_survives_crash_gap_and_archival_replay(){
        let root=temp();let last=root.join("native-task-delivery.json");
        super::super::write_at(&last,&receipt(A,"First",1000)).unwrap();
        assert_eq!(read_recent(&last).unwrap().items.len(),1);
        archive_predecessor(&last).unwrap();
        archive_predecessor(&last).unwrap();
        assert_eq!(read_recent(&last).unwrap().items.len(),1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn conflicting_uuid_or_corrupt_archive_never_becomes_empty(){
        let root=temp();let last=root.join("native-task-delivery.json");
        let path=archive_path(&last).unwrap();
        append(&path,&receipt(A,"First",1000)).unwrap();
        assert!(append(&path,&receipt(A,"Forged",2000)).is_err());
        fs::write(&path,b"{").unwrap();
        assert!(read_recent(&last).is_err());
        super::super::write_at(&last,&receipt(B,"Second",2000)).unwrap();
        assert!(archive_predecessor(&last).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
