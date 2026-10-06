use std::{collections::{HashMap,VecDeque},time::{Duration,Instant}};
use super::photoshop_bridge::{PhotoshopBridgeCommand,PhotoshopBridgeResult};

struct Pending {
    action:String,
    deadline:Instant,
    dispatched:bool,
    result:Option<PhotoshopBridgeResult>,
}

#[derive(Default)]
pub struct CommandQueue {
    queued:VecDeque<PhotoshopBridgeCommand>,
    pending:HashMap<String,Pending>,
}

impl CommandQueue {
    pub fn cleanup(&mut self,now:Instant){
        self.pending.retain(|_,pending|pending.deadline>now);
        self.queued.retain(|command|self.pending.contains_key(&command.id));
    }

    pub fn enqueue(&mut self,command:PhotoshopBridgeCommand,timeout:Duration)->Result<(),String>{
        self.cleanup(Instant::now());
        if self.pending.len()>=32{return Err("Photoshop bridge has 32 outstanding read-only commands; wait for completion.".into());}
        if self.pending.contains_key(&command.id){return Err("Duplicate Photoshop command id.".into());}
        self.pending.insert(command.id.clone(),Pending{
            action:command.action.clone(),deadline:Instant::now()+timeout,dispatched:false,result:None
        });
        self.queued.push_back(command);
        Ok(())
    }

    pub fn dispatch(&mut self)->Option<PhotoshopBridgeCommand>{
        self.cleanup(Instant::now());
        let command=self.queued.pop_front()?;
        self.pending.get_mut(&command.id)?.dispatched=true;
        Some(command)
    }

    pub fn complete(&mut self,result:PhotoshopBridgeResult)->Result<(),String>{
        self.cleanup(Instant::now());
        let pending=self.pending.get_mut(&result.id).ok_or("Unknown, cancelled or expired Photoshop result id.")?;
        if result.action!=pending.action{return Err("Photoshop result action does not match its request.".into());}
        if !pending.dispatched{return Err("Photoshop command has not been dispatched.".into());}
        if pending.result.is_some(){return Err("Duplicate Photoshop result rejected.".into());}
        if (result.success&&(result.data.is_none()||result.error.is_some()))
            ||(!result.success&&(result.data.is_some()||result.error.as_ref().is_none_or(|e|e.trim().is_empty()))){
            return Err("Contradictory or incomplete Photoshop result envelope.".into());
        }
        pending.result=Some(result);
        Ok(())
    }

    pub fn take_result(&mut self,id:&str)->Result<Option<PhotoshopBridgeResult>,String>{
        self.cleanup(Instant::now());
        let pending=self.pending.get_mut(id).ok_or("Photoshop command expired or bridge session changed.")?;
        let result=pending.result.take();
        if result.is_some(){self.pending.remove(id);}
        Ok(result)
    }

    pub fn remove(&mut self,id:&str){
        self.pending.remove(id);
        self.queued.retain(|command|command.id!=id);
    }

    pub fn clear(&mut self){self.queued.clear();self.pending.clear();}
    pub fn queued_len(&self)->usize{self.queued.len()}
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;

    fn command(id:&str)->PhotoshopBridgeCommand{
        PhotoshopBridgeCommand{id:id.into(),action:"inspect_context".into(),arguments:json!({})}
    }
    fn result(id:&str)->PhotoshopBridgeResult{
        PhotoshopBridgeResult{id:id.into(),action:"inspect_context".into(),success:true,data:Some(json!({})),error:None}
    }

    #[test]
    fn request_result_identity_is_exact(){
        let mut queue=CommandQueue::default();
        queue.enqueue(command("one"),Duration::from_secs(10)).unwrap();
        assert!(queue.complete(result("one")).is_err());
        assert_eq!(queue.dispatch().unwrap().id,"one");
        let mut wrong=result("one");wrong.action="list_layers".into();
        assert!(queue.complete(wrong).is_err());
        queue.complete(result("one")).unwrap();
        assert!(queue.take_result("one").unwrap().is_some());
    }

    #[test]
    fn queue_is_bounded_and_clear_interrupts(){
        let mut queue=CommandQueue::default();
        for i in 0..32{
            queue.enqueue(command(&i.to_string()),Duration::from_secs(10)).unwrap();
            queue.dispatch();
        }
        assert!(queue.enqueue(command("extra"),Duration::from_secs(10)).is_err());
        queue.clear();
        assert!(queue.take_result("0").is_err());
    }
}
