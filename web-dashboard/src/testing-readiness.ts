type Feature={
  id:string;name:string;status:"source_ready"|"configured_unverified"|"blocked"|"not_implemented"|"live_test_pending";
  next:string
};
type Readiness={
  mode:string;readyForDirectRemoteExecution:boolean;
  cloudAIConfigurationReady:boolean;cloudAIReplyVerified:boolean;
  computerConnected:boolean;missingCloudSettings:string[];features:Feature[];
  noProviderRequestsMade:boolean
};
function el<K extends keyof HTMLElementTagNameMap>(tag:K,className="",text=""):HTMLElementTagNameMap[K] {
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text)element.textContent=text;
  return element;
}
/**
 * A production-safe, read-only diagnostics panel.
 * It cannot run a model, mutate Vercel secrets or dispatch Windows actions.
 */
export function mountReadinessPanel():void {
  const dashboard=document.getElementById("view-dashboard");
  const anchor=dashboard?.querySelector(".dashboard-run-summary");
  if(!dashboard||!anchor)return;
  const panel=el("section","shuvi-readiness panel");
  panel.id="shuviTestingReadiness";
  panel.setAttribute("aria-label","Shuvi testing preflight");
  const top=el("div","shuvi-readiness-header");
  const title=el("div");
  title.append(el("span","section-kicker","REALITY CHECK / ZERO AI COST"),
    el("h3","","Testing readiness"),
    el("p","","Check what is genuinely connected before starting a paid AI or Windows test."));
  const button=el("button","secondary-button","Run preflight");
  button.type="button";
  top.append(title,button);
  const summary=el("p","shuvi-readiness-summary","Checking readiness…");
  summary.setAttribute("role","status");
  const rows=el("div","shuvi-readiness-grid");
  const blockers=el("p","shuvi-readiness-blockers","");
  panel.append(top,summary,rows,blockers);
  anchor.insertAdjacentElement("afterend",panel);

  async function refresh():Promise<void>{
    button.disabled=true;
    summary.textContent="Checking configuration without calling any AI model…";
    try{
      const response=await fetch("/api/readiness",{method:"GET",credentials:"omit",cache:"no-store",
        signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error("Cloud readiness endpoint unavailable");
      const data=await response.json() as Readiness;
      if(data.mode!=="read_only_preflight"||!Array.isArray(data.features)||
        data.noProviderRequestsMade!==true)throw new Error("Invalid readiness response");
      rows.replaceChildren();
      for(const feature of data.features){
        const item=el("article","shuvi-readiness-row");
        const heading=el("div","shuvi-readiness-row-heading");
        const state=el("span","shuvi-readiness-state");
        state.dataset.status=feature.status;
        const labels:Record<Feature["status"],string>={
          source_ready:"Source ready",configured_unverified:"Configured — unverified",
          blocked:"Blocked",not_implemented:"Not implemented",live_test_pending:"Live test pending"
        };
        state.textContent=labels[feature.status]??"Unknown";
        heading.append(el("strong","",feature.name),state);
        item.append(heading,el("p","",feature.next));
        rows.append(item);
      }
      summary.textContent=data.readyForDirectRemoteExecution
        ? "Remote actions can be tested only after the live native permission gate is verified."
        : "NOT READY for direct Windows execution. Browser previews are not running workers.";
      blockers.textContent=data.missingCloudSettings.length
        ? "Online Chat configuration pending: "+data.missingCloudSettings.join(" · ")+
          ". Names only; never put credential values in the browser."
        : data.cloudAIReplyVerified
          ? "Cloud chat reply verified by live provider test."
          : "Online Chat configuration is present, but a real AI response has NOT been verified.";
    }catch(error) {
      rows.replaceChildren();
      summary.textContent="Preflight unavailable — do not start a paid/runtime acceptance test.";
      blockers.textContent=error instanceof Error?error.message:"Readiness check failed.";
    }finally{button.disabled=false;}
  }
  button.addEventListener("click",()=>void refresh());
  void refresh();
}
