#!/usr/bin/env node
// dkod-graph: the code graph of a project, made by graphify (https://github.com/Graphify-Labs/graphify) on this
// computer. The agent then asks the graph (graphify query, explain, path) instead of reading file after file:
// fewer tokens and a faster map, above all when it migrates an app to a dk- app.
//
//   node dkod-graph.mjs ensure <project> [--out <dir>] [--no-install]
//   node dkod-graph.mjs query "<question>" <graph.json>
//   node dkod-graph.mjs explain "<name>" <graph.json>
//   node dkod-graph.mjs path "<A>" "<B>" <graph.json>
//
// It installs graphify when it is missing (uv tool install graphifyy, else pipx), then builds or refreshes the
// graph. Only the code is read, by graphify's local parser: GRAPHIFY_BACKEND=none and --code-only, so no file
// of the project goes to any AI service. With --out the graph goes to <dir>/graphify-out and nothing is written
// in <project> (a migration's original is read only). Without it the graph goes to <project>/graphify-out, and
// that folder is added to <project>/.gitignore. The pack scripts never send graphify-out.
// Every graphify run here is local only, whatever the computer's settings (checked with every network call
// and child process traced, and with the network blocked): no AI backend (GRAPHIFY_BACKEND=none, and no AI
// key or endpoint passed on, so graphify cannot pick one by itself), no query log, no tips, no skill refresh.
// graphify has no telemetry; only installing it (uv or pipx, from PyPI) uses the network.
// ensure prints one JSON line. Exit 0: the graph is ready. Exit 1: graphify failed. Exit 2: graphify is missing and
// could not be installed (the line says how to install it).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const GRAPHIFY_PACKAGE = "graphifyy";
const INSTALL_HINT = "Install uv (https://docs.astral.sh/uv/getting-started/installation/), then run: uv tool install graphifyy";

function out(result, code) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(code);
}

function usage() {
  process.stderr.write('usage: node dkod-graph.mjs ensure <project> [--out <dir>] [--no-install]\n       node dkod-graph.mjs query "<question>" <graph.json> | explain "<name>" <graph.json> | path "<A>" "<B>" <graph.json>\n');
  process.exit(64);
}

// uv and pipx put tools in ~/.local/bin, which a fresh shell may not have on its PATH yet.
const PATH = [process.env.PATH ?? "", join(homedir(), ".local", "bin")].join(delimiter);
// The settings graphify reads that could reach an AI service: an AI key or endpoint makes graphify pick that
// backend by itself, and the query log writes every question to a file. None is passed on.
const DROP = /(^(ANTHROPIC|OPENAI|AZURE_OPENAI|GEMINI|GOOGLE|MOONSHOT|KIMI|DEEPSEEK|OLLAMA|MISTRAL|GROQ|OPENROUTER|BEDROCK)_)|(^AWS_)|(^GRAPHIFY_)|(_API_KEY$)/;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !DROP.test(k)));
Object.assign(env, {
  PATH,
  GRAPHIFY_BACKEND: "none",
  GRAPHIFY_QUERY_LOG_DISABLE: "1",
  GRAPHIFY_NO_CTA: "1",
  GRAPHIFY_NO_TIPS: "1",
  GRAPHIFY_NO_AUTO_REFRESH: "1",
});

function run(cmd, args, timeout = 15 * 60 * 1000) {
  const r = spawnSync(cmd, args, { env, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

function graphifyVersion() {
  const r = run("graphify", ["--version"], 60 * 1000);
  if (!r.ok) return null;
  return (r.stdout.match(/\d+\.\d+\.\d+/) ?? [r.stdout.trim()])[0];
}

function lastLine(text) {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.at(-1) ?? "";
}

function install() {
  for (const [cmd, args] of [["uv", ["tool", "install", GRAPHIFY_PACKAGE]], ["pipx", ["install", GRAPHIFY_PACKAGE]]]) {
    if (!run(cmd, ["--version"], 60 * 1000).ok) continue;
    const r = run(cmd, args, 10 * 60 * 1000);
    if (r.ok || /already installed/i.test(r.stdout + r.stderr)) return `${cmd} ${args.join(" ")}`;
  }
  return null;
}

function ignoreInProject(project) {
  const file = join(project, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/^\/?graphify-out\/?\s*$/m.test(text)) return false;
  if (text === "") writeFileSync(file, "graphify-out/\n");
  else appendFileSync(file, `${text.endsWith("\n") ? "" : "\n"}graphify-out/\n`);
  return true;
}

const [command, target, ...rest] = process.argv.slice(2);
// The questions to the graph, with the same local-only settings. graphify's answer is printed as it is.
const ASK = { query: 1, explain: 1, path: 2 };
if (command in ASK) {
  const terms = [target, ...rest];
  if (terms.length !== ASK[command] + 1 || terms.some((t) => !t)) usage();
  const graphFile = resolve(terms.at(-1));
  if (!existsSync(graphFile)) {
    process.stderr.write(`No graph at ${graphFile}. Run: node dkod-graph.mjs ensure <project>\n`);
    process.exit(1);
  }
  if (graphifyVersion() === null) {
    process.stderr.write(`graphify is not installed. ${INSTALL_HINT}\n`);
    process.exit(2);
  }
  const r = spawnSync("graphify", [command, ...terms.slice(0, -1), "--graph", graphFile], { env, stdio: "inherit", timeout: 5 * 60 * 1000 });
  process.exit(r.status ?? 1);
}
if (command !== "ensure" || !target) usage();
let outDir = null;
let mayInstall = true;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--out" && rest[i + 1]) outDir = resolve(rest[++i]);
  else if (rest[i] === "--no-install") mayInstall = false;
  else usage();
}
const project = resolve(target);
if (!existsSync(project) || !statSync(project).isDirectory()) out({ ok: false, reason: `${project} is not a folder` }, 1);

let installed = null;
let version = graphifyVersion();
if (version === null && mayInstall) {
  installed = install();
  version = graphifyVersion();
}
if (version === null) {
  const reason = mayInstall ? "graphify is not installed, and neither uv nor pipx could install it." : "graphify is not installed.";
  out({ ok: false, graphify: "missing", reason, install: INSTALL_HINT }, 2);
}

const base = outDir ?? project;
const graphDir = join(base, "graphify-out");
const graph = join(graphDir, "graph.json");
const extract = run("graphify", ["extract", project, "--code-only", "--out", base]);
if (!extract.ok || !existsSync(graph)) {
  out({ ok: false, graphify: version, reason: `graphify extract failed: ${lastLine(extract.stderr || extract.stdout) || extract.error?.message || "no graph.json"}` }, 1);
}
// The report and the communities, with no AI call (--no-label) and no HTML (--no-viz).
const cluster = run("graphify", ["cluster-only", project, "--graph", graph, "--no-viz", "--no-label"]);
const ignored = outDir === null ? ignoreInProject(project) : false;

let nodes = null;
let edges = null;
try {
  const g = JSON.parse(readFileSync(graph, "utf8"));
  nodes = Array.isArray(g.nodes) ? g.nodes.length : null;
  edges = Array.isArray(g.links) ? g.links.length : Array.isArray(g.edges) ? g.edges.length : null;
} catch {
  // The counts are a courtesy; the graph itself was written.
}
const report = join(graphDir, "GRAPH_REPORT.md");
out({
  ok: true,
  graphify: version,
  installed,
  graph,
  report: existsSync(report) ? report : null,
  report_note: cluster.ok ? undefined : `graphify cluster-only failed: ${lastLine(cluster.stderr || cluster.stdout)}`,
  nodes,
  edges,
  gitignore_added: ignored,
  ask: [
    `node ${process.argv[1]} query "<question>" ${graph}`,
    `node ${process.argv[1]} explain "<name>" ${graph}`,
    `node ${process.argv[1]} path "<A>" "<B>" ${graph}`,
  ],
}, 0);
