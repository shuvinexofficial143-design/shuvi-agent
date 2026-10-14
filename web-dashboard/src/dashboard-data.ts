export type ModuleState = "ready" | "local" | "development" | "planned";

export interface NavItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
}

export interface FeatureModule {
  id: string;
  name: string;
  category: string;
  description: string;
  state: ModuleState;
  stateLabel: string;
  accent: string;
  icon: string;
  capabilities: string[];
  workflows: string[];
  requirement: string;
}

export interface RoutingPreset {
  id: string;
  name: string;
  description: string;
  workload: string;
  provider: string;
  modelHint: string;
}

export const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", hint: "Overview", icon: "grid" },
  { id: "chat", label: "Chat", hint: "Conversations", icon: "spark" },
  { id: "studio", label: "Creative Studio", hint: "Adobe + Blender", icon: "play" },
  { id: "projects", label: "Projects", hint: "Tasks & assets", icon: "folder" },
  { id: "workflows", label: "Workflows", hint: "Visual automation", icon: "flow" },
  { id: "agents", label: "Agents", hint: "Master & workers", icon: "agents" },
  { id: "tools", label: "Tools", hint: "Computer capabilities", icon: "tool" },
  { id: "tasks", label: "Tasks", hint: "Runs & progress", icon: "check" },
  { id: "models", label: "AI Models", hint: "Provider routing", icon: "brain" },
  { id: "activity", label: "Activity", hint: "Audit trail", icon: "pulse" },
  { id: "settings", label: "Settings", hint: "Runtime & access", icon: "settings" }
];

export const creativeModules: FeatureModule[] = [
  {
    id: "premiere",
    name: "Premiere Pro",
    category: "Video editing",
    description: "Native project and timeline control through Shuvi's Premiere integration.",
    state: "ready",
    stateLabel: "Integration code present",
    accent: "violet",
    icon: "Pr",
    capabilities: ["Project and sequence awareness", "Timeline assembly", "Caption and graphics workflows", "Export-oriented finishing"],
    workflows: ["Talking-head edit", "Scene rough cut", "Layering and graphics", "Delivery preparation"],
    requirement: "Premiere Pro + local Shuvi bridge"
  },
  {
    id: "after-effects",
    name: "After Effects",
    category: "Motion & VFX",
    description: "Composition, layer, animation and acceptance workflows for advanced motion work.",
    state: "ready",
    stateLabel: "Integration code present",
    accent: "indigo",
    icon: "Ae",
    capabilities: ["Composition control", "Layer operations", "Keyframe and animation workflows", "Acceptance checks"],
    workflows: ["Motion graphics", "Tracked overlays", "Hand/VFX augmentation", "Template-driven animation"],
    requirement: "After Effects + local Shuvi bridge"
  },
  {
    id: "blender",
    name: "Blender",
    category: "3D & VFX",
    description: "Advanced Blender control is being developed in the dedicated Shuvi Blender module.",
    state: "development",
    stateLabel: "Separate module in development",
    accent: "blue",
    icon: "Bl",
    capabilities: ["Scene inspection", "Object and transform control", "Material and lighting workflows", "Animation planning"],
    workflows: ["3D scene build", "Camera and lighting setup", "Animation blocking", "VFX scene preparation"],
    requirement: "Dedicated Blender module still in development"
  },
  {
    id: "audition",
    name: "Audition",
    category: "Audio",
    description: "Audio cleanup and editing bridge for voice, dialogue and finishing workflows.",
    state: "ready",
    stateLabel: "Integration code present",
    accent: "teal",
    icon: "Au",
    capabilities: ["Dialogue cleanup", "Level balancing", "Noise-oriented workflows", "Round-trip audio finishing"],
    workflows: ["Voice cleanup", "Podcast/dialogue pass", "Audio polish", "Premiere audio round-trip"],
    requirement: "Adobe Audition + local Shuvi bridge"
  },
  {
    id: "remotion",
    name: "Remotion",
    category: "Programmatic video",
    description: "Code-driven motion graphics and video rendering runtime tracked inside Shuvi.",
    state: "ready",
    stateLabel: "Render source present",
    accent: "cyan",
    icon: "Rm",
    capabilities: ["Code-driven compositions", "Reusable motion systems", "Data-bound video", "Render planning"],
    workflows: ["Automated explainers", "Template videos", "Dynamic motion graphics", "Batch variations"],
    requirement: "Local Node/Remotion runtime"
  },
  {
    id: "media-encoder",
    name: "Media Encoder",
    category: "Delivery",
    description: "Delivery and encoding surface for export-oriented creative workflows.",
    state: "local",
    stateLabel: "Local runtime required",
    accent: "blue",
    icon: "Me",
    capabilities: ["Export queue planning", "Preset-oriented delivery", "Format handoff", "Encoding status surface"],
    workflows: ["YouTube delivery", "Social exports", "Master + proxy outputs", "Batch encoding"],
    requirement: "Media Encoder + local runtime"
  },
  {
    id: "photoshop",
    name: "Photoshop",
    category: "Design & Image",
    description: "Permission-gated Photoshop bridge for image documents, layer editing, text and masks.",
    state: "ready",
    stateLabel: "Bridge source present",
    accent: "blue",
    icon: "Ps",
    capabilities: ["Document and layer inspection", "Layer transforms", "Text and mask operations", "Save and state verification"],
    workflows: ["Thumbnail design", "Photo retouch preparation", "Composite edit", "Social creative variants"],
    requirement: "Installed Photoshop + paired Shuvi native bridge; runtime not verified in the web UI"
  },
  {
    id: "illustrator",
    name: "Illustrator",
    category: "Design & Image",
    description: "Source-side Illustrator vector workflow and document bridge.",
    state: "ready",
    stateLabel: "Bridge source present",
    accent: "blue",
    icon: "Ai",
    capabilities: ["Document discovery", "Vector object plans", "Color and style operations", "Controlled save/checkpoints"],
    workflows: ["Logo and icon refinement", "Vector illustration", "Brand asset preparation", "Document review"],
    requirement: "Illustrator + local Shuvi bridge; actual paired state is not available in this browser"
  },
  {
    id: "animate",
    name: "Adobe Animate",
    category: "Animation",
    description: "Source-side animation bridge and document/checkpoint workflows.",
    state: "ready",
    stateLabel: "Bridge source present",
    accent: "violet",
    icon: "An",
    capabilities: ["Timeline and scene planning", "Animation document discovery", "Checkpoint-aware edits", "Export preparation"],
    workflows: ["2D character scene", "Timeline animation", "Interactive animation planning", "Short animation export"],
    requirement: "Adobe Animate installed and connected to a trusted local Shuvi runtime"
  },
  {
    id: "character-animator",
    name: "Character Animator",
    category: "Animation",
    description: "Shortcut-based control, trigger discovery and interchange planning sources.",
    state: "ready",
    stateLabel: "Source adapters present",
    accent: "violet",
    icon: "Ch",
    capabilities: ["Host preflight", "Shortcut and trigger plans", "Interchange preparation", "Review/checkpoints"],
    workflows: ["Puppet trigger setup", "Character performance", "Live animation capture plan", "Scene interchange"],
    requirement: "Character Animator + local runtime and supported host controls"
  },
  {
    id: "substance-3d",
    name: "Substance 3D",
    category: "3D & VFX",
    description: "Bounded Painter/Sampler automation foundations; some products require a separate license.",
    state: "development",
    stateLabel: "Partial source coverage",
    accent: "cyan",
    icon: "3D",
    capabilities: ["Capability and host discovery", "Painter preflight and texturing plans", "Sampler workflow discovery", "Evidence and safe export planning"],
    workflows: ["Material preparation", "PBR texture planning", "Asset baking preparation", "Surface variation review"],
    requirement: "Separately licensed Substance application and explicit native acceptance testing"
  },
  {
    id: "frame-io",
    name: "Frame.io",
    category: "Review & Collaboration",
    description: "Review workspace integration with project/file discovery and commentary sources.",
    state: "ready",
    stateLabel: "API source present",
    accent: "blue",
    icon: "Fi",
    capabilities: ["Workspace/project discovery", "Asset listing", "Comment review", "Review approval planning"],
    workflows: ["Client feedback review", "Version delivery preparation", "Shot notes", "Creative review checklist"],
    requirement: "Authorized Frame.io connection in the trusted Shuvi runtime; web dashboard cannot authenticate it"
  }
];

export const toolModules: FeatureModule[] = [
  {
    id: "computer",
    name: "Computer Control",
    category: "Windows",
    description: "Window-scoped UI interaction and controlled local computer actions.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "blue",
    icon: "PC",
    capabilities: ["Window-scoped actions", "Application navigation", "Guarded clicks and typing", "Permission-gated execution"],
    workflows: ["Open and configure apps", "Repeat UI procedures", "Assist desktop workflows", "Controlled automation"],
    requirement: "Shuvi.exe on Windows"
  },
  {
    id: "screen-vision",
    name: "Screen Vision",
    category: "Vision",
    description: "Understand visible application state before proposing UI actions.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "cyan",
    icon: "Vi",
    capabilities: ["Visible-state understanding", "UI element reasoning", "Pre-action inspection", "Visual task context"],
    workflows: ["Inspect editing state", "Read dialog context", "Validate visible result", "Guide UI control"],
    requirement: "Local vision/runtime access"
  },
  {
    id: "coding",
    name: "Coding Workspace",
    category: "Development",
    description: "Read projects, edit code, validate changes and work with repository tasks.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "green",
    icon: "</>",
    capabilities: ["Workspace reads", "Code edits", "Validation/test planning", "Git-aware task execution"],
    workflows: ["Feature implementation", "Bug fixing", "Repo audit", "Build and validation"],
    requirement: "Approved local workspace"
  },
  {
    id: "files",
    name: "File Workspace",
    category: "Files",
    description: "Permission-first file reads and writes inside approved local workspaces.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "amber",
    icon: "Fi",
    capabilities: ["Scoped reads", "Controlled writes", "Project file management", "Permission boundary"],
    workflows: ["Organize project assets", "Read references", "Prepare exports", "Manage local task files"],
    requirement: "Approved filesystem scope"
  },
  {
    id: "powershell",
    name: "PowerShell",
    category: "System",
    description: "Prepare, review and execute approved Windows shell actions.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "slate",
    icon: ">_",
    capabilities: ["Command preparation", "Risk display", "Explicit approval", "Audited execution"],
    workflows: ["Development commands", "Local diagnostics", "Tool setup", "Controlled system tasks"],
    requirement: "Explicit local approval"
  },
  {
    id: "orchestrator",
    name: "Task Orchestrator",
    category: "Agent core",
    description: "Break larger work into guarded steps with checkpoints and evidence.",
    state: "ready",
    stateLabel: "Core code present",
    accent: "violet",
    icon: "Or",
    capabilities: ["Task graphs", "Step checkpoints", "Recovery state", "Evidence-bound progress"],
    workflows: ["Long coding tasks", "Multi-app creative work", "Recoverable task runs", "Approval-aware execution"],
    requirement: "Core Shuvi runtime"
  }
];

export const modelProviders = [
  { name: "xKiro", short: "XK", note: "Shuvi native Master provider · Windows config required", state: "Native only" },
  { name: "OpenAI", short: "OA", note: "GPT family", state: "Configurable" },
  { name: "Anthropic", short: "AN", note: "Claude family", state: "Configurable" },
  { name: "Google", short: "GO", note: "Gemini family", state: "Configurable" },
  { name: "DeepSeek", short: "DS", note: "DeepSeek models", state: "Configurable" },
  { name: "OpenRouter", short: "OR", note: "Multi-provider routing", state: "Configurable" },
  { name: "Ollama", short: "OL", note: "Local models", state: "Configurable" },
  { name: "Custom", short: "API", note: "OpenAI-compatible endpoint", state: "Configurable" }
];

export const routingPresets: RoutingPreset[] = [
  {
    id: "general",
    name: "Balanced",
    description: "General Shuvi planning and everyday tasks.",
    workload: "General",
    provider: "xKiro",
    modelHint: "configured by Shuvi on Windows"
  },
  {
    id: "coding",
    name: "Coding focus",
    description: "Repo work, debugging and implementation planning.",
    workload: "Coding",
    provider: "Anthropic",
    modelHint: "strong coding/reasoning model"
  },
  {
    id: "creative",
    name: "Creative edit",
    description: "Video editing, motion graphics and creative decisions.",
    workload: "Video Editing",
    provider: "OpenAI",
    modelHint: "multimodal creative model"
  },
  {
    id: "3d",
    name: "3D / Blender",
    description: "Scene planning, technical 3D tasks and Blender workflows.",
    workload: "3D",
    provider: "Google",
    modelHint: "long-context multimodal model"
  }
];

export const stateText: Record<ModuleState, string> = {
  ready: "Code present",
  local: "Needs local Shuvi",
  development: "In development",
  planned: "Planned"
};
