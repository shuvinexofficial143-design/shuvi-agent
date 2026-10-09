//! Central fail-closed native execution lease (A09, phase-1 baseline).
//! Until resource-scoped leases and a queued dispatcher are verified, allow
//! only one native action through the approved execution entry point at a time.
use std::sync::atomic::{AtomicBool,Ordering};

pub(crate) struct NativeExecutionLease<'a>(&'a AtomicBool);
impl Drop for NativeExecutionLease<'_> {
    fn drop(&mut self) {
        self.0.store(false,Ordering::Release);
    }
}

pub(crate) fn claim_single_execution<'a>(active: &'a AtomicBool)
    -> Result<NativeExecutionLease<'a>,String> {
    active.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire)
        .map_err(|_|"Another Shuvi native action owns the execution slot. Wait for it to finish or stop safely; do not run competing desktop actions.".to_string())?;
    Ok(NativeExecutionLease(active))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_one_execution_can_own_desktop_at_a_time() {
        let active=AtomicBool::new(false);
        let first=claim_single_execution(&active).expect("first action");
        assert!(claim_single_execution(&active).is_err());
        drop(first);
        let second=claim_single_execution(&active).expect("lease released after complete");
        assert!(active.load(Ordering::Acquire));
        drop(second);
        assert!(!active.load(Ordering::Acquire));
    }
    #[test]
    fn guard_releases_slot_after_unwinding() {
        let active=AtomicBool::new(false);
        let outcome=std::panic::catch_unwind(||{
            let _lease=claim_single_execution(&active).unwrap();
            panic!("simulate native action panic");
        });
        assert!(outcome.is_err());
        assert!(claim_single_execution(&active).is_ok());
    }
    #[test]
    fn two_real_threads_cannot_both_edit_desktop_at_once(){
        use std::sync::{Arc,Barrier};
        let lock=Arc::new(AtomicBool::new(false));
        let started=Arc::new(Barrier::new(2));
        let release=Arc::new(Barrier::new(2));
        let held=Arc::clone(&lock);
        let ready=Arc::clone(&started);
        let finish=Arc::clone(&release);
        let worker=std::thread::spawn(move||{
            let _lease=claim_single_execution(&held).expect("worker owns desktop");
            ready.wait();
            finish.wait();
        });
        started.wait();
        assert!(claim_single_execution(&lock).is_err(),"second action must fail closed");
        release.wait();
        worker.join().unwrap();
        assert!(claim_single_execution(&lock).is_ok(),"lease released after worker");
    }
}