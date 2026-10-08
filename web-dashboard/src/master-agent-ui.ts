import {
  WORKERS,readDelegations,writeDelegations,createDelegation,delegationViews,
  type TaskDraftRef,type DelegationPlan,DELEGATION_STORAGE_KEY
} from "./agent-planner";

type MasterCallbacks={
  drafts():TaskDraftRef[];
  navigate(view:"tasks"|"settings"):void;
  notify(message:string):void;
  activity(message:string):void;
};
export type MasterAgentUI={refresh():void};
function id<T extends HTMLElement>(name:string):T{
  const el=document.getElementById(name);if(!el)throw Error("Missing Shuvi agents control #"+name);return el as T;
}
function el<K extends keyof HTMLElementTagNameMap>(tag:K,cls:string,text?:string):HTMLElementTagNameMap[K]{
  const v=document.createElement(tag);v.className=cls;if(text!==undefined)v.textContent=text;return v;
}
function formatDate(ts:number):string{return new Date(ts).toLocaleString();}
export function mountMasterAgentUI(callbacks:MasterCallbacks):MasterAgentUI {
  const picker=id<HTMLSelectElement>("agentTaskSelect");
  const workerPicker=id<HTMLSelectElement>("agentWorkerSelect");
  const form=id<HTMLFormElement>("agentPlanForm");
  const instructions=id<HTMLTextAreaElement>("agentInstructions");
  const submit=id<HTMLButtonElement>("agentPlanSubmit");
  const board=id<HTMLElement>("agentPlanList");
  const grid=id<HTMLElement>("agentWorkerGrid");
  let selectedWorker=WORKERS[0].id;
  let editingRecordId="";
  id<HTMLElement>("agentWorkerCount").textContent=String(WORKERS.length);

  function renderWorkers():void{
    grid.replaceChildren();
    for(const worker of WORKERS){
      const button=el("button","agent-worker");
      button.type="button";
      button.dataset.workerId=worker.id;
      const active=worker.id===selectedWorker;
      if(active)button.classList.add("selected");
      button.setAttribute("aria-pressed",String(active));
      const top=el("div","agent-worker-top");
      const icon=el("span","agent-worker-icon",worker.glyph);
      const title=el("div","agent-worker-text");
      title.append(el("strong","",worker.name),el("span","",worker.category));
      top.append(icon,title);
      button.append(
        top,
        el("p","",worker.description),
        el("span","agent-worker-lock","Lock: "+worker.resource),
        el("span","agent-worker-state","Not connected")
      );
      button.addEventListener("click",()=>{
        selectedWorker=worker.id;
        workerPicker.value=worker.id;
        renderWorkers();
      });
      grid.append(button);
    }
  }
  function renderDrafts():void{
    const selected=picker.value;
    picker.replaceChildren();
    const empty=el("option","","Select a saved task…");
    empty.value="";
    picker.append(empty);
    for(const draft of callbacks.drafts()){
      const opt=el("option","",draft.title.slice(0,120)+" · "+draft.type);
      opt.value=draft.id;
      picker.append(opt);
    }
    if(callbacks.drafts().some(d=>d.id===selected))picker.value=selected;
    const hasDrafts=callbacks.drafts().length>0;
    submit.disabled=!hasDrafts;
    const note=id<HTMLElement>("agentDraftWarning");
    note.textContent=hasDrafts
      ? "Select an existing task draft, choose a worker, then save an offline delegation plan."
      : "No task drafts available yet. Create a task on the Tasks page before planning delegation.";
  }
  function renderPlans():void{
    const plans=readDelegations();
    const rows=delegationViews(plans,callbacks.drafts());
    id<HTMLElement>("agentPlanCount").textContent=String(plans.length);
    id<HTMLElement>("agentPlanBadge").textContent=plans.length+" planned";
    board.replaceChildren();
    if(!rows.length){
      board.append(el("div","agent-empty","No delegations saved. Choose a task draft and a worker above."));
      return;
    }
    for(const {plan,draft,worker} of rows){
      const article=el("article","agent-plan-card");
      article.dataset.planId=plan.id;
      const heading=el("div","agent-plan-card-header");
      heading.append(el("span","agent-plan-worker",worker.glyph+" · "+worker.name),el("span","agent-plan-tag","PLANNED"));
      const name=el("strong","agent-plan-title",draft?.title??"Source task removed");
      const details=el("p","agent-plan-desc",plan.instructions||"No additional worker instructions");
      const foot=el("div","agent-plan-footer");
      foot.append(el("span","","Saved "+formatDate(plan.createdAt)));
      const remove=el("button","agent-plan-remove","Remove");
      remove.type="button";
      remove.setAttribute("aria-label","Remove plan for "+(draft?.title??worker.name));
      remove.addEventListener("click",()=>{
        // Plans are only local metadata. Removing a plan cannot cancel or approve native tasks.
        const next=readDelegations().filter(item=>item.id!==plan.id);
        if(!writeDelegations(next)){callbacks.notify("Browser storage unavailable. No delegation was removed.");return;}
        callbacks.activity("Removed delegation plan for "+worker.name);
        callbacks.notify("Delegation plan removed. No agent action was changed.");
        renderPlans();
      });
      foot.append(remove);
      article.append(heading,name,details);
      if(!draft)article.append(el("div","agent-plan-orphan","Original task draft was deleted; this plan cannot be dispatched."));
      article.append(foot);
      board.append(article);
    }
  }
  function refresh():void {
    renderDrafts();
    renderPlans();
  }
  for(const worker of WORKERS){
    const option=el("option","",worker.name+" · "+worker.app);
    option.value=worker.id;
    workerPicker.append(option);
  }
  workerPicker.value=selectedWorker;
  workerPicker.addEventListener("change",()=>{
    const chosen=WORKERS.find(w=>w.id===workerPicker.value);
    if(chosen){selectedWorker=chosen.id;renderWorkers();}
  });
  form.addEventListener("submit",event=>{
    event.preventDefault();
    const draft=callbacks.drafts().find(item=>item.id===picker.value);
    if(!draft){callbacks.notify("Choose an existing task draft first.");return;}
    const plan=createDelegation(draft,workerPicker.value,instructions.value);
    if(!plan){callbacks.notify("Select a valid specialist worker.");return;}
    const current=readDelegations();
    if(current.length>=30){callbacks.notify("Planning limit reached (30). Remove old plans first.");return;}
    if(!writeDelegations([plan,...current])){
      callbacks.notify("Browser storage unavailable. No delegation was saved.");
      return;
    }
    instructions.value="";
    callbacks.activity("Planned "+draft.title+" for "+WORKERS.find(w=>w.id===plan.workerId)!.name+" (browser only)");
    callbacks.notify("Worker delegation saved as a plan. No AI process was started.");
    renderPlans();
  });
  id<HTMLButtonElement>("agentsOpenRuntime").addEventListener("click",()=>callbacks.navigate("settings"));
  // Existing worker selection survives tab switching, but is not a runtime pairing.
  renderWorkers();
  refresh();
  return {refresh};
}
