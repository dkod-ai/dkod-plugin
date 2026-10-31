#!/usr/bin/env node
// DKO-1020: the DKOD hook for Cursor. The public plugin's Cursor manifest runs it on the events below.
// Claude Code does not use it: it has its own mod and backstop.
//
// DKOD FIRST. Every chat on a computer with the plugin works through DKOD, and that is enforced, not
// asked for: the skill alone loads only when the model thinks of it.
//   sessionStart: the agent gets the DKOD-first steps and the skill's path in its context.
//   preToolUse / beforeShellExecution: until the chat started a DKOD session, a file write, an edit,
//     a delete or a command that changes anything is denied, and the agent is told the DKOD steps.
//     Reading (files, search, read-only commands) stays free, so the agent can look before it starts.
//   beforeMCPExecution: dkoder.session.start marks the chat as a DKOD chat (for 24 hours), and
//     afterMCPExecution takes the mark back when the call failed (no sign-in, a refused app key).
//     dkoder.remove asks the user, because it removes the app from production.
//   In a DKOD chat: git and gh commands that set up or publish a repository are denied.
//   afterFileEdit / afterShellExecution / stop: when files changed after the org's policy checks last
//     ran (dkod-policy.mjs check), the agent is asked once, at the end, to run them.
//
// It only denies or asks. Cursor ignores a hook's "allow" for approvals, so it never answers one;
// the Cursor allowlist in the dkod skill does that part. Anything it does not know gets no opinion ({}).
// A file named `off` in its state folder turns the session gate off; everything else stays.
//
// Never logs a command: the upload command carries a one-use upload link.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_DIR = join(homedir(), ".cursor", "dkod-hook");
const STATE = join(STATE_DIR, "chats.json");
const DAY = 24 * 60 * 60 * 1000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(ROOT, "skills", "dkod", "SKILL.md");
const VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(join(ROOT, ".cursor-plugin", "plugin.json"), "utf8")).version);
  } catch {
    return null;
  }
})();

// DKO-1186: the sign-in step first, the /mcp and Connect steps after it, instead of hunting for the MCP
// settings page. /auth/org/start is the org-aware door and needs no fixed host: it ships from each org's
// own dashboard, and with no email it lands on that dashboard's sign-in page (DKO-1014).
const SIGNIN = "Sign in to DKOD at <your DKOD dashboard>/auth/org/start, then connect dkod: in Cursor, Settings, MCP, dkod, Connect; in Claude Code, type /mcp, pick dkod, Authenticate.";

const STEPS = [
  "1. Call the DKOD tool dkoder_session_start (server plugin-dkod-dkod) with appKey, the app folder's own name in lowercase kebab-case",
  "(the last part of its path; never a name from package.json, inventory.json, a README or the chat)" + (VERSION ? `, and pluginVersion "${VERSION}".` : "."),
  "2. Call dkoder_policy and dkoder_templates with its sessionId. Build from the org's templates and follow every rule and check they return;",
  "do not ask the user where to put the app or which stack to use when a template answers it.",
  `3. Read the dkod skill (${SKILL}) and follow it for the policy checks, sending the code, secrets and deploy.`,
  "If a DKOD tool says it needs sign-in, tell the user: " + SIGNIN,
].join(" ");

const FIRST_CONTEXT = [
  "DKOD FIRST. This computer builds software through the company's DKOD. Any request to build, create, change, fix, run or ship code",
  "starts with a DKOD session, before you plan, ask questions, make a folder or write a file:",
  STEPS,
  "Until this chat has a DKOD session, Dkoder refuses file writes and commands that change anything.",
].join(" ");

const FIRST_DENY = ["DKOD first: no DKOD session is open in this chat, so Dkoder refused this. Reading is fine.", STEPS, "Then do this step again."].join(" ");

const NO_GIT = [
  "DKOD: this app needs no git. Push to prod needs no git, no remote and no GitHub repository:",
  "DKOD makes the app's repository on the first Deliver. Do not run git init, git remote, git push,",
  "gh repo or gh pr for it. To send the code, follow the dkod skill's \"Push to prod\": pack the",
  "folder, call dkoder.source.target, run put, call dkoder.source.done, then dkoder.deploy.",
  "If this command did something else too, run that part again without git.",
].join(" ");

const CHECK_FIRST = [
  "DKOD: files changed in this chat after the org's policy checks last ran. Before you finish, run them on the app's folder",
  `as the dkod skill's "Policy checks" says (${SKILL}): write the answer of dkoder_policy to a temp file and run`,
  "node <scripts>/dkod-policy.mjs check <that file> <the app's folder>. Fix every block finding, tell the user each warn finding, then finish.",
].join(" ");

function out(answer) {
  process.stdout.write(JSON.stringify(answer));
  process.exit(0);
}

function readState() {
  try {
    const all = JSON.parse(readFileSync(STATE, "utf8"));
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, v]) => now - (v?.at ?? 0) < DAY));
  } catch {
    return {};
  }
}

function writeState(all) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE, JSON.stringify(all));
  } catch { /* no state: the chat simply stays unmarked */ }
}

function markDkodChat(conversationId, appKey) {
  if (!conversationId) return;
  const all = readState();
  all[conversationId] = { ...all[conversationId], at: Date.now(), appKey: typeof appKey === "string" ? appKey.slice(0, 80) : null };
  writeState(all);
}

/** Changes one field of a DKOD chat's record. A chat that is not a DKOD chat gets no record. */
function noteChat(conversationId, field) {
  const all = readState();
  if (!conversationId || !all[conversationId]) return;
  all[conversationId][field] = Date.now();
  writeState(all);
}

const isDkodChat = (conversationId) => Boolean(conversationId && readState()[conversationId]);
const gateOff = () => existsSync(join(STATE_DIR, "off"));

/** The command split into top-level parts at unquoted ; & | and newlines; null if it uses $( ` < > . */
function parts(command) {
  const segs = [];
  let cur = "", q = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"') { cur += c + (command[++i] ?? ""); continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "\\") { cur += c + (command[++i] ?? ""); continue; }
    if (c === "`" || c === "<" || c === ">" || (c === "$" && command[i + 1] === "(")) return null;
    if (c === ";" || c === "&" || c === "|" || c === "\n") { if (cur.trim()) segs.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (q) return null;
  if (cur.trim()) segs.push(cur.trim());
  return segs;
}

/**
 * The command with plain file redirections spelled as writes: `cmd > f` becomes `cmd ; tee 'f'`, and
 * `cmd < f`, `2>&1` and `>&2` drop out, because they write no file. null for $( ` <( and heredocs.
 * DKO-1215: `bunx playwright test -c tests/parity/... > ~/report.json` ran the frozen suite and was
 * denied as a write to it, because a redirection made the whole line one unsplit list of words.
 */
function asWrites(command) {
  let out = "", q = null, writes = [];
  const flush = () => {
    for (const t of writes) out += ` ; tee '${t}'`;
    writes = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"') { out += c + (command[++i] ?? ""); continue; }
      out += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    if (c === "\\") { out += c + (command[++i] ?? ""); continue; }
    if (c === "`" || (c === "$" && command[i + 1] === "(")) return null;
    const both = c === "&" && command[i + 1] === ">";
    if (c === ">" || c === "<" || both) {
      if (c === "<" && (command[i + 1] === "<" || command[i + 1] === "(")) return null;
      if (both) i++;
      // `2>`: the number names the stream, it is not a word of the command.
      else if (/(^|\s)\d$/.test(out)) out = out.slice(0, -1);
      if (command[i + 1] === ">" || command[i + 1] === "|") i++;
      let dup = false;
      if (c === ">" && !both && command[i + 1] === "&") { i++; dup = true; }
      while (command[i + 1] === " " || command[i + 1] === "\t") i++;
      let target = "", tq = null;
      while (i + 1 < command.length) {
        const d = command[i + 1];
        if (tq) { i++; if (d === tq) tq = null; else target += d; continue; }
        if (d === "'" || d === '"') { i++; tq = d; continue; }
        if (/[\s;&|<>()`$]/.test(d)) break;
        i++;
        target += d;
      }
      if (tq || target === "" || target.includes("'")) return null;
      // `>&2` and `>&-` point a stream at another one; `>&file` writes the file.
      if ((c === ">" || both) && !(dup && /^(\d+|-)$/.test(target))) writes.push(target);
      out += " ";
      continue;
    }
    if (c === ";" || c === "&" || c === "|" || c === "\n") flush();
    out += c;
  }
  if (q) return null;
  flush();
  return out;
}

/** The top-level parts, with each redirection a `tee` of its file (asWrites). null when that reading is unsure. */
const writeParts = (command) => {
  const plain = asWrites(command);
  return plain === null ? null : parts(plain);
};

/** The words of a part, quotes removed. */
const words = (part) => (part.match(/'[^']*'|"(?:\\.|[^"])*"|\S+/g) ?? []).map((w) => w.replace(/^['"]|['"]$/g, ""));
const noEnv = (w) => w.filter((x) => !/^[A-Z_][A-Z0-9_]*=/.test(x));

/** git or gh that sets up or publishes a repository. */
function gitSetup(command) {
  const segs = parts(command) ?? [command];
  return segs.some((seg) => {
    const w = noEnv(words(seg));
    // Skip "git -C <dir>" and "git -c k=v" before the subcommand.
    let i = 1;
    while (w[0] === "git" && (w[i] === "-C" || w[i] === "-c")) i += 2;
    if (w[0] === "git") return ["init", "remote", "push"].includes(w[i] ?? "");
    if (w[0] === "gh") return ["repo", "pr"].includes(w[1] ?? "");
    return false;
  });
}

const LOOK = new Set(["ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "which", "whereis", "echo", "printf", "env", "date", "uname", "whoami", "file", "stat", "tree", "du", "df", "type", "realpath", "basename", "dirname"]);
const VERSION_ONLY = new Set(["node", "bun", "deno", "python", "python3", "pwsh", "go", "java", "ruby"]);
const GIT_LOOK = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files"]);

/** A command that only looks: every part is a reading program. Anything unsure counts as a change. */
function readOnly(command) {
  const segs = parts(command);
  if (segs === null || segs.length === 0) return false;
  return segs.every((seg) => {
    const w = noEnv(words(seg));
    const [cmd, ...rest] = w;
    if (!cmd) return true;
    if (cmd === "cd") return true;
    if (LOOK.has(cmd)) return true;
    if (cmd === "find") return !rest.some((x) => /^-(delete|exec|execdir|ok|okdir|fprint.*|fls)$/.test(x));
    if (cmd === "command") return rest[0] === "-v";
    if (VERSION_ONLY.has(cmd)) return rest.length === 1 && /^(-v|-V|--version|version)$/.test(rest[0]);
    if (cmd === "git") {
      const [sub, ...flags] = rest;
      if (sub === "branch") return flags.every((x) => ["-a", "-r", "-v", "-vv", "--list", "--show-current"].includes(x));
      if (sub === "config") return flags.some((x) => ["--get", "--list", "-l"].includes(x));
      return GIT_LOOK.has(sub ?? "");
    }
    return false;
  });
}

/** A Cursor tool that writes, edits or deletes a file. Its shell tool goes through beforeShellExecution. */
const WRITES = /^(write|edit|strreplace|str_replace|multiedit|multi_edit|delete|delete_file|apply_patch|applypatch|editnotebook|notebookedit|edit_file|search_replace|write_file|create_file)$/i;
const SHELL = /^(shell|bash|terminal|run_terminal_cmd|run_terminal_command)$/i;

/**
 * DKO-1382: the upload link is a signed credential; on the command line it shows on the agent screen
 * and in the transcript. In every chat. The command is never echoed back.
 */
function denyUploadUrl(command) {
  if (/dkod-pack\.(?:mjs|py|ps1|sh)["']?\s+put\b/i.test(command) && /https?:\/\//i.test(command)) {
    out({
      permission: "deny",
      user_message: "DKOD: the upload link must not be on the command line.",
      agent_message: "Do not put an upload link in a command. Run the same script with: put <archive file> --ticket <upload_ticket>, the upload_ticket dkoder.source.target gave you.",
    });
  }
}

/** DKO-1175: the original app's folder when a migration is open in `dir`, else null. */
function migrationOriginal(dir) {
  return migrationAt(dir)?.original ?? null;
}

/** The original and the folder that holds the record (`dir` itself, or its sibling dk- folder), else null. */
function migrationAt(dir) {
  if (!dir) return null;
  const read = (folder) => {
    try {
      const rec = JSON.parse(readFileSync(join(folder, ".dkod", "migration.json"), "utf8"));
      const original = typeof rec?.original === "string" ? rec.original.replace(/\/+$/, "") : "";
      return original || null;
    } catch {
      return null;
    }
  };
  const here = read(String(dir));
  if (here !== null) return { original: here, folder: String(dir) };
  // DKO-1332: a session whose workspace is the original has no record of its own; the record is in the sibling dk- folder and counts when it names this folder.
  const folder = norm(String(dir));
  const slash = folder.lastIndexOf("/");
  const name = folder.slice(slash + 1);
  if (name === "" || name.startsWith("dk-")) return null;
  const siblingDir = `${folder.slice(0, slash + 1)}dk-${name}`;
  const sibling = read(siblingDir);
  return sibling !== null && norm(sibling) === folder ? { original: sibling, folder: siblingDir } : null;
}

/** DKO-1177: the parity suite's folder when `dkod-migrate.mjs freeze` froze it in `dir`, else null. */
function frozenSuite(dir) {
  if (!dir) return null;
  try {
    readFileSync(join(String(dir), ".dkod", "parity", "freeze.json"), "utf8");
    return join(String(dir), "tests", "parity");
  } catch {
    return null;
  }
}

const parityDeny = () =>
  "The parity suite (tests/parity/) is frozen: its sha256 was reported with the run on the original, and a changed suite would not match it. To change it, run dkod-migrate.mjs unfreeze <folder> and start the attempt again (dkoder.migrate.start).";

/** A posix path with `.`, `..` and duplicate slashes collapsed: the folder the OS writes in. */
function norm(p) {
  const parts = [];
  for (const part of String(p).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      // A root-relative path cannot climb above `/`: the OS clamps there, so `/../w/x` is `/w/x`.
      else if (!String(p).startsWith("/")) parts.push("..");
    } else parts.push(part);
  }
  return (String(p).startsWith("/") ? "/" : "") + parts.join("/");
}

const inside = (folder, p) => {
  if (typeof p !== "string") return false;
  const dir = norm(folder) || "/";
  const path = norm(p);
  return dir === "/" ? path.startsWith("/") : path === dir || path.startsWith(dir + "/");
};
const insideAt = inside;

const migrationDeny = (original) =>
  [
    `The original app at ${original} is read only while a migration is open: you read it, you never change it or its data.`,
    "Build in the dk- app's folder; to run the original's own tests, start it with the snapshot (dkod-migrate.mjs snapshot).",
  ].join(" ");

/** DKO-1345: the record folder's files, except map/, which the agent writes (app-map.json, assets). */
const recordArea = (folder, p) => inside(join(folder, ".dkod"), p) && !inside(join(folder, ".dkod", "map"), p);

const recordDeny = () =>
  "The migration record (.dkod/migration.json) is what keeps the original app read only: leave it as it is. Run dkod-migrate.mjs clean <folder> after the shipped step to close the migration.";

/** The folder the event works in. */
function workDir(input) {
  const cwd = input.cwd ?? (Array.isArray(input.workspace_roots) ? input.workspace_roots[0] : null);
  return typeof cwd === "string" ? cwd : "";
}

const at = (dir, w) => (w.startsWith("/") ? w : join(dir, w));

/** Programs whose arguments name files they change, and the words that make an installer write. */
const WRITERS = new Set(["cp", "mv", "tee", "touch", "mkdir", "rm", "rmdir", "ln", "install", "rsync", "truncate", "chmod", "chown", "dd", "sed", "unzip", "tar", "ditto"]);
const INSTALLERS = new Set(["npm", "yarn", "pnpm", "bun", "pip", "pip3", "poetry", "cargo", "go", "composer"]);
const INSTALL_WORDS = new Set(["install", "i", "add", "ci", "update", "upgrade", "up", "link", "uninstall", "un", "remove", "rm", "prune", "dedupe", "rebuild", "get"]);
const PATH_FLAGS = new Set(["--prefix", "--cwd", "-C", "--dir", "--cd", "--directory", "--manifest-path", "--workspace", "-w"]);
/** Flags that take a value, which is not the subcommand: `pnpm --filter web add x` installs. */
const VALUE_FLAGS = new Set([...PATH_FLAGS, "--filter", "-F", "--registry", "--cache", "--userconfig", "--python", "--target", "--package", "-p", "--loglevel"]);
/**
 * The subcommand is the first word that is not a flag, a flag's value, a `+toolchain` or yarn's
 * `workspace <name>`: `cargo test update` runs tests. pnpm's `-w` takes no value, so `pnpm -w add x` installs.
 */
const runsInstall = (program, args) => {
  if (!INSTALLERS.has(program)) return false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("+")) continue;
    if (a.startsWith("-")) {
      if (VALUE_FLAGS.has(a) && !(a === "-w" && INSTALL_WORDS.has(args[i + 1] ?? ""))) i++;
      continue;
    }
    if (program === "yarn" && a === "workspace") {
      i++;
      continue;
    }
    return INSTALL_WORDS.has(a);
  }
  return program === "yarn";
};

/**
 * Does a changing part of the command name the original app's folder? A `cd` carries to the parts
 * after it, so `cd <original> && rm db` counts as `rm <original>/db`.
 */
function touchesOriginal(original, dir, command, except = null) {
  // DKO-1345: a word or cwd inside `except` (the record folder's map/) does not count.
  const inside = (folder, p) => insideAt(folder, p) && !(except !== null && insideAt(except, p));
  const segs = writeParts(command);
  // $( or a heredoc: the line is not split into commands, and any word that names the original counts.
  if (segs === null) return words(command).some((w) => inside(original, at(dir, w)));
  let here = dir;
  return segs.some((seg) => {
    const w = noEnv(words(seg));
    if (w[0] === "cd") {
      if (typeof w[1] === "string") here = at(here, w[1]);
      return false;
    }
    if (w.length === 0 || readOnly(seg)) return false;
    // tee writes only the files it names: `cd <original> && npm test > /tmp/log` changes nothing there.
    if (w[0] === "tee") return w.slice(1).some((x) => inside(original, at(here, x)));
    // In the original's folder only a program that changes files counts, so its own test suite
    // still runs there.
    if (inside(original, here)) {
      return WRITERS.has(w[0]) || runsInstall(w[0], w.slice(1));
    }
    // The code graph of the original: `dkod-graph.mjs ensure <original> --out <dir>` only reads the
    // original and writes under <dir>, which must be outside it.
    if (graphReadsOnly(w, here, (p) => inside(original, p))) return false;
    return w.some((x) => inside(original, at(here, x.replace(/^--[\w-]+=/, ""))));
  });
}

/** DKO-1427: a direct child of /tmp, /private/tmp or /var/tmp. A `mktemp -d` folder's files are deeper, so they pass. */
const fixedTmp = (path) => /^\/(?:private\/)?(?:tmp|var\/tmp)\/[^/]+\/?$/.test(normalize(path));

/** DKO-1427: curl/wget output files named in one command's words; curl `--output-dir` puts a bare name, or -O, in that folder. */
function downloadFiles(w) {
  const args = w.slice(1);
  const curl = w[0] === "curl";
  const flag = curl ? /^-[a-zA-Z]*o$|^--output$/ : /^-[a-zA-Z]*O$|^--output-document$/;
  const joined = curl ? /^--output=(.+)$|^-o(.+)$/ : /^--output-document=(.+)$|^-O(.+)$/;
  const files = [];
  let outDir = null;
  args.forEach((x, i) => {
    if (curl && x === "--output-dir" && args[i + 1] !== undefined) outDir = args[i + 1];
    const d = /^--output-dir=(.+)$/.exec(x);
    if (curl && d) outDir = d[1];
    if (flag.test(x) && args[i + 1] !== undefined) files.push(args[i + 1]);
    const m = joined.exec(x);
    if (m) files.push(m[1] ?? m[2]);
  });
  if (outDir === null) return files;
  const named = files.map((f) => (f.startsWith("/") ? f : `${outDir}/${f}`));
  // `-O` keeps the remote name, so any file in the folder counts.
  return args.some((x) => /^-[a-zA-Z]*O$|^--remote-name$/.test(x)) ? [...named, `${outDir}/x`] : named;
}

/**
 * DKO-1427: the line is not split into commands ($( or a heredoc), so scan the raw text for the
 * targets after `>`/`>>`, after `tee`, and after curl `-o` / wget `-O`. A word that only reads /tmp/a is free.
 */
function rawTmpWrite(dir, command) {
  const files = [];
  for (const m of command.matchAll(/(?<![<>])>{1,2}(?![>&])\s*["']?([^\s"'|;&<>()$`]+)/g)) files.push(m[1]);
  const all = words(command);
  all.forEach((x, i) => {
    if (x === "tee") {
      for (const y of all.slice(i + 1)) {
        if (/^[|;&<>]/.test(y)) break;
        if (!y.startsWith("-")) files.push(y);
      }
    } else if (x === "curl" || x === "wget") {
      files.push(...downloadFiles(all.slice(i)));
    }
  });
  const hit = files.find((f) => fixedTmp(at(dir, f)));
  return hit ? at(dir, hit) : null;
}

/** DKO-1427: the first file the command writes at a fixed /tmp/<name> (redirect, tee, cp/mv, curl -o, wget -O), else null. */
function tmpWrite(dir, command) {
  const segs = writeParts(command);
  if (segs === null) return rawTmpWrite(dir, command);
  let here = dir;
  for (const seg of segs) {
    const w = noEnv(words(seg));
    if (w[0] === "cd") {
      if (typeof w[1] === "string") here = at(here, w[1]);
      continue;
    }
    const args = w.slice(1);
    const files = [];
    if (["tee", "touch", "truncate"].includes(w[0])) files.push(...args.filter((x) => !x.startsWith("-")));
    else if (["cp", "mv", "install", "ln", "rsync", "ditto"].includes(w[0])) {
      const plain = args.filter((x) => !x.startsWith("-"));
      // The target may be the mktemp -d folder itself (Linux: /tmp/tmp.XXXXXX): copying into it is the normal path.
      // Any direct /tmp child named tmp.<6+ chars> is exempt; `mktemp -d /tmp/foo.XXXXXX` and `cp -t /tmp/x a` are not recognised.
      const target = plain[plain.length - 1];
      if (plain.length > 1 && !/^tmp\.[A-Za-z0-9]{6,}$/.test(normalize(target).replace(/\/$/, "").split("/").pop() ?? "")) files.push(target);
    } else if (w[0] === "curl" || w[0] === "wget") {
      files.push(...downloadFiles(w));
    }
    const hit = files.find((f) => fixedTmp(at(here, f)));
    if (hit) return at(here, hit);
  }
  return null;
}

const TMP_DENY = (path) =>
  `Do not write to the fixed path ${path}: other users of this computer may own it. Run mktemp -d once, keep that folder, and write every scratch file (curl or wget output, saved answers, notes, logs) there.`;

/** `node <scripts>/dkod-graph.mjs ensure <folder> --out <dir>` with <dir> outside the guarded folder. */
function graphReadsOnly(w, here, guarded) {
  const i = w.findIndex((x) => /(^|[\\/])dkod-graph\.mjs$/.test(x));
  if (i < 1 || !/^node(\.exe)?$/.test(String(w[0]).split(/[\\/]/).pop()) || w[i + 1] !== "ensure") return false;
  const o = w.indexOf("--out", i);
  return o > i && typeof w[o + 1] === "string" && !guarded(at(here, w[o + 1]));
}

/** DKO-1177: does a changing part of the command write in the frozen suite? Reading and running it is free. */
function touchesSuite(suite, dir, command) {
  const segs = writeParts(command);
  if (segs === null) return words(command).some((w) => inside(suite, at(dir, w)));
  let here = dir;
  return segs.some((seg) => {
    const w = noEnv(words(seg));
    if (w[0] === "cd") {
      if (typeof w[1] === "string") here = at(here, w[1]);
      return false;
    }
    if (w.length === 0) return false;
    // An installer writes package.json, a lockfile and node_modules in the folder it runs in or is pointed at.
    if (w[0] === "tee") return w.slice(1).some((x) => inside(suite, at(here, x)));
    const installs = runsInstall(w[0], w.slice(1));
    if (!WRITERS.has(w[0]) && !installs) return false;
    return inside(suite, here) || w.slice(1).some((x) => inside(suite, at(here, x.replace(/^--[\w-]+=/, ""))));
  });
}

// DKO-1255: migration.stack, the Claude hook's rule, for a dk-<app> folder: bun and the stack's database only.
// The defaults are the stack's (bun, postgres); the org's migration.yaml is not read here.
const STACK_DENY = new Set(["express"]);
const STACK_ENGINE = "postgres";
const DRIVER_ENGINE = { pg: "postgres", postgres: "postgres", sqlite3: "sqlite", "better-sqlite3": "sqlite", "@libsql/client": "sqlite", mysql: "mysql", mysql2: "mysql", mariadb: "mysql", mongodb: "mongodb", mongoose: "mongodb", mssql: "mssql", oracledb: "oracle" };
const OTHER_LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);
// DKO-1378: these programs are refused in any folder, as a command word (`grep npm README` passes).
const NON_BUN_MANAGERS = new Set(["npm", "npx", "yarn", "pnpm", "corepack"]);
const MANAGER_USER_MESSAGE = "DKOD: use bun, not npm, npx, yarn, pnpm or corepack.";
const managerDeny = (program) => `${program} is not allowed: use bun. bun install installs (it reads any package.json, also one with a yarn or npm lockfile), bun run <script> runs a script, bun test runs the tests, bunx <tool> runs a tool once.`;

/** The program that reads a heredoc: the last command word before `<<`, after env, sudo and the like. */
function heredocReader(before) {
  const seg = before.split(/[;&|]/).pop() ?? "";
  let w = noEnv(words(seg.replace(/^[\s(){}]+/, "")));
  while (w.length > 0 && /^(env|sudo|command|exec|nohup|time|nice)$/.test(w[0].slice(w[0].lastIndexOf("/") + 1))) {
    w = noEnv(w.slice(1)).filter((x, i, all) => !x.startsWith("-") || all.slice(0, i).some((y) => !y.startsWith("-")));
  }
  return w[0] === undefined ? "" : w[0].slice(w[0].lastIndexOf("/") + 1);
}

/** True when a pipe segment after the heredoc marker runs a shell (`cat <<EOF | sudo bash`). */
function pipesIntoShell(after) {
  return after.split("|").slice(1).some((seg) => /^(ba|z|da|k)?sh$/.test(heredocReader(seg.split(/[;&]/)[0])));
}

/**
 * The command without the `<<WORD` markers and heredoc bodies, which are data, not command words;
 * `scripts` holds the bodies that a shell reads (`bash <<EOF`), which are commands.
 */
function stripHeredocs(command) {
  const out = [];
  const scripts = [];
  const data = [];
  let end = null, dash = false, script = null, body = [], head = "";
  for (const line of command.split("\n")) {
    if (end !== null) {
      if ((dash ? line.trim() : line) === end) {
        end = null;
        if (script !== null) scripts.push(script.join("\n"));
        data.push({ head, body: body.join("\n") });
        script = null;
      } else {
        body.push(line);
        if (script !== null) script.push(line);
      }
      continue;
    }
    const m = heredocMarker(line);
    if (m) {
      end = m[3];
      dash = m[1] === "-";
      head = line;
      body = [];
      if (/^(ba|z|da|k)?sh$/.test(heredocReader(line.slice(0, m.index))) || pipesIntoShell(line.slice(m.index))) script = [];
      out.push(line.replace(/<<(?!<)-?\s*(['"]?)[\w.-]+\1/g, " "));
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), scripts, data };
}

/** The first `<<WORD` marker of a line that sits outside quotes, or null. */
function heredocMarker(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"') i++;
    } else if (c === "'" || c === '"') q = c;
    else if (c === "\\") i++;
    else if (line.startsWith("<<", i) && line[i + 2] !== "<") {
      const m = /^<<(-?)\s*(['"]?)([\w.-]+)\2/.exec(line.slice(i));
      if (m) { m.index = i; return m; }
    }
  }
  return null;
}

/** The command split at unquoted ; & | and newlines, also when it holds $( ` or <; a quote that never closes ends the last part. */
function looseParts(command) {
  const segs = [];
  let cur = "", q = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"') { cur += c + (command[++i] ?? ""); continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "\\") { cur += c + (command[++i] ?? ""); continue; }
    if (c === ";" || c === "&" || c === "|" || c === "\n") { if (cur.trim()) segs.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) segs.push(cur.trim());
  return segs;
}

/** The package manager other than bun that a command runs, or null. */
function otherManager(command, depth = 0) {
  if (depth > 3) return null;
  const { text: bare, scripts, data } = stripHeredocs(command);
  for (const s of scripts) {
    const inner = otherManager(s, depth + 1);
    if (inner) return inner;
  }
  // DKO-1413: data written to a Dockerfile, shell script, Makefile or workflow is scanned like a Write.
  for (const d of data) {
    for (const target of redirectTargets(d.head)) {
      const hit = managerFile(target, d.body);
      if (hit) return hit.split(" ")[0];
    }
  }
  for (const seg of looseParts(bare)) {
    const w = words(seg.replace(/^[\s(){}]+/, ""));
    if (!/^(echo|printf)$/.test(w[0] ?? "")) continue;
    for (const target of redirectTargets(seg)) {
      const hit = managerFile(target, w.slice(1).filter((a) => !/^-[en]+$/.test(a) && !/^>>?/.test(a) && a !== target).join(" ").replace(/\\n/g, "\n"));
      if (hit) return hit.split(" ")[0];
    }
  }
  // Last resort: split at unquoted separators only, so a JSON string with `;` in it is one word, and the text of `sh -c '...'` stays.
  const segs = writeParts(bare) ?? parts(bare) ?? looseParts(bare);
  for (const seg of segs) {
    let w = noEnv(words(seg.replace(/^[\s(){}]+|[\s(){}]+$/g, "")));
    // env, sudo, xargs and the like run the next program, after their own flags.
    while (w.length > 0 && /^(env|sudo|command|exec|nohup|time|nice|xargs)$/.test(w[0].slice(w[0].lastIndexOf("/") + 1))) {
      w = noEnv(w.slice(1)).filter((x, i, all) => !x.startsWith("-") || all.slice(0, i).some((y) => !y.startsWith("-")));
    }
    const name = w[0] === undefined ? "" : w[0].slice(w[0].lastIndexOf("/") + 1);
    if (NON_BUN_MANAGERS.has(name)) return name;
    if (/^(ba|z|da|k)?sh$/.test(name)) {
      const c = w.indexOf("-c");
      const inner = c > 0 && typeof w[c + 1] === "string" ? otherManager(w[c + 1], depth + 1) : null;
      if (inner) return inner;
    }
  }
  return null;
}
/** The files a command line writes with `>`, `>>` or `tee`. */
function redirectTargets(line) {
  const found = [];
  for (const m of line.matchAll(/(?<![<\d&])\d?>>?\s*(?!&)(['"]?)([^\s'"<>|;&]+)\1/g)) found.push(m[2]);
  const t = /\btee\s+(?:-\w+\s+)*(['"]?)([^\s'"<>|;&]+)\1/.exec(line);
  if (t) found.push(t[2]);
  return found;
}
const ADD_WORDS = new Set(["install", "i", "add", "ci"]);
const FILE_DATABASE = /\.(?:db|sqlite)$/;
const offStack = (name) => STACK_DENY.has(name) || (DRIVER_ENGINE[name] !== undefined && DRIVER_ENGINE[name] !== STACK_ENGINE);
const stackDeny = (detail) => `A dk- app uses only the stack in migration.yaml: ${detail}. Use bun, and the stack's packages and database (${STACK_ENGINE}).`;

/** Is `p` under a dk- folder? A file needs the folder above it; a folder may be the dk- folder itself. */
function inDkFolder(p, isDir) {
  const segs = norm(p).split("/").filter(Boolean);
  return (isDir ? segs : segs.slice(0, -1)).some((s) => s.startsWith("dk-"));
}

/** The detail of a stack break by writing `target` with `text`, or null. */
function stackFile(target, text) {
  if (!inDkFolder(target, false)) return null;
  const base = norm(target).split("/").pop() ?? "";
  if (OTHER_LOCKFILES.has(base)) return `${base} belongs to a package manager other than bun`;
  if (FILE_DATABASE.test(base)) return `${base} is a file database; the stack uses ${STACK_ENGINE}`;
  if (base !== "package.json") return null;
  for (const m of text.matchAll(/"((?:@[\w.-]+\/)?[\w.-]+)"\s*:/g)) if (offStack(m[1])) return `${m[1]} is not in the stack`;
  const pm = /"packageManager"\s*:\s*"(npm|yarn|pnpm)\b/.exec(text);
  return pm ? `packageManager is not bun` : null;
}

/**
 * The files a write tool targets, and the text it adds (a patch names its files inside). Removed
 * text (old_string, the '-' lines of a patch) is not scanned: taking an off-stack package out is allowed.
 */
function writeTargets(args, dir) {
  const targets = [];
  const texts = [];
  const visit = (v, key) => {
    if (typeof v === "string") {
      if (/^(file_path|notebook_path|path|filePath|filename|target_file)$/.test(key) && v !== "") targets.push(at(dir, v));
      else if (/^(old_string|old_str|oldString|old_text|oldText)$/.test(key)) return;
      else if (/^\*\*\* Begin Patch/m.test(v) || /^\*\*\* (?:Add|Update|Delete) File: /m.test(v)) texts.push(v.split("\n").filter((l) => /^\+(?!\+\+)/.test(l)).map((l) => l.slice(1)).join("\n"));
      else texts.push(v);
      for (const m of v.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)) targets.push(at(dir, m[1].trim()));
    } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  visit(args, "");
  return { targets, text: texts.join("\n") };
}

/** The detail of a stack break in a Write/Edit tool call, or null. */
function stackWrite(args, dir, tool) {
  if (/^delete(_file)?$/i.test(tool)) return null;
  const { targets, text } = writeTargets(args, dir);
  for (const t of targets) {
    const hit = stackFile(t, text);
    if (hit) return hit;
  }
  return null;
}

/** The package manager other than bun that a Write/Edit tool call puts in a build file, or null. */
function managerWrite(args, dir, tool) {
  if (/^delete(_file)?$/i.test(tool)) return null;
  const { targets, text } = writeTargets(args, dir);
  for (const t of targets) {
    const hit = managerFile(t, text);
    if (hit) return hit.split(" ")[0];
  }
  return null;
}

/** DKO-1413: a Dockerfile, shell script, Makefile or CI workflow that runs npm and the like, or null. Other files are data. */
function managerFile(target, text) {
  const p = norm(target);
  const base = p.split("/").pop() ?? "";
  if (!(/^(Dockerfile.*|Makefile|.+[.]sh)$/.test(base) || /(^|\/)[.]github\/workflows\/[^/]+[.]ya?ml$/.test(p))) return null;
  for (const raw of text.split("\n")) {
    let line = raw.trim().replace(/^(?:-\s*)?(?:run:|RUN\b|CMD\b)\s*/, "").replace(/^(?:(?:then|else|elif|if|do|while|until)\s+)+/, "");
    if (line === "" || line.startsWith("#")) continue;
    // Dockerfile exec form: RUN ["npm", "install"].
    if (line.startsWith("[") && line.endsWith("]")) {
      try {
        const arr = JSON.parse(line);
        if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) line = arr.join(" ");
      } catch {}
    }
    const m = otherManager(line);
    if (m) return `${m} in ${base}: use bun`;
  }
  return null;
}

/** The detail of a stack break by a shell command run in `dir`, or null. */
function stackCommand(dir, command) {
  const segs = parts(command) ?? command.split(/[;&|\n]+/).map((s) => s.trim()).filter(Boolean);
  let here = dir;
  for (const seg of segs) {
    const w = noEnv(words(seg));
    if (w[0] === "cd") {
      if (typeof w[1] === "string") here = at(here, w[1]);
      continue;
    }
    const args = w.slice(1);
    const near = inDkFolder(here, true) || args.some((x) => inDkFolder(at(here, x.replace(/^--[\w-]+=/, "")), true));
    if (!near) continue;
    const adds = args.some((x) => ADD_WORDS.has(x));
    if (w[0] === "bun" && adds) {
      const sub = args.findIndex((x) => ADD_WORDS.has(x));
      for (const x of args.slice(sub + 1)) {
        const name = x.startsWith("-") ? "" : x.replace(/(?<=.)@[^/]*$/, "");
        if (name && offStack(name)) return `${name} is not in the stack`;
      }
    }
    if (WRITERS.has(w[0]) && !/^(rm|rmdir)$/.test(w[0]) || segs.length === 1 && /[<>]/.test(seg)) {
      for (const x of args) {
        const hit = stackFile(at(here, x), "");
        if (hit) return hit;
      }
    }
  }
  return null;
}

// DKO-1255: a stack block is reported to Control > What Guard stopped. Route 1: the device token in
// dkoder.json (or DKOD_URL and DKODER_TOKEN). Route 2, with no token: a pending entry that the deny
// message tells the agent to clear by calling dkoder_guard_report. Never a command line or a file body.
const REPORT_TOOL = "dkoder.guard.report";
const PENDING = join(STATE_DIR, "pending.json");

function trustedDashboard(raw) {
  try {
    const url = new URL(String(raw));
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
  } catch { /* not a URL */ }
  return null;
}

/** { dashboardUrl, token } from the env or dkoder.json in the plugin folder, else null. */
function credentials() {
  const url = trustedDashboard(process.env.DKOD_URL);
  if (url && process.env.DKODER_TOKEN) return { dashboardUrl: url, token: process.env.DKODER_TOKEN };
  for (const dir of [process.env.CURSOR_PLUGIN_ROOT, ROOT]) {
    if (!dir) continue;
    try {
      const c = JSON.parse(readFileSync(join(dir, "dkoder.json"), "utf8"));
      const dashboardUrl = trustedDashboard(c?.dashboardUrl);
      if (dashboardUrl && typeof c.token === "string" && c.token) return { dashboardUrl, token: c.token };
    } catch { /* none here: try the next */ }
  }
  return null;
}

const readPending = () => {
  try {
    const now = Date.now();
    return Object.fromEntries(Object.entries(JSON.parse(readFileSync(PENDING, "utf8"))).filter(([, v]) => now - (v?.at ?? 0) < DAY));
  } catch {
    return {};
  }
};
const writePending = (all) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(PENDING, JSON.stringify(all));
  } catch { /* no state: the block is simply not repeated */ }
};

const pendingDeny = (p) =>
  `DKOD: a Guard block in this chat is not reported yet, so Dkoder refused this. Call the DKOD tool dkoder_guard_report (server plugin-dkod-dkod) with ${JSON.stringify({ rule: p.rule, tool: p.tool, action: p.action })}, then do this step again.`;

/** Denies a stack break: reports it by route 1, else keeps it pending for route 2. */
async function blockStack(detail, tool, action, message = stackDeny(detail), rule = "migration-stack", userMessage = "DKOD: this dk- app uses only the stack in migration.yaml.") {
  const name = String(tool || "shell").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64) || "shell";
  let reported = false;
  const creds = credentials();
  if (creds) {
    try {
      const res = await fetch(`${creds.dashboardUrl}/api/v1/dkoder/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "action", action, decision: "blocked", rule, repo: null, tool: name, agent: "cursor", at: new Date().toISOString() }),
        signal: AbortSignal.timeout(3000),
      });
      reported = res.ok;
    } catch { /* offline: fall to route 2 */ }
  }
  let more = "";
  if (!reported && chat) {
    const entry = { at: Date.now(), rule, tool: name, action };
    const all = readPending();
    all[chat] = entry;
    writePending(all);
    more = ` Then report this block: call the DKOD tool dkoder_guard_report (server plugin-dkod-dkod) with ${JSON.stringify({ rule, tool: name, action })}. Until you do, Dkoder refuses further writes.`;
  }
  out({ permission: "deny", user_message: userMessage, agent_message: message + more });
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  out({});
}
const event = input.hook_event_name ?? "";
const chat = input.conversation_id ?? null;

if (event === "sessionStart") out({ additional_context: FIRST_CONTEXT });

if (event === "preToolUse") {
  const tool = String(input.tool_name ?? "");
  if (!isDkodChat(chat) && !gateOff() && WRITES.test(tool)) {
    out({ permission: "deny", user_message: "DKOD: start a DKOD session first. The agent is told how.", agent_message: FIRST_DENY });
  }
  // DKO-1175: while a migration is open, the original app's folder is read only, and so is its record.
  let args = input.tool_input;
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
  const dir = workDir(input);
  const found = migrationAt(dir);
  const original = found?.original ?? null;
  const suite = frozenSuite(dir);
  // DKO-1255: an unreported stack block stops further writes; then the stack check.
  const pending = chat ? readPending()[chat] : undefined;
  const changing = WRITES.test(tool) || (SHELL.test(tool) && !readOnly(String(args?.command ?? "")));
  if (pending && changing) out({ permission: "deny", user_message: "DKOD: report the Guard block first. The agent is told how.", agent_message: pendingDeny(pending) });
  if (WRITES.test(tool)) {
    const hit = stackWrite(args, dir, tool);
    if (hit) await blockStack(hit, tool, "write");
    const manager = managerWrite(args, dir, tool);
    if (manager) await blockStack(manager, tool, "blocked-command", managerDeny(manager), "blocked-command", MANAGER_USER_MESSAGE);
  }
  if (SHELL.test(tool)) {
    const manager = otherManager(String(args?.command ?? ""));
    if (manager) await blockStack(manager, tool, "blocked-command", managerDeny(manager), "blocked-command", MANAGER_USER_MESSAGE);
  }
  if (SHELL.test(tool) && !readOnly(String(args?.command ?? ""))) {
    const hit = stackCommand(dir, String(args?.command ?? ""));
    if (hit) await blockStack(hit, tool, "blocked-command");
  }
  if (isDkodChat(chat) && WRITES.test(tool)) {
    for (const key of ["file_path", "notebook_path", "path", "filePath", "filename", "target_file"]) {
      const value = args?.[key];
      if (typeof value === "string" && value !== "" && fixedTmp(at(dir, value))) {
        out({ permission: "deny", user_message: "DKOD: write scratch files in the mktemp -d folder.", agent_message: TMP_DENY(at(dir, value)) });
      }
    }
  }
  if (suite !== null && WRITES.test(tool)) {
    for (const key of ["file_path", "notebook_path", "path", "filePath", "filename", "target_file"]) {
      const value = args?.[key];
      if (typeof value === "string" && value !== "" && inside(suite, at(dir, value))) {
        out({ permission: "deny", user_message: "DKOD: the parity suite is frozen.", agent_message: parityDeny() });
      }
    }
  }
  if (original !== null && WRITES.test(tool)) {
    for (const key of ["file_path", "notebook_path", "path", "filePath", "filename", "target_file"]) {
      const value = args?.[key];
      if (typeof value !== "string" || value === "") continue;
      const target = at(dir, value);
      // The record's whole folder: `rm -rf .dkod` would take the record with it.
      const deny = inside(original, target) ? migrationDeny(original) : recordArea(found.folder, target) ? recordDeny() : null;
      if (deny !== null) out({ permission: "deny", user_message: "DKOD: the original app is read only while a migration is open.", agent_message: deny });
    }
  }
  // The shell tool: the same two checks, in case this Cursor sends no beforeShellExecution.
  if (SHELL.test(tool)) {
    const command = String(args?.command ?? "");
    denyUploadUrl(command);
    const tmp = isDkodChat(chat) ? tmpWrite(dir, command) : null;
    if (tmp !== null) out({ permission: "deny", user_message: "DKOD: write scratch files in the mktemp -d folder.", agent_message: TMP_DENY(tmp) });
    if (suite !== null && !readOnly(command) && touchesSuite(suite, dir, command)) {
      out({ permission: "deny", user_message: "DKOD: the parity suite is frozen.", agent_message: parityDeny() });
    }
    if (original !== null && !readOnly(command) && touchesOriginal(original, dir, command)) {
      out({ permission: "deny", user_message: "DKOD: the original app is read only while a migration is open.", agent_message: migrationDeny(original) });
    }
    if (original !== null && !readOnly(command) && touchesOriginal(join(found.folder, ".dkod"), dir, command, join(found.folder, ".dkod", "map"))) {
      out({ permission: "deny", user_message: "DKOD: the original app is read only while a migration is open.", agent_message: recordDeny() });
    }
    if (!isDkodChat(chat) && !gateOff() && !readOnly(command)) out({ permission: "deny", user_message: "DKOD: start a DKOD session first. The agent is told how.", agent_message: FIRST_DENY });
  }
  out({});
}

if (event === "afterFileEdit") { noteChat(chat, "editedAt"); out({}); }

if (event === "afterShellExecution") {
  if (/dkod-policy\.mjs["']?\s+check\b/.test(String(input.command ?? ""))) noteChat(chat, "checkedAt");
  out({});
}

if (event === "stop") {
  const rec = chat ? readState()[chat] : undefined;
  const status = input.status ?? "completed";
  if (rec && status === "completed" && (rec.editedAt ?? 0) > (rec.checkedAt ?? 0) && (rec.askedAt ?? 0) < rec.editedAt) {
    noteChat(chat, "askedAt");
    out({ followup_message: CHECK_FIRST });
  }
  out({});
}

if (event === "afterMCPExecution") {
  const tool = String(input.tool_name ?? "").replace(/_/g, ".");
  const result = String(input.result_json ?? "");
  // The mark from before the call is taken back when the call did not open a session.
  if (tool === "dkoder.session.start" && chat && (/"isError"\s*:\s*true/.test(result) || !/\\?"id\\?"\s*:/.test(result))) {
    const all = readState();
    if (all[chat] && !all[chat].editedAt) {
      delete all[chat];
      writeState(all);
    }
  }
  out({});
}

if (event === "beforeMCPExecution" || (event === "" && "tool_name" in input)) {
  const server = `${input.mcp_server_name ?? ""} ${input.mcp_server_url ?? input.url ?? ""}`;
  if (!/\/api\/v1\/dkoder\/mcp\b/.test(server) && !/(^|[-\s])dkod($|[-\s])/.test(server)) out({});
  const tool = String(input.tool_name ?? "").replace(/_/g, ".");
  // DKO-1255: the agent reports the block itself, so the pending entry is done.
  if (tool === REPORT_TOOL && chat) {
    const all = readPending();
    if (all[chat]) {
      delete all[chat];
      writePending(all);
    }
  }
  if (tool === "dkoder.remove") {
    out({ permission: "ask", user_message: "DKOD: this removes the app from production. Allow only if you asked for that." });
  }
  if (tool === "dkoder.session.start") {
    // tool_input comes as an object or as JSON text.
    let args = input.tool_input;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
    markDkodChat(chat, args?.appKey);
  }
  out({});
}

if (event === "beforeShellExecution" || (event === "" && "command" in input)) {
  const command = String(input.command ?? "");
  denyUploadUrl(command);
  // DKO-1175: while a migration is open, a command that changes the original app, or its data, is denied.
  const dir = workDir(input);
  const found = migrationAt(dir);
  const original = found?.original ?? null;
  const suite = frozenSuite(dir);
  const tmp = isDkodChat(chat) ? tmpWrite(dir, command) : null;
  if (tmp !== null) out({ permission: "deny", user_message: "DKOD: write scratch files in the mktemp -d folder.", agent_message: TMP_DENY(tmp) });
  // DKO-1255: an unreported stack block stops further changing commands; then the stack check.
  const pending = chat ? readPending()[chat] : undefined;
  if (pending && !readOnly(command)) out({ permission: "deny", user_message: "DKOD: report the Guard block first. The agent is told how.", agent_message: pendingDeny(pending) });
  const manager = otherManager(command);
  if (manager) await blockStack(manager, "Shell", "blocked-command", managerDeny(manager), "blocked-command", MANAGER_USER_MESSAGE);
  if (!readOnly(command)) {
    const hit = stackCommand(dir, command);
    if (hit) await blockStack(hit, "Shell", "blocked-command");
  }
  if (suite !== null && !readOnly(command) && touchesSuite(suite, dir, command)) {
    out({ permission: "deny", user_message: "DKOD: the parity suite is frozen.", agent_message: parityDeny() });
  }
  if (original !== null && !readOnly(command)) {
    if (touchesOriginal(original, dir, command)) {
      out({ permission: "deny", user_message: "DKOD: the original app is read only while a migration is open.", agent_message: migrationDeny(original) });
    }
    // The record is the switch that keeps the original read only: removing it, or its folder, is denied too.
    if (touchesOriginal(join(found.folder, ".dkod"), dir, command, join(found.folder, ".dkod", "map"))) {
      out({ permission: "deny", user_message: "DKOD: the original app is read only while a migration is open.", agent_message: recordDeny() });
    }
  }
  if (isDkodChat(chat)) {
    if (gitSetup(command)) out({ permission: "deny", user_message: "DKOD blocked git setup for this app: DKOD makes the repository itself.", agent_message: NO_GIT });
    out({});
  }
  if (event !== "" && !gateOff() && !readOnly(command)) {
    out({ permission: "deny", user_message: "DKOD: start a DKOD session first. The agent is told how.", agent_message: FIRST_DENY });
  }
  out({});
}

out({});
