#!/usr/bin/env node
// dkod-update.mjs: update the dkod plugin for Cursor in place, with no git.
//
//   node dkod-update.mjs <plugin folder> <bundle url>
//
// <plugin folder> is the folder Cursor loads the plugin from (~/.cursor/plugins/local/dkod).
// <bundle url> is the org's own DKOD: https://<dashboard>/api/v1/dkoder/bundle/cursor.json. It
// answers { name: "dkod", version, files: [{ path, mode, base64 }] }.
//
// The new plugin is written next to the folder first, then the two folders are swapped, so Cursor
// never loads half a plugin. The folder is replaced only when it holds the dkod plugin already
// (.cursor-plugin/plugin.json named dkod): the script never deletes anything else.
// On Windows a folder that Cursor holds open cannot be renamed. Then the new files are written over
// the old ones in place, plugin.json last, with a copy of the old folder to put back on a failure.
// Prints one JSON line: { ok, from, to, files } or { ok: false, error }.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

// Cursor's sandbox reaches the network only through the proxy it puts in HTTPS_PROXY. Node's fetch
// uses that proxy only with NODE_USE_ENV_PROXY=1 (Node 22.21+, 24.5+), so the script runs itself again with it.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const again = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(again.status ?? 1);
}

const done = (out, code = 0) => { process.stdout.write(`${JSON.stringify(out)}\n`); process.exit(code); };
const fail = (error) => done({ ok: false, error }, 1);
// Said when Cursor's sandbox stops the download or the write, so the agent can tell the user the fix.
const SANDBOX_HINT = "Cursor's sandbox stopped it. In Cursor Settings, Agents, set Run Mode to \"Allowlist\" (not \"with Sandbox\"), then run this again";
// Said when the plugin files are held open (Windows locks a folder a running program uses).
const LOCKED_HINT = "The plugin files are in use. Quit Cursor fully (also from the system tray), run `dk upgrade` in PowerShell or a terminal, then open Cursor again. Do not go on with the old plugin";
const locked = (err) => /EPERM|EBUSY|EACCES|ENOTEMPTY/.test(String(err?.code ?? "") + String(err?.message ?? ""));
const sandboxed = (err) => process.env.CURSOR_SANDBOX && /EPERM|EACCES|ENOTFOUND|fetch failed/.test(String(err?.code ?? "") + String(err?.message ?? "") + String(err?.cause?.code ?? ""));

const [folderArg, url] = process.argv.slice(2);
if (!folderArg || !url) fail("usage: node dkod-update.mjs <plugin folder> <bundle url>");
if (!/^https:\/\/[^/\s]+\/api\/v1\/dkoder\/bundle\/cursor\.json$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/v1\/dkoder\/bundle\/cursor\.json$/.test(url)) {
  fail("the bundle url must be https://<your DKOD>/api/v1/dkoder/bundle/cursor.json");
}
const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
const folder = resolve(folderArg.startsWith("~") ? join(home, folderArg.slice(1)) : folderArg);

const pluginName = (dir) => {
  try { return JSON.parse(readFileSync(join(dir, ".cursor-plugin", "plugin.json"), "utf8")).name ?? null; } catch { return null; }
};
const before = (() => {
  try { return JSON.parse(readFileSync(join(folder, ".cursor-plugin", "plugin.json"), "utf8")).version ?? null; } catch { return null; }
})();
if (existsSync(folder) && pluginName(folder) !== "dkod") fail(`${folder} is not the dkod plugin; nothing was changed`);

let bundle;
try {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) fail(`DKOD answered ${res.status}`);
  bundle = await res.json();
} catch (err) {
  fail(`could not download the plugin: ${err instanceof Error ? err.message : String(err)}${sandboxed(err) ? `. ${SANDBOX_HINT}` : ""}`);
}
if (bundle?.name !== "dkod" || !Array.isArray(bundle.files) || bundle.files.length === 0) fail("the answer is not the dkod plugin");

const stage = `${folder}.new-${process.pid}`;
const old = `${folder}.old-${process.pid}`;
// Every path is checked before anything is written.
const planned = bundle.files.map((f) => {
  const path = String(f.path ?? "");
  const target = join(stage, ...path.split("/"));
  if (path === "" || isAbsolute(path) || path.split(/[\\/]/).some((p) => p === ".." || p === "") || !target.startsWith(stage + sep)) fail(`unsafe path in the bundle: ${path}`);
  return { target, bytes: Buffer.from(String(f.base64 ?? ""), "base64"), mode: f.mode === 0o755 ? 0o755 : 0o644 };
});
if (!bundle.files.some((f) => f.path === ".cursor-plugin/plugin.json")) fail("the downloaded plugin has no .cursor-plugin/plugin.json");
rmSync(stage, { recursive: true, force: true });
const why = (err) => `${err instanceof Error ? err.message : String(err)}${sandboxed(err) ? `. ${SANDBOX_HINT}` : locked(err) ? `. ${LOCKED_HINT}` : ""}`;
try {
  for (const f of planned) {
    mkdirSync(dirname(f.target), { recursive: true });
    writeFileSync(f.target, f.bytes);
    if (process.platform !== "win32") chmodSync(f.target, f.mode);
  }
  if (pluginName(stage) !== "dkod") throw new Error("the downloaded plugin is not named dkod");
  mkdirSync(dirname(folder), { recursive: true });
} catch (err) {
  rmSync(stage, { recursive: true, force: true });
  fail(`could not write the plugin: ${why(err)}`);
}
let inPlace = false;
try {
  if (existsSync(folder)) renameSync(folder, old);
  renameSync(stage, folder);
} catch (err) {
  if (!existsSync(folder) && existsSync(old)) renameSync(old, folder);
  if (sandboxed(err) || !locked(err) || !existsSync(folder)) {
    rmSync(stage, { recursive: true, force: true });
    fail(`could not write the plugin: ${why(err)}`);
  }
  // The folder is held open: write each file over the old one. plugin.json goes last, so the version
  // only moves when every other file is new. A failure puts the copy of the old folder back.
  try {
    rmSync(old, { recursive: true, force: true });
    cpSync(folder, old, { recursive: true });
    const manifest = join(stage, ".cursor-plugin", "plugin.json");
    const order = [...planned.filter((f) => f.target !== manifest), ...planned.filter((f) => f.target === manifest)];
    for (const f of order) {
      const target = join(folder, f.target.slice(stage.length + 1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.bytes);
      if (process.platform !== "win32") chmodSync(target, f.mode);
    }
    inPlace = true;
  } catch (err2) {
    try { if (existsSync(old)) cpSync(old, folder, { recursive: true, force: true }); } catch { /* the old files stay as they are */ }
    rmSync(stage, { recursive: true, force: true });
    rmSync(old, { recursive: true, force: true });
    fail(`could not write the plugin: ${why(err2)}`);
  }
}
// What is left next to the folder is cleaned when it can be; a file still held open stays.
for (const dir of [stage, old]) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* left for the next run */ } }
done({ ok: true, folder, from: before, to: bundle.version ?? null, files: bundle.files.length, ...(inPlace ? { in_place: true } : {}) });
