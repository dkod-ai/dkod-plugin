// Built by packages/dkoder-plugin/scripts/build-policy.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:policy`.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

var POLICY_LEVELS = ["block", "warn", "off"];
var CHECK_IDS = [
  "dockerfile.from_digest",
  "dockerfile.numeric_user",
  "image.no_moving_tag",
  "k8s.probes",
  "k8s.resources",
  "k8s.security_context",
  "k8s.rbac_no_wildcards",
  "k8s.labels",
  "file.exists",
  "content.forbid",
  "content.require",
  "secrets.none",
  "tls.no_insecure",
  "version.semver",
  "commit.conventional"
];
var MAX_PATTERN_LENGTH = 200;
var MAX_UNBOUNDED = 4;
var MAX_LINE_LENGTH = 2000;
function patternProblems(pattern, flags = "") {
  const problems = [];
  if (pattern.length === 0)
    problems.push("the pattern is empty");
  if (pattern.length > MAX_PATTERN_LENGTH)
    problems.push(`the pattern is longer than ${MAX_PATTERN_LENGTH} characters`);
  if (!/^i?$/.test(flags))
    problems.push('the only flag allowed is "i"');
  if (/\\[1-9]|\\k</.test(pattern))
    problems.push("back-references are not allowed");
  if (problems.length > 0)
    return problems;
  try {
    new RegExp(pattern, flags);
  } catch (err) {
    return [`the pattern does not compile: ${err.message}`];
  }
  const stack = [{ risky: false }];
  let unbounded = 0;
  let i = 0;
  const isQuant = (at) => {
    const c = pattern[at];
    if (c === "*" || c === "+" || c === "?")
      return true;
    return c === "{" && /^\{\d+(,\d*)?\}/.test(pattern.slice(at));
  };
  const unboundedAt = (at) => {
    const c = pattern[at];
    if (c === "*" || c === "+")
      return true;
    return c === "{" && /^\{\d+,\}/.test(pattern.slice(at));
  };
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "[") {
      i += 1;
      while (i < pattern.length && pattern[i] !== "]")
        i += pattern[i] === "\\" ? 2 : 1;
      i += 1;
    } else if (c === "(") {
      stack.push({ risky: false });
      i += 1;
      if (pattern[i] === "?") {
        const next = pattern[i + 1];
        if (next === "<" && (pattern[i + 2] === "=" || pattern[i + 2] === "!"))
          i += 3;
        else if (next === "<")
          i = pattern.indexOf(">", i) + 1 || pattern.length;
        else
          i += 2;
      }
      continue;
    } else if (c === ")") {
      const inner = stack.pop() ?? { risky: false };
      i += 1;
      if (isQuant(i)) {
        if (inner.risky) {
          problems.push("a repeated group may not contain another repeat or a choice (|), because it can backtrack without end");
          break;
        }
        stack[stack.length - 1].risky = true;
      } else if (inner.risky) {
        stack[stack.length - 1].risky = true;
      }
      continue;
    } else if (c === "|") {
      stack[stack.length - 1].risky = true;
      i += 1;
      continue;
    } else {
      i += 1;
    }
    if (isQuant(i)) {
      stack[stack.length - 1].risky = true;
      if (unboundedAt(i))
        unbounded += 1;
    }
  }
  if (unbounded > MAX_UNBOUNDED)
    problems.push(`the pattern has more than ${MAX_UNBOUNDED} open-ended repeats (*, +)`);
  return problems;
}
function compileSafe(pattern, flags = "") {
  return patternProblems(pattern, flags).length === 0 ? new RegExp(pattern, flags) : null;
}

var cache = new Map;
function escapeChar(c) {
  return /[\\^$.|+()[\]{}*?]/.test(c) ? `\\${c}` : c;
}
function globToRegExp(glob) {
  const hit = cache.get(glob);
  if (hit)
    return hit;
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      out += "[^/]";
      i += 1;
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        out += "\\{";
        i += 1;
      } else {
        const words = glob.slice(i + 1, end).split(",").map((w) => [...w].map(escapeChar).join(""));
        out += `(?:${words.join("|")})`;
        i = end + 1;
      }
    } else {
      out += escapeChar(c);
      i += 1;
    }
  }
  const re = new RegExp(`^${out}$`);
  if (cache.size > 500)
    cache.clear();
  cache.set(glob, re);
  return re;
}
function matchGlob(glob, path) {
  const target = glob.includes("/") ? path : path.split("/").pop() ?? path;
  return globToRegExp(glob).test(target);
}
function matchAny(globs, path) {
  return globs.some((g) => matchGlob(g, path));
}
var ALWAYS_SKIPPED = ["**/node_modules/**", "node_modules/**", ".git/**", "**/.git/**", "**/vendor/**", "vendor/**"];

function yamlDocs(text) {
  const lines = text.split(/\r?\n/);
  const docs = [];
  let start = 0;
  const flush = (end) => {
    if (end <= start)
      return;
    const body = lines.slice(start, end);
    let kind = null;
    let kindLine = start + 1;
    for (let i = 0;i < body.length; i++) {
      const m = /^kind:\s*["']?([A-Za-z]+)/.exec(body[i]);
      if (m) {
        kind = m[1];
        kindLine = start + i + 1;
        break;
      }
    }
    docs.push({ text: body.join(`
`), startLine: start + 1, kind, kindLine });
  };
  for (let i = 0;i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      flush(i);
      start = i + 1;
    }
  }
  flush(lines.length);
  return docs;
}
function lineIn(doc, re) {
  const lines = doc.text.split(`
`);
  for (let i = 0;i < lines.length; i++)
    if (re.test(lines[i]))
      return doc.startLine + i;
  return null;
}
function templatedKey(doc, key) {
  const lines = doc.text.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    if (!new RegExp(`^\\s*${key}:`).test(lines[i]))
      continue;
    if (lines[i].includes("{{"))
      return true;
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    if (next !== undefined && next.trim().startsWith("{{"))
      return true;
  }
  return false;
}
function dockerInstructions(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const first = lines[i];
    const startLine = i + 1;
    if (/^\s*(#|$)/.test(first)) {
      i += 1;
      continue;
    }
    let joined = first;
    while (/\\\s*$/.test(joined) && i + 1 < lines.length) {
      joined = joined.replace(/\\\s*$/, " ") + lines[i + 1];
      i += 1;
    }
    i += 1;
    const m = /^\s*([A-Za-z]+)\s*(.*)$/.exec(joined);
    if (m)
      out.push({ op: m[1].toUpperCase(), args: m[2].trim(), line: startLine });
  }
  return out;
}
function fromLines(instructions) {
  const out = [];
  for (const ins of instructions) {
    if (ins.op !== "FROM")
      continue;
    const words = ins.args.split(/\s+/).filter((w) => w !== "" && !w.startsWith("--"));
    const image = words[0] ?? "";
    const asAt = words.findIndex((w) => w.toUpperCase() === "AS");
    out.push({ image, alias: asAt >= 0 ? words[asAt + 1] ?? null : null, line: ins.line });
  }
  return out;
}
function imageTag(ref) {
  const digest = ref.includes("@sha256:");
  const name = ref.split("@")[0];
  const slash = name.lastIndexOf("/");
  const colon = name.indexOf(":", slash + 1);
  if (colon === -1)
    return { tag: "latest", implicit: true, digest };
  return { tag: name.slice(colon + 1), implicit: false, digest };
}

var DOCKERFILES = ["Dockerfile", "Dockerfile.*", "*.Dockerfile", "*.dockerfile"];
var YAML = ["*.yaml", "*.yml"];
var TESTS = ["**/test/**", "**/tests/**", "**/__tests__/**", "**/fixtures/**", "*.test.*", "*.spec.*", "*_test.go", "test_*.py"];
var SOURCE = ["*.{ts,tsx,js,jsx,mjs,cjs,py,go,rb,java,kt,rs,php,cs,swift,scala}"];
var CONFIG = ["*.{yaml,yml,json,toml,ini,conf,properties}", ".env.example", "Dockerfile", "Dockerfile.*"];
var LONG_RUNNING = new Set(["Deployment", "StatefulSet", "DaemonSet"]);
var WORKLOADS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod", "ReplicaSet"]);
function stringList(params, key) {
  const v = params[key];
  if (v === undefined)
    return null;
  if (!Array.isArray(v))
    return null;
  return v.filter((x) => typeof x === "string");
}
function listProblems(params, key, opts = {}) {
  const v = params[key];
  if (v === undefined)
    return opts.required ? [`"${key}" is required`] : [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length === 0 || x.length > 200))
    return [`"${key}" must be a list of short strings`];
  if (v.length > (opts.max ?? 32))
    return [`"${key}" may hold at most ${opts.max ?? 32} entries`];
  if (opts.required && v.length === 0)
    return [`"${key}" must not be empty`];
  return [];
}
function patternParam(params) {
  const p = params.pattern;
  if (typeof p !== "string")
    return ['"pattern" is required and must be a string'];
  const flags = params.flags === undefined ? "" : params.flags;
  if (typeof flags !== "string")
    return ['"flags" must be a string'];
  return patternProblems(p, flags).map((x) => `"pattern": ${x}`);
}
function lines(text) {
  return text.split(/\r?\n/).map((l) => l.length > MAX_LINE_LENGTH ? l.slice(0, MAX_LINE_LENGTH) : l);
}
function workloadDocs(file, kinds) {
  return yamlDocs(file.text).filter((d) => d.kind !== null && kinds.has(d.kind));
}
var DEFAULT_MOVING_TAGS = ["latest", "main", "master", "stable", "edge", "nightly"];
var CATALOG = {
  "dockerfile.from_digest": {
    id: "dockerfile.from_digest",
    scope: "file",
    title: "Base images pinned by digest",
    summary: "Every FROM line names its image with @sha256:<digest>.",
    paths: DOCKERFILES,
    exclude: [],
    params: [],
    validate: () => [],
    runFile(file) {
      const froms = fromLines(dockerInstructions(file.text));
      const aliases = new Set;
      const hits = [];
      for (const f of froms) {
        const image = f.image;
        const isStage = aliases.has(image.toLowerCase());
        if (f.alias)
          aliases.add(f.alias.toLowerCase());
        if (isStage || image === "" || image.toLowerCase() === "scratch" || image.includes("$"))
          continue;
        if (!/@sha256:[0-9a-f]{64}\b/.test(image))
          hits.push({ path: file.path, line: f.line, detail: `FROM ${image} is not pinned by digest` });
      }
      return hits;
    }
  },
  "dockerfile.numeric_user": {
    id: "dockerfile.numeric_user",
    scope: "file",
    title: "Image runs as a numeric non-root user",
    summary: "The final stage sets USER to a numeric UID that is not 0.",
    paths: DOCKERFILES,
    exclude: [],
    params: [],
    validate: () => [],
    runFile(file) {
      const ins = dockerInstructions(file.text);
      let lastFrom = -1;
      for (let i = 0;i < ins.length; i++)
        if (ins[i].op === "FROM")
          lastFrom = i;
      if (lastFrom === -1)
        return [];
      const users = ins.slice(lastFrom).filter((x) => x.op === "USER");
      const last = users[users.length - 1];
      if (!last)
        return [{ path: file.path, line: ins[lastFrom].line, detail: "the final stage sets no USER, so it runs as root" }];
      const uid = last.args.split(":")[0].trim();
      if (!/^\d+$/.test(uid))
        return [{ path: file.path, line: last.line, detail: `USER ${last.args} is not a numeric UID` }];
      if (Number(uid) === 0)
        return [{ path: file.path, line: last.line, detail: "USER 0 is root" }];
      return [];
    }
  },
  "image.no_moving_tag": {
    id: "image.no_moving_tag",
    scope: "file",
    title: "No moving image tags",
    summary: "No image is referenced by a tag that moves, such as latest, or by no tag at all.",
    paths: [...YAML, ...DOCKERFILES],
    exclude: [],
    params: [{ name: "tags", kind: "strings", hint: "Tags that move. Default: latest, main, master, stable, edge, nightly." }],
    validate: (p) => listProblems(p, "tags"),
    runFile(file, params) {
      const moving = new Set((stringList(params, "tags") ?? DEFAULT_MOVING_TAGS).map((t) => t.toLowerCase()));
      const hits = [];
      const judge = (ref, line) => {
        if (ref === "" || ref.includes("{{") || ref.includes("$"))
          return;
        const t = imageTag(ref);
        if (t.digest)
          return;
        if (moving.has(t.tag.toLowerCase()))
          hits.push({ path: file.path, line, detail: t.implicit ? `image ${ref} has no tag, which means latest` : `image ${ref} uses the moving tag "${t.tag}"` });
      };
      const isDocker = matchAny(DOCKERFILES, file.path);
      if (isDocker) {
        const ins = dockerInstructions(file.text);
        const aliases = new Set;
        for (const f of fromLines(ins)) {
          const stage = aliases.has(f.image.toLowerCase());
          if (f.alias)
            aliases.add(f.alias.toLowerCase());
          if (!stage && f.image.toLowerCase() !== "scratch")
            judge(f.image, f.line);
        }
        return hits;
      }
      const ls = lines(file.text);
      for (let i = 0;i < ls.length; i++) {
        const l = ls[i];
        const img = /^\s*(?:-\s+)?image:\s*["']?([^"'\s#]+)/.exec(l);
        if (img)
          judge(img[1], i + 1);
        const tag = /^\s*tag:\s*["']?([^"'\s#]+)/.exec(l);
        if (tag && moving.has(tag[1].toLowerCase()))
          hits.push({ path: file.path, line: i + 1, detail: `tag: ${tag[1]} is a moving tag` });
      }
      return hits;
    }
  },
  "k8s.probes": {
    id: "k8s.probes",
    scope: "file",
    title: "Health probes on long-running workloads",
    summary: "Every Deployment, StatefulSet and DaemonSet sets the required probes. Jobs are exempt.",
    paths: YAML,
    exclude: [],
    params: [{ name: "require", kind: "strings", hint: "Default: readinessProbe, livenessProbe, startupProbe." }],
    validate: (p) => listProblems(p, "require"),
    runFile(file, params) {
      const need = stringList(params, "require") ?? ["readinessProbe", "livenessProbe", "startupProbe"];
      const hits = [];
      for (const d of workloadDocs(file, LONG_RUNNING)) {
        const missing = need.filter((k) => !d.text.includes(k));
        if (missing.length > 0)
          hits.push({ path: file.path, line: d.kindLine, detail: `${d.kind} has no ${missing.join(", ")}` });
      }
      return hits;
    }
  },
  "k8s.resources": {
    id: "k8s.resources",
    scope: "file",
    title: "Resource requests and memory limit",
    summary: "Every workload declares requests.cpu, requests.memory and limits.memory.",
    paths: YAML,
    exclude: [],
    params: [],
    validate: () => [],
    runFile(file) {
      const hits = [];
      for (const d of workloadDocs(file, WORKLOADS)) {
        if (templatedKey(d, "resources"))
          continue;
        if (!/^\s*resources:/m.test(d.text)) {
          hits.push({ path: file.path, line: d.kindLine, detail: `${d.kind} declares no resources` });
          continue;
        }
        const missing = [];
        const requests = /^\s*requests:/m.test(d.text);
        const limits = /^\s*limits:/m.test(d.text);
        const memories = (d.text.match(/^\s*memory:/gm) ?? []).length;
        if (!requests)
          missing.push("requests.cpu", "requests.memory");
        else if (!/^\s*cpu:/m.test(d.text))
          missing.push("requests.cpu");
        if (!limits)
          missing.push("limits.memory");
        if (requests && limits && memories < 2)
          missing.push("requests.memory or limits.memory");
        if (requests && !limits && memories < 1)
          missing.push("requests.memory");
        if (missing.length > 0)
          hits.push({ path: file.path, line: lineIn(d, /^\s*resources:/) ?? d.kindLine, detail: `${d.kind} resources miss ${missing.join(", ")}` });
      }
      return hits;
    }
  },
  "k8s.security_context": {
    id: "k8s.security_context",
    scope: "file",
    title: "Locked-down security context",
    summary: "Workloads run as non-root, drop ALL capabilities, use a read-only root filesystem, and never ask for privileged mode or host namespaces.",
    paths: YAML,
    exclude: [],
    params: [],
    validate: () => [],
    runFile(file) {
      const hits = [];
      for (const d of workloadDocs(file, WORKLOADS)) {
        const bad = [
          [/^\s*privileged:\s*true\b/, "privileged: true"],
          [/^\s*host(?:Network|PID|IPC):\s*true\b/, "a host namespace"],
          [/^\s*runAsUser:\s*0\b/, "runAsUser: 0"],
          [/^\s*allowPrivilegeEscalation:\s*true\b/, "allowPrivilegeEscalation: true"]
        ];
        for (const [re, what] of bad) {
          const line = lineIn(d, re);
          if (line !== null)
            hits.push({ path: file.path, line, detail: `${d.kind} asks for ${what}` });
        }
        if (templatedKey(d, "securityContext"))
          continue;
        const missing = [];
        if (!/^\s*runAsNonRoot:\s*true\b/m.test(d.text))
          missing.push("runAsNonRoot: true");
        if (!/^\s*readOnlyRootFilesystem:\s*true\b/m.test(d.text))
          missing.push("readOnlyRootFilesystem: true");
        if (!/drop:[^\n]*\bALL\b|drop:\s*\n\s*-\s*["']?ALL\b/.test(d.text))
          missing.push("capabilities.drop: [ALL]");
        if (missing.length > 0)
          hits.push({ path: file.path, line: d.kindLine, detail: `${d.kind} does not set ${missing.join(", ")}` });
      }
      return hits;
    }
  },
  "k8s.rbac_no_wildcards": {
    id: "k8s.rbac_no_wildcards",
    scope: "file",
    title: "No RBAC wildcards or cluster-admin",
    summary: 'No Role or ClusterRole grants "*", and nothing binds cluster-admin.',
    paths: YAML,
    exclude: [],
    params: [],
    validate: () => [],
    runFile(file) {
      const hits = [];
      for (const d of yamlDocs(file.text)) {
        if (d.kind === "Role" || d.kind === "ClusterRole") {
          const ls = d.text.split(`
`);
          for (let i = 0;i < ls.length; i++) {
            if (/["']\*["']/.test(ls[i]))
              hits.push({ path: file.path, line: d.startLine + i, detail: `${d.kind} grants the wildcard "*"` });
          }
        }
        if (d.kind === "RoleBinding" || d.kind === "ClusterRoleBinding") {
          const line = lineIn(d, /^\s*name:\s*["']?cluster-admin["']?\s*$/);
          if (line !== null)
            hits.push({ path: file.path, line, detail: `${d.kind} binds cluster-admin` });
        }
      }
      return hits;
    }
  },
  "k8s.labels": {
    id: "k8s.labels",
    scope: "file",
    title: "Required labels on workloads",
    summary: "Every workload carries each named label or annotation key.",
    paths: YAML,
    exclude: [],
    params: [{ name: "required", kind: "strings", hint: "Label or annotation keys, for example app.dkod.ai/owner." }],
    validate: (p) => listProblems(p, "required", { required: true }),
    runFile(file, params) {
      const need = stringList(params, "required") ?? [];
      const hits = [];
      for (const d of workloadDocs(file, WORKLOADS)) {
        const missing = need.filter((k) => !d.text.includes(k));
        if (missing.length > 0)
          hits.push({ path: file.path, line: d.kindLine, detail: `${d.kind} has no ${missing.join(", ")}` });
      }
      return hits;
    }
  },
  "file.exists": {
    id: "file.exists",
    scope: "tree",
    title: "A required file exists",
    summary: "At least one file matches one of the given paths.",
    paths: ["**"],
    exclude: [],
    params: [{ name: "any_of", kind: "strings", hint: "Paths or globs, for example CODEOWNERS or .github/CODEOWNERS." }],
    validate: (p) => listProblems(p, "any_of", { required: true }),
    runTree(files, params) {
      const want = stringList(params, "any_of") ?? [];
      if (files.some((f) => matchAny(want, f.path)))
        return [];
      return [{ path: null, line: null, detail: `none of ${want.join(", ")} exists` }];
    }
  },
  "content.forbid": {
    id: "content.forbid",
    scope: "file",
    title: "Forbidden text",
    summary: "No line in the matched files matches the pattern.",
    paths: ["**"],
    exclude: [],
    params: [
      { name: "pattern", kind: "string", hint: "A regular expression, matched line by line." },
      { name: "flags", kind: "string", hint: 'Optional. "i" ignores case.' }
    ],
    validate: patternParam,
    runFile(file, params) {
      const re = compileSafe(String(params.pattern), typeof params.flags === "string" ? params.flags : "");
      if (re === null)
        return [];
      const hits = [];
      const ls = lines(file.text);
      for (let i = 0;i < ls.length; i++)
        if (re.test(ls[i]))
          hits.push({ path: file.path, line: i + 1, detail: "a forbidden pattern matches here" });
      return hits;
    }
  },
  "content.require": {
    id: "content.require",
    scope: "file",
    title: "Required text",
    summary: "Each matched file has at least one line that matches the pattern.",
    paths: ["**"],
    exclude: [],
    params: [
      { name: "pattern", kind: "string", hint: "A regular expression, matched line by line." },
      { name: "flags", kind: "string", hint: 'Optional. "i" ignores case.' }
    ],
    validate: patternParam,
    runFile(file, params) {
      const re = compileSafe(String(params.pattern), typeof params.flags === "string" ? params.flags : "");
      if (re === null)
        return [];
      return lines(file.text).some((l) => re.test(l)) ? [] : [{ path: file.path, line: null, detail: "the required pattern is not in this file" }];
    }
  },
  "secrets.none": {
    id: "secrets.none",
    scope: "file",
    title: "No secret values",
    summary: "DKOD's secret detector finds no credential value. Test fixtures are skipped.",
    paths: ["**"],
    exclude: TESTS,
    params: [],
    validate: () => [],
    needsSecretScan: true,
    runFile(file, _params, opts) {
      if (!opts.secretScan)
        return [];
      return opts.secretScan(file).map((s) => ({ path: file.path, line: s.line, detail: `a ${s.kind} value is written here` }));
    }
  },
  "tls.no_insecure": {
    id: "tls.no_insecure",
    scope: "file",
    title: "TLS verification stays on",
    summary: "No code turns certificate checks off, and no URL uses plain http:// except to loopback.",
    paths: [...SOURCE, ...CONFIG],
    exclude: [...TESTS, "*.md", "*.svg", "*.lock", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    params: [{ name: "allow_http_hosts", kind: "strings", hint: "Hosts that may use http://. Loopback is always allowed." }],
    validate: (p) => listProblems(p, "allow_http_hosts"),
    runFile(file, params) {
      const allow = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "www.w3.org", "json-schema.org", "schemas.xmlsoap.org", "schemas.microsoft.com", ...stringList(params, "allow_http_hosts") ?? []]);
      const off = [
        [/rejectUnauthorized\s*:\s*false\b/, "rejectUnauthorized: false turns certificate checks off"],
        [/NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*["']?0\b/, "NODE_TLS_REJECT_UNAUTHORIZED=0 turns certificate checks off"],
        [/InsecureSkipVerify\s*:\s*true\b/, "InsecureSkipVerify: true turns certificate checks off"],
        [/\bverify\s*=\s*False\b/, "verify=False turns certificate checks off"],
        [/insecure-skip-tls-verify\s*[:=]\s*true\b/, "insecure-skip-tls-verify turns certificate checks off"],
        [/\bsslmode\s*=\s*disable\b/, "sslmode=disable sends database traffic without TLS"]
      ];
      const hits = [];
      const ls = lines(file.text);
      for (let i = 0;i < ls.length; i++) {
        const l = ls[i];
        for (const [re, what] of off)
          if (re.test(l))
            hits.push({ path: file.path, line: i + 1, detail: what });
        const urls = l.matchAll(/\bhttp:\/\/([^/\s"'`:]+)/g);
        for (const m of urls) {
          const host = m[1].toLowerCase();
          if (!allow.has(host) && !host.endsWith(".localhost"))
            hits.push({ path: file.path, line: i + 1, detail: `http://${host} is plain HTTP` });
        }
      }
      return hits;
    }
  },
  "version.semver": {
    id: "version.semver",
    scope: "file",
    title: "MAJOR.MINOR.PATCH versions",
    summary: "package.json and Chart.yaml carry a version of the form MAJOR.MINOR.PATCH.",
    paths: ["package.json", "Chart.yaml"],
    exclude: [],
    params: [],
    validate: () => [],
    runFile(file) {
      const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
      const base = file.path.split("/").pop() ?? file.path;
      if (base === "package.json") {
        let doc;
        try {
          doc = JSON.parse(file.text);
        } catch {
          return [];
        }
        const v = typeof doc === "object" && doc !== null ? doc.version : undefined;
        const line = lines(file.text).findIndex((l) => /"version"\s*:/.test(l)) + 1 || null;
        if (typeof v !== "string")
          return [{ path: file.path, line: null, detail: "package.json has no version" }];
        return semver.test(v) ? [] : [{ path: file.path, line, detail: `version "${v}" is not MAJOR.MINOR.PATCH` }];
      }
      const ls = lines(file.text);
      const at = ls.findIndex((l) => /^version:/.test(l));
      if (at === -1)
        return [{ path: file.path, line: null, detail: "Chart.yaml has no version" }];
      const v = ls[at].replace(/^version:\s*/, "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      return semver.test(v) ? [] : [{ path: file.path, line: at + 1, detail: `version "${v}" is not MAJOR.MINOR.PATCH` }];
    }
  },
  "commit.conventional": {
    id: "commit.conventional",
    scope: "commit",
    title: "Conventional commit subjects",
    summary: "Each commit subject reads type(scope): summary, and a breaking change carries ! and a BREAKING CHANGE: footer.",
    paths: [],
    exclude: [],
    params: [{ name: "types", kind: "strings", hint: "Allowed types. Default: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert." }],
    validate: (p) => listProblems(p, "types"),
    runCommit(message, params) {
      const types = stringList(params, "types") ?? ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];
      const subject = (message.split(/\r?\n/)[0] ?? "").trim();
      if (/^Merge /.test(subject) || /^Revert "/.test(subject))
        return [];
      const m = /^([a-z]+)(\([^()\s]+\))?(!)?: \S/.exec(subject);
      if (!m)
        return [{ path: null, line: 1, detail: `"${subject.slice(0, 80)}" does not read type(scope): summary` }];
      if (!types.includes(m[1]))
        return [{ path: null, line: 1, detail: `"${m[1]}" is not one of the allowed types (${types.join(", ")})` }];
      if (m[3] === "!" && !/^BREAKING CHANGE: \S/m.test(message))
        return [{ path: null, line: 1, detail: "a breaking change (!) needs a BREAKING CHANGE: footer" }];
      return [];
    }
  }
};
var MAX_FINDINGS = 200;
var MAX_FILE_BYTES = 512 * 1024;
function finish(findings, checked) {
  const capped = findings.slice(0, MAX_FINDINGS);
  return { findings: capped, blocked: capped.some((f) => f.level === "block"), checked };
}
function toFinding(rule, check, level, message, title, hit) {
  return { rule, check, level, path: hit.path, line: hit.line, message: message ? `${message} (${hit.detail})` : `${title}: ${hit.detail}` };
}
function scopeOf(check) {
  const def = CATALOG[check.use];
  return { paths: stringList(check.with, "paths") ?? def.paths, exclude: [...ALWAYS_SKIPPED, ...def.exclude, ...stringList(check.with, "exclude") ?? []] };
}
var cleanPath = (p) => p.replace(/^\.?\/+/, "");
function evaluate(pack, files, opts) {
  const usable = files.filter((f) => f.text.length <= MAX_FILE_BYTES).map((f) => ({ path: cleanPath(f.path), text: f.text }));
  const findings = [];
  let checked = 0;
  for (const rule of pack.rules) {
    for (const check of rule.checks) {
      const level = check.level ?? rule.level;
      if (level === "off")
        continue;
      const def = CATALOG[check.use];
      if (def.scope === "commit")
        continue;
      if (def.scope === "tree" && opts.stage !== "build")
        continue;
      if (def.needsSecretScan && !opts.secretScan)
        continue;
      const { paths, exclude } = scopeOf(check);
      const scoped = usable.filter((f) => matchAny(paths, f.path) && !matchAny(exclude, f.path));
      checked += 1;
      const hits = [];
      if (def.scope === "tree" && def.runTree)
        hits.push(...def.runTree(scoped, check.with));
      if (def.scope === "file" && def.runFile) {
        const runOpts = opts.secretScan ? { secretScan: opts.secretScan } : {};
        for (const f of scoped)
          hits.push(...def.runFile(f, check.with, runOpts));
      }
      for (const h of hits)
        findings.push(toFinding(rule.name, check.use, level, check.message, def.title, h));
      if (findings.length >= MAX_FINDINGS)
        return finish(findings, checked);
    }
  }
  return finish(findings, checked);
}
function pathsToRead(pack, paths, opts) {
  const scopes = pack.rules.flatMap((rule) => rule.checks.filter((c) => (c.level ?? rule.level) !== "off" && CATALOG[c.use].scope === "file" && (!CATALOG[c.use].needsSecretScan || opts.secretScan !== undefined)).map(scopeOf));
  return new Set(paths.filter((p) => scopes.some((s) => matchAny(s.paths, cleanPath(p)) && !matchAny(s.exclude, cleanPath(p)))));
}
function formatFindings(findings, max = 20) {
  const shown = findings.slice(0, max).map((f) => {
    const where = f.path === null ? "" : f.line === null ? `${f.path}: ` : `${f.path}:${f.line}: `;
    return `- [${f.level}] ${f.rule}: ${where}${f.message}`;
  });
  if (findings.length > max)
    shown.push(`- and ${findings.length - max} more`);
  return shown.join(`
`);
}
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

var MAX_CHECKS_PER_RULE = 32;
var MAX_RULES_PER_PACK = 200;
var MAX_MESSAGE = 300;
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isLevel(v) {
  return typeof v === "string" && POLICY_LEVELS.includes(v);
}
function genericPathProblems(params) {
  const out = [];
  for (const key of ["paths", "exclude"]) {
    const v = params[key];
    if (v === undefined)
      continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length === 0 || x.length > 200) || v.length > 32)
      out.push(`"${key}" must be a list of at most 32 globs`);
  }
  return out;
}
function checkProblems(raw, where) {
  if (!isRecord(raw))
    return [`${where} must be a mapping with "use"`];
  const use = raw.use;
  if (typeof use !== "string" || !CHECK_IDS.includes(use))
    return [`${where}.use "${String(use)}" is not a known check`];
  const params = raw.with === undefined || raw.with === null ? {} : raw.with;
  if (!isRecord(params))
    return [`${where}.with must be a mapping`];
  const out = [...genericPathProblems(params), ...CATALOG[use].validate(params)].map((p) => `${where}.with: ${p}`);
  if (raw.message !== undefined && raw.message !== null && (typeof raw.message !== "string" || raw.message.length > MAX_MESSAGE))
    out.push(`${where}.message must be text of at most ${MAX_MESSAGE} characters`);
  if (raw.level !== undefined && raw.level !== null && !isLevel(raw.level))
    out.push(`${where}.level must be block, warn or off`);
  return out;
}
function parseEnforce(raw) {
  if (!isRecord(raw))
    return { ok: false, errors: ["enforce must be a mapping"] };
  const errors = [];
  const level = raw.level === undefined ? "block" : raw.level;
  if (!isLevel(level))
    errors.push("enforce.level must be block, warn or off");
  if (raw.source !== undefined && raw.source !== null && (typeof raw.source !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.source)))
    errors.push("enforce.source must be sha256:<64 hex>");
  if (raw.translator !== undefined && typeof raw.translator !== "string")
    errors.push("enforce.translator must be text");
  const checksRaw = raw.checks === undefined || raw.checks === null ? [] : raw.checks;
  if (!Array.isArray(checksRaw))
    errors.push("enforce.checks must be a list");
  else if (checksRaw.length > MAX_CHECKS_PER_RULE)
    errors.push(`enforce.checks may hold at most ${MAX_CHECKS_PER_RULE} checks`);
  else
    checksRaw.forEach((c, i) => errors.push(...checkProblems(c, `enforce.checks[${i}]`)));
  if (errors.length > 0)
    return { ok: false, errors };
  const checks = checksRaw.map((c) => ({
    use: c.use,
    with: isRecord(c.with) ? c.with : {},
    message: typeof c.message === "string" && c.message.trim() !== "" ? c.message.trim() : null,
    level: isLevel(c.level) ? c.level : null
  }));
  return {
    ok: true,
    enforce: {
      level,
      source: typeof raw.source === "string" ? raw.source : null,
      translator: typeof raw.translator === "string" ? raw.translator : "manual",
      checks
    }
  };
}
function readPack(raw) {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.rules))
    return { version: 1, rules: [] };
  const rules = [];
  for (const r of raw.rules.slice(0, MAX_RULES_PER_PACK)) {
    if (!isRecord(r) || typeof r.name !== "string" || typeof r.path !== "string")
      continue;
    const parsed = parseEnforce({ level: r.level, checks: r.checks });
    if (!parsed.ok)
      continue;
    rules.push({ name: r.name, path: r.path, level: parsed.enforce.level, stale: r.stale === true, checks: parsed.enforce.checks });
  }
  return { version: 1, rules };
}
function check(use, params = {}, extra = {}) {
  return { use, with: params, message: extra.message ?? null, level: extra.level ?? null };
}
var has = (h, ...words) => words.some((w) => {
  let at = h.indexOf(w);
  while (at !== -1) {
    if (at === 0 || !/[a-z0-9]/.test(h[at - 1]))
      return true;
    at = h.indexOf(w, at + 1);
  }
  return false;
});
var RECOGNISERS = [
  {
    id: "pinned-base-images",
    label: "Base images pinned by digest",
    test: (h) => has(h, "digest") && has(h, "from", "base image"),
    checks: [check("dockerfile.from_digest", { exclude: ["Dockerfile.dev"] }, { message: "Pin the base image by digest: FROM image:tag@sha256:<digest>" })]
  },
  {
    id: "no-moving-tags",
    label: "No moving image tags",
    test: (h) => has(h, "tag") && has(h, "latest", "floating", "moves", "moving"),
    checks: [
      check("image.no_moving_tag", { tags: ["latest", "main", "master", "stable", "edge", "nightly"], exclude: ["docker-compose*.y*ml", "compose*.y*ml", "Dockerfile.dev"] }, { message: "Use a fixed image version or a digest, never a tag that moves" })
    ]
  },
  {
    id: "non-root",
    label: "Non-root containers",
    test: (h) => has(h, "non-root", "nonroot", "runasnonroot", "as root"),
    checks: [
      check("dockerfile.numeric_user", { exclude: ["Dockerfile.dev"] }, { message: "Run the image as a numeric non-root user: USER 10001" }),
      check("k8s.security_context", {}, { message: "Run as non-root, drop ALL capabilities, read-only root filesystem, no privileged mode" })
    ]
  },
  {
    id: "probes",
    label: "Health probes",
    test: (h) => has(h, "probe", "liveness", "readiness"),
    checks: [check("k8s.probes", { require: ["readinessProbe", "livenessProbe", "startupProbe"] }, { message: "Long-running workloads need readiness, liveness and startup probes" })]
  },
  {
    id: "resources",
    label: "Resource requests and limits",
    test: (h) => has(h, "requests") && has(h, "memory") || has(h, "resource limit", "memory limit"),
    checks: [check("k8s.resources", {}, { message: "Declare requests.cpu, requests.memory and limits.memory" })]
  },
  {
    id: "rbac",
    label: "Least-privilege RBAC",
    test: (h) => has(h, "rbac", "wildcard", "cluster-admin", "least privilege", "least-privilege"),
    checks: [check("k8s.rbac_no_wildcards", {}, { message: 'Name each permission; no "*" and no cluster-admin' })]
  },
  {
    id: "secrets",
    label: "No secret values in code",
    test: (h) => has(h, "secret value", "plaintext secret", "plain text secret", "hardcoded secret", "hard-coded secret", "secret in code"),
    checks: [check("secrets.none", {}, { message: "Never write a secret value; read it by name at run time" })]
  },
  {
    id: "tls",
    label: "TLS with verification",
    test: (h) => has(h, "tls", "https", "certificate verification"),
    checks: [check("tls.no_insecure", {}, { message: "Use TLS with certificate checks on; plain HTTP only to loopback" })]
  },
  {
    id: "structured-logs",
    label: "Structured JSON logs",
    test: (h) => has(h, "log") && has(h, "json"),
    checks: [
      check("content.forbid", { pattern: "\\bconsole\\.(?:log|info|debug)\\(", paths: ["*.{ts,tsx,js,jsx,mjs,cjs}"], exclude: ["**/test/**", "**/tests/**", "*.test.*", "*.spec.*", "**/scripts/**"] }, { message: "Log through the JSON logger, not console.log", level: "warn" })
    ]
  },
  {
    id: "semver",
    label: "Semantic versions",
    test: (h) => has(h, "major.minor.patch", "semver", "semantic version"),
    checks: [check("version.semver", {}, { message: "Version every artifact as MAJOR.MINOR.PATCH" })]
  },
  {
    id: "conventional-commits",
    label: "Conventional commits",
    test: (h) => has(h, "commit") && has(h, "conventional", "type(scope)"),
    checks: [check("commit.conventional", { types: ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"] }, { message: "Write the commit subject as type(scope): summary" })]
  },
  {
    id: "owner",
    label: "Every service has an owner",
    test: (h) => has(h, "owner", "owning team", "ownership"),
    checks: [check("k8s.labels", { required: ["app.dkod.ai/owner"] }, { message: "Every deployed workload names its owner", level: "warn" })]
  },
  {
    id: "package-manager",
    label: "bun is the only package manager",
    test: (h) => has(h, "bun") && has(h, "npm", "yarn", "pnpm", "package manager", "package step"),
    checks: [
      check("content.forbid", { pattern: "\\S", paths: ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"] }, { message: "Use bun: delete this lockfile; bun keeps bun.lock" }),
      check("content.forbid", {
        pattern: "(?:^|[\\s;&|(\"'`=])(?:npm|npx|yarn|pnpm)(?:\\s|$)",
        paths: ["Dockerfile*", "*.Dockerfile", "Containerfile*", ".github/workflows/*.y*ml", ".gitlab-ci.y*ml", "package.json", "Makefile", "*.sh"]
      }, { message: "Use bun, bunx and bun run here, not npm, npx, yarn or pnpm" }),
      check("content.forbid", { pattern: "^\\s*FROM.*[\\s/]node[:@]", flags: "i", paths: ["Dockerfile*", "*.Dockerfile", "Containerfile*"] }, { message: "Build from the official oven/bun image, not node" })
    ]
  }
];
var POLICY_CHECK_TOOL = "policy_check";
var POLICY_CHECK_TOOL_FULL = `mcp__dkod__${POLICY_CHECK_TOOL}`;
var MAX_FOLDER_FILES = 5000;
var MAX_READ_BYTES = 64 * 1024 * 1024;
var MAX_SHOWN = 50;
var refuse = (error, message) => ({ ok: false, error, message });
function packFromAnswer(raw) {
  const inner = typeof raw === "object" && raw !== null && "structuredContent" in raw ? raw.structuredContent : raw;
  const pack = typeof inner === "object" && inner !== null && "policy_pack" in inner ? inner.policy_pack : inner;
  return readPack(pack);
}
async function checkFolder(pack, dir, io) {
  if (!pack || pack.rules.length === 0) {
    return { ok: true, folder: dir, files: 0, skipped: 0, checked: 0, blocked: false, findings: [], summary: "", next: "Your organization's rules have no checks yet. Nothing to fix." };
  }
  const listed = await io.list(dir).catch(() => null);
  if (listed === null)
    return refuse("cannot_list", "Dkoder could not list the files of that folder. Check the path, then try again.");
  if (listed.length > MAX_FOLDER_FILES)
    return refuse("too_many_files", `That folder has more than ${String(MAX_FOLDER_FILES)} files. Run the check on the app's own folder.`);
  const wanted = pathsToRead(pack, listed, { stage: "build" });
  const base = dir.replace(/\/+$/, "");
  let total = 0;
  let skipped = 0;
  const files = [];
  for (const path of listed) {
    if (!wanted.has(path)) {
      files.push({ path, text: "" });
      continue;
    }
    let text = null;
    try {
      text = total > MAX_READ_BYTES ? null : await io.read(`${base}/${path}`);
    } catch {
      text = null;
    }
    if (text === null || text.includes("\x00") || text.length > MAX_FILE_BYTES) {
      skipped += 1;
      files.push({ path, text: "" });
      continue;
    }
    total += text.length;
    files.push({ path, text });
  }
  const result = evaluate(pack, files, { stage: "build" });
  const blocks = result.findings.filter((f) => f.level === "block").length;
  const next = blocks > 0 ? `Fix the ${String(blocks)} block finding${blocks === 1 ? "" : "s"}, then run this check again before you deploy.` : result.findings.length > 0 ? "No block finding. Tell the person about each warn finding." : "Every check passed.";
  return {
    ok: true,
    folder: dir,
    files: listed.length,
    skipped,
    checked: result.checked,
    blocked: result.blocked,
    findings: result.findings.slice(0, MAX_SHOWN),
    summary: formatFindings(result.findings, MAX_SHOWN),
    next: skipped > 0 ? `${next} ${String(skipped)} file${skipped === 1 ? " was" : "s were"} not read (binary, over 512 KB, or past the read limit).` : next
  };
}
async function listWithShell(run, dir) {
  const git = await run(["git", "-C", dir, "ls-files", "-co", "--exclude-standard", "-z"], { timeoutMs: 20000 }).catch(() => null);
  if (git !== null && git.exitCode === 0)
    return git.stdout.split("\x00").filter(Boolean);
  const find = await run(["find", ".", "(", "-name", "node_modules", "-o", "-name", ".git", "-o", "-name", "vendor", ")", "-prune", "-o", "-type", "f", "-print0"], { cwd: dir, timeoutMs: 20000 }).catch(() => null);
  if (find !== null && find.exitCode === 0)
    return find.stdout.split("\x00").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
  return null;
}

var absolutePath = (cwd, path) => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? path : `${cwd.replace(/[\\/]+$/, "")}/${path}`;
var USAGE = "Usage: node dkod-policy.mjs check <policy file> [folder]";
async function runPolicyCli(argv, io) {
  const [command, policyFile, folder, ...rest] = argv;
  if (command !== "check" || !policyFile || rest.length > 0) {
    io.print(JSON.stringify({ ok: false, error: "usage", message: USAGE }));
    return 2;
  }
  let raw;
  try {
    raw = JSON.parse(io.read(policyFile));
  } catch {
    io.print(JSON.stringify({ ok: false, error: "policy_unreadable", message: "The policy file is not the JSON answer of dkoder.policy. Call dkoder.policy, save its answer as it is, and try again." }));
    return 1;
  }
  const dir = absolutePath(io.cwd(), folder ?? ".").replace(/[\\/]\.$/, "");
  const result = await checkFolder(packFromAnswer(raw), dir, { list: (d) => io.list(d), read: async (p) => io.read(p) });
  io.print(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

var SKIP = new Set(["node_modules", ".git", "vendor", ".next", ".venv", "__pycache__", ".turbo", ".cache"]);
function walk(dir) {
  const out = [];
  const visit = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (out.length > MAX_FOLDER_FILES)
        return;
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name))
          visit(path);
      } else if (e.isFile())
        out.push(path);
    }
  };
  try {
    visit("");
    return out;
  } catch {
    return null;
  }
}
var run = async (argv, init) => {
  const r = spawnSync(argv[0], argv.slice(1), { cwd: init?.cwd, encoding: "utf8", timeout: init?.timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? "" };
};
process.exitCode = await runPolicyCli(process.argv.slice(2), {
  read: (path) => readFileSync(path, "utf8"),
  list: async (dir) => await listWithShell(run, dir) ?? walk(dir),
  cwd: () => process.cwd(),
  print: (line) => process.stdout.write(`${line}
`)
});
