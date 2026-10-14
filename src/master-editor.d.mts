export type MasterWorkerInfo = Readonly<{
  available: boolean;
  inspection: string | null;
  execution: string | null;
  role: string;
}>;
export const EDITOR_WORKERS: Readonly<Record<"premiere" | "after_effects" | "remotion" | "browser" | "blender", MasterWorkerInfo>>;
export function editingMasterContext(messages: ReadonlyArray<{ role: string; content: string }> | null | undefined): string;
export function orchestrationWithMasterEditor(base: string, messages: ReadonlyArray<{ role: string; content: string }> | null | undefined): string;
