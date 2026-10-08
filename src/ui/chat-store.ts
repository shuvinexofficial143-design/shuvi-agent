import type { ChatMessage } from "../types";

export type ThreadStatus = "idle" | "running" | "approval" | "completed" | "failed" | "paused";

export type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: ThreadStatus;
  messages: ChatMessage[];
};

const KEY = "shuvi.chat-library.v1";
const ACTIVE_KEY = "shuvi.chat-library.active.v1";
const MAX_THREADS = 24;
const MAX_MESSAGES = 45;
const MAX_MESSAGE_CHARS = 3000;

function usableMessage(raw: unknown): raw is ChatMessage {
  if (!raw || typeof raw !== "object") return false;
  const message = raw as {role?: unknown; content?: unknown};
  return (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    !message.content.startsWith("[SHUVI_TOOL_RESULT]");
}

function visibleHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(usableMessage).slice(-MAX_MESSAGES)
    .map(message => ({role: message.role, content: message.content.slice(0, MAX_MESSAGE_CHARS)}));
}

function safeThread(raw: unknown): ChatThread | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<ChatThread>;
  if (typeof t.id !== "string" || !/^[0-9a-f-]{36}$/i.test(t.id)) return null;
  if (typeof t.title !== "string" || !Array.isArray(t.messages)) return null;
  const statuses: ThreadStatus[] = ["idle","running","approval","completed","failed","paused"];
  const original = statuses.includes(t.status as ThreadStatus) ? t.status as ThreadStatus : "idle";
  return {
    id: t.id,
    title: t.title.slice(0, 80) || "New chat",
    createdAt: typeof t.createdAt === "number" && Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    updatedAt: typeof t.updatedAt === "number" && Number.isFinite(t.updatedAt) ? t.updatedAt : Date.now(),
    // A browser reload does not mean an agent is still running.
    status: original === "running" || original === "approval" ? "paused" : original,
    messages: visibleHistory(t.messages)
  };
}

export function newThread(): ChatThread {
  const now = Date.now();
  return {id: crypto.randomUUID(), title: "New chat", createdAt: now, updatedAt: now, status: "idle", messages: []};
}

export function loadChatLibrary(): ChatThread[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const used = new Set<string>();
    return raw.map(safeThread).filter((t): t is ChatThread => {
      if (!t || used.has(t.id)) return false;
      used.add(t.id);
      return true;
    }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_THREADS);
  } catch {
    return [];
  }
}

export function saveChatLibrary(threads: ChatThread[]): boolean {
  try {
    const compact = threads
      .map(t => ({...t, messages: visibleHistory(t.messages)}))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS);
    localStorage.setItem(KEY, JSON.stringify(compact));
    return true;
  } catch {
    return false;
  }
}

export function currentThreadId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setCurrentThreadId(id: string): void {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* in-memory selection remains valid */ }
}

export function updateThread(thread: ChatThread, messages: ChatMessage[], status?: ThreadStatus): ChatThread {
  const visible = visibleHistory(messages);
  const firstPrompt = visible.find(m => m.role === "user")?.content.trim();
  const title = thread.title === "New chat" && firstPrompt
    ? (firstPrompt.replace(/\s+/g, " ").slice(0, 48) || "New chat")
    : thread.title;
  return {...thread, title, messages: visible, updatedAt: Date.now(), status: status ?? thread.status};
}
