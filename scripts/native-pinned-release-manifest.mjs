// M59: independently verifiable Windows NSIS installer evidence.
// Neither hashing nor this unsigned witness constitutes Authenticode signing,
// owner Windows installation, real app execution or UI/application success.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,lstatSync,readdirSync,openSync,readSync,closeSync} from "node:fs";
import {resolve,join,dirname,basename} from "node:path";

const TARGETS=new Set(["x86_64-pc-windows-msvc","aarch64-pc-windows-msvc","i686-pc-windows-msvc"]);
const MIN_BYTES=1024;
const MAX_WORKER=32*1024*1024;
const MAX_INSTALLER=2*1024*1024*1024;
const EXACT_KEYS=["schemaVersion","target","installerFilename","installerBytes","installerSha256","workerFilename","workerBytes","workerSha256","signingVerified","installedWindowsVerified","applicationVerified"].sort();
const HEX=/^[0-9a-f]{64}$/;
function regular(path,min,max,context){
  const m=lstatSync(path);
  if(!m.isFile()||m.isSymbolicLink()||m.size<min||m.size>max||m.nlink!==1){
    throw Error(context+" must be a single-link regular bounded file.");
  }
  return m.size;
}
function digest(path){
  // Bounded streaming avoids allocating a whole 2 GiB NSIS setup into RAM.
  const hash=createHash("sha256"),fd=openSync(path,"r");
  const buf=Buffer.allocUnsafe(64*1024);
  try{
    for(;;){
      const count=readSync(fd,buf,0,buf.length,null);
      if(count===0)break;
      hash.update(buf.subarray(0,count));
    }
  }finally{closeSync(fd);}
  return hash.digest("hex");
}
function safeDir(path,context){
  const m=lstatSync(path);
  if(!m.isDirectory()||m.isSymbolicLink())throw Error(context+" directory redirected.");
}
function expectedWorker(target){
  if(!TARGETS.has(target))throw Error("Only supported Windows MSVC target is accepted.");
  return "shuvi-readonly-hash-worker-"+target+".exe";
}
function validateShape(m){
  if(!m||typeof m!=="object"||Array.isArray(m)||JSON.stringify(Object.keys(m).sort())!==JSON.stringify(EXACT_KEYS)
   ||m.schemaVersion!==1||!TARGETS.has(m.target)
   ||typeof m.installerFilename!=="string"||!/^Shuvi_[0-9A-Za-z._-]+-setup\.exe$/i.test(m.installerFilename)
   ||m.workerFilename!==expectedWorker(m.target)
   ||!Number.isSafeInteger(m.installerBytes)||m.installerBytes<MIN_BYTES||m.installerBytes>MAX_INSTALLER
   ||!Number.isSafeInteger(m.workerBytes)||m.workerBytes<MIN_BYTES||m.workerBytes>MAX_WORKER
   ||!HEX.test(m.installerSha256)||!HEX.test(m.workerSha256)
   ||m.signingVerified!==false||m.installedWindowsVerified!==false||m.applicationVerified!==false){
    throw Error("Release witness schema/target/hash/status invalid; no verified distribution claim.");
  }
  return m;
}
export function createUnsignedReleaseEvidence({target,sidecarPath,nsisDir,outPath}){
  const workerName=expectedWorker(target);
  const stage=resolve(sidecarPath),bundle=resolve(nsisDir),destination=resolve(outPath);
  if(basename(stage)!==workerName)throw Error("Only the exact compiled Tauri sidecar stage is accepted.");
  safeDir(dirname(stage),"SHA worker parent");
  safeDir(bundle,"NSIS bundle");
  const names=readdirSync(bundle).filter(x=>x.toLowerCase().endsWith(".exe"));
  if(names.length!==1||!/^Shuvi_[0-9A-Za-z._-]+-setup\.exe$/i.test(names[0])){
    throw Error("One and only one Shuvi NSIS installer is required.");
  }
  const nsisExe=join(bundle,names[0]);
  const workerBytes=regular(stage,MIN_BYTES,MAX_WORKER,"Staged worker");
  const installerBytes=regular(nsisExe,MIN_BYTES,MAX_INSTALLER,"NSIS installer");
  const data={
    schemaVersion:1,target,installerFilename:names[0],installerBytes,
    installerSha256:digest(nsisExe),workerFilename:workerName,
    workerBytes,workerSha256:digest(stage),
    signingVerified:false,installedWindowsVerified:false,applicationVerified:false,
  };
  validateShape(data);
  safeDir(dirname(destination),"Release evidence destination");
  // No auto-create of a release folder: owner must intentionally set one up.
  writeFileSync(destination,JSON.stringify(data,null,2)+"\n",{encoding:"utf8",flag:"wx"});
  return data;
}
export function verifyUnsignedReleaseEvidence({manifestPath,sidecarPath,nsisDir}){
  const mf=resolve(manifestPath);
  regular(mf,16,8192,"Release manifest");
  const manifest=validateShape(JSON.parse(readFileSync(mf,"utf8")));
  const worker=resolve(sidecarPath),bundle=resolve(nsisDir);
  if(basename(worker)!==manifest.workerFilename)throw Error("Release sidecar target path differs from witness.");
  safeDir(dirname(worker),"SHA worker parent");
  safeDir(bundle,"NSIS bundle");
  const installer=join(bundle,manifest.installerFilename);
  if(regular(worker,MIN_BYTES,MAX_WORKER,"Staged worker")!==manifest.workerBytes
      ||regular(installer,MIN_BYTES,MAX_INSTALLER,"NSIS installer")!==manifest.installerBytes
      ||digest(worker)!==manifest.workerSha256||digest(installer)!==manifest.installerSha256){
    throw Error("NSIS installer or SHA worker changed since release witness.");
  }
  return manifest;
}
export function verifyInstalledWorker({manifestPath,installDir}){
  const mf=resolve(manifestPath);
  regular(mf,16,8192,"Release manifest");
  const manifest=validateShape(JSON.parse(readFileSync(mf,"utf8")));
  const dir=resolve(installDir);safeDir(dir,"Shuvi installed app");
  // Installer output is meaningful only when the installed main desktop app
  // exists beside its fixed worker. Do NOT execute the main app here.
  regular(join(dir,"shuvi.exe"),MIN_BYTES,512*1024*1024,"Installed Shuvi main EXE");
  // Tauri renames a target-suffixed externalBin to the fixed executable name.
  // Never execute main Shuvi.exe or trust an executable chosen by a model.
  const installedWorker=join(dir,"shuvi-readonly-hash-worker.exe");
  if(regular(installedWorker,MIN_BYTES,MAX_WORKER,"Installed SHA worker")!==manifest.workerBytes
       ||digest(installedWorker)!==manifest.workerSha256){
    throw Error("Installed SHA worker does not match compiled installer-side pin.");
  }
  return {manifest,installedWorker};
}
