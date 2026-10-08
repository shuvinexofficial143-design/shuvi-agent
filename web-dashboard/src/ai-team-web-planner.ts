/**
 * Model delegation preferences are browser-side PLANS, not a running AI team.
 * No credential or remote execution connection exists in this Vercel surface.
 */
const TEAM_KEY = "shuvi.web.ai-team-model-assignments.v1";
type Role = { id: string; name: string; icon: string; job: string; speed: string };
type Assignment = { provider: string; model: string; fallback: string };
const ROLES: Role[] = [
  { id: "master", name: "Shuvi Master Router", icon: "✦", job: "Break down requests, delegate and review every worker's output.", speed: "Reasoning / orchestrator" },
  { id: "launcher", name: "App Launcher", icon: "↗", job: "Open applications and check availability with minimal cost.", speed: "Fast / inexpensive" },
  { id: "project", name: "Project Creator", icon: "▤", job: "Prepare Premiere, Blender and editing project structures.", speed: "Balanced" },
  { id: "coding", name: "Coding Engineer", icon: "</>", job: "Write code, run tests and fix build issues.", speed: "Strong coding" },
  { id: "video", name: "Video Editor", icon: "▶", job: "Plan captions, B-roll, transitions and finishing.", speed: "Creative / high quality" },
  { id: "image", name: "Image Generator", icon: "▧", job: "Prepare image assets, masks and thumbnails on demand.", speed: "Image-capable model" },
  { id: "video_gen", name: "Video Generator", icon: "▸", job: "Generate B-roll and background clips when a video service is connected.", speed: "Video-capable model" },
  { id: "blender", name: "Blender 3D Specialist", icon: "◇", job: "Scene modeling, materials, lighting and 3D animation.", speed: "Advanced 3D reasoning" }
];

function validModel(value: string): boolean {
  return value.length <= 160 && !/[\u0000-\u001f]/.test(value);
}
function readAssignments(): Record<string, Assignment> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TEAM_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, Assignment> = {};
    const obj = value as Record<string, unknown>;
    for (const role of ROLES) {
      const raw = obj[role.id];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const provider = typeof item.provider === "string" ? item.provider.slice(0, 80) : "";
      const model = typeof item.model === "string" ? item.model.slice(0, 160) : "";
      const fallback = typeof item.fallback === "string" ? item.fallback.slice(0, 160) : "";
      if (validModel(model) && validModel(fallback)) result[role.id] = {provider, model, fallback};
    }
    return result;
  } catch { return {}; }
}

function dom<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text) element.textContent = text;
  return element;
}
export function mountAITeamWebPlanner(): void {
  const agents = document.getElementById("view-agents");
  if (!agents) throw new Error("Shuvi Agents view not found");
  const section = dom("section", "shuvi-team-planner panel");
  section.id = "aiTeamPlanner";
  const head = dom("div", "shuvi-team-head");
  const intro = dom("div");
  intro.append(dom("span","section-kicker","PLANNING / FUTURE MULTI-MODEL ROUTER"),
    dom("h3","","AI Team · Model Assignments"),
    dom("p","","Choose separate model preferences for small and heavy tasks. These profiles are saved in this browser, not sent to Windows or external AI providers."));
  const state = dom("span","shuvi-team-state","8 roles · 0 active workers");
  head.append(intro,state);
  const banner = dom("div","shuvi-team-notice","Planning only · No API keys stored · No models invoked · No background execution while Shuvi.exe is offline.");
  const grid = dom("div","shuvi-team-grid");
  grid.setAttribute("aria-label","AI model role assignments");
  const notice = dom("p","shuvi-team-feedback","Edit a role and save the team plan. Each assignment remains editable.");
  notice.setAttribute("role","status");
  const controls = dom("div","shuvi-team-actions");
  const save = dom("button","primary-button","Save AI team plan");
  save.type = "button";
  const exportBtn = dom("button","secondary-button","Export configuration");
  exportBtn.type = "button";
  const reset = dom("button","secondary-button","Reset assignments");
  reset.type = "button";
  controls.append(save,exportBtn,reset);
  section.append(head,banner,grid,controls,notice);
  const firstSection = agents.querySelector(".agent-workspace");
  if (firstSection) agents.insertBefore(section, firstSection);
  else agents.append(section);

  let values = readAssignments();
  function draw(): void {
    grid.replaceChildren();
    for (const role of ROLES) {
      const value = values[role.id] || {provider:"",model:"",fallback:""};
      const card = dom("article","shuvi-team-role");
      card.dataset.roleId=role.id;
      const titleRow = dom("div","shuvi-team-role-head");
      const icon = dom("span","shuvi-team-role-icon",role.icon);
      const name = dom("div");
      name.append(dom("strong","",role.name), dom("small","",role.speed));
      titleRow.append(icon,name);
      const description=dom("p","",role.job);
      function field(title: string, prop: keyof Assignment, placeholder: string, max: number): HTMLElement {
        const label=dom("label","shuvi-team-field");
        label.append(dom("span","",title));
        const input=dom("input") as HTMLInputElement;
        input.type="text";input.maxLength=max;input.placeholder=placeholder;
        input.autocomplete="off";
        input.value=value[prop];
        input.dataset.field=prop;
        input.addEventListener("input",() => {
          values[role.id] = {...(values[role.id] || {provider:"",model:"",fallback:""}),[prop]:input.value.trim()};
          notice.textContent="Unsaved changes. Save the AI team plan to keep these browser preferences.";
        });
        label.append(input);
        return label;
      }
      const row=dom("div","shuvi-team-fields");
      row.append(
        field("Provider", "provider","xKiro / OpenRouter / Gemini",80),
        field("Primary model","model","Choose a model ID",160),
        field("Fallback model (optional)","fallback","Use on error or capacity",160)
      );
      card.append(titleRow,description,row);
      grid.append(card);
    }
  }

  save.addEventListener("click",()=>{
    if(Object.values(values).some(v=>![v.provider,v.model,v.fallback].every(validModel))) {
      notice.textContent="One or more model names contain invalid characters. Nothing saved.";
      return;
    }
    try {
      localStorage.setItem(TEAM_KEY,JSON.stringify(values));
      notice.textContent="AI team preferences saved in this browser. Native execution is not enabled.";
    } catch { notice.textContent="Browser storage is unavailable. Assignments were not saved."; }
  });
  reset.addEventListener("click",()=>{
    if (!window.confirm("Clear this browser's saved model assignments?")) return;
    values={};
    try {localStorage.removeItem(TEAM_KEY);} catch { /* Storage may be unavailable */ }
    draw();
    notice.textContent="Model preferences reset. No native action was affected.";
  });
  exportBtn.addEventListener("click",()=>{
    const safe = {format:"shuvi-team-plan-v1",activeWorkers:0,scope:"browser_preferences_only",roles:ROLES.map(role=>({role:role.id,...(values[role.id]||{provider:"",model:"",fallback:""})}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(safe,null,2)],{type:"application/json"}));
    const link=dom("a");link.href=url;link.download="shuvi-ai-team-plan.json";document.body.append(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice.textContent="Exported model-role preferences only. No credentials or computer access included.";
  });
  draw();
}
