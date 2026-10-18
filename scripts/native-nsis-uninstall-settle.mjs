// NSIS may return 0 from its launcher before a detached uninstaller has
// finished deleting installed files. Only OBSERVE real filesystem removal;
// never delete, force-kill, or assume successful cleanup from exit code.
import {lstatSync} from "node:fs";
import {isAbsolute,join} from "node:path";
import {performance} from "node:perf_hooks";

const INSTALLED_EXECUTABLES=["shuvi.exe","shuvi-readonly-hash-worker.exe"];
export async function awaitRealNsisUninstallRemoval({installDir,timeoutMs=30000,pollMs=250}){
  if(typeof installDir!=="string"||!isAbsolute(installDir)
     ||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000
     ||!Number.isSafeInteger(pollMs)||pollMs<10||pollMs>1000){
    throw Error("Uninstaller observation requires a fixed absolute directory and bounded timing.");
  }
  const deadline=performance.now()+timeoutMs;
  let cleanObservations=0;
  for(;;){
    // lstat detects even dangling reparse/symlink entries. Missing one file
    // does not count: BOTH desktop and worker must be absent, repeatedly.
    const stillPresent=INSTALLED_EXECUTABLES.some(name=>
      lstatSync(join(installDir,name),{throwIfNoEntry:false})!==undefined);
    cleanObservations=stillPresent?0:cleanObservations+1;
    if(cleanObservations>=3)return;
    const remaining=deadline-performance.now();
    if(remaining<=0){
      throw Error("Real NSIS uninstaller did not remove BOTH Shuvi executables before bounded deadline.");
    }
    await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(1,remaining))));
  }
}
