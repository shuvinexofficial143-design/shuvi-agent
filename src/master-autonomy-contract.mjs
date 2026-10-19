// Shuvi 37: deterministic task-scoped Master preflight for the packaged native
// dashboard. This is NOT a native permission, graph executor, or proof of work.
// Every admitted proposal still goes through Rust prepare -> Allow once ->
// execute -> exact audit. The separate full DAG UI owns its own graph parser.
const EDITORS = Object.freeze({
  premiere: /\b(?:premiere|premire|premier|premar|primiere)\b|प्रीमियर|प्रिमियर/iu,
  after_effects: /\bafter[ -]?effects?\b|आफ्टर[ -]?इफेक्ट्स?|आफ्टर\s*इफेक्ट/iu,
  blender: /\bblender\b|ब्लेंडर/iu,
  notepad: /\bnotepad\b|नोटपैड/iu
});
const PROJECT = /\b(?:project|projeckt|projct|projectfile)\b|प्रोजेक्ट/iu;
const CREATE = /\b(?:create|make|new|banao|banana|banado|bnado|naya|nayi)\b|नया|नई|बनाओ|बनाना|बना\s*दो/iu;
const EXPORT = /\b(?:export|render|final\s*video)\b|एक्सपोर्ट|रेंडर|फाइनल\s*वीडियो/iu;
const EDIT = /\b(?:edit|editing|trim|captions?|transitions?|colour|color|timeline|b-?roll|vfx)\b|एडिट|कैप्शन|टाइमलाइन|ट्रांज़िशन|कटिंग/iu;
const OPEN = /\b(?:open|launch|start|kholo|kholna|kholdo|khol\s*do)\b|खोलो|खोलना|खोल\s*दो|ओपन/iu;
const OBJ = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const TOOLS = Object.freeze({
  premiere: /^premiere_/,
  after_effects: /^after_effects_/,
  blender: /^blender_/
});
const fail = reason => ({ok:false,reason});
const OPENING_ONLY_TOOLS=new Set(['ui_windows','ui_discover','ui_find',
 'inspect_screen','capture_screen','list_processes','premiere_launch',
 'premiere_detect','premiere_context','premiere_bridge_status','blender_inspect']);

// The brief is preserved exactly. We never generate a project name, save path,
// credential, tool UUID or app identity from a language-model guess.
export function deriveMasterGoalContract(original) {
  if (typeof original !== 'string' || !original.trim() || original.length > 2500) return null;
  const apps = Object.keys(EDITORS).filter(name => EDITORS[name].test(original));
  const project = PROJECT.test(original) && CREATE.test(original);
  const exportFile = EXPORT.test(original);
  const editing = EDIT.test(original);
  const opening = OPEN.test(original);
  const required = [
    ...(apps.length && (opening || project || editing || exportFile) ? ['window'] : []),
    ...(project ? ['new_project_identity','saved_project_location'] : []),
    ...(editing ? ['observed_edit_effect'] : []),
    ...(exportFile ? ['persisted_export_artifact'] : [])
  ];
  return Object.freeze({original,apps:Object.freeze(apps),required:Object.freeze(required),
    project,exportFile,editing,opening});
}

// A deterministic, non-executable inspection DAG for one recognized opening
// request. Every node is a real native tool and a separate approval; the plan
// does not silently execute or claim the application's UI was found.
export function initialMasterInspectionDAG(goal) {
  const g = typeof goal === 'string' ? deriveMasterGoalContract(goal) : goal;
  if (!g || g.apps.length !== 1 || g.apps[0] !== 'premiere' || !g.opening ||
      g.project || g.exportFile || g.editing) return null;
  return Object.freeze({objective:g.original,revision:1,steps:Object.freeze([
    Object.freeze({step_id:'launch_premiere',expected_tool:'premiere_launch',depends_on:Object.freeze([]),
      success_criteria:'Native launch action has its exact successful Rust audit; not task completion'}),
    Object.freeze({step_id:'observe_window',expected_tool:'ui_windows',depends_on:Object.freeze(['launch_premiere']),
      success_criteria:'Fresh audited Windows inspection identifies the requested Premiere window'})
  ])});
}

// Notepad deterministic readback contract for simple launch verification
// Returns a ui_windows proposal after an audited launch_app for Notepad
const SIMPLE_NOTEPAD_ENGLISH = /^(?:(?:please\s+)?(?:open|launch|start)\s+)?notepad(?:\s+(?:kholo|khol\s*do|kholdo|open\s+kar(?:\s+do|o)|launch\s+karo|start\s+karo))?$/iu;
const SIMPLE_NOTEPAD_HINDI = /^(?:कृपया\s+)?नोटपैड\s+(?:खोलो|खोल\s*दो|ओपन\s+करो)$/u;

export function isSimpleNotepadLaunch(goal) {
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 120) return false;
  const normalized = goal.trim().replace(/[.!?।]+\s*$/u, "").trim();
  return SIMPLE_NOTEPAD_ENGLISH.test(normalized)||SIMPLE_NOTEPAD_HINDI.test(normalized);
}

export function nextNotepadReadbackProposal(goal, auditedTool) {
  // Only trigger deterministic readback for simple Notepad launch requests
  if (!isSimpleNotepadLaunch(goal)) return null;
  const g=deriveMasterGoalContract(goal);
  if(!g||g.apps.length!==1||g.apps[0]!=='notepad'||!g.opening)return null;
  if (auditedTool !== 'launch_app') return null;
  return {tool: 'ui_windows', arguments: {}};
}

// The first verified launch can be followed by its deterministic inspection
// without another paid Master request. This only returns a *proposal* for
// normal native prepare/Allow once/audit; it NEVER executes a UI inspection.
export function nextMasterReadbackProposal(goal, auditedTool) {
  // Try Premiere DAG first
  const graph=initialMasterInspectionDAG(goal);
  if (graph && auditedTool===graph.steps[0].expected_tool) {
    return {tool:graph.steps[1].expected_tool,arguments:{}};
  }
  // Try Notepad deterministic readback
  return nextNotepadReadbackProposal(goal, auditedTool);
}

// Scope is checked before *both* initial and follow-up native preparations.
// This dashboard has NO task-DAG state machine: reject graph/step metadata
// instead of passing unverifiable model-authored scheduling state to Rust.
export function admitDashboardMasterProposal(goal, proposal) {
  const g = typeof goal === 'string' ? deriveMasterGoalContract(goal) : goal;
  if (!g) return fail('Original user task is missing or invalid.');
  if (!OBJ(proposal) || typeof proposal.tool !== 'string' ||
      !/^[a-z][a-z0-9_]{0,159}$/.test(proposal.tool) ||
      !OBJ(proposal.arguments)) return fail('Malformed typed native proposal.');
  if (proposal.task_graph != null || proposal.task_step_id != null || proposal.task_recovery != null)
    return fail('This dashboard does not own a Rust-backed task DAG; model-authored graph, step or recovery identity is not authority.');
  if (proposal.plan != null) {
    if (!OBJ(proposal.plan) || (proposal.plan.objective != null &&
        proposal.plan.objective !== g.original))
      return fail('Model plan attempts to replace the original user objective.');
  }
  // A single explicitly named editor scopes app-specific tools. Windows UI
  // observation, Remotion support and native inspections remain independent;
  // cross-editor work needs an actual user request naming the other editor.
  if (g.apps.length === 1) {
    const foreign = Object.keys(TOOLS).find(app => app !== g.apps[0] && TOOLS[app].test(proposal.tool));
    if (foreign) return fail('Tool targets '+foreign+' but the original task names only '+g.apps[0]+'. Ask for a new explicit user instruction.');
  }
  const pureOpening=g.apps.length===1&&g.opening&&!g.project&&!g.editing&&!g.exportFile;
  const narrowNotepadLaunch=pureOpening&&g.apps[0]==='notepad'&&isSimpleNotepadLaunch(g.original);
  if(pureOpening&&!OPENING_ONLY_TOOLS.has(proposal.tool)&&
      !(proposal.tool==='launch_app'&&narrowNotepadLaunch))
    return fail('Opening an editor does not authorize an unrelated process, file mutation, or export.');
  if (proposal.tool === 'launch_app' && g.apps.length === 1) {
    // launch_app may only be grounded by the existing native observed-target
    // checks; never accept a model-selected binary for a different editor.
    const app = g.apps[0];
    let serialized;
    try { serialized = JSON.stringify(proposal.arguments).slice(0,4096).toLowerCase(); }
    catch { return fail('Invalid or circular launch arguments.'); }
    if(narrowNotepadLaunch){
      const args=proposal.arguments;
      if(args.program!=='notepad.exe'||
         (args.args!==undefined&&(!Array.isArray(args.args)||args.args.length!==0))||
         Object.keys(args).some(key=>!['program','args'].includes(key)))
        return fail('A simple Notepad opening authorizes only notepad.exe without arguments.');
    }
    if (Object.keys(EDITORS).some(other => other !== app &&
        new RegExp(other === 'after_effects' ? 'after[ _-]?effects|afterfx' : other).test(serialized)))
      return fail('Launch target conflicts with the named editor.');
  }
  return {ok:true,reason:null};
}

export function masterAutonomyGuidance(goal) {
  const g = typeof goal === 'string' ? deriveMasterGoalContract(goal) : goal;
  if (!g) return 'No valid original task; do not propose native execution.';
  const plan = initialMasterInspectionDAG(g);
  const focus = g.apps.length === 1 ? ' Target editor: '+g.apps[0]+'.' :
    g.apps.length > 1 ? ' Multiple named editors; honor exact task boundaries.' : '';
  return 'SHUVI MASTER TASK CONTRACT: preserve the original user goal.'+focus+
    (plan ? ' Deterministic first readback sequence: premiere_launch -> ui_windows (each needs Allow once and Rust audit).' : '')+
    (g.required.length ? ' Independent completion requirements: '+g.required.join(', ')+'.' : '')+
    ' Launch, window observation, model text and audited steps alone NEVER prove project/save/edit/export completion. No invented path, name, blind replay, auto-grant or task-DAG identity.';
}
