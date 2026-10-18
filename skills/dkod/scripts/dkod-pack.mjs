#!/usr/bin/env node
// DKO-1020: pack an app folder into the ustar archive DKOD's worker reads, and upload it.
// For builders who do not use git. Node 18+ or Bun, no dependencies. dkod-pack.py, .ps1 and .sh do
// the same thing byte for byte (same files, same headers, same sha256); keep the four in step.
//
//   node dkod-pack.mjs pack [<folder>]                 -> {"file","sha256","bytes","files"}
//   node dkod-pack.mjs put <file> <url> ["Name: value"...] -> {"ok":true,"status":200}
//
// The archive holds regular files only, sorted by UTF-8 bytes, with mtime 0 and uid/gid 0, so the
// same folder always gives the same sha256. The upload URL is a signed credential: never printed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdtempSync, openSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const MAX_FILES = 20000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "out", ".turbo", ".cache", "coverage", "venv", ".venv", "__pycache__"]);
const WINDOWS = process.platform === "win32";

class Refusal extends Error {}
const fail = (message) => { throw new Refusal(message); };

const jsonString = (s) => JSON.stringify(s);

/** Whether a git work tree holds this folder and git is installed. */
function inGitTree(root) {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "true";
}

/** Candidate paths, relative to root with forward slashes, before the common filters. */
function candidates(root) {
  if (inGitTree(root)) {
    const r = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 1 << 30 });
    if (r.status !== 0) fail("git ls-files failed");
    return r.stdout.toString("utf8").split("\0").filter((p) => p !== "" && !p.endsWith("/"));
  }
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      const path = rel === "" ? name : `${rel}/${name}`;
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full, path);
      } else if (st.isFile()) out.push(path);
    }
  };
  walk(root, "");
  return out;
}

function checkPath(path) {
  const segments = path.split("/");
  if (path.startsWith("/") || path.includes("\\") || /[\x00-\x1f\x7f]/.test(path) || segments.some((s) => s === "" || s === "." || s === "..")) {
    fail(`path not allowed: ${path}`);
  }
}

/** ustar's name/prefix split at the leftmost `/` that leaves a name of at most 100 bytes. */
function splitPath(path) {
  const bytes = Buffer.from(path, "utf8");
  if (bytes.length > 255) fail(`path too long (over 255 bytes): ${path}`);
  if (bytes.length <= 100) return { name: bytes, prefix: Buffer.alloc(0) };
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0x2f) continue;
    if (bytes.length - i - 1 > 100) continue;
    if (i > 155) break;
    return { name: bytes.subarray(i + 1), prefix: bytes.subarray(0, i) };
  }
  fail(`path cannot be stored in ustar (prefix 155 / name 100 bytes): ${path}`);
}

const octal = (n, width) => n.toString(8).padStart(width, "0");

function header(name, prefix, mode, size) {
  const h = Buffer.alloc(512);
  name.copy(h, 0);
  h.write(`${mode}\0`, 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(`${octal(size, 11)}\0`, 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  prefix.copy(h, 345);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${octal(sum, 6)}\0 `, 148, "ascii");
  return h;
}

function pack(folder) {
  const root = resolve(folder);
  let isDir = false;
  try { isDir = statSync(root).isDirectory(); } catch { /* reported below */ }
  if (!isDir) fail(`not a folder: ${root}`);

  const files = [];
  for (const path of candidates(root)) {
    const segments = path.split("/");
    if (segments.some((s) => s.toLowerCase() === ".git")) continue;
    if (segments[segments.length - 1].startsWith(".env")) continue;
    let st;
    try { st = lstatSync(join(root, ...segments)); } catch { continue; }
    if (!st.isFile()) continue;
    checkPath(path);
    files.push({ path, key: Buffer.from(path, "utf8"), exec: !WINDOWS && (st.mode & 0o111) !== 0 });
  }
  files.sort((a, b) => Buffer.compare(a.key, b.key));
  if (files.length === 0) fail(`no files to pack in ${root}`);
  if (files.length > MAX_FILES) fail(`too many files: ${files.length} (the cap is ${MAX_FILES})`);

  const dir = mkdtempSync(join(tmpdir(), "dkod-src-"));
  const out = join(dir, "src.tar");
  const fd = openSync(out, "w");
  const hash = createHash("sha256");
  let bytes = 0;
  const emit = (buf) => { writeSync(fd, buf); hash.update(buf); bytes += buf.length; };
  try {
    let total = 0;
    for (const f of files) {
      const { name, prefix } = splitPath(f.path);
      const data = readFileSync(join(root, ...f.path.split("/")));
      if (data.length > MAX_FILE_BYTES) fail(`file too large: ${f.path} (the cap is 4 MiB per file)`);
      total += data.length;
      if (total > MAX_TOTAL_BYTES) fail("folder too large (the cap is 64 MiB of files in total)");
      emit(header(name, prefix, f.exec ? "0000755" : "0000644", data.length));
      emit(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad > 0) emit(Buffer.alloc(pad));
    }
    emit(Buffer.alloc(1024));
    closeSync(fd);
  } catch (err) {
    try { closeSync(fd); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return `{"file":${jsonString(out)},"sha256":"${hash.digest("hex")}","bytes":${bytes},"files":${files.length}}`;
}

/** Only https, or plain http to this machine (tests). */
function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { fail("refused: the upload URL is not a valid URL"); }
  if (u.username !== "" || u.password !== "") fail("refused: the upload URL carries a user name");
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return;
  fail("refused: only https upload URLs are allowed");
}

async function put(file, url, headerArgs) {
  checkUrl(url);
  const headers = new Headers();
  for (const arg of headerArgs) {
    const at = arg.indexOf(":");
    const name = at > 0 ? arg.slice(0, at).trim() : "";
    if (name === "") fail('bad header argument (expected "Name: value")');
    if (name.toLowerCase() === "content-length") continue;
    try { headers.append(name, arg.slice(at + 1).trim()); } catch { fail(`bad header: ${name}`); }
  }
  let body;
  try { body = readFileSync(file); } catch { fail(`cannot read ${file}`); }
  let res;
  try {
    res = await fetch(url, { method: "PUT", headers, body, redirect: "manual" });
    await res.arrayBuffer();
  } catch {
    fail("upload failed: could not connect");
  }
  // A 403 from S3 means the presigned link no longer works: it expired, or it was used.
  if (res.status === 403) fail("upload failed: the upload link expired or was already used. Call dkoder.source.target again for a new one, then run put with the new put_args.");
  if (res.status < 200 || res.status > 299) fail(`upload failed: HTTP ${res.status}`);
  unlinkSync(file);
  const dir = dirname(resolve(file));
  if (basename(dir).startsWith("dkod-src-")) {
    try { rmdirSync(dir); } catch { /* not empty: keep it */ }
  }
  return `{"ok":true,"status":${res.status}}`;
}

const USAGE = 'usage: dkod-pack pack [<folder>] | put <file> <url> ["Name: value"...]';

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "pack" && rest.length <= 1) return pack(rest[0] ?? ".");
  if (cmd === "put" && rest.length >= 2) return put(rest[0], rest[1], rest.slice(2));
  fail(USAGE);
}

main(process.argv.slice(2)).then(
  (line) => { process.stdout.write(`${line}\n`); },
  (err) => {
    process.stderr.write(`${err instanceof Refusal ? err.message : `error: ${err && err.code ? err.code : "unexpected failure"}`}\n`);
    process.exitCode = 1;
  },
);
