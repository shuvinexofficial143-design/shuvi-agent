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
}

export const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", hint: "Overview", icon: "grid" },
  { id: "chat", label: "AI Chat", hint: "Command Shuvi", icon: "spark" },
  { id: "studio", label: "Creative Studio", hint: "Adobe + Blender", icon: "play" },
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
    icon: "Pr"
  },
  {
    id: "after-effects",
    name: "After Effects",
    category: "Motion & VFX",
    description: "Composition, layer, animation and acceptance workflows for advanced motion work.",
    state: "ready",
    stateLabel: "Integration code present",
    accent: "indigo",
    icon: "Ae"
  },
  {
    id: "blender",
    name: "Blender",
    category: "3D & VFX",
    description: "Advanced Blender control is being developed in the dedicated Shuvi Blender module.",
    state: "development",
    stateLabel: "Separate module in development",
    accent: "orange",
    icon: "Bl"
  },
  {
    id: "audition",
    name: "Audition",
    category: "Audio",
    description: "Audio cleanup and editing bridge for voice, dialogue and finishing workflows.",
    state: "ready",
    stateLabel: "Integration code present",
    accent: "teal",
    icon: "Au"
  },
  {
    id: "remotion",
    name: "Remotion",
    category: "Programmatic video",
    description: "Code-driven motion graphics and video rendering runtime tracked inside Shuvi.",
    state: "ready",
    stateLabel: "Runtime present",
    accent: "cyan",
    icon: "Rm"
  },
  {
    id: "media-encoder",
    name: "Media Encoder",
    category: "Delivery",
    description: "Delivery and encoding surface for export-oriented creative workflows.",
    state: "local",
    stateLabel: "Local runtime required",
    accent: "blue",
    icon: "Me"
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
    icon: "PC"
  },
  {
    id: "screen-vision",
    name: "Screen Vision",
    category: "Vision",
    description: "Understand visible application state before proposing UI actions.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "cyan",
    icon: "Vi"
  },
  {
    id: "coding",
    name: "Coding Workspace",
    category: "Development",
    description: "Read projects, edit code, validate changes and work with repository tasks.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "green",
    icon: "</>"
  },
  {
    id: "files",
    name: "File Workspace",
    category: "Files",
    description: "Permission-first file reads and writes inside approved local workspaces.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "amber",
    icon: "Fi"
  },
  {
    id: "powershell",
    name: "PowerShell",
    category: "System",
    description: "Prepare, review and execute approved Windows shell actions.",
    state: "local",
    stateLabel: "Local runtime only",
    accent: "slate",
    icon: ">_"
  },
  {
    id: "orchestrator",
    name: "Task Orchestrator",
    category: "Agent core",
    description: "Break larger work into guarded steps with checkpoints and evidence.",
    state: "ready",
    stateLabel: "Core code present",
    accent: "violet",
    icon: "Or"
  }
];

export const modelProviders = [
  { name: "OpenAI", short: "OA", note: "GPT family", state: "Configurable" },
  { name: "Anthropic", short: "AN", note: "Claude family", state: "Configurable" },
  { name: "Google", short: "GO", note: "Gemini family", state: "Configurable" },
  { name: "DeepSeek", short: "DS", note: "DeepSeek models", state: "Configurable" },
  { name: "OpenRouter", short: "OR", note: "Multi-provider routing", state: "Configurable" },
  { name: "Ollama", short: "OL", note: "Local models", state: "Configurable" },
  { name: "Custom", short: "API", note: "OpenAI-compatible endpoint", state: "Configurable" }
];

export const stateText: Record<ModuleState, string> = {
  ready: "Code present",
  local: "Needs local Shuvi",
  development: "In development",
  planned: "Planned"
};
