/**
 * Web-only conversation drafts.
 * Security boundary: browser storage is NOT the native Shuvi task queue,
 * no AI model is called and these records cannot approve/execute local tools.
 */
export type SavedChatMessage = {
  id: string;
  role: "user";
  content: string;
  createdAt: number;
};
export type SavedChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  draft: string;
  messages: SavedChatMessage[];
};
export type SavedChatLibrary = {
  activeId: string;
  threads: SavedChatThread[];
};
export const CHAT_MAX_THREADS = 24;
export const CHAT_MAX_MESSAGES = 40;
export const CHAT_MAX_MESSAGE_LENGTH = 2500;
export const CHAT_STORAGE_KEY = "shuvi.web.chat-drafts.v1";

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(id);
const safeDate = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value : Date.now();

function safeMessage(value: unknown): SavedChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<SavedChatMessage>;
  if (!validId(m.id) || m.role !== "user" || typeof m.content !== "string") return null;
  const content = m.content.trim().slice(0, CHAT_MAX_MESSAGE_LENGTH);
  if (!content) return null;
  return { id: m.id, role: "user", content, createdAt: safeDate(m.createdAt) };
}

function safeThread(value: unknown): SavedChatThread | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Partial<SavedChatThread>;
  if (!validId(t.id) || !Array.isArray(t.messages) || typeof t.title !== "string") return null;
  const messages: SavedChatMessage[] = t.messages.map(safeMessage)
    .filter((item): item is SavedChatMessage => item !== null)
    .slice(-CHAT_MAX_MESSAGES);
  const title = t.title.trim().slice(0, 80) || "New chat";
  return {
    id: t.id,
    title,
    createdAt: safeDate(t.createdAt),
    updatedAt: safeDate(t.updatedAt),
    pinned: t.pinned === true,
    archived: t.archived === true,
    draft: typeof t.draft === "string" ? t.draft.slice(0, CHAT_MAX_MESSAGE_LENGTH) : "",
    messages
  };
}

export function createChatThread(): SavedChatThread {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
    draft: "",
    messages: []
  };
}

export function loadChatLibrary(): SavedChatLibrary {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return { activeId: "", threads: [] };
    const saved = value as Partial<SavedChatLibrary>;
    if (!Array.isArray(saved.threads)) return { activeId: "", threads: [] };
    const seen = new Set<string>();
    const threads = saved.threads.map(safeThread).filter((t): t is SavedChatThread => {
      if (!t || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }).slice(0, CHAT_MAX_THREADS);
    const activeId = validId(saved.activeId) && threads.some(t => t.id === saved.activeId)
      ? saved.activeId : threads[0]?.id ?? "";
    return { activeId, threads };
  } catch {
    return { activeId: "", threads: [] };
  }
}

export function saveChatLibrary(data: SavedChatLibrary): boolean {
  try {
    const seen = new Set<string>();
    const threads = data.threads.map(safeThread).filter((t): t is SavedChatThread => {
      if (!t || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }).slice(0, CHAT_MAX_THREADS);
    const activeId = threads.some(t => t.id === data.activeId) ? data.activeId : threads[0]?.id ?? "";
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ activeId, threads }));
    return true;
  } catch {
    return false;
  }
}

export function addPrompt(thread: SavedChatThread, value: string): SavedChatThread {
  const content = value.trim().slice(0, CHAT_MAX_MESSAGE_LENGTH);
  if (!content || thread.archived) return thread;
  const message: SavedChatMessage = {
    id: crypto.randomUUID(), role: "user", content, createdAt: Date.now()
  };
  const title = thread.title === "New chat"
    ? content.replace(/\s+/g, " ").slice(0, 52) || "New chat"
    : thread.title;
  return {
    ...thread, title, draft: "",
    updatedAt: Date.now(),
    messages: [...thread.messages, message].slice(-CHAT_MAX_MESSAGES)
  };
}
