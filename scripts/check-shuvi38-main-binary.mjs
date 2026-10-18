// Fail-closed contract for Tauri 2's multi-bin main application selection.
// Tauri CLI 2.11.5 marks Cargo's package.default-run as the main bundle
// binary when src/main.rs and src/bin/* both exist. The SHA worker MUST
// stay a separate externalBin; do not package it as the desktop program.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const read=path=>readFileSync(resolve(path),"utf8");
const cargo=read("src-tauri/Cargo.toml");
const pos=cargo.indexOf("[package]");
if(pos<0)throw Error("Missing Rust package definition for Shuvi desktop.");
const next=cargo.indexOf("\n[",pos+9);
const packageBlock=cargo.slice(pos,next<0?undefined:next);
const attribute=key=>packageBlock.match(new RegExp("^"+key+"\\s*=\\s*\"([^\"]+)\"\\s*$","m"))?.[1];
if(attribute("name")!=="shuvi"||attribute("default-run")!=="shuvi"){
  throw Error("Tauri's main Cargo binary must be explicitly default-run=shuvi, never SHA sidecar.");
}
const sections=cargo.split(/(?=^\[[^\r\n]+\]\s*$)/m);
const binBlocks=sections.filter(s=>s.startsWith("[[bin]]"));
const featureBlock=sections.find(s=>s.startsWith("[features]"));
// Tauri CLI 2.11.5 explicitly excludes Cargo bins with unmet required-features;
// otherwise it adds every src/bin executable PLUS each externalBin to NSIS.
if(binBlocks.length!==1||!featureBlock
   ||!/^sha-worker-build\s*=\s*\[\s*\]\s*$/m.test(featureBlock)
   ||/^default\s*=/m.test(featureBlock)
   ||!/^name\s*=\s*"shuvi-readonly-hash-worker"\s*$/m.test(binBlocks[0])
   ||!/^path\s*=\s*"src\/bin\/shuvi-readonly-hash-worker.rs"\s*$/m.test(binBlocks[0])
   ||!/^required-features\s*=\s*\["sha-worker-build"\]\s*$/m.test(binBlocks[0])
   ||JSON.stringify([...binBlocks[0].matchAll(/^\s*([\w-]+)\s*=/gm)].map(m=>m[1]).sort())
      !==JSON.stringify(["name","path","required-features"].sort())){
  throw Error("SHA worker must be feature-gated out of Tauri Cargo binaries and packaged solely via externalBin.");
}
if(!/^\[lib\]\s*$/m.test(cargo)||!/^\s*name\s*=\s*"shuvi_lib"\s*$/m.test(cargo)){
  throw Error("Shuvi native library entrypoint changed.");
}
const main=read("src-tauri/src/main.rs");
if(!/\bfn\s+main\s*\(/.test(main)||!/\bshuvi_lib::run\s*\(\s*\)/.test(main)){
  throw Error("Main Shuvi executable no longer invokes the trusted desktop entrypoint.");
}
const sidecar=read("src-tauri/src/bin/shuvi-readonly-hash-worker.rs");
if(!sidecar.includes("--shuvi-readonly-sha256")){
  throw Error("Fixed-purpose SHA sidecar target absent or replaced.");
}
const config=JSON.parse(read("src-tauri/tauri.conf.json"));
const overlay=JSON.parse(read("src-tauri/tauri.sha-sidecar.conf.json"));
if(config.mainBinaryName!=null&&config.mainBinaryName!=="shuvi"){
  throw Error("Tauri mainBinaryName conflicts with Cargo's actual shuvi.exe.");
}
if(config.productName!=="Shuvi"||config.bundle?.active!==true
   ||!config.bundle?.targets?.includes("nsis")||config.bundle?.externalBin!=null){
  throw Error("Main Shuvi NSIS configuration must not replace or embed the worker by default.");
}
const bins=overlay.bundle?.externalBin;
if(!Array.isArray(bins)||bins.length!==1||bins[0]!=="binaries/shuvi-readonly-hash-worker"){
  throw Error("Installer overlay must contain only the fixed SHA externalBin.");
}
console.log("PASS: Cargo default-run selects Shuvi desktop; feature-gated SHA verifier is only an NSIS externalBin.");
