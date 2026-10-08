import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const root=JSON.parse(read("package.json"));
const tauri=JSON.parse(read("src-tauri/tauri.conf.json"));
const web=JSON.parse(read("web-dashboard/package.json"));
const vite=read("web-dashboard/vite.config.ts");
const rootVite=read("vite.config.ts");
const readme=read("README.md");

test("normal npm run dev starts only the NEW browser Control Center",()=>{
 assert.equal(root.scripts.dev,"npm --prefix web-dashboard run dev");
 assert.equal(root.scripts["dev:web"],root.scripts.dev);
 assert.equal(web.scripts.dev,"vite");
 assert.match(readme,/Default browser UI: New Shuvi Control Center/);
 assert.doesNotMatch(root.scripts.dev,/\bvite --port 1420/);
});

test("browser preview is always 127.0.0.1:1423 and never auto switches",()=>{
 assert.match(vite,/host: "127\.0\.0\.1"/);
 assert.match(vite,/port: 1423/);
 assert.match(vite,/strictPort: true/);
 assert.match(rootVite,/port: 1420/);
 assert.match(rootVite,/strictPort: true/);
});

test("native Tauri remains usable with isolated legacy Desktop entrypoint",()=>{
 assert.equal(root.scripts["dev:desktop"],"vite --port 1420 --strictPort");
 assert.equal(tauri.build.beforeDevCommand,"npm run dev:desktop");
 assert.equal(tauri.build.devUrl,"http://localhost:1420");
 assert.equal(tauri.build.beforeBuildCommand,"npm run build");
 assert.equal(tauri.build.frontendDist,"../dist");
 assert.ok(root.scripts.tauri,"native Tauri command preserved");
 assert.ok(root.scripts.build,"native frontend build preserved");
});
