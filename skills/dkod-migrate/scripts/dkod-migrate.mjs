// Built by packages/dkoder-plugin/scripts/build-migrate.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:migrate`.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join as join6 } from "node:path";

var APP_MAP = {
  kind: "app.map",
  minWorkerVersion: "0.41.0",
  workerFreshMs: 120000,
  retryAfterMs: 10 * 60000,
  aiCostMaxUsd: 2,
  routeKinds: ["page", "api", "server_function", "webhook", "other"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "ANY"],
  storeEngines: ["postgres", "sqlite", "mysql", "mongodb", "redis", "file", "other"],
  backgroundKinds: ["job", "timer", "queue", "cron", "other"],
  localKinds: ["disk_write", "localhost_url", "in_memory_state", "other"],
  pageStates: ["default", "empty", "loading", "error", "signed_out"],
  componentKinds: ["icon", "tooltip", "dialog", "menu", "form", "table", "list", "button", "tabs", "toast", "other"],
  max: {
    summary: 3,
    routes: 60,
    routeRefs: 6,
    stores: 8,
    storeEnv: 8,
    services: 16,
    serviceSettings: 12,
    settings: 64,
    background: 16,
    localOnly: 16,
    flows: 12,
    flowSteps: 10,
    pages: 30,
    pageStates: 5,
    pageComponents: 24
  },
  maxMapBytes: 60000
};
var ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
var TEXT_MAX = 200;
var str = () => ({ type: "string", maxLength: TEXT_MAX });
var nullableStr = () => ({ type: ["string", "null"], maxLength: TEXT_MAX });
var bool = () => ({ type: "boolean" });
var pick = (values) => ({ type: "string", enum: [...values] });
var list = (items, maxItems) => ({ type: "array", maxItems, items });
var obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
var APP_MAP_RESPONSE_SCHEMA = obj({
  summary: list(str(), APP_MAP.max.summary),
  routes: list(obj({
    kind: pick(APP_MAP.routeKinds),
    method: pick(APP_MAP.methods),
    path: str(),
    does: str(),
    reads: list(str(), APP_MAP.max.routeRefs),
    writes: list(str(), APP_MAP.max.routeRefs),
    file: nullableStr()
  }), APP_MAP.max.routes),
  stores: list(obj({
    engine: pick(APP_MAP.storeEngines),
    where: str(),
    orm: nullableStr(),
    migrations: nullableStr(),
    env_names: list(str(), APP_MAP.max.storeEnv)
  }), APP_MAP.max.stores),
  services: list(obj({
    name: str(),
    for: str(),
    required: bool(),
    settings: list(str(), APP_MAP.max.serviceSettings)
  }), APP_MAP.max.services),
  settings: list(obj({
    name: str(),
    used_where: str(),
    required: bool(),
    secret: bool()
  }), APP_MAP.max.settings),
  background: list(obj({ kind: pick(APP_MAP.backgroundKinds), what: str(), file: nullableStr() }), APP_MAP.max.background),
  local_only: list(obj({ kind: pick(APP_MAP.localKinds), what: str(), file: nullableStr() }), APP_MAP.max.localOnly),
  flows: list(obj({ name: str(), steps: list(str(), APP_MAP.max.flowSteps) }), APP_MAP.max.flows),
  pages: list(obj({
    path: str(),
    name: str(),
    states: list(pick(APP_MAP.pageStates), APP_MAP.max.pageStates),
    components: list(obj({ kind: pick(APP_MAP.componentKinds), name: str() }), APP_MAP.max.pageComponents)
  }), APP_MAP.max.pages)
});
function isSettingName(s) {
  if (!ENV_NAME.test(s))
    return false;
  return !s.split("_").some((part) => /[0-9]{8}/.test(part) || part.length >= 16 && /[0-9]/.test(part) && /[A-Za-z]/.test(part));
}

var join = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var SKIP = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor", ".dkod", "__pycache__"];
var ASSET_KINDS = ["css", "font", "icon", "image"];
var TEXT_MAX2 = 200;
var QUERY_MAX = 4000;
var LOCAL_KEYS = ["tables", "queries", "functions", "design"];
var isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var CONTROL_ANY = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");
function safeFile(s) {
  if (s.length === 0 || s.length > 512 || CONTROL_ANY.test(s) || s.startsWith("/") || s.includes("\\"))
    return false;
  return s.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
function validateMap(json) {
  const problems = [];
  const bad = (path, why) => {
    problems.push(`${path}: ${why}`);
  };
  if (!isRec(json))
    return ["app-map.json: must be a JSON object"];
  const text = (v, path, opts = {}) => {
    if (typeof v !== "string")
      return bad(path, "must be a string");
    if (v.length > TEXT_MAX2)
      bad(path, `must be at most ${TEXT_MAX2} characters`);
    else if (CONTROL_ANY.test(v))
      bad(path, "must be one line");
    else if (!opts.empty && v.trim() === "")
      bad(path, "must not be empty");
  };
  const file = (v, path) => {
    if (v === null)
      return;
    if (typeof v !== "string" || !safeFile(v))
      bad(path, "must be null or a path inside the original, with no '..' and no leading '/'");
  };
  const pick = (v, values, path) => {
    if (typeof v !== "string" || !values.includes(v))
      bad(path, `must be one of ${values.join(", ")}`);
  };
  const bool = (v, path) => {
    if (typeof v !== "boolean")
      bad(path, "must be true or false");
  };
  const array = (v, path, max, min = 0) => {
    if (!Array.isArray(v)) {
      bad(path, "must be a list");
      return [];
    }
    if (v.length > max)
      bad(path, `must have at most ${max} items`);
    if (v.length < min)
      bad(path, `must have at least ${min} item${min === 1 ? "" : "s"}`);
    return v;
  };
  const texts = (v, path, max, min = 0) => {
    array(v, path, max, min).forEach((t, i) => text(t, `${path}[${i}]`));
  };
  const names = (v, path, max) => {
    array(v, path, max).forEach((n, i) => {
      if (typeof n !== "string" || !isSettingName(n))
        bad(`${path}[${i}]`, "must be a setting NAME (letters, digits, _), never a value");
    });
  };
  const items = (key, max, each) => {
    array(json[key], key, max).forEach((r, i) => {
      if (!isRec(r))
        return bad(`${key}[${i}]`, "must be an object");
      each(r, `${key}[${i}]`);
    });
  };
  const fields = (r, path, allowed) => {
    for (const k of allowed)
      if (!(k in r))
        bad(`${path}.${k}`, "is missing");
    for (const k of Object.keys(r))
      if (!allowed.includes(k))
        bad(`${path}.${k}`, "is not a field of the app map");
  };
  const keys = ["summary", "routes", "stores", "services", "settings", "background", "local_only", "flows", "pages"];
  for (const k of keys)
    if (!(k in json))
      bad(k, "is missing");
  for (const k of Object.keys(json))
    if (!keys.includes(k) && !LOCAL_KEYS.includes(k))
      bad(k, "is not a field of the app map");
  const max = APP_MAP.max;
  if ("summary" in json)
    texts(json.summary, "summary", max.summary, 1);
  if ("routes" in json) {
    items("routes", max.routes, (r, p) => {
      fields(r, p, ["kind", "method", "path", "does", "reads", "writes", "file"]);
      pick(r.kind, APP_MAP.routeKinds, `${p}.kind`);
      pick(r.method, APP_MAP.methods, `${p}.method`);
      text(r.path, `${p}.path`);
      text(r.does, `${p}.does`, { empty: true });
      texts(r.reads, `${p}.reads`, max.routeRefs);
      texts(r.writes, `${p}.writes`, max.routeRefs);
      file(r.file, `${p}.file`);
    });
  }
  if ("stores" in json) {
    items("stores", max.stores, (r, p) => {
      fields(r, p, ["engine", "where", "orm", "migrations", "env_names"]);
      pick(r.engine, APP_MAP.storeEngines, `${p}.engine`);
      text(r.where, `${p}.where`);
      for (const k of ["orm", "migrations"])
        if (r[k] !== null)
          text(r[k], `${p}.${k}`);
      names(r.env_names, `${p}.env_names`, max.storeEnv);
    });
  }
  if ("services" in json) {
    items("services", max.services, (r, p) => {
      fields(r, p, ["name", "for", "required", "settings"]);
      text(r.name, `${p}.name`);
      text(r.for, `${p}.for`, { empty: true });
      bool(r.required, `${p}.required`);
      names(r.settings, `${p}.settings`, max.serviceSettings);
    });
  }
  if ("settings" in json) {
    const seen = new Set;
    items("settings", max.settings, (r, p) => {
      fields(r, p, ["name", "used_where", "required", "secret"]);
      if (typeof r.name !== "string" || !isSettingName(r.name))
        bad(`${p}.name`, "must be a setting NAME (letters, digits, _), never a value");
      else if (seen.has(r.name))
        bad(`${p}.name`, `${r.name} is listed twice`);
      else
        seen.add(r.name);
      text(r.used_where, `${p}.used_where`, { empty: true });
      bool(r.required, `${p}.required`);
      bool(r.secret, `${p}.secret`);
    });
  }
  for (const [key, kinds, cap] of [["background", APP_MAP.backgroundKinds, max.background], ["local_only", APP_MAP.localKinds, max.localOnly]]) {
    if (!(key in json))
      continue;
    items(key, cap, (r, p) => {
      fields(r, p, ["kind", "what", "file"]);
      pick(r.kind, kinds, `${p}.kind`);
      text(r.what, `${p}.what`);
      file(r.file, `${p}.file`);
    });
  }
  if ("flows" in json) {
    items("flows", max.flows, (r, p) => {
      fields(r, p, ["name", "steps"]);
      text(r.name, `${p}.name`);
      texts(r.steps, `${p}.steps`, max.flowSteps);
    });
  }
  if ("pages" in json) {
    items("pages", max.pages, (r, p) => {
      fields(r, p, ["path", "name", "states", "components"]);
      text(r.path, `${p}.path`);
      text(r.name, `${p}.name`);
      const states = array(r.states, `${p}.states`, max.pageStates, 1);
      states.forEach((s, i) => pick(s, APP_MAP.pageStates, `${p}.states[${i}]`));
      if (new Set(states).size !== states.length)
        bad(`${p}.states`, "lists a state twice");
      array(r.components, `${p}.components`, max.pageComponents).forEach((c, i) => {
        if (!isRec(c))
          return bad(`${p}.components[${i}]`, "must be an object");
        fields(c, `${p}.components[${i}]`, ["kind", "name"]);
        pick(c.kind, APP_MAP.componentKinds, `${p}.components[${i}].kind`);
        text(c.name, `${p}.components[${i}].name`);
      });
    });
  }
  if ("tables" in json) {
    array(json.tables, "tables", 200).forEach((t, i) => {
      if (!isRec(t))
        return bad(`tables[${i}]`, "must be an object");
      fields(t, `tables[${i}]`, ["store", "name", "columns"]);
      text(t.store, `tables[${i}].store`);
      text(t.name, `tables[${i}].name`);
      texts(t.columns, `tables[${i}].columns`, 500);
    });
  }
  if ("queries" in json) {
    array(json.queries, "queries", 2000).forEach((q, i) => {
      if (typeof q !== "string" || q.trim() === "")
        bad(`queries[${i}]`, "must be the SQL string as written in the code");
      else if (q.length > QUERY_MAX)
        bad(`queries[${i}]`, `must be at most ${QUERY_MAX} characters`);
    });
  }
  if ("functions" in json) {
    array(json.functions, "functions", 5000).forEach((f, i) => {
      if (typeof f !== "string" || !/^[\w$.:<>-]{1,120}$/.test(f))
        bad(`functions[${i}]`, "must be a function name");
    });
  }
  if ("design" in json) {
    const d = json.design;
    if (!isRec(d))
      bad("design", "must be an object");
    else {
      fields(d, "design", ["colors", "fonts", "buttons", "tooltips"]);
      array(d.colors, "design.colors", 500).forEach((c, i) => {
        if (typeof c !== "string" || !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(c))
          bad(`design.colors[${i}]`, "must be a lowercase hex color like #1a2b3c");
      });
      texts(d.fonts, "design.fonts", 100);
      texts(d.buttons, "design.buttons", 1000);
      texts(d.tooltips, "design.tooltips", 1000);
    }
  }
  if (Buffer.byteLength(JSON.stringify(json)) > APP_MAP.maxMapBytes)
    bad("app-map.json", `must stay under ${APP_MAP.maxMapBytes} bytes`);
  return problems;
}
function normalizeRoute(path) {
  let p = path.trim().replace(/[?#].*$/, "");
  p = p.replace(/\[\[?\.\.\.[^\]]*\]?\]/g, ":param");
  p = p.replace(/\[[^\]]+\]/g, ":param");
  p = p.replace(/<[^>/]+>/g, ":param");
  p = p.replace(/\{[^}/]+\}/g, ":param");
  p = p.replace(/\/\$[A-Za-z_][\w]*/g, "/:param").replace(/\/:[A-Za-z_][\w]*\??/g, "/:param");
  p = p.replace(/\/\*[\w]*/g, "/:param");
  p = `/${p.replace(/^\/+/, "")}`.replace(/\/+/g, "/");
  return p.length > 1 ? p.replace(/\/$/, "") : p;
}
var CODE = /\.(?:[cm]?[jt]sx?|svelte)$/;
var PY = /\.py$/;
var IS_TEST = /(?:^|\/)(?:tests?|__tests__|e2e|spec)\/|\.(?:test|spec)\.[a-z]+$|(?:^|\/)test_[^/]*\.py$|_test\.py$/;
var ROUTER_FILE = /createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|useRoutes|<Routes|<Route\b|RouteObject|\broutes\s*[:=]/;
var RECEIVER = "(?:app|router|routes?|server|fastify|api|[A-Za-z_$][\\w$]*(?:Router|App|Server|Routes))";
var HTTP = /^\.(?:get|post|put|patch|delete|all)$/;
function packageDirs(files, needle, io, original) {
  const out = [];
  for (const f of files) {
    if (f !== "package.json" && !f.endsWith("/package.json"))
      continue;
    if (needle.test(io.readFile(join(original, f)) ?? ""))
      out.push(f.slice(0, f.length - "package.json".length));
  }
  return out;
}
var under = (file, dirs) => dirs.find((d) => file.startsWith(d)) ?? null;
function fileRoutes(files, io, original) {
  const out = [];
  const add = (path, file) => out.push({ path: normalizeRoute(path), file, relative: false });
  const next = packageDirs(files, /"next"\s*:/, io, original);
  const remix = packageDirs(files, /"@remix-run\/|"@react-router\/|"react-router"\s*:/, io, original);
  const dropGroups = (segs) => segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  for (const f of files) {
    if (IS_TEST.test(f))
      continue;
    let m;
    if ((m = /^((?:.*\/)?)(?:src\/)?app\/(?:(.*)\/)?(page|route)\.(?:[jt]sx?|mdx)$/.exec(f)) !== null && under(f, next) !== null) {
      add(dropGroups((m[2] ?? "").split("/").filter(Boolean)).join("/"), f);
    } else if ((m = /^((?:.*\/)?)(?:src\/)?pages\/(.+)\.(?:[jt]sx?|mdx)$/.exec(f)) !== null && under(f, next) !== null) {
      const segs = m[2].split("/");
      if (/^_(?:app|document|error|middleware)$/.test(segs[segs.length - 1]) || segs[0] === "_next")
        continue;
      if (segs[segs.length - 1] === "index")
        segs.pop();
      add(segs.join("/"), f);
    } else if ((m = /(?:^|\/)src\/routes\/(?:(.*)\/)?\+(?:page|server)\.(?:svelte|[jt]s)$/.exec(f)) !== null) {
      add(dropGroups((m[1] ?? "").split("/").filter(Boolean)).join("/"), f);
    } else if ((m = /(?:^|\/)app\/routes\/(?:([^/]+)\.(?:[jt]sx?|mdx)|([^/]+)\/(?:route|index)\.(?:[jt]sx?|mdx))$/.exec(f)) !== null && under(f, remix) !== null) {
      const flat = m[1] ?? m[2];
      if (flat === "root" || flat.startsWith("__"))
        continue;
      const segs = flat.split(".").map((s) => s.replace(/_$/, "")).filter((s) => s !== "" && !s.startsWith("_") && s !== "route");
      add(segs.join("/"), f);
    }
  }
  return out;
}
function sourceRoutes(files, io, original) {
  const out = [];
  for (const f of files) {
    if (IS_TEST.test(f) || !CODE.test(f) && !PY.test(f))
      continue;
    const text = io.readFile(join(original, f));
    if (text === null)
      continue;
    const add = (path) => {
      if (path === "" || path === "*" || /^https?:/.test(path) || /\s/.test(path))
        return;
      out.push({ path: normalizeRoute(path), file: f, relative: !path.startsWith("/") });
    };
    if (PY.test(f)) {
      for (const m of text.matchAll(/@[A-Za-z_][\w.]*\.(?:get|post|put|patch|delete|route|api_route|websocket)\(\s*(["'])(\/[^"']*)\1/g))
        add(m[2]);
      continue;
    }
    if (ROUTER_FILE.test(text)) {
      for (const m of text.matchAll(/<Route\b[^>]*?\bpath=(?:\{\s*)?(["'`])([^"'`]*)\1/g))
        add(m[2]);
      for (const m of text.matchAll(/\bpath:\s*(["'`])([^"'`]*)\1/g))
        add(m[2]);
    }
    const call = new RegExp(`\\b${RECEIVER}(\\.(?:get|post|put|patch|delete|all))\\(\\s*(["'\`])(\\/[^"'\`]*)\\2`, "g");
    for (const m of text.matchAll(call))
      if (HTTP.test(m[1]))
        add(m[3]);
    for (const m of text.matchAll(/\bfastify\.route\(\s*\{[^}]*?\burl:\s*(["'`])(\/[^"'`]*)\1/g))
      add(m[2]);
  }
  return out;
}
function discoverRoutes(original, io) {
  const files = io.walk(original, SKIP);
  const all = [...fileRoutes(files, io, original), ...sourceRoutes(files, io, original)];
  const seen = new Set;
  return all.filter((r) => seen.has(r.path) ? false : (seen.add(r.path), true));
}
var bare = (s) => s.replace(/[`"'[\]]/g, "");
var CONSTRAINT = /^(?:primary|foreign|unique|constraint|check|key|index|fulltext|exclude)$/i;
function discoverTables(original, io) {
  const out = new Map;
  const put = (name, cols) => {
    const set = out.get(name) ?? new Set;
    for (const c of cols)
      set.add(c);
    out.set(name, set);
  };
  for (const f of io.walk(original, SKIP)) {
    if (IS_TEST.test(f))
      continue;
    if (/(?:^|\/)data\/.+\.csv$/i.test(f)) {
      const header = (io.readFile(join(original, f)) ?? "").split(/\r?\n/, 1)[0] ?? "";
      put((f.split("/").pop() ?? f).replace(/\.csv$/i, ""), header.split(",").map((c) => bare(c.trim())).filter((c) => c !== ""));
      continue;
    }
    if (!/\.sql$/i.test(f) && !CODE.test(f) && !PY.test(f))
      continue;
    const raw = io.readFile(join(original, f));
    if (raw === null)
      continue;
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    for (const m of text.matchAll(/CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)\s*\(/gi)) {
      const name = bare(m[1]).split(".").pop();
      const cols = [];
      let depth = 1;
      let cur = "";
      const flush = () => {
        const first = bare(cur.trim().split(/[\s(]+/)[0] ?? "");
        if (first !== "" && !CONSTRAINT.test(first))
          cols.push(first);
        cur = "";
      };
      for (let i = m.index + m[0].length;i < text.length; i++) {
        const ch = text[i];
        if (ch === "(")
          depth++;
        else if (ch === ")" && --depth === 0)
          break;
        if (ch === "," && depth === 1)
          flush();
        else
          cur += ch;
      }
      flush();
      put(name, cols);
    }
  }
  return out;
}
var ENV_READS = [
  /\bprocess\.env\.([A-Za-z_]\w*)/g,
  /\bprocess\.env\[\s*(["'`])([A-Za-z_]\w*)\1\s*\]/g,
  /\bimport\.meta\.env\.([A-Za-z_]\w*)/g,
  /\bos\.environ\[\s*(["'])([A-Za-z_]\w*)\1\s*\]/g,
  /\bos\.environ\.get\(\s*(["'])([A-Za-z_]\w*)\1/g,
  /\bos\.getenv\(\s*(["'])([A-Za-z_]\w*)\1/g
];
var VITE_BUILTIN = new Set(["MODE", "DEV", "PROD", "SSR", "BASE_URL"]);
function discoverSettings(original, io) {
  const names = new Set;
  for (const f of io.walk(original, SKIP)) {
    if (IS_TEST.test(f) || !CODE.test(f) && !PY.test(f))
      continue;
    const text = io.readFile(join(original, f));
    if (text === null)
      continue;
    for (const re of ENV_READS)
      for (const m of text.matchAll(re))
        if (!VITE_BUILTIN.has(m[2] ?? m[1]))
          names.add(m[2] ?? m[1]);
  }
  return [...names].sort();
}
function discoverColors(original, io) {
  const colors = new Set;
  for (const f of io.walk(original, SKIP)) {
    if (!/\.(?:css|scss|sass|less)$/i.test(f))
      continue;
    const text = (io.readFile(join(original, f)) ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const d of text.matchAll(/[\w-]+\s*:\s*([^;{}]+)(?=[;}]|$)/g)) {
      for (const c of d[1].replace(/url\([^)]*\)/gi, " ").matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g))
        colors.add(`#${c[1].toLowerCase()}`);
    }
  }
  return [...colors].sort();
}
function pageSlug(path) {
  const slug = path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return slug === "" ? "home" : slug;
}
var readJson = (text) => {
  if (text === null)
    return { ok: false, why: "not found" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, why: "not valid JSON" };
  }
};
async function checkMap(folder, io) {
  const dir = folder === "" ? io.cwd : folder;
  const original = originalOf(io.readFile(join(dir, ".dkod/migration.json")));
  if (original === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const mapDir = join(dir, ".dkod/map");
  const problems = [];
  const missing = [];
  const noShot = [];
  const counts = { routes: 0, pages: 0, stores: 0, tables: 0, services: 0, settings: 0, queries: 0, functions: 0, design: 0, found_routes: 0, screenshots: 0, assets: 0 };
  const parsed = readJson(io.readFile(join(mapDir, "app-map.json")));
  const designFiles = new Set(io.walk(join(mapDir, "design"), []));
  let map = null;
  if (!parsed.ok)
    problems.push(`app-map.json: ${parsed.why}`);
  else {
    problems.push(...validateMap(parsed.value));
    if (isRec(parsed.value))
      map = parsed.value;
  }
  const list = (key) => map !== null && Array.isArray(map[key]) ? map[key].filter(isRec) : [];
  const routes = list("routes");
  const pages = list("pages");
  for (const key of ["routes", "pages", "stores", "tables", "services", "settings", "queries", "functions"])
    counts[key] = map !== null && Array.isArray(map[key]) ? map[key].length : 0;
  const design = map !== null && isRec(map.design) ? map.design : {};
  const designList = (k) => Array.isArray(design[k]) ? design[k].filter((s) => typeof s === "string") : [];
  counts.design = ["colors", "fonts", "buttons", "tooltips"].reduce((n, k) => n + designList(k).length, 0);
  const mapped = [...routes, ...pages].flatMap((r) => typeof r.path === "string" ? [normalizeRoute(r.path)] : []);
  const found = discoverRoutes(original, io);
  counts.found_routes = found.length;
  for (const r of found) {
    const covered = mapped.includes(r.path) || r.relative && mapped.some((m) => m.endsWith(r.path));
    if (!covered)
      missing.push(r.path);
  }
  if (found.length === 0 && mapped.length > 0)
    problems.push("original: no route found in its router files, check that `original` in .dkod/migration.json is the app's folder");
  const missingTables = [];
  const missingColumns = [];
  if (map !== null) {
    const mappedTables = new Map;
    for (const t of list("tables")) {
      if (typeof t.name !== "string")
        continue;
      const set = mappedTables.get(t.name.toLowerCase()) ?? new Set;
      for (const c of Array.isArray(t.columns) ? t.columns : [])
        if (typeof c === "string")
          set.add(c.toLowerCase());
      mappedTables.set(t.name.toLowerCase(), set);
    }
    for (const [name, cols] of discoverTables(original, io)) {
      const have = mappedTables.get(name.toLowerCase());
      if (have === undefined) {
        missingTables.push(name);
        continue;
      }
      for (const c of cols)
        if (!have.has(c.toLowerCase()))
          missingColumns.push(`${name}.${c}`);
    }
  }
  const mappedSettings = new Set(list("settings").flatMap((s) => typeof s.name === "string" ? [s.name] : []));
  const missingSettings = map === null ? [] : discoverSettings(original, io).filter((n) => !mappedSettings.has(n));
  const mappedColors = new Set(designList("colors").map((c) => c.toLowerCase()));
  const missingColors = map === null ? [] : discoverColors(original, io).filter((c) => !mappedColors.has(c));
  for (const page of pages) {
    if (typeof page.path !== "string")
      continue;
    const slug = pageSlug(page.path);
    const states = new Set(["default", ...Array.isArray(page.states) ? page.states.filter((s) => typeof s === "string") : []]);
    for (const state of states) {
      const base = `pages/${slug}/${state}`;
      if (designFiles.has(`${base}.png`))
        counts.screenshots = (counts.screenshots ?? 0) + 1;
      else if (state === "default")
        noShot.push(page.path);
      else
        problems.push(`design/${base}.png: missing, the page ${page.path} lists the state ${state}`);
      if (!designFiles.has(`${base}.json`))
        problems.push(`design/${base}.json: missing, computed styles of ${page.path} (${state})`);
    }
  }
  const assets = readJson(io.readFile(join(mapDir, "assets/assets.json")));
  if (!assets.ok)
    problems.push(`assets/assets.json: ${assets.why}`);
  else if (!Array.isArray(assets.value))
    problems.push("assets/assets.json: must be a list of {kind, path}");
  else {
    const originalFiles = new Set(io.walk(original, SKIP));
    counts.assets = assets.value.length;
    assets.value.forEach((a, i) => {
      if (!isRec(a))
        return problems.push(`assets[${i}]: must be an object {kind, path}`);
      if (typeof a.kind !== "string" || !ASSET_KINDS.includes(a.kind))
        problems.push(`assets[${i}].kind: must be one of ${ASSET_KINDS.join(", ")}`);
      if (typeof a.path !== "string" || !safeFile(a.path))
        problems.push(`assets[${i}].path: must be a path inside the original, with no '..'`);
      else if (!originalFiles.has(a.path))
        problems.push(`assets[${i}].path: ${a.path} is not a file in the original`);
    });
  }
  const report = {
    ok: problems.length === 0 && missing.length === 0 && noShot.length === 0 && missingTables.length === 0 && missingColumns.length === 0 && missingSettings.length === 0 && missingColors.length === 0,
    counts,
    missing_routes: missing,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    missing_settings: missingSettings,
    missing_colors: missingColors,
    pages_without_screenshot: noShot,
    problems
  };
  io.print(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

var join2 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
var TITLE = /\b(?:test|it)(?:\.(?:only|fixme|slow))?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
var isRec2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var list2 = (v) => Array.isArray(v) ? v.filter(isRec2) : [];
var same = (a, b) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
var freezePath = (dir) => join2(dir, ".dkod/parity/freeze.json");
function testTitles(text) {
  return [...text.matchAll(TITLE)].map((m) => m[2]);
}
function reportTests(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRec2(json) || !Array.isArray(json.suites))
    return null;
  const out = [];
  const visit = (suite) => {
    for (const spec of list2(suite.specs)) {
      const title = typeof spec.title === "string" ? spec.title : "";
      const tests = list2(spec.tests);
      const statuses = tests.map((t) => typeof t.status === "string" ? t.status : "unexpected");
      const status = statuses.length === 0 ? "skipped" : statuses.find((s) => s !== "expected") ?? "expected";
      out.push({ title, ok: spec.ok === true && status === "expected", status });
    }
    for (const sub of list2(suite.suites))
      visit(sub);
  };
  for (const s of list2(json.suites))
    visit(s);
  return out;
}
function suiteFiles(dir, io) {
  const files = io.walk(join2(dir, "tests/parity"), ["node_modules"]).map((rel) => `tests/parity/${rel}`);
  return files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
function tagsOf(title) {
  const out = [];
  let m;
  if ((m = /@api\s+([A-Za-z]+)\s+(\/\S*)/.exec(title)) !== null)
    out.push({ kind: "api", key: `${m[1].toUpperCase()} ${normalizeRoute(m[2])}` });
  if ((m = /@page\s+(\/\S*)/.exec(title)) !== null)
    out.push({ kind: "page", key: normalizeRoute(m[1]) });
  if ((m = /@flow\s+(.+)$/.exec(title)) !== null)
    out.push({ kind: "flow", key: m[1].trim() });
  if (/@data\b/.test(title))
    out.push({ kind: "data", key: "" });
  if ((m = /@design\s+(\/\S*)\s+([a-z_]+)/.exec(title)) !== null)
    out.push({ kind: "design", key: `${normalizeRoute(m[1])} ${m[2]}` });
  return out;
}
var fail = (io, report) => {
  io.print(JSON.stringify({ ok: false, missing: { routes: [], pages: [], flows: [], data: [], design: [] }, original_failures: [], ...report }));
  return 1;
};
var PACKAGE_FILES = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"]);
async function freeze(folder, reportFile, io) {
  const dir = folder === "" ? io.cwd : folder;
  const packaged = new Set;
  for (const f of io.walk(join2(dir, "tests/parity"), [])) {
    const parts = f.split("/");
    const nm = parts.indexOf("node_modules");
    if (nm >= 0)
      packaged.add(parts.slice(0, nm + 1).join("/"));
    else if (PACKAGE_FILES.has(parts[parts.length - 1]))
      packaged.add(f);
  }
  if (packaged.size > 0) {
    return fail(io, { problems: [...packaged].map((f) => `tests/parity/${f}: a package file or node_modules does not belong in the suite. Keep package.json, the lockfile and node_modules at the dk- folder root, and delete this.`) });
  }
  if (originalOf(io.readFile(join2(dir, ".dkod/migration.json"))) === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  if (reportFile === undefined)
    return fail(io, { problems: ["freeze needs the Playwright JSON report of the run on the original: freeze <folder> <report.json>"] });
  let map;
  try {
    const parsed = JSON.parse(io.readFile(join2(dir, ".dkod/map/app-map.json")) ?? "");
    if (!isRec2(parsed))
      throw new Error("not an object");
    map = parsed;
  } catch {
    return fail(io, { problems: [".dkod/map/app-map.json: missing or not valid JSON. Do the map step, and run check-map, first."] });
  }
  const specs = io.walk(join2(dir, "tests/parity"), []).filter((f) => TEST_FILE.test(f));
  if (specs.length === 0)
    return fail(io, { problems: ["tests/parity: no test file found. Write the parity suite there first."] });
  const reportText = io.readFile(reportFile);
  if (reportText === null)
    return fail(io, { problems: [`${reportFile}: not found. Run the suite on the original with --reporter=json and write the output there.`] });
  const run = reportTests(reportText);
  if (run === null || run.length === 0)
    return fail(io, { problems: [`${reportFile}: not a Playwright JSON report with tests (use --reporter=json).`] });
  const failures = run.filter((t) => !t.ok).map((t) => `${t.title} (${t.status})`);
  const passed = new Set(run.filter((t) => t.ok).map((t) => t.title));
  const have = new Map;
  const notRun = [];
  let tagged = 0;
  for (const f of specs) {
    for (const title of testTitles(io.readFile(join2(dir, `tests/parity/${f}`)) ?? "")) {
      const tags = tagsOf(title);
      if (tags.length === 0)
        continue;
      if (!run.some((t) => t.title === title)) {
        notRun.push(`${title} (not in the report)`);
        continue;
      }
      if (!passed.has(title))
        continue;
      tagged += 1;
      for (const t of tags)
        have.set(t.kind, (have.get(t.kind) ?? new Set).add(t.key));
    }
  }
  const got = (kind) => [...have.get(kind) ?? []];
  const routes = [];
  const pages = [];
  for (const r of list2(map.routes)) {
    if (typeof r.path !== "string")
      continue;
    const path = normalizeRoute(r.path);
    const method = typeof r.method === "string" ? r.method.toUpperCase() : "ANY";
    if (r.kind === "api") {
      const hit = got("api").some((k) => method === "ANY" ? k.endsWith(` ${path}`) : k === `${method} ${path}`);
      if (!hit && !routes.includes(`${method} ${path}`))
        routes.push(`${method} ${path}`);
    } else if (r.kind === "page" && !got("page").includes(path) && !pages.includes(path))
      pages.push(path);
  }
  const designFiles = new Set(io.walk(join2(dir, ".dkod/map/design"), []));
  const design = [];
  for (const p of list2(map.pages)) {
    if (typeof p.path !== "string")
      continue;
    const path = normalizeRoute(p.path);
    if (!got("page").includes(path) && !pages.includes(path))
      pages.push(path);
    const states = new Set(["default", ...Array.isArray(p.states) ? p.states.filter((s) => typeof s === "string") : []]);
    for (const state of states) {
      if (!designFiles.has(`pages/${pageSlug(p.path)}/${state}.png`))
        continue;
      if (!got("design").includes(`${path} ${state}`))
        design.push(`${path} ${state}`);
    }
  }
  const flows = list2(map.flows).flatMap((f) => typeof f.name === "string" && !got("flow").some((k) => same(k, f.name)) ? [f.name] : []);
  const data = list2(map.stores).length > 0 && got("data").length === 0 ? ["@data"] : [];
  const missing = { routes, pages, flows, data, design };
  const gaps = routes.length + pages.length + flows.length + data.length + design.length;
  const original_failures = [...failures, ...notRun];
  if (gaps > 0 || original_failures.length > 0) {
    return fail(io, { missing, original_failures, counts: { tests: run.length, original_passed: passed.size, original_failed: original_failures.length } });
  }
  const files = suiteFiles(dir, io);
  const sha256 = io.sha256(files.map((f) => join2(dir, f)));
  const record = { sha256, files, baseline: { tests: run.map((t) => t.title), passed: passed.size }, frozenAt: new Date().toISOString() };
  io.writeFile(freezePath(dir), `${JSON.stringify(record, null, 2)}
`);
  io.print(JSON.stringify({ ok: true, sha256, counts: { tests: run.length, tagged, original_passed: passed.size, original_failed: 0 }, missing, original_failures: [] }));
  return 0;
}
async function unfreeze(folder, io) {
  const dir = folder === "" ? io.cwd : folder;
  if (originalOf(io.readFile(join2(dir, ".dkod/migration.json"))) === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const had = io.readFile(freezePath(dir)) !== null;
  io.rm(freezePath(dir), { force: true });
  io.print(JSON.stringify({
    ok: true,
    mode: "unfreeze",
    was_frozen: had,
    message: "The parity suite is open again. A changed suite has a new sha256 that the server will not match: start the attempt again (dkoder.migrate.start), write the changes, run the suite on the original, and freeze again."
  }));
  return 0;
}

var join3 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var SKIP2 = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor", ".dkod"];
var SOURCE = /\.[cm]?[jt]sx?$/;
var DATA = /\.(?:sqlite|sqlite3|db|db3)$/i;
var isRec3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json = (text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
};
var base = (p) => p.split("/").pop() ?? p;
function ignoresEnvLocal(text) {
  return text.split(`
`).some((raw) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!"))
      return false;
    const pattern = line.replace(/^\//, "");
    return pattern === ".env.local" || pattern === ".env*" || pattern === ".env.*" || pattern === "*.local" || pattern === ".env*.local";
  });
}
async function checkBuild(folder, reportFile, io) {
  const dir = folder === "" ? io.cwd : folder;
  const original = originalOf(io.readFile(join3(dir, ".dkod/migration.json")));
  if (original === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const problems = [];
  const new_failed = [];
  let tests = 0;
  let newPassed = 0;
  let visual = 0;
  const frozen = json(io.readFile(freezePath(dir)));
  if (!isRec3(frozen) || typeof frozen.sha256 !== "string" || !isRec3(frozen.baseline) || !Array.isArray(frozen.baseline.tests)) {
    problems.push(".dkod/parity/freeze.json: missing. Freeze the suite (step 3) before the build is checked.");
  } else {
    const record = frozen;
    const files = suiteFiles(dir, io);
    if (files.length === 0 || io.sha256(files.map((f) => join3(dir, f))) !== record.sha256) {
      problems.push("tests/parity: the suite changed after the freeze (sha256 differs). Put the frozen files back; never edit them.");
    }
    const reportText = reportFile === undefined ? null : io.readFile(reportFile);
    const run = reportText === null ? null : reportTests(reportText);
    if (reportFile === undefined)
      problems.push("check-build needs the Playwright JSON report of the frozen suite run on the dk- app: check-build <folder> <report.json>");
    else if (run === null)
      problems.push(`${reportFile}: not found or not a Playwright JSON report (use --reporter=json).`);
    else {
      const byTitle = new Map(run.map((t) => [t.title, t]));
      for (const title of record.baseline.tests) {
        tests += 1;
        const t = byTitle.get(title);
        if (t?.ok === true) {
          newPassed += 1;
          continue;
        }
        new_failed.push(title);
        if (tagsOf(title).some((tag) => tag.kind === "design") && t !== undefined)
          visual += 1;
        problems.push(`${title}: ${t === undefined ? "not in the report" : `failed (${t.status})`} on the dk- app`);
      }
    }
  }
  const sources = io.walk(dir, SKIP2);
  const map = json(io.readFile(join3(dir, ".dkod/map/app-map.json")));
  const tables = isRec3(map) && Array.isArray(map.tables) ? map.tables.filter(isRec3).flatMap((t) => typeof t.name === "string" ? [t.name] : []) : [];
  if (tables.length > 0) {
    const text = sources.filter((f) => SOURCE.test(f) && !/^(?:tests|migrations)\//.test(f)).map((f) => io.readFile(join3(dir, f)) ?? "").join(`
`);
    for (const name of tables) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(["'\`])${esc}\\1`).test(text))
        problems.push(`table ${name}: named in no source file of the dk- app. Write its schema.`);
    }
  }
  if (!sources.some((f) => /^migrations\/0001_baseline[^/]*$/.test(f)))
    problems.push("migrations/: no 0001_baseline migration. Generate it from the schema.");
  for (const f of sources)
    if (DATA.test(f))
      problems.push(`${f}: a file database in the dk- folder. The data lives in the Dev data service.`);
  const assets = json(io.readFile(join3(dir, ".dkod/map/assets/assets.json")));
  if (Array.isArray(assets)) {
    for (const a of assets.filter(isRec3)) {
      if (typeof a.path !== "string")
        continue;
      const source = join3(original, a.path);
      if (io.readFile(source) === null) {
        problems.push(`asset ${a.path}: not readable in the original at ${source}.`);
        continue;
      }
      const want = io.sha256([source]);
      const same = sources.some((f) => base(f) === base(a.path) && io.sha256([join3(dir, f)]) === want);
      if (!same)
        problems.push(`asset ${a.path}: no byte-identical copy in the dk- folder. Copy the file as it is; never redraw it.`);
    }
  }
  if (io.readFile(join3(dir, ".env.local")) !== null && !ignoresEnvLocal(io.readFile(join3(dir, ".gitignore")) ?? "")) {
    problems.push(".env.local: not covered by .gitignore. Add it before anything is committed.");
  }
  const ok = problems.length === 0;
  io.print(JSON.stringify({ ok, problems, new_failed, counts: { tests, new_passed: newPassed, new_failed: new_failed.length, visual_diff: visual } }));
  return ok ? 0 : 1;
}

var join4 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var isRec4 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json2 = (text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
};
var READY = "Ready to deploy";
var NOT_YET = "Not yet";
async function sideBySide(folder, originalReport, dkReport, io) {
  const dir = folder === "" ? io.cwd : folder;
  if (originalOf(io.readFile(join4(dir, ".dkod/migration.json"))) === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const problems = [];
  const original = { tests: 0, passed: 0, failed: 0 };
  const dk = { tests: 0, passed: 0, failed: 0 };
  let visual = 0;
  const frozen = json2(io.readFile(freezePath(dir)));
  if (!isRec4(frozen) || typeof frozen.sha256 !== "string" || !isRec4(frozen.baseline) || !Array.isArray(frozen.baseline.tests)) {
    problems.push(".dkod/parity/freeze.json: missing. Freeze the suite (step 3) first.");
  } else {
    const record = frozen;
    const files = suiteFiles(dir, io);
    if (files.length === 0 || io.sha256(files.map((f) => join4(dir, f))) !== record.sha256) {
      problems.push("tests/parity: the suite changed after the freeze (sha256 differs). Put the frozen files back; never edit them.");
    }
    const load = (file, label) => {
      const text = file === undefined ? null : io.readFile(file);
      const run = text === null ? null : reportTests(text);
      if (file === undefined)
        problems.push("side-by-side needs both reports: side-by-side <folder> <original report.json> <dk report.json>");
      else if (run === null)
        problems.push(`${file}: not found or not a Playwright JSON report (use --reporter=json) for the ${label}.`);
      return run === null ? null : new Map(run.map((t) => [t.title, t]));
    };
    const onOriginal = load(originalReport, "original app");
    const onDk = load(dkReport, "dk- app");
    for (const title of record.baseline.tests) {
      if (onOriginal !== null) {
        original.tests += 1;
        if (onOriginal.get(title)?.ok === true)
          original.passed += 1;
        else {
          original.failed += 1;
          const o = onOriginal.get(title);
          problems.push(`${title}: ${o === undefined ? "not in the report" : `failed (${o.status})`} on the original app`);
        }
      }
      if (onDk !== null) {
        dk.tests += 1;
        const t = onDk.get(title);
        if (t?.ok === true)
          dk.passed += 1;
        else {
          dk.failed += 1;
          if (t !== undefined && tagsOf(title).some((tag) => tag.kind === "design"))
            visual += 1;
          problems.push(`${title}: ${t === undefined ? "not in the report" : `failed (${t.status})`} on the dk- app`);
        }
      }
    }
  }
  const map = json2(io.readFile(join4(dir, ".dkod/map/app-map.json")));
  const count = (key) => isRec4(map) && Array.isArray(map[key]) ? map[key].length : 0;
  const snapshot = json2(io.readFile(join4(dir, ".dkod/snapshot.json")));
  const copied = (key) => isRec4(snapshot) && Array.isArray(snapshot[key]) && snapshot[key].length > 0;
  const dataImported = isRec4(snapshot) && snapshot.mode === "snapshot" && (copied("files") || copied("databases"));
  const ok = problems.length === 0;
  io.print(JSON.stringify({
    ok,
    problems,
    report: { routes: count("routes"), flows: count("flows"), pages: count("pages"), original, dk, visual_diff: visual, data_imported: dataImported },
    counts: { tests: dk.tests, original_passed: original.passed, original_failed: original.failed, new_passed: dk.passed, new_failed: dk.failed, visual_diff: visual },
    question: { text: "The dk- app is running next to the original. Does it match, and is it ready to deploy?", options: [READY, NOT_YET] }
  }));
  return ok ? 0 : 1;
}

var USAGE = [
  "Usage:",
  "  node dkod-migrate.mjs snapshot <the dk- app's folder>",
  "  node dkod-migrate.mjs check-map <the dk- app's folder>",
  "  node dkod-migrate.mjs freeze <the dk- app's folder> <report.json>",
  "  node dkod-migrate.mjs unfreeze <the dk- app's folder>",
  "  node dkod-migrate.mjs check-build <the dk- app's folder> <report.json>",
  "  node dkod-migrate.mjs side-by-side <the dk- app's folder> <original report.json> <dk report.json>",
  "  node dkod-migrate.mjs clean <the dk- app's folder>"
].join(`
`);
var NEW_APP_ONLY = "The original app has no data files and no local database this computer can copy. The migration is new-app-only: its tests run only on the dk- app. Ask the builder how the original reads its data.";
var join5 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var norm = (p) => p.replace(/\/\.\//g, "/").replace(/\/+/g, "/");
var snapshotPath = (dir) => join5(dir, ".dkod/snapshot.json");
var recordPath = (dir) => join5(dir, ".dkod/migration.json");
var SKIP3 = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor"];
var DATA2 = /\.(?:sqlite|sqlite3|db|db3)$/i;
var LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
var DB_SCHEMES = new Set(["postgres:", "postgresql:", "mysql:", "mariadb:"]);
function originalOf(text) {
  if (text === null)
    return null;
  try {
    const parsed = JSON.parse(text);
    const original = typeof parsed?.original === "string" ? parsed.original.replace(/\/+$/, "") : "";
    return original === "" ? null : original;
  } catch {
    return null;
  }
}
function envPairs(text) {
  const out = [];
  for (const line of (text ?? "").split(`
`)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m === null)
      continue;
    out.push([m[1], m[2].trim().replace(/^(["'])(.*)\1$/, "$2")]);
  }
  return out;
}
function localDatabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return DB_SCHEMES.has(url.protocol) && LOCAL_HOSTS.has(url.hostname) ? url : null;
}
var databaseOf = (url) => decodeURIComponent(url.pathname.replace(/^\//, "")) || "app";
var scratchName = (source, id) => `${source.replace(/[^A-Za-z0-9_]/g, "_")}_dkod_migrate_${id}`.slice(0, 63);
function connection(url) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port || (url.protocol.startsWith("postgres") ? "5432" : "3306");
  const password = url.password === "" ? null : { [url.protocol.startsWith("postgres") ? "PGPASSWORD" : "MYSQL_PWD"]: decodeURIComponent(url.password) };
  return { host, port, user: decodeURIComponent(url.username), env: password ?? {} };
}
function withDatabase(value, name) {
  const url = new URL(value);
  url.pathname = `/${name}`;
  url.password = "";
  return url.toString();
}
function copiedFile(original, files, value) {
  const isUrl = value.startsWith("file:");
  const raw = isUrl ? value.slice(5) : value;
  if (raw === "" || !isUrl && /^[a-z][a-z0-9+.-]*:/i.test(raw))
    return null;
  const rel = norm(raw.startsWith("/") ? raw : join5(original, raw)).slice(norm(original).length).replace(/^\//, "");
  if (rel === "")
    return null;
  const copy = files.find((f) => norm(f).endsWith(`/${rel}`));
  return copy === undefined ? null : `${isUrl ? "file:" : ""}${copy}`;
}
async function copyDatabase(value, scratch, id, io) {
  const url = localDatabase(value);
  if (url === null)
    return null;
  const source = databaseOf(url);
  const name = scratchName(source, id);
  const { host, port, user, env } = connection(url);
  const tools = ["pg_dump", "psql", "createdb", "dropdb"];
  if (url.protocol.startsWith("postgres")) {
    for (const tool of tools)
      if (!io.hasTool(tool))
        return null;
    const dump = `${scratch}/${name}.sql`;
    const connect = ["-h", host, "-p", port, ...user ? ["-U", user] : []];
    if ((await io.run("pg_dump", ["--dbname", value, "--file", dump], env, io.cwd)).status !== 0)
      return null;
    if ((await io.run("createdb", [...connect, name], env, io.cwd)).status !== 0)
      return null;
    if ((await io.run("psql", [...connect, "-d", name, "-f", dump], env, io.cwd)).status !== 0)
      return null;
    return { name, url: withDatabase(value, name) };
  }
  for (const tool of ["mysqldump", "mysql"])
    if (!io.hasTool(tool))
      return null;
  const dump = `${scratch}/${name}.sql`;
  const connect = ["-h", host, "-P", port, ...user ? ["-u", user] : []];
  const dumped = await io.run("mysqldump", [...connect, source], env, io.cwd);
  if (dumped.status !== 0)
    return null;
  io.writeFile(dump, dumped.stdout);
  if ((await io.run("mysql", [...connect, "-e", `CREATE DATABASE \`${name}\``], env, io.cwd)).status !== 0)
    return null;
  if ((await io.run("mysql", [...connect, name, "-e", `source ${dump}`], env, io.cwd)).status !== 0)
    return null;
  return { name, url: withDatabase(value, name) };
}
async function dropDatabase(db, io) {
  const url = localDatabase(db.url);
  if (url === null)
    return;
  const { host, port, user, env } = connection(url);
  if (url.protocol.startsWith("postgres"))
    await io.run("dropdb", ["-h", host, "-p", port, ...user ? ["-U", user] : [], db.name], env, io.cwd);
  else
    await io.run("mysql", ["-h", host, "-P", port, ...user ? ["-u", user] : [], "-e", `DROP DATABASE IF EXISTS \`${db.name}\``], env, io.cwd);
}
async function removeSnapshot(dir, io) {
  const text = io.readFile(snapshotPath(dir));
  if (text === null)
    return null;
  let record = null;
  try {
    record = JSON.parse(text);
  } catch {
    record = null;
  }
  if (record !== null) {
    if (typeof record.scratch === "string" && record.scratch !== "")
      io.rm(record.scratch, { recursive: true, force: true });
    for (const db of record.databases ?? [])
      await dropDatabase(db, io);
  }
  io.rm(snapshotPath(dir), { force: true });
  return record;
}
async function snapshot(folder, io) {
  const dir = folder === "" ? io.cwd : folder;
  const original = originalOf(io.readFile(recordPath(dir)));
  if (original === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  await removeSnapshot(dir, io);
  const scratch = io.mkdtemp(join5(io.tmpdir(), "dkod-migrate-"));
  const id = (scratch.split(/[\\/]/).pop() ?? "run").replace(/[^A-Za-z0-9]/g, "_");
  const files = [];
  for (const rel of io.walk(original, SKIP3)) {
    if (!DATA2.test(rel))
      continue;
    const to = join5(scratch, rel);
    io.copyFile(join5(original, rel), to);
    files.push(to);
  }
  const env = { DKOD_MIGRATE_DATA: scratch };
  const databases = [];
  for (const file of [".env", ".env.local"]) {
    for (const [key, value] of envPairs(io.readFile(join5(original, file)))) {
      const copied = copiedFile(original, files, value);
      if (copied !== null) {
        env[key] = copied;
        continue;
      }
      const db = await copyDatabase(value, scratch, id, io);
      if (db !== null) {
        databases.push(db);
        env[key] = db.url;
      }
    }
  }
  const empty = files.length === 0 && databases.length === 0;
  if (empty)
    io.rm(scratch, { recursive: true, force: true });
  const record = {
    ok: true,
    mode: empty ? "new-app-only" : "snapshot",
    scratch: empty ? "" : scratch,
    files,
    databases,
    env: empty ? {} : env,
    ...empty ? { message: NEW_APP_ONLY } : {}
  };
  io.writeFile(snapshotPath(dir), `${JSON.stringify(record, null, 2)}
`);
  io.print(JSON.stringify(record));
  return 0;
}
async function clean(folder, io) {
  const dir = folder === "" ? io.cwd : folder;
  const record = await removeSnapshot(dir, io);
  io.rm(recordPath(dir), { force: true });
  io.print(JSON.stringify({ ok: true, mode: "clean", removed: record?.scratch ?? null, databases: (record?.databases ?? []).map((d) => d.name) }));
  return 0;
}
async function runMigrateCli(argv, io) {
  const [command, folder, reportFile, dkReportFile] = argv;
  if (command === "side-by-side" && folder !== undefined)
    return await sideBySide(folder, reportFile, dkReportFile, io);
  if (command === "freeze" && folder !== undefined)
    return await freeze(folder, reportFile, io);
  if (command === "unfreeze" && folder !== undefined)
    return await unfreeze(folder, io);
  if (command === "check-build" && folder !== undefined)
    return await checkBuild(folder, reportFile, io);
  if (command === "snapshot" && folder !== undefined)
    return await snapshot(folder, io);
  if (command === "clean" && folder !== undefined)
    return await clean(folder, io);
  if (command === "check-map" && folder !== undefined)
    return await checkMap(folder, io);
  io.print(USAGE);
  return 2;
}

function walk(dir, skip) {
  const out = [];
  const visit = (at, rel) => {
    let names;
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) {
      if (skip.includes(name))
        continue;
      const full = join6(at, name);
      const next = rel === "" ? name : `${rel}/${name}`;
      if (statSync(full).isDirectory())
        visit(full, next);
      else
        out.push(next);
    }
  };
  visit(dir, "");
  return out;
}
var io = {
  cwd: process.cwd(),
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
  sha256: (paths) => {
    const hash = createHash("sha256");
    for (const path of paths)
      hash.update(readFileSync(path));
    return hash.digest("hex");
  },
  walk,
  copyFile: (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  },
  rm: (path, opts) => rmSync(path, { recursive: opts.recursive ?? false, force: opts.force ?? false }),
  mkdtemp: (prefix) => mkdtempSync(prefix),
  tmpdir,
  hasTool: (program) => (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").some((dir) => dir !== "" && existsSync(join6(dir, program))),
  print: (line) => process.stdout.write(`${line}
`),
  run: (cmd, args, env, cwd) => new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", () => resolve({ status: 127, stdout, stderr: `${stderr}Could not start ${cmd}.
` }));
    child.on("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
  })
};
process.exitCode = await runMigrateCli(process.argv.slice(2), io);
