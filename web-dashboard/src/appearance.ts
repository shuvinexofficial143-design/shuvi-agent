/**
 * Shuvi web-only appearance preferences.
 * No remote requests, credentials or native runtime actions.
 */
export type ShuviPalette = "ember" | "frost" | "jade";
const KEY = "shuvi.web.palette.v1";
const labels: Record<ShuviPalette, string> = {
  ember: "Shuvi Ember",
  frost: "Arctic",
  jade: "Jade"
};

export function isShuviPalette(value: unknown): value is ShuviPalette {
  return value === "ember" || value === "frost" || value === "jade";
}

export function readPalette(): ShuviPalette {
  try {
    const value: unknown = localStorage.getItem(KEY);
    return isShuviPalette(value) ? value : "ember";
  } catch {
    return "ember";
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
