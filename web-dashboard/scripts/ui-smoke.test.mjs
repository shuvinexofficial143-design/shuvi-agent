import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("index.html");
const main = read("src/main.ts");
const palette = read("src/appearance.ts");
const premium = read("src/premium-theme.css");
const old = read("src/styles.css");

test("Midnight Sapphire is the default and four palette controls work", () => {
  assert.match(main, /import "\.\/premium-theme\.css"/);
  assert.match(main, /initializeAppearance\(\)/);
  assert.match(premium, /--bg: #0B1220/);
  assert.match(premium, /--panel-2: #1E293B/);
  assert.match(premium, /--shuvi-accent: #2563EB/);
  assert.match(premium, /--shuvi-secondary: #7DD3FC/);
  assert.match(premium, /--text: #F8FAFC/);
  for (const name of ["sapphire", "violet", "teal", "steel"]) {
    assert.ok(html.includes('data-palette="' + name + '"'), name + " button missing");
    assert.ok(palette.includes('value === "' + name + '"'), name + " not whitelisted");
  }
  assert.match(palette, /shuvi\.web\.palette\.v2/);
  assert.match(palette, /return isShuviPalette\(value\) \? value : "sapphire"/);
  assert.match(palette, /localStorage\.setItem\(KEY, value\)/);
  assert.match(palette, /button\.setAttribute\("aria-pressed"/);
  assert.match(html, /data-palette="sapphire" aria-pressed="true"/);
  assert.match(html, /Midnight Sapphire selected/);
  assert.doesNotMatch(html, /Shuvi Ember|Orange \+ Ice blue/);
  assert.doesNotMatch(premium, /#f3a261|#f9dbc3|#f9d7bd/i);
  assert.match(html, /id="appearanceStatus" role="status"/);
});

test("Level 3 dashboard is balanced and does not fake runtime progress", () => {
  assert.match(html, /class="dashboard-heading"/);
  assert.match(html, /Create with Shuvi/);
  assert.match(html, /Real Windows, Adobe and Blender actions stay inside/);
  assert.doesNotMatch(html, /style="width: (92|74|18)%"/);
  assert.match(html, /Runtime verification required/);
  assert.match(html, /Not connected/);
  assert.match(premium, /\.hero-card h2/);
  assert.match(premium, /\.metric-card span/);
});

test("Level 4–10 navigation preserves nine routes and keyboard interactions", () => {
  for (const route of ["dashboard","chat","studio","agents","tools","tasks","models","activity","settings"]) {
    assert.ok(main.includes(route + ': { eyebrow:'), route + " route missing");
    assert.ok(html.includes('id="view-' + route + '"'), route + " view missing");
  }
  assert.match(main, /Alt\+1…Alt\+9/);
  assert.match(main, /button\.setAttribute\("aria-label", item\.label\)/);
  assert.match(main, /view\.setAttribute\("aria-hidden"/);
  assert.match(main, /event\.key === "ArrowDown"/);
  assert.match(main, /event\.key !== "Tab"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(premium, /@media\(max-width: 620px\)/);
  assert.match(old, /prefers-reduced-motion/);
});

test("web appearance is isolated from protected desktop tools", () => {
  assert.doesNotMatch(palette, /fetch\(|invoke\(|__TAURI__|localStorage\.getItem\("shuvi\.api/i);
  assert.doesNotMatch(premium, /url\(\s*https?:/);
  assert.match(html, /Sensitive local permissions stay inside Shuvi\.exe/);
});
