//! Action-scoped sensitive image lifecycle. This module owns only screenshot
//! paths freshly returned by Shuvi's own capture helpers, never user files.
//! Files are discarded on success, error, unwind or async cancellation.
//! Windows doesn't guarantee secure deletion from storage: this minimizes
//! retention, not forensic recoverability.
use std::{fs, path::{Path, PathBuf}};

#[derive(Debug)]
pub(super) struct EphemeralVisionCapture {
    path: PathBuf,
    deleted: bool,
}
impl EphemeralVisionCapture {
    pub(super) fn new(path: PathBuf) -> Self { Self { path, deleted: false } }
    pub(super) fn path(&self) -> &Path { &self.path }

    // Unlike Drop's best-effort cleanup, a successful analysis must prove
    // that its sensitive PNG was actually removed before reporting success.
    pub(super) fn discard(&mut self) -> Result<(), String> {
        match fs::remove_file(&self.path) {
            Ok(()) => { self.deleted = true; Ok(()) },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                self.deleted = true; Ok(())
            },
            Err(err) => Err(format!(
                "Vision analysis completed but temporary screenshot cleanup failed: {err}. Inspect Shuvi's private screenshot folder."
            )),
        }
    }
}
impl Drop for EphemeralVisionCapture {
    fn drop(&mut self) {
        if !self.deleted {
            let _ = fs::remove_file(&self.path);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread, time::{SystemTime, UNIX_EPOCH}};
    fn capture_fixture_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "shuvi39-ephemeral-{}-{}.png",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ))
    }
    #[test]
    fn disposable_screenshot_is_unlinked_after_success() {
        let path = capture_fixture_path();
        fs::write(&path,b"PNG fake test bytes").unwrap();
        {
            let owned = EphemeralVisionCapture::new(path.clone());
            assert_eq!(owned.path(),path.as_path());
            assert!(path.exists());
            owned.discard().unwrap();
            assert!(!path.exists());
        }
        assert!(!path.exists());
    }
    #[test]
    fn discarding_deleted_capture_is_idempotent() {
        let path=capture_fixture_path();
        let mut capture=EphemeralVisionCapture::new(path.clone());
        capture.discard().unwrap();
        capture.discard().unwrap();
        assert!(!path.exists());
    }
    #[test]
    fn disposable_screenshot_is_unlinked_on_error() {
        let path = capture_fixture_path();
        fs::write(&path,b"test fixture").unwrap();
        let outcome: Result<(),String>=(||{
            let _capture=EphemeralVisionCapture::new(path.clone());
            Err("Vision provider declined request".into())
        })();
        assert!(outcome.is_err());
        assert!(!path.exists());
    }
    #[test]
    fn disposable_screenshot_is_unlinked_on_task_unwind() {
        let path=capture_fixture_path();
        fs::write(&path,b"test fixture").unwrap();
        let _=std::panic::catch_unwind(||{
            let _capture=EphemeralVisionCapture::new(path.clone());
            panic!("synthetic provider panic");
        });
        assert!(!path.exists());
    }
    #[test]
    fn missing_capture_unlink_is_idempotent() {
        let path=capture_fixture_path();
        let c=EphemeralVisionCapture::new(path.clone());
        drop(c);
        assert!(!path.exists());
    }
}
