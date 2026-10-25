import {verifiedSimplePremiereOpening,strictlySimplePremiereOpening} from "./native-opening-completion.mjs";
import {currentObservedWindows} from "./native-window-observation-session.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE=/^(?:ControlType\.)?(?:Button|MenuItem|TabItem|Edit|ComboBox|TreeItem|ListItem)$/;
export function premiereUiReadback(goal,id,result,evidence,audited){
 const window=verifiedSimplePremiereOpening(goal,id,result,evidence,audited);
 return window?{tool:"ui_discover",arguments:{window:window.window.title}}:null;
}
export function auditedPremiereUiReady(goal,id,result,proposal,evidence,windowSession,audited){
 if(audited!==true||!strictlySimplePremiereOpening(goal)||!UUID.test(id)||
 result?.tool!=="ui_discover"||result.success!==true||
 (result.exit_code!=null&&result.exit_code!==0)||
 typeof result.stdout!=="string"||result.stdout.length>250000||
 proposal?.tool!=="ui_discover"||typeof proposal.arguments?.window!=="string")return null;
 const obs=evidence?.observations;
 if(!Array.isArray(obs)||obs.length<3||obs.at(-1)?.id!==id||
 obs.at(-1)?.tool!=="ui_discover"||evidence.lastTool!=="ui_discover"||
 !evidence.seenIds?.has(id))return null;
 const previous=obs.at(-2);
 const launch=obs.filter(x=>x.tool==="premiere_launch");
 if(previous?.tool!=="ui_windows"||!UUID.test(previous.id)||
 launch.length!==1||!UUID.test(launch[0].id)||
 obs.indexOf(launch[0])>=obs.length-2||
 !evidence.seenIds.has(previous.id)||!evidence.seenIds.has(launch[0].id)||
 windowSession?.sourceActionId!==previous.id)return null;
 const candidates=currentObservedWindows(windowSession).filter(w=>
 w.app==="premiere"&&w.title===proposal.arguments.window&&
 /\bpremiere\b/i.test(w.process));
 if(candidates.length!==1||typeof candidates[0].processStartTicks!=="string")return null;
 const win=candidates[0];
 let rows;try{rows=JSON.parse(result.stdout);}catch{return null;}
 if(!Array.isArray(rows)||rows.length<3||rows.length>150)return null;
 const identities=new Set(),names=new Set(),roles=new Set();
 for(const row of rows){
  if(!row||typeof row!=="object"||Array.isArray(row)||
   row.ObservedWindowHwnd!==win.hwnd||row.ObservedWindowPid!==win.pid||
   row.ObservedWindowProcessStartTicks!==win.processStartTicks||
   typeof row.Name!=="string"||row.Name.length>180||
   typeof row.ControlType!=="string"||row.ControlType.length>100||
   !Array.isArray(row.ControlRuntimeId)||row.ControlRuntimeId.length<1||
   row.ControlRuntimeId.length>64||!row.ControlRuntimeId.every(Number.isSafeInteger))return null;
  const identity=row.ControlRuntimeId.join(",");
  if(identities.has(identity))return null;
  identities.add(identity);
  if(row.IsEnabled===true&&row.IsOffscreen===false&&ACTIVE.test(row.ControlType)&&row.Name.trim()){
   names.add(row.Name.toLowerCase());roles.add(row.ControlType);
  }
 }
 // A spinner, splash-only surface and a dark/empty UI lack independent
 // interactive controls; neither is an acceptable completed application.
 if(names.size<3||roles.size<2)return null;
 return {scope:"premiere_ui_ready",window:{app:"premiere",title:win.title,pid:win.pid,hwnd:win.hwnd}};
}
