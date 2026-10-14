use std::{collections::{HashMap, VecDeque}, time::{Duration, Instant}};
use super::animate_bridge::{AnimateBridgeCommand, AnimateBridgeResult};

struct Pending {
    action: String,
    deadline: Instant,
    dispatched: bool,
    result: Option<AnimateBridgeResult>,
}

#[derive(Default)]
pub struct CommandQueue {
    queued: VecDeque<AnimateBridgeCommand>,
    pending: HashMap<String, Pending>,
}

impl CommandQueue {
    pub fn cleanup(&mut self, now: Instant) {
        self.pending.retain(|_, pending| pending.deadline > now);
        self.queued.retain(|command| self.pending.contains_key(&command.id));
    }

    pub fn enqueue(&mut self, command: AnimateBridgeCommand, timeout: Duration) -> Result<(), String> {
        self.cleanup(Instant::now());
        if self.pending.len() >= 32 { return Err("Animate bridge has 32 outstanding commands; wait for completion.".into()); }
        if self.pending.contains_key(&command.id) { return Err("Duplicate Animate command id.".into()); }
        self.pending.insert(command.id.clone(), Pending {
            action: command.action.clone(), deadline: Instant::now() + timeout, dispatched: false, result: None,
        });
        self.queued.push_back(command);
        Ok(())
    }

    pub fn dispatch(&mut self) -> Option<AnimateBridgeCommand> {
        self.cleanup(Instant::now());
        let command = self.queued.pop_front()?;
        self.pending.get_mut(&command.id)?.dispatched = true;
        Some(command)
    }

    pub fn complete(&mut self, result: AnimateBridgeResult) -> Result<(), String> {
        self.cleanup(Instant::now());
        let pending = self.pending.get_mut(&result.id).ok_or("Unknown, cancelled or expired Animate result id.")?;
        if result.action != pending.action { return Err("Animate result action does not match its request.".into()); }
        if (result.success && (result.data.is_none() || result.error.is_some()))
            || (!result.success && (result.data.is_some() || result.error.as_ref().is_none_or(|e| e.trim().is_empty()))) {
            return Err("Contradictory or incomplete Animate result envelope.".into());
        }
        if !pending.dispatched { return Err("Animate command has not been dispatched.".into()); }
        if pending.result.is_some() { return Err("Duplicate Animate result rejected.".into()); }
        pending.result = Some(result);
        Ok(())
    }

    pub fn take_result(&mut self, id: &str) -> Result<Option<AnimateBridgeResult>, String> {
        self.cleanup(Instant::now());
        let pending = self.pending.get_mut(id).ok_or("execution_status_unknown: Animate command expired or bridge session changed. Inspect before retrying; a dispatched edit may have completed.")?;
        let result = pending.result.take();
        if result.is_some() { self.pending.remove(id); }
        Ok(result)
    }

    pub fn remove(&mut self, id: &str) {
        self.pending.remove(id);
        self.queued.retain(|command| command.id != id);
    }

    pub fn clear(&mut self) { self.queued.clear(); self.pending.clear(); }
    pub fn queued_len(&self) -> usize { self.queued.len() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn command(id: &str) -> AnimateBridgeCommand {
        AnimateBridgeCommand { id: id.into(), action: "inspect_context".into(), arguments: json!({}) }
    }
    fn result(id: &str) -> AnimateBridgeResult {
        AnimateBridgeResult { id: id.into(), action: "inspect_context".into(), success: true, data: Some(json!({})), error: None }
    }
    #[test]
    fn rejects_unknown_early_duplicate_and_late_results() {
        let mut queue = CommandQueue::default();
        assert!(queue.complete(result("unknown")).is_err());
        queue.enqueue(command("one"), Duration::from_secs(10)).unwrap();
        assert!(queue.complete(result("one")).is_err());
        assert_eq!(queue.dispatch().unwrap().id, "one");
        queue.complete(result("one")).unwrap();
        assert!(queue.complete(result("one")).is_err());
        assert!(queue.take_result("one").unwrap().is_some());
        queue.remove("one");
        assert!(queue.complete(result("one")).is_err());
    }
    #[test]
    fn rejects_wrong_action_and_contradictory_envelopes_without_consuming_request() {
        let mut queue = CommandQueue::default();
        queue.enqueue(command("one"), Duration::from_secs(10)).unwrap();
        queue.dispatch();
        let mut wrong = result("one");
        wrong.action = "delete_clip".into();
        assert!(queue.complete(wrong).is_err());
        let mut contradictory = result("one");
        contradictory.error = Some("failed".into());
        assert!(queue.complete(contradictory).is_err());
        queue.complete(result("one")).unwrap();
        assert!(queue.take_result("one").unwrap().is_some());
    }
    #[test]
    fn bounds_inflight_and_expires_undispatched_work() {
        let mut queue = CommandQueue::default();
        for i in 0..32 {
            queue.enqueue(command(&i.to_string()), Duration::from_secs(1)).unwrap();
            queue.dispatch();
        }
        assert!(queue.enqueue(command("extra"), Duration::from_secs(1)).is_err());
        queue.cleanup(Instant::now() + Duration::from_secs(2));
        assert!(queue.pending.is_empty());
        queue.enqueue(command("new"), Duration::from_secs(1)).unwrap();
        queue.cleanup(Instant::now() + Duration::from_secs(2));
        assert!(queue.dispatch().is_none());
    }
    #[test]
    fn clear_interrupts_waiters_and_cancellation_removes_queue_entry() {
        let mut queue = CommandQueue::default();
        queue.enqueue(command("one"), Duration::from_secs(10)).unwrap();
        queue.remove("one");
        assert_eq!(queue.queued_len(), 0);
        queue.enqueue(command("two"), Duration::from_secs(10)).unwrap();
        queue.clear();
        assert!(queue.take_result("two").is_err());
    }
}
