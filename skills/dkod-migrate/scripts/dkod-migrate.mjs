// Built by packages/dkoder-plugin/scripts/build-migrate.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:migrate`.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join as join7 } from "node:path";

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
var MAX_LIST_ENTRIES = 32;
function listProblems(params, key, opts = {}) {
  const v = params[key];
  if (v === undefined)
    return opts.required ? [`"${key}" is required`] : [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length === 0 || x.length > 200))
    return [`"${key}" must be a list of short strings`];
  if (v.length > (opts.max ?? MAX_LIST_ENTRIES))
    return [`"${key}" may hold at most ${opts.max ?? MAX_LIST_ENTRIES} entries`];
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
var DEFAULT_FOLDER_PREFIX = "dk-";
var DRIVER_ENGINE = {
  pg: "postgres",
  postgres: "postgres",
  sqlite3: "sqlite",
  "better-sqlite3": "sqlite",
  "@libsql/client": "sqlite",
  mysql: "mysql",
  mysql2: "mysql",
  mariadb: "mysql",
  mongodb: "mongodb",
  mongoose: "mongodb",
  mssql: "mssql",
  oracledb: "oracle"
};
var ENGINE_ALIAS = { postgresql: "postgres", mongo: "mongodb", sqlite3: "sqlite" };
var DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
var LOCKFILE_BY_MANAGER = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  yarn: ["yarn.lock"],
  pnpm: ["pnpm-lock.yaml"],
  bun: ["bun.lock", "bun.lockb"]
};
var ALL_LOCKFILES = [...new Set(Object.values(LOCKFILE_BY_MANAGER).flat())];
var FILE_DATABASE = /\.(?:db|sqlite)$/;
function stackFiles(dir) {
  return [`${dir}/package.json`, `${dir}/{${ALL_LOCKFILES.join(",")}}`, `${dir}/*.db`, `${dir}/*.sqlite`];
}
function stackGlobs(folderPrefix) {
  return stackFiles(`**/${folderPrefix}*/**`);
}
var STACK_FOLDER_PATHS = stackFiles("**");
function textProblem(params, key) {
  const v = params[key];
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? [] : [`"${key}" must be a short string`];
}
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
  "migration.stack": {
    id: "migration.stack",
    scope: "file",
    title: "A dk- app uses only the stack in migration.yaml",
    summary: "Inside a dk- folder: no denied dependency, the stack's package manager and database only, and no file database.",
    paths: stackGlobs(DEFAULT_FOLDER_PREFIX),
    folderPaths: STACK_FOLDER_PATHS,
    pathsFor: (params) => stackGlobs(typeof params.folder_prefix === "string" && params.folder_prefix !== "" ? params.folder_prefix : DEFAULT_FOLDER_PREFIX),
    byName: true,
    textPaths: ["**/package.json"],
    exclude: [],
    params: [
      { name: "folder_prefix", kind: "string", hint: "The prefix of a migration app folder, from migration.yaml." },
      { name: "deny_dependencies", kind: "strings", hint: "Package names the stack refuses, from migration.yaml." },
      { name: "database_engine", kind: "string", hint: "The database engine the stack uses, for example postgres." },
      { name: "package_manager", kind: "string", hint: "The one package manager the stack uses, for example bun." }
    ],
    validate: (p) => [
      ...p.folder_prefix === undefined ? [] : textProblem(p, "folder_prefix"),
      ...listProblems(p, "deny_dependencies"),
      ...textProblem(p, "database_engine"),
      ...textProblem(p, "package_manager")
    ],
    runFile(file, params) {
      const base = file.path.split("/").pop() ?? file.path;
      const deny = new Set(stringList(params, "deny_dependencies") ?? []);
      const engine = typeof params.database_engine === "string" ? params.database_engine.trim().toLowerCase() : "";
      const stack = ENGINE_ALIAS[engine] ?? engine;
      const manager = typeof params.package_manager === "string" ? params.package_manager.trim().toLowerCase() : "";
      if (ALL_LOCKFILES.includes(base) && !(LOCKFILE_BY_MANAGER[manager] ?? []).includes(base))
        return [{ path: file.path, line: null, detail: `${base} belongs to a package manager other than ${manager}` }];
      if (FILE_DATABASE.test(base))
        return [{ path: file.path, line: null, detail: `${base} is a file database; the stack uses ${engine}` }];
      if (base !== "package.json")
        return [];
      let doc;
      try {
        doc = JSON.parse(file.text);
      } catch {
        return [];
      }
      const root = typeof doc === "object" && doc !== null && !Array.isArray(doc) ? doc : {};
      const lineOf = (key, from = 0) => {
        const at = file.text.indexOf(`"${key}"`, from);
        return at === -1 ? null : file.text.slice(0, at).split(/\r?\n/).length;
      };
      const hits = [];
      for (const field of DEPENDENCY_FIELDS) {
        const deps = root[field];
        if (typeof deps !== "object" || deps === null || Array.isArray(deps))
          continue;
        const fieldAt = Math.max(0, file.text.indexOf(`"${field}"`));
        for (const name of Object.keys(deps)) {
          const driver = DRIVER_ENGINE[name];
          if (deny.has(name) || driver !== undefined && driver !== stack)
            hits.push({ path: file.path, line: lineOf(name, fieldAt), detail: `${name} is not in the stack` });
        }
      }
      const pm = typeof root.packageManager === "string" ? root.packageManager : "";
      if (pm !== "" && manager !== "" && pm.replace(/@.*$/, "").toLowerCase() !== manager)
        hits.push({ path: file.path, line: lineOf("packageManager"), detail: `packageManager is not ${manager}` });
      return hits;
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

var IGNORED_BASENAMES = new Set(["readme.md", "license", "license.md", "licence", "licence.md"]);
var MAX_ASSET_BYTES = 512 * 1024;
function splitFrontMatter(source) {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  if (!/^---\r?\n/.test(text))
    return { front: null, body: text };
  const end = text.indexOf(`
---`, 3);
  if (end === -1)
    return { front: null, body: text };
  const after = text.slice(end + 4);
  if (!/^\r?\n/.test(after) && after !== "")
    return { front: null, body: text };
  const body = after.replace(/^\r?\n/, "").replace(/^\r?\n/, "");
  return { front: text.slice(4, end), body };
}

import { randomUUID } from "node:crypto";

class TemplateError extends Error {
  detail;
  constructor(message, detail = "") {
    super(message);
    this.name = "TemplateError";
    this.detail = detail;
  }
}
var NAMESPACES = new Set(["app", "policy", "answers", "dkod"]);
var PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
var TOKEN_RE = /\{\{([^{}]*)\}\}/g;
var EACH_OPEN_RE = /^#each\s+(.+)$/;
var IF_OPEN_RE = /^#if\s+(.+)$/;
function rootOf(path) {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot);
}
function isOurPath(path) {
  if (path === "@index")
    return true;
  if (!PATH_RE.test(path))
    return false;
  const root = rootOf(path);
  return NAMESPACES.has(root) || root === "this";
}
function isLoopBound(path) {
  return path === "@index" || path === "this" || path.startsWith("this.");
}
function resolvePath(ctx, path) {
  let cursor = ctx;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object")
      return;
    if (!Object.prototype.hasOwnProperty.call(cursor, segment))
      return;
    cursor = cursor[segment];
  }
  return cursor;
}
function truthy(value) {
  if (value === undefined || value === null || value === false)
    return false;
  if (value === "" || value === 0)
    return false;
  if (Array.isArray(value))
    return value.length > 0;
  return Boolean(value);
}
function parse(source) {
  const root = [];
  const stack = [];
  const target = () => {
    const top = stack[stack.length - 1];
    if (!top)
      return root;
    return top.otherwise ?? top.body;
  };
  const insideEach = () => stack.some((frame) => frame.kind === "each");
  const assertBlockPath = (path, raw) => {
    if (!isOurPath(path)) {
      throw new TemplateError(`${raw} names ${path}, which is outside the app, policy, answers and dkod namespaces`, raw);
    }
    if (isLoopBound(path) && !insideEach()) {
      throw new TemplateError(`${raw} uses a loop binding outside an {{#each}}`, raw);
    }
  };
  TOKEN_RE.lastIndex = 0;
  let cut = 0;
  let match;
  while ((match = TOKEN_RE.exec(source)) !== null) {
    if (match.index > cut)
      target().push({ kind: "text", text: source.slice(cut, match.index) });
    cut = TOKEN_RE.lastIndex;
    const raw = match[0];
    const body = (match[1] ?? "").trim();
    const each = EACH_OPEN_RE.exec(body);
    if (each) {
      const path = each[1].trim();
      assertBlockPath(path, raw);
      if (stack.length >= 6)
        throw new TemplateError(`${raw} nests more than six blocks deep`, raw);
      stack.push({ kind: "each", path, body: [], otherwise: null, raw });
      continue;
    }
    const conditional = IF_OPEN_RE.exec(body);
    if (conditional) {
      const path = conditional[1].trim();
      assertBlockPath(path, raw);
      if (stack.length >= 6)
        throw new TemplateError(`${raw} nests more than six blocks deep`, raw);
      stack.push({ kind: "if", path, body: [], otherwise: null, raw });
      continue;
    }
    if (body === "else") {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== "if")
        throw new TemplateError("{{else}} sits outside an {{#if}}", raw);
      if (top.otherwise)
        throw new TemplateError("an {{#if}} has two {{else}} branches", raw);
      top.otherwise = [];
      continue;
    }
    if (body === "/each" || body === "/if") {
      const closes = body === "/each" ? "each" : "if";
      const top = stack.pop();
      if (!top)
        throw new TemplateError(`${raw} closes a block that was never opened`, raw);
      if (top.kind !== closes)
        throw new TemplateError(`${top.raw} is closed by ${raw}`, raw);
      target().push(top.kind === "each" ? { kind: "each", path: top.path, body: top.body } : { kind: "if", path: top.path, then: top.body, otherwise: top.otherwise ?? [] });
      continue;
    }
    if (isLoopBound(body) && !insideEach()) {
      throw new TemplateError(`${raw} is only meaningful inside an {{#each}}`, raw);
    }
    if (!isOurPath(body)) {
      target().push({ kind: "text", text: raw });
      continue;
    }
    target().push({ kind: "scalar", path: body, raw });
  }
  if (cut < source.length)
    target().push({ kind: "text", text: source.slice(cut) });
  const unclosed = stack[stack.length - 1];
  if (unclosed)
    throw new TemplateError(`${unclosed.raw} is never closed`, unclosed.raw);
  return root;
}
function scalarText(value) {
  return typeof value === "string" ? value : String(value);
}
function renderNodes(nodes, scope, out, gaps) {
  for (const node of nodes) {
    if (node.kind === "text") {
      out.push(node.text);
      continue;
    }
    if (node.kind === "scalar") {
      const value = resolvePath(scope, node.path);
      if (value === undefined || value === null) {
        if (!gaps.includes(node.path))
          gaps.push(node.path);
        out.push(node.raw);
        continue;
      }
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        const shape = Array.isArray(value) ? "a list" : typeof value === "object" ? "a mapping" : typeof value;
        throw new TemplateError(`${node.raw} resolves to ${shape}; use {{#each}} or a scalar path`, node.raw);
      }
      out.push(scalarText(value));
      continue;
    }
    if (node.kind === "each") {
      const value = resolvePath(scope, node.path);
      if (!Array.isArray(value))
        continue;
      value.forEach((item, index) => {
        renderNodes(node.body, { ...scope, this: item, "@index": index }, out, gaps);
      });
      continue;
    }
    renderNodes(truthy(resolvePath(scope, node.path)) ? node.then : node.otherwise, scope, out, gaps);
  }
}
function render(source, ctx) {
  const out = [];
  const gaps = [];
  renderNodes(parse(source), ctx, out, gaps);
  return { text: out.join(""), gaps: gaps.map((path) => ({ path })) };
}

var INPUT_TYPES = new Set(["text", "number", "choice", "boolean", "list"]);
var MAX_REPO_PATH = 256;
function safeRepoPath(p) {
  if (typeof p !== "string")
    return false;
  if (p.trim() === "")
    return false;
  if (p.length > MAX_REPO_PATH)
    return false;
  if (p.startsWith("/"))
    return false;
  if (p.includes("\\"))
    return false;
  if (/[\n\r\u2028\u2029\0]/.test(p))
    return false;
  return !p.split("/").some((segment) => segment === "..");
}
var FENCE_OPEN_RE = /^(`{3,})([^\n]*)$/;
var PATH_ATTR_RE = /(?:^|\s)path=(?:"([^"]+)"|'([^']+)'|((?:\{\{[^{}]*\}\}|\S)+))/;
function scanFences(body, lineOffset) {
  const lines = body.split(`
`);
  const blocks = [];
  const errors = [];
  const prose = [];
  const seen = new Set;
  let i = 0;
  while (i < lines.length) {
    const start = i;
    const line = lines[i].replace(/\r$/, "");
    const open = FENCE_OPEN_RE.exec(line);
    if (!open) {
      prose.push(lines[i]);
      i += 1;
      continue;
    }
    const ticks = open[1].length;
    const info = (open[2] ?? "").trim();
    const closeRe = new RegExp("^`{" + String(ticks) + ",}[ \\t]*$");
    let end = i + 1;
    while (end < lines.length && !closeRe.test(lines[end].replace(/\r$/, "")))
      end += 1;
    if (end >= lines.length) {
      errors.push(`unclosed fence opened at line ${String(lineOffset + start + 1)}`);
      break;
    }
    const inner = lines.slice(start + 1, end);
    const attr = PATH_ATTR_RE.exec(info);
    const raw = attr ? (attr[1] ?? attr[2] ?? attr[3] ?? "").trim() : "";
    i = end + 1;
    if (raw === "") {
      prose.push(...lines.slice(start, end + 1));
      continue;
    }
    const firstWord = info.split(/\s+/)[0] ?? "";
    const lang = firstWord.includes("=") ? "" : firstWord;
    const literal = raw.replace(/\{\{[^{}]*\}\}/g, "x");
    if (!safeRepoPath(literal)) {
      errors.push(`unsafe path=${raw} in the fence at line ${String(lineOffset + start + 1)}`);
      continue;
    }
    if (seen.has(raw)) {
      errors.push(`path=${raw} is written by more than one block`);
      continue;
    }
    seen.add(raw);
    blocks.push({ path: raw, lang, body: inner.length > 0 ? inner.join(`
`) + `
` : "" });
  }
  return {
    blocks,
    errors,
    prose: prose.join(`
`).replace(/\n{3,}/g, `

`).trim()
  };
}
function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function shieldValues(ctx) {
  const values = [];
  const nonce = randomUUID().replace(/-/g, "");
  const wrap = (value) => {
    if (typeof value === "string") {
      if (value === "")
        return value;
      values.push(value);
      return `dkodshield${nonce}x${String(values.length - 1)}x`;
    }
    if (Array.isArray(value))
      return value.map(wrap);
    if (typeof value === "object" && value !== null && isPlainObject(value)) {
      const out = {};
      for (const [key, member] of Object.entries(value))
        out[key] = wrap(member);
      return out;
    }
    return value;
  };
  const marker = new RegExp(`dkodshield${nonce}x(\\d+)x`, "g");
  return {
    ctx: wrap(ctx),
    restore: (text) => text.replace(marker, (whole, index) => values[Number(index)] ?? whole)
  };
}
function renderTemplateFiles(source, ctx) {
  const { body } = splitFrontMatter(source);
  const shield = shieldValues(ctx);
  let rendered;
  let gaps;
  try {
    const result = render(body, shield.ctx);
    rendered = result.text;
    gaps = result.gaps;
  } catch (err) {
    if (err instanceof TemplateError)
      return { files: [], gaps: [], errors: [err.message] };
    throw err;
  }
  const scan = scanFences(rendered, 0);
  const errors = scan.errors.map(shield.restore);
  const files = [];
  const seen = new Set;
  for (const block of scan.blocks) {
    const path = shield.restore(block.path);
    if (!safeRepoPath(path)) {
      errors.push(`path=${path} escapes the repository once its placeholders are resolved`);
      continue;
    }
    if (seen.has(path)) {
      errors.push(`path=${path} is written by more than one block`);
      continue;
    }
    seen.add(path);
    files.push({ path, lang: shield.restore(block.lang), content: shield.restore(block.body) });
  }
  if (gaps.length > 0)
    return { files: [], gaps, errors };
  return { files, gaps, errors };
}

var join2 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var NOT_WRITTEN = new Set(["values.yaml", "README.md"]);
var ROOTS = ["app", "answers", "policy", "dkod"];
var SOURCE_KEYS = ["package_manager", "install_command", "lockfile", "run_command", "build_command", "start_command", "lockfile_command", "bun", "fullstack", "app_start", "static_dir", "app_port"];
var UNWRITTEN_KEYS = ["org", "image_repository", "app_commit_sha", "governance_repo", "governance_sha"];
var isRec2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json = (text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
};
function templateTokenLine(text) {
  const token = /\{\{\s*(?:#(?:if|each)\b|\/(?:if|each)\s*\}\}|else\s*\}\}|(?:dkod|answers|app|policy)\.[A-Za-z_])/;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => token.test(line));
  return at === -1 ? null : at + 1;
}
function inputDefault(source, key) {
  const { front } = splitFrontMatter(source);
  if (front === null)
    return null;
  for (const chunk of front.split(/^\s*-\s+key:/m).slice(1)) {
    if (chunk.split(`
`)[0].trim().replace(/^["']|["']$/g, "") !== key)
      continue;
    const m = /^\s*default:\s*(.+?)\s*$/m.exec(chunk);
    return m === null ? null : m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}
var baseName = (folder) => folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? folder;
function contextFor(source, name, tables, values) {
  const port = inputDefault(source, "port");
  const given = isRec2(values) ? values : {};
  const ctx = {
    app: { slug: name, name },
    answers: { port: port !== null && /^\d+$/.test(port) ? Number(port) : port ?? undefined, needs_database: tables },
    policy: {},
    dkod: {}
  };
  for (const root of ROOTS) {
    const own = given[root];
    if (isRec2(own))
      ctx[root] = { ...ctx[root], ...own };
  }
  const dkod = ctx.dkod;
  for (const key of UNWRITTEN_KEYS)
    if (dkod[key] === undefined)
      dkod[key] = "";
  if (ctx.app.template === undefined)
    ctx.app.template = "";
  for (const key of SOURCE_KEYS)
    dkod[key] = key === "bun" || key === "fullstack" ? false : "";
  return ctx;
}
async function render2(args, io) {
  const force = args.includes("--force");
  const [templateFile, folder, valuesFile] = args.filter((a) => a !== "--force");
  if (templateFile === undefined || folder === undefined)
    return -1;
  const dir = folder === "" ? io.cwd : folder;
  const source = io.readFile(templateFile);
  const fail = (errors, gaps = []) => {
    io.print(JSON.stringify({ ok: false, written: [], skipped: [], gaps, errors }));
    return 1;
  };
  if (source === null)
    return fail([`${templateFile}: not found. Save the template's content from dkoder.templates to this file first.`]);
  let values = {};
  if (valuesFile !== undefined) {
    values = json(io.readFile(valuesFile));
    if (!isRec2(values))
      return fail([`${valuesFile}: not found or not a JSON object.`]);
  }
  const map = json(io.readFile(join2(dir, ".dkod/map/app-map.json")));
  const tables = isRec2(map) && Array.isArray(map.tables) && map.tables.length > 0;
  const name = baseName(dir === "." ? io.cwd : dir);
  const rendered = renderTemplateFiles(source, contextFor(source, name, tables, values));
  if (rendered.errors.length > 0 || rendered.gaps.length > 0)
    return fail(rendered.errors, rendered.gaps.map((g) => g.path));
  const errors = [];
  const written = [];
  const skipped = [];
  const todo = rendered.files.filter((f) => !NOT_WRITTEN.has(f.path));
  for (const file of todo) {
    const line = templateTokenLine(file.content);
    if (line !== null)
      errors.push(`${file.path}: still has template text at line ${String(line)}.`);
  }
  if (errors.length > 0)
    return fail(errors);
  for (const file of todo) {
    const path = join2(dir, file.path);
    if (!force && io.readFile(path) !== null) {
      skipped.push(file.path);
      continue;
    }
    io.writeFile(path, file.content);
    written.push(file.path);
  }
  io.print(JSON.stringify({ ok: true, written, skipped, gaps: [], errors: [] }));
  return 0;
}

var join3 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
var TITLE = /\b(?:test|it)(?:\.(?:only|fixme|slow))?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
var isRec3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var list2 = (v) => Array.isArray(v) ? v.filter(isRec3) : [];
var same = (a, b) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
var freezePath = (dir) => join3(dir, ".dkod/parity/freeze.json");
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
  if (!isRec3(json) || !Array.isArray(json.suites))
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
  const files = io.walk(join3(dir, "tests/parity"), ["node_modules"]).map((rel) => `tests/parity/${rel}`);
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
  for (const f of io.walk(join3(dir, "tests/parity"), [])) {
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
  if (originalOf(io.readFile(join3(dir, ".dkod/migration.json"))) === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  if (reportFile === undefined)
    return fail(io, { problems: ["freeze needs the Playwright JSON report of the run on the original: freeze <folder> <report.json>"] });
  let map;
  try {
    const parsed = JSON.parse(io.readFile(join3(dir, ".dkod/map/app-map.json")) ?? "");
    if (!isRec3(parsed))
      throw new Error("not an object");
    map = parsed;
  } catch {
    return fail(io, { problems: [".dkod/map/app-map.json: missing or not valid JSON. Do the map step, and run check-map, first."] });
  }
  const specs = io.walk(join3(dir, "tests/parity"), []).filter((f) => TEST_FILE.test(f));
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
    for (const title of testTitles(io.readFile(join3(dir, `tests/parity/${f}`)) ?? "")) {
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
  const designFiles = new Set(io.walk(join3(dir, ".dkod/map/design"), []));
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
  const sha256 = io.sha256(files.map((f) => join3(dir, f)));
  const record = { sha256, files, baseline: { tests: run.map((t) => t.title), passed: passed.size }, frozenAt: new Date().toISOString() };
  io.writeFile(freezePath(dir), `${JSON.stringify(record, null, 2)}
`);
  io.print(JSON.stringify({ ok: true, sha256, counts: { tests: run.length, tagged, original_passed: passed.size, original_failed: 0 }, missing, original_failures: [] }));
  return 0;
}
async function unfreeze(folder, io) {
  const dir = folder === "" ? io.cwd : folder;
  if (originalOf(io.readFile(join3(dir, ".dkod/migration.json"))) === null) {
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

var join4 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var SKIP2 = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor", ".dkod"];
var SOURCE2 = /\.[cm]?[jt]sx?$/;
var DATA = /\.(?:sqlite|sqlite3|db|db3)$/i;
var isRec4 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json2 = (text) => {
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
  const original = originalOf(io.readFile(join4(dir, ".dkod/migration.json")));
  if (original === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const problems = [];
  const new_failed = [];
  let tests = 0;
  let newPassed = 0;
  let visual = 0;
  const frozen = json2(io.readFile(freezePath(dir)));
  if (!isRec4(frozen) || typeof frozen.sha256 !== "string" || !isRec4(frozen.baseline) || !Array.isArray(frozen.baseline.tests)) {
    problems.push(".dkod/parity/freeze.json: missing. Freeze the suite (step 3) before the build is checked.");
  } else {
    const record = frozen;
    const files = suiteFiles(dir, io);
    if (files.length === 0 || io.sha256(files.map((f) => join4(dir, f))) !== record.sha256) {
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
  const map = json2(io.readFile(join4(dir, ".dkod/map/app-map.json")));
  const tables = isRec4(map) && Array.isArray(map.tables) ? map.tables.filter(isRec4).flatMap((t) => typeof t.name === "string" ? [t.name] : []) : [];
  if (tables.length > 0) {
    const text = sources.filter((f) => SOURCE2.test(f) && !/^(?:tests|migrations)\//.test(f)).map((f) => io.readFile(join4(dir, f)) ?? "").join(`
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
  const assets = json2(io.readFile(join4(dir, ".dkod/map/assets/assets.json")));
  if (Array.isArray(assets)) {
    for (const a of assets.filter(isRec4)) {
      if (typeof a.path !== "string")
        continue;
      const source = join4(original, a.path);
      if (io.readFile(source) === null) {
        problems.push(`asset ${a.path}: not readable in the original at ${source}.`);
        continue;
      }
      const want = io.sha256([source]);
      const same = sources.some((f) => base(f) === base(a.path) && io.sha256([join4(dir, f)]) === want);
      if (!same)
        problems.push(`asset ${a.path}: no byte-identical copy in the dk- folder. Copy the file as it is; never redraw it.`);
    }
  }
  for (const f of sources) {
    const infra = f === "Dockerfile" || f === ".dockerignore" || f === "package.json" || /^\.github\/workflows\//.test(f);
    if (!infra && !(SOURCE2.test(f) && !f.startsWith("tests/")))
      continue;
    const line = templateTokenLine(io.readFile(join4(dir, f)) ?? "");
    if (line !== null)
      problems.push(`${f}: still has template text ({{...}} at line ${String(line)}). Render the template with dkod-migrate.mjs render; never copy its source.`);
  }
  const appName = base((dir === "." ? io.cwd : dir).replace(/[\\/]+$/, ""));
  if (appName.startsWith("dk-") && sources.includes("package.json") && !sources.includes("bun.lock")) {
    problems.push("bun.lock: missing. Run `bun install` in the dk- folder and keep bun.lock; without it the deploy installs without a lock file.");
  }
  if (io.readFile(join4(dir, ".env.local")) !== null && !ignoresEnvLocal(io.readFile(join4(dir, ".gitignore")) ?? "")) {
    problems.push(".env.local: not covered by .gitignore. Add it before anything is committed.");
  }
  const ok = problems.length === 0;
  io.print(JSON.stringify({ ok, problems, new_failed, counts: { tests, new_passed: newPassed, new_failed: new_failed.length, visual_diff: visual } }));
  return ok ? 0 : 1;
}

var join5 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var isRec5 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json3 = (text) => {
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
  if (originalOf(io.readFile(join5(dir, ".dkod/migration.json"))) === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const problems = [];
  const original = { tests: 0, passed: 0, failed: 0 };
  const dk = { tests: 0, passed: 0, failed: 0 };
  let visual = 0;
  const frozen = json3(io.readFile(freezePath(dir)));
  if (!isRec5(frozen) || typeof frozen.sha256 !== "string" || !isRec5(frozen.baseline) || !Array.isArray(frozen.baseline.tests)) {
    problems.push(".dkod/parity/freeze.json: missing. Freeze the suite (step 3) first.");
  } else {
    const record = frozen;
    const files = suiteFiles(dir, io);
    if (files.length === 0 || io.sha256(files.map((f) => join5(dir, f))) !== record.sha256) {
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
  const map = json3(io.readFile(join5(dir, ".dkod/map/app-map.json")));
  const count = (key) => isRec5(map) && Array.isArray(map[key]) ? map[key].length : 0;
  const snapshot = json3(io.readFile(join5(dir, ".dkod/snapshot.json")));
  const dataImported = isRec5(snapshot) && snapshot.mode === "snapshot" && snapshot.imported === true;
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
  "  node dkod-migrate.mjs render <template.md> <the dk- app's folder> [values.json] [--force]",
  "  node dkod-migrate.mjs check-build <the dk- app's folder> <report.json>",
  "  node dkod-migrate.mjs side-by-side <the dk- app's folder> <original report.json> <dk report.json>",
  "  node dkod-migrate.mjs clean <the dk- app's folder>"
].join(`
`);
var NEW_APP_ONLY = "The original app has no data files and no local database this computer can copy. The migration is new-app-only: its tests run only on the dk- app. Ask the builder how the original reads its data.";
var join6 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var norm = (p) => p.replace(/\/\.\//g, "/").replace(/\/+/g, "/");
var snapshotPath = (dir) => join6(dir, ".dkod/snapshot.json");
var recordPath = (dir) => join6(dir, ".dkod/migration.json");
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
  const rel = norm(raw.startsWith("/") ? raw : join6(original, raw)).slice(norm(original).length).replace(/^\//, "");
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
  const scratch = io.mkdtemp(join6(io.tmpdir(), "dkod-migrate-"));
  const id = (scratch.split(/[\\/]/).pop() ?? "run").replace(/[^A-Za-z0-9]/g, "_");
  const files = [];
  for (const rel of io.walk(original, SKIP3)) {
    if (!DATA2.test(rel))
      continue;
    const to = join6(scratch, rel);
    io.copyFile(join6(original, rel), to);
    files.push(to);
  }
  const env = { DKOD_MIGRATE_DATA: scratch };
  const databases = [];
  for (const file of [".env", ".env.local"]) {
    for (const [key, value] of envPairs(io.readFile(join6(original, file)))) {
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
  if (command === "render") {
    const code = await render2(argv.slice(1), io);
    if (code >= 0)
      return code;
  }
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
      const full = join7(at, name);
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
  hasTool: (program) => (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").some((dir) => dir !== "" && existsSync(join7(dir, program))),
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
