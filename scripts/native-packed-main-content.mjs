// M63: prove the actual installed MAIN Shuvi executable matches the SHA
// of the one EXTRACTED from the real M60 NSIS. This is CONTENT provenance
// only, never app launch, verified publisher, or owner-device acceptance.
import {createHash} from "node:crypto";
import {lstatSync,readFileSync,openSync,readSync,closeSync} from "node:fs";
import {resolve,basename,dirname} from "node:path";
const TARGETS=new Set(["x86_64-pc-windows-msvc","aarch64-pc-windows-msvc","i686-pc-windows-msvc"]);
const HEX=/^[0-9a-f]{64}$/;
const FIELDS=["schemaVersion","target","installerSha256","packedMainExeSha256",
  "packedMainExeBytes","signingVerified","ownerWindowsVerified","applicationVerified"].sort();
const MAX_MAIN=512*1024*1024;
function safeFile(path,least,most,description){
  const m=lstatSync(path);
  if(!m.isFile()||m.isSymbolicLink()||m.nlink!==1||m.size<least||m.size>most){
    throw Error(description+" must be exact bounded single-link regular file.");
  }
  return m.size;
}
function sha256(path){
  const digest=createHash("sha256"),fd=openSync(path,"r");
  const buffer=Buffer.allocUnsafe(65536);
  try{
    while(true){
      const n=readSync(fd,buffer,0,buffer.length,null);
      if(n===0)break;
      digest.update(buffer.subarray(0,n));
    }
  }finally{closeSync(fd);}
  return digest.digest("hex");
}
export function verifyPackedMainContent({witnessPath,mainExecutablePath,installerSha256,target}){
  const file=resolve(witnessPath),main=resolve(mainExecutablePath);
  safeFile(file,32,8192,"M63 main witness");
  const witness=JSON.parse(readFileSync(file,"utf8"));
  if(!witness||Array.isArray(witness)||typeof witness!=="object"
    ||JSON.stringify(Object.keys(witness).sort())!==JSON.stringify(FIELDS)
    ||witness.schemaVersion!==1||!TARGETS.has(witness.target)
    ||witness.target!==target||!HEX.test(witness.installerSha256)
    ||witness.installerSha256!==installerSha256
    ||!HEX.test(witness.packedMainExeSha256)
    ||!Number.isSafeInteger(witness.packedMainExeBytes)
    ||witness.packedMainExeBytes<1024||witness.packedMainExeBytes>MAX_MAIN
    ||witness.signingVerified!==false||witness.ownerWindowsVerified!==false
    ||witness.applicationVerified!==false){
    throw Error("M63 packed-main content witness malformed or mismatched; acceptance denied.");
  }
  if(basename(main).toLowerCase()!=="shuvi.exe"){
    throw Error("Only installed fixed Shuvi.exe name can be verified.");
  }
  const d=lstatSync(dirname(main));
  if(!d.isDirectory()||d.isSymbolicLink())throw Error("Installed Shuvi directory redirected.");
  const actualBytes=safeFile(main,1024,MAX_MAIN,"Installed Shuvi main executable");
  if(actualBytes!==witness.packedMainExeBytes
    ||sha256(main)!==witness.packedMainExeSha256){
    throw Error("Installed Shuvi main EXE differs from real compressed NSIS contents.");
  }
  return witness;
}
