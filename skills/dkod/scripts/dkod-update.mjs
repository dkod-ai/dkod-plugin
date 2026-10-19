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
// Prints one JSON line: { ok, from, to, files } or { ok: false, error }.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
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
try {
  for (const f of planned) {
    mkdirSync(dirname(f.target), { recursive: true });
    writeFileSync(f.target, f.bytes);
    if (process.platform !== "win32") chmodSync(f.target, f.mode);
  }
  if (pluginName(stage) !== "dkod") throw new Error("the downloaded plugin is not named dkod");
  mkdirSync(dirname(folder), { recursive: true });
  if (existsSync(folder)) renameSync(folder, old);
  renameSync(stage, folder);
  rmSync(old, { recursive: true, force: true });
} catch (err) {
  if (!existsSync(folder) && existsSync(old)) renameSync(old, folder);
  rmSync(stage, { recursive: true, force: true });
  fail(`could not write the plugin: ${err instanceof Error ? err.message : String(err)}${sandboxed(err) ? `. ${SANDBOX_HINT}` : ""}`);
}
done({ ok: true, folder, from: before, to: bundle.version ?? null, files: bundle.files.length });
