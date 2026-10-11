// Batch 10: Parse only observed, audit-verified read-only Windows output.
// Window inventory is untrusted UI state, NOT permission to mutate anything.
const allowed=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
export function summarizeWindowObservation(result,audited=false){
 if(!audited||result?.success!==true||result.tool!=="ui_windows")return "";
 let data;
 try{data=JSON.parse(result.stdout);}catch{return "Window observation unavailable or unparseable; no target identity verified.";}
 const rows=Array.isArray(data)?data:(data&&typeof data==="object"?[data]:[]);
 if(!rows.length)return "Verified ui_windows returned no window identities. Do not invent an application title or click.";
 const found=[];const seen=new Set();
 for(const item of rows.slice(0,200)){
  if(!item||typeof item!=="object"||Array.isArray(item))continue;
  const title=allowed(item.Name,120),process=allowed(item.ProcessName,90);
  const pid=Number.isSafeInteger(item.ProcessId)&&item.ProcessId>=0?item.ProcessId:null;
  const hwnd=Number.isSafeInteger(item.NativeWindowHandle)&&item.NativeWindowHandle>0?item.NativeWindowHandle:null;
  if(!title&&!process)continue;
  const key=JSON.stringify([title,process,pid,hwnd]);
  if(seen.has(key))continue;
  seen.add(key);found.push({title,process,pid,hwnd});
 }
 if(!found.length)return "Verified ui_windows returned no usable window identity. Do not guess.";
 const sample=found.slice(0,6).map(x=>JSON.stringify(x)).join("; ");
 return "Verified read-only window inventory: "+found.length+" usable window identity/identities"+
  (rows.length>200?" (input bounded)":found.length>6?" (preview bounded)":"")+
  ". Observed sample: "+sample.slice(0,1250)+
  ". Window inventory is observation, NOT a selected target. "+
  "If multiple windows could match, request separate unique identity inspection or user clarification; "+
  "never pick the first matching window or invent a title. Every mutation needs separate Allow once.";
}
