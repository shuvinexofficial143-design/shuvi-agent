import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";

const count=(v,label)=>{
  if(!Number.isSafeInteger(v)||v<0)throw new Error(label+" is missing or invalid");
  return v;
};
export function auditNpm(report){
  if(!report||typeof report!=="object"||report.error)throw new Error("npm audit returned an error or invalid response");
  const m=report.metadata?.vulnerabilities;
  if(!m||typeof m!=="object")throw new Error("npm audit did not return vulnerability metadata");
  const high=count(m.high,"npm high");
  const critical=count(m.critical,"npm critical");
  return {kind:"npm",high,critical,moderate:count(m.moderate,"npm moderate"),low:count(m.low,"npm low"),passed:high===0&&critical===0};
}
export function auditCargo(report){
  if(!report||typeof report!=="object"||report.error)throw new Error("cargo audit returned an error or invalid response");
  const v=report.vulnerabilities;
  if(!v||typeof v!=="object"||!Array.isArray(v.list))throw new Error("cargo audit vulnerability list missing");
  const n=count(v.count,"cargo vulnerabilities");
  if(n!==v.list.length)throw new Error("cargo audit report count/list mismatch");
  return {kind:"cargo",vulnerabilities:n,advisories:v.list.map(x=>x?.advisory?.id||"unknown"),passed:n===0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [, ,kind,file]=process.argv;
  if(!["npm","cargo"].includes(kind)||!file)throw new Error("Usage: node audit-policy.mjs npm|cargo report.json");
  const report=JSON.parse(readFileSync(file,"utf8"));
  const result=kind==="npm"?auditNpm(report):auditCargo(report);
  console.log(JSON.stringify({file,...result}));
  if(!result.passed)process.exitCode=1;
}
