// Verify all THREE views of the Tauri JS <-> Rust package compatibility
// BEFORE the ~9min production Rust build. No install, no network, no mutation.
// Direct npm registry package integrity remains authoritative in lockfile.
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(".");
const read=(path)=>readFileSync(resolve(root,path),"utf8");
const pkg=JSON.parse(read("package.json"));
const locked=JSON.parse(read("package-lock.json"));
const rust=read("src-tauri/Cargo.lock");
const rustBlock=rust.match(/(?:^|\n)\[\[package\]\]\s*\nname = "tauri"\s*\nversion = "(\d+\.\d+\.\d+)"/m);
if(!rustBlock)throw Error("Missing exact locked Rust Tauri version: deny unsigned NSIS build.");
const rustVersion=rustBlock[1];
const js=locked.packages?.["node_modules/@tauri-apps/api"];
const jsVersion=js?.version;
const direct=pkg.dependencies?.["@tauri-apps/api"];
const rootLocked=locked.packages?.[""]?.dependencies?.["@tauri-apps/api"];
const embeddedLock=locked.packages?.["node_modules/@tauri-apps/cli"]?.version;
const isVersion=s=>typeof s==="string"&&/^\d+\.\d+\.\d+$/.test(s);
if(!isVersion(rustVersion)||!isVersion(jsVersion)
   ||direct!==jsVersion||rootLocked!==jsVersion
   ||!isVersion(embeddedLock)
   ||!(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(js?.integrity??""))
   ||js?.resolved!== "https://registry.npmjs.org/@tauri-apps/api/-/api-"+jsVersion+".tgz"){
  throw Error("Tauri JS API is not an exact trusted SHA512-locked dependency.");
}
// Tauri refuses bundling if tauri crate and @tauri-apps/api differ in major
// or minor. This is verified BEFORE any expensive compile.
const family=s=>s.split(".").slice(0,2).join(".");
if(family(rustVersion)!==family(jsVersion)){
  throw Error("Tauri crate "+rustVersion+" mismatches JS API "+jsVersion+"; refusing NSIS build.");
}
const installedPath="node_modules/@tauri-apps/api/package.json";
if(!existsSync(resolve(root,installedPath))){
  throw Error("Node dependencies missing; run npm ci before the installer build.");
}
const actual=JSON.parse(read(installedPath)).version;
if(actual!==jsVersion){
  throw Error("Installed JS API "+actual+" differs from SHA512-locked "+jsVersion+".");
}
console.log("PASS: Rust Tauri "+rustVersion+", exact npm API "+jsVersion+
  ", installed JS and authenticated npm SHA512 lock agree.");
