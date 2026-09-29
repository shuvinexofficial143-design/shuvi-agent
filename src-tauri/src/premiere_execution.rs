//! Bind prepared cancellation to one execution, including the start/reset race.
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};

#[derive(Default)]
struct State { generation: u64, active: bool }
#[derive(Default)]
pub struct Execution { state: Mutex<State> }
pub struct Lease<'a> { owner: &'a Execution, generation: u64 }

impl Execution {
    pub fn begin<'a>(&'a self, cancelled: &AtomicBool) -> Result<Lease<'a>, String> {
        let mut state = self.state.lock().map_err(|_| "Premiere execution state unavailable.")?;
        if state.active { return Err("Another Premiere workflow execution is active.".into()); }
        state.generation = state.generation.checked_add(1).ok_or("Execution generation exhausted.")?;
        cancelled.store(false, Ordering::Release);
        state.active = true;
        Ok(Lease { owner: self, generation: state.generation })
    }
    /// Capture while preparing the cancellation, never when executing it later.
    pub fn generation(&self) -> Result<u64, String> {
        let state = self.state.lock().map_err(|_| "Premiere execution state unavailable.")?;
        if !state.active { return Err("No active Premiere execution to cancel.".into()); }
        Ok(state.generation)
    }
    pub fn cancel(&self, generation: u64, cancelled: &AtomicBool) -> Result<bool, String> {
        let state = self.state.lock().map_err(|_| "Premiere execution state unavailable.")?;
        if !state.active || state.generation != generation { return Ok(false); }
        cancelled.store(true, Ordering::Release);
        Ok(true)
    }
}
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.owner.state.lock() {
            if state.generation == self.generation { state.active = false; }
        }
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn stale_and_late_cancel_cannot_touch_next_run() {
        let run = Execution::default(); let cancelled = AtomicBool::new(false);
        let first = run.begin(&cancelled).unwrap(); let old = run.generation().unwrap();
        assert!(run.begin(&cancelled).is_err());
        assert!(run.cancel(old, &cancelled).unwrap());
        assert!(cancelled.load(Ordering::Acquire));
        drop(first);
        assert!(!run.cancel(old, &cancelled).unwrap());
        let _second = run.begin(&cancelled).unwrap();
        assert!(!cancelled.load(Ordering::Acquire));
        assert!(!run.cancel(old, &cancelled).unwrap());
        assert!(!cancelled.load(Ordering::Acquire));
        assert!(run.cancel(run.generation().unwrap(), &cancelled).unwrap());
    }
}
