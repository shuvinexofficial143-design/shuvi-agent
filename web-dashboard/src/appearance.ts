/**
 * Shuvi web-only appearance preferences.
 * Midnight Sapphire is the default. Older Ember settings are intentionally
 * not migrated: the previous orange look should never reappear after upgrade.
 * No remote requests, credentials or native runtime actions.
 */
export type ShuviPalette = "sapphire" | "violet" | "teal" | "steel";
const KEY = "shuvi.web.palette.v2";
const labels: Record<ShuviPalette, string> = {
  sapphire: "Midnight Sapphire",
  violet: "Arctic Violet",
  teal: "Teal Matrix",
  steel: "Steel Monochrome"
};

export function isShuviPalette(value: unknown): value is ShuviPalette {
  return value === "sapphire" || value === "violet" ||
    value === "teal" || value === "steel";
}

export function readPalette(): ShuviPalette {
  try {
    const value: unknown = localStorage.getItem(KEY);
    return isShuviPalette(value) ? value : "sapphire";
  } catch {
    return "sapphire";
  }
}

export function selectPalette(value: ShuviPalette, persist = true): void {
  document.documentElement.dataset.palette = value;
  document.querySelectorAll<HTMLButtonElement>("[data-palette]").forEach(button => {
    const isSelected = button.dataset.palette === value;
    button.classList.toggle("active", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
  const status = document.getElementById("appearanceStatus");
  if (status) status.textContent = labels[value] + " selected.";
  if (persist) {
    try { localStorage.setItem(KEY, value); }
    catch {
      if (status) status.textContent = labels[value] + " selected for this session. Browser storage is unavailable.";
    }
  }
}

export function initializeAppearance(): void {
  selectPalette(readPalette(), false);
  document.querySelectorAll<HTMLButtonElement>("[data-palette]").forEach(button => {
    button.addEventListener("click", () => {
      if (isShuviPalette(button.dataset.palette)) selectPalette(button.dataset.palette);
    });
  });
}
