// M62 REAL NSIS silent install acceptance on GitHub's disposable Windows CI
// runner ONLY. This script must NEVER run on the owner's Windows computer.
// It does not execute Shuvi.exe, Blender, Premiere, an AI task, or publish
// software. Unsigned CI installation is NOT trusted production distribution.
import {spawnSync} from "node:child_process";
import {readFileSync,readdirSync,existsSync,mkdtempSync,rmSync,lstatSync,writeFileSync} from "node:fs";
import {resolve,join,basename,dirname} from "node:path";
import {createHash} from "node:crypto";
import {verifyUnsignedReleaseEvidence,verifyInstalledWorker} from "./native-pinned-release-manifest.mjs";
import {verifyPackedMainContent} from "./native-packed-main-content.mjs";

if(process.platform!=="win32"||process.env.CI!=="true"
   ||process.env.GITHUB_ACTIONS!=="true"||!process.env.RUNNER_TEMP){
  throw Error("Real unsigned NSIS installation is authorized ONLY on disposable GitHub Windows CI.");
}
if(process.argv.length!==2){
  throw Error("M62 accepts no caller-supplied executable, PID, installer, install directory or arguments.");
}
const runnerTemp=resolve(process.env.RUNNER_TEMP);
const tempStat=lstatSync(runnerTemp);
if(!tempStat.isDirectory()||tempStat.isSymbolicLink()||runnerTemp.includes(" ")){
  throw Error("Disposable GitHub RUNNER_TEMP is unavailable, redirected, or unsuitable for NSIS /D.");
}
const names=readdirSync(resolve(".shuvi-release")).filter(x=>
  /^shuvi-pinned-nsis-(?:x86_64|aarch64|i686)-pc-windows-msvc\.json$/.test(x));
if(names.length!==1)throw Error("Exactly one pinned NSIS unsigned release witness is required.");
const manifestPath=resolve(".shuvi-release",names[0]);
const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
const target=manifest.target;
if(!["x86_64-pc-windows-msvc","aarch64-pc-windows-msvc","i686-pc-windows-msvc"].includes(target)){
  throw Error("Unapproved Windows target for disposable NSIS install.");
}
const nsis=resolve("src-tauri","target",target,"release","bundle","nsis");
const stage=resolve("src-tauri","binaries","shuvi-readonly-hash-worker-"+target+".exe");
const verified=verifyUnsignedReleaseEvidence({manifestPath,sidecarPath:stage,nsisDir:nsis});
const installer=join(nsis,verified.installerFilename);
const dirInfo=lstatSync(dirname(installer));
if(!dirInfo.isDirectory()||dirInfo.isSymbolicLink()){
  throw Error("NSIS installer source path redirected.");
}
const root=mkdtempSync(join(runnerTemp,"shuvi-m62-"));
const installDir=join(root,"installed");
const sha=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
let installed=false,smokeVerified=false,uninstalled=false;
const invocation=(exe,args,timeout)=>spawnSync(exe,args,{
  cwd:root,timeout,windowsHide:true,shell:false,encoding:"utf8",
  env:{...process.env,SHUVI_M62_EPHEMERAL_CI:"1"}
});
try{
  // NSIS /S (silent) and /D=destination (must be last and unquoted).
  // No UAC interaction; a user-scope installer is required on CI.
  const output=invocation(installer,["/S","/D="+installDir],180000);
  if(output.error||output.status!==0){
    throw Error("Real NSIS silent installation failed on ephemeral Windows CI.");
  }
  installed=true;
  const mainWitnessPath=resolve(".shuvi-release","m63-packed-main-"+target+".json");
  const verifiedPackedMain=verifyPackedMainContent({
    witnessPath:mainWitnessPath,
    mainExecutablePath:join(installDir,"shuvi.exe"),
    installerSha256:verified.installerSha256,
    target,
  });
  const installedView=verifyInstalledWorker({manifestPath,installDir});
  if(installedView.manifest.workerSha256!==verified.workerSha256
     ||sha(installedView.installedWorker)!==verified.workerSha256){
    throw Error("Actual NSIS-installed SHA worker bytes differ from source pin.");
  }
  const smoke=invocation(process.execPath,[
    resolve("scripts","check-installed-shuvi-worker.mjs"),
    "--manifest",manifestPath,"--install-dir",installDir
  ],75000);
  if(smoke.error||smoke.status!==0){
    throw Error("Actual NSIS-installed SHA worker protocol failed: "+(smoke.stderr||""));
  }
  const proof=JSON.parse(smoke.stdout);
  if(proof.schemaVersion!==1||proof.exactReadOnlyShaProtocolVerified!==true
     ||proof.installedWorkerSha256!==verified.workerSha256
     ||proof.shaMismatchRejected!==true||proof.uuidEvidenceReplayRejected!==true
     ||proof.unknownCommandRejected!==true||proof.codeSigningVerified!==false
     ||proof.mainApplicationVerified!==false
     ||proof.ownerDesktopEndToEndVerified!==false||proof.autoRetryAuthorized!==false){
    throw Error("Actual NSIS installed worker reported invalid or inflated acceptance.");
  }
  smokeVerified=true;
  // This real disposable NSIS install must also include a proper uninstaller.
  const uninstallers=readdirSync(installDir).filter(x=>/^uninstall.*\.exe$/i.test(x));
  if(uninstallers.length!==1){
    throw Error("Real NSIS installed layout has no unique uninstaller.");
  }
  const uninstaller=join(installDir,uninstallers[0]);
  const stat=lstatSync(uninstaller);
  if(!stat.isFile()||stat.isSymbolicLink()){
    throw Error("NSIS uninstaller identity redirected.");
  }
  const removal=invocation(uninstaller,["/S"],90000);
  if(removal.error||removal.status!==0){
    throw Error("Real ephemeral NSIS uninstall did not complete successfully.");
  }
  // A zero process exit code alone is NOT proof the NSIS uninstaller
  // removed the installed desktop and SHA worker binaries.
  if(existsSync(join(installDir,"shuvi.exe"))
     ||existsSync(join(installDir,"shuvi-readonly-hash-worker.exe"))){
    throw Error("NSIS uninstall returned zero but kept installed Shuvi or SHA worker.");
  }
  uninstalled=true;
  const report={
    schemaVersion:1,
    scope:"disposable-github-windows-ci-only",
    target,
    installerSha256:verified.installerSha256,
    installedWorkerSha256:verified.workerSha256,
    verifiedPackedMainExeSha256:verifiedPackedMain.packedMainExeSha256,
    actualPackedVsInstalledMainExeVerified:true,
    actualNsisSilentInstallVerified:installed,
    installedFixedWorkerContentsVerified:smokeVerified,
    wrongDigestUuidReplayAndUnknownCommandDenied:true,
    nsisUninstallerSucceeded:uninstalled,
    authenticPublisherSignatureVerified:false,
    actualOwnerWindowsInstallationVerified:false,
    mainDesktopAppLaunchedAndVerified:false,
    blenderOrAdobeApplicationVerified:false,
    autoRetryAuthorized:false,
  };
  // Only verified after installation, exact bytes, real protocol and cleanup.
  writeFileSync(resolve(".shuvi-release","m62-ephemeral-ci-install-witness.json"),
    JSON.stringify(report,null,2)+"\n",{encoding:"utf8",flag:"wx"});
  process.stdout.write(JSON.stringify(report)+"\n");
}finally{
  // Disposable runner is single-use; never treat deletion of temp files as
  // a verified NSIS uninstallation if the real uninstaller failed.
  if(root.startsWith(runnerTemp+"\\")||root.startsWith(runnerTemp+"/")){
    rmSync(root,{recursive:true,force:true,maxRetries:2,retryDelay:100});
  }
}
