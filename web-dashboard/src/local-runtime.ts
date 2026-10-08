/**
 * Level 13: explicit opt-in read-only pairing to the actual native Tauri Shuvi.
 * Pairing tokens remain in memory and never enter localStorage, cookies or URLs.
 */
export const NATIVE_ENDPOINT = "http://127.0.0.1:47771" as const;
export const NATIVE_STATUS_ROUTE = "/v1/status" as const;
export type PairedRuntime = {
  protocol:1;
  runtime:"shuvi-tauri";
  state:"connected";
  version:string;
  pid:number;
  heartbeat_ms:number;
  scope:"status_read_only";
  permission_mode:"native_approval_only";
  tasks:"not_exposed";
  approvals:"not_exposed";
};
export type BridgeSnapshot =
  | {phase:"offline"|"checking"|"error";detail:string;runtime:null}
  | {phase:"paired";detail:string;runtime:PairedRuntime};

export function validPairCode(value:string):boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function validateNativeRuntime(value:unknown):PairedRuntime|null {
  if(!value||typeof value!=="object")return null;
  const r=value as Record<string,unknown>;
  if(r.protocol!==1||r.runtime!=="shuvi-tauri"||r.state!=="connected"||
    r.scope!=="status_read_only"||r.permission_mode!=="native_approval_only"||
    r.tasks!=="not_exposed"||r.approvals!=="not_exposed"||
    typeof r.version!=="string"||r.version.length<1||r.version.length>60||
    typeof r.pid!=="number"||!Number.isInteger(r.pid)||r.pid<=0||
    typeof r.heartbeat_ms!=="number"||!Number.isFinite(r.heartbeat_ms)||
    r.heartbeat_ms<=0)return null;
  return r as PairedRuntime;
}

/** Web pairing is refused on every Vercel/deployed/other-origin dashboard. */
export function localDashboardOrigin(origin:string):boolean {
  return origin==="http://127.0.0.1:1423";
}

export class ShuviReadOnlyBridge {
  private token:string|null=null;
  private timer:number|null=null;
  private generation=0;
  private snapshot:BridgeSnapshot={phase:"offline",detail:"Not paired. Native bridge is not yet connected.",runtime:null};
  constructor(private onChange:(snapshot:BridgeSnapshot)=>void) {}
  state():BridgeSnapshot{return this.snapshot;}
  private update(snapshot:BridgeSnapshot):void {
    this.snapshot=snapshot;
    this.onChange(snapshot);
  }
  private async query(secret:string):Promise<PairedRuntime> {
    const response=await fetch(NATIVE_ENDPOINT+NATIVE_STATUS_ROUTE,{
      method:"GET",
      mode:"cors",
      cache:"no-store",
      credentials:"omit",
      referrerPolicy:"no-referrer",
      redirect:"error",
      headers:{"Authorization":"Bearer "+secret},
      signal:AbortSignal.timeout(3500)
    });
    if(!response.ok)throw new Error(response.status===401?"Pairing code rejected or revoked.":"Native listener unavailable ("+response.status+").");
    const decoded:unknown=await response.json();
    const parsed=validateNativeRuntime(decoded);
    if(!parsed)throw new Error("Unexpected or untrusted Shuvi bridge response.");
    return parsed;
  }
  private clearTimer():void {
    if(this.timer!==null){window.clearInterval(this.timer);this.timer=null;}
  }
  async pair(code:string):Promise<BridgeSnapshot> {
    this.disconnect();
    if(!localDashboardOrigin(window.location.origin)){
      this.update({phase:"error",detail:"Pairing is allowed only at http://127.0.0.1:1423. Remote Vercel/other origins are blocked.",runtime:null});
      return this.snapshot;
    }
    const secret=code.trim();
    if(!validPairCode(secret)){
      this.update({phase:"error",detail:"Enter the 64-character read-only code from native Shuvi.",runtime:null});
      return this.snapshot;
    }
    const gen=++this.generation;
    this.update({phase:"checking",detail:"Checking paired Shuvi.exe on local Windows…",runtime:null});
    try{
      const runtime=await this.query(secret);
      if(gen!==this.generation)return this.snapshot;
      this.token=secret;
      this.update({phase:"paired",detail:"Native Shuvi process verified. Read-only status; tools and approvals are not connected.",runtime});
      this.timer=window.setInterval(()=>{void this.refresh();},10000);
    }catch(error){
      if(gen!==this.generation)return this.snapshot;
      this.token=null;
      const detail=error instanceof Error?error.message:"Native Shuvi connection failed.";
      this.update({phase:"error",detail,runtime:null});
    }
    return this.snapshot;
  }
  async refresh():Promise<BridgeSnapshot> {
    const secret=this.token;
    if(!secret)return this.snapshot;
    const gen=this.generation;
    try{
      const runtime=await this.query(secret);
      if(gen!==this.generation)return this.snapshot;
      this.update({phase:"paired",detail:"Native Shuvi process verified. Read-only status; tools and approvals are not connected.",runtime});
    }catch {
      if(gen!==this.generation)return this.snapshot;
      this.clearTimer();
      this.token=null;
      this.update({phase:"offline",detail:"Shuvi.exe heartbeat lost or pairing revoked. Native status is now unavailable.",runtime:null});
    }
    return this.snapshot;
  }
  disconnect():void {
    this.generation++;
    this.clearTimer();
    this.token=null;
    this.update({phase:"offline",detail:"Browser disconnected. The native pairing code is no longer held in this tab.",runtime:null});
  }
}
