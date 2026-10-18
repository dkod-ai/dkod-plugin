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
import { dirname, join } from "node:path";
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

const STEPS = [
  "1. Call the DKOD tool dkoder_session_start (server plugin-dkod-dkod) with appKey, the app's short name in lowercase kebab-case",
  "(the name the user gave, else this folder's name)" + (VERSION ? `, and pluginVersion "${VERSION}".` : "."),
  "2. Call dkoder_policy and dkoder_templates with its sessionId. Build from the org's templates and follow every rule and check they return;",
  "do not ask the user where to put the app or which stack to use when a template answers it.",
  `3. Read the dkod skill (${SKILL}) and follow it for the policy checks, sending the code, secrets and deploy.`,
  "If a DKOD tool says it needs sign-in, tell the user: Cursor Settings, MCP, dkod, Connect.",
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
const VERSION_ONLY = new Set(["node", "bun", "deno", "python", "python3", "pwsh", "npm", "go", "java", "ruby"]);
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
  // The shell tool: the same gate, in case this Cursor sends no beforeShellExecution.
  if (!isDkodChat(chat) && !gateOff() && SHELL.test(tool)) {
    let args = input.tool_input;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
    const command = String(args?.command ?? "");
    if (!readOnly(command)) out({ permission: "deny", user_message: "DKOD: start a DKOD session first. The agent is told how.", agent_message: FIRST_DENY });
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
