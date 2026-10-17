//! Installer-only content pinning for the fixed SHA sidecar.
//! A developer/test build without explicit pinning compiles normally, but
//! the runtime MUST refuse sidecar execution (option_env is absent).
use sha2::{Digest,Sha256};
use std::{env,fs::File,io::Read,path::PathBuf};

fn pin_sha_sidecar(){
    println!("cargo:rerun-if-env-changed=SHUVI_REQUIRE_PINNED_SHA_SIDECAR");
    println!("cargo:rerun-if-env-changed=TARGET");
    let target=env::var("TARGET").expect("Cargo target is required for sidecar build pin");
    let path=PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("Cargo manifest directory missing"))
        .join("binaries").join(format!("shuvi-readonly-hash-worker-{target}.exe"));
    println!("cargo:rerun-if-changed={}",path.display());
    if env::var("SHUVI_REQUIRE_PINNED_SHA_SIDECAR").ok().as_deref()!=Some("1"){
        // Normal cargo test/build deliberately produces an UNPINNED agent.
        return;
    }
    assert_eq!(env::var("CARGO_CFG_TARGET_OS").as_deref(),Ok("windows"),
        "Pinned SHA sidecar builds require Windows target");
    assert!(matches!(target.as_str(),
        "x86_64-pc-windows-msvc"|"aarch64-pc-windows-msvc"|"i686-pc-windows-msvc"),
        "Pinned installer requires an allowlisted MSVC Windows target");
    let mut file=File::open(&path).expect("Pinned installer SHA sidecar absent; run prepare:sha-sidecar");
    let size=file.metadata().expect("Pinned sidecar metadata missing").len();
    assert!((1024..=32*1024*1024).contains(&size),
        "Pinned SHA worker missing, suspiciously small or >32 MiB");
    let mut digest=Sha256::new();let mut buf=[0u8;65536];let mut read=0u64;
    loop{
        let n=file.read(&mut buf).expect("Cannot hash packaged SHA sidecar");
        if n==0{break;}
        read+=n as u64;
        assert!(read<=32*1024*1024,"Packaged SHA sidecar grew during hashing");
        digest.update(&buf[..n]);
    }
    assert_eq!(read,size,"Packaged SHA sidecar changed while pinning");
    println!("cargo:rustc-env=SHUVI_PINNED_SHA_SIDECAR={:x}",digest.finalize());
}
fn main(){
    pin_sha_sidecar();
    tauri_build::build();
}
