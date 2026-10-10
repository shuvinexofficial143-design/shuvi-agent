/** Owner-approved local A22 budget. It never submits an AI request or
 * bypasses native paid-call admission. Daily $5 is a reservation allowance,
 * NOT a verified provider billing/spend cap.
 */
import type {NativeInvoke,ModelTeamConfig} from "./native-model-setup";

type Snapshot={provider:string;current:ModelTeamConfig|null;selected:Record<string,string>};
type Status={daily_allowance_usd_micros:number;approved_models:string[];reservation_usd_micros:number|null};
export function mountNativeBudgetSetup(invoke:NativeInvoke,card:HTMLElement,snapshot:()=>Snapshot):void {
 const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text=""):HTMLElementTagNameMap[K]=>{
   const element=document.createElement(tag);if(text)element.textContent=text;return element;
 };
 const heading=make("h4","A22 · Daily AI testing allowance");
 const help=make("p","Your explicit daily allowance is $5 USD (UTC day). This is NOT an actual xKiro billing cap. Each paid request reserves your selected amount before calling AI; provider charges may differ. Set an actual account-side limit with xKiro too.");
 help.className="shuvi-native-help";
 const row=make("div");row.className="shuvi-native-model-actions";
 const amountLabel=make("label","Reserve per API request ($)");
 const amount=make("input");amount.id="shuvi-a22-per-request";amount.type="number";
 amount.min="0.01";amount.max="1";amount.step="0.01";amount.value="0.25";
 amountLabel.append(amount);
 const approve=make("button","Approve $5/day testing allowance");approve.type="button";approve.id="shuvi-a22-approve";
 row.append(amountLabel,approve);
 const ack=make("label");const check=make("input");check.type="checkbox";check.id="shuvi-a22-consent";
 ack.append(check,make("span"," I approve the saved xKiro model IDs and this per-call reservation. The $5 amount is local authorization, not a guaranteed bill limit."));
 const statusText=make("p","Checking A22 approval status…");statusText.setAttribute("role","status");statusText.id="shuvi-a22-status";
 card.append(heading,help,row,ack,statusText);
 let active=false;
 async function refresh():Promise<void>{
  try{
   const info=await invoke<Status|null>("testing_ai_budget_status");
   active=!!info;
   approve.disabled=active;
   statusText.textContent=info
     ?"A22 policy exists: $"+(info.daily_allowance_usd_micros/1_000_000).toFixed(2)+"/day, "+info.approved_models.length+" approved models. Existing policies are never overwritten automatically."
     :"No A22 spending authorization saved yet. Save the model assignments above, then approve explicitly here.";
  }catch{
   active=true;approve.disabled=true;
   statusText.textContent="A22 policy status is inaccessible; no spending permission can be granted.";
  }
 }
 approve.addEventListener("click",async()=>{
  if(active)return;
  if(!check.checked){
   statusText.textContent="Check the owner-approval box before authorizing paid requests.";return;
  }
  const state=snapshot();
  if(state.provider!=="xkiro"||!state.current||state.current.provider!=="xkiro"||!state.current.roles.chat){
   statusText.textContent="Save xKiro Normal Chat model assignments before approving AI budget.";return;
  }
  if(Object.keys(state.selected).some(id=>state.selected[id]!== (state.current?.roles[id]??""))){
   statusText.textContent="Model selections changed; save assignments before approving budget.";return;
  }
  const perCall=Number(amount.value);
  const micros=Math.round(perCall*1_000_000);
  if(!Number.isFinite(perCall)||perCall<0.01||perCall>1||!Number.isInteger(micros)){
   statusText.textContent="Choose an explicit per-call reservation between $0.01 and $1.00.";return;
  }
  const models=Array.from(new Set(Object.values(state.current.roles))).sort();
  if(!models.length||models.length>64){
   statusText.textContent="Choose 1–64 exact AI models before approving spending.";return;
  }
  approve.disabled=true;
  statusText.textContent="Saving new A22 authorization locally; no paid AI call is being made…";
  try{
   await invoke("authorize_testing_ai_budget",{models,reservationUsdMicros:micros});
   check.checked=false;
   await refresh();
   statusText.textContent+=" You may now test Chat.";
  }catch(error){
   await refresh();
   statusText.textContent="A22 authorization failed: "+String(error)+". Existing spending permissions were not changed.";
  }finally{
   if(!active)approve.disabled=false;
  }
 });
 void refresh();
}
