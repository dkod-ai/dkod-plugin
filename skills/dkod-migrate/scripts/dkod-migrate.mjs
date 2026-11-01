// Built by packages/dkoder-plugin/scripts/build-migrate.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:migrate`.
import { spawn } from "node:child_process";
import { createHash as createHash3 } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join as join9 } from "node:path";

import { createHash as createHash2 } from "node:crypto";

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

import { randomBytes } from "node:crypto";

import { createHash } from "node:crypto";
var SEAL_FILE = ".dkod-snapshot-seal";
function sealOf(r, nonce) {
  const body = { mode: r.mode, scratch: r.scratch, files: r.files, databases: (r.databases ?? []).map((d) => ({ name: d.name, url: d.url, tables: d.tables ?? null, ...d.source === undefined ? {} : { source: d.source } })), env: r.env, message: r.message ?? null, ...r.bases === undefined ? {} : { bases: r.bases }, ...r.source === undefined ? {} : { source: r.source }, ...r.checks === undefined ? {} : { checks: r.checks } };
  return createHash("sha256").update(JSON.stringify(body)).update(nonce).digest("hex");
}

var asText = (v) => {
  if (v === null || v === undefined)
    return null;
  if (typeof v === "string")
    return v;
  if (typeof v === "object")
    return JSON.stringify(v);
  return String(v);
};
function parseJsonRows(text) {
  let data;
  try {
    data = JSON.parse(text.charCodeAt(0) === 65279 ? text.slice(1) : text);
  } catch {
    return { ok: false, reason: "the file is not valid JSON" };
  }
  let list = data;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const arrays = Object.values(data).filter(Array.isArray);
    if (arrays.length !== 1)
      return { ok: false, reason: "the JSON is an object without exactly one array of rows" };
    list = arrays[0];
  }
  if (!Array.isArray(list))
    return { ok: false, reason: "the JSON is not an array of objects" };
  const cols = [];
  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      return { ok: false, reason: "the JSON rows are not all objects" };
    for (const k of Object.keys(item))
      if (!cols.includes(k))
        cols.push(k);
  }
  if (cols.length === 0)
    return { ok: false, reason: "the JSON has no rows with keys" };
  return { ok: true, cols, rows: list.map((item) => cols.map((c) => asText(item[c]))) };
}

var NO_PASSWORD = "Postgres refused the connection, the key is missing or wrong. Put the right one in the PGPASSWORD env var or in ~/.pgpass, then run again.";
var isNoPassword = (stderr) => /fe_sendauth: no password supplied|password authentication failed/i.test(stderr);
var PG_TIMEOUT = { PGCONNECT_TIMEOUT: "10" };
var PG_SETTINGS = "SET TimeZone='UTC'; SET DateStyle='ISO, YMD'; SET extra_float_digits=1; SET bytea_output='hex'; SET IntervalStyle='postgres';";
var quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;
var quoteLit = (text) => `'${text.replace(/'/g, "''")}'`;
var join = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json = (text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
};
var hashSql = (t) => {
  const cols = t.cols.map(quoteIdent).join(", ");
  const text = "convert_to(r::text,'UTF8')";
  return `SELECT count(*), md5(coalesce(string_agg(${text}, '\\x0a'::bytea ORDER BY ${text}), ''::bytea)) FROM (SELECT ${cols} FROM public.${quoteIdent(t.name)}) r;`;
};
function parseTallies(stdout) {
  const out = [];
  for (const l of stdout.split(`
`)) {
    const m = /^(\d+)[|\t]([0-9a-f]{32})$/.exec(l.trim());
    if (m)
      out.push({ rows: Number(m[1]), md5: m[2] });
  }
  return out;
}
function readMapTables(text) {
  let map = null;
  try {
    map = JSON.parse(text ?? "null");
  } catch {
    return [];
  }
  const m = map;
  if (!m || !Array.isArray(m.tables))
    return [];
  const nonSql = new Set;
  for (const s of Array.isArray(m.stores) ? m.stores : []) {
    if (typeof s.name === "string" && typeof s.engine === "string" && !/postgres|sql/i.test(s.engine))
      nonSql.add(s.name);
  }
  const names = [];
  for (const t of m.tables) {
    if (typeof t.name !== "string" || typeof t.store === "string" && nonSql.has(t.store))
      continue;
    if (!names.includes(t.name))
      names.push(t.name);
  }
  return names;
}
var PSQL = ["-w", "-X", "-q", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1"];
async function readColumns(url, names, env, run, cwd = ".") {
  const filter = names === null ? "" : ` AND c.table_name IN (${names.map(quoteLit).join(",")})`;
  const sql = `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE' WHERE c.table_schema='public' AND c.is_generated='NEVER'${filter} ORDER BY c.table_name, c.ordinal_position`;
  const res = await run("psql", [...PSQL, "--dbname", url, "-c", sql], env, cwd);
  if (res.status !== 0)
    return null;
  const out = new Map;
  for (const l of res.stdout.split(`
`)) {
    const [t, c] = l.split("\t");
    if (t && c)
      out.set(t, [...out.get(t) ?? [], c]);
  }
  return out;
}
async function tallies(url, tables, env, run, cwd = ".") {
  if (tables.length === 0)
    return {};
  const args = [...PSQL, "--dbname", url, "-c", PG_SETTINGS, ...tables.flatMap((t) => ["-c", hashSql(t)])];
  const res = await run("psql", args, env, cwd);
  if (res.status !== 0)
    return null;
  const got = parseTallies(res.stdout);
  if (got.length !== tables.length)
    return null;
  const out = {};
  tables.forEach((t, i) => {
    out[t.name] = got[i];
  });
  return out;
}
async function tallyNamed(url, names, env, run, cwd = ".") {
  const cols = await readColumns(url, names, env, run, cwd);
  if (cols === null)
    return null;
  const refs = names.filter((n) => cols.has(n)).map((name) => ({ name, cols: cols.get(name) }));
  const got = await tallies(url, refs, env, run, cwd);
  return got === null ? null : { tallies: got, cols };
}
var same = (a, b) => a.rows === b.rows && a.md5 === b.md5;
function changedTables(before, now) {
  return Object.keys(before).filter((n) => now[n] === undefined || !same(before[n], now[n]));
}
function readFreezeData(text) {
  const f = json(text);
  const d = isRec(f) ? f.data : null;
  if (!isRec(d) || !isRec(d.tables) || !Array.isArray(d.suite_writes))
    return null;
  const tablesOut = {};
  for (const [n, t] of Object.entries(d.tables)) {
    if (!isRec(t) || typeof t.rows !== "number" || typeof t.md5 !== "string")
      return null;
    tablesOut[n] = { rows: t.rows, md5: t.md5 };
  }
  return { database: typeof d.database === "string" ? d.database : "", tables: tablesOut, suite_writes: d.suite_writes.filter((s) => typeof s === "string") };
}
async function rowHashes(url, tables, env, run, cwd = ".") {
  const out = {};
  for (const t of tables) {
    const sql = `SELECT md5(r::text) FROM (SELECT ${t.cols.map(quoteIdent).join(", ")} FROM public.${quoteIdent(t.name)}) r ORDER BY 1;`;
    const res = await run("psql", [...PSQL, "--dbname", url, "-c", PG_SETTINGS, "-c", sql], env, cwd);
    if (res.status !== 0)
      return null;
    out[t.name] = res.stdout.split(`
`).map((l) => l.trim()).filter((l) => /^[0-9a-f]{32}$/.test(l));
  }
  return out;
}
async function devDrift(dir, io) {
  const snap = json(io.readFile(join(dir, ".dkod/snapshot.json")));
  if (!isRec(snap) || snap.mode !== "snapshot" || snap.imported !== true)
    return [];
  const imported = isRec(snap.imported_tables) ? snap.imported_tables : null;
  const devUrl = typeof snap.dev_url === "string" ? snap.dev_url : "";
  if (imported === null || devUrl === "") {
    return ["Dev data: snapshot.json has imported:true but not what was imported (imported_tables, dev_url). Run `node dkod-db.mjs import` again."];
  }
  const frozen = readFreezeData(io.readFile(join(dir, ".dkod/parity/freeze.json")));
  const allowed = new Set(frozen?.suite_writes ?? []);
  const refs = [];
  const before = {};
  for (const [name, t] of Object.entries(imported)) {
    if (allowed.has(name) || !isRec(t) || typeof t.rows !== "number" || typeof t.md5 !== "string" || !Array.isArray(t.cols))
      continue;
    refs.push({ name, cols: t.cols.filter((c) => typeof c === "string") });
    before[name] = { rows: t.rows, md5: t.md5 };
  }
  const unreadable = ["Dev data cannot be read to check it after the import: start `node dkod-db.mjs up --app <app key>` in the background and run this again."];
  let noPassword = false;
  const run = async (cmd, args, env, cwd) => {
    const res = await io.run(cmd, args, env, cwd);
    if (res.status !== 0 && isNoPassword(res.stderr))
      noPassword = true;
    return res;
  };
  const now = await tallies(devUrl, refs, { ...PG_TIMEOUT, PGSSLMODE: "disable" }, run, dir);
  if (now === null)
    return noPassword ? [NO_PASSWORD] : unreadable;
  const problems = changedTables(before, now).map((n) => {
    const t = now[n];
    return `Dev changed after the import: db:seed or hand-written rows (${n}: ${t === undefined ? "table missing" : `${String(t.rows)} rows`}, imported ${String(before[n].rows)}). Never run db:seed or insert rows after \`dkod-db.mjs import\`; import again into an empty Dev.`;
  });
  const rowRefs = [];
  for (const [name, t] of Object.entries(imported)) {
    if (!allowed.has(name) || !isRec(t) || !Array.isArray(t.cols) || !Array.isArray(t.row_md5))
      continue;
    rowRefs.push({ name, cols: t.cols.filter((c) => typeof c === "string"), rows: Number(t.rows), row_md5: t.row_md5.filter((h) => typeof h === "string") });
  }
  if (rowRefs.length > 0) {
    const nowRows = await rowHashes(devUrl, rowRefs, { ...PG_TIMEOUT, PGSSLMODE: "disable" }, run, dir);
    if (nowRows === null)
      return noPassword ? [NO_PASSWORD] : unreadable;
    for (const r of rowRefs) {
      const left = new Map;
      for (const h of nowRows[r.name])
        left.set(h, (left.get(h) ?? 0) + 1);
      let lost = 0;
      for (const h of r.row_md5) {
        const c = left.get(h) ?? 0;
        if (c > 0)
          left.set(h, c - 1);
        else
          lost++;
      }
      if (lost > 0)
        problems.push(`Dev changed after the import: ${String(lost)} imported rows of ${r.name} are missing or edited (${String(r.row_md5.length)} imported). Never edit or delete Dev rows by hand; import again into an empty Dev. The suite's own @data rows are fine.`);
    }
  }
  return problems;
}
var REFERENCE_CHANGED = (what) => `the original's reference data changed after the freeze (${what}): snapshot/import is the only source of reference rows. If the capture missed a fixture state, unfreeze, run snapshot again, redo the map and suite, and freeze again; never insert rows.`;
async function referenceDrift(dir, io) {
  const snap = json(io.readFile(join(dir, ".dkod/snapshot.json")));
  if (!isRec(snap) || snap.mode !== "snapshot")
    return [];
  const problems = [];
  const frozen = readFreezeData(io.readFile(join(dir, ".dkod/parity/freeze.json")));
  let noPassword = false;
  const run = async (cmd, args, env, cwd) => {
    const res = await io.run(cmd, args, env, cwd);
    if (res.status !== 0 && isNoPassword(res.stderr))
      noPassword = true;
    return res;
  };
  const env = { ...PG_TIMEOUT, PGSSLMODE: "disable" };
  const unreadable = ["The original's snapshot data cannot be read to check it after the freeze: start the snapshot's Postgres server and run this again."];
  if (frozen !== null && Object.keys(frozen.tables).length > 0 && Array.isArray(snap.databases)) {
    const pg = snap.databases.find((d) => isRec(d) && typeof d.url === "string" && /^postgres(ql)?:\/\//i.test(d.url));
    if (pg !== undefined) {
      const names = Object.keys(frozen.tables);
      const scratchNames = names.filter((n) => !frozen.suite_writes.includes(n));
      const scratch = await tallyNamed(pg.url, scratchNames, env, run, dir);
      if (scratch === null)
        return noPassword ? [NO_PASSWORD] : unreadable;
      for (const n of changedTables(Object.fromEntries(scratchNames.filter((s) => frozen.tables[s] !== undefined).map((s) => [s, frozen.tables[s]])), scratch.tallies))
        problems.push(REFERENCE_CHANGED(`${n} in the snapshot database`));
      const base = isRec(pg.base) && typeof pg.base.url === "string" ? pg.base.url : "";
      if (base !== "") {
        const copy = await tallyNamed(base, names, env, run, dir);
        if (copy === null)
          return noPassword ? [NO_PASSWORD] : unreadable;
        for (const n of changedTables(frozen.tables, copy.tallies))
          problems.push(REFERENCE_CHANGED(`${n} in the base copy`));
      }
    }
  }
  if (io.sha256 !== undefined && Array.isArray(snap.bases)) {
    for (const b of snap.bases) {
      if (!isRec(b) || typeof b.base !== "string" || typeof b.sha256 !== "string")
        continue;
      let now = "";
      try {
        now = io.sha256([b.base]);
      } catch {}
      if (now !== b.sha256)
        problems.push(REFERENCE_CHANGED(`the base file ${typeof b.rel === "string" ? b.rel : "?"}`));
    }
  }
  return problems;
}
async function migrationRows(dir, io) {
  let noPassword = false;
  const run = async (cmd, args, env, cwd) => {
    const res = await io.run(cmd, args, env, cwd);
    if (res.status !== 0 && isNoPassword(res.stderr))
      noPassword = true;
    return res;
  };
  const snap = json(io.readFile(join(dir, ".dkod/snapshot.json")));
  if (!isRec(snap) || snap.mode !== "snapshot" || !Array.isArray(snap.databases))
    return [];
  const found = snap.databases.map((d) => isRec(d) ? d.url : null).find((u) => typeof u === "string" && /^postgres(ql)?:\/\//i.test(u));
  if (found === undefined)
    return [];
  let source;
  try {
    source = new URL(found);
  } catch {
    return [];
  }
  const password = decodeURIComponent(source.password);
  source.password = "";
  const sourceUrl = source.toString();
  const fresh = `${decodeURIComponent(source.pathname.replace(/^\//, "")).slice(0, 50)}_dkod_build`;
  const freshObj = new URL(sourceUrl);
  freshObj.pathname = `/${fresh}`;
  const freshUrl = freshObj.toString();
  const env = { ...PG_TIMEOUT, PGSSLMODE: "disable", ...password ? { PGPASSWORD: password } : {} };
  const connect = ["-w", "-h", source.hostname.replace(/^\[|\]$/g, ""), "-p", source.port || "5432", ...source.username ? ["-U", decodeURIComponent(source.username)] : []];
  const failed = (step) => noPassword ? [NO_PASSWORD] : step === "bun run db:migrate" ? [`The dk- app's migrations could not be run on a fresh database (${step} failed): fix \`bun run db:migrate\` so it creates the schema and its rows on an empty database.`] : [`The snapshot's local Postgres could not be used to check the dk- app's migrations (${step} failed): start the snapshot's Postgres server, then run check-build again.`];
  await run("dropdb", ["--if-exists", ...connect, fresh], env, dir);
  try {
    if ((await run("createdb", [...connect, fresh], env, dir)).status !== 0)
      return failed("createdb");
    const migrateEnv = { ...env, DATABASE_URL: freshUrl, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
    if ((await run("bun", ["run", "db:migrate"], migrateEnv, dir)).status !== 0)
      return failed("bun run db:migrate");
    const names = readMapTables(io.readFile(join(dir, ".dkod/map/app-map.json")));
    if (names.length === 0)
      return [];
    const mine = await tallyNamed(freshUrl, names, env, run, dir);
    if (mine === null)
      return failed("psql");
    const written = new Set(readFreezeData(io.readFile(join(dir, ".dkod/parity/freeze.json")))?.suite_writes ?? []);
    const filled = names.filter((n) => !written.has(n) && (mine.tallies[n]?.rows ?? 0) > 0);
    if (filled.length === 0)
      return [];
    const theirCols = await readColumns(sourceUrl, filled, env, run, dir);
    if (theirCols === null)
      return failed("psql");
    const refs = [];
    const absent = [];
    for (const n of filled) {
      const a = mine.cols.get(n) ?? [];
      if (!theirCols.has(n)) {
        absent.push(n);
        continue;
      }
      const shared = (theirCols.get(n) ?? []).filter((c) => a.includes(c));
      if (shared.length > 0)
        refs.push({ name: n, cols: shared });
    }
    const orig = await tallies(sourceUrl, refs, env, run, dir);
    const own = await tallies(freshUrl, refs, env, run, dir);
    if (orig === null || own === null)
      return failed("psql");
    const missing = absent.map((n) => `table ${n}: the dk- app's migrations insert ${String(mine.tallies[n].rows)} rows on an empty database, but the original has no such table. Change those migrations to insert no rows there; CI and Prod run them on an empty database. Never delete or edit Dev rows by hand.`);
    return [...missing, ...refs.filter((t) => !same(orig[t.name], own[t.name])).map((t) => `table ${t.name}: the dk- app's migrations insert ${String(own[t.name].rows)} rows on an empty database, unlike the original's ${String(orig[t.name].rows)} (count or md5 differ). Change those migrations to insert exactly the original's rows (or none); CI and Prod run them on an empty database. Never delete or edit Dev rows by hand.`)];
  } finally {
    await run("dropdb", ["--if-exists", ...connect, fresh], env, dir);
  }
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
var SOURCE_KEYS = ["package_manager", "install_command", "lockfile", "run_command", "build_command", "start_command", "lockfile_command", "fullstack", "app_start", "static_dir", "app_port"];
var UNWRITTEN_KEYS = ["org", "image_repository", "app_commit_sha", "governance_repo", "governance_sha"];
var isRec2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json2 = (text) => {
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
    dkod[key] = key === "fullstack" ? false : "";
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
    values = json2(io.readFile(valuesFile));
    if (!isRec2(values))
      return fail([`${valuesFile}: not found or not a JSON object.`]);
  }
  const map = json2(io.readFile(join2(dir, ".dkod/map/app-map.json")));
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

var MAX_FINDINGS = 200;
var MAX_FILE_BYTES = 512 * 1024;
function finish(findings, checked) {
  const capped = findings.slice(0, MAX_FINDINGS);
  return { findings: capped, blocked: capped.some((f) => f.level === "block"), checked };
}
function toFinding(rule, check, level, message, title, hit) {
  return { rule, check, level, path: hit.path, line: hit.line, message: message ? `${message} (${hit.detail})` : `${title}: ${hit.detail}` };
}
function tails(path) {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]+/).filter((p) => p !== "");
  return parts.map((_, i) => parts.slice(i).join("/"));
}
function exemptFolder(exclude, opts) {
  const names = [opts.folder, ...opts.folderPath === undefined ? [] : tails(opts.folderPath)].filter((n) => n !== undefined && n !== "");
  return names.some((name) => matchAny(exclude, name) || matchAny(exclude, `${name}/`));
}
function scopeOf(check, opts) {
  const def = CATALOG[check.use];
  const paths = stringList(check.with, "paths") ?? def.paths;
  const prefix = typeof check.with.folder_prefix === "string" ? check.with.folder_prefix : "";
  const exclude = [...ALWAYS_SKIPPED, ...def.exclude, ...stringList(check.with, "exclude") ?? []];
  const folder = opts.folder;
  const defaults = def.pathsFor?.(check.with) ?? def.paths;
  const narrowed = check.with.paths !== undefined && JSON.stringify(check.with.paths) !== JSON.stringify(defaults);
  const own = def.folderPaths !== undefined && prefix !== "" && folder !== undefined && folder.startsWith(prefix) && !narrowed && !exemptFolder(exclude, opts) ? def.folderPaths : null;
  return { paths: own === null ? paths : [...paths, ...own], exclude, ...def.textPaths === undefined ? {} : { text: def.textPaths } };
}
var cleanPath = (p) => p.replace(/^\.?\/+/, "");
function evaluate(pack, files, opts) {
  const usable = files.map((f) => ({ path: cleanPath(f.path), text: f.text.length <= MAX_FILE_BYTES ? f.text : "", big: f.text.length > MAX_FILE_BYTES }));
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
      const { paths, exclude } = scopeOf(check, opts);
      const scoped = usable.filter((f) => (def.byName === true || !f.big) && matchAny(paths, f.path) && !matchAny(exclude, f.path));
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
  const scopes = pack.rules.flatMap((rule) => rule.checks.filter((c) => (c.level ?? rule.level) !== "off" && CATALOG[c.use].scope === "file" && (!CATALOG[c.use].needsSecretScan || opts.secretScan !== undefined)).map((c) => scopeOf(c, opts)));
  return new Set(paths.filter((p) => scopes.some((s) => matchAny(s.paths, cleanPath(p)) && !matchAny(s.exclude, cleanPath(p)) && (s.text === undefined || matchAny(s.text, cleanPath(p))))));
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

var ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json"
].join(", ");
var REGISTRY = "https://registry-1.docker.io/v2";
var TIMEOUT_MS = 5000;
var isRec3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function fromDigests(text) {
  const out = [];
  const stages = new Set;
  text.split(`
`).forEach((raw, i) => {
    const m = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(raw);
    if (m === null)
      return;
    const image = m[1] ?? "";
    if (m[2] !== undefined)
      stages.add(m[2].toLowerCase());
    if (image.toLowerCase() === "scratch" || stages.has(image.toLowerCase()) && !image.includes("@"))
      return;
    const d = /^(.+?)(?::[^/@:]+)?@(sha256:[0-9a-f]{64})$/i.exec(image);
    if (d === null)
      return;
    let repo = d[1] ?? "";
    if (/^[^/]*(?:\.|:)|^localhost\//.test(repo))
      return;
    if (!repo.includes("/"))
      repo = `library/${repo}`;
    out.push({ line: i + 1, image, repo, digest: d[2] ?? "" });
  });
  return out;
}
async function getJson(fetchFn, url, headers, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${url}: no answer in ${String(timeoutMs)} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([fetchJson(fetchFn, url, headers, timeoutMs), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
async function fetchJson(fetchFn, url, headers, timeoutMs) {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status !== 200)
    throw new Error(`${url}: HTTP ${String(res.status)}`);
  const body = await res.json();
  if (!isRec3(body))
    throw new Error(`${url}: not a JSON object`);
  return body;
}
async function hasAmd64(fetchFn, repo, digest, t) {
  const tokenRes = await getJson(fetchFn, `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`, {}, t);
  const token = typeof tokenRes.token === "string" ? tokenRes.token : typeof tokenRes.access_token === "string" ? tokenRes.access_token : "";
  const headers = { Accept: ACCEPT, ...token === "" ? {} : { Authorization: `Bearer ${token}` } };
  const manifest = await getJson(fetchFn, `${REGISTRY}/${repo}/manifests/${digest}`, headers, t);
  if (Array.isArray(manifest.manifests)) {
    return manifest.manifests.some((m) => isRec3(m) && isRec3(m.platform) && m.platform.os === "linux" && m.platform.architecture === "amd64");
  }
  if (isRec3(manifest.config) && typeof manifest.config.digest === "string") {
    const config = await getJson(fetchFn, `${REGISTRY}/${repo}/blobs/${manifest.config.digest}`, headers, t);
    return config.os === "linux" && config.architecture === "amd64";
  }
  throw new Error(`${repo}@${digest}: not an index or an image manifest`);
}
async function checkFromArch(dockerfileText, fetchFn, path = "Dockerfile", timeoutMs = TIMEOUT_MS) {
  const result = { problems: [], warnings: [] };
  const cache = new Map;
  for (const f of fromDigests(dockerfileText)) {
    const key = `${f.repo}@${f.digest}`;
    let p = cache.get(key);
    if (p === undefined) {
      p = hasAmd64(fetchFn, f.repo, f.digest, timeoutMs);
      cache.set(key, p);
    }
    try {
      if (!await p)
        result.problems.push(`${path}:${String(f.line)}: pinned-base-images: FROM ${f.image} digest has no linux/amd64; pin the multi-arch index digest`);
    } catch (e) {
      result.warnings.push(`${path}:${String(f.line)}: FROM ${f.image}: architecture not checked (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return result;
}

var POLICY_CHECK_TOOL = "policy_check";
var POLICY_CHECK_TOOL_FULL = `mcp__dkod__${POLICY_CHECK_TOOL}`;
var MAX_FOLDER_FILES = 5000;
var MAX_READ_BYTES = 64 * 1024 * 1024;
var MAX_SHOWN = 50;
var DOCKERFILE = /(^|\/)Dockerfile(\.[^/]+)?$/;
var DEV_DOCKERFILE = /(^|\/)Dockerfile\.dev$/;
function archFinding(text, level) {
  const m = /^(.+?):(\d+): (?:pinned-base-images: )?(.*)$/.exec(text);
  return {
    rule: "pinned-base-images",
    check: "dockerfile.from_digest",
    level,
    path: m?.[1] ?? null,
    line: m?.[2] === undefined ? null : Number(m[2]),
    message: m?.[3] ?? text
  };
}
var refuse = (error, message) => ({ ok: false, error, message });
async function checkFolder(pack, dir, io) {
  if (!pack || pack.rules.length === 0) {
    return { ok: true, folder: dir, files: 0, skipped: 0, checked: 0, blocked: false, findings: [], summary: "", next: "Your organization's rules have no checks yet. Nothing to fix." };
  }
  const listed = await io.list(dir).catch(() => null);
  if (listed === null)
    return refuse("cannot_list", "Dkoder could not list the files of that folder. Check the path, then try again.");
  if (listed.length > MAX_FOLDER_FILES)
    return refuse("too_many_files", `That folder has more than ${String(MAX_FOLDER_FILES)} files. Run the check on the app's own folder.`);
  const base = dir.replace(/[\\/]+$/, "").replace(/[\\/]\.$/, "");
  const folder = base.split(/[\\/]/).pop() ?? "";
  const wanted = pathsToRead(pack, listed, { stage: "build", folder, folderPath: base });
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
  const result = evaluate(pack, files, { stage: "build", folder, folderPath: base });
  const fetchFn = io.fetch ?? globalThis.fetch;
  for (const f of files) {
    if (!DOCKERFILE.test(f.path) || DEV_DOCKERFILE.test(f.path) || f.text === "")
      continue;
    const arch = await checkFromArch(f.text, fetchFn, f.path);
    for (const p of arch.problems)
      result.findings.push(archFinding(p, "block"));
    for (const w of arch.warnings)
      result.findings.push(archFinding(w, "warn"));
    if (arch.problems.length > 0)
      result.blocked = true;
  }
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

var LOCAL_HOST = "(?:localhost|127(?:[.]\\d+){3}|0[.]0[.]0[.]0|\\[?::1\\]?|redis|valkey|memcached)";
var STORE_KEY = /^(?:export\s+)?(REDIS\w*|KV_\w*|CACHE_\w*|MEMCACHE\w*|VALKEY\w*)\s*[=:]\s*(.*)$/;
var LOCAL_URL = new RegExp(`^["']?(?:\\w+://)?(?:[^@/\\s]*@)?${LOCAL_HOST}(?::(?!//)|[/"']|$)`, "i");
var LOCAL_BLOB_KEY = /^(?:export\s+)?(STORAGE_DRIVER|FILE_STORAGE\w*|BLOB_DRIVER|BLOB_STORAGE\w*|UPLOAD_DRIVER)\s*[=:]\s*["']?(local|fs|file|disk|filesystem)["']?\s*$/i;
var CODE_HOST = "(?:localhost|127(?:[.]\\d+){3}|0[.]0[.]0[.]0|::1|redis)\\b";
var LOCAL_STORE_CODE = [
  /\bredis-server\b/,
  new RegExp(`\\bnew\\s+(?:Redis|IORedis)\\s*\\(\\s*(?:\\{[^)]*\\bhost\\s*:\\s*)?["'\`](?:\\w+://)?${CODE_HOST}`),
  /\bnew\s+(?:Redis|IORedis)\s*\(\s*\)/,
  new RegExp(`\\bcreateClient\\s*\\([^)]*["'\`](?:redis://)?${CODE_HOST}`),
  new RegExp(`\\bredis://${CODE_HOST}`),
  /\b(?:mkdir|mkdirSync|writeFile|writeFileSync|createWriteStream|appendFile|appendFileSync)\s*\([^)]*["'`][^"'`]*\b(?:uploads?|storage)\//
];
var ADVICE = "follow the migration.yaml cache/blob policy (stub, keep or refuse) and never start a local store.";
var ENV_FILE = /^\.env(?:\..+)?$/;
var COMPOSE = /(?:^|\/)(?:docker-)?compose[^/]*\.ya?ml$/i;
var SOURCE2 = /(?:\.[cm]?[jt]sx?|\.py|\.rb|\.sh)$|(?:^|\/)Dockerfile[^/]*$/;
var SELECTOR_KEY = /_(?:DRIVER|STORE|CLIENT|PREFIX|TYPE|PROVIDER)$/i;
var base = (p) => p.split("/").pop() ?? p;
var stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
function localStoreProblems(sources, read) {
  const problems = [];
  for (const f of sources) {
    if (f.startsWith("tests/") || f.startsWith(".dkod/"))
      continue;
    if (ENV_FILE.test(base(f))) {
      for (const raw of read(f).split(`
`)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#"))
          continue;
        const store = STORE_KEY.exec(line);
        if (store !== null && !SELECTOR_KEY.test(store[1] ?? "") && LOCAL_URL.test((store[2] ?? "").trim()))
          problems.push(`${f}: ${store[1]} points at a local store (value masked). ${ADVICE[0].toUpperCase()}${ADVICE.slice(1)}`);
        const blob = LOCAL_BLOB_KEY.exec(line);
        if (blob !== null)
          problems.push(`${f}: ${blob[1]} is a local file store (value masked). ${ADVICE[0].toUpperCase()}${ADVICE.slice(1)}`);
      }
      continue;
    }
    let code;
    if (base(f) === "package.json") {
      try {
        const pkg = JSON.parse(read(f));
        code = Object.values(pkg.scripts ?? {}).filter((v) => typeof v === "string").join(`
`);
      } catch {
        continue;
      }
    } else if (COMPOSE.test(f)) {
      code = read(f).replace(/(^|\s)#.*$/gm, "$1");
      if (/^\s*image:\s*["']?(?:redis|valkey|memcached|minio)\b/im.test(code))
        problems.push(`${f}: a compose service runs a local store image. ${ADVICE[0].toUpperCase()}${ADVICE.slice(1)}`);
      continue;
    } else if (SOURCE2.test(f))
      code = stripComments(read(f));
    else
      continue;
    const hit = LOCAL_STORE_CODE.map((re) => re.exec(code)).find((m) => m !== null);
    if (hit)
      problems.push(`${f}: starts or connects to a local store (${hit[0].trim().slice(0, 60)}). ${ADVICE[0].toUpperCase()}${ADVICE.slice(1)}`);
  }
  return problems;
}

var TITLE = /\b(?:test|it)(?:\.(?:only|fixme|slow))?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
function testBlocks(text) {
  const ms = [...text.matchAll(TITLE)];
  return ms.map((m, i) => {
    const start = m.index + m[0].length;
    let end = ms[i + 1]?.index ?? text.length;
    const indent = text.slice(text.lastIndexOf(`
`, m.index - 1) + 1, m.index).match(/^\s*/)[0];
    const close = text.slice(start, end).indexOf(`
${indent}});`);
    if (close >= 0)
      end = start + close;
    return { title: m[2], body: text.slice(start, end) };
  });
}
var stripComments2 = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function balanced(code, open) {
  const pair = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  let quote = "";
  for (let i = open;i < code.length; i++) {
    const c = code[i];
    if (quote !== "") {
      if (c === "\\")
        i += 1;
      else if (c === quote)
        quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`")
      quote = c;
    else if (pair[c] !== undefined)
      stack.push(pair[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c)
        return null;
      if (stack.length === 0)
        return code.slice(open + 1, i);
    }
  }
  return null;
}
var IFRAME_MASK = /^\s*page\s*\.\s*locator\s*\(\s*(["'`])iframe\1\s*\)\s*,?\s*$/;
function designProblems(blocks, framed) {
  const out = [];
  for (const { title, body } of blocks) {
    if (!/@design\b/.test(title))
      continue;
    const code = stripComments2(body);
    const isFramed = framed(title);
    let sawMask = false;
    for (const m of code.matchAll(/\.toHaveScreenshot\s*\(/g)) {
      const before = code.slice(0, m.index).replace(/\s+$/, "");
      if (!/\bexpect\s*\(\s*page\s*\)(?:\s*\.\s*not)?$/.test(before)) {
        out.push(`${title}: a page baseline is a full-page shot of \`page\`: write \`await expect(page).toHaveScreenshot(...)\`, never a shot of one element or locator. Fix it the same on the original and the dk- app`);
      }
      const args = balanced(code, m.index + m[0].length - 1) ?? "";
      if (!/\bfullPage\s*:\s*true\b/.test(args) || /\bfullPage\s*:\s*false\b/.test(args)) {
        out.push(`${title}: a page baseline is a full-page shot: pass \`{ fullPage: true }\` as the options of toHaveScreenshot (the default and \`fullPage: false\` take only the viewport)`);
      }
      const second = splitTop(args).slice(1).join(",").trim();
      if (/\.\.\./.test(second) || /\b(?:style|stylePath)\s*:/.test(second) || second !== "" && !second.startsWith("{")) {
        out.push(`${title}: write the options of toHaveScreenshot as one object literal with no spread, no \`style\`/\`stylePath\` and no variable (they can hide content like a mask), and call it in the test body itself, not in a helper. \`expect.soft(page)\` is refused too`);
      }
      const mask = /\bmask\s*:\s*/.exec(args);
      if (mask === null)
        continue;
      sawMask = true;
      const at = mask.index + mask[0].length;
      const entries = args[at] === "[" ? balanced(args, at) : null;
      const parts = entries === null ? null : splitTop(entries);
      if (parts === null || parts.length === 0 || !parts.every((p) => IFRAME_MASK.test(p))) {
        out.push(`${title}: the only allowed mask is the cross-origin iframe, \`mask: [page.locator("iframe")]\`. Remove the other mask entries; fix times and dates with page.clock (one fixed time on the original and the dk- app), never a mask`);
      } else if (!isFramed) {
        out.push(`${title}: this state's json lists no cross-origin frames, so it takes no mask. Remove \`mask:\`; fix times and dates with page.clock, never a mask`);
      }
    }
    if (isFramed && !sawMask) {
      out.push(`${title}: the state json lists cross-origin frames, so add \`mask: [page.locator("iframe")]\` to this test's toHaveScreenshot, the same on the original and the dk- app`);
    }
  }
  return out;
}
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0;i < text.length; i++) {
    const c = text[i];
    if (quote !== "") {
      cur += c;
      if (c === "\\")
        cur += text[++i] ?? "";
      else if (c === quote)
        quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`")
      quote = c;
    else if ("([{".includes(c))
      depth += 1;
    else if (")]}".includes(c))
      depth -= 1;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else
      cur += c;
  }
  parts.push(cur);
  return parts.filter((p) => p.trim() !== "");
}

var PARITY_RESTART_SOURCE = `// Shipped by dkod-migrate.mjs install-restart. Part of the frozen parity suite: never edit it.
// restartApp() stops the app that listens on PARITY_BASE_URL's port and starts it again from PARITY_START_CMD
// (run from PARITY_START_CWD, else the current folder). The new server stays in this process's session and group
// (never detached), and its PID goes to $PARITY_RUN_DIR/pids and its port to $PARITY_RUN_DIR/ports, where
// \`dkod-migrate.mjs stop-servers\` finds them.
// The app gets a minimal env, not the runner's: PATH, HOME, PORT, TMPDIR, LANG, SHELL, PIP_CACHE_DIR, the PARITY_*
// names, and the variables of the file(s) named by PARITY_START_ENV (a path relative to PARITY_START_CWD or absolute,
// several separated by ':'). The runner's PORT and PARITY_* win over the file. So a dk- app never sees the original's
// DATABASE_URL or REDIS_URL, and the original's run names the snapshot's env file to keep running on the copy.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function portOf(): number {
  const url = process.env.PARITY_BASE_URL;
  if (!url) throw new Error("restartApp: PARITY_BASE_URL is not set");
  const u = new URL(url);
  const port = u.port === "" ? (u.protocol === "https:" ? 443 : 80) : Number(u.port);
  if (!Number.isInteger(port) || port <= 0) throw new Error("restartApp: no port in PARITY_BASE_URL " + url);
  return port;
}

function appEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const own: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && (/^(PATH|HOME|PORT|TMPDIR|LANG|SHELL|PIP_CACHE_DIR)$/.test(k) || k.startsWith("PARITY_"))) own[k] = v;
  }
  const files = process.env.PARITY_START_ENV;
  if (!files) return own;
  const cwd = process.env.PARITY_START_CWD || process.cwd();
  for (const f of files.split(":").filter((s) => s !== "")) {
    const path = resolve(cwd, f);
    if (!existsSync(path)) throw new Error("restartApp: PARITY_START_ENV names a file that does not exist: " + path);
    for (const raw of readFileSync(path, "utf8").split(/\\r?\\n/)) {
      const m = /^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*?)\\s*$/.exec(raw);
      if (!m || raw.trim().startsWith("#")) continue;
      let val = m[2] ?? "";
      if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.endsWith(val[0])) val = val.slice(1, -1);
      else val = val.replace(/\\s+#.*$/, "");
      env[m[1] as string] = val;
    }
  }
  return { ...env, ...own };
}

function pidsOut(cmd: string, args: string[]): number[] {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return String(res.stdout ?? "").split(/\\s+/).filter((s) => /^[0-9]+$/.test(s)).map(Number);
}

const listeners = (port: number): number[] => pidsOut("lsof", ["-ti", "tcp:" + String(port), "-sTCP:LISTEN"]);

function withChildren(pid: number): number[] {
  return [pid, ...pidsOut("pgrep", ["-P", String(pid)]).flatMap(withChildren)];
}

function tryHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port, host });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

async function isUp(port: number): Promise<boolean> {
  return (await tryHost(port, "127.0.0.1")) || (await tryHost(port, "::1"));
}

let started: number | null = null;

export async function restartApp(): Promise<void> {
  const port = portOf();
  const cmd = process.env.PARITY_START_CMD;
  const runDir = process.env.PARITY_RUN_DIR;
  if (!cmd) throw new Error("restartApp: PARITY_START_CMD (the command that starts the app) is not set");
  if (!runDir) throw new Error("restartApp: PARITY_RUN_DIR (the run's mktemp folder) is not set");
  mkdirSync(runDir, { recursive: true });

  const old = [...new Set([...(started === null ? [] : [started]), ...listeners(port)].flatMap(withChildren))];
  for (const pid of old) try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
  for (let i = 0; i < 100 && (await isUp(port)); i++) await sleep(100);
  if (await isUp(port)) {
    for (const pid of old) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    for (let i = 0; i < 50 && (await isUp(port)); i++) await sleep(100);
  }
  if (await isUp(port)) throw new Error("restartApp: port " + String(port) + " is still in use after the app was stopped");

  const log = openSync(join(runDir, "app-" + String(port) + ".log"), "a");
  const child = spawn(cmd, { shell: true, detached: false, stdio: ["ignore", log, log], cwd: process.env.PARITY_START_CWD || process.cwd(), env: appEnv() });
  if (child.pid === undefined) throw new Error("restartApp: could not start: " + cmd);
  started = child.pid;
  appendFileSync(join(runDir, "pids"), String(child.pid) + "\\n");
  appendFileSync(join(runDir, "ports"), String(port) + "\\n");
  let exited = false;
  child.once("exit", () => { exited = true; });
  for (let i = 0; i < 300 && !exited && !(await isUp(port)); i++) await sleep(100);
  if (!(await isUp(port))) throw new Error("restartApp: the app did not answer on port " + String(port) + " (see " + join(runDir, "app-" + String(port) + ".log") + ")");
}
`;

var join3 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
var DETACHING = /\b(?:setsid|nohup|disown)\b|\bdetached\s*:\s*true\b|\.unref\s*\(/;
var isRec4 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var list2 = (v) => Array.isArray(v) ? v.filter(isRec4) : [];
var same2 = (a, b) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
var ORIGINAL_SKIP = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor", ".dkod", "__pycache__", "test-results", "out", ".output", ".svelte-kit", ".nuxt", ".turbo", "coverage", "next-env.d.ts"];
function originalSha256(original, io) {
  const files = io.walk(original, ORIGINAL_SKIP).filter((f) => !f.endsWith(".tsbuildinfo")).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return io.sha256(files.map((f) => join3(original, f)));
}
var COPY_ADVICE = "Run the original from an unchanged copy; to run a production build, set env, never edit its code.";
var tryHash = (dir, io) => {
  try {
    return originalSha256(dir, io);
  } catch {
    return null;
  }
};
var serveCopyPath = (dir) => join3(dir, ".dkod/serve-copy.json");
function serveCopyOf(dir, io) {
  try {
    const r = JSON.parse(io.readFile(serveCopyPath(dir)) ?? "null");
    return isRec4(r) && typeof r.copy === "string" && r.copy !== "" ? r.copy : null;
  } catch {
    return null;
  }
}
function serveCopy(folder, copy, io) {
  const dir = folder === "" ? io.cwd : folder;
  const original = originalOf(io.readFile(join3(dir, ".dkod/migration.json")));
  if (original === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  if (copy === undefined || copy === "") {
    io.print("dkod-migrate: serve-copy needs the folder of the copy: serve-copy <folder> <copy folder>");
    return 2;
  }
  const there = tryHash(copy, io);
  const here = tryHash(original, io);
  if (there === null || here === null || there !== here)
    return fail(io, { problems: [`${copy}: the copy does not hold the original's source files (sha256 differs, or it is missing). Copy the original without .git again, before any edit. ${COPY_ADVICE}`] });
  io.writeFile(serveCopyPath(dir), `${JSON.stringify({ copy, sha256: here, recordedAt: new Date().toISOString() }, null, 2)}
`);
  io.print(JSON.stringify({ ok: true, copy, sha256: here }));
  return 0;
}
function originalDrift(original, frozen, io) {
  if (typeof frozen.original_sha256 !== "string")
    return [];
  const out = [];
  if (typeof frozen.original_copy === "string" && tryHash(frozen.original_copy, io) !== frozen.original_sha256) {
    out.push(`original: the copy that served the original (${frozen.original_copy}) differs from the one frozen, or it was moved or removed (sha256 differs). ${COPY_ADVICE}`);
  }
  if (tryHash(original, io) !== frozen.original_sha256)
    out.push(`original: the original differs from the one frozen (sha256 differs). It is read only. ${COPY_ADVICE}`);
  return out;
}
function mapFiles(dir, io) {
  return io.walk(join3(dir, ".dkod/map"), ["node_modules"]).map((rel) => `.dkod/map/${rel}`).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
var mapSha256 = (dir, io) => io.sha256([...mapFiles(dir, io)].map((f) => join3(dir, f)));
function mapDrift(dir, frozen, io) {
  if (typeof frozen.map_sha256 !== "string")
    return [];
  let now = "";
  try {
    now = mapSha256(dir, io);
  } catch {}
  return now === frozen.map_sha256 ? [] : [".dkod/map: the migration map (app-map.json or the design files) changed after the freeze (sha256 differs). Put the frozen map back; to change it, unfreeze, redo the map and the suite, and freeze again."];
}
var freezePath = (dir) => join3(dir, ".dkod/parity/freeze.json");
function hasRestart(body) {
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const call = /\b(?:fetch|request\.\w+|page\.\w+|api\.\w+|post|put|patch|delete|get)\s*\(/;
  const restart = /\brestart\w*\s*\(/i.exec(code);
  return restart !== null && call.test(code.slice(0, restart.index)) && call.test(code.slice(restart.index + restart[0].length));
}
var REPORT_REFUSAL = "not a raw Playwright JSON report; a hand-written summary is refused. Save the real one with `bunx playwright test --reporter=json > report.json` (PLAYWRIGHT_JSON_OUTPUT_NAME=report.json also works).";
function isReporterShape(json) {
  if (!isRec4(json) || !isRec4(json.config) || !isRec4(json.stats) || !Array.isArray(json.suites) || json.suites.length === 0)
    return false;
  for (const k of ["expected", "unexpected", "skipped", "flaky"])
    if (typeof json.stats[k] !== "number")
      return false;
  const suiteOk = (suite) => {
    if (!isRec4(suite))
      return false;
    if (suite.specs !== undefined) {
      if (!Array.isArray(suite.specs))
        return false;
      for (const spec of suite.specs) {
        if (!isRec4(spec) || !Array.isArray(spec.tests))
          return false;
        for (const t of spec.tests)
          if (!isRec4(t) || !Array.isArray(t.results))
            return false;
      }
    }
    if (suite.suites !== undefined) {
      if (!Array.isArray(suite.suites))
        return false;
      for (const sub of suite.suites)
        if (!suiteOk(sub))
          return false;
    }
    return true;
  };
  return json.suites.every(suiteOk);
}
function reportTests(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isReporterShape(json))
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
  const originalDir = originalOf(io.readFile(join3(dir, ".dkod/migration.json")));
  if (originalDir === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const copyDir = serveCopyOf(dir, io);
  if (copyDir === null)
    return fail(io, { problems: [".dkod/serve-copy.json: missing. Right after copying the original to the run's scratch folder (step 1), run `dkod-migrate.mjs serve-copy <folder> <copy folder>`, then run the suite on that copy."] });
  const copyHash = tryHash(copyDir, io);
  const origHash = tryHash(originalDir, io);
  if (copyHash === null || origHash === null || copyHash !== origHash)
    return fail(io, { problems: [`original: the copy that served the original (${copyDir}) differs from the original, or one of them cannot be read (sha256 differs). ${COPY_ADVICE}`] });
  if (reportFile === undefined)
    return fail(io, { problems: ["freeze needs the Playwright JSON report of the run on the original: freeze <folder> <report.json>"] });
  let map;
  try {
    const parsed = JSON.parse(io.readFile(join3(dir, ".dkod/map/app-map.json")) ?? "");
    if (!isRec4(parsed))
      throw new Error("not an object");
    map = parsed;
  } catch {
    return fail(io, { problems: [".dkod/map/app-map.json: missing or not valid JSON. Do the map step, and run check-map, first."] });
  }
  const overlays = devOverlayStates(join3(dir, ".dkod/map"), io);
  if (overlays.length > 0) {
    return fail(io, { problems: overlays.map((s) => `.dkod/map/design/pages/${s}.json: the capture shows a framework dev overlay. Capture the original's production build and start (Next.js: next build, then next start), never a dev server, then run freeze again.`), dev_overlay_pages: overlays });
  }
  const framed = new Set(frameStates(join3(dir, ".dkod/map"), io));
  const specs = io.walk(join3(dir, "tests/parity"), []).filter((f) => TEST_FILE.test(f));
  if (specs.length === 0)
    return fail(io, { problems: ["tests/parity: no test file found. Write the parity suite there first."] });
  const reportText = io.readFile(reportFile);
  if (reportText === null)
    return fail(io, { problems: [`${reportFile}: not found. Run the suite on the original with --reporter=json and write the output there.`] });
  const run = reportTests(reportText);
  if (run === null || run.length === 0)
    return fail(io, { problems: [`${reportFile}: ${REPORT_REFUSAL}`] });
  const failures = run.filter((t) => !t.ok).map((t) => `${t.title} (${t.status})`);
  const passed = new Set(run.filter((t) => t.ok).map((t) => t.title));
  const have = new Map;
  const notRun = [];
  const problems = [];
  let tagged = 0;
  for (const f of io.walk(join3(dir, "tests/parity"), ["node_modules"])) {
    if (!/\.[cm]?[jt]sx?$|\.sh$/.test(f))
      continue;
    const text = io.readFile(join3(dir, `tests/parity/${f}`)) ?? "";
    if (f === "restart.ts" && text === PARITY_RESTART_SOURCE)
      continue;
    const hit = DETACHING.exec(text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1"));
    if (hit !== null)
      problems.push(`tests/parity/${f}: \`${hit[0]}\` detaches a server from the run, so nothing stops it later. Delete this restart and call restartApp() from tests/parity/restart.ts (\`dkod-migrate.mjs install-restart <folder>\`)`);
  }
  for (const f of specs) {
    const blocks = testBlocks(io.readFile(join3(dir, `tests/parity/${f}`)) ?? "");
    problems.push(...designProblems(blocks, designFramed(framed)));
    for (const { title, body } of blocks) {
      let tags = tagsOf(title);
      if (tags.length === 0)
        continue;
      if (tags.some((t) => t.kind === "data") && !hasRestart(body)) {
        problems.push(`${title}: an @data test must write, read back, restart the app, then read again; this body has no restart between the write and the second read. Add the restart step (a restartApp() helper) and run the suite on the original again`);
        tags = tags.filter((t) => t.kind !== "data");
      }
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
  const flows = list2(map.flows).flatMap((f) => typeof f.name === "string" && !got("flow").some((k) => same2(k, f.name)) ? [f.name] : []);
  const data = list2(map.stores).length > 0 && got("data").length === 0 ? ["@data"] : [];
  const missing = { routes, pages, flows, data, design };
  const gaps = routes.length + pages.length + flows.length + data.length + design.length;
  const original_failures = [...failures, ...notRun];
  if (gaps > 0 || original_failures.length > 0 || problems.length > 0) {
    return fail(io, { problems, missing, original_failures, counts: { tests: run.length, original_passed: passed.size, original_failed: original_failures.length } });
  }
  let frozenData = null;
  let snap = null;
  try {
    snap = JSON.parse(io.readFile(join3(dir, ".dkod/snapshot.json")) ?? "null");
  } catch {}
  const dbs = isRec4(snap) && snap.mode === "snapshot" ? list2(snap.databases) : [];
  const pg = dbs.find((d) => typeof d.url === "string" && /^postgres(ql)?:\/\//i.test(d.url));
  if (pg !== undefined) {
    const again = "Run `dkod-migrate.mjs snapshot` again, rerun the suite on the original and freeze again.";
    if (!isRec4(pg.tables))
      return fail(io, { problems: [`.dkod/snapshot.json: the Postgres scratch database has no table tallies. ${again}`] });
    const before = {};
    for (const [n, t] of Object.entries(pg.tables))
      if (isRec4(t) && typeof t.rows === "number" && typeof t.md5 === "string")
        before[n] = { rows: t.rows, md5: t.md5 };
    const mapped = readMapTables(io.readFile(join3(dir, ".dkod/map/app-map.json"))).filter((n) => before[n] !== undefined);
    const now = await tallyNamed(pg.url, mapped, {}, io.run, dir);
    if (now === null)
      return fail(io, { problems: [`The scratch database cannot be read to record its data. ${again}`] });
    const frozenTables = {};
    for (const n of mapped)
      frozenTables[n] = before[n];
    frozenData = { database: typeof pg.name === "string" ? pg.name : "", tables: frozenTables, suite_writes: changedTables(frozenTables, now.tallies) };
    if (isRec4(pg.base) && typeof pg.base.url === "string") {
      const copy = await tallyNamed(pg.base.url, mapped, {}, io.run, dir);
      if (copy === null)
        return fail(io, { problems: [`The snapshot's base copy cannot be read to check it. ${again}`] });
      const moved = changedTables(frozenTables, copy.tallies);
      if (moved.length > 0)
        return fail(io, { problems: [`The snapshot's base copy differs from the snapshot's tallies (${moved.join(", ")}): the reference data was changed. ${again}`] });
    }
  }
  const flatBases = isRec4(snap) && snap.mode === "snapshot" ? list2(snap.bases).filter((b) => (b.kind === "csv" || b.kind === "json") && typeof b.file === "string" && typeof b.rel === "string" && typeof b.sha256 === "string") : [];
  if (pg === undefined && flatBases.length > 0) {
    const mapped = readMapTables(io.readFile(join3(dir, ".dkod/map/app-map.json")));
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
    const writes = new Set;
    for (const b of flatBases) {
      if (io.sha256([b.file]) === b.sha256)
        continue;
      const stem = norm((b.rel.split("/").pop() ?? "").replace(/\.(?:csv|json)$/i, ""));
      const hit = mapped.filter((n) => norm(n) === stem);
      for (const n of hit.length > 0 ? hit : mapped)
        writes.add(n);
    }
    frozenData = { database: "", tables: {}, suite_writes: [...writes] };
  }
  const files = suiteFiles(dir, io);
  const sha256 = io.sha256(files.map((f) => join3(dir, f)));
  const record = { sha256, files, baseline: { tests: run.map((t) => t.title), passed: passed.size }, frozenAt: new Date().toISOString(), platform: process.platform, data: frozenData, map_sha256: mapSha256(dir, io), original_sha256: origHash, original_copy: copyDir };
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

var STARTER_PACK = {
  version: 1,
  rules: [
    {
      name: "pinned-base-images",
      path: "rules/pinned-base-images.md",
      level: "block",
      stale: false,
      checks: [{ use: "dockerfile.from_digest", with: { exclude: ["Dockerfile.dev"] }, message: "Pin the base image by digest: FROM image:tag@sha256:<digest>", level: null }]
    }
  ]
};
var join4 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var SKIP = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor", ".dkod"];
var SOURCE3 = /\.[cm]?[jt]sx?$/;
var DATA = /\.(?:sqlite|sqlite3|db|db3)$/i;
var IMAGE = /\.(?:png|jpe?g|webp|gif)$/i;
var HTML = /\.html?$/i;
var CODE = /\.(?:js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|css)$/i;
var DESTRUCTIVE_SEED = [
  /\bdelete\s+from\b/i,
  /\btruncate\b(?!\s*\()/i,
  /\.truncate\s*\(/i,
  /\bdrop\s+(?:table|schema)\b/i,
  /\.delete\s*\(/i,
  /\.deleteMany\s*\(/i,
  /\bdeleteFrom\s*\(/i,
  /\.destroy\s*\(\s*\{/i,
  /\.del\s*\(/i
];
var stripComments3 = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/(^|\s)--.*$/gm, "$1");
var SEED_FILE = /\.(?:[cm]?[jt]s|sql|py)$/i;
var NEXT_MARKERS = ["__NEXT_DATA__", "/_next/static/", "next-route-announcer"];
var isRec5 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json3 = (text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
};
var base2 = (p) => p.split("/").pop() ?? p;
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
function ignoresDir(text, dir) {
  return text.split(`
`).some((raw) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!"))
      return false;
    return [dir, `${dir}/`, `/${dir}`, `/${dir}/`, `**/${dir}`, `**/${dir}/`].includes(line);
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
  problems.push(...checkSnapshot(dir, io));
  const frozen = json3(io.readFile(freezePath(dir)));
  if (!isRec5(frozen) || typeof frozen.sha256 !== "string" || !isRec5(frozen.baseline) || !Array.isArray(frozen.baseline.tests)) {
    problems.push(".dkod/parity/freeze.json: missing. Freeze the suite (step 3) before the build is checked.");
  } else {
    const record = frozen;
    const files = suiteFiles(dir, io);
    if (files.length === 0 || io.sha256(files.map((f) => join4(dir, f))) !== record.sha256) {
      problems.push("tests/parity: the suite changed after the freeze (sha256 differs). Put the frozen files back; never edit them.");
    }
    problems.push(...mapDrift(dir, record, io));
    problems.push(...originalDrift(original, record, io));
    const reportText = reportFile === undefined ? null : io.readFile(reportFile);
    const run = reportText === null ? null : reportTests(reportText);
    if (reportFile === undefined)
      problems.push("check-build needs the Playwright JSON report of the frozen suite run on the dk- app: check-build <folder> <report.json>");
    else if (run === null)
      problems.push(`${reportFile}: not found, or ${REPORT_REFUSAL}`);
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
  const sources = io.walk(dir, SKIP);
  const map = json3(io.readFile(join4(dir, ".dkod/map/app-map.json")));
  const tables = isRec5(map) && Array.isArray(map.tables) ? map.tables.filter(isRec5).flatMap((t) => typeof t.name === "string" ? [t.name] : []) : [];
  if (tables.length > 0) {
    const text = sources.filter((f) => SOURCE3.test(f) && !/^(?:tests|migrations)\//.test(f)).map((f) => io.readFile(join4(dir, f)) ?? "").join(`
`);
    for (const name of tables) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(["'\`])${esc}\\1`).test(text))
        problems.push(`table ${name}: named in no source file of the dk- app. Write its schema.`);
    }
  }
  if (!sources.some((f) => /^migrations\/0001_baseline[^/]*$/.test(f)))
    problems.push("migrations/: no 0001_baseline migration. Generate it from the schema.");
  if (tables.length > 0) {
    const pkg = json3(io.readFile(join4(dir, "package.json")));
    const scripts = isRec5(pkg) && isRec5(pkg.scripts) ? pkg.scripts : {};
    const seedCmd = scripts["db:seed"];
    if (typeof seedCmd !== "string")
      problems.push("package.json: no db:seed script. CI runs the suite on an empty database: write db:seed to insert the rows the suite reads (the original's rows it ran green on), run it on the Dev data, and never insert rows by hand.");
    else {
      const named = seedCmd.split(/\s+/).map((t) => t.replace(/^\.\//, "")).filter((t) => SEED_FILE.test(t) && sources.includes(t));
      const seeds = new Set([
        ...named,
        ...sources.filter((f) => SEED_FILE.test(f) && !f.startsWith("tests/") && !f.startsWith(".dkod/") && (/^seed/i.test(base2(f)) || /(^|\/)seeders?\/|(^|\/)seeds\//.test(f)))
      ]);
      for (const f of seeds) {
        const text = io.readFile(join4(dir, f)) ?? "";
        const code = stripComments3(/\.py$/i.test(f) ? text.replace(/(^|\s)#.*$/gm, "$1") : text);
        const hit = DESTRUCTIVE_SEED.map((re) => re.exec(code)).find((m) => m !== null);
        if (hit)
          problems.push(`${f}: db:seed deletes, truncates or drops rows (${hit[0].trim()}). Dev is shared by every builder in the org and CI runs db:seed too: insert the original's rows idempotently (insert ... on conflict do nothing, or skip a table that already has rows) and never delete, truncate or update rows.`);
      }
    }
  }
  for (const f of sources)
    if (DATA.test(f))
      problems.push(`${f}: a file database in the dk- folder. The data lives in the Dev data service.`);
  problems.push(...localStoreProblems(sources, (f) => io.readFile(join4(dir, f)) ?? ""));
  const assets = json3(io.readFile(join4(dir, ".dkod/map/assets/assets.json")));
  if (Array.isArray(assets)) {
    for (const a of assets.filter(isRec5)) {
      if (typeof a.path !== "string")
        continue;
      const source = join4(original, a.path);
      if (io.readFile(source) === null) {
        problems.push(`asset ${a.path}: not readable in the original at ${source}.`);
        continue;
      }
      const want = io.sha256([source]);
      const same = sources.some((f) => base2(f) === base2(a.path) && io.sha256([join4(dir, f)]) === want);
      if (!same)
        problems.push(`asset ${a.path}: no byte-identical copy in the dk- folder. Copy the file as it is; never redraw it.`);
    }
  }
  const declared = new Set(Array.isArray(assets) ? assets.filter(isRec5).flatMap((a) => typeof a.path === "string" ? [a.path] : []) : []);
  const originalCode = new Map;
  const blank = (path) => (io.readFile(path) ?? "").trim() === "";
  for (const rel of io.walk(original, SKIP))
    if (CODE.test(rel) && !declared.has(rel) && !blank(join4(original, rel)))
      originalCode.set(io.sha256([join4(original, rel)]), rel);
  if (originalCode.size > 0) {
    for (const f of sources) {
      if (!CODE.test(f) || f.startsWith("tests/parity/") || f.startsWith(".dkod/") || blank(join4(dir, f)))
        continue;
      const orig = originalCode.get(io.sha256([join4(dir, f)]));
      if (orig !== undefined)
        problems.push(`${f}: byte-identical to ${orig}, a code file of the original. The map and the frozen suite are the spec, not the original's code; rebuild it on the stack.`);
    }
  }
  for (const f of sources) {
    const infra = f === "Dockerfile" || f === ".dockerignore" || f === "package.json" || /^\.github\/workflows\//.test(f);
    if (!infra && !(SOURCE3.test(f) && !f.startsWith("tests/")))
      continue;
    const line = templateTokenLine(io.readFile(join4(dir, f)) ?? "");
    if (line !== null)
      problems.push(`${f}: still has template text ({{...}} at line ${String(line)}). Render the template with dkod-migrate.mjs render; never copy its source.`);
  }
  const appName = base2((dir === "." ? io.cwd : dir).replace(/[\\/]+$/, ""));
  if (appName.startsWith("dk-") && sources.includes("package.json") && !sources.includes("bun.lock")) {
    problems.push("bun.lock: missing. Run `bun install` in the dk- folder and keep bun.lock; without it the deploy installs without a lock file.");
  }
  const designDir = join4(dir, ".dkod/map/design/pages");
  const designs = new Map;
  for (const rel of io.walk(designDir, []))
    if (IMAGE.test(rel))
      designs.set(io.sha256([join4(designDir, rel)]), rel);
  if (designs.size > 0) {
    for (const f of sources) {
      if (f.startsWith("tests/parity/") || !IMAGE.test(f))
        continue;
      const name = designs.get(io.sha256([join4(dir, f)]));
      if (name !== undefined)
        problems.push(`${f}: byte-identical to the design screenshot ${name} of the map. Rebuild the page; never serve the design image.`);
    }
  }
  for (const f of sources) {
    if (/(^|\/)_next(\/|$)/.test(f) || /(^|\/)webpack-[^/]*\.js$/.test(f) || /(^|\/)chunks\//.test(f) || base2(f).includes("buildManifest")) {
      problems.push(`${f}: the original's build output in the dk- folder. Never copy build output; rebuild every page on the stack.`);
    }
  }
  const pages = sources.filter((f) => HTML.test(f) && !f.startsWith("tests/"));
  if (pages.length > 0) {
    const rendered = new Set(io.walk(original, SKIP).filter((f) => HTML.test(f)).map((f) => io.sha256([join4(original, f)])));
    for (const f of pages) {
      const marker = NEXT_MARKERS.find((m) => (io.readFile(join4(dir, f)) ?? "").includes(m));
      if (marker !== undefined)
        problems.push(`${f}: served HTML with the original's ${marker}. Never serve the original's rendered pages; rebuild every page on the stack.`);
      else if (rendered.has(io.sha256([join4(dir, f)])))
        problems.push(`${f}: a copy of a page the original rendered. Never serve the original's HTML; rebuild every page on the stack.`);
    }
  }
  problems.push(...await devDrift(dir, io));
  problems.push(...await referenceDrift(dir, io));
  problems.push(...await migrationRows(dir, io));
  if (io.readFile(join4(dir, ".env.local")) !== null && !ignoresEnvLocal(io.readFile(join4(dir, ".gitignore")) ?? "")) {
    problems.push(".env.local: not covered by .gitignore. Add it before anything is committed.");
  }
  const gitignore = io.readFile(join4(dir, ".gitignore")) ?? "";
  for (const out of ["test-results", "playwright-report"]) {
    if (sources.some((f) => f.startsWith(`${out}/`)) && !ignoresDir(gitignore, out)) {
      problems.push(`${out}/: Playwright output is in the dk- folder and .gitignore does not ignore it. Add ${out}/ to .gitignore and delete the folder (git rm -r --cached if it is tracked).`);
    }
  }
  const warnings = [];
  const policy = await checkFolder(STARTER_PACK, dir, { list: async (d) => io.walk(d, SKIP), read: async (p) => io.readFile(p) ?? "", fetch: io.fetch });
  if (policy.ok) {
    for (const f of policy.findings) {
      const text = `${f.path ?? "(folder)"}${f.line === null ? "" : `:${String(f.line)}`}: ${f.rule}: ${f.message}`;
      if (f.level === "block")
        problems.push(text);
      else if (f.check === "dockerfile.from_digest")
        warnings.push(text);
    }
  } else
    problems.push(`policy check: ${policy.message}`);
  const ok = problems.length === 0;
  io.print(JSON.stringify({ ok, problems, ...warnings.length > 0 ? { warnings } : {}, new_failed, counts: { tests, new_passed: newPassed, new_failed: new_failed.length, visual_diff: visual } }));
  return ok ? 0 : 1;
}

var join5 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var numbers = (text) => (text ?? "").split(/[\s,]+/).filter((s) => /^[0-9]+$/.test(s)).map(Number);
var KILL_WAIT_MS = 1500;
var alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
var signal = (pid, sig, group) => {
  try {
    process.kill(group ? -pid : pid, sig);
  } catch {}
};
function recorded(runDir, extraPorts, io) {
  const pids = new Set;
  const ports = new Set(numbers(extraPorts ?? ""));
  for (const n of numbers(io.readFile(join5(runDir, "pids"))))
    pids.add(n);
  for (const n of numbers(io.readFile(join5(runDir, "ports"))))
    ports.add(n);
  return { pids: [...pids], ports: [...ports] };
}
async function listeners(port, io) {
  if (!io.hasTool("lsof"))
    return null;
  const res = await io.run("lsof", ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-t"], {}, io.cwd);
  return numbers(res.stdout);
}
async function stopServers(runDir, extraPorts, io) {
  const { pids, ports } = recorded(runDir, extraPorts, io);
  const problems = [];
  const table = new Map;
  if (io.hasTool("ps")) {
    for (const line of (await io.run("ps", ["-A", "-o", "pid=,ppid=,pgid="], {}, io.cwd)).stdout.split(`
`)) {
      const [pid, ppid, pgid] = numbers(line);
      if (pid !== undefined && ppid !== undefined && pgid !== undefined)
        table.set(pid, { ppid, pgid });
    }
  }
  const targets = new Map;
  const add = (pid) => {
    if (pid === process.pid || pid <= 1 || targets.has(pid))
      return;
    targets.set(pid, table.get(pid)?.pgid === pid && table.get(process.pid)?.pgid !== pid);
    for (const [child, info] of table)
      if (info.ppid === pid)
        add(child);
  };
  for (const pid of pids)
    if (table.has(pid))
      add(pid);
  const stopped = [...targets.keys()].filter(alive);
  for (const [pid, group] of targets)
    signal(pid, "SIGTERM", group);
  const deadline = Date.now() + KILL_WAIT_MS;
  while (Date.now() < deadline && stopped.some(alive))
    await new Promise((r) => setTimeout(r, 50));
  for (const [pid, group] of targets) {
    if (alive(pid))
      signal(pid, "SIGKILL", group);
  }
  if (pids.length > 0)
    io.writeFile(join5(runDir, "pids"), "");
  await new Promise((r) => setTimeout(r, 100));
  for (const port of ports) {
    const held = await listeners(port, io);
    if (held === null)
      problems.push(`port ${String(port)}: lsof is not installed, so the check that nothing listens there cannot run`);
    else if (held.length > 0)
      problems.push(`port ${String(port)} is still held by PID ${held.join(", ")}: stop it (it was not recorded in ${runDir}), then run stop-servers again`);
  }
  if (ports.length === 0)
    problems.push(`no port to check: ${runDir}/ports is empty or missing. Pass --ports <a,b> (the parity ports), or let restartApp() record them`);
  return { ok: problems.length === 0, ports, stopped, problems };
}
function flagValue(args, name) {
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === name)
      return args[i + 1];
    if (a.startsWith(`${name}=`))
      return a.slice(name.length + 1);
  }
  return;
}
async function stopServersCommand(args, io) {
  const runDir = flagValue(args, "--run-dir");
  if (runDir === undefined || runDir === "") {
    io.print("dkod-migrate: stop-servers needs --run-dir <the run's mktemp folder>: stop-servers <folder> --run-dir <dir> [--ports a,b]");
    return 2;
  }
  const res = await stopServers(runDir, flagValue(args, "--ports"), io);
  io.print(JSON.stringify({ ok: res.ok, ports: res.ports, stopped: res.stopped, problems: res.problems }));
  return res.ok ? 0 : 1;
}

var join6 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var isRec6 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var json4 = (text) => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
};
var READY = "Ready to deploy";
var NOT_YET = "Not yet";
async function sideBySide(folder, originalReport, dkReport, io, args = []) {
  const dir = folder === "" ? io.cwd : folder;
  if (originalOf(io.readFile(join6(dir, ".dkod/migration.json"))) === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const problems = [];
  const original = { tests: 0, passed: 0, failed: 0 };
  const dk = { tests: 0, passed: 0, failed: 0 };
  let visual = 0;
  let restart = { original: "n/a", dk: "n/a" };
  let restartFailed = 0;
  const frozen = json4(io.readFile(freezePath(dir)));
  if (!isRec6(frozen) || typeof frozen.sha256 !== "string" || !isRec6(frozen.baseline) || !Array.isArray(frozen.baseline.tests)) {
    problems.push(".dkod/parity/freeze.json: missing. Freeze the suite (step 3) first.");
  } else {
    const record = frozen;
    const files = suiteFiles(dir, io);
    if (files.length === 0 || io.sha256(files.map((f) => join6(dir, f))) !== record.sha256) {
      problems.push("tests/parity: the suite changed after the freeze (sha256 differs). Put the frozen files back; never edit them.");
    }
    problems.push(...mapDrift(dir, record, io));
    const load = (file, label) => {
      const text = file === undefined ? null : io.readFile(file);
      const run = text === null ? null : reportTests(text);
      if (file === undefined)
        problems.push("side-by-side needs both reports: side-by-side <folder> <original report.json> <dk report.json>");
      else if (run === null)
        problems.push(`${file}: not found, or ${REPORT_REFUSAL} (the ${label} report)`);
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
    const baseline = new Set(record.baseline.tests);
    const dataTests = files.filter((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f)).flatMap((f) => testBlocks(io.readFile(join6(dir, f)) ?? "")).filter((t) => baseline.has(t.title) && tagsOf(t.title).some((tag) => tag.kind === "data"));
    const verdict = (run, label) => {
      if (dataTests.length === 0)
        return "n/a";
      let pass = true;
      for (const t of dataTests) {
        const has = hasRestart(t.body);
        if (has && run?.get(t.title)?.ok === true)
          continue;
        pass = false;
        restartFailed += 1;
        if (!has)
          problems.push(`${t.title}: has no restart between write and read (restart: fail on the ${label})`);
      }
      return pass ? "pass" : "fail";
    };
    restart = { original: verdict(onOriginal, "original app"), dk: verdict(onDk, "dk- app") };
  }
  const map = json4(io.readFile(join6(dir, ".dkod/map/app-map.json")));
  const count = (key) => isRec6(map) && Array.isArray(map[key]) ? map[key].length : 0;
  const snapshot = json4(io.readFile(join6(dir, ".dkod/snapshot.json")));
  const dataImported = isRec6(snapshot) && snapshot.mode === "snapshot" && snapshot.imported === true;
  problems.push(...await devDrift(dir, io));
  problems.push(...await referenceDrift(dir, io));
  const runDir = flagValue(args, "--run-dir");
  let serversStopped = null;
  if (runDir !== undefined && runDir !== "") {
    const stop = await stopServers(runDir, flagValue(args, "--ports"), io);
    serversStopped = stop.ok;
    problems.push(...stop.problems);
  }
  const ok = problems.length === 0;
  io.print(JSON.stringify({
    ok,
    problems,
    report: { routes: count("routes"), flows: count("flows"), pages: count("pages"), original, dk, visual_diff: visual, data_imported: dataImported, restart, ...serversStopped === null ? {} : { servers_stopped: serversStopped } },
    counts: { tests: dk.tests, original_passed: original.passed, original_failed: original.failed, new_passed: dk.passed, new_failed: dk.failed, visual_diff: visual, restart_failed: restartFailed },
    question: { text: "The dk- app is running next to the original. Does it match, and is it ready to deploy?", options: [READY, NOT_YET] }
  }));
  return ok ? 0 : 1;
}

var ENV_FILE2 = ".dkod-snapshot.env";
var USAGE = [
  "Usage:",
  "  node dkod-migrate.mjs snapshot <the dk- app's folder> [--db-url [KEY=]<url>] [--original-url http://localhost:<port>]",
  "  node dkod-migrate.mjs check-map <the dk- app's folder> [--original-url http://localhost:<port>]",
  "  node dkod-migrate.mjs serve-copy <the dk- app's folder> <the folder of the original's copy>",
  "  node dkod-migrate.mjs freeze <the dk- app's folder> <report.json>",
  "  node dkod-migrate.mjs unfreeze <the dk- app's folder>",
  "  node dkod-migrate.mjs render <template.md> <the dk- app's folder> [values.json] [--force]",
  "  node dkod-migrate.mjs check-build <the dk- app's folder> <report.json>",
  "  node dkod-migrate.mjs install-restart <the dk- app's folder>",
  "  node dkod-migrate.mjs side-by-side <the dk- app's folder> <original report.json> <dk report.json> [--run-dir <mktemp folder>]",
  "  node dkod-migrate.mjs stop-servers <the dk- app's folder> --run-dir <mktemp folder> [--ports a,b]",
  "  node dkod-migrate.mjs clean <the dk- app's folder> [--run-dir <mktemp folder>]"
].join(`
`);
var SOURCE_MAX_AGE_MIN = 10;
var SCRATCH_NAME = /_dkod_migrate(_[A-Za-z0-9_]+)?(_base)?$/;
var CHECKS = ["name", "age (pg_database file time / pg_stat_database.stats_reset, when readable)"];
var USE_OWN_STORE = "Snapshot the original's own store: its .env/.env.local URL, its running process (--original-url), or the --db-url the builder gives. Never make a database for the original or run its seed, fixtures, db push or reset to get data.";
var NEW_APP_ONLY = "The original app has no data files and no local database this computer can copy. The migration is new-app-only: its tests run only on the dk- app. Ask the builder how the original reads its data. If it reads its database from its environment, run snapshot again with --db-url <url> or, with the original running, --original-url http://localhost:<port>. Never write .dkod/snapshot.json by hand.";
var join7 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var norm = (p) => p.replace(/\/\.\//g, "/").replace(/\/+/g, "/");
var snapshotPath = (dir) => join7(dir, ".dkod/snapshot.json");
var recordPath = (dir) => join7(dir, ".dkod/migration.json");
var SKIP2 = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor"];
var DATA2 = /\.(?:sqlite|sqlite3|db|db3)$/i;
var FLAT = /\.(?:csv|json)$/i;
var NOT_DATA = /(?:^|\/)(?:package(?:-lock)?|composer(?:\.lock)?|tsconfig[^/]*|jsconfig[^/]*|app|vercel|now|firebase|deno|bun|manifest|renovate|[^/]*\.config|\.eslintrc[^/]*|\.prettierrc[^/]*|\.babelrc)\.json$|(?:^|\/)\.dkod\/|(?:^|\/)composer\.lock$/i;
var CODE2 = /\.(?:py|js|mjs|cjs|jsx|ts|tsx|rb|php|go|java|cs|rs|sh)$/i;
var CODE_CAP = 256 * 1024;
var LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
var DB_SCHEMES = new Set(["postgres:", "postgresql:", "mysql:", "mariadb:"]);
function checkSnapshot(dir, io) {
  const text = io.readFile(snapshotPath(dir));
  if (text === null)
    return [];
  const bad = [".dkod/snapshot.json was not written by dkod-migrate.mjs snapshot (no seal, or changed after it): run snapshot again; never write it by hand."];
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return bad;
  }
  if (typeof r !== "object" || r === null || typeof r.seal !== "string" || typeof r.nonce !== "string" || sealOf(r, r.nonce) !== r.seal)
    return bad;
  if (r.mode === "snapshot" && typeof r.scratch === "string" && r.scratch !== "" && io.readFile(join7(r.scratch, SEAL_FILE))?.trim() !== r.seal)
    return bad;
  return [];
}
function snapshotArgs(args) {
  const pairs = [];
  let originalUrl = "";
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    const joined = /^(--db-url|--original-url)=(.*)$/.exec(a);
    const flag = joined?.[1] ?? a;
    if (flag !== "--db-url" && flag !== "--original-url")
      continue;
    const value = joined !== null ? joined[2] : args[++i] ?? "";
    if (flag === "--original-url")
      originalUrl = value;
    else {
      const kv = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(value);
      pairs.push(kv !== null ? [kv[1], kv[2]] : ["DATABASE_URL", value]);
    }
  }
  return { pairs, originalUrl };
}
async function processPairs(originalUrl, io) {
  let port = "";
  try {
    port = new URL(originalUrl).port;
  } catch {
    return [];
  }
  if (port === "" || !io.hasTool("lsof") || !io.hasTool("ps"))
    return [];
  const pid = (await io.run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {}, io.cwd)).stdout.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9]+$/.test(pid))
    return [];
  const out = [];
  for (const token of (await io.run("ps", ["eww", "-o", "command=", "-p", pid], {}, io.cwd)).stdout.split(/\s+/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=([a-z][a-z0-9+.-]*:.*)$/i.exec(token);
    if (m !== null)
      out.push([m[1], m[2]]);
  }
  return out;
}
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
  const pg = url.protocol.startsWith("postgres");
  const password = url.password === "" ? null : { [url.protocol.startsWith("postgres") ? "PGPASSWORD" : "MYSQL_PWD"]: decodeURIComponent(url.password) };
  return { host, port, user: decodeURIComponent(url.username), env: { ...pg ? PG_TIMEOUT : {}, ...password ?? {} } };
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
  const rel = norm(raw.startsWith("/") ? raw : join7(original, raw)).slice(norm(original).length).replace(/^\//, "");
  if (rel === "")
    return null;
  const copy = files.find((f) => norm(f).endsWith(`/${rel}`));
  return copy === undefined ? null : `${isUrl ? "file:" : ""}${copy}`;
}
function relOfValue(original, value) {
  const isUrl = value.startsWith("file:");
  const raw = isUrl ? value.slice(5) : value;
  if (raw === "" || !isUrl && /^[a-z][a-z0-9+.-]*:/i.test(raw))
    return null;
  const rel = norm(raw.startsWith("/") ? raw : join7(original, raw)).slice(norm(original).length).replace(/^\//, "");
  return rel === "" ? null : rel;
}
var ENV_READ = /(?:os\.environ(?:\.get)?\s*[\[(]\s*|os\.getenv\s*\(\s*|process\.env\s*\[\s*)["']([A-Za-z_][A-Za-z0-9_]*)["']|process\.env\.([A-Za-z_][A-Za-z0-9_]*)/;
function flatData(original, rels, named, mapText, io) {
  const found = new Map;
  const flat = rels.filter((r) => FLAT.test(r) && !NOT_DATA.test(r));
  if (flat.length === 0)
    return found;
  for (const [key, value] of named) {
    const rel = relOfValue(original, value);
    const hit = rel === null ? undefined : flat.find((f) => f === rel || norm(`/${f}`).endsWith(norm(`/${rel}`)));
    if (hit === undefined || found.has(hit))
      continue;
    if (/\.json$/i.test(hit)) {
      const text = io.readFile(join7(original, hit));
      if (text === null || !parseJsonRows(text).ok)
        continue;
    }
    found.set(hit, { how: "env", key });
  }
  const rest = flat.filter((f) => !found.has(f));
  if (rest.length > 0) {
    for (const file of rels) {
      if (!CODE2.test(file))
        continue;
      const text = io.readFile(join7(original, file));
      if (text === null || text.length > CODE_CAP)
        continue;
      for (const f of rest) {
        const name = f.split("/").pop();
        if (!found.has(f) && (text.includes(`"${f}"`) || text.includes(`'${f}'`) || text.includes(`"${name}"`) || text.includes(`'${name}'`))) {
          const line = text.split(`
`).find((l) => (l.includes(f) || l.includes(name)) && ENV_READ.test(l));
          const at = line === undefined ? 0 : Math.max(line.indexOf(f), line.indexOf(name));
          let key;
          let best = Infinity;
          for (const m of line === undefined ? [] : line.matchAll(new RegExp(ENV_READ.source, "g"))) {
            const k = m[1] ?? m[2];
            if (k === undefined || /^(?:NODE_ENV|FLASK_ENV|PORT)$/.test(k))
              continue;
            const d = Math.abs(m.index - at);
            if (d < best) {
              best = d;
              key = k;
            }
          }
          found.set(f, { how: "code", file, ...key !== undefined ? { key } : {} });
        }
      }
    }
  }
  for (const f of flat)
    if (!found.has(f) && /(?:^|\/)data\//.test(f))
      found.set(f, { how: "data-folder" });
  if (mapText !== null) {
    for (const f of flat)
      if (!found.has(f) && mapText.includes(`"${f}"`))
        found.set(f, { how: "map" });
  }
  return found;
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
    const connect = ["-w", "-h", host, "-p", port, ...user ? ["-U", user] : []];
    const ok = async (cmd, args) => {
      const res = await io.run(cmd, args, env, io.cwd);
      if (res.status !== 0 && isNoPassword(res.stderr))
        throw new Error(NO_PASSWORD);
      return res.status === 0;
    };
    if (!await ok("pg_dump", ["-w", "--dbname", withDatabase(value, source), "--file", dump]))
      return null;
    const made = [];
    const step = async (cmd, args, making) => {
      const res = await io.run(cmd, args, env, io.cwd);
      if (res.status === 0) {
        if (making !== undefined)
          made.push(making);
        return;
      }
      if (isNoPassword(res.stderr))
        throw new Error(NO_PASSWORD);
      for (const m of made)
        await dropDatabase({ name: m, url: withDatabase(value, m) }, io);
      throw new CopyFailed(copyFailedMessage(cmd, res.stderr, { host, port, user, database: source }));
    };
    await step("createdb", [...connect, name], name);
    await step("psql", [...connect, "-d", name, "-f", dump]);
    const baseName = `${name}_base`;
    await step("createdb", [...connect, baseName], baseName);
    await step("psql", [...connect, "-d", baseName, "-f", dump]);
    return { name, url: withDatabase(value, name), base: { name: baseName, url: withDatabase(value, baseName) } };
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
var PRINT_CAP = 50;
function printable(record) {
  const long = record.files.length > PRINT_CAP || (record.bases?.length ?? 0) > PRINT_CAP;
  if (!long)
    return record;
  return {
    ...record,
    files: record.files.slice(0, PRINT_CAP),
    files_total: record.files.length,
    ...record.bases ? { bases: record.bases.slice(0, PRINT_CAP), bases_total: record.bases.length } : {},
    lists_cut: `files and bases list the first ${PRINT_CAP}; .dkod/snapshot.json has all of them`
  };
}

class CopyFailed extends Error {
}
function copyFailedMessage(cmd, stderr, at) {
  const first = stderr.split(`
`).map((l) => l.trim()).find((l) => l !== "") ?? "no error text";
  const where = `${at.database} on ${at.host}:${at.port}`;
  const noRight = cmd === "createdb" && /permission denied|must be (?:superuser|owner)|not allowed/i.test(first);
  const why = noRight ? `the user ${at.user || "(default)"} may not create databases there, and the snapshot makes its two scratch copies on the same server` : `${cmd} failed: ${first.replace(/postgres(?:ql)?:\/\/\S+/gi, "<url>")}`;
  return `Could not copy the database ${where}: ${why}. Nothing was copied. Run snapshot again with --db-url <the original's local Postgres, where its user can create databases>, or ask the builder for one. Never point it at a DKOD Dev database (a dkod-db helper port).`;
}
async function dropDatabase(db, io) {
  const url = localDatabase(db.url);
  if (url === null)
    return;
  const { host, port, user, env } = connection(url);
  if (url.protocol.startsWith("postgres"))
    await io.run("dropdb", ["-w", "-h", host, "-p", port, ...user ? ["-U", user] : [], db.name], env, io.cwd);
  else
    await io.run("mysql", ["-h", host, "-P", port, ...user ? ["-u", user] : [], "-e", `DROP DATABASE IF EXISTS \`${db.name}\``], env, io.cwd);
}
async function refusedSource(value, io) {
  const url = localDatabase(value);
  if (url === null)
    return null;
  const database = databaseOf(url);
  if (database.endsWith("_dkod_migrate"))
    return `the source database ${database} was refused: its name ends in _dkod_migrate. ${USE_OWN_STORE}`;
  if (SCRATCH_NAME.test(database))
    return `the source database ${database} was refused: it has a dkod-migrate scratch name. ${USE_OWN_STORE}`;
  if (!url.protocol.startsWith("postgres") || !io.hasTool("psql"))
    return null;
  const { host, port, user, env } = connection(url);
  const queries = [
    "select extract(epoch from now()-(pg_stat_file('base/'||oid||'/PG_VERSION')).modification) from pg_database where datname=current_database()",
    "select extract(epoch from now()-stats_reset) from pg_stat_database where datname=current_database()"
  ];
  let text = "";
  for (const sql of queries) {
    const res = await io.run("psql", ["-w", "-h", host, "-p", port, ...user ? ["-U", user] : [], "-d", database, "-At", "-c", sql], env, io.cwd).catch(() => null);
    if (res !== null && res.status === 0 && /^\d+(\.\d+)?$/.test(res.stdout.trim())) {
      text = res.stdout.trim();
      break;
    }
  }
  if (text === "")
    return null;
  const minutes = Math.floor(Number(text) / 60);
  if (minutes >= SOURCE_MAX_AGE_MIN)
    return null;
  return `the source database ${database} was refused: it was created ${String(minutes)} minutes ago (under ${String(SOURCE_MAX_AGE_MIN)}), so the agent probably made it. ${USE_OWN_STORE}`;
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
    for (const db of record.databases ?? []) {
      await dropDatabase(db, io);
      if (db.base)
        await dropDatabase(db.base, io);
    }
  }
  io.rm(snapshotPath(dir), { force: true });
  return record;
}
async function snapshot(folder, io, args = []) {
  const dir = folder === "" ? io.cwd : folder;
  const original = originalOf(io.readFile(recordPath(dir)));
  if (original === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  await removeSnapshot(dir, io);
  const scratch = io.mkdtemp(join7(io.tmpdir(), "dkod-migrate-"));
  const id = (scratch.split(/[\\/]/).pop() ?? "run").replace(/^dkod-migrate-/, "").replace(/[^A-Za-z0-9]/g, "_");
  const files = [];
  const bases = [];
  const flags = snapshotArgs(args);
  const named = flags.pairs.map(([k, v]) => [k, v, "db-url"]);
  if (flags.originalUrl !== "")
    for (const [k, v] of await processPairs(flags.originalUrl, io))
      named.push([k, v, "process"]);
  for (const file of [".env.local", ".env"])
    for (const [k, v] of envPairs(io.readFile(join7(original, file))))
      named.push([k, v, file]);
  const walked = io.walk(original, SKIP2);
  const flatFound = flatData(original, walked, named.map(([k, v]) => [k, v]), io.readFile(join7(dir, ".dkod/map/app-map.json")), io);
  for (const rel of walked) {
    const flat = flatFound.get(rel);
    if (!DATA2.test(rel) && flat === undefined)
      continue;
    const to = join7(scratch, rel);
    io.copyFile(join7(original, rel), to);
    files.push(to);
    const base = join7(scratch, `.dkod-base/${rel}`);
    io.copyFile(join7(original, rel), base);
    bases.push({ file: to, base, rel, sha256: io.sha256([base]), ...flat !== undefined ? { kind: /\.csv$/i.test(rel) ? "csv" : "json", found: flat } : {} });
  }
  const env = { DKOD_MIGRATE_DATA: scratch };
  for (const b of bases)
    if (b.found?.how === "code" && b.found.key !== undefined && !(b.found.key in env))
      env[b.found.key] = b.file;
  const databases = [];
  let noPassword = false;
  let refused = null;
  const pair = async (key, value, how) => {
    if (key in env)
      return;
    const copied = copiedFile(original, files, value);
    if (copied !== null) {
      env[key] = copied;
      return;
    }
    if (noPassword || refused !== null)
      return;
    if (localDatabase(value) !== null) {
      try {
        refused = await refusedSource(value, io);
      } catch {
        refused = null;
      }
      if (refused !== null)
        return;
    }
    let db;
    try {
      db = await copyDatabase(value, scratch, id, io);
    } catch (e) {
      if (e instanceof Error && e.message === NO_PASSWORD) {
        noPassword = true;
        return;
      }
      if (e instanceof CopyFailed) {
        refused = e.message;
        return;
      }
      throw e;
    }
    if (db === null)
      return;
    const source = localDatabase(value);
    if (source.protocol.startsWith("postgres")) {
      const env2 = connection(source).env;
      const from = db.base?.url ?? db.url;
      const cols = await readColumns(from, null, env2, io.run, io.cwd);
      const got = cols === null ? null : await tallies(from, [...cols].map(([name, c]) => ({ name, cols: c })), env2, io.run, io.cwd);
      if (got !== null)
        Object.assign(db, { tables: got });
    }
    const from0 = connection(source);
    db.source = { host: from0.host, port: from0.port, database: databaseOf(source), how };
    databases.push(db);
    env[key] = db.url;
  };
  for (const [key, value, how] of named)
    await pair(key, value, how);
  if (refused !== null) {
    for (const db of databases) {
      await dropDatabase(db, io);
      if (db.base)
        await dropDatabase(db.base, io);
    }
    io.rm(scratch, { recursive: true, force: true });
    io.print(`dkod-migrate: ${refused}`);
    return 1;
  }
  if (noPassword) {
    for (const db of databases) {
      await dropDatabase(db, io);
      if (db.base)
        await dropDatabase(db.base, io);
    }
    io.rm(scratch, { recursive: true, force: true });
    io.print(`dkod-migrate: ${NO_PASSWORD}`);
    return 1;
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
    ...bases.length > 0 ? { bases } : {},
    env: empty ? {} : env,
    ...databases[0]?.source ? { source: databases[0].source } : files.length > 0 ? { source: { how: "file", file: files[0] } } : {},
    ...empty ? {} : { checks: CHECKS },
    ...empty ? { message: NEW_APP_ONLY } : {}
  };
  record.nonce = randomBytes(16).toString("hex");
  record.seal = sealOf(record, record.nonce);
  if (!empty)
    io.writeFile(join7(scratch, SEAL_FILE), record.seal);
  if (!empty)
    io.writeFile(join7(scratch, ENV_FILE2), Object.entries(env).map(([k, v]) => `${k}=${v.includes("'") ? `"${v}"` : `'${v}'`}
`).join(""));
  io.writeFile(snapshotPath(dir), `${JSON.stringify(record, null, 2)}
`);
  io.print(JSON.stringify(printable(record)));
  return 0;
}
function runDirRefusal(runDir, dkDir, io) {
  const norm = (p) => {
    const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[A-Za-z]:/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
  };
  const realRaw = io.realpath(runDir);
  if (realRaw === null)
    return null;
  const real = norm(realRaw);
  const tmp = io.realpath(io.tmpdir());
  let root = tmp === null ? null : norm(tmp);
  if (root !== null && real === root && /^tmp\.[A-Za-z0-9]{6,}$/.test(real.slice(real.lastIndexOf("/") + 1)))
    root = real.slice(0, real.lastIndexOf("/"));
  const rest = root !== null && real.startsWith(`${root}/`) ? real.slice(root.length + 1) : "";
  if (rest === "" || rest.includes("/"))
    return `${runDir} is not a folder directly under ${tmp ?? "$TMPDIR"}, so it was not removed and nothing else was cleaned. Pass the folder \`mktemp -d\` printed.`;
  const original = originalOf(io.readFile(recordPath(dkDir)));
  for (const other of [dkDir, ...original === null ? [] : [original]]) {
    const o = norm(io.realpath(other) ?? other);
    if (o === real || o.startsWith(`${real}/`) || real.startsWith(`${o}/`))
      return `${runDir} is, holds or sits inside ${other}, so nothing was removed. Pass the folder \`mktemp -d\` printed, not an app folder.`;
  }
  if (io.walk(real, SKIP2).some((f) => f === ".dkod/migration.json" || f.endsWith("/.dkod/migration.json")))
    return `${runDir} holds another migration's .dkod/migration.json, so nothing was removed. Pass the folder \`mktemp -d\` printed for this run.`;
  return null;
}
async function clean(folder, io, args = []) {
  const dir = folder === "" ? io.cwd : folder;
  const runDir = flagValue(args, "--run-dir");
  let runReal = null;
  if (runDir !== undefined) {
    const refusal = runDirRefusal(runDir, dir, io);
    if (refusal !== null) {
      io.print(`dkod-migrate: ${refusal}`);
      return 1;
    }
    runReal = io.realpath(runDir);
  }
  const record = await removeSnapshot(dir, io);
  io.rm(recordPath(dir), { force: true });
  if (runReal !== null)
    io.rm(runReal, { recursive: true, force: true });
  const removed = [record?.scratch, runReal].filter((p) => typeof p === "string" && p !== "");
  io.print(JSON.stringify({ ok: true, mode: "clean", removed, databases: (record?.databases ?? []).flatMap((d) => d.base ? [d.name, d.base.name] : [d.name]) }));
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
    return await sideBySide(folder, reportFile, dkReportFile, io, argv.slice(2));
  if (command === "stop-servers" && folder !== undefined)
    return await stopServersCommand(argv.slice(2), io);
  if (command === "install-restart" && folder !== undefined) {
    const to = join7(folder === "" ? io.cwd : folder, "tests/parity/restart.ts");
    io.writeFile(to, PARITY_RESTART_SOURCE);
    io.print(JSON.stringify({ ok: true, file: to }));
    return 0;
  }
  if (command === "serve-copy" && folder !== undefined)
    return serveCopy(folder, reportFile, io);
  if (command === "freeze" && folder !== undefined)
    return await freeze(folder, reportFile, io);
  if (command === "unfreeze" && folder !== undefined)
    return await unfreeze(folder, io);
  if (command === "check-build" && folder !== undefined)
    return await checkBuild(folder, reportFile, io);
  if (command === "snapshot" && folder !== undefined)
    return await snapshot(folder, io, argv.slice(2));
  if (command === "clean" && folder !== undefined)
    return await clean(folder, io, argv.slice(2));
  if (command === "check-map" && folder !== undefined)
    return await checkMap(folder, io, argv.slice(2));
  io.print(USAGE);
  return 2;
}

var TIMEOUT_MS2 = 5000;
var PAGE_CAP = 300;
var ASSET_CAP = 100;
var BODY_MAX = 2000000;
var HOPS = 3;
var same3 = (a, b) => b !== null && a.status === b.status && a.type === b.type && a.body.trim() === b.body.trim();
var isHtml = (a) => /html/i.test(a.type);
async function discoverRuntime(baseUrl, mapped, codeRoutes, io) {
  const out = { answered: false, pages: [], routes: [], colors: [], fonts: [], buttons: [], tooltips: [] };
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return out;
  }
  const doFetch = io.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const get = async (url) => {
    let cur = url;
    for (let hop = 0;hop <= HOPS; hop++) {
      if (new URL(cur).origin !== origin)
        return null;
      const ctl = new AbortController;
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS2);
      try {
        const res = await doFetch(cur, { redirect: "manual", signal: ctl.signal });
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc !== null) {
          const next = new URL(loc, cur).href;
          if (new URL(next).origin !== origin)
            return { status: res.status, type: "", body: "" };
          cur = next;
          continue;
        }
        return { status: res.status, type: res.headers.get("content-type") ?? "", body: (await res.text()).slice(0, BODY_MAX) };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  };
  const root = await get(`${origin}/`);
  if (root === null)
    return out;
  out.answered = true;
  const fallback = await get(`${origin}/__dkod_probe_${Math.random().toString(36).slice(2, 10)}`);
  const colors = new Set;
  const fonts = new Map;
  const buttons = new Set;
  const tooltips = new Set;
  const assets = [];
  const seenAssets = new Set;
  const readMarkup = (html, base) => {
    for (const c of colorsInCode(html))
      colors.add(c);
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
      for (const c of colorsInCss(m[1]))
        colors.add(c);
    for (const f of fontsIn(html, false))
      fonts.set(f.toLowerCase(), f);
    idsIn(html, buttons, tooltips);
    const refs = [
      ...[...html.matchAll(/<link\b[^>]*>/gi)].filter((m) => /rel\s*=\s*["']?stylesheet/i.test(m[0])).map((m) => /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1]),
      ...[...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    ];
    for (const ref of refs)
      addAsset(ref, base);
  };
  const addAsset = (ref, base) => {
    if (ref === undefined || assets.length >= ASSET_CAP)
      return;
    try {
      const u = new URL(ref, base);
      u.hash = "";
      if (u.origin === origin && !seenAssets.has(u.href)) {
        seenAssets.add(u.href);
        assets.push(u.href);
      }
    } catch {}
  };
  const queue = ["/", ...mapped.filter((p) => !p.includes(":"))];
  const seen = new Set;
  const pages = new Set;
  const routes = new Set;
  let fetched = 0;
  while (queue.length > 0 && fetched < PAGE_CAP) {
    const path = queue.shift();
    if (seen.has(path))
      continue;
    seen.add(path);
    fetched++;
    const ans = path === "/" ? root : await get(origin + path);
    if (ans === null)
      continue;
    if (path !== "/" && !same3(ans, fallback) && (ans.status !== 200 || !isHtml(ans)) && (ans.status >= 200 && ans.status < 300 || ans.status === 401 || ans.status === 403))
      routes.add(normalizeRoute(path));
    if (ans.status !== 200 || !isHtml(ans))
      continue;
    const isFallback = same3(ans, fallback);
    if (!isFallback)
      pages.add(normalizeRoute(path));
    if (!isFallback || path === "/") {
      readMarkup(ans.body, origin + path);
      for (const m of ans.body.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) {
        try {
          const u = new URL(m[1], origin + path);
          if (u.origin === origin && !seen.has(u.pathname) && /^[\w./~%:@!$&'()*+,;=-]*$/.test(u.pathname))
            queue.push(u.pathname);
        } catch {}
      }
    }
  }
  if (fallback !== null && fallback.status === 200 && isHtml(fallback))
    readMarkup(fallback.body, `${origin}/`);
  for (const p of new Set([...mapped, ...codeRoutes])) {
    if (p.includes(":") || p.includes("*"))
      continue;
    const ans = await get(origin + p);
    if (ans === null || same3(ans, fallback))
      continue;
    if (ans.status >= 200 && ans.status < 400 || ans.status === 401 || ans.status === 403)
      routes.add(normalizeRoute(p));
  }
  for (let i = 0;i < assets.length; i++) {
    const url = assets[i];
    const ans = await get(url);
    if (ans === null || ans.status !== 200)
      continue;
    const isCss = /css/i.test(ans.type) || /\.css(?:$|\?)/i.test(url);
    if (isCss) {
      for (const c of colorsInCss(ans.body))
        colors.add(c);
      for (const f of fontsIn(ans.body, true))
        fonts.set(f.toLowerCase(), f);
      for (const m of ans.body.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi))
        addAsset(m[1], url);
    } else {
      for (const c of colorsInCode(ans.body))
        colors.add(c);
      for (const f of fontsIn(ans.body, false))
        fonts.set(f.toLowerCase(), f);
      idsIn(ans.body, buttons, tooltips);
    }
  }
  out.pages = [...pages].sort();
  out.routes = [...routes].sort();
  out.colors = [...colors].sort();
  out.fonts = [...fonts.values()].sort();
  out.buttons = [...buttons].sort();
  out.tooltips = [...tooltips].sort();
  return out;
}

var join8 = (dir, name) => dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
var SKIP3 = ["node_modules", ".git", ".venv", ".next", "dist", "build", "vendor", ".dkod", "__pycache__"];
var ASSET_KINDS = ["css", "font", "icon", "image"];
var TEXT_MAX2 = 200;
var FULL_MAP = {
  max: { summary: 20, routes: 2000, routeRefs: 64, stores: 64, storeEnv: 64, services: 500, serviceSettings: 128, settings: 2000, background: 500, localOnly: 500, flows: 500, flowSteps: 100, pages: 1000, pageStates: 5, pageComponents: 500 },
  maxMapBytes: 16 * 1024 * 1024
};
var QUERY_MAX = 4000;
var LOCAL_KEYS = ["tables", "queries", "functions", "design", "original_cannot_run", "not_mapped"];
var NOT_MAPPED_KINDS = ["route", "page", "table", "column", "setting", "color", "function", "query", "font", "button", "service"];
var isRec7 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
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
  if (!isRec7(json))
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
      if (!isRec7(r))
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
  const max = FULL_MAP.max;
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
        if (!isRec7(c))
          return bad(`${p}.components[${i}]`, "must be an object");
        fields(c, `${p}.components[${i}]`, ["kind", "name"]);
        pick(c.kind, APP_MAP.componentKinds, `${p}.components[${i}].kind`);
        text(c.name, `${p}.components[${i}].name`);
      });
    });
  }
  if ("tables" in json) {
    array(json.tables, "tables", 200).forEach((t, i) => {
      if (!isRec7(t))
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
  if ("original_cannot_run" in json)
    text(json.original_cannot_run, "original_cannot_run");
  if ("not_mapped" in json) {
    items("not_mapped", 2000, (r, p) => {
      fields(r, p, ["kind", "name", "why"]);
      pick(r.kind, NOT_MAPPED_KINDS, `${p}.kind`);
      text(r.name, `${p}.name`);
      text(r.why, `${p}.why`);
    });
  }
  if ("design" in json) {
    const d = json.design;
    if (!isRec7(d))
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
  if (Buffer.byteLength(JSON.stringify(json)) > FULL_MAP.maxMapBytes)
    bad("app-map.json", `must stay under ${FULL_MAP.maxMapBytes} bytes`);
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
var CODE3 = /\.(?:[cm]?[jt]sx?|svelte)$/;
var PY = /\.py$/;
var VUE = /\.vue$/i;
var scriptsOf = (text) => [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(`
`);
var codeOf = (f, text) => VUE.test(f) ? scriptsOf(text) : text;
var IS_TEST = /(?:^|\/)(?:tests?|__tests__|e2e|spec)\/|\.(?:test|spec)\.[a-z]+$|(?:^|\/)test_[^/]*\.py$|_test\.py$/;
var IS_TEST_FILE = /\.(?:test|spec)\.[a-z]+$|(?:^|\/)test_[^/]*\.py$|_test\.py$/;
var ROUTER_FILE = /createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|useRoutes|<Routes|<Route\b|RouteObject|\broutes\s*[:=]/;
var RECEIVER = "(?:app|router|routes?|server|fastify|api|[A-Za-z_$][\\w$]*(?:Router|App|Server|Routes))";
var HTTP = /^\.(?:get|post|put|patch|delete|all)$/;
var BOUND_RECEIVER = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.]+(?:<[^<>=]*>)?\s*)?=\s*(?:express\s*\(|express\.Router\s*\(|Router\s*\()/g;
var SPA_CATCH_ALL = /^\/(?:\*\w*|\(\.\*\)|\{\*\w*\})$/;
function skipArgs(text, from) {
  let depth = 1;
  let i = from;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== `
`)
        i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < text.length && text[i] !== c)
        i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(")
      depth++;
    else if (c === ")")
      depth--;
    i++;
  }
  return i;
}
var HEALTH = "(?:\\/[\\w.-]+)*\\/(?:health|healthz|readyz|ready|readiness|livez|live|ping)";
var HEALTH_OPTION = new RegExp(`\\b(?:[\\w$]*(?:health|probe|readiness|liveness)[\\w$]*|path)["']?\\s*[:=]\\s*(["'\`])(${HEALTH})\\1`, "gi");
var HEALTH_URL = new RegExp(`\\b(?:req|request)\\.url\\s*(?:={2,3}\\s*|\\.startsWith\\(\\s*)(["'\`])(${HEALTH})\\1`, "g");
var toMethod = (m) => {
  const up = m.toUpperCase();
  return up === "GET" || up === "POST" || up === "PUT" || up === "PATCH" || up === "DELETE" ? up : "ANY";
};
function packageDirs(files, needle, io, original) {
  const out = [];
  for (const f of files) {
    if (f !== "package.json" && !f.endsWith("/package.json"))
      continue;
    if (needle.test(io.readFile(join8(original, f)) ?? ""))
      out.push(f.slice(0, f.length - "package.json".length));
  }
  return out;
}
var under = (file, dirs) => dirs.find((d) => file.startsWith(d)) ?? null;
var HANDLER_METHOD = /^(?:GET|POST|PUT|PATCH|DELETE)$/;
function handlerMethods(text) {
  const methods = new Set;
  for (const m of text.matchAll(/\bexport\s+(?:async\s+)?(?:function\s*\*?|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE)\b/g))
    methods.add(m[1]);
  for (const m of text.matchAll(/\bexport\s+(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/[:=]/)[0].trim();
      if (HANDLER_METHOD.test(name))
        methods.add(name);
    }
  }
  for (const m of text.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (HANDLER_METHOD.test(name))
        methods.add(name);
    }
  }
  return methods.size > 0 ? [...methods].sort() : ["ANY"];
}
function fileRoutes(files, io, original) {
  const out = [];
  const add = (path, file, method = "GET") => out.push({ path: normalizeRoute(path), method, file, relative: false });
  const addHandler = (path, file) => {
    for (const method of handlerMethods(io.readFile(join8(original, file)) ?? ""))
      add(path, file, method);
  };
  const next = packageDirs(files, /"next"\s*:/, io, original);
  const remix = packageDirs(files, /"@remix-run\/|"@react-router\/|"react-router"\s*:/, io, original);
  const dropGroups = (segs) => segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  for (const f of files) {
    if (IS_TEST.test(f) && (IS_TEST_FILE.test(f) || /(?:^|\/)(?:tests|__tests__|e2e)\//.test(f)))
      continue;
    let m;
    if ((m = /^((?:.*\/)?)(?:src\/)?app\/(?:(.*)\/)?(page|route)\.(?:[jt]sx?|mdx)$/.exec(f)) !== null && under(f, next) !== null) {
      const path = dropGroups((m[2] ?? "").split("/").filter(Boolean)).join("/");
      if (m[3] === "route")
        addHandler(path, f);
      else
        add(path, f);
    } else if ((m = /^((?:.*\/)?)(?:src\/)?pages\/(.+)\.(?:[jt]sx?|mdx)$/.exec(f)) !== null && under(f, next) !== null) {
      const segs = m[2].split("/");
      if (/^_(?:app|document|error|middleware)$/.test(segs[segs.length - 1]) || segs[0] === "_next")
        continue;
      if (segs[segs.length - 1] === "index")
        segs.pop();
      add(segs.join("/"), f);
    } else if ((m = /(?:^|\/)src\/routes\/(?:(.*)\/)?\+(?:page|server)\.(?:svelte|[jt]s)$/.exec(f)) !== null) {
      const path = dropGroups((m[1] ?? "").split("/").filter(Boolean)).join("/");
      if (f.includes("+server."))
        addHandler(path, f);
      else
        add(path, f);
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
    if (IS_TEST.test(f))
      continue;
    if (/(?:^|\/)netlify\.toml$/.test(f)) {
      const toml = io.readFile(join8(original, f));
      for (const m of (toml ?? "").matchAll(/^\s*from\s*=\s*(["'])(\/[^"']*)\1/gm)) {
        if (!SPA_CATCH_ALL.test(m[2]) && !/\s/.test(m[2]))
          out.push({ path: normalizeRoute(m[2]), method: "ANY", file: f, relative: false });
      }
      continue;
    }
    if (!CODE3.test(f) && !PY.test(f))
      continue;
    const text = io.readFile(join8(original, f));
    if (text === null)
      continue;
    const add = (path, method = "GET") => {
      if (path === "" || path === "*" || SPA_CATCH_ALL.test(path) || path.includes("${") || /^https?:/.test(path) || /\s/.test(path))
        return;
      out.push({ path: normalizeRoute(path), method: toMethod(method), file: f, relative: !path.startsWith("/") });
    };
    for (const m of text.matchAll(HEALTH_OPTION))
      add(m[2]);
    for (const m of text.matchAll(HEALTH_URL))
      add(m[2]);
    if (/\bcreateServer\s*\(|from\s+["'](?:node:)?https?["']|require\(\s*["'](?:node:)?https?["']\s*\)/.test(text)) {
      for (const m of text.matchAll(/\b(?:pathname|path|url)\s*(?:={2,3}\s*|\.startsWith\(\s*)(["'`])(\/[^"'`]*)\1/g))
        add(m[2]);
      if (/switch\s*\(\s*(?:[\w$.]*\.)?(?:pathname|path|url)\s*\)/.test(text)) {
        for (const m of text.matchAll(/\bcase\s+(["'`])(\/[^"'`]*)\1\s*:/g))
          add(m[2]);
      }
    }
    const fn = /(?:^|\/)netlify\/functions\/([^/]+?)(?:\/index)?\.[cm]?[jt]s$/.exec(f);
    if (fn !== null)
      add(`/.netlify/functions/${fn[1]}`, "ANY");
    if (PY.test(f)) {
      for (const m of text.matchAll(/@[A-Za-z_][\w.]*\.(get|post|put|patch|delete|route|api_route|websocket)\(\s*(["'])(\/[^"']*)\2/g))
        add(m[3], m[1]);
      continue;
    }
    if (ROUTER_FILE.test(text)) {
      for (const m of text.matchAll(/<Route\b[^>]*?\bpath=(?:\{\s*)?(["'`])([^"'`]*)\1/g))
        add(m[2]);
      for (const m of text.matchAll(/\bpath:\s*(["'`])([^"'`]*)\1/g))
        add(m[2]);
    }
    const bound = [...text.matchAll(BOUND_RECEIVER)].map((m) => m[1].replace(/\$/g, "\\$"));
    const receiver = bound.length > 0 ? `(?:${RECEIVER}|${bound.join("|")})` : RECEIVER;
    const chain = new RegExp(`(?<![\\w$.])${receiver}\\s*\\.route\\(\\s*(["'\`])(\\/[^"'\`]*)\\1\\s*\\)`, "g");
    for (const m of text.matchAll(chain)) {
      let i = m.index + m[0].length;
      for (;; ) {
        const step = /\s*\.(get|post|put|patch|delete|all)\s*\(/y;
        step.lastIndex = i;
        const next = step.exec(text);
        if (next === null)
          break;
        add(m[2], next[1]);
        i = skipArgs(text, i + next[0].length);
      }
    }
    const call = new RegExp(`\\b${receiver}(\\.(?:get|post|put|patch|delete|all))\\(\\s*(["'\`])(\\/[^"'\`]*)\\2`, "g");
    for (const m of text.matchAll(call))
      if (HTTP.test(m[1]))
        add(m[3], m[1].slice(1));
    for (const m of text.matchAll(/\bfastify\.route\(\s*\{([^}]*?)\burl:\s*(["'`])(\/[^"'`]*)\2([^}]*)\}/g)) {
      const given = /\bmethod:\s*(\[[^\]]*\]|["'`]\w+["'`])/.exec(`${m[1]}${m[4]}`);
      const methods = given === null ? [] : [...given[1].matchAll(/\w+/g)].map((x) => x[0]);
      for (const method of methods.length > 0 ? methods : ["ANY"])
        add(m[3], method);
    }
  }
  return out;
}
function discoverRoutes(original, io) {
  const files = io.walk(original, SKIP3);
  const all = [...fileRoutes(files, io, original), ...sourceRoutes(files, io, original)];
  const seen = new Set;
  return all.filter((r) => {
    const key = `${r.method} ${r.path}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
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
  for (const f of io.walk(original, SKIP3)) {
    if (IS_TEST.test(f))
      continue;
    if (/(?:^|\/)data\/.+\.csv$/i.test(f)) {
      const header = (io.readFile(join8(original, f)) ?? "").split(/\r?\n/, 1)[0] ?? "";
      put((f.split("/").pop() ?? f).replace(/\.csv$/i, ""), header.split(",").map((c) => bare(c.trim())).filter((c) => c !== ""));
      continue;
    }
    if (!/\.sql$/i.test(f) && !CODE3.test(f) && !PY.test(f))
      continue;
    const raw = io.readFile(join8(original, f));
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
var ENV_FILE3 = /^(?:.*\.)?env(?:\..+)?$|\.example$/;
var ENV_SCHEMA = /^env\.[cm]?[jt]s$/;
function discoverSettings(original, io) {
  const names = new Set;
  for (const f of io.walk(original, SKIP3)) {
    const base = f.split("/").pop();
    if (IS_TEST.test(f) && ENV_FILE3.test(base))
      continue;
    if (ENV_FILE3.test(base) && !CODE3.test(base) && !PY.test(base) && !VUE.test(base)) {
      for (const line of (io.readFile(join8(original, f)) ?? "").split(/\r?\n/)) {
        const key = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(line)?.[1];
        if (key !== undefined)
          names.add(key);
      }
      continue;
    }
    if (IS_TEST.test(f) || !CODE3.test(f) && !PY.test(f) && !VUE.test(f))
      continue;
    const raw = io.readFile(join8(original, f));
    if (raw === null)
      continue;
    const text = codeOf(f, raw);
    for (const re of ENV_READS)
      for (const m of text.matchAll(re))
        if (!VITE_BUILTIN.has(m[2] ?? m[1]))
          names.add(m[2] ?? m[1]);
    for (const m of text.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g)) {
      for (const part of m[1].split(",")) {
        const name = part.split(/[:=]/)[0].trim();
        if (/^[A-Za-z_]\w*$/.test(name) && !VITE_BUILTIN.has(name))
          names.add(name);
      }
    }
    if (ENV_SCHEMA.test(base))
      for (const m of text.matchAll(/^\s*["']?([A-Z][A-Z0-9_]*)["']?\s*:/gm))
        names.add(m[1]);
  }
  return [...names].sort();
}
function colorsInCode(raw) {
  const HEX = /(?<=[:(,]\s*)#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|(?<!(?:href|id)\s*=\s*['"`])(?<=['"`])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=['"`])/g;
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w])\/\/.*$/gm, "$1");
  return [...code.matchAll(HEX)].map((c) => `#${(c[1] ?? c[2]).toLowerCase()}`);
}
function colorsInCss(raw) {
  const out = [];
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const d of text.matchAll(/[\w-]+\s*:\s*([^;{}]+)(?=[;}]|$)/g)) {
    for (const c of d[1].replace(/url\([^)]*\)/gi, " ").matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g))
      out.push(`#${c[1].toLowerCase()}`);
  }
  return out;
}
function discoverColors(original, io) {
  const colors = new Set;
  for (const f of io.walk(original, SKIP3)) {
    if (/\.[cm]?[jt]sx?$/.test(f)) {
      if (IS_TEST.test(f))
        continue;
      for (const c of colorsInCode(io.readFile(join8(original, f)) ?? ""))
        colors.add(c);
      continue;
    }
    if (!/\.(?:css|scss|sass|less)$/i.test(f))
      continue;
    for (const c of colorsInCss(io.readFile(join8(original, f)) ?? ""))
      colors.add(c);
  }
  return [...colors].sort();
}
var KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "constructor", "return", "function", "with", "else", "do", "try", "super", "await", "typeof", "new"]);
var MARKUP = /\.(?:html?|vue)$/i;
function discoverFunctions(original, io) {
  const names = new Set;
  for (const f of io.walk(original, SKIP3)) {
    if (IS_TEST.test(f) || !CODE3.test(f) && !PY.test(f) && !VUE.test(f))
      continue;
    const raw = io.readFile(join8(original, f));
    if (raw === null)
      continue;
    const text = codeOf(f, raw);
    const add = (n) => {
      if (n !== undefined && !KEYWORDS.has(n))
        names.add(n);
    };
    if (PY.test(f)) {
      for (const m of text.matchAll(/^[ \t]*(?:async[ \t]+)?def[ \t]+(\w+)/gm))
        add(m[1]);
      continue;
    }
    for (const m of text.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/g))
      add(m[1]);
    for (const m of text.matchAll(/(?<![\w$.=!<>])([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=\n]+)?=>|[A-Za-z_$][\w$]*\s*=>)/g))
      add(m[1]);
    for (const m of text.matchAll(/^[ \t]*(?:(?:public|private|protected|static|async|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*(?::\s*[^{;=\n]+)?\{/gm))
      add(m[1]);
  }
  return [...names].sort();
}
function queryId(q) {
  return `q:${createHash2("sha256").update(normalizeQuery(q)).digest("hex").slice(0, 12)}`;
}
function normalizeQuery(sql) {
  return sql.replace(/\s+/g, " ").trim().replace(/\s*;$/, "");
}
var SQL_START = /^\s*(?:(?:select|insert|update|delete)\s[\s\S]*\b(?:from|into|set)\b|update\s+(?:only\s+)?\S+(?:\s+(?:as\s+)?\w+)?\s+set\s|with\s+(?:recursive\s+)?\w+\s+as\s*\()/i;
var LITERAL = /"""([\s\S]*?)"""|'''([\s\S]*?)'''|`([^`]*)`|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
function discoverQueries(original, io) {
  const out = new Set;
  for (const f of io.walk(original, SKIP3)) {
    if (IS_TEST.test(f) || !CODE3.test(f) && !PY.test(f) && !VUE.test(f) && !/\.(?:html?|sql)$/i.test(f))
      continue;
    const text = io.readFile(join8(original, f));
    if (text === null)
      continue;
    for (const m of text.matchAll(LITERAL)) {
      const body = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
      if (SQL_START.test(body))
        out.add(normalizeQuery(body));
    }
  }
  return [...out].sort();
}
var GENERIC_FONT = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[\w-]+|inherit|initial|unset|revert|-[\w-]+|blinkmacsystemfont)$/i;
function normalizeFontStack(list) {
  return list.replace(/!important/gi, "").split(",").map((p) => p.trim().replace(/^["'`]+|["'`]+$/g, "").trim().toLowerCase()).filter((p) => p !== "").join(",");
}
function fontsIn(text, isStyle, stacks) {
  const out = [];
  const put = (list) => {
    let named = false;
    for (const part of list.replace(/!important/gi, "").split(",")) {
      const name = part.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
      if (name === "" || GENERIC_FONT.test(name) || /var\(|\$\{|[(){}]/.test(name))
        continue;
      out.push(name);
      named = true;
    }
    if (named)
      stacks?.add(list.replace(/!important/gi, "").trim());
  };
  for (const m of text.matchAll(/font-family\s*:\s*([^;{}\n]+)/gi))
    put(m[1].replace(/["'`,)\s]+$/, ""));
  if (!isStyle)
    for (const m of text.matchAll(/\bfontFamily\s*:\s*(["'`])([^"'`]*)\1/g))
      put(m[2]);
  return out;
}
function scanFonts(original, io) {
  const fonts = new Map;
  const stacks = new Set;
  for (const f of io.walk(original, SKIP3)) {
    if (IS_TEST.test(f) || !STYLE.test(f) && !CODE3.test(f) && !MARKUP.test(f))
      continue;
    const text = io.readFile(join8(original, f));
    if (text === null)
      continue;
    for (const name of fontsIn(text, STYLE.test(f), stacks))
      fonts.set(name.toLowerCase(), name);
  }
  return { families: [...fonts.values()].sort(), stacks: [...stacks].sort() };
}
function discoverFonts(original, io) {
  return scanFonts(original, io).families;
}
function discoverFontStacks(original, io) {
  return scanFonts(original, io).stacks;
}
var STYLE = /\.(?:css|scss|sass|less)$/i;
var TAG = /<([A-Za-z][\w.]*)((?:\s[^<>]*?)?)\/?>/g;
var BUTTON_NAME = /(?:^|\s)name\s*=\s*(?:\{\s*)?["'`]([^"'`{}$]+)["'`]/;
var TOOLTIP_ATTR = /\b(data-tooltip-id|data-tip-id|data-tooltip|aria-describedby)\s*=\s*(?:\{\s*)?["'`]([^"'`{}$]+)["'`]/g;
var TOOLTIP_FLAG = /(?:^|\s)(?:title|data-tooltip|data-tip)(?=[\s=/>]|$)/;
var ELEMENT_ID = /\b(?:id|data-testid)\s*[=:]\s*(?:\{\s*)?["'`]([^"'`{}$]+)["'`]/;
function idsIn(text, buttons, tooltips) {
  for (const m of text.matchAll(TAG)) {
    const attrs = m[2];
    const isButton = /^button$/i.test(m[1]) || /\brole\s*=\s*["']button["']/.test(attrs);
    if (isButton) {
      const name = BUTTON_NAME.exec(attrs)?.[1];
      if (name !== undefined)
        buttons.add(name);
    }
    for (const t of attrs.matchAll(TOOLTIP_ATTR)) {
      const ids = t[1] === "aria-describedby" ? t[2].trim().split(/\s+/) : [t[2]];
      for (const id of ids)
        if (id !== "")
          tooltips.add(id);
    }
    const id = ELEMENT_ID.exec(attrs)?.[1];
    if (id === undefined)
      continue;
    if (isButton)
      buttons.add(id);
    else if (m[1] === "Tooltip" || TOOLTIP_FLAG.test(attrs.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "")))
      tooltips.add(id);
    else if (/^tip-/.test(id))
      tooltips.add(id);
  }
}
function discoverButtons(original, io) {
  const buttons = new Set;
  const tooltips = new Set;
  for (const f of io.walk(original, SKIP3)) {
    if (IS_TEST.test(f) || !CODE3.test(f) && !MARKUP.test(f))
      continue;
    const text = io.readFile(join8(original, f));
    if (text === null)
      continue;
    idsIn(text, buttons, tooltips);
  }
  return { buttons: [...buttons].sort(), tooltips: [...tooltips].sort() };
}
var HOST_URL = /https?:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
var HOST_FILE = /\.(?:html?|vue|css|scss|sass|less|sql)$/i;
var SKIP_HOST = /^(?:localhost|127\.|0\.0\.0\.0|(?:www\.)?w3\.org$|(?:www\.)?schema\.org$|json-schema\.org$|xmlns\.com$|example\.(?:com|org|net)$)/i;
var SDKS = [
  [/^stripe$|^@stripe\//, "stripe"],
  [/^@sentry\/|^sentry[-_]sdk$/, "sentry"],
  [/^@aws-sdk\/|^aws-sdk$|^boto3$/, "aws"],
  [/^firebase(?:-admin)?(?:\/|$)|^firebase_admin$/, "firebase"],
  [/^openai$/, "openai"],
  [/^twilio$/, "twilio"],
  [/^@slack\/|^slack_sdk$/, "slack"],
  [/^@anthropic-ai\/sdk$|^anthropic$/, "anthropic"],
  [/^@sendgrid\//, "sendgrid"]
];
var sdkName = (pkg) => SDKS.find(([re]) => re.test(pkg))?.[1] ?? null;
function discoverServices(original, io) {
  const out = new Set;
  for (const f of io.walk(original, SKIP3)) {
    const isPkg = f === "package.json" || f.endsWith("/package.json");
    const py = PY.test(f);
    const plain = HOST_FILE.test(f) || ENV_FILE3.test(f.split("/").pop()) && !CODE3.test(f) && !py;
    if (IS_TEST.test(f) || !isPkg && !plain && !CODE3.test(f) && !py)
      continue;
    const raw = io.readFile(join8(original, f));
    if (raw === null)
      continue;
    if (isPkg) {
      const parsed = readJson(raw);
      const pkg = parsed.ok && isRec7(parsed.value) ? parsed.value : {};
      for (const key of ["dependencies", "devDependencies"]) {
        const deps = pkg[key];
        if (isRec7(deps))
          for (const name of Object.keys(deps)) {
            const c = sdkName(name);
            if (c !== null)
              out.add(c);
          }
      }
      continue;
    }
    if (plain) {
      for (const m of raw.matchAll(HOST_URL))
        if (!SKIP_HOST.test(m[1]))
          out.add(m[1].toLowerCase());
      continue;
    }
    const text = py ? raw.replace(/^[ \t]*#.*$/gm, "") : raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
    for (const m of text.matchAll(HOST_URL))
      if (!SKIP_HOST.test(m[1]))
        out.add(m[1].toLowerCase());
    const mods = py ? [...text.matchAll(/^[ \t]*(?:import|from)[ \t]+([\w]+)/gm)].map((m) => m[1]) : [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)(["'])([^"']+)\1/g)].map((m) => m[2]);
    for (const mod of mods) {
      const c = sdkName(mod);
      if (c !== null)
        out.add(c);
    }
  }
  return [...out].sort();
}
function pageSlug(path) {
  const slug = path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return slug === "" ? "home" : slug;
}
function serverToolDirs(list) {
  const out = [];
  for (const prefix of ["/opt/homebrew/opt", "/usr/local/opt"]) {
    for (const name of list(prefix)) {
      if (/^(?:postgresql|mysql|mariadb|redis|mongodb-community)(?:@.*)?$/.test(name))
        out.push(`${prefix}/${name}/bin`);
    }
  }
  const app = "/Applications/Postgres.app/Contents/Versions";
  for (const name of list(app))
    out.push(`${app}/${name}/bin`);
  return out;
}
function installedServers(map, original, io) {
  const need = new Set;
  for (const s of Array.isArray(map.stores) ? map.stores : []) {
    if (isRec7(s) && typeof s.engine === "string")
      need.add(s.engine.toLowerCase());
  }
  const DEPS = [
    [/^(?:pg|postgres|pg-promise|@neondatabase\/serverless|@vercel\/postgres|psycopg2?(?:-binary)?|asyncpg)$/, "postgres"],
    [/^(?:ioredis|redis|redis-py)$/, "redis"],
    [/^(?:mysql2?|mysqlclient|pymysql)$/, "mysql"],
    [/^(?:mongodb|mongoose|pymongo)$/, "mongodb"]
  ];
  for (const f of io.walk(original, SKIP3)) {
    const base = f.split("/").pop();
    const text = /^package\.json$|^requirements[\w.-]*\.txt$|^pyproject\.toml$/.test(base) ? io.readFile(join8(original, f)) : null;
    if (text === null)
      continue;
    let deps;
    if (base === "package.json") {
      const parsed = readJson(text);
      const pkg = parsed.ok && isRec7(parsed.value) ? parsed.value : {};
      deps = ["dependencies", "devDependencies"].flatMap((k) => isRec7(pkg[k]) ? Object.keys(pkg[k]) : []);
    } else {
      deps = [...text.matchAll(/(?:^|["'\s])([A-Za-z][\w.-]*)(?=\s*(?:[=<>~!\[;"',]|$))/gm)].map((m) => m[1].toLowerCase());
    }
    for (const d of deps)
      for (const [re, engine] of DEPS)
        if (re.test(d))
          need.add(engine);
  }
  const PROGRAMS = [
    ["postgres", ["postgres", "pg_ctl"]],
    ["redis", ["redis-server"]],
    ["mysql", ["mysqld"]],
    ["mongodb", ["mongod"]]
  ];
  const out = [];
  for (const [engine, programs] of PROGRAMS) {
    if (!need.has(engine) && !(engine === "mysql" && need.has("mariadb")))
      continue;
    const found = programs.find((p) => io.hasTool(p));
    if (found !== undefined)
      out.push(found);
  }
  return out;
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
var DEV_OVERLAY_NAME = /nextjs-portal|nextjs-dev-indicator/i;
function recordsDevOverlay(value, top = true) {
  if (typeof value === "string")
    return DEV_OVERLAY_NAME.test(value);
  if (Array.isArray(value))
    return value.some((v) => recordsDevOverlay(v, false));
  if (isRec7(value)) {
    if (top && "dev_overlay" in value) {
      const o = value.dev_overlay;
      if (Array.isArray(o) && o.length > 0 || typeof o === "string" && o !== "" || o === true || isRec7(o) && Object.keys(o).length > 0)
        return true;
    }
    return Object.entries(value).some(([k, v]) => DEV_OVERLAY_NAME.test(k) || recordsDevOverlay(v, false));
  }
  return false;
}
function devOverlayStates(mapDir, io) {
  const out = [];
  for (const rel of io.walk(join8(mapDir, "design"), [])) {
    const m = /^pages[/]([^/]+)[/]([^/]+)[.]json$/.exec(rel);
    if (m === null)
      continue;
    const parsed = readJson(io.readFile(join8(join8(mapDir, "design"), rel)));
    if (parsed.ok && recordsDevOverlay(parsed.value))
      out.push(`${m[1]}/${m[2]}`);
  }
  return out.sort();
}
function frameStates(mapDir, io) {
  const out = [];
  for (const rel of io.walk(join8(mapDir, "design"), [])) {
    const m = /^pages[/]([^/]+)[/]([^/]+)[.]json$/.exec(rel);
    if (m === null)
      continue;
    const parsed = readJson(io.readFile(join8(join8(mapDir, "design"), rel)));
    const frames = parsed.ok && typeof parsed.value === "object" && parsed.value !== null ? parsed.value.frames : undefined;
    if (Array.isArray(frames) && frames.length > 0 && frames.every((f) => typeof f === "string"))
      out.push(`${m[1]}/${m[2]}`);
  }
  return out.sort();
}
var designFramed = (framed) => (title) => {
  const m = /@design\s+(\/\S*)\s+([a-z_]+)/.exec(title);
  return m !== null && framed.has(`${pageSlug(normalizeRoute(m[1]))}/${m[2]}`);
};
async function checkMap(folder, io, args = []) {
  const flag = args.findIndex((a) => a === "--original-url" || a.startsWith("--original-url="));
  const originalUrl = flag < 0 ? "" : args[flag].startsWith("--original-url=") ? args[flag].slice(15) : args[flag + 1] ?? "";
  const dir = folder === "" ? io.cwd : folder;
  const original = originalOf(io.readFile(join8(dir, ".dkod/migration.json")));
  if (original === null) {
    io.print("dkod-migrate: no .dkod/migration.json with an original app in this folder. Do step 1 of the dkod-migrate skill first.");
    return 2;
  }
  const mapDir = join8(dir, ".dkod/map");
  const problems = [];
  const missing = [];
  const noShot = [];
  const counts = { routes: 0, pages: 0, stores: 0, tables: 0, services: 0, settings: 0, queries: 0, functions: 0, design: 0, found_routes: 0, screenshots: 0, assets: 0 };
  const parsed = readJson(io.readFile(join8(mapDir, "app-map.json")));
  const designFiles = new Set(io.walk(join8(mapDir, "design"), []));
  let map = null;
  if (!parsed.ok)
    problems.push(`app-map.json: ${parsed.why}`);
  else {
    problems.push(...validateMap(parsed.value));
    if (isRec7(parsed.value))
      map = parsed.value;
  }
  const list = (key) => map !== null && Array.isArray(map[key]) ? map[key].filter(isRec7) : [];
  const routes = list("routes");
  const pages = list("pages");
  for (const key of ["routes", "pages", "stores", "tables", "services", "settings", "queries", "functions"])
    counts[key] = map !== null && Array.isArray(map[key]) ? map[key].length : 0;
  const design = map !== null && isRec7(map.design) ? map.design : {};
  const designList = (k) => Array.isArray(design[k]) ? design[k].filter((s) => typeof s === "string") : [];
  counts.design = ["colors", "fonts", "buttons", "tooltips"].reduce((n, k) => n + designList(k).length, 0);
  const mapped = [];
  for (const r of routes)
    if (typeof r.path === "string")
      mapped.push({ method: typeof r.method === "string" ? toMethod(r.method) : "ANY", path: normalizeRoute(r.path) });
  for (const r of pages)
    if (typeof r.path === "string")
      mapped.push({ method: "GET", path: normalizeRoute(r.path) });
  const fits = (m, r) => m.method === "ANY" || r.method === "ANY" || m.method === r.method;
  const found = discoverRoutes(original, io);
  counts.found_routes = found.length;
  for (const r of found) {
    const covered = mapped.some((m) => fits(m, r) && (m.path === r.path || r.relative && m.path.endsWith(r.path)));
    if (!covered)
      missing.push(`${r.method} ${r.path}`);
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
  const mappedFunctions = new Set((map !== null && Array.isArray(map.functions) ? map.functions : []).flatMap((f) => typeof f === "string" ? [f, f.split(/[.:]/).pop()] : []));
  const missingFunctions = map === null ? [] : discoverFunctions(original, io).filter((n) => !mappedFunctions.has(n));
  const mappedQueries = new Set((map !== null && Array.isArray(map.queries) ? map.queries : []).flatMap((q) => typeof q === "string" ? [normalizeQuery(q), queryId(q), q.trim()] : []));
  const missingQueries = map === null ? [] : discoverQueries(original, io).filter((q) => !mappedQueries.has(q) && !mappedQueries.has(queryId(q))).map((q) => q.length <= TEXT_MAX2 ? q : queryId(q));
  const mappedFonts = new Set(designList("fonts").map((s) => s.toLowerCase()));
  const coveredFamilies = new Set;
  if (map !== null) {
    const mappedStacks = new Set([...mappedFonts].map(normalizeFontStack));
    for (const stack of discoverFontStacks(original, io)) {
      const families = stack.replace(/!important/gi, "").split(",").map((p) => p.trim().replace(/^["'`]+|["'`]+$/g, "").trim()).filter((n) => n !== "" && !GENERIC_FONT.test(n) && !/var\(|\$\{|[(){}]/.test(n));
      if (mappedStacks.has(normalizeFontStack(stack))) {
        for (const n of families)
          coveredFamilies.add(n.toLowerCase());
      }
    }
  }
  const missingFonts = map === null ? [] : discoverFonts(original, io).filter((s) => !mappedFonts.has(s.toLowerCase()) && !coveredFamilies.has(s.toLowerCase()));
  const mappedButtons = new Set(designList("buttons"));
  const mappedTooltips = new Set(designList("tooltips"));
  const ids = map === null ? { buttons: [], tooltips: [] } : discoverButtons(original, io);
  const missingButtons = [...ids.buttons, ...ids.tooltips].filter((id) => !mappedButtons.has(id) && !mappedTooltips.has(id));
  const mappedServices = list("services").flatMap((s) => typeof s.name === "string" ? [s.name.toLowerCase()] : []);
  const missingServices = map === null ? [] : discoverServices(original, io).filter((h) => !mappedServices.some((n) => n.includes(h)));
  const missingPagesRuntime = [];
  const cannotRun = map !== null && typeof map.original_cannot_run === "string" && map.original_cannot_run.trim() !== "";
  let runtime = "not checked";
  if (originalUrl === "" && flag >= 0)
    problems.push("runtime: --original-url needs a base URL like http://localhost:3000");
  else if (originalUrl !== "") {
    const getPaths = mapped.filter((m) => m.method === "GET" || m.method === "ANY").map((m) => m.path);
    const live = await discoverRuntime(originalUrl, getPaths, found.filter((r) => r.method === "GET" && !r.relative).map((r) => r.path), io);
    if (!live.answered)
      problems.push(`runtime: ${originalUrl} did not answer`);
    else {
      runtime = "checked";
      const have = (path) => mapped.some((m) => m.path === path);
      for (const p of live.pages)
        if (!have(p))
          missingPagesRuntime.push(`GET ${p}`);
      for (const p of live.routes)
        if (!have(p) && !live.pages.includes(p) && !missing.includes(`GET ${p}`))
          missing.push(`GET ${p}`);
      if (map !== null) {
        for (const c of live.colors)
          if (!mappedColors.has(c) && !missingColors.includes(c))
            missingColors.push(c);
        for (const s of live.fonts)
          if (!mappedFonts.has(s.toLowerCase()) && !coveredFamilies.has(s.toLowerCase()) && !missingFonts.some((x) => x.toLowerCase() === s.toLowerCase()))
            missingFonts.push(s);
        for (const id of [...live.buttons, ...live.tooltips])
          if (!mappedButtons.has(id) && !mappedTooltips.has(id) && !missingButtons.includes(id))
            missingButtons.push(id);
      }
    }
  }
  if (cannotRun && originalUrl === "" && map !== null) {
    const servers = installedServers(map, original, io);
    if (servers.length > 0)
      problems.push(`original_cannot_run: ${servers.join(", ")} ${servers.length === 1 ? "is" : "are"} installed on this computer; start ${servers.length === 1 ? "it" : "them"} and run the original, then pass --original-url`);
  }
  if (runtime === "not checked" && originalUrl === "" && flag < 0) {
    io.print("runtime: not checked");
    if (!cannotRun)
      problems.push("runtime: not checked. Run the original and pass --original-url http://localhost:<port>, or set original_cannot_run in the map to the reason it cannot run");
  }
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
  const devOverlayPages = devOverlayStates(mapDir, io);
  for (const s of devOverlayPages)
    problems.push(`design/pages/${s}.json: the capture shows a framework dev overlay (dev_overlay). Run the original's production build and start (Next.js: next build, then next start), never a dev server, and capture ${s} again`);
  const framed = new Set(frameStates(mapDir, io));
  for (const f of io.walk(join8(dir, "tests/parity"), ["node_modules"])) {
    if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f))
      continue;
    problems.push(...designProblems(testBlocks(io.readFile(join8(dir, `tests/parity/${f}`)) ?? ""), designFramed(framed)));
  }
  const byImage = new Map;
  for (const page of pages) {
    if (typeof page.path !== "string")
      continue;
    const rel = `pages/${pageSlug(page.path)}/default.png`;
    if (!designFiles.has(rel))
      continue;
    const sha = io.sha256([join8(join8(mapDir, "design"), rel)]);
    byImage.set(sha, [...byImage.get(sha) ?? [], page.path]);
  }
  const shotPages = [...byImage.values()].reduce((n, g) => n + g.length, 0);
  const placeholders = [...byImage.values()].filter((g) => g.length >= 3 || g.length === shotPages && shotPages >= 2).flat();
  const assets = readJson(io.readFile(join8(mapDir, "assets/assets.json")));
  if (!assets.ok)
    problems.push(`assets/assets.json: ${assets.why}`);
  else if (!Array.isArray(assets.value))
    problems.push("assets/assets.json: must be a list of {kind, path}");
  else {
    const originalFiles = new Set(io.walk(original, SKIP3));
    counts.assets = assets.value.length;
    assets.value.forEach((a, i) => {
      if (!isRec7(a))
        return problems.push(`assets[${i}]: must be an object {kind, path}`);
      if (typeof a.kind !== "string" || !ASSET_KINDS.includes(a.kind))
        problems.push(`assets[${i}].kind: must be one of ${ASSET_KINDS.join(", ")}`);
      if (typeof a.path !== "string" || !safeFile(a.path))
        problems.push(`assets[${i}].path: must be a path inside the original, with no '..'`);
      else if (!originalFiles.has(a.path))
        problems.push(`assets[${i}].path: ${a.path} is not a file in the original`);
    });
  }
  const lists = {
    route: missing,
    page: missingPagesRuntime,
    table: missingTables,
    column: missingColumns,
    setting: missingSettings,
    color: missingColors,
    function: missingFunctions,
    query: missingQueries,
    font: missingFonts,
    button: missingButtons,
    service: missingServices
  };
  const justified = Object.fromEntries(NOT_MAPPED_KINDS.map((k) => [k, 0]));
  const missingCount = {};
  const entries = map !== null && Array.isArray(map.not_mapped) ? map.not_mapped : [];
  const same = (kind, a, b) => kind === "query" ? a.trim() === b || normalizeQuery(a) === b || queryId(a) === b : kind === "color" || kind === "service" ? a.toLowerCase() === b.toLowerCase() : a.trim() === b;
  entries.forEach((e, i) => {
    if (!isRec7(e) || typeof e.kind !== "string" || typeof e.name !== "string" || typeof e.why !== "string" || e.why.trim() === "")
      return;
    const list = lists[e.kind];
    if (list === undefined)
      return;
    const kind = e.kind;
    const name = e.name;
    const at = list.findIndex((item) => same(kind, name, item));
    if (at < 0) {
      problems.push(`not_mapped[${i}]: ${kind} ${name.slice(0, 80)} is not something check-map found missing, remove the entry`);
      return;
    }
    list.splice(at, 1);
    justified[kind] = (justified[kind] ?? 0) + 1;
  });
  for (const k of NOT_MAPPED_KINDS)
    missingCount[k] = lists[k].length;
  missingCount.total = NOT_MAPPED_KINDS.reduce((n, k) => n + lists[k].length, 0);
  const report = {
    ok: problems.length === 0 && devOverlayPages.length === 0 && placeholders.length === 0 && runtime === (cannotRun && originalUrl === "" ? "not checked" : "checked") && missingPagesRuntime.length === 0 && missing.length === 0 && noShot.length === 0 && missingTables.length === 0 && missingColumns.length === 0 && missingSettings.length === 0 && missingColors.length === 0 && missingFunctions.length === 0 && missingQueries.length === 0 && missingFonts.length === 0 && missingButtons.length === 0 && missingServices.length === 0,
    counts,
    missing_routes: missing,
    missing_pages_runtime: missingPagesRuntime,
    runtime,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    missing_settings: missingSettings,
    missing_colors: missingColors,
    missing_functions: missingFunctions,
    missing_queries: missingQueries,
    missing_fonts: missingFonts,
    missing_buttons: missingButtons,
    missing_services: missingServices,
    justified,
    missing_count: { total: missingCount.total, ...Object.fromEntries(NOT_MAPPED_KINDS.map((k) => [k, missingCount[k]])) },
    pages_without_screenshot: noShot,
    placeholder_screenshots: placeholders,
    dev_overlay_pages: devOverlayPages,
    problems
  };
  io.print(JSON.stringify(report));
  return report.ok ? 0 : 1;
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
      const full = join9(at, name);
      const next = rel === "" ? name : `${rel}/${name}`;
      let dirEntry;
      try {
        dirEntry = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (dirEntry)
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
    const hash = createHash3("sha256");
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
  realpath: (path) => {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  },
  hasTool: (program) => [
    ...(process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":"),
    ...serverToolDirs((dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    })
  ].some((dir) => dir !== "" && existsSync(join9(dir, program))),
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
