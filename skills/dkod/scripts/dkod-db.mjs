// Built by packages/dkoder-plugin/scripts/build-db.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:db`.
import { createHash as createHash5, randomUUID } from "node:crypto";
import { spawn as spawn2 } from "node:child_process";
import { chmodSync, closeSync as closeSync2, existsSync, mkdirSync, openSync as openSync2, readdirSync as readdirSync2, readFileSync as readFileSync2, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join5, resolve } from "node:path";

import { createHash as createHash4, randomBytes as randomBytes2 } from "node:crypto";
import net2 from "node:net";
import { resolve as resolvePath } from "node:path";

import { join } from "node:path";
var SKIP = new Set(["node_modules", ".git", ".venv", "venv", "dist", "build", ".next", ".turbo", ".dkod", "coverage", "test-results", "playwright-report", "__pycache__", ".cache"]);
var MAX_DEPTH = 3;
var MAX_FILES = 5000;
var ENV_FILE = /^\.env(\..+)?$/;
var COMPOSE_FILE = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
var SQLITE_FILE = /\.(sqlite3?|db)$/i;
var CONFIG_FILES = [
  [/^schema\.prisma$/, "prisma"],
  [/^drizzle\.config\.(ts|js|mjs|cjs|json)$/, "drizzle"],
  [/^alembic\.ini$/, "alembic"],
  [/^knexfile\.(ts|js|mjs|cjs)$/, "knex"],
  [/^ormconfig\.(ts|js|json|ya?ml)$/, "typeorm"],
  [/^\.sequelizerc$/, "sequelize"],
  [/^manage\.py$/, "django"]
];
var JS_DRIVERS = ["pg", "postgres", "@neondatabase/serverless", "@vercel/postgres", "mysql", "mysql2", "better-sqlite3", "sqlite3", "@libsql/client", "@prisma/client", "prisma", "drizzle-orm", "knex", "sequelize", "typeorm", "kysely", "mongoose", "mongodb"];
var PY_DRIVERS = ["psycopg", "psycopg2", "psycopg2-binary", "asyncpg", "sqlalchemy", "sqlmodel", "alembic", "pymysql", "mysqlclient", "aiosqlite", "django", "pymongo", "tortoise-orm", "peewee"];
function kindOfUrl(value) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(value.trim());
  if (m === null)
    return null;
  const scheme = m[1].toLowerCase();
  if (scheme.startsWith("postgres"))
    return "postgres";
  if (scheme.startsWith("mysql") || scheme.startsWith("mariadb"))
    return "mysql";
  if (scheme.startsWith("sqlite") || scheme === "file" || scheme === "libsql")
    return "sqlite";
  if (scheme.startsWith("mongodb"))
    return "mongodb";
  return null;
}
function isLocal(value, kind) {
  if (kind === "sqlite")
    return true;
  try {
    const host = new URL(value.trim()).hostname.replace(/^\[|\]$/g, "");
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "postgres", "mysql", "database"].includes(host) || host === "";
  } catch {
    return false;
  }
}
function kindOfImage(image) {
  const name = image.toLowerCase().split("@")[0].split(":")[0].split("/").pop() ?? "";
  if (/postgres|postgis|timescale|pgvector/.test(name))
    return "postgres";
  if (/mysql|mariadb/.test(name))
    return "mysql";
  if (/mongo/.test(name))
    return "mongodb";
  return null;
}
function composeServices(text) {
  const out = [];
  let inServices = false;
  let current = null;
  for (const line of text.split(`
`)) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (/^\S/.test(line)) {
      inServices = false;
      current = null;
      continue;
    }
    if (!inServices)
      continue;
    const svc = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line) ?? /^\t([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (svc !== null) {
      current = svc[1];
      continue;
    }
    const img = /^\s+image:\s*["']?([^"'\s#]+)/.exec(line);
    if (img !== null && current !== null) {
      const kind = kindOfImage(img[1]);
      if (kind !== null && !out.some((o) => o.service === current))
        out.push({ service: current, kind });
    }
  }
  return out;
}
function envKeys(text) {
  const out = [];
  for (const line of text.split(`
`)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m === null)
      continue;
    const value = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    const kind = kindOfUrl(value);
    if (kind !== null && (kind !== "sqlite" || /DATABASE|DB|SQLITE/i.test(m[1])))
      out.push({ key: m[1], kind, local: isLocal(value, kind) });
    else if (value === "" && /^(DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|DB_URL|MYSQL_URL|SQLITE_PATH|MONGODB_URI)$/.test(m[1]))
      out.push({ key: m[1], kind: "unknown", local: false });
  }
  return out;
}
function jsDrivers(text) {
  try {
    const pkg = JSON.parse(text);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return JS_DRIVERS.filter((d) => (d in deps));
  } catch {
    return [];
  }
}
function pyDrivers(text) {
  const lower = text.toLowerCase();
  return PY_DRIVERS.filter((d) => new RegExp(`(^|[\\s"'\\[,])${d.replace(/[-]/g, "[-_]")}([\\s"'<>=~!;,\\[\\]]|$)`, "m").test(lower));
}
function kindOfDriver(d) {
  if (["pg", "postgres", "@neondatabase/serverless", "@vercel/postgres", "psycopg", "psycopg2", "psycopg2-binary", "asyncpg"].includes(d))
    return "postgres";
  if (["mysql", "mysql2", "pymysql", "mysqlclient"].includes(d))
    return "mysql";
  if (["better-sqlite3", "sqlite3", "@libsql/client", "aiosqlite"].includes(d))
    return "sqlite";
  if (["mongoose", "mongodb", "pymongo"].includes(d))
    return "mongodb";
  return null;
}
function detectDatabase(root, io) {
  const env = [];
  const compose = [];
  const configs = new Set;
  const drivers = new Set;
  const sqlite = [];
  const kinds = new Set;
  let seen = 0;
  const walk = (rel, depth) => {
    for (const entry of io.listDir(rel === "" ? root : join(root, rel))) {
      if (++seen > MAX_FILES)
        return;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.dir) {
        if (depth < MAX_DEPTH && !SKIP.has(entry.name))
          walk(path, depth + 1);
        continue;
      }
      const name = entry.name;
      if (ENV_FILE.test(name)) {
        for (const k of envKeys(io.readFile(join(root, path)) ?? "")) {
          env.push({ file: path, ...k });
          if (k.kind !== "unknown")
            kinds.add(k.kind);
        }
      } else if (COMPOSE_FILE.test(name)) {
        for (const s of composeServices(io.readFile(join(root, path)) ?? "")) {
          compose.push({ file: path, ...s });
          kinds.add(s.kind);
        }
      } else if (name === "package.json") {
        for (const d of jsDrivers(io.readFile(join(root, path)) ?? ""))
          drivers.add(d);
      } else if (name === "requirements.txt" || name === "pyproject.toml" || name === "Pipfile") {
        for (const d of pyDrivers(io.readFile(join(root, path)) ?? ""))
          drivers.add(d);
      } else if (SQLITE_FILE.test(name)) {
        sqlite.push(path);
        kinds.add("sqlite");
      }
      for (const [re, label] of CONFIG_FILES)
        if (re.test(name))
          configs.add(label);
    }
  };
  walk("", 0);
  for (const d of drivers) {
    const k = kindOfDriver(d);
    if (k !== null)
      kinds.add(k);
  }
  const uses = env.length > 0 || compose.length > 0 || configs.size > 0 || drivers.size > 0 || sqlite.length > 0;
  const next = uses ? "The app keeps data. Give it its Dev database before you run or test it here: dkoder.devdb.status, dkoder.devdb.make with confirm: true when it says missing, then dkod-db.mjs up and migrate. Never start a local database for it, also when the app does not run here without one." : "Nothing says the app keeps data. Ask the person whether it does; when it does not, deploy with no_database: true.";
  return {
    ok: true,
    uses_database: uses,
    kinds: [...kinds].sort(),
    env,
    compose,
    configs: [...configs].sort(),
    drivers: [...drivers].sort(),
    sqlite_files: sqlite.sort(),
    next
  };
}

import { createHash } from "node:crypto";
function sealOf(r, nonce) {
  const body = { mode: r.mode, scratch: r.scratch, files: r.files, databases: (r.databases ?? []).map((d) => ({ name: d.name, url: d.url, tables: d.tables ?? null, ...d.source === undefined ? {} : { source: d.source } })), env: r.env, message: r.message ?? null, ...r.bases === undefined ? {} : { bases: r.bases }, ...r.source === undefined ? {} : { source: r.source }, ...r.checks === undefined ? {} : { checks: r.checks }, ...r.needs_database === undefined ? {} : { needs_database: r.needs_database } };
  return createHash("sha256").update(JSON.stringify(body)).update(nonce).digest("hex");
}

import { isAbsolute, join as join2 } from "node:path";
var q = (name) => `"${name.replace(/"/g, '""')}"`;
var NO_SQLITE_READER = "neither the sqlite3 binary nor Node's built-in node:sqlite (Node 22.13 or later) is here. Upgrade Node to 22.13 or later, or install sqlite3 (macOS: `brew install sqlite`, Debian/Ubuntu: `sudo apt-get install -y sqlite3`, Windows: `winget install SQLite.SQLite`)";
async function nodeQuery(base, sql, cwd, load = () => import("node:sqlite")) {
  let mod;
  try {
    mod = await load();
  } catch {
    return { ok: false, missing: true, reason: NO_SQLITE_READER };
  }
  if (typeof mod?.DatabaseSync !== "function")
    return { ok: false, missing: true, reason: NO_SQLITE_READER };
  let db;
  try {
    db = new mod.DatabaseSync(isAbsolute(base) ? base : join2(cwd, base), { readOnly: true });
    const rows = db.prepare(sql).all().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? null : String(v)])));
    return { ok: true, value: rows };
  } catch {
    return { ok: false, missing: false, reason: "node:sqlite could not read the base copy" };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
async function query(run, env, base, sql, cwd) {
  const res = await run("sqlite3", ["-readonly", "-json", base, sql], env, cwd);
  if (res.status === 127)
    return await nodeQuery(base, sql, cwd);
  if (res.status !== 0)
    return { ok: false, missing: false, reason: "sqlite3 could not read the base copy" };
  const text = res.stdout.trim();
  if (text === "")
    return { ok: true, value: [] };
  try {
    const rows = JSON.parse(text);
    if (Array.isArray(rows))
      return { ok: true, value: rows };
  } catch {}
  return { ok: false, missing: false, reason: "sqlite3 answered something that is not JSON" };
}
async function sqliteSchema(run, env, base, cwd) {
  const cols = await query(run, env, base, "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND p.hidden=0 ORDER BY m.name, p.cid", cwd);
  if (!cols.ok)
    return cols;
  const fks = await query(run, env, base, `SELECT m.name AS child, f."table" AS parent FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type='table'`, cwd);
  if (!fks.ok)
    return fks;
  const columns = new Map;
  for (const r of cols.value)
    if (r.t && r.c)
      columns.set(r.t, [...columns.get(r.t) ?? [], r.c]);
  return { ok: true, value: { columns, edges: fks.value.filter((r) => r.child && r.parent).map((r) => ({ child: r.child, parent: r.parent })) } };
}
async function sqliteRows(run, env, base, table, cols, cwd) {
  const exprs = cols.map((c, i) => `CASE typeof(${q(c)}) WHEN 'null' THEN NULL WHEN 'blob' THEN '\\x' || hex(${q(c)}) ELSE CAST(${q(c)} AS TEXT) END AS ${q(`c${i}`)}`);
  const res = await query(run, env, base, `SELECT ${exprs.join(", ")} FROM ${q(table)}`, cwd);
  if (!res.ok)
    return res;
  return { ok: true, value: res.value.map((r) => cols.map((_, i) => r[`c${i}`] ?? null)) };
}
function copyText(rows) {
  const esc = (v) => v === null ? "\\N" : v.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return rows.map((r) => `${r.map(esc).join("\t")}
`).join("");
}
function castExpr(col, dataType, udt) {
  const c = q(col);
  const epoch = `to_timestamp(${c}::bigint / (CASE WHEN abs(${c}::bigint) >= 100000000000 THEN 1000.0 ELSE 1.0 END))`;
  const isEpoch = `${c} ~ '^-?[0-9]+$'`;
  switch (dataType) {
    case "boolean":
      return `(CASE ${c} WHEN '0' THEN 'f' WHEN '1' THEN 't' ELSE ${c} END)::boolean`;
    case "timestamp with time zone":
      return `(CASE WHEN ${isEpoch} THEN ${epoch} ELSE ${c}::timestamptz END)`;
    case "timestamp without time zone":
      return `(CASE WHEN ${isEpoch} THEN ${epoch} AT TIME ZONE 'UTC' ELSE ${c}::timestamp END)`;
    case "date":
      return `(CASE WHEN ${isEpoch} THEN (${epoch} AT TIME ZONE 'UTC')::date ELSE ${c}::date END)`;
    case "bytea":
      return `${c}::bytea`;
    default:
      return `${c}::${q(udt)}`;
  }
}
function readSqliteMapTables(text) {
  let map = null;
  try {
    map = JSON.parse(text ?? "null");
  } catch {
    return [];
  }
  const m = map;
  if (!m || !Array.isArray(m.tables))
    return [];
  const skip = new Set;
  for (const s of Array.isArray(m.stores) ? m.stores : []) {
    if (typeof s.name === "string" && typeof s.engine === "string" && !/sqlite/i.test(s.engine))
      skip.add(s.name);
  }
  const out = [];
  for (const t of m.tables) {
    if (typeof t.name !== "string" || out.some((o) => o.name === t.name))
      continue;
    const store = typeof t.store === "string" ? t.store : null;
    if (store !== null && skip.has(store))
      continue;
    out.push({ name: t.name, store });
  }
  return out;
}

function parseCsv(text) {
  const src = text.charCodeAt(0) === 65279 ? text.slice(1) : text;
  const records = [];
  const nulls = [];
  let row = [];
  let isNull = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  const endField = () => {
    row.push(field);
    isNull.push(field === "" && !quoted);
    field = "";
    quoted = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "" && !quoted)) {
      records.push(row);
      nulls.push(isNull);
    }
    row = [];
    isNull = [];
  };
  for (let i = 0;i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else
          inQuotes = false;
      } else
        field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      quoted = true;
    } else if (ch === ",")
      endField();
    else if (ch === "\r") {
      if (src[i + 1] === `
`)
        i++;
      endRow();
    } else if (ch === `
`)
      endRow();
    else
      field += ch;
  }
  if (inQuotes)
    return { ok: false, reason: "a quoted field is never closed" };
  if (field !== "" || row.length > 0 || quoted)
    endRow();
  if (records.length === 0)
    return { ok: false, reason: "the file has no header row" };
  const cols = records[0].map((c) => c.trim());
  if (cols.some((c) => c === "") || new Set(cols).size !== cols.length)
    return { ok: false, reason: "the header row has an empty or repeated column name" };
  const rows = [];
  for (let r = 1;r < records.length; r++) {
    if (records[r].length !== cols.length)
      return { ok: false, reason: `row ${r + 1} has ${records[r].length} fields, the header has ${cols.length}` };
    rows.push(records[r].map((v, c) => nulls[r][c] ? null : v));
  }
  return { ok: true, cols, rows };
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
function parseFlat(kind, text) {
  return kind === "csv" ? parseCsv(text) : parseJsonRows(text);
}
function readFlatMapTables(text) {
  let map = null;
  try {
    map = JSON.parse(text ?? "null");
  } catch {
    return [];
  }
  const m = map;
  if (!m || !Array.isArray(m.tables))
    return [];
  const skip = new Set;
  for (const s of Array.isArray(m.stores) ? m.stores : []) {
    if (typeof s.name === "string" && typeof s.engine === "string" && !/csv|json|file|flat/i.test(s.engine))
      skip.add(s.name);
  }
  const out = [];
  for (const t of m.tables) {
    if (typeof t.name !== "string" || out.some((o) => o.name === t.name))
      continue;
    const store = typeof t.store === "string" ? t.store : null;
    if (store !== null && skip.has(store))
      continue;
    out.push({ name: t.name, store });
  }
  return out;
}

import { createHash as createHash2, randomBytes } from "node:crypto";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
var MAX_MESSAGE_BYTES = 16 << 20;
var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var MAX_HANDSHAKE_BYTES = 16 << 10;
function gatewayUrlProblem(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "The gateway address is not a valid URL.";
  }
  if (url.protocol === "wss:")
    return null;
  if (url.protocol === "ws:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))
    return null;
  return "The gateway address must start with wss://.";
}
var LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function proxyFor(host, env = process.env) {
  const raw = (env.HTTPS_PROXY ?? env.https_proxy ?? "").trim();
  const name = host.toLowerCase();
  if (!raw || LOOPBACK.has(name))
    return null;
  for (const entry of (env.NO_PROXY ?? env.no_proxy ?? "").split(",")) {
    const e = entry.trim().toLowerCase().replace(/^([^:]+):\d+$/, "$1");
    if (e === "*")
      return null;
    const bare = e.replace(/^\*?\./, "");
    if (bare && (name === bare || name.endsWith(`.${bare}`)))
      return null;
  }
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  return url.protocol === "http:" ? url : null;
}
function openTunnel(proxy, host, port, onReady, onFail) {
  const raw = net.connect({ host: proxy.hostname.replace(/^\[|\]$/g, ""), port: proxy.port ? Number(proxy.port) : 80 });
  const target = `${host}:${port}`;
  const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r
` : "";
  let head = Buffer.alloc(0);
  let done = false;
  const settle = (reason) => {
    if (done)
      return;
    done = true;
    raw.off("data", onData);
    raw.off("error", onError);
    raw.off("close", onClose);
    if (reason === null) {
      onReady(raw);
      return;
    }
    raw.destroy();
    onFail(reason);
  };
  const onData = (chunk) => {
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf(`\r
\r
`);
    if (end < 0) {
      if (head.length > MAX_HANDSHAKE_BYTES)
        settle("bad proxy answer");
      return;
    }
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.subarray(0, end).toString("latin1"))?.[1] ?? 0);
    settle(status !== 200 ? `proxy refused the tunnel (${status || "no status"})` : end + 4 < head.length ? "bad proxy answer" : null);
  };
  const onError = (error) => settle(`proxy ${error.code ?? "socket_error"}`);
  const onClose = () => settle("proxy closed the connection");
  raw.on("data", onData);
  raw.on("error", onError);
  raw.on("close", onClose);
  raw.once("connect", () => raw.write(`CONNECT ${target} HTTP/1.1\r
Host: ${target}\r
${auth}\r
`));
  return raw;
}
function dashboardFetch(url, init, direct, env = process.env) {
  const target = new URL(url);
  const proxy = target.protocol === "https:" && env.NODE_USE_ENV_PROXY !== "1" ? proxyFor(target.hostname, env) : null;
  if (!proxy)
    return direct(url, init);
  const host = target.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const createConnection = (_, done) => {
      openTunnel(proxy, host, Number(target.port || 443), (raw) => done(null, tls.connect({ socket: raw, servername: host, rejectUnauthorized: true })), (reason) => done(Object.assign(new Error(reason), { code: "PROXY_TUNNEL" })));
      return;
    };
    const req = https.request(target, { method: init.method, headers: { ...init.headers, "content-length": String(Buffer.byteLength(init.body)) }, createConnection }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: async () => Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(init.body);
  });
}
function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 128 | opcode;
  if (len < 126)
    head[1] = 128 | len;
  else if (len < 65536) {
    head[1] = 128 | 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 128 | 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = randomBytes(4);
  const body = Buffer.alloc(len);
  for (let i = 0;i < len; i++)
    body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}
function connectWebSocket(rawUrl, headers, handlers) {
  const url = new URL(rawUrl);
  const secure = url.protocol === "wss:";
  const port = url.port ? Number(url.port) : secure ? 443 : 80;
  const host = url.hostname;
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash2("sha1").update(key + GUID).digest("base64");
  let opened = false;
  let closed = false;
  let sentClose = false;
  let head = Buffer.alloc(0);
  let buf = Buffer.alloc(0);
  let fragments = [];
  let fragmentBytes = 0;
  let fragmentOpcode = 0;
  let needDrain = false;
  let socket;
  let tunnel;
  const finish = (code, reason) => {
    if (closed)
      return;
    closed = true;
    handlers.onClose?.(code, reason);
  };
  const write = (data) => {
    if (!socket || socket.destroyed || !socket.writable)
      return true;
    const ok = socket.write(data);
    if (!ok)
      needDrain = true;
    return ok;
  };
  const fail = (code, reason) => {
    if (!sentClose && opened) {
      sentClose = true;
      write(frame(8, closeBody(code, reason)));
    }
    socket?.destroy();
    finish(code, reason);
  };
  const closeBody = (code, reason) => {
    const r = Buffer.from(reason);
    const out = Buffer.alloc(2 + r.length);
    out.writeUInt16BE(code, 0);
    r.copy(out, 2);
    return out;
  };
  const sendRequest = () => {
    const path = `${url.pathname}${url.search}` || "/";
    const lines = [
      `GET ${path} HTTP/1.1`,
      `Host: ${url.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      "",
      ""
    ];
    socket?.write(lines.join(`\r
`));
  };
  const handleFrames = () => {
    for (;; ) {
      if (buf.length < 2)
        return;
      const fin = (buf[0] & 128) !== 0;
      const opcode = buf[0] & 15;
      const masked = (buf[1] & 128) !== 0;
      let len = buf[1] & 127;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4)
          return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10)
          return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES))
          return fail(1009, "message too big");
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_MESSAGE_BYTES)
        return fail(1009, "message too big");
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len)
        return;
      const mask = masked ? buf.subarray(offset, offset + 4) : null;
      let payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
      if (mask)
        for (let i = 0;i < payload.length; i++)
          payload[i] = payload[i] ^ mask[i & 3];
      buf = buf.subarray(offset + maskLen + len);
      if (opcode >= 8) {
        if (!fin || len > 125)
          return fail(1002, "bad control frame");
        if (opcode === 9)
          write(frame(10, payload));
        else if (opcode === 8) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
          const reason = payload.length > 2 ? payload.subarray(2).toString() : "";
          if (!sentClose) {
            sentClose = true;
            write(frame(8, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0)));
          }
          socket?.end();
          finish(code, reason);
          return;
        }
        continue;
      }
      if (opcode === 1 || opcode === 2) {
        if (fragments.length > 0)
          return fail(1002, "bad fragment");
        fragmentOpcode = opcode;
      } else if (opcode === 0) {
        if (fragments.length === 0)
          return fail(1002, "bad fragment");
      } else {
        return fail(1002, "bad opcode");
      }
      fragmentBytes += payload.length;
      if (fragmentBytes > MAX_MESSAGE_BYTES)
        return fail(1009, "message too big");
      fragments.push(payload);
      if (!fin)
        continue;
      payload = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
      fragments = [];
      fragmentBytes = 0;
      if (fragmentOpcode === 1)
        handlers.onText?.(payload.toString("utf8"));
      else
        handlers.onBinary?.(payload);
      if (closed)
        return;
    }
  };
  const wire = (s) => {
    socket = s;
    s.once(secure ? "secureConnect" : "connect", sendRequest);
    s.on("data", (chunk) => {
      if (opened) {
        buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
        handleFrames();
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf(`\r
\r
`);
      if (end < 0) {
        if (head.length > MAX_HANDSHAKE_BYTES) {
          s.destroy();
          finish(1006, "bad handshake");
        }
        return;
      }
      const text = head.subarray(0, end).toString("latin1");
      const rest = head.subarray(end + 4);
      const [statusLine, ...headerLines] = text.split(`\r
`);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(statusLine ?? "")?.[1] ?? 0);
      const got = new Map(headerLines.map((l) => {
        const i = l.indexOf(":");
        return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
      }));
      if (status !== 101) {
        const want = Math.min(Number(got.get("content-length") ?? 0) || 0, 8192);
        const deliver = (body) => {
          let reason = "";
          try {
            const parsed = JSON.parse(body.toString("utf8"));
            if (typeof parsed.error === "string")
              reason = parsed.error;
          } catch {}
          s.removeAllListeners("data");
          s.destroy();
          closed = true;
          handlers.onRefused?.(status, reason);
        };
        if (rest.length >= want) {
          deliver(rest);
          return;
        }
        let body = rest;
        s.removeAllListeners("data");
        s.on("data", (more) => {
          body = Buffer.concat([body, more]);
          if (body.length >= want)
            deliver(body);
        });
        return;
      }
      if (got.get("upgrade")?.toLowerCase() !== "websocket" || got.get("sec-websocket-accept") !== expectedAccept) {
        s.destroy();
        finish(1006, "bad handshake");
        return;
      }
      opened = true;
      head = Buffer.alloc(0);
      handlers.onOpen?.();
      if (rest.length > 0) {
        buf = Buffer.from(rest);
        handleFrames();
      }
    });
    s.on("drain", () => {
      if (needDrain) {
        needDrain = false;
        handlers.onDrain?.();
      }
    });
    s.on("error", (error) => finish(1006, error.code ?? "socket_error"));
    s.on("close", () => finish(1006, "connection closed"));
  };
  const proxy = secure ? proxyFor(host) : null;
  if (proxy) {
    tunnel = openTunnel(proxy, host, port, (raw) => {
      tunnel = undefined;
      if (closed) {
        raw.destroy();
        return;
      }
      wire(tls.connect({ socket: raw, servername: host, rejectUnauthorized: true }));
    }, (reason) => finish(1006, reason));
  } else {
    wire(secure ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }) : net.connect({ host, port }));
  }
  return {
    sendBinary: (data) => write(frame(2, data)),
    sendText: (text) => write(frame(1, Buffer.from(text))),
    close(code = 1000, reason = "") {
      if (closed || sentClose)
        return;
      if (!opened) {
        tunnel?.destroy();
        socket?.destroy();
        finish(code, reason);
        return;
      }
      sentClose = true;
      write(frame(8, closeBody(code, reason)));
      setTimeout(() => socket?.destroy(), 1000).unref();
    },
    pause: () => {
      socket?.pause();
    },
    resume: () => {
      socket?.resume();
    }
  };
}

import { createHash as createHash3 } from "node:crypto";
import http from "node:http";
import { closeSync, createReadStream, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join as join3, relative, sep } from "node:path";
import { Readable } from "node:stream";
var MAX_FILE_BYTES = 5 * 1024 ** 3;
var HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "authorization", "content-length"]);
var filesBaseOf = (gateway) => gateway.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
function startFilesProxy(opts) {
  const doFetch = opts.fetch ?? fetch;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const target = `${opts.base}/v1/files/${opts.app}${url.pathname}${url.search}`;
      const headers = { authorization: `Bearer ${opts.token()}` };
      if (opts.requestId)
        headers["x-request-id"] = opts.requestId();
      for (const [k, v] of Object.entries(req.headers))
        if (!HOP.has(k) && typeof v === "string")
          headers[k] = v;
      let body;
      if (req.method === "PUT") {
        const length = Number(req.headers["content-length"] ?? Number.NaN);
        if (!Number.isInteger(length) || length < 0) {
          res.writeHead(411, { "content-type": "application/json" }).end(JSON.stringify({ error: "length_required" }));
          return;
        }
        if (length > MAX_FILE_BYTES) {
          res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({ error: "too_large" }));
          req.resume();
          return;
        }
        headers["content-length"] = String(length);
        body = Readable.toWeb(req);
      }
      const upstream = await doFetch(target, { method: req.method ?? "GET", headers, ...body === undefined ? {} : { body, duplex: "half" } });
      const out = {};
      upstream.headers.forEach((v, k) => {
        if (!HOP.has(k))
          out[k] = v;
      });
      if (upstream.headers.has("content-length"))
        out["content-length"] = upstream.headers.get("content-length");
      res.writeHead(upstream.status, out);
      if (!upstream.body || req.method === "HEAD") {
        res.end();
        return;
      }
      Readable.fromWeb(upstream.body).pipe(res);
    } catch {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "gateway_unreachable" }));
    }
  });
  return new Promise((resolve) => {
    server.once("error", (error) => resolve(error.code === "EADDRINUSE" ? "busy" : "error"));
    server.listen(opts.port, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ port, stop: () => new Promise((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }) });
    });
  });
}
var ENV_LINE = (key) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
function mergeEnvLine(existing, key, value) {
  const line = `${key}=${value}`;
  if (existing === null || existing === "")
    return `${line}
`;
  const lines = existing.split(`
`);
  const at = lines.findIndex((l) => ENV_LINE(key).test(l));
  if (at >= 0) {
    lines[at] = line;
    return lines.join(`
`);
  }
  return `${existing}${existing.endsWith(`
`) ? "" : `
`}${line}
`;
}
function envLine(text, key) {
  for (const l of (text ?? "").split(`
`))
    if (ENV_LINE(key).test(l))
      return l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") || null;
  return null;
}
function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join3(dir, e.name);
      const st = e.isSymbolicLink() ? statSync(full) : null;
      if (e.isDirectory() || st?.isDirectory())
        walk(full);
      else if (e.isFile() || st?.isFile())
        out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out.filter((p) => !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$/.test(p)).sort();
}
var TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml"
};
var contentTypeOf = (path) => TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
function isDatabaseFile(full) {
  if (/(\.(db|db3|sqlite3?)|-(shm|wal|journal))$/i.test(full))
    return true;
  try {
    const fd = openSync(full, "r");
    try {
      const head = Buffer.alloc(16);
      return head.toString("latin1", 0, readSync(fd, head, 0, 16, 0)) === "SQLite format 3\x00";
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}
var PART_BYTES = 8 << 20;
var DEFAULT_JOBS = 32;
var RETRIES = 4;
function s3Etags(path, size) {
  if (size <= PART_BYTES)
    return [createHash3("md5").update(readFileSync(path)).digest("hex")];
  const fd = openSync(path, "r");
  try {
    const whole = createHash3("md5");
    const all = createHash3("md5");
    const buf = Buffer.allocUnsafe(PART_BYTES);
    let parts = 0;
    for (let pos = 0;pos < size; pos += PART_BYTES) {
      const n = readSync(fd, buf, 0, Math.min(PART_BYTES, size - pos), pos);
      whole.update(buf.subarray(0, n));
      all.update(createHash3("md5").update(buf.subarray(0, n)).digest());
      parts++;
    }
    return [whole.digest("hex"), `${all.digest("hex")}-${parts}`];
  } finally {
    closeSync(fd);
  }
}
async function listBucket(base, prefix, doFetch) {
  const held = new Map;
  let after = "";
  for (;; ) {
    let page;
    try {
      const res = await doFetch(`${base}/?list&prefix=${encodeURIComponent(prefix)}&after=${encodeURIComponent(after)}`);
      if (res.status !== 200)
        return null;
      page = await res.json();
    } catch {
      return null;
    }
    for (const k of page.keys)
      held.set(k.key, { size: k.size, etag: k.etag.replace(/"/g, "") });
    if (!page.truncated || page.keys.length === 0)
      return held;
    after = page.keys[page.keys.length - 1].key;
  }
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var retryable = (status) => status === 0 || status === 408 || status === 429 || status >= 500;
async function pushFiles(opts) {
  const doFetch = opts.fetch ?? fetch;
  const all = listFiles(opts.from);
  const database = all.filter((rel) => isDatabaseFile(join3(opts.from, rel)));
  const paths = all.filter((rel) => !database.includes(rel));
  const report = { files: 0, bytes: 0, put: 0, same: 0, failed: [], database };
  if (database.length > 0)
    opts.print?.(`left out ${database.length} database file(s), never put in the files bucket (the app's data moves through the Postgres import): ${database.slice(0, 20).join(", ")}`);
  const base = opts.filesUrl.replace(/\/+$/, "");
  const held = await listBucket(base, opts.prefix, doFetch);
  const backoff = opts.backoffMs ?? 200;
  let next = 0;
  let done = 0;
  const one = async (rel) => {
    const key = `${opts.prefix}${rel}`;
    const url = `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const full = join3(opts.from, rel);
    const size = statSync(full).size;
    report.files++;
    report.bytes += size;
    if (size > MAX_FILE_BYTES) {
      report.failed.push({ path: key, reason: `larger than ${MAX_FILE_BYTES / 1024 ** 3} GiB` });
      return;
    }
    const etags = s3Etags(full, size);
    let last = "";
    for (let attempt = 0;attempt < RETRIES; attempt++) {
      if (attempt > 0)
        await sleep(Math.random() * backoff * 2 ** attempt);
      try {
        if (held !== null) {
          const h = held.get(key);
          if (h !== undefined && h.size === size && etags.includes(h.etag)) {
            report.same++;
            return;
          }
        } else {
          const head = await doFetch(url, { method: "HEAD" });
          if (head.status === 200 && etags.includes(head.headers.get("etag")?.replace(/"/g, "") ?? "")) {
            report.same++;
            return;
          }
          if (head.status !== 200 && head.status !== 404) {
            last = `HTTP ${head.status}`;
            if (retryable(head.status))
              continue;
            break;
          }
        }
        const body = size > PART_BYTES ? Readable.toWeb(createReadStream(full)) : new Uint8Array(readFileSync(full));
        const put = await doFetch(url, { method: "PUT", headers: { "content-type": contentTypeOf(rel), "content-length": String(size) }, body, ...size > PART_BYTES ? { duplex: "half" } : {} });
        if (put.status === 201) {
          report.put++;
          return;
        }
        last = `HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`;
        if (!retryable(put.status))
          break;
      } catch (error) {
        last = error instanceof Error ? error.message : "unknown";
      }
    }
    report.failed.push({ path: key, reason: last });
  };
  const worker = async () => {
    while (next < paths.length) {
      const rel = paths[next++];
      try {
        await one(rel);
      } catch (error) {
        report.failed.push({ path: `${opts.prefix}${rel}`, reason: error instanceof Error ? error.message : "unknown" });
      }
      done++;
      if (opts.print && done % 500 === 0)
        opts.print(`dkod-db: files ${done} of ${paths.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.jobs ?? DEFAULT_JOBS, 128)) }, worker));
  report.failed.sort((a, b) => a.path.localeCompare(b.path));
  return report;
}

var ROW_HASH_CAP = 20000;
var NO_PASSWORD = "Postgres refused the connection, the key is missing or wrong. Put the right one in the PGPASSWORD env var or in ~/.pgpass, then run again.";
var isNoPassword = (stderr) => /fe_sendauth: no password supplied|password authentication failed/i.test(stderr);
var PG_TIMEOUT = { PGCONNECT_TIMEOUT: "10" };
var PG_SETTINGS = "SET TimeZone='UTC'; SET DateStyle='ISO, YMD'; SET extra_float_digits=1; SET bytea_output='hex'; SET IntervalStyle='postgres';";
var quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;
var quoteLit = (text) => `'${text.replace(/'/g, "''")}'`;
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
var LIGHT_SKIP_TABLES = /^(?:_prisma_migrations|__drizzle_migrations|schema_migrations|knex_migrations(?:_lock)?|kysely_migration(?:_lock)?|alembic_version|flyway_schema_history|django_migrations)$/;
var HEAVY_TABLE_BYTES = 100 * 1024 * 1024;
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
async function addRowHashes(imported, writes, url, env, run, cwd = ".") {
  const refs = Object.entries(imported).filter(([n, t]) => writes.includes(n) && t.rows > 0 && t.rows <= ROW_HASH_CAP).map(([name, t]) => ({ name, cols: t.cols, rows: t.rows }));
  if (refs.length === 0)
    return;
  const got = await rowHashes(url, refs, env, run, cwd);
  if (got === null)
    return;
  for (const r of refs)
    if (got[r.name].length === r.rows)
      imported[r.name].row_md5 = got[r.name];
}

var DB_APP_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;
var DEFAULT_PORT = 6543;
var WAIT_LIMIT_MS = 10 * 60000;
var CHECK_TIMEOUT_MS = 15000;
var CHECK_RETRY_MS = 1e4;
var UNKNOWN_APP = "unknown_app";
var GATEWAY_LOAD_BUDGET_MS = 2 * 60000;
var PHASE_LABEL = { gateway_loading: "gateway loading", database_making: "database being made", not_answering: "not answering" };
var PENDING_CAP = 1 << 20;
var RENEW_BEFORE_MS = 5 * 60000;
var RENEW_MIN_MS = 30000;
var RETRY_STEPS_MS = [30000, 60000, 120000, 300000];
var FLAGS = {
  up: ["app", "port", "files-port", "dir", "gateway", "config", "wait", "code", "dashboard", "org"],
  files: ["from", "prefix", "dir"],
  down: ["dir", "app"],
  migrate: ["dir", "port"],
  explain: [],
  import: ["app", "from", "dir", "port", "tables"],
  detect: ["dir"]
};
var BOOLEAN_FLAGS = { up: ["detach"], down: ["all"], import: ["no-data", "clear-links"] };
function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command)
    return { error: "usage" };
  if (!(command in FLAGS))
    return { error: `Unknown command "${command}".` };
  const flags = new Map;
  for (let i = 0;i < rest.length; i += 2) {
    const name = rest[i]?.startsWith("--") ? rest[i].slice(2) : null;
    if (name !== null && BOOLEAN_FLAGS[command]?.includes(name)) {
      flags.set(name, "true");
      i--;
      continue;
    }
    if (name === null)
      return { error: "usage" };
    if (!FLAGS[command].includes(name))
      return { error: `Unknown flag --${name} for "${command}".` };
    const value = rest[i + 1];
    if (value === undefined)
      return { error: `Flag --${name} needs a value.` };
    flags.set(name, value);
  }
  return { command, flags };
}
var USAGE = [
  "Usage:",
  "  node dkod-db.mjs up --app <app key> [--org <org_id>] [--port 6543] [--files-port <port + 1>] [--dir <app folder>] [--wait <seconds>] [--detach]",
  "  node dkod-db.mjs files --from <folder> [--prefix media/] [--dir <app folder>] [--jobs 32]   (while `up` runs)",
  "  node dkod-db.mjs down [--app <app key> | --dir <app folder>] [--all]",
  "  node dkod-db.mjs migrate [--dir <app folder>] [--port 6543]",
  "  node dkod-db.mjs import --app <app key> --from <local postgres URL | snapshot> [--dir <app folder>] [--port 6543] [--tables <name,name> [--clear-links] | --no-data]",
  "  node dkod-db.mjs detect [--dir <app folder>]"
].join(`
`);
function portOf(raw, fallback) {
  if (raw === undefined)
    return fallback;
  if (!/^\d{1,5}$/.test(raw))
    return null;
  const n = Number(raw);
  return n <= 65535 ? n : null;
}
var NO_DOCKER = "Do not make a database with Docker or a local Postgres: the app's Dev database is the one DKOD makes.";
var MAKE_STEP = "Call dkoder.devdb.status with the app's key: when it says missing, call dkoder.devdb.make with confirm: true, then run this again.";
var missingDb = (app) => `The ${app} Dev database does not exist yet. ${MAKE_STEP} ${NO_DOCKER}`;
var notSynced = (app) => `DKOD has made the ${app} Dev database, but the Dev database gateway has not loaded it yet. It usually takes a few minutes: run this again. ${NO_DOCKER}`;
var notReachable = (app) => `The ${app} Dev database did not answer in time. Check the network and the gateway address, then run this again. ${NO_DOCKER}`;
var NO_DEVICE = "This computer has no Dkoder device token yet. Call the DKOD tool dkoder.devdb.connect, then run this same command again at once with --code <code> --dashboard <dashboard_url> from its answer. The code works once, for 60 seconds.";
function trustedDashboard(raw) {
  if (typeof raw !== "string")
    return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "https:" || url.protocol === "http:" && local)
      return url.origin;
  } catch {}
  return null;
}
function resolveCredentials(env, configPath, readFile, pluginRoot, devicePath) {
  if (env.DKOD_URL && env.DKODER_TOKEN) {
    const dashboardUrl = trustedDashboard(env.DKOD_URL);
    return dashboardUrl ? { dashboardUrl, token: env.DKODER_TOKEN } : null;
  }
  for (const path of configCandidates(env, configPath, pluginRoot)) {
    const text = readFile(path);
    if (text === null)
      continue;
    try {
      const parsed = JSON.parse(text);
      const dashboardUrl = trustedDashboard(parsed.dashboardUrl);
      if (dashboardUrl && typeof parsed.token === "string" && parsed.token)
        return { dashboardUrl, token: parsed.token };
    } catch {}
    if (path === configPath)
      return null;
  }
  return devicePath ? readDeviceFile(devicePath, readFile) : null;
}
function configCandidates(env, configPath, pluginRoot) {
  return [configPath, env.CLAUDE_PLUGIN_ROOT && `${env.CLAUDE_PLUGIN_ROOT}/dkoder.json`, env.CURSOR_PLUGIN_ROOT && `${env.CURSOR_PLUGIN_ROOT}/dkoder.json`, pluginRoot && `${pluginRoot}/dkoder.json`].filter((p) => Boolean(p));
}
function missingCredentials(env, configPath, readFile, pluginRoot, devicePath) {
  const notes = [];
  if (env.DKOD_URL && env.DKODER_TOKEN)
    notes.push("DKOD_URL is not an https address");
  for (const path of [...configCandidates(env, configPath, pluginRoot), ...devicePath ? [devicePath] : []]) {
    const needs = path === devicePath ? "dashboardUrl, token, refresh and expiresAt" : "dashboardUrl and token";
    notes.push(`${path} ${readFile(path) === null ? "is missing" : `is not valid (it needs ${needs})`}`);
  }
  return `No DKOD credentials found: ${notes.join("; ")}.`;
}
function readDeviceFile(path, readFile) {
  const text = readFile(path);
  if (text === null)
    return null;
  try {
    const d = JSON.parse(text);
    const dashboardUrl = trustedDashboard(d.dashboardUrl);
    if (!dashboardUrl || typeof d.token !== "string" || !d.token || typeof d.refresh !== "string" || !d.refresh || typeof d.expiresAt !== "number")
      return null;
    return { dashboardUrl, token: d.token, refresh: d.refresh, expiresAt: d.expiresAt, ...typeof d.org === "string" && ORG_ID.test(d.org) ? { org: d.org } : {} };
  } catch {
    return null;
  }
}
var ORG_ID = /^[A-Za-z0-9_-]{1,64}$/;
var orgDevicePath = (devicePath, org) => devicePath.replace(/device\.json$/, `device-${org}.json`);
function saveDevice(io, creds) {
  const path = io.devicePath?.();
  if (!path)
    return;
  const text = JSON.stringify({ dashboardUrl: creds.dashboardUrl, token: creds.token, refresh: creds.refresh, expiresAt: creds.expiresAt, ...creds.org ? { org: creds.org } : {} });
  const write = io.writePrivate ?? io.writeFile;
  write(path, text);
  if (creds.org && ORG_ID.test(creds.org))
    write(orgDevicePath(path, creds.org), text);
}
function wantedOrg(flags, dir, readFile) {
  const flag = flags.get("org");
  if (flag !== undefined)
    return ORG_ID.test(flag) ? flag : { error: "--org takes the org_id that dkoder.devdb.status gave." };
  const text = readFile(join4(dir, ".dkod/org.json"));
  if (text === null)
    return null;
  try {
    const org = JSON.parse(text)?.org;
    return typeof org === "string" && ORG_ID.test(org) ? org : null;
  } catch {
    return null;
  }
}
var wrongOrg = (have, want) => `This computer's dkod-db helper is signed in to another DKOD organization (${have}) than this app's session (${want}), so it would open that organization's Dev database. Call the DKOD tool dkoder.devdb.connect in this session, then run this same command again at once with --code <code> --dashboard <dashboard_url> from its answer.`;
function dashboardFor(flag, io) {
  if (flag !== undefined)
    return trustedDashboard(flag);
  if (io.env.DKOD_URL)
    return trustedDashboard(io.env.DKOD_URL);
  const mcp = io.pluginRoot ? io.readFile(`${io.pluginRoot}/.mcp.json`) : null;
  if (mcp !== null) {
    try {
      const url = JSON.parse(mcp).mcpServers?.dkod?.url;
      const origin = trustedDashboard(url);
      if (origin)
        return origin;
    } catch {}
  }
  return "https://dashboard.dkod.app";
}
var pairOf = (dashboardUrl, body, org) => {
  const expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : NaN;
  if (typeof body.token !== "string" || !body.token || typeof body.refresh !== "string" || !body.refresh || Number.isNaN(expiresAt))
    return null;
  const said = typeof body.org === "string" && ORG_ID.test(body.org) ? body.org : org;
  return { dashboardUrl, token: body.token, refresh: body.refresh, expiresAt, ...said ? { org: said } : {} };
};
function unreachable(url, error, next) {
  const e = error ?? {};
  const code = e.cause?.code ?? e.code;
  const message = e.cause?.message ?? e.message;
  const why = [code, message].filter((v) => typeof v === "string" && v).join(": ") || "no error detail";
  return `Could not reach the dashboard at ${url} (${why}). ${next}`;
}
var CODE_GONE = "The connect code was refused: it works once, for 60 seconds. Call dkoder.devdb.connect again and run this at once with the new code.";
async function connectWithCode(code, dashboardUrl, io) {
  if (!/^dkodc_[a-z0-9]{16,64}_[A-Za-z0-9_-]{20,}$/.test(code))
    return "--code takes the code dkoder.devdb.connect gave (it starts with dkodc_).";
  let res;
  try {
    res = await io.fetch(`${dashboardUrl}/api/v1/dkoder/connect/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  } catch (error) {
    return unreachable(`${dashboardUrl}/api/v1/dkoder/connect/exchange`, error, "Check the network, then call dkoder.devdb.connect again.");
  }
  if (res.status === 401)
    return CODE_GONE;
  let body = {};
  try {
    body = JSON.parse(await res.text());
  } catch {}
  const creds = res.status === 201 || res.status === 200 ? pairOf(dashboardUrl, body) : null;
  if (!creds)
    return "DKOD could not connect this computer right now. Call dkoder.devdb.connect again in a minute.";
  saveDevice(io, creds);
  return creds;
}
var RENEW_DEVICE_BEFORE_MS = 5 * 60000;
async function freshCredentials(creds, io) {
  if (!creds.refresh || creds.expiresAt === undefined || creds.expiresAt - RENEW_DEVICE_BEFORE_MS > io.now())
    return creds;
  let res;
  try {
    res = await io.fetch(`${creds.dashboardUrl}/api/v1/dkoder/connect/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh: creds.refresh }) });
  } catch (error) {
    throw new TokenError("unavailable", unreachable(`${creds.dashboardUrl}/api/v1/dkoder/connect/refresh`, error, "Check the network and try again."));
  }
  if (res.status === 401)
    throw new TokenError("refused", `DKOD no longer accepts this computer's helper token. ${NO_DEVICE}`);
  let body = {};
  try {
    body = JSON.parse(await res.text());
  } catch {}
  const next = res.status === 201 || res.status === 200 ? pairOf(creds.dashboardUrl, body, creds.org) : null;
  if (!next)
    throw new TokenError("unavailable", "DKOD could not renew this computer's helper token right now. Try again in a minute.");
  saveDevice(io, next);
  return next;
}

class TokenError extends Error {
  kind;
  constructor(kind, message) {
    super(message);
    this.kind = kind;
    this.name = "TokenError";
  }
}
async function fetchDbToken(creds, app, io) {
  let res;
  try {
    res = await io.fetch(`${creds.dashboardUrl}/api/v1/dkoder/devdb/token`, {
      method: "POST",
      headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
      body: JSON.stringify({ app_key: app })
    });
  } catch (error) {
    throw new TokenError("unavailable", unreachable(`${creds.dashboardUrl}/api/v1/dkoder/devdb/token`, error, "Check the network and try again."));
  }
  const raw = await res.text().catch(() => "");
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {}
  if (res.status === 401)
    throw new TokenError("refused", "The dashboard refused this computer's device token. Call dkoder.devdb.connect, then run this again with --code <code> --dashboard <dashboard_url> from its answer.");
  if (res.status === 403)
    throw new TokenError("forbidden", typeof body.message === "string" && body.message ? body.message : "You are not a member of this app. Ask its owner to add you.");
  if (res.status === 429)
    throw new TokenError("rate", "Too many tokens in a minute. Wait a moment and try again.");
  if (res.status === 409)
    throw new TokenError("forbidden", `This app has no Dev database yet. ${MAKE_STEP} ${NO_DOCKER}`);
  const expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : NaN;
  if (res.status !== 200 || typeof body.token !== "string" || !body.token || Number.isNaN(expiresAt)) {
    throw new TokenError("unavailable", "DKOD could not make a token right now. Try again in a minute.");
  }
  return { token: body.token, expiresAt, gatewayUrl: typeof body.gateway_url === "string" ? body.gateway_url : null, org: typeof body.org === "string" && ORG_ID.test(body.org) ? body.org : null };
}
var pgMessage = (type, body) => {
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
};
function startupMessage(database) {
  const text = Buffer.from(`user\x00dev\x00database\x00${database}\x00application_name\x00dkod-db-check\x00\x00`);
  const head = Buffer.alloc(8);
  head.writeInt32BE(text.length + 8, 0);
  head.writeInt32BE(196608, 4);
  return Buffer.concat([head, text]);
}
function checkDatabase(gateway, app, token, io) {
  return new Promise((resolve) => {
    let done = false;
    let buf = Buffer.alloc(0);
    let asked = false;
    const finish = (result) => {
      if (done)
        return;
      done = true;
      cancel();
      if (result.kind === "ready")
        ws.sendBinary(pgMessage("X", Buffer.alloc(0)));
      ws.close(1000);
      resolve(result);
    };
    const cancel = io.schedule(CHECK_TIMEOUT_MS, () => finish({ kind: "not_open" }));
    const ws = connectWebSocket(`${gateway}/v1/connect/${app}`, { authorization: `Bearer ${token}`, "x-request-id": io.uuid() }, {
      onOpen() {
        ws.sendBinary(startupMessage(dbNameOf(app)));
      },
      onBinary(data) {
        buf = Buffer.concat([buf, data]);
        while (!done && buf.length >= 5) {
          const len = buf.readInt32BE(1);
          if (buf.length < len + 1)
            return;
          const type = String.fromCharCode(buf[0]);
          const body = buf.subarray(5, len + 1);
          buf = buf.subarray(len + 1);
          if (type === "E") {
            let code = "";
            let message = "";
            for (let i = 0;i < body.length && body[i] !== 0; ) {
              const end = body.indexOf(0, i + 1);
              if (end < 0)
                break;
              if (String.fromCharCode(body[i]) === "C")
                code = body.subarray(i + 1, end).toString();
              else if (String.fromCharCode(body[i]) === "M")
                message = body.subarray(i + 1, end).toString();
              i = end + 1;
            }
            finish(code === "3D000" ? { kind: "no_database" } : { kind: "not_open", detail: `${code} ${message}`.trim() });
          } else if (type === "Z") {
            if (!asked) {
              asked = true;
              ws.sendBinary(pgMessage("Q", Buffer.from("select 1\x00")));
            } else
              finish({ kind: "ready" });
          }
        }
      },
      onRefused(status, reason) {
        finish({ kind: "refused", reason: reason || `HTTP ${status}` });
      },
      onClose() {
        finish({ kind: "not_open" });
      }
    });
  });
}
var dbNameOf = (app) => `${app.replaceAll("-", "_")}_dev`;
var databaseUrlOf = (app, port) => `postgres://dev@127.0.0.1:${port}/${dbNameOf(app)}`;
var DATABASE_URL_LINE = /^\s*(?:export\s+)?DATABASE_URL\s*=/;
function mergeDatabaseUrl(existing, url) {
  const line = `DATABASE_URL=${url}`;
  if (existing === null || existing === "")
    return `${line}
`;
  const lines = existing.split(`
`);
  const at = lines.findIndex((l) => DATABASE_URL_LINE.test(l));
  if (at >= 0) {
    lines[at] = line;
    return lines.join(`
`);
  }
  return `${existing}${existing.endsWith(`
`) ? "" : `
`}${line}
`;
}
function readDatabaseUrl(envText) {
  for (const l of (envText ?? "").split(`
`)) {
    if (!DATABASE_URL_LINE.test(l))
      continue;
    const value = l.slice(l.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    return value || null;
  }
  return null;
}
function gitignoreCoversEnvLocal(text) {
  if (text === null)
    return false;
  return text.split(`
`).some((l) => [".env.local", "/.env.local", ".env*", ".env.*", "*.local"].includes(l.trim()));
}
var join4 = (dir, name) => dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}/${name}`;
var trimSlashes = (p) => p.length > 1 ? p.replace(/[\\/]+$/, "") : p;
function originalFolderRefusal(dir, cwd, readFile) {
  const here = trimSlashes(resolvePath(cwd, dir));
  if (readFile(join4(here, ".dkod/migration.json")) != null)
    return null;
  const cut = here.lastIndexOf("/");
  const name = here.slice(cut + 1);
  if (!name || name.startsWith("dk-"))
    return null;
  const dkDir = `${cut > 0 ? here.slice(0, cut) : ""}/dk-${name}`;
  const raw = readFile(join4(dkDir, ".dkod/migration.json"));
  if (raw == null)
    return null;
  let original;
  try {
    original = JSON.parse(raw)?.original;
  } catch {
    return null;
  }
  if (typeof original !== "string" || trimSlashes(resolvePath(dkDir, original)) !== here)
    return null;
  return `${here} is the original app of the migration in ${dkDir}, and the original is read only: run this in the dk- app's folder (--dir ${dkDir}).`;
}
async function startUp(flags, io, cwd) {
  const fail = (code, sentence) => {
    io.print(`dkod-db: ${sentence}`);
    return { exit: code };
  };
  const app = flags.get("app") ?? "";
  if (!DB_APP_KEY.test(app))
    return fail(2, "Give the app's key with --app: lowercase letters, digits and dashes.");
  const port = portOf(flags.get("port"), DEFAULT_PORT);
  if (port === null)
    return fail(2, "--port must be a number from 0 to 65535.");
  const filesPort = portOf(flags.get("files-port"), port === 0 ? 0 : Math.min(port + 1, 65535));
  if (filesPort === null)
    return fail(2, "--files-port must be a number from 0 to 65535.");
  const dir = flags.get("dir") ?? cwd;
  const refusal = originalFolderRefusal(dir, cwd, io.readFile);
  if (refusal)
    return fail(2, refusal);
  const wanted = wantedOrg(flags, resolvePath(cwd, dir), io.readFile);
  if (wanted !== null && typeof wanted === "object")
    return fail(2, wanted.error);
  let creds;
  const code = flags.get("code");
  if (code !== undefined) {
    const dashboardUrl = dashboardFor(flags.get("dashboard"), io);
    if (!dashboardUrl)
      return fail(2, "--dashboard must be the https address of the DKOD dashboard.");
    const got = await connectWithCode(code, dashboardUrl, io);
    if (typeof got === "string")
      return fail(2, got);
    creds = got;
  } else {
    const devicePath = io.devicePath?.();
    const own = wanted && devicePath ? readDeviceFile(orgDevicePath(devicePath, wanted), io.readFile) : null;
    const found = own ?? resolveCredentials(io.env, flags.get("config"), io.readFile, io.pluginRoot, devicePath);
    if (!found)
      return fail(2, `${missingCredentials(io.env, flags.get("config"), io.readFile, io.pluginRoot, devicePath)} ${NO_DEVICE}`);
    creds = found;
  }
  if (wanted && creds.org && creds.org !== wanted)
    return fail(2, wrongOrg(creds.org, wanted));
  const dbToken = async () => {
    creds = await freshCredentials(creds, io);
    return await fetchDbToken(creds, app, io);
  };
  let issued;
  try {
    issued = await dbToken();
  } catch (error) {
    return fail(error instanceof TokenError && error.kind === "unavailable" ? 1 : 2, error instanceof Error ? error.message : "Could not get a token.");
  }
  if (wanted && issued.org && issued.org !== wanted)
    return fail(2, wrongOrg(issued.org, wanted));
  if (wanted) {
    try {
      io.writeFile(join4(resolvePath(cwd, dir), ".dkod/org.json"), `${JSON.stringify({ org: wanted })}
`);
    } catch {}
  }
  const gatewayBase = flags.get("gateway") ?? issued.gatewayUrl;
  if (!gatewayBase)
    return fail(2, "This organization has no default domain, so there is no gateway address. Set one in Setup > Domains, or pass --gateway.");
  const problem = gatewayUrlProblem(gatewayBase);
  if (problem)
    return fail(2, problem);
  const gateway = gatewayBase.replace(/\/+$/, "");
  const waitRaw = flags.get("wait");
  if (waitRaw !== undefined && !/^\d{1,6}$/.test(waitRaw))
    return fail(2, "--wait must be a number of seconds.");
  const waitMs = waitRaw === undefined ? WAIT_LIMIT_MS : Number(waitRaw) * 1000;
  const startedAt = io.now();
  let sawNoDatabase = false;
  let token = issued.token;
  let expiresAt = issued.expiresAt;
  const refresh = async () => {
    try {
      const next = await dbToken();
      token = next.token;
      expiresAt = next.expiresAt;
      return "ok";
    } catch (error) {
      if (error instanceof TokenError && (error.kind === "unavailable" || error.kind === "rate"))
        return "later";
      return error instanceof Error ? error : new Error("Could not get a token.");
    }
  };
  let retriedAfterRefusal = false;
  let sawSyncing = false;
  const spent = { gateway_loading: 0, database_making: 0, not_answering: 0 };
  let phase = null;
  let phaseSince = startedAt;
  let warnedOverBudget = false;
  const enter = (next) => {
    const at = io.now();
    if (phase !== null)
      spent[phase] += at - phaseSince;
    if (next !== phase)
      io.print(`dkod-db: ${PHASE_LABEL[next]} (${Math.round((at - startedAt) / 1000)} s)`);
    phase = next;
    phaseSince = at;
  };
  const breakdown = () => {
    const at = io.now();
    const parts = Object.keys(spent).map((p) => [p, spent[p] + (p === phase ? at - phaseSince : 0)]).filter(([, ms]) => ms > 0);
    return parts.map(([p, ms]) => `${PHASE_LABEL[p]} ${Math.round(ms / 1000)} s`).join(", ");
  };
  const withBreakdown = (sentence) => {
    const b = breakdown();
    return b ? `${sentence} (after ${Math.round((io.now() - startedAt) / 1000)} s: ${b})` : sentence;
  };
  let lastDetail = "";
  for (;; ) {
    let checked = { kind: "not_open" };
    let renewed = "ok";
    if (expiresAt - RENEW_BEFORE_MS <= io.now())
      renewed = await refresh();
    if (renewed instanceof Error)
      return fail(2, renewed.message);
    if (renewed === "ok") {
      checked = await checkDatabase(gateway, app, token, io);
      if (checked.kind === "refused" && checked.reason === UNKNOWN_APP) {
        const again = await refresh();
        if (again instanceof Error)
          return fail(2, again.message);
        sawSyncing = true;
        enter("gateway_loading");
        checked = { kind: "not_open" };
      } else if (checked.kind === "refused") {
        if (retriedAfterRefusal)
          return fail(2, `connect refused: ${checked.reason}`);
        const again = await refresh();
        if (again instanceof Error)
          return fail(2, again.message);
        if (again === "ok") {
          retriedAfterRefusal = true;
          continue;
        }
        lastDetail = checked.reason;
        checked = { kind: "not_open" };
      } else {
        retriedAfterRefusal = false;
      }
    }
    if (checked.kind === "not_open" && checked.detail)
      lastDetail = checked.detail;
    if (checked.kind === "ready") {
      const total = Math.round((io.now() - startedAt) / 1000);
      if (phase !== null) {
        enter(phase);
        io.print(`dkod-db: ready after ${total} s (${breakdown()})`);
      }
      break;
    }
    if (checked.kind === "no_database") {
      sawNoDatabase = true;
      enter("database_making");
    } else if (phase !== "gateway_loading")
      enter("not_answering");
    const elapsed = io.now() - startedAt;
    if (elapsed + CHECK_RETRY_MS > waitMs)
      return fail(1, withBreakdown(sawNoDatabase ? missingDb(app) : sawSyncing ? notSynced(app) : notReachable(app)));
    io.print(sawSyncing && !sawNoDatabase ? `dkod-db: waiting for the Dev database gateway to load ${app}; DKOD has made it, the gateway gets it within a few minutes (${Math.round(elapsed / 1000)} s of ${Math.round(waitMs / 1000)} s)` : phase === "not_answering" ? `dkod-db: the Dev database gateway for ${app} is reached but refuses or does not answer the login${lastDetail ? `: ${lastDetail}` : ""} (${Math.round(elapsed / 1000)} s of ${Math.round(waitMs / 1000)} s)` : `dkod-db: waiting for DKOD to make the ${app} Dev database (${Math.round(elapsed / 1000)} s of ${Math.round(waitMs / 1000)} s)`);
    if (phase === "gateway_loading" && !warnedOverBudget && spent.gateway_loading + (io.now() - phaseSince) > GATEWAY_LOAD_BUDGET_MS) {
      warnedOverBudget = true;
      io.print(`dkod-db: the gateway has not loaded ${app} for longer than the usual sync (about ${GATEWAY_LOAD_BUDGET_MS / 60000} min). Check that Argo CD synced platform/dkod-devdb/access.yaml (the refresh may have been refused), and that the gateway can read the dkod-devdb-gateway-access ConfigMap.`);
    }
    await new Promise((resolve) => {
      io.schedule(CHECK_RETRY_MS, resolve);
    });
  }
  const open = new Set;
  const sockets = new Set;
  let stopped = false;
  const handleConnection = (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => sock.destroy());
    let pending = [];
    let pendingBytes = 0;
    let ready = false;
    let ws = null;
    let wsFull = false;
    let held = false;
    const send = (chunk) => {
      if (!ws.sendBinary(chunk)) {
        wsFull = true;
        sock.pause();
      }
    };
    const resumeIfFree = () => {
      if (!wsFull && !held)
        sock.resume();
    };
    io.print(`dkod-db: connection opened (${app})`);
    sock.on("data", (chunk) => {
      if (!ready) {
        pendingBytes += chunk.length;
        if (pendingBytes > PENDING_CAP) {
          sock.destroy();
          ws?.close(1009, "too much data");
          return;
        }
        pending.push(chunk);
        return;
      }
      send(chunk);
    });
    sock.on("close", () => {
      io.print(`dkod-db: connection closed (${app})`);
      ws?.close();
    });
    ws = connectWebSocket(`${gateway}/v1/connect/${app}`, { authorization: `Bearer ${token}`, "x-request-id": io.uuid() }, {
      onOpen() {
        ready = true;
        open.add(ws);
        for (const chunk of pending)
          send(chunk);
        pending = [];
      },
      onBinary(data) {
        if (!sock.write(data)) {
          ws.pause();
          sock.once("drain", () => ws.resume());
        }
      },
      onText(text) {
        let type;
        try {
          type = JSON.parse(text).type;
        } catch {
          return;
        }
        if (type === "renewed")
          io.print("dkod-db: token renewed");
        else if (type === "pause") {
          held = true;
          sock.pause();
        } else if (type === "resume") {
          held = false;
          resumeIfFree();
        }
      },
      onDrain() {
        wsFull = false;
        resumeIfFree();
      },
      onRefused(status, reason) {
        io.print(`dkod-db: connect refused: ${reason || `HTTP ${status}`}`);
        sock.destroy();
      },
      onClose(code, reason) {
        open.delete(ws);
        if (code === 4001)
          io.print("dkod-db: the gateway refused the renewed token; restart this command");
        else if (code !== 1000 && code !== 1005 && reason && reason !== "connection closed" && !sock.destroyed)
          io.print(`dkod-db: connection ended: ${reason}`);
        sock.end();
        setTimeout(() => sock.destroy(), 500).unref?.();
      }
    });
  };
  let cancelRenew = null;
  let failures = 0;
  const renew = async () => {
    try {
      const next = await dbToken();
      token = next.token;
      expiresAt = next.expiresAt;
      failures = 0;
      for (const ws of open)
        ws.sendText(JSON.stringify({ type: "renew", token }));
      return true;
    } catch (error) {
      const wait = RETRY_STEPS_MS[Math.min(failures, RETRY_STEPS_MS.length - 1)];
      failures++;
      io.print(`dkod-db: token renewal failed (${error instanceof Error ? error.message : "unknown"}) Retrying in ${wait / 1000} s.`);
      scheduleRenew(wait);
      return false;
    }
  };
  const scheduleRenew = (ms) => {
    cancelRenew?.();
    cancelRenew = io.schedule(ms, () => {
      renew().then((ok) => {
        if (ok && !stopped)
          scheduleRenew(Math.max(RENEW_MIN_MS, expiresAt - RENEW_BEFORE_MS - io.now()));
      });
    });
  };
  scheduleRenew(Math.max(RENEW_MIN_MS, expiresAt - RENEW_BEFORE_MS - io.now()));
  const server = net2.createServer(handleConnection);
  const listening = await new Promise((resolve) => {
    server.once("error", (error) => resolve(error.code === "EADDRINUSE" ? "busy" : "error"));
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
  if (listening === "busy" || listening === "error") {
    cancelRenew?.();
    return fail(3, listening === "busy" ? `Port ${port} is in use. Stop what uses it, or pick another with --port.` : `Could not listen on port ${port}.`);
  }
  const actualPort = listening;
  const files = await (io.startFilesProxy ?? startFilesProxy)({ base: filesBaseOf(gateway), app, port: filesPort, token: () => token, requestId: () => io.uuid() });
  if (files === "busy" || files === "error") {
    cancelRenew?.();
    await new Promise((resolve) => server.close(() => resolve()));
    return fail(3, files === "busy" ? `Port ${filesPort} (the files port) is in use. Stop what uses it, or pick another with --files-port.` : `Could not listen on port ${filesPort} (the files port).`);
  }
  const envPath = join4(dir, ".env.local");
  io.writeFile(envPath, mergeEnvLine(mergeDatabaseUrl(io.readFile(envPath), databaseUrlOf(app, actualPort)), "DKOD_FILES_URL", `http://127.0.0.1:${files.port}`));
  if (!gitignoreCoversEnvLocal(io.readFile(join4(dir, ".gitignore"))))
    io.print("dkod-db: warning: .gitignore does not ignore .env.local. Add it so it is never committed.");
  io.print(`dkod-db: ${app} Dev database on 127.0.0.1:${actualPort} (DATABASE_URL in .env.local)`);
  const orgSaid = issued.org ?? creds.org;
  if (orgSaid)
    io.print(`dkod-db: DKOD organization ${orgSaid}`);
  io.print(`dkod-db: ${app} dev files bucket on http://127.0.0.1:${files.port} (DKOD_FILES_URL in .env.local)`);
  return {
    handle: {
      port: actualPort,
      renewNow: renew,
      async stop() {
        stopped = true;
        cancelRenew?.();
        for (const ws of open)
          ws.close(1001, "shutdown");
        for (const sock of sockets)
          sock.destroy();
        await files.stop();
        await new Promise((resolve) => server.close(() => resolve()));
      }
    }
  };
}
async function runFiles(flags, io, cwd) {
  const say = (line) => io.print(`dkod-db: ${line}`);
  const from = flags.get("from");
  if (!from) {
    say("Give the folder to put with --from.");
    return 2;
  }
  const prefix = flags.get("prefix") ?? "";
  if (prefix !== "" && (!/^[^/].*\/$/.test(prefix) || prefix.split("/").slice(0, -1).some((p) => p === "" || p === "." || p === ".."))) {
    say("--prefix must be a path that ends with /, for example media/.");
    return 2;
  }
  const dir = resolvePath(cwd, flags.get("dir") ?? ".");
  const filesUrl = envLine(io.readFile(join4(dir, ".env.local")), "DKOD_FILES_URL");
  if (!filesUrl) {
    say("There is no DKOD_FILES_URL in .env.local. Run `node dkod-db.mjs up --app <app key> --detach` first.");
    return 2;
  }
  const jobs = flags.has("jobs") ? Number(flags.get("jobs")) : undefined;
  if (jobs !== undefined && (!Number.isInteger(jobs) || jobs < 1 || jobs > 128)) {
    say("--jobs must be a number from 1 to 128.");
    return 2;
  }
  const report = await pushFiles({ filesUrl, from: resolvePath(cwd, from), prefix, print: io.print, ...jobs === undefined ? {} : { jobs } });
  io.print(JSON.stringify({ files: report.files, bytes: report.bytes, put: report.put, same: report.same, failed: report.failed, database: report.database }));
  if (report.failed.length > 0 && report.put === 0 && report.same === 0 && report.failed.every((f) => f.reason.includes("bucket_unavailable"))) {
    say("The app's dev files bucket is not there yet. Call dkoder.devdb.make with the app key and confirm: true (it only adds the bucket to an app made before), wait a few minutes, then run this again.");
    return 1;
  }
  if (report.failed.length > 0) {
    say(`${report.failed.length} file(s) are NOT in the dev bucket: ${report.failed.slice(0, 20).map((f) => f.path).join(", ")}`);
    return 1;
  }
  say(`all ${report.files} file(s) are in the dev bucket (${report.put} put, ${report.same} already there)`);
  return 0;
}
var probe = (port) => new Promise((resolve) => {
  const s = net2.connect({ host: "127.0.0.1", port });
  s.once("connect", () => {
    s.destroy();
    resolve(true);
  });
  s.once("error", () => resolve(false));
});
var APPLIED = /running upgrade|\bapplied\b|migrat\w* (?:complete|done|success)|\.sql\b/i;
var NOT_STARTED = 127;
var platform = (io) => io.platform ?? process.platform;
var missing = (r) => r.status === NOT_STARTED || r.status === 9009 || /No module named '?alembic\b/.test(`${r.stdout}
${r.stderr}`);
function alembicCommands(dir, exists, os) {
  const args = ["upgrade", "head"];
  const out = [];
  for (const venv of [".venv", "venv"]) {
    const bin = os === "win32" ? join4(dir, `${venv}\\Scripts\\alembic.exe`) : join4(dir, `${venv}/bin/alembic`);
    if (exists(bin))
      out.push({ cmd: bin, args });
  }
  out.push({ cmd: "alembic", args });
  for (const py of os === "win32" ? ["python", "py"] : ["python3", "python"])
    out.push({ cmd: py, args: ["-m", "alembic", ...args] });
  return out;
}
var alembicRevisions = (stdout) => stdout.split(`
`).map((l) => /^(\S+)(?: \([^)]*\))*$/.exec(l.trim())?.[1]).filter((r) => r !== undefined);
async function alembicApplied(alembic, before) {
  const cur = await alembic(["current"]);
  const after = cur.status === 0 ? alembicRevisions(cur.stdout) : [];
  if (after.length !== 1 || before.length > 1)
    return null;
  if (after[0] === before[0])
    return 0;
  const h = await alembic(["history", "-r", `${before[0] ?? "base"}:${after[0]}`]);
  if (h.status !== 0)
    return null;
  return h.stdout.split(`
`).filter((l) => l.includes(" -> ")).length - before.length;
}
var NO_MIGRATION_TOOL = "No migration tool found: expected drizzle.config.ts (or .js, .mjs), alembic.ini, or a db:migrate script in package.json (the node-service template's plain SQL migrations) in the app folder.";
function hasDbMigrateScript(pkg) {
  if (pkg === null)
    return false;
  try {
    const script = JSON.parse(pkg)?.scripts?.["db:migrate"];
    return typeof script === "string" && script.trim() !== "";
  } catch {
    return false;
  }
}
async function runMigrate(flags, io, cwd, exists) {
  const say = (line) => io.print(`dkod-db: ${line}`);
  const dir = flags.get("dir") ?? cwd;
  const refusal = originalFolderRefusal(dir, cwd, io.readFile);
  if (refusal) {
    say(refusal);
    return 2;
  }
  const url = readDatabaseUrl(io.readFile(join4(dir, ".env.local")));
  if (!url) {
    say("There is no DATABASE_URL in .env.local. Run `node dkod-db.mjs up --app <app key>` first.");
    return 2;
  }
  let urlPort = null;
  try {
    urlPort = Number(new URL(url).port) || null;
  } catch {}
  const port = portOf(flags.get("port"), urlPort ?? DEFAULT_PORT);
  if (port === null) {
    say("--port must be a number from 0 to 65535.");
    return 2;
  }
  if (!await probe(port)) {
    say("The Dev database is not up. Run `node dkod-db.mjs up --app <app key>` first, in the background.");
    return 2;
  }
  const drizzle = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"].some((f) => exists(join4(dir, f)));
  const alembic = !drizzle && exists(join4(dir, "alembic.ini"));
  const script = !drizzle && !alembic && hasDbMigrateScript(io.readFile(join4(dir, "package.json")));
  if (!drizzle && !alembic && !script) {
    say(NO_MIGRATION_TOOL);
    return 2;
  }
  const tries = drizzle ? [{ cmd: "bunx", args: ["drizzle-kit", "migrate"] }] : script ? [{ cmd: "bun", args: ["run", "db:migrate"] }] : alembicCommands(dir, exists, platform(io));
  const name = drizzle ? "drizzle-kit" : script ? "bun run db:migrate" : "alembic";
  const env = { DATABASE_URL: url };
  for (const key of ["PATH", "HOME", "USER", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot", "LANG"])
    if (io.env[key] !== undefined)
      env[key] = io.env[key];
  let result = { status: NOT_STARTED, stdout: "", stderr: "" };
  let used = tries[0];
  let before = null;
  for (const t of tries) {
    if (alembic) {
      const cur = await io.run(t.cmd, [...t.args.slice(0, -2), "current"], env, dir);
      if (missing(cur)) {
        result = cur;
        continue;
      }
      before = cur.status === 0 ? alembicRevisions(cur.stdout) : null;
    }
    result = await io.run(t.cmd, t.args, env, dir);
    used = t;
    if (!missing(result))
      break;
  }
  if (missing(result) && alembic) {
    say(`alembic is not installed for this app. In the app folder, make its virtual environment and install the app into it: \`${platform(io) === "win32" ? "python -m venv .venv; .venv\\Scripts\\python -m pip install -e ." : "python3 -m venv .venv && .venv/bin/python -m pip install -e ."}\` (or \`-r requirements.txt\` in place of \`-e .\`). Then run migrate again.`);
    return 1;
  }
  const tool = { name };
  const revisions = alembic && before && result.status === 0 ? await alembicApplied((args) => io.run(used.cmd, [...used.args.slice(0, -2), ...args], env, dir), before) : null;
  if (revisions !== null)
    say(`${tool.name} finished with exit status ${result.status}; ${revisions} revision${revisions === 1 ? "" : "s"} applied.`);
  else {
    const applied = `${result.stdout}
${result.stderr}`.split(`
`).filter((l) => APPLIED.test(l)).length;
    say(`${tool.name} finished with exit status ${result.status}; ${applied} line${applied === 1 ? "" : "s"} look like applied migrations.`);
  }
  if (result.status !== 0 || script || alembic) {
    const plain = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    const tail = plain(`${result.stdout}
${result.stderr}`).split(`
`).filter((l) => l.trim() !== "").slice(-20);
    for (const l of tail)
      io.print(l);
    if (result.status !== 0 && !tail.some((l) => /error|exception|fail|refused|denied/i.test(l)))
      say(`${tool.name} gave no reason. It gives none when it cannot reach the database: run \`node dkod-db.mjs up --app <app key>\` again and wait until it prints \`ready\`, then run migrate again.`);
  }
  return result.status === 0 ? 0 : 1;
}
var IMPORT_LOCAL_ONLY = "import reads a local Postgres only: give --from a postgres:// URL on this computer (127.0.0.1, localhost or ::1), or `snapshot` for the migration's scratch database (a Postgres one, or the untouched base copy of a SQLite file).";
var DEV_WARNING = "Dev is shared by every builder in the org (each app has its own database) and keeps 1 day of backups.";
var LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];
function fkOrder(tables, edges) {
  const names = new Set(tables);
  const parents = new Map(tables.map((t) => [t, new Set]));
  for (const e of edges)
    if (e.child !== e.parent && names.has(e.child) && names.has(e.parent))
      parents.get(e.child).add(e.parent);
  const order = [];
  const done = new Set;
  while (order.length < tables.length) {
    const next = tables.find((t) => !done.has(t) && [...parents.get(t)].every((p) => done.has(p)));
    if (next === undefined)
      return { cycle: tables.filter((t) => !done.has(t)) };
    done.add(next);
    order.push(next);
  }
  return { order };
}
function copyPlan(tables, edges) {
  const first = fkOrder(tables, edges);
  if ("order" in first)
    return { order: first.order, held: [] };
  const held = new Set(first.cycle);
  const second = fkOrder(tables, edges.filter((e) => !(held.has(e.child) && held.has(e.parent))));
  return { order: "order" in second ? second.order : tables, held: first.cycle };
}
var holdForeignKeys = (held) => {
  if (held.length === 0)
    return "";
  const names = `ARRAY[${held.map(quoteLit).join(",")}]::text[]`;
  return `CREATE TEMP TABLE dkod_fk_hold ON COMMIT DROP AS SELECT cl.relname::text AS tbl, k.conname::text AS name, pg_get_constraintdef(k.oid) AS def FROM pg_constraint k JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace JOIN pg_class pl ON pl.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pl.relnamespace WHERE k.contype='f' AND n.nspname='public' AND pn.nspname='public' AND cl.relname = ANY(${names}) AND pl.relname = ANY(${names}) AND k.conrelid <> k.confrelid;
` + `DO $$ DECLARE r record; BEGIN FOR r IN SELECT tbl, name FROM dkod_fk_hold LOOP EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.name); END LOOP; END $$;
`;
};
var restoreForeignKeys = (held) => held.length === 0 ? "" : `DO $$ DECLARE r record; BEGIN FOR r IN SELECT tbl, name, def FROM dkod_fk_hold ORDER BY tbl, name LOOP EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', r.tbl, r.name, r.def); END LOOP; END $$;
`;
var holdTriggers = (tables) => {
  if (tables.length === 0)
    return "";
  const names = `ARRAY[${tables.map(quoteLit).join(",")}]::text[]`;
  return `CREATE TEMP TABLE dkod_trigger_hold ON COMMIT DROP AS SELECT cl.relname::text AS tbl, t.tgname::text AS name, t.tgenabled::text AS mode FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND n.nspname='public' AND cl.relname = ANY(${names});
` + `DO $$ DECLARE r record; BEGIN FOR r IN SELECT tbl, name FROM dkod_trigger_hold LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', r.tbl, r.name); END LOOP; END $$;
`;
};
var restoreTriggers = (tables) => tables.length === 0 ? "" : `DO $$ DECLARE r record; BEGIN FOR r IN SELECT tbl, name, mode FROM dkod_trigger_hold ORDER BY tbl, name LOOP EXECUTE format('ALTER TABLE public.%I ENABLE %s TRIGGER %I', r.tbl, CASE r.mode WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END, r.name); END LOOP; END $$;
`;
var cycleNote = (held) => `These tables reference each other in a cycle: ${held.join(", ")}. Their foreign keys are taken off for the copy and put back in the same transaction; Postgres checks every row when they go back.`;
function safeErrors(stderr) {
  const out = [];
  for (const l of stderr.split(`
`)) {
    const m = /ERROR:\s+(.*)$/.exec(l);
    if (m)
      out.push(`ERROR: ${m[1].replace(/["'].*$/, "…")}`);
    else if (/^(?:psql|dkod-db): error: /.test(l))
      out.push(l.replace(/["'].*$/, "…"));
    else if (/^Could not start \S+ \(/.test(l))
      out.push(l);
    const c = /\bCOPY (\S+?),/.exec(l);
    if (c && /^CONTEXT:/.test(l))
      out.push(`ERROR: in table ${c[1]}`);
  }
  return out;
}
var emptyGuard = (tables) => tables.length === 0 ? "" : `DO $$ BEGIN
${tables.map((t) => `IF EXISTS (SELECT 1 FROM public.${quoteIdent(t.name)}) THEN RAISE EXCEPTION 'dkod-import: Dev table ${t.name.replace(/'/g, "''").replace(/%/g, "%%")} already has rows; import never overwrites'; END IF;`).join(`
`)}
END $$;
`;
var sequenceResets = (tables) => {
  let sql = "";
  for (const t of tables)
    for (const c of t.cols) {
      const tc = `public.${quoteIdent(t.name)}`;
      sql += `DO $$ DECLARE s text; BEGIN s := pg_get_serial_sequence(${quoteLit(tc)}, ${quoteLit(c)}); IF s IS NOT NULL THEN PERFORM setval(s, coalesce((SELECT max(${quoteIdent(c)}) FROM ${tc}), 1), (SELECT max(${quoteIdent(c)}) FROM ${tc}) IS NOT NULL); END IF; END $$;
`;
    }
  return sql;
};
var TOOL_TABLE = /^(?:sqlite_.*|_prisma_migrations|__drizzle_migrations|drizzle_migrations|knex_migrations(?:_lock)?|alembic_version|django_migrations|schema_migrations|ar_internal_metadata|SequelizeMeta|typeorm_metadata|migrations|_litestream_.*)$/i;
function markImported(c) {
  let record = null;
  try {
    record = JSON.parse(c.io.readFile(c.snapshotFile) ?? "null");
  } catch {}
  if (record && record.mode === "snapshot")
    c.io.writeFile(c.snapshotFile, `${JSON.stringify({ ...record, imported: true, imported_tables: record.imported_tables ?? {}, dev_url: c.devUrl }, null, 2)}
`);
}
async function importSqlite(c) {
  const { io, say, dir, app } = c;
  const cannot = (why) => {
    say(`the original's data is in SQLite and cannot be imported: ${why}`);
    return 2;
  };
  const noBinary = `${NO_SQLITE_READER}. Then run import again.`;
  for (const b of c.bases) {
    const got = io.sha256?.(b.base) ?? null;
    if (got === null)
      return cannot("the snapshot's untouched base copy is gone. Run `dkod-migrate.mjs snapshot` again, rerun the suite and freeze again.");
    if (got !== b.sha256) {
      say(`the base copy of ${b.rel} is not the data the suite was frozen on (its sha256 changed after the snapshot). Run \`dkod-migrate.mjs snapshot\` again, rerun the suite and freeze again.`);
      return 1;
    }
  }
  const schemas = new Map;
  for (const b of c.bases)
    schemas.set(b.rel, await sqliteSchema(io.run, c.baseEnv, b.base, dir));
  for (const s of schemas.values())
    if (!s.ok)
      return cannot(s.missing ? noBinary : `${s.reason}. Run \`dkod-migrate.mjs snapshot\` again.`);
  const mapped = readSqliteMapTables(io.readFile(join4(dir, ".dkod/map/app-map.json")));
  const fromFile = mapped.length === 0 && c.light;
  if (fromFile) {
    for (const b of c.bases) {
      const s = schemas.get(b.rel);
      if (s?.ok) {
        for (const name of s.value.columns.keys())
          if (!TOOL_TABLE.test(name) && !mapped.some((m) => m.name === name))
            mapped.push({ name, store: b.rel });
      }
    }
    if (mapped.length === 0) {
      say("The original's SQLite file has no tables: there is no data to import.");
      markImported(c);
      io.print(JSON.stringify({ ok: true, app, tables: [], already_present: [], imported: true, skipped_tables: [], dropped_columns: {} }));
      return 0;
    }
  }
  if (mapped.length === 0) {
    say("The migration map has no tables to import (.dkod/map/app-map.json).");
    return 2;
  }
  const baseOf = (store) => c.bases.length === 1 ? c.bases[0] : c.bases.find((b) => store !== null && (store === b.rel || b.rel.endsWith(`/${store}`) || store.endsWith(`/${b.rel}`)));
  const sourceCols = new Map;
  const edges = [];
  for (const t of mapped) {
    const base = baseOf(t.store);
    const s = base === undefined ? undefined : schemas.get(base.rel);
    const cols = s && s.ok ? s.value.columns.get(t.name) : undefined;
    if (base !== undefined && cols !== undefined)
      sourceCols.set(t.name, { base, cols });
  }
  for (const s of schemas.values())
    if (s.ok)
      edges.push(...s.value.edges);
  const present = mapped.map((t) => t.name).filter((n) => sourceCols.has(n));
  const skippedTables = mapped.map((t) => t.name).filter((n) => !sourceCols.has(n));
  if (present.length === 0) {
    say("None of the map's tables is in the original's SQLite file. Nothing to import.");
    return 2;
  }
  const devColsRes = await c.psql(c.devUrl, c.devEnv, ["-c", `SELECT c.table_name, c.column_name, c.data_type, c.udt_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE' WHERE c.table_schema='public' AND c.is_generated='NEVER' AND c.table_name IN (${present.map(quoteLit).join(",")}) ORDER BY c.table_name, c.ordinal_position`]);
  if (devColsRes.status !== 0)
    return c.failed("Could not read the Dev database's tables.", devColsRes.stderr);
  const devCols = new Map;
  for (const l of devColsRes.stdout.split(`
`)) {
    const [t, col, type, udt] = l.split("\t");
    if (t && col && type && udt)
      devCols.set(t, (devCols.get(t) ?? new Map).set(col, { type, udt }));
  }
  const tables = [];
  const droppedColumns = {};
  for (const name of present) {
    const have = devCols.get(name);
    if (!have) {
      say(fromFile ? `Table ${name} of the original is not in the Dev database: the app's migrations do not make it. Give the app's schema this table with the same name and the same column names, run \`dkod-db.mjs migrate\`, then import again.` : `Table ${name} is not in the Dev database. Run the app's db:migrate first.`);
      return 2;
    }
    const src = sourceCols.get(name).cols;
    const cols = src.filter((col) => have.has(col));
    if (cols.length === 0) {
      say(`Table ${name} shares no column with the Dev database.`);
      return 2;
    }
    if (fromFile && cols.length < src.length) {
      say(`Table ${name} in the Dev database lacks columns of the original: ${src.filter((col) => !have.has(col)).join(", ")}. Give the app's schema these columns with the same names, run \`dkod-db.mjs migrate\`, then import again.`);
      return 2;
    }
    if (cols.length < src.length)
      droppedColumns[name] = src.filter((col) => !have.has(col));
    tables.push({ name, cols });
  }
  if (skippedTables.length > 0)
    say(`warning: these mapped tables are not in the original, so they were not imported: ${skippedTables.join(", ")}.`);
  for (const [n, cols] of Object.entries(droppedColumns))
    say(`warning: table ${n} has columns the Dev database lacks, so they were not imported: ${cols.join(", ")}.`);
  const ordered = copyPlan(tables.map((t) => t.name), edges);
  if (ordered.held.length > 0)
    say(cycleNote(ordered.held));
  const byName = new Map(tables.map((t) => [t.name, t]));
  const inOrder = ordered.order.map((n) => byName.get(n));
  const devHash = await c.psql(c.devUrl, c.devEnv, ["-f", "-"], `${PG_SETTINGS}
${inOrder.map(hashSql).join(`
`)}
`);
  const before = parseTallies(devHash.stdout);
  if (devHash.status !== 0 || before.length !== inOrder.length)
    return c.failed("Could not hash the Dev database's rows.", devHash.stderr);
  const occupied = inOrder.filter((_, i) => before[i].rows > 0);
  if (occupied.length > 0) {
    for (const t of occupied)
      say(`Dev table ${t.name} already has rows: import never overwrites. Drop and remake Dev, run db:migrate (its migrations must insert no rows of the original's tables) and import again. Never delete or edit Dev rows by hand.`);
    io.print(JSON.stringify({ ok: false, app, tables: inOrder.map((t, i) => ({ name: t.name, dev: before[i] })), imported: false }));
    return 1;
  }
  say(`warning: ${DEV_WARNING}`);
  let script = `${PG_SETTINGS}
${emptyGuard(inOrder)}${holdForeignKeys(ordered.held)}${holdTriggers(inOrder.map((t) => t.name))}`;
  const counts = [];
  for (const [i, t] of inOrder.entries()) {
    const { base } = sourceCols.get(t.name);
    const rows = await sqliteRows(io.run, c.baseEnv, base.base, t.name, t.cols, dir);
    if (!rows.ok)
      return cannot(rows.missing ? noBinary : `${rows.reason} (table ${t.name}). Run \`dkod-migrate.mjs snapshot\` again.`);
    counts.push(rows.value.length);
    const have = devCols.get(t.name);
    const temp = quoteIdent(`dkod_in_${i}`);
    const cols = t.cols.map(quoteIdent).join(", ");
    const dest = `public.${quoteIdent(t.name)}`;
    script += `CREATE TEMP TABLE ${temp} (${t.cols.map((col) => `${quoteIdent(col)} text`).join(", ")}) ON COMMIT DROP;
`;
    script += `COPY ${temp} (${cols}) FROM STDIN;
${copyText(rows.value)}\\.
`;
    script += `INSERT INTO ${dest} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${t.cols.map((col) => castExpr(col, have.get(col).type, have.get(col).udt)).join(", ")} FROM ${temp};
`;
  }
  script += restoreForeignKeys(ordered.held);
  script += restoreTriggers(inOrder.map((t) => t.name));
  script += sequenceResets(inOrder);
  script += `DO $$ BEGIN
${inOrder.map((t, i) => `IF (SELECT count(*) FROM public.${quoteIdent(t.name)}) <> ${counts[i]} THEN RAISE EXCEPTION 'dkod-import: table ${t.name.replace(/'/g, "''").replace(/%/g, "%%")} does not match the original'; END IF;`).join(`
`)}
END $$;
`;
  script += `${inOrder.map(hashSql).join(`
`)}
`;
  const devRun = await c.psql(c.devUrl, c.devEnv, ["--single-transaction", "-f", "-"], script);
  const actual = parseTallies(devRun.stdout);
  const report = inOrder.map((t, i) => ({ name: t.name, source: { rows: counts[i] }, dev: actual[i] ?? null, match: devRun.status === 0 && actual[i] !== undefined && actual[i].rows === counts[i] }));
  if (devRun.status !== 0 || !report.every((r) => r.match)) {
    if (devRun.status !== 0)
      say("Dev was rolled back: nothing was imported.");
    else
      say("The row counts could not be read or do not match. Dev may hold rows.");
    for (const l of safeErrors(devRun.stderr))
      io.print(l);
    io.print(JSON.stringify({ ok: false, app, tables: report, imported: false }));
    return 1;
  }
  const importedTables = {};
  inOrder.forEach((t, i) => {
    importedTables[t.name] = { cols: t.cols, rows: actual[i].rows, md5: actual[i].md5 };
  });
  await addRowHashes(importedTables, readFreezeData(io.readFile(join4(c.dir, ".dkod/parity/freeze.json")))?.suite_writes ?? [], c.devUrl, c.devEnv, io.run, c.dir);
  let record = null;
  try {
    record = JSON.parse(io.readFile(c.snapshotFile) ?? "null");
  } catch {}
  if (record && record.mode === "snapshot")
    io.writeFile(c.snapshotFile, `${JSON.stringify({ ...record, imported: true, imported_tables: importedTables, dev_url: c.devUrl }, null, 2)}
`);
  io.print(JSON.stringify({ ok: true, app, tables: report, already_present: [], imported: true, skipped_tables: skippedTables, dropped_columns: droppedColumns }));
  return 0;
}
function pickFlat(c) {
  const { io, say, dir } = c;
  const cannot = (why) => {
    say(`the original's data file cannot be imported: ${why}`);
    return 2;
  };
  for (const b of c.bases) {
    const got = io.sha256?.(b.base) ?? null;
    if (got === null)
      return cannot(`the snapshot's untouched base copy of ${b.rel} is gone. Run \`dkod-migrate.mjs snapshot\` again, rerun the suite and freeze again.`);
    if (got !== b.sha256) {
      say(`the base copy of ${b.rel} is not the data the suite was frozen on (its sha256 changed after the snapshot). Run \`dkod-migrate.mjs snapshot\` again, rerun the suite and freeze again.`);
      return 1;
    }
  }
  const mapped = readFlatMapTables(io.readFile(join4(dir, ".dkod/map/app-map.json")));
  const stem = (rel) => (rel.split("/").pop() ?? rel).replace(/\.[^.]*$/, "");
  const storeHit = (store, rel) => store !== null && (store === rel || rel.endsWith(`/${store}`) || store.endsWith(`/${rel}`));
  const picked = [];
  const skipped = [];
  for (const b of c.bases) {
    let table = mapped.find((t) => storeHit(t.store, b.rel))?.name ?? mapped.find((t) => t.name === stem(b.rel))?.name ?? (c.bases.length === 1 && mapped.length === 1 ? mapped[0].name : undefined);
    if (table === undefined && c.light && mapped.length === 0) {
      table = stem(b.rel);
      if (picked.some((p) => p.table === table)) {
        skipped.push(b.rel);
        continue;
      }
    }
    if (table === undefined) {
      if (b.found?.how === "code" || b.found?.how === "data-folder" || b.found?.how === "env") {
        skipped.push(b.rel);
        say(`warning: ${b.rel} was only guessed to be data and has no table in the migration map, so it was not imported.`);
        continue;
      }
      return cannot(`${b.rel} has no table in the migration map (.dkod/map/app-map.json): name the file as the table's store, or call the table ${stem(b.rel)}.`);
    }
    if (picked.some((p) => p.table === table))
      return cannot(`${b.rel} maps to table ${table}, which another data file already fills.`);
    const text = io.readFile(b.base);
    if (text === null)
      return cannot(`the snapshot's untouched base copy of ${b.rel} is gone. Run \`dkod-migrate.mjs snapshot\` again, rerun the suite and freeze again.`);
    const parsed = parseFlat(b.kind ?? "csv", text);
    if (!parsed.ok)
      return cannot(`${b.rel} has the wrong shape: ${parsed.reason}.`);
    picked.push({ base: b, table, cols: parsed.cols, rows: parsed.rows });
  }
  if (picked.length === 0)
    return cannot("no data file maps to a table in the migration map (.dkod/map/app-map.json).");
  return { picked, skipped };
}
async function importFlat(c, plan) {
  const { io, say, app } = c;
  const { picked, skipped } = plan;
  const names = picked.map((p) => p.table);
  const devColsRes = await c.psql(c.devUrl, c.devEnv, ["-c", `SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE' WHERE c.table_schema='public' AND c.is_generated='NEVER' AND c.table_name IN (${names.map(quoteLit).join(",")}) ORDER BY c.table_name, c.ordinal_position`]);
  if (devColsRes.status !== 0)
    return c.failed("Could not read the Dev database's tables.", devColsRes.stderr);
  const devCols = new Map;
  for (const l of devColsRes.stdout.split(`
`)) {
    const [t, col, type, udt, nullable] = l.split("\t");
    if (t && col && type && udt)
      devCols.set(t, (devCols.get(t) ?? new Map).set(col, { type, udt, notNull: nullable === "NO" }));
  }
  const tables = [];
  const keep = new Map;
  const droppedColumns = {};
  for (const p of picked) {
    const have = devCols.get(p.table);
    if (!have) {
      if (c.light) {
        skipped.push(p.base.rel);
        continue;
      }
      say(`Table ${p.table} (for ${p.base.rel}) is not in the Dev database. Run the app's db:migrate first.`);
      return 2;
    }
    const idx = p.cols.map((col, i) => have.has(col) ? i : -1).filter((i) => i >= 0);
    if (idx.length === 0) {
      say(`${p.base.rel} shares no column with Dev table ${p.table}.`);
      return 2;
    }
    if (idx.length < p.cols.length)
      droppedColumns[p.table] = p.cols.filter((col) => !have.has(col));
    keep.set(p.table, idx);
    tables.push({ name: p.table, cols: idx.map((i) => p.cols[i]) });
  }
  for (const [n, cols] of Object.entries(droppedColumns))
    say(`warning: ${n} has columns in the original's file that the Dev table lacks, so they were not imported: ${cols.join(", ")}.`);
  if (tables.length === 0) {
    say("No data file of the original has a table of its name in the Dev database: the files travel with the app's code, and there are no rows to import.");
    markImported(c);
    io.print(JSON.stringify({ ok: true, app, tables: [], already_present: [], imported: true, skipped_tables: skipped, dropped_columns: {} }));
    return 0;
  }
  const devHash = await c.psql(c.devUrl, c.devEnv, ["-f", "-"], `${PG_SETTINGS}
${tables.map(hashSql).join(`
`)}
`);
  const before = parseTallies(devHash.stdout);
  if (devHash.status !== 0 || before.length !== tables.length)
    return c.failed("Could not hash the Dev database's rows.", devHash.stderr);
  const occupied = tables.filter((_, i) => before[i].rows > 0);
  if (occupied.length > 0) {
    for (const t of occupied)
      say(`Dev table ${t.name} already has rows: import never overwrites. Drop and remake Dev, run db:migrate (its migrations must insert no rows of the original's tables) and import again. Never delete or edit Dev rows by hand.`);
    io.print(JSON.stringify({ ok: false, app, tables: tables.map((t, i) => ({ name: t.name, dev: before[i] })), imported: false }));
    return 1;
  }
  say(`warning: ${DEV_WARNING}`);
  let script = `${PG_SETTINGS}
${emptyGuard(tables)}${holdTriggers(tables.map((t) => t.name))}`;
  const counts = [];
  for (const [i, p] of picked.entries()) {
    const t = tables[i];
    const idx = keep.get(p.table);
    counts.push(p.rows.length);
    const have = devCols.get(p.table);
    const temp = quoteIdent(`dkod_in_${i}`);
    const cols = t.cols.map(quoteIdent).join(", ");
    script += `CREATE TEMP TABLE ${temp} (${t.cols.map((col) => `${quoteIdent(col)} text`).join(", ")}) ON COMMIT DROP;
`;
    script += `COPY ${temp} (${cols}) FROM STDIN;
${copyText(p.rows.map((r) => idx.map((j) => r[j] ?? null)))}\\.
`;
    script += `INSERT INTO public.${quoteIdent(t.name)} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${t.cols.map((col) => {
      const d = have.get(col);
      const e = castExpr(col, d.type, d.udt);
      return d.notNull && /^(text|character varying|character)$/.test(d.type) ? `COALESCE(${e}, '')` : e;
    }).join(", ")} FROM ${temp};
`;
  }
  script += restoreTriggers(tables.map((t) => t.name));
  script += sequenceResets(tables);
  script += `DO $$ BEGIN
${tables.map((t, i) => `IF (SELECT count(*) FROM public.${quoteIdent(t.name)}) <> ${counts[i]} THEN RAISE EXCEPTION 'dkod-import: table ${t.name.replace(/'/g, "''").replace(/%/g, "%%")} does not match the original'; END IF;`).join(`
`)}
END $$;
`;
  script += `${tables.map(hashSql).join(`
`)}
`;
  const devRun = await c.psql(c.devUrl, c.devEnv, ["--single-transaction", "-f", "-"], script);
  const actual = parseTallies(devRun.stdout);
  const report = tables.map((t, i) => ({ name: t.name, source: { rows: counts[i] }, dev: actual[i] ?? null, match: devRun.status === 0 && actual[i] !== undefined && actual[i].rows === counts[i] }));
  if (devRun.status !== 0 || !report.every((r) => r.match)) {
    if (devRun.status !== 0)
      say("Dev was rolled back: nothing was imported.");
    else
      say("The row counts could not be read or do not match. Dev may hold rows.");
    for (const l of safeErrors(devRun.stderr))
      io.print(l);
    io.print(JSON.stringify({ ok: false, app, tables: report, imported: false }));
    return 1;
  }
  const importedTables = {};
  tables.forEach((t, i) => {
    importedTables[t.name] = { cols: t.cols, rows: actual[i].rows, md5: actual[i].md5 };
  });
  await addRowHashes(importedTables, readFreezeData(io.readFile(join4(c.dir, ".dkod/parity/freeze.json")))?.suite_writes ?? [], c.devUrl, c.devEnv, io.run, c.dir);
  let record = null;
  try {
    record = JSON.parse(io.readFile(c.snapshotFile) ?? "null");
  } catch {}
  if (record && record.mode === "snapshot") {
    const prior = record.imported_tables ?? {};
    io.writeFile(c.snapshotFile, `${JSON.stringify({ ...record, imported: true, imported_tables: { ...prior, ...importedTables }, dev_url: c.devUrl }, null, 2)}
`);
  }
  io.print(JSON.stringify({ ok: true, app, tables: report, already_present: [], imported: true, skipped_tables: skipped, dropped_columns: droppedColumns }));
  return 0;
}
var MISSING_TABLES_STEP = "Add them to the app's migrations and run db:migrate, then run this again. When the app makes its own tables at start, start it once on Dev instead.";
function finishNoData(io, snapshotFile, app, devUrl, missing, say) {
  let record = null;
  try {
    record = JSON.parse(io.readFile(snapshotFile) ?? "null");
  } catch {}
  if (record && record.mode === "snapshot")
    io.writeFile(snapshotFile, `${JSON.stringify({ ...record, data_choice: "none", dev_url: devUrl }, null, 2)}
`);
  if (missing.length > 0)
    say(`warning: these tables of the original are not in the Dev database: ${missing.join(", ")}. ${MISSING_TABLES_STEP}`);
  io.print(JSON.stringify({ ok: true, app, imported: false, data: "none", missing_tables: missing }));
  return 0;
}
function originalOfRecord(text) {
  try {
    const o = JSON.parse(text ?? "null")?.original;
    return typeof o === "string" && o !== "" ? o.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}
function envValue(text, key) {
  for (const line of (text ?? "").split(`
`)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m !== null && m[1] === key)
      return m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return null;
}
async function runImport(flags, io, cwd) {
  const say = (line) => io.print(`dkod-db: ${line}`);
  const app = flags.get("app") ?? "";
  if (!DB_APP_KEY.test(app)) {
    say("Give the app's key with --app: lowercase letters, digits and dashes.");
    return 2;
  }
  const from = flags.get("from");
  if (!from) {
    say(`Give --from. ${IMPORT_LOCAL_ONLY}`);
    return 2;
  }
  const dir = flags.get("dir") ?? cwd;
  const refusal = originalFolderRefusal(dir, cwd, io.readFile);
  if (refusal) {
    say(refusal);
    return 2;
  }
  const snapshotFile = join4(dir, ".dkod/snapshot.json");
  const noData = flags.has("no-data");
  if (noData && flags.has("tables")) {
    say("Give --tables or --no-data, not both.");
    return 2;
  }
  const clearLinks = flags.has("clear-links");
  if (clearLinks && !flags.has("tables")) {
    say("--clear-links works with --tables only: it empties the links from the chosen tables to the tables left behind.");
    return 2;
  }
  let sourceRaw = from;
  let snapshotMode = false;
  let sqliteBases = null;
  let flatBases = [];
  let lightSource = false;
  let lightPassword = "";
  if (!/^postgres(ql)?:\/\//i.test(from)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(from) || from !== "snapshot" && !/\.json$/i.test(from)) {
      say(IMPORT_LOCAL_ONLY);
      return 2;
    }
    let rec = null;
    try {
      rec = JSON.parse(io.readFile(from === "snapshot" ? snapshotFile : /^([/\\]|[a-z]:[/\\])/i.test(from) ? from : join4(dir, from)) ?? "null");
    } catch {}
    if (from === "snapshot" && rec === null) {
      say("There is no .dkod/snapshot.json in this folder: something deleted it (a copy that deletes, such as `rsync --delete`). Run `node <dkod-migrate scripts>/dkod-migrate.mjs snapshot <this folder>` again, then import again. Never import from the original's live database instead.");
      return 2;
    }
    const r = rec;
    const dbs = r && r.mode === "snapshot" && Array.isArray(r.databases) ? r.databases : [];
    const pg = dbs.find((d) => typeof d.url === "string" && /^postgres(ql)?:\/\//i.test(d.url));
    if (!pg) {
      const bases = Array.isArray(r?.bases) ? r.bases.filter((b) => typeof b?.base === "string" && typeof b.rel === "string" && typeof b.sha256 === "string") : [];
      const hasSqlite = bases.length > 0 || Array.isArray(r?.files) && r.files.some((f) => typeof f === "string" && /\.(?:sqlite|sqlite3|db|db3)$/i.test(f));
      const noStore = r !== null && r.mode === "new-app-only" && r.needs_database === false;
      if (!hasSqlite && noStore) {
        say("no database needed, skipping import: the snapshot found no tables and no runtime data store.");
        io.print(JSON.stringify({ ok: true, app, imported: false, data: "none", needs_database: false }));
        return 0;
      }
      if (!hasSqlite && noData)
        return finishNoData(io, snapshotFile, app, "", [], say);
      if (!hasSqlite) {
        say(`The snapshot has no Postgres scratch database. ${IMPORT_LOCAL_ONLY}`);
        return 2;
      }
      if (bases.length === 0) {
        say("the original's data is in SQLite and cannot be imported: the snapshot was made by an older plugin and has no base copy. Run `dkod-migrate.mjs snapshot` again, rerun the suite and freeze again.");
        return 2;
      }
      flatBases = bases.filter((b) => b.kind === "csv" || b.kind === "json");
      const sqlite = bases.filter((b) => b.kind !== "csv" && b.kind !== "json");
      if (flatBases.length > 0 && sqlite.length === 0)
        sqliteBases = [];
      else
        sqliteBases = sqlite;
    }
    const base = pg?.base?.url;
    if (sqliteBases !== null)
      sourceRaw = "postgres://127.0.0.1/unused";
    else if (typeof base !== "string" || !/^postgres(ql)?:\/\//i.test(base)) {
      say("The snapshot has no untouched base copy (made by an older plugin). Run `dkod-migrate.mjs snapshot` again, rerun the suite on the original and freeze again.");
      return 2;
    } else
      sourceRaw = base;
    if (pg?.read_only === true) {
      lightSource = true;
      const file = typeof pg.source?.file === "string" ? pg.source.file : "";
      const key = typeof pg.source?.key === "string" ? pg.source.key : "DATABASE_URL";
      const original = originalOfRecord(io.readFile(join4(dir, ".dkod/migration.json"))) ?? (typeof r?.original === "string" && r.original !== "" ? r.original : null);
      if (original !== null && file !== "" && !file.split("/").includes("..")) {
        const named = envValue(io.readFile(join4(original, file)), key);
        try {
          const u = named === null ? null : new URL(named);
          const b = new URL(String(base));
          if (u !== null && u.hostname === b.hostname && (u.port || "5432") === (b.port || "5432") && u.pathname === b.pathname && u.password !== "")
            lightPassword = decodeURIComponent(u.password);
        } catch {}
      }
    }
    snapshotMode = true;
  }
  let source;
  try {
    source = new URL(sourceRaw);
  } catch {
    say(IMPORT_LOCAL_ONLY);
    return 2;
  }
  if (!LOCAL_HOSTS.includes(source.hostname)) {
    say(IMPORT_LOCAL_ONLY);
    return 2;
  }
  let sourcePassword = source.password;
  try {
    sourcePassword = decodeURIComponent(sourcePassword);
  } catch {
    say(`The source password has a malformed percent escape. ${IMPORT_LOCAL_ONLY}`);
    return 2;
  }
  const password = sourcePassword || lightPassword || io.env.PGPASSWORD || "";
  source.password = "";
  const sourceUrl = source.toString();
  const devRaw = readDatabaseUrl(io.readFile(join4(dir, ".env.local")));
  if (!devRaw) {
    say("There is no DATABASE_URL in .env.local. Run `node dkod-db.mjs up --app <app key>` first, in the background.");
    return 2;
  }
  let dev;
  try {
    dev = new URL(devRaw);
  } catch {
    say("DATABASE_URL in .env.local is not a URL. Run `node dkod-db.mjs up --app <app key>` first, in the background.");
    return 2;
  }
  const port = portOf(flags.get("port"), Number(dev.port) || DEFAULT_PORT);
  if (port === null) {
    say("--port must be a number from 0 to 65535.");
    return 2;
  }
  if (!await probe(port)) {
    say("The Dev database is not up. Run `node dkod-db.mjs up --app <app key>` first, in the background.");
    return 2;
  }
  dev.port = String(port);
  dev.password = "";
  const devUrl = dev.toString();
  const freezeText = io.readFile(join4(dir, ".dkod/parity/freeze.json"));
  if (freezeText === null && !lightSource && sqliteBases === null) {
    say("There is no .dkod/parity/freeze.json. Freeze the parity suite (step 3 of the dkod-migrate skill) before the import.");
    return 2;
  }
  const light = freezeText === null;
  const baseEnv = { ...PG_TIMEOUT };
  for (const name of ["PATH", "HOME", "USER", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot", "LANG"])
    if (io.env[name] !== undefined)
      baseEnv[name] = io.env[name];
  const srcEnv = password ? { ...baseEnv, PGPASSWORD: password } : baseEnv;
  const devEnv = { ...baseEnv, PGSSLMODE: "disable" };
  const psql = async (url, env, extra, input) => {
    const res = await io.run("psql", ["-w", "-X", "-q", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "--dbname", url, ...extra], env, dir, input);
    if (res.status !== 127 || io.pg === undefined)
      return res;
    const alt = await io.pg(url, env, extra, input);
    return alt.status === 0 ? alt : { ...alt, stderr: `${res.stderr}${alt.stderr}` };
  };
  const failed = (what, stderr) => {
    if (isNoPassword(stderr)) {
      say(NO_PASSWORD);
      return 1;
    }
    say(what);
    for (const l of safeErrors(stderr))
      io.print(l);
    return 1;
  };
  if (sqliteBases !== null) {
    if (noData)
      return finishNoData(io, snapshotFile, app, devUrl, [], say);
    if (flags.has("tables")) {
      say("--tables works for a Postgres original only. This original keeps its data in files: import all of it (no --tables), or none of it (--no-data).");
      return 2;
    }
    if (light && sqliteBases.length > 0 && flatBases.length > 0) {
      say(`warning: these files were not imported, the app's data is in its SQLite file: ${flatBases.map((b) => b.rel).join(", ")}.`);
      flatBases = [];
    }
    const ctx = { app, dir, io, say, baseEnv, devUrl, devEnv, bases: sqliteBases, light, snapshotFile, psql, failed };
    const flatCtx = { ...ctx, bases: flatBases };
    const plan = flatBases.length > 0 ? pickFlat(flatCtx) : null;
    if (typeof plan === "number")
      return plan;
    if (sqliteBases.length > 0 && plan !== null) {
      say("the original keeps data in both SQLite and CSV/JSON files: import cannot load both in one transaction. Keep one kind of data file in the original and snapshot again.");
      return 2;
    }
    if (sqliteBases.length > 0)
      return await importSqlite(ctx);
    return await importFlat(flatCtx, plan);
  }
  const frozenData = freezeText === null ? { tables: {}, suite_writes: [] } : readFreezeData(freezeText);
  if (frozenData === null) {
    say("freeze.json records no data identity (no Postgres scratch database was frozen on). Run `dkod-migrate.mjs snapshot`, rerun the suite and freeze again.");
    return 1;
  }
  let mapped = readMapTables(io.readFile(join4(dir, ".dkod/map/app-map.json")));
  if (mapped.length === 0 && lightSource) {
    const all = await psql(sourceUrl, srcEnv, ["-c", "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"]);
    if (all.status !== 0)
      return failed("Could not read the original's tables.", all.stderr);
    mapped = all.stdout.split(`
`).map((l) => l.trim()).filter((l) => l !== "" && !LIGHT_SKIP_TABLES.test(l));
  }
  if (mapped.length === 0 && noData)
    return finishNoData(io, snapshotFile, app, devUrl, [], say);
  if (mapped.length === 0) {
    say("The migration map has no tables to import (.dkod/map/app-map.json).");
    return 2;
  }
  const only = flags.get("tables");
  const want = only === undefined ? null : only.split(",").map((n) => n.trim()).filter((n) => n !== "");
  if (want !== null) {
    const unknown = want.filter((n) => !mapped.includes(n));
    if (want.length === 0 || unknown.length > 0) {
      say(`--tables takes the original's table names with commas between them${unknown.length > 0 ? `; it does not have: ${unknown.join(", ")}` : ""}. Its tables: ${mapped.join(", ")}.`);
      return 2;
    }
  }
  const colsQuery = (names) => `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE' WHERE c.table_schema='public' AND c.is_generated='NEVER' AND c.table_name IN (${names.map(quoteLit).join(",")}) ORDER BY c.table_name, c.ordinal_position`;
  const readCols = (stdout) => {
    const m = new Map;
    for (const l of stdout.split(`
`)) {
      const [t, c] = l.split("\t");
      if (t && c)
        m.set(t, [...m.get(t) ?? [], c]);
    }
    return m;
  };
  const srcCols = await psql(sourceUrl, srcEnv, ["-c", colsQuery(mapped)]);
  if (srcCols.status !== 0)
    return failed("Could not read the original's tables.", srcCols.stderr);
  const sourceCols = readCols(srcCols.stdout);
  const checked = Object.keys(frozenData.tables).filter((n) => snapshotMode || !frozenData.suite_writes.includes(n));
  const frozenRefs = checked.filter((n) => sourceCols.has(n)).map((name) => ({ name, cols: sourceCols.get(name) }));
  const sourceNow = await tallies(sourceUrl, frozenRefs, srcEnv, io.run, dir);
  if (sourceNow === null)
    return failed("Could not hash the original's rows.", "");
  const unlike = changedTables(Object.fromEntries(checked.map((n) => [n, frozenData.tables[n]])), sourceNow);
  if (unlike.length > 0) {
    for (const n of unlike)
      say(`the --from source is not the data the suite was frozen on: ${n} (${sourceNow[n] === undefined ? "missing" : `${String(sourceNow[n].rows)} rows`}, frozen on ${String(frozenData.tables[n].rows)})`);
    io.print(JSON.stringify({ ok: false, app, tables: unlike.map((n) => ({ name: n, source: sourceNow[n] ?? null, frozen: frozenData.tables[n] })), imported: false }));
    return 1;
  }
  const present = mapped.filter((t) => sourceCols.has(t));
  const skippedTables = mapped.filter((t) => !sourceCols.has(t));
  const droppedColumns = {};
  if (present.length === 0) {
    say("None of the map's tables is in the original's public schema. Nothing to import.");
    return 2;
  }
  const devCols = await psql(devUrl, devEnv, ["-c", colsQuery(present)]);
  if (devCols.status !== 0)
    return failed("Could not read the Dev database's tables.", devCols.stderr);
  const devCols2 = readCols(devCols.stdout);
  const missing = present.filter((n) => !devCols2.has(n) && (noData || want !== null && !want.includes(n)));
  if (noData)
    return finishNoData(io, snapshotFile, app, devUrl, missing, say);
  if (missing.length > 0)
    say(`warning: these tables of the original are not in the Dev database, and get no rows: ${missing.join(", ")}. ${MISSING_TABLES_STEP}`);
  const tables = [];
  for (const name of present) {
    if (want !== null && !want.includes(name))
      continue;
    const have = devCols2.get(name);
    if (!have) {
      say(`Table ${name} is not in the Dev database. Run the app's db:migrate first.`);
      return 2;
    }
    const cols = sourceCols.get(name).filter((c) => have.includes(c));
    if (cols.length === 0) {
      say(`Table ${name} shares no column with the Dev database.`);
      return 2;
    }
    const dropped = sourceCols.get(name).filter((c) => !have.includes(c));
    if (dropped.length > 0)
      droppedColumns[name] = dropped;
    tables.push({ name, cols });
  }
  if (skippedTables.length > 0)
    say(`warning: these mapped tables are not in the original, so they were not imported: ${skippedTables.join(", ")}.`);
  for (const [n, c] of Object.entries(droppedColumns))
    say(`warning: table ${n} has columns the Dev database lacks, so they were not imported: ${c.join(", ")}.`);
  const edgesRes = await psql(sourceUrl, srcEnv, ["-c", "SELECT cl.relname, pl.relname FROM pg_constraint k JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace JOIN pg_class pl ON pl.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pl.relnamespace WHERE k.contype='f' AND n.nspname='public' AND pn.nspname='public'"]);
  if (edgesRes.status !== 0)
    return failed("Could not read the original's foreign keys.", edgesRes.stderr);
  const edges = edgesRes.stdout.split(`
`).map((l) => l.split("\t")).filter((p) => p.length === 2).map(([child, parent]) => ({ child, parent }));
  const cleared = {};
  if (clearLinks) {
    const fkRes = await psql(sourceUrl, srcEnv, ["-c", "SELECT cl.relname, pl.relname, string_agg(a.attname, ',' ORDER BY a.attnum), bool_and(NOT a.attnotnull) FROM pg_constraint k JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace JOIN pg_class pl ON pl.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pl.relnamespace JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum = ANY(k.conkey) WHERE k.contype='f' AND n.nspname='public' AND pn.nspname='public' GROUP BY k.oid, cl.relname, pl.relname"]);
    if (fkRes.status !== 0)
      return failed("Could not read the original's foreign keys.", fkRes.stderr);
    const needed = [];
    for (const [child, parent, cols, nullable] of fkRes.stdout.split(`
`).map((l) => l.split("\t")).filter((p) => p.length === 4)) {
      const t = tables.find((x) => x.name === child);
      if (!t || want.includes(parent))
        continue;
      const own = cols.split(",").filter((c) => t.cols.includes(c));
      if (own.length === 0)
        continue;
      if (nullable !== "t") {
        needed.push(`${child}.${own.join(",")} -> ${parent}`);
        continue;
      }
      cleared[child] = [...new Set([...cleared[child] ?? [], ...own])];
    }
    if (needed.length > 0) {
      say(`These links may not be empty, so --clear-links cannot clear them: ${needed.join(", ")}. Add those parent tables to --tables, or leave the child tables out.`);
      return 2;
    }
    for (const [n, c] of Object.entries(cleared))
      say(`--clear-links: table ${n} is imported with these links empty: ${c.join(", ")}.`);
  }
  const ordered = copyPlan(tables.map((t) => t.name), edges);
  const byName = new Map(tables.map((t) => [t.name, t]));
  const inOrder = ordered.order.map((n) => byName.get(n));
  const sourceSelect = (t) => t.cols.map((c) => cleared[t.name]?.includes(c) ? `NULL AS ${quoteIdent(c)}` : quoteIdent(c)).join(", ");
  const srcHash = await psql(sourceUrl, srcEnv, ["-f", "-"], `${PG_SETTINGS}
${inOrder.map((t) => hashSql(t).replace(`(SELECT ${t.cols.map(quoteIdent).join(", ")} FROM`, `(SELECT ${sourceSelect(t)} FROM`)).join(`
`)}
`);
  if (srcHash.status !== 0)
    return failed("Could not hash the original's rows.", srcHash.stderr);
  const expected = parseTallies(srcHash.stdout);
  if (expected.length !== inOrder.length)
    return failed("Could not hash the original's rows.", srcHash.stderr);
  const devHash = await psql(devUrl, devEnv, ["-f", "-"], `${PG_SETTINGS}
${inOrder.map(hashSql).join(`
`)}
`);
  const before = parseTallies(devHash.stdout);
  if (devHash.status !== 0 || before.length !== inOrder.length)
    return failed("Could not hash the Dev database's rows.", devHash.stderr);
  const alreadyPresent = [];
  const toCopy = [];
  const differing = [];
  inOrder.forEach((t, i) => {
    const b = before[i];
    if (b.rows === 0)
      toCopy.push(t);
    else if (b.rows === expected[i].rows && b.md5 === expected[i].md5)
      alreadyPresent.push(t.name);
    else
      differing.push(t.name);
  });
  if (differing.length > 0) {
    const others = await psql(devUrl, devEnv, ["-c", "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"]);
    const count = others.status === 0 ? Number.parseInt(others.stdout.trim(), 10) : 0;
    if (Number.isFinite(count) && count > 0)
      say(`Dev has ${count} other open ${count === 1 ? "connection" : "connections"} now: another program on this computer (an older copy of the app, a dev server or a worker) can write into Dev through port ${port}, and the rows below can be its rows, not the migrations'. Find it with \`lsof -nP -iTCP:${port} -sTCP:ESTABLISHED\`, stop it, then drop and remake Dev, run db:migrate and import again.`);
    for (const n of differing)
      say(`Dev table ${n} already has rows that differ from the original's: the dk- app's own migrations insert rows in ${n} that differ from the original's. Change those migrations to insert exactly the original's rows (or none), then drop and remake Dev, run db:migrate and import again. Never delete or edit Dev rows by hand; import never overwrites.`);
    const refused = inOrder.map((t, i) => ({ name: t.name, source: expected[i], dev: before[i], match: before[i].rows === expected[i].rows && before[i].md5 === expected[i].md5 }));
    io.print(JSON.stringify({ ok: false, app, tables: refused, already_present: alreadyPresent, imported: false }));
    return 1;
  }
  say(`warning: ${DEV_WARNING}`);
  if (alreadyPresent.length > 0)
    say(`these tables already hold the original's rows, so they were not copied: ${alreadyPresent.join(", ")}.`);
  const held = ordered.held.filter((n) => toCopy.some((t) => t.name === n));
  if (held.length > 0)
    say(cycleNote(held));
  let script = `${PG_SETTINGS}
`;
  script += emptyGuard(toCopy);
  script += holdForeignKeys(held);
  script += holdTriggers(toCopy.map((t) => t.name));
  for (const t of toCopy) {
    const cols = t.cols.map(quoteIdent).join(", ");
    const data = await psql(sourceUrl, srcEnv, ["-c", PG_SETTINGS, "-c", `COPY (SELECT ${sourceSelect(t)} FROM public.${quoteIdent(t.name)}) TO STDOUT`]);
    if (data.status !== 0)
      return failed(`Could not read table ${t.name} from the original.`, data.stderr);
    script += `COPY public.${quoteIdent(t.name)} (${cols}) FROM STDIN;
${data.stdout}${data.stdout === "" || data.stdout.endsWith(`
`) ? "" : `
`}\\.
`;
  }
  script += restoreForeignKeys(held);
  script += restoreTriggers(toCopy.map((t) => t.name));
  script += sequenceResets(inOrder);
  script += `${inOrder.map(hashSql).join(`
`)}
`;
  script += `DO $$ DECLARE got record; BEGIN
${inOrder.map((t, i) => `SELECT count(*) AS n, md5(coalesce(string_agg(convert_to(r::text,'UTF8'), '\\x0a'::bytea ORDER BY convert_to(r::text,'UTF8')), ''::bytea)) AS h INTO got FROM (SELECT ${t.cols.map(quoteIdent).join(", ")} FROM public.${quoteIdent(t.name)}) r;
IF got.n <> ${expected[i].rows} OR got.h <> ${quoteLit(expected[i].md5)} THEN RAISE EXCEPTION 'dkod-import: table ${t.name.replace(/'/g, "''").replace(/%/g, "%%")} does not match the original'; END IF;`).join(`
`)}
END $$;
`;
  const devRun = await psql(devUrl, devEnv, ["--single-transaction", "-f", "-"], script);
  const actual = parseTallies(devRun.stdout);
  const report = inOrder.map((t, i) => {
    const d = actual[i] ?? null;
    return { name: t.name, source: expected[i], dev: d, match: devRun.status === 0 && d !== null && d.rows === expected[i].rows && d.md5 === expected[i].md5 };
  });
  const ok = devRun.status === 0 && report.every((r) => r.match);
  if (!ok) {
    if (devRun.status !== 0)
      say("Dev was rolled back: nothing was imported.");
    else
      say("The row counts and hashes could not be read or do not match. Dev may hold rows.");
    if (devRun.status !== 0 && want !== null) {
      const all = new Set(want);
      const cut = [];
      for (let grew = true;grew; ) {
        grew = false;
        for (const e of edges)
          if (all.has(e.child) && !all.has(e.parent) && present.includes(e.parent)) {
            all.add(e.parent);
            cut.push(`${e.child} -> ${e.parent}`);
            grew = true;
          }
      }
      if (cut.length > 0)
        say(`These chosen tables have rows that point at tables that were not chosen (${cut.join(", ")}). Run the import again with --tables ${[...all].join(",")}, or keep them out and run again with --tables ${want.join(",")} --clear-links: the links to them are imported empty.`);
    }
    for (const l of safeErrors(devRun.stderr))
      io.print(l);
    io.print(JSON.stringify({ ok: false, app, tables: report, already_present: alreadyPresent, imported: false }));
    return 1;
  }
  const importedTables = {};
  inOrder.forEach((t, i) => {
    importedTables[t.name] = { cols: t.cols, rows: report[i].dev.rows, md5: report[i].dev.md5 };
  });
  await addRowHashes(importedTables, frozenData.suite_writes, devUrl, devEnv, io.run, dir);
  const marks = { imported: true, data_choice: want === null ? "all" : "tables", imported_tables: importedTables, dev_url: devUrl, ...clearLinks ? { cleared_links: cleared } : {} };
  let record = null;
  try {
    record = JSON.parse(io.readFile(snapshotFile) ?? "null");
  } catch {}
  if (record && record.mode === "snapshot")
    io.writeFile(snapshotFile, `${JSON.stringify({ ...record, ...marks }, null, 2)}
`);
  else if (!snapshotMode && record === null) {
    const base = { ok: true, mode: "snapshot", scratch: "", files: [], databases: [], env: {} };
    const nonce = randomBytes2(16).toString("hex");
    io.writeFile(snapshotFile, `${JSON.stringify({ ...base, ...marks, nonce, seal: sealOf(base, nonce) }, null, 2)}
`);
  }
  io.print(JSON.stringify({ ok: true, app, tables: report, already_present: alreadyPresent, imported: true, skipped_tables: skippedTables, dropped_columns: droppedColumns, ...clearLinks ? { cleared_links: cleared } : {} }));
  return 0;
}
function statePaths(io, dir) {
  const resolved = resolvePath(dir);
  const base = join4(io.stateDir(), `dkod-db-${createHash4("sha256").update(resolved).digest("hex").slice(0, 16)}`);
  return { state: `${base}.json`, log: `${base}.log`, dir: resolved };
}
function readState(io, path) {
  try {
    const parsed = JSON.parse(io.readFile(path) ?? "null");
    return parsed && typeof parsed.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}
var sleep2 = (io, ms) => new Promise((resolve) => {
  io.schedule(ms, resolve);
});
var POLL_MS = 250;
var READY_LINE = /Dev database on 127\.0\.0\.1:(\d+)/;
async function isOurTunnel(io, state) {
  return io.alive(state.pid) && state.port !== undefined && await probe(state.port);
}
async function liveTunnels(io) {
  const live = [];
  for (const path of io.listStates()) {
    const state = readState(io, path);
    if (state && await isOurTunnel(io, state))
      live.push({ path, state });
    else
      io.remove(path);
  }
  return live;
}
var describeTunnel = (t) => ({ app: t.app, pid: t.pid, port: t.port, dir: t.dir });
async function stopTunnel(io, state) {
  io.kill(state.pid, "SIGTERM");
  for (let waited = 0;waited < 5000; waited += POLL_MS) {
    if (!io.alive(state.pid) && (state.port === undefined || !await probe(state.port)))
      break;
    await sleep2(io, POLL_MS);
  }
  if (io.alive(state.pid))
    io.kill(state.pid, "SIGKILL");
}
async function runUpDetached(flags, io) {
  const app = flags.get("app") ?? "";
  const paths = statePaths(io, flags.get("dir") ?? io.cwd);
  const say = (sentence) => io.print(`dkod-db: ${sentence}`);
  if (!DB_APP_KEY.test(app)) {
    say("Give the app's key with --app: lowercase letters, digits and dashes.");
    return 2;
  }
  const refusal = originalFolderRefusal(flags.get("dir") ?? io.cwd, io.cwd, io.readFile);
  if (refusal) {
    say(refusal);
    return 2;
  }
  const waitRaw = flags.get("wait");
  if (waitRaw !== undefined && !/^\d{1,6}$/.test(waitRaw)) {
    say("--wait must be a number of seconds.");
    return 2;
  }
  const waitMs = waitRaw === undefined ? WAIT_LIMIT_MS : Number(waitRaw) * 1000;
  const old = readState(io, paths.state);
  if (old && await isOurTunnel(io, old)) {
    const wantedPort = flags.get("port");
    if (old.app === app && (wantedPort === undefined || Number(wantedPort) === 0 || Number(wantedPort) === old.port)) {
      io.print(JSON.stringify({ ok: true, app: old.app, port: old.port, pid: old.pid, log: old.log }));
      return 0;
    }
    await stopTunnel(io, old);
  }
  io.remove(paths.state);
  const wanted = portOf(flags.get("port"), DEFAULT_PORT);
  if (wanted !== null && wanted !== 0) {
    const holder = (await liveTunnels(io)).find((t) => t.path !== paths.state && t.state.port === wanted);
    if (holder) {
      const h = holder.state;
      say(`Port ${wanted} is held by the dkod-db tunnel for app ${h.app} (pid ${h.pid}) started in ${h.dir}. Stop it with: node dkod-db.mjs down --app ${h.app} (or down --dir ${h.dir}, or down --all), then run this again.`);
      return 3;
    }
  }
  const args = ["up"];
  for (const [name, value] of flags)
    if (name !== "detach")
      args.push(`--${name}`, value);
  if (!flags.has("dir"))
    args.push("--dir", paths.dir);
  const pid = io.spawnDetached(args, paths.log);
  io.writeFile(paths.state, JSON.stringify({ pid, app, dir: paths.dir, log: paths.log }));
  const startedAt = io.now();
  for (;; ) {
    await sleep2(io, POLL_MS);
    const log = io.readFile(paths.log) ?? "";
    const port = Number(READY_LINE.exec(log)?.[1] ?? 0);
    if (port > 0 && readDatabaseUrl(io.readFile(join4(paths.dir, ".env.local"))) !== null && await probe(port)) {
      io.writeFile(paths.state, JSON.stringify({ pid, app, dir: paths.dir, log: paths.log, port }));
      io.print(JSON.stringify({ ok: true, app, port, pid, log: paths.log }));
      return 0;
    }
    if (!io.alive(pid)) {
      const last = (io.readFile(paths.log) ?? log).split(`
`).filter((l) => l.startsWith("dkod-db:")).pop();
      io.print(last ?? "dkod-db: The Dev database tunnel stopped before it answered.");
      io.remove(paths.state);
      return 1;
    }
    if (io.now() - startedAt > waitMs + 5000) {
      io.kill(pid, "SIGTERM");
      io.remove(paths.state);
      say(`The Dev database did not answer within ${Math.round(waitMs / 1000)} s, so the tunnel was stopped. Run this again.`);
      return 1;
    }
  }
}
async function runDown(flags, io) {
  if (flags.has("app") && flags.has("dir")) {
    io.print("dkod-db: Pass either --app or --dir, not both.");
    return 2;
  }
  if (flags.has("app") && flags.has("all")) {
    io.print("dkod-db: Pass either --app or --all, not both.");
    return 2;
  }
  if (flags.has("app")) {
    const app = flags.get("app") ?? "";
    if (!DB_APP_KEY.test(app)) {
      io.print("dkod-db: Give the app's key with --app: lowercase letters, digits and dashes.");
      return 2;
    }
    const matched = (await liveTunnels(io)).filter((t) => t.state.app === app);
    for (const t of matched) {
      await stopTunnel(io, t.state);
      io.remove(t.path);
    }
    io.print(JSON.stringify({ ok: true, stopped: matched.length > 0, app, tunnels: matched.map((t) => describeTunnel(t.state)) }));
    return 0;
  }
  if (flags.has("all")) {
    const live = await liveTunnels(io);
    for (const t of live)
      await stopTunnel(io, t.state);
    for (const path of io.listStates())
      io.remove(path);
    io.print(JSON.stringify({ ok: true, stopped: live.length > 0, tunnels: live.map((t) => describeTunnel(t.state)) }));
    return 0;
  }
  const paths = statePaths(io, flags.get("dir") ?? io.cwd);
  const state = readState(io, paths.state);
  if (!state || !await isOurTunnel(io, state)) {
    io.remove(paths.state);
    const others = (await liveTunnels(io)).filter((t) => t.path !== paths.state).map((t) => describeTunnel(t.state));
    io.print(JSON.stringify({ ok: true, stopped: false, ...others.length > 0 ? { others } : {} }));
    return 0;
  }
  await stopTunnel(io, state);
  io.remove(paths.state);
  io.print(JSON.stringify({ ok: true, stopped: true, ...state.port === undefined ? {} : { port: state.port } }));
  return 0;
}
async function runDbCli(argv, io) {
  const args = parseArgs(argv);
  if ("error" in args) {
    if (args.error !== "usage")
      io.print(`dkod-db: ${args.error}`);
    io.print(USAGE);
    return 2;
  }
  switch (args.command) {
    case "up": {
      if (args.flags.has("detach")) {
        const code = args.flags.get("code");
        if (code !== undefined) {
          const dashboardUrl = dashboardFor(args.flags.get("dashboard"), io);
          if (!dashboardUrl) {
            io.print("dkod-db: --dashboard must be the https address of the DKOD dashboard.");
            return 2;
          }
          const got = await connectWithCode(code, dashboardUrl, io);
          if (typeof got === "string") {
            io.print(`dkod-db: ${got}`);
            return 2;
          }
          args.flags.delete("code");
          args.flags.delete("dashboard");
        }
        return await runUpDetached(args.flags, io);
      }
      const started = await startUp(args.flags, io, io.cwd);
      if ("exit" in started)
        return started.exit;
      await new Promise((resolve) => io.onStop(resolve));
      await started.handle.stop();
      return 0;
    }
    case "down":
      return await runDown(args.flags, io);
    case "files":
      return await runFiles(args.flags, io, io.cwd);
    case "migrate":
      return await runMigrate(args.flags, io, io.cwd, io.exists);
    case "explain":
      io.print("dkod-db: explain is coming in DKO-1052");
      return 2;
    case "detect": {
      const dir = resolvePath(io.cwd, args.flags.get("dir") ?? ".");
      io.print(JSON.stringify(detectDatabase(dir, { readFile: io.readFile, listDir: io.listDir ?? (() => []) })));
      return 0;
    }
    default:
      return await runImport(args.flags, io, io.cwd);
  }
}

import { spawn } from "node:child_process";
function runProcess(cmd, args, env, cwd, input) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, cwd, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (e) => resolve({ status: 127, stdout, stderr: `${stderr}Could not start ${cmd} (${e.code ?? e.message}).
` }));
    child.on("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/index.js
import os from "node:os";
import fs2 from "node:fs";

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/errors.js
class PostgresError extends Error {
  constructor(x) {
    super(typeof x === "string" ? x : x && x.message);
    this.name = this.constructor.name;
    x && typeof x === "object" && Object.assign(this, x);
  }
  toJSON() {
    return { ...this, message: this.message };
  }
}
var Errors = {
  connection,
  postgres,
  generic,
  notSupported
};
function connection(code, options, host, port) {
  const address = options.path || host, error = Object.assign(new Error("write " + code + " " + (options.path || host + ":" + port)), { code, errno: code, address }, options.path ? {} : { port });
  Error.captureStackTrace(error, connection);
  return error;
}
function postgres(x) {
  const error = new PostgresError(x);
  Error.captureStackTrace(error, postgres);
  return error;
}
function generic(code, message) {
  const error = Object.assign(new Error(code + ": " + message), { code });
  Error.captureStackTrace(error, generic);
  return error;
}
function notSupported(x) {
  const error = Object.assign(new Error(x + " (B) is not supported"), { code: "MESSAGE_NOT_SUPPORTED", name: x });
  Error.captureStackTrace(error, notSupported);
  return error;
}
var places = locations();
var ours = (line) => places.some((here) => line.includes(here) && !line.slice(line.indexOf(here) + here.length).split(":")[0].includes("/"));
function locations() {
  try {
    const url = new URL(".", import.meta.url);
    return url.protocol === "file:" ? [url.href, decodeURIComponent(url.pathname)] : [url.href];
  } catch (error) {
    return [];
  }
}
function withOrigin(error, origin) {
  origin && Object.defineProperty(error, "stack", {
    value: [firstLine(error), ...origin.split(`
`).slice(1).filter((x) => !ours(x))].join(`
`),
    writable: true,
    configurable: true,
    enumerable: false
  });
  return error;
}
function firstLine(error) {
  return typeof error.stack === "string" ? error.stack.split(`
`)[0] : (error.name || "Error") + (error.message ? ": " + error.message : "");
}
function queryError(error, q, debug) {
  if (!error || typeof error !== "object")
    error = new Error(error);
  if (!q || "query" in error)
    return error;
  const built = q.built;
  Object.defineProperties(error, {
    query: { value: built ? built.text : q.strings[0], enumerable: !!debug, configurable: true, writable: true },
    parameters: { value: built ? built.values : [], enumerable: !!debug, configurable: true, writable: true },
    args: { value: q.args, enumerable: !!debug, configurable: true, writable: true },
    types: { value: built ? built.oids : [], enumerable: !!debug, configurable: true, writable: true }
  });
  return withOrigin(error, q.origin);
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/types.js
var number = (x) => +x;
var bool = (x) => x === "t";
var json2 = (x) => JSON.parse(x);
var string = (x) => x instanceof Date ? serializeDate(x) : Array.isArray(x) ? serializeArray(x, string) : literal(x) ? JSON.stringify(x) : "" + x;
var literal = (x) => x !== null && typeof x === "object" && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
var arrays = {
  16: 1000,
  17: 1001,
  18: 1002,
  19: 1003,
  20: 1016,
  21: 1005,
  22: 1006,
  23: 1007,
  24: 1008,
  25: 1009,
  26: 1028,
  27: 1010,
  28: 1011,
  29: 1012,
  30: 1013,
  114: 199,
  142: 143,
  600: 1017,
  601: 1018,
  602: 1019,
  603: 1020,
  604: 1027,
  628: 629,
  650: 651,
  700: 1021,
  701: 1022,
  718: 719,
  774: 775,
  790: 791,
  829: 1040,
  869: 1041,
  1033: 1034,
  1042: 1014,
  1043: 1015,
  1082: 1182,
  1083: 1183,
  1114: 1115,
  1184: 1185,
  1186: 1187,
  1266: 1270,
  1560: 1561,
  1562: 1563,
  1700: 1231,
  1790: 2201,
  2202: 2207,
  2203: 2208,
  2204: 2209,
  2205: 2210,
  2206: 2211,
  2249: 2287,
  2275: 1263,
  2950: 2951,
  2970: 2949,
  3220: 3221,
  3614: 3643,
  3615: 3645,
  3734: 3735,
  3769: 3770,
  3802: 3807,
  3904: 3905,
  3906: 3907,
  3908: 3909,
  3910: 3911,
  3912: 3913,
  3926: 3927,
  4072: 4073,
  4089: 4090,
  4096: 4097,
  5038: 5039,
  5069: 271
};
var types = {
  string: { to: 25, from: null, serialize: string },
  number: { to: 0, from: [21, 23, 26, 700, 701], serialize: string, parse: number },
  json: { to: 114, from: [114, 3802], serialize: (x) => JSON.stringify(x), parse: json2 },
  boolean: { to: 16, from: [16], serialize: (x) => x === true ? "t" : "f", parse: bool },
  date: { to: 1184, from: [1082, 1114, 1184], serialize: serializeDate, parse: null },
  bytea: { to: 17, from: [17], serialize: (x) => "\\x" + Buffer.from(x).toString("hex"), parse: (x) => Buffer.from(x.slice(2), "hex") }
};
var dates = { 1082: parseDate, 1114: parseTimestamp, 1184: parseTimestamptz };
var elementsOf = { 1000: 16, 1005: 21, 1007: 23, 1016: 20 };
var readers = {
  16: binaryArray((x, i) => x[i] === 1),
  21: binaryArray((x, i) => (x[i] << 24 | x[i + 1] << 16) >> 16),
  23: binaryArray((x, i) => x[i] << 24 | x[i + 1] << 16 | x[i + 2] << 8 | x[i + 3]),
  20: binaryArray((x, i) => x.readBigInt64BE(i).toString())
};
function bytes(x, i, end) {
  return Buffer.from(x.subarray(i, end));
}
function binaryArray(read) {
  return function(x, i) {
    const dims = int32(x, i);
    if (dims === 0)
      return [];
    const sizes = new Array(dims);
    for (let d = 0;d < dims; d++)
      sizes[d] = int32(x, i + 12 + d * 8);
    let at = i + 12 + dims * 8;
    return level(0);
    function level(d) {
      const n = sizes[d], xs = new Array(n);
      if (d < dims - 1) {
        for (let k = 0;k < n; k++)
          xs[k] = level(d + 1);
        return xs;
      }
      for (let k = 0;k < n; k++) {
        const length = int32(x, at);
        at += 4;
        if (length === -1) {
          xs[k] = null;
        } else {
          xs[k] = read(x, at);
          at += length;
        }
      }
      return xs;
    }
  };
}
function int32(x, i) {
  return x[i] << 24 | x[i + 1] << 16 | x[i + 2] << 8 | x[i + 3];
}
function integer(x, i, end) {
  const negative = x[i] === 45;
  let n = 0;
  for (negative && i++;i < end; i++)
    n = n * 10 + x[i] - 48;
  return negative ? -n : n;
}
function boolean(x, i) {
  return x[i] === 116;
}
var latin1 = typeof Buffer.prototype.latin1Slice === "function" ? (x, start, end) => x.latin1Slice(start, end) : (x, start, end) => x.toString("latin1", start, end);
function digits(x, i, n) {
  let v = 0;
  for (const end = i + n;i < end; i++) {
    const d = x[i] - 48;
    if (d < 0 || d > 9)
      return -1;
    v = v * 10 + d;
  }
  return v;
}
function clock(x, i, end, zoned) {
  const year = digits(x, i, 4);
  if (year < 1000 || x[i + 4] !== 45 || x[i + 7] !== 45)
    return NaN;
  const month = digits(x, i + 5, 2), day = digits(x, i + 8, 2);
  if (end - i === 10)
    return zoned || month < 1 || day < 1 ? NaN : Date.UTC(year, month - 1, day);
  if (x[i + 10] !== 32 || x[i + 13] !== 58 || x[i + 16] !== 58)
    return NaN;
  const hour = digits(x, i + 11, 2), minute = digits(x, i + 14, 2), second = digits(x, i + 17, 2);
  let at = i + 19, ms = 0;
  if (x[at] === 46) {
    let scale = 100;
    for (at++;at < end && x[at] >= 48 && x[at] <= 57; at++) {
      ms += (x[at] - 48) * scale;
      scale = scale / 10 | 0;
    }
  }
  let offset = 0;
  if (zoned) {
    const sign = x[at];
    if (sign !== 43 && sign !== 45 || end - at !== 3 && (end - at !== 6 || x[at + 3] !== 58))
      return NaN;
    offset = digits(x, at + 1, 2) * 60 + (end - at === 6 ? digits(x, at + 4, 2) : 0);
    if (offset < 0 || digits(x, at + 1, 2) < 0 || end - at === 6 && digits(x, at + 4, 2) < 0)
      return NaN;
    sign === 45 && (offset = -offset);
    at = end;
  }
  if (at !== end || month < 1 || day < 1 || hour < 0 || minute < 0 || second < 0)
    return NaN;
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset * 60000;
}
function timestamptz(x, i, end) {
  const t = clock(x, i, end, true);
  return Number.isNaN(t) ? parseTimestamptz(latin1(x, i, end)) : new Date(t);
}
function utcStamp(x, i, end) {
  const t = clock(x, i, end, false);
  return Number.isNaN(t) ? parseDate(latin1(x, i, end)) : new Date(t);
}
var shaped = (is, serialize) => (x) => is(x) ? serialize(x) : string(x);
var shapedTypes = {
  ...types,
  boolean: { ...types.boolean, serialize: shaped((x) => typeof x === "boolean", types.boolean.serialize) },
  date: { ...types.date, serialize: shaped((x) => x instanceof Date, types.date.serialize) },
  bytea: { ...types.bytea, serialize: shaped((x) => x instanceof Uint8Array, types.bytea.serialize) }
};
function Types(options = {}) {
  const parsers = {}, serializers = {}, elements = {}, undefinedValue = options.transform && options.transform.undefined;
  Object.entries(arrays).forEach(([oid, array]) => elements[array] = [+oid, +oid === 603 ? ";" : ","]);
  register(options.infer === false ? shapedTypes : types);
  Object.assign(parsers, dates);
  options.infer === false && (parsers[1114] = parseDate);
  const custom = Object.values(options.types || {}), named = custom.filter((x) => [x.to].concat(x.from || []).some((y) => typeof y === "string")), oids = {}, own = new Set;
  register(custom.filter((x) => !named.includes(x)));
  custom.forEach((x) => [x.to].concat(x.from || []).forEach((oid) => own.add(oid)));
  const keys = options.transform && options.transform.json && options.transform.column.to;
  keys && [114, 3802].forEach((oid) => own.has(oid) || (serializers[oid] = renamed(serializers[oid], keys)));
  const bases = {};
  return {
    parser,
    decoder,
    known,
    unknown,
    binary,
    serializer,
    load,
    infer,
    resolve,
    named: named.length > 0,
    plain: !custom.some((x) => x.serialize),
    parsers,
    serializers
  };
  function binary(oid) {
    if (own.has(oid))
      return null;
    if (oid === 17)
      return parsers[17] === types.bytea.parse ? bytes : null;
    const element = elementsOf[oid];
    return element !== undefined && !own.has(element) && (element !== 20 || !(20 in parsers)) ? readers[element] : null;
  }
  function unknown(oids) {
    for (let i = 0;i < oids.length; i++) {
      const oid = oids[i];
      if (oid >= 16384 && !(oid in parsers) && !(oid in serializers) && !(oid in elements) && !(oid in bases))
        return true;
    }
    return false;
  }
  function known(oid) {
    return oid in serializers || oid in elements;
  }
  function resolve(type) {
    return typeof type === "string" ? oids[type] || 0 : type;
  }
  function decoder(oid, parse) {
    return parse === number && (oid === 21 || oid === 23 || oid === 26) ? integer : parse === bool && oid === 16 ? boolean : parse === parseTimestamptz && oid === 1184 ? timestamptz : parse === parseDate && (oid === 1114 || oid === 1082) ? utcStamp : null;
  }
  function register(xs) {
    Object.values(xs).forEach((x) => {
      const from = [].concat(x.from || []);
      x.parse && from.forEach((oid) => parsers[oid] = x.parse);
      if (x.serialize) {
        serializers[x.to] = x.serialize;
        from.forEach((oid) => serializers[oid] = x.serialize);
      }
    });
  }
  function parser(oid) {
    if (oid in parsers)
      return parsers[oid];
    if (oid in bases)
      return parsers[oid] = parser(bases[oid]);
    if (oid in elements) {
      const [element, delimiter] = elements[oid], parse = parser(element);
      return parsers[oid] = (x) => parseArray(x, parse === identity ? null : parse, delimiter);
    }
    return identity;
  }
  function serializer(oid) {
    if (oid in serializers)
      return serializers[oid];
    if (oid in bases)
      return serializers[oid] = serializer(bases[oid]);
    if (oid in elements) {
      const [element, delimiter] = elements[oid], serialize = serializer(element);
      return serializers[oid] = (xs) => Array.isArray(xs) ? serializeArray(xs, serialize, delimiter, undefinedValue) : serialize(xs);
    }
    return string;
  }
  function load(run) {
    return Promise.all([fetched(run), named.length && names(run)]);
  }
  async function names(run) {
    const wanted = [...new Set(named.flatMap((x) => [x.to].concat(x.from || [])).filter((x) => typeof x === "string"))], list = wanted.map((x) => "'" + x.split(".").pop().replace(/'/g, "''") + "'").join(","), rows = await run("select t.oid::int, t.typarray::int as array, t.typdelim as delimiter, t.typname as name, n.nspname as schema, " + "pg_catalog.pg_type_is_visible(t.oid) as visible from pg_catalog.pg_type t " + "join pg_catalog.pg_namespace n on n.oid = t.typnamespace where t.typname in (" + list + ")"), missing = [];
    wanted.forEach((x) => {
      const [schema, name] = x.includes(".") ? x.split(".") : [null, x], row = rows.find((r) => r.name === name && (schema ? r.schema === schema : r.visible));
      row ? (oids[x] = row.oid, row.array && !(row.array in elements) && (elements[row.array] = [row.oid, row.delimiter])) : missing.push(x);
    });
    if (missing.length) {
      throw Errors.generic("TYPE_NOT_FOUND", missing.length > 1 ? "The types " + missing.join(", ") + " do not exist" : "The type " + missing[0] + " does not exist");
    }
    register(named.map((x) => ({ ...x, to: resolve(x.to), from: [].concat(x.from || []).map(resolve) })));
    named.forEach((x) => [x.to].concat(x.from || []).forEach((y) => own.add(resolve(y))));
  }
  function fetched(run) {
    return run("select oid::int, typelem::int as element, typdelim as delimiter, typbasetype::int as base, typtype as kind " + "from pg_catalog.pg_type where typtype = 'd' or (typcategory = 'A' and oid >= 16384)").then((rows) => rows.forEach(({ oid, element, delimiter, base, kind }) => {
      if (oid in parsers || oid in serializers)
        return;
      kind === "d" ? bases[oid] = base : element && !(oid in elements) && (elements[oid] = [element, delimiter]);
    }));
  }
}
var identity = (x) => x;
identity.identity = true;

class Parameter {
  constructor(value, type) {
    this.value = value;
    this.type = type;
  }
}
function infer(x) {
  return x instanceof Parameter ? x.type : x instanceof Date ? 1184 : x instanceof Uint8Array ? 17 : x === true || x === false ? 16 : typeof x === "bigint" ? 20 : Array.isArray(x) ? arrays[infer(x[0])] || 0 : 0;
}
function parseArray(x, parse, delimiter = ",") {
  let i = x[0] === "[" ? x.indexOf("=") + 1 : 0;
  return level();
  function level() {
    const xs = [];
    i++;
    while (i < x.length && x[i] !== "}") {
      if (x[i] === "{") {
        xs.push(level());
      } else if (x[i] === '"') {
        let s = "";
        for (i++;x[i] !== '"'; i++)
          s += x[i] === "\\" ? x[++i] : x[i];
        i++;
        xs.push(parse ? parse(s) : s);
      } else {
        const start = i;
        while (x[i] !== delimiter && x[i] !== "}")
          i++;
        const s = x.slice(start, i);
        xs.push(s === "NULL" ? null : parse ? parse(s) : s);
      }
      x[i] === delimiter && i++;
    }
    i++;
    return xs;
  }
}
function serializeArray(xs, serialize = string, delimiter = ",", undefinedValue) {
  return "{" + xs.map((x) => {
    const typed = x instanceof Parameter;
    typed && (x = x.value);
    x === undefined && (x = undefinedValue);
    if (x === undefined)
      throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
    return Array.isArray(x) && !typed ? serializeArray(x, serialize, delimiter, undefinedValue) : x === null ? "NULL" : '"' + ("" + serialize(x)).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + '"';
  }).join(delimiter) + "}";
}
function serializeDate(x) {
  return x === Infinity ? "infinity" : x === -Infinity ? "-infinity" : (x instanceof Date ? x : new Date(x)).toISOString();
}
var timestamp = /^(\d{4,})-(\d\d)-(\d\d)(?: (\d\d):(\d\d):(\d\d)(?:\.(\d+))?)?(?:([+-])(\d\d)(?::(\d\d))?(?::(\d\d))?)?( BC)?$/;
function parts(x) {
  const m = x.match(timestamp);
  if (!m)
    return null;
  const year = m[12] ? 1 - m[1] : +m[1], ms = m[7] ? +(m[7] + "00").slice(0, 3) : 0, offset = m[8] ? (m[8] === "-" ? -1 : 1) * ((m[9] * 60 + +(m[10] || 0)) * 60 + +(m[11] || 0)) * 1000 : 0;
  return { year, month: m[2] - 1, day: +m[3], hour: +(m[4] || 0), minute: +(m[5] || 0), second: +(m[6] || 0), ms, offset };
}
function infinite(x) {
  return x === "infinity" ? Infinity : x === "-infinity" ? -Infinity : null;
}
function utc(x) {
  const date = new Date(Date.UTC(2000, x.month, x.day, x.hour, x.minute, x.second, x.ms));
  date.setUTCFullYear(x.year);
  return date;
}
function plain(x) {
  const n = x.length;
  return x.charCodeAt(0) !== 48 && x.charCodeAt(n - 1) !== 67 && !(x.charCodeAt(n - 3) === 58 && x.charCodeAt(n - 6) === 58) && x.charCodeAt(0) !== 45 && x.charCodeAt(0) !== 105;
}
function parseTimestamptz(x) {
  if (plain(x))
    return new Date(x);
  const p = infinite(x) || parts(x);
  if (!p)
    return new Date(x);
  if (typeof p === "number")
    return p;
  const date = utc(p);
  date.setTime(date.getTime() - p.offset);
  return date;
}
function parseDate(x) {
  const p = infinite(x) || parts(x);
  return !p ? new Date(x) : typeof p === "number" ? p : utc(p);
}
function parseTimestamp(x) {
  const p = infinite(x) || parts(x);
  if (!p || typeof p === "number")
    return p || new Date(x);
  if (p.year >= 100)
    return new Date(p.year, p.month, p.day, p.hour, p.minute, p.second, p.ms);
  const date = new Date(2000, 0, 1);
  date.setFullYear(p.year, p.month, p.day);
  date.setHours(p.hour, p.minute, p.second, p.ms);
  return date;
}
var toCamel = (x) => {
  let str = x.slice(0, 1);
  for (let i = 1;i < x.length; i++)
    str += x[i] === "_" && i < x.length - 1 ? x[++i].toUpperCase() : x[i];
  return str;
};
var toPascal = (x) => {
  let str = x.slice(0, 1).toUpperCase();
  for (let i = 1;i < x.length; i++)
    str += x[i] === "_" && i < x.length - 1 ? x[++i].toUpperCase() : x[i];
  return str;
};
var toKebab = (x) => x.replace(/_/g, "-");
var fromCamel = (x) => x.replace(/([A-Z])/g, "_$1").toLowerCase();
var fromPascal = (x) => (x.slice(0, 1) + x.slice(1).replace(/([A-Z])/g, "_$1")).toLowerCase();
var fromKebab = (x) => x.replace(/-/g, "_");
function renamed(serialize, fn) {
  return (x) => serialize(rename(x, fn));
}
function rename(x, fn) {
  if (Array.isArray(x))
    return x.map((x) => rename(x, fn));
  if (x === null || typeof x !== "object" || Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null)
    return x;
  const out = {};
  for (const k in x)
    Object.hasOwn(x, k) && Object.defineProperty(out, fn(k), { value: rename(x[k], fn), enumerable: true, writable: true, configurable: true });
  return out;
}
function createJsonTransform(fn) {
  jsonTransform.keys = true;
  return jsonTransform;
  function jsonTransform(x, column) {
    return typeof x === "object" && x !== null && (column.type === 114 || column.type === 3802) ? Array.isArray(x) ? x.map((x) => jsonTransform(x, column)) : Object.entries(x).reduce((acc, [k, v]) => Object.assign(acc, { [fn(k)]: jsonTransform(v, column) }), {}) : x;
  }
}
toCamel.column = { from: toCamel };
toCamel.value = { from: createJsonTransform(toCamel) };
fromCamel.column = { to: fromCamel };
var camel = { ...toCamel };
camel.column.to = fromCamel;
toPascal.column = { from: toPascal };
toPascal.value = { from: createJsonTransform(toPascal) };
fromPascal.column = { to: fromPascal };
var pascal = { ...toPascal };
pascal.column.to = fromPascal;
toKebab.column = { from: toKebab };
toKebab.value = { from: createJsonTransform(toKebab) };
fromKebab.column = { to: fromKebab };
var kebab = { ...toKebab };
kebab.column.to = fromKebab;

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/build.js
var isQuery = Symbol("query");

class NotTagged {
  then() {
    notTagged();
  }
  catch() {
    notTagged();
  }
  finally() {
    notTagged();
  }
}

class Identifier extends NotTagged {
  constructor(value) {
    super();
    this.value = value;
  }
}

class Join {
  constructor(separator, items) {
    this.separator = separator;
    this.items = items;
  }
}
var joinStrings = Object.assign(["", ""], { raw: ["", ""] });

class Builder extends NotTagged {
  constructor(first, rest) {
    super();
    this.first = first;
    this.rest = rest;
  }
}
function build(query, options) {
  const values = [], oids = [], o = { transform: options.transform, infer: options.infer !== false, resolve: options.resolve, values, oids, dynamic: !query.tagged };
  const text = query.tagged ? stringify(query, o) : (query.args.forEach((x) => value(x, o)), "" + query.strings[0]);
  if (values.length >= 65534)
    throw Errors.generic("MAX_PARAMETERS_EXCEEDED", "Max number of parameters (65534) exceeded");
  const types = oids.join();
  return { strings: query.strings, dynamic: o.dynamic, types, text, values, oids };
}
function stringify(q, o) {
  let string = q.strings[0];
  for (let i = 1;i < q.strings.length; i++)
    string += part(string, q.args[i - 1], o, q.strings[i]) + q.strings[i];
  return string;
}
function part(before, x, o, after = "") {
  if (x instanceof Builder || x instanceof Identifier || isFragment(x) || Array.isArray(x) && isFragment(x[0]))
    o.dynamic = true;
  return isFragment(x) && x.strings === joinStrings ? joined(x.args[0], o, before, after) : x instanceof Join ? joined(x, o, "", "") : x instanceof Builder ? helper(before, x, o) : isFragment(x) ? fragment(x, o) : x instanceof Identifier ? x.value : Array.isArray(x) && isFragment(x[0]) ? x.reduce((acc, x) => acc + " " + fragment(x, o), "") : value(x, o);
}
function joined(join, o, before, after) {
  let text = "";
  join.items.forEach((item, i) => {
    i > 0 && (text = spaced(text, fragment(join.separator, o)));
    text = spaced(text, part("", item, o));
  });
  before && text && !/\s$/.test(before) && !/^\s/.test(text) && (text = " " + text);
  after && text && !/^\s/.test(after) && !/\s$/.test(text) && (text = text + " ");
  return text;
}
function spaced(a, b) {
  return a && b && !/\s$/.test(a) && !/^\s/.test(b) ? a + " " + b : a + b;
}
function isFragment(x) {
  return !!x && x[isQuery] === true;
}
function fragment(q, o) {
  return q.tagged ? stringify(q, o) : q.strings[0];
}
function value(x, o) {
  let v = x instanceof Parameter ? x.value : x;
  if (v === undefined) {
    v = o.transform.undefined;
    if (v === undefined)
      throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
    x instanceof Parameter || (x = v);
  }
  o.values.push(v);
  o.oids.push(x instanceof Parameter ? o.resolve(x.type) : o.infer ? infer(x) : 0);
  return "$" + o.values.length;
}
var builders = {
  values,
  in: (...xs) => {
    const x = values(...xs);
    return x === "()" ? "(null)" : x;
  },
  select,
  update,
  insert,
  call
};
function call(first, rest, o) {
  if (first === null || typeof first !== "object" || Array.isArray(first) || isFragment(first))
    return select(first, rest, o);
  return columns(first, rest).map((x) => escapeIdentifier(column(x, o)) + " => " + part("values", first[x], o)).join(",");
}
var clauses = { in: "in", values: "values", select: "select", returning: "select", set: "update", distinct: "select" };
var stops = new Set([
  "from",
  "where",
  "on",
  "to",
  "join",
  "group",
  "order",
  "by",
  "having",
  "limit",
  "offset",
  "union",
  "intersect",
  "except",
  "using",
  "and",
  "or",
  "when",
  "then",
  "else",
  "with",
  "table",
  "grant",
  "revoke",
  "delete",
  "update",
  "case",
  "not",
  "like",
  "ilike",
  "between",
  "is",
  "exists",
  "conflict",
  "do",
  "nothing",
  "window",
  "over",
  "partition",
  "filter",
  "lateral",
  "cross",
  "inner",
  "left",
  "right",
  "full",
  "outer",
  "natural",
  "into"
]);
function helper(before, x, o) {
  const kind = context(before);
  return kind ? builders[kind](x.first, x.rest, o) : identifiers(typeof x.first === "string" ? [x.first].concat(x.rest) : x.first, o);
}
function context(sql) {
  const words = [];
  let i = sql.length - 1, depth = 0;
  while (i >= 0) {
    const c = sql[i];
    if (c === ")") {
      depth++;
      i--;
    } else if (c === "(") {
      if (depth === 0) {
        const word = previous(sql, i - 1);
        if (words.length === 0)
          return word === "in" || word === "values" ? word : word && !clauses[word] && !stops.has(word) ? "call" : "select";
        return "select";
      }
      depth--;
      i--;
    } else if (c === "'" || c === '"') {
      const end = i;
      i--;
      while (i >= 0 && !(sql[i] === c && sql[i - 1] !== c))
        sql[i] === c ? i -= 2 : i--;
      i--;
      if (sql[i] === ".")
        i--;
      else if (depth === 0 && c === '"' && sql[end + 1] === "." && words.length)
        words[words.length - 1] = sql.slice(i + 1, end + 1) + words[words.length - 1];
      else if (depth === 0 && c === '"')
        words.push(sql.slice(i + 1, end + 1));
    } else if (/[a-z_0-9$]/i.test(c)) {
      const end = i + 1;
      while (i >= 0 && /[a-z_0-9$.]/i.test(sql[i]))
        i--;
      const word = depth === 0 && sql.slice(i + 1, end).toLowerCase();
      if (word && clauses[word])
        return clauses[word];
      if (word === "into")
        return insert_into(words, sql, i) ? "insert" : null;
      if (word && stops.has(word))
        return null;
      word && words.push(word);
    } else {
      i--;
    }
  }
  return null;
}
function previous(sql, i) {
  while (i >= 0 && /\s/.test(sql[i]))
    i--;
  if (sql[i] === '"')
    return '"';
  const end = i + 1;
  while (i >= 0 && /[a-z_0-9$.]/i.test(sql[i]))
    i--;
  return sql.slice(i + 1, end).toLowerCase();
}
function insert_into(words, sql, i) {
  const target = words.length === 1 || words.length === 3 && words[1] === "as";
  return target && previous(sql, i) === "insert";
}
function valuesBuilder(first, columns, o) {
  return first.map((row) => "(" + columns.map((x) => part("values", row[x], o)).join(",") + ")").join(",");
}
function values(first, rest, o) {
  const rows = Array.isArray(first) && first.length > 0 && first[0] !== null && typeof first[0] === "object" && !isFragment(first[0]), picked = columns(rows ? first[0] : first, rest);
  return valuesBuilder(rows ? first : [first], picked, o);
}
function update(first, rest, o) {
  const picked = columns(first, rest);
  picked.length || empty("update");
  return picked.map((x) => escapeIdentifier(column(x, o)) + "=" + part("values", first[x], o));
}
function insert(first, rest, o) {
  if (Array.isArray(first) && first.every((x) => typeof x === "string"))
    return "(" + escapeIdentifiers(first.concat(rest.flat()), o) + ")";
  const picked = columns(Array.isArray(first) ? first[0] || {} : first, rest);
  picked.length || empty("insert");
  return "(" + escapeIdentifiers(picked, o) + ")values" + valuesBuilder(Array.isArray(first) ? first : [first], picked, o);
}
function columns(first, rest) {
  return rest.length ? rest.flat() : Object.keys(first);
}
function empty(x) {
  throw Errors.generic("NO_COLUMNS", "The " + x + " helper got no columns");
}
function identifiers(first, o) {
  return Array.isArray(first) ? first.map((x) => member(x, o)).join(",") : member(first, o);
}
function member(x, o) {
  return isFragment(x) ? fragment(x, o) : x instanceof Identifier ? x.value : escapeIdentifier(column(x, o));
}
function select(first, rest, o) {
  typeof first === "string" && (first = [first].concat(rest));
  if (Array.isArray(first))
    return identifiers(first, o);
  return columns(first, rest).map((x) => {
    const v = first[x];
    return (isFragment(v) ? fragment(v, o) : v instanceof Identifier ? v.value : value(v, o)) + " as " + escapeIdentifier(column(x, o));
  }).join(",");
}
function column(x, o) {
  return o.transform.column.to ? o.transform.column.to(x) : x;
}
function escapeIdentifiers(xs, o) {
  return xs.map((x) => escapeIdentifier(column(x, o))).join(",");
}
function escapeIdentifier(x) {
  return '"' + x.replace(/"/g, '""').replace(/\./g, '"."') + '"';
}
function notTagged() {
  throw Errors.generic("NOT_TAGGED_CALL", "Query not called as a tagged template literal");
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/query.js
import util from "node:util";

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/diagnostics.js
import dc from "node:diagnostics_channel";
var channels = {
  query: tracing("postgres:query"),
  connect: tracing("postgres:connect"),
  transaction: tracing("postgres:transaction"),
  pool: plain2("postgres:pool"),
  notice: plain2("postgres:notice")
};
var done = Symbol("done");
var now = () => performance.now();
var userName = (options) => typeof options.user === "function" ? null : options.user;
function active(t) {
  return !!t && (t.hasSubscribers !== undefined ? t.hasSubscribers : t.start.hasSubscribers || t.end.hasSubscribers || t.asyncStart.hasSubscribers || t.asyncEnd.hasSubscribers || t.error.hasSubscribers);
}
function listened(channel) {
  return !!channel && channel.hasSubscribers;
}
function start(t, context, fn) {
  return typeof t.start.runStores === "function" ? t.start.runStores(context, run) : (t.start.publish(context), run());
  function run() {
    try {
      return fn();
    } finally {
      t.end.publish(context);
    }
  }
}
function finish(t, context, error, result) {
  if (context[done])
    return;
  context[done] = true;
  if (error) {
    context.error = error;
    t.error.publish(context);
  } else {
    context.result = result;
  }
  t.asyncStart.publish(context);
  t.asyncEnd.publish(context);
}
function tracing(name) {
  try {
    return typeof dc.tracingChannel === "function" ? dc.tracingChannel(name) : null;
  } catch (error) {
    return null;
  }
}
function plain2(name) {
  try {
    return dc.channel(name);
  } catch (error) {
    return null;
  }
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/result.js
class Result extends Array {
  #count = null;
  #state = null;
  #command = null;
  #columns = null;
  #statement = null;
  get count() {
    return this.#count;
  }
  set count(x) {
    this.#count = x;
  }
  get state() {
    return this.#state;
  }
  set state(x) {
    this.#state = x;
  }
  get command() {
    return this.#command;
  }
  set command(x) {
    this.#command = x;
  }
  get columns() {
    return this.#columns;
  }
  set columns(x) {
    this.#columns = x;
  }
  get statement() {
    const x = this.#statement;
    return x && x.kind ? this.#statement = statement(x) : x;
  }
  set statement(x) {
    this.#statement = x;
  }
  static get [Symbol.species]() {
    return Array;
  }
}
function statement(item) {
  const x = item.statement;
  return {
    name: x ? x.name : "",
    string: x ? x.text : item.text || "",
    types: item.params || item.entry && item.entry.oids || x && x.oids || [],
    columns: item.columns || []
  };
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/query.js
var origins = new WeakMap;
var noop = () => {};
var CLOSE = {};

class Query extends Promise {
  constructor(strings, args, handler, options = {}) {
    let resolve, reject;
    super((a, b) => {
      resolve = a;
      reject = b;
    });
    this.fulfil = resolve;
    this.fail = reject;
    this[isQuery] = true;
    this.tagged = Array.isArray(strings.raw);
    this.strings = strings;
    this.args = args;
    this.handler = handler;
    this.options = options;
    this.state = null;
    this.source = null;
    this.active = false;
    this.executed = false;
    this.settled = false;
    this.built = null;
    this.trace = null;
    this.aborts = null;
    this.timer = null;
    this.timedOut = false;
    this.originError = handler.debug ? new Error : null;
    this.tagged && !handler.debug && !origins.has(strings) && origins.set(strings, located());
  }
  static get [Symbol.species]() {
    return Promise;
  }
  join(items) {
    const kept = [...items].filter((x) => x !== false && x !== null && x !== undefined), joined = new Query(joinStrings, [new Join(this, kept)], this.handler);
    Object.defineProperty(joined, "length", { value: kept.length });
    return joined;
  }
  resolve(x) {
    this.timer && untime(this);
    this.aborts && this.aborts();
    this.active = false;
    this.settled = true;
    this.trace && traced(this, null, x);
    this.fulfil(x);
  }
  reject(x) {
    this.timer && untime(this);
    this.timedOut && x && timedOut(x) && (x = late(this, x));
    this.aborts && this.aborts();
    this.active = false;
    this.settled = true;
    this.trace && traced(this, x);
    this.fail(x);
  }
  get origin() {
    return this.originError ? this.originError.stack : this.tagged && origins.get(this.strings) || "";
  }
  get statement() {
    return this.source && statement(this.source);
  }
  build() {
    return this.built || (this.built = build(this, this.handler.options));
  }
  get text() {
    return this.build().text;
  }
  get parameters() {
    return this.build().values;
  }
  [util.inspect.custom](depth, options, inspect) {
    if (!this.handler.debug)
      return "Query {}";
    let x;
    try {
      x = this.build();
    } catch (error) {
      return "Query { " + error.message + " }";
    }
    return "Query " + inspect({ text: x.text, parameters: x.values }, options);
  }
  cancel() {
    return this.handler.cancel ? this.handler.cancel(this) : Promise.resolve();
  }
  signal(signal) {
    if (!signal || this.settled)
      return this;
    if (signal.aborted)
      return this.cancel().catch(noop), this;
    const abort = () => this.cancel().catch(noop);
    signal.addEventListener("abort", abort, { once: true });
    this.aborts = () => (this.aborts = null, signal.removeEventListener("abort", abort));
    return this;
  }
  simple() {
    this.options.simple = true;
    this.options.prepare = false;
    return this;
  }
  async readable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  async writable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  cursor(rows = 1, fn) {
    this.options.simple = false;
    if (typeof rows === "function") {
      fn = rows;
      rows = 1;
    }
    this.cursorRows = rows;
    if (typeof fn === "function")
      return this.cursorFn = fn, this;
    let prev;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (this.executed && !this.active)
            return { done: true };
          prev && prev();
          const promise = new Promise((resolve, reject) => {
            this.cursorFn = (value) => {
              resolve({ value, done: false });
              return new Promise((r) => prev = r);
            };
            this.resolve = (x) => (this.active = false, this.settled = true, this.trace && traced(this, null, x), resolve({ done: true }));
            this.reject = (x) => (this.active = false, this.settled = true, this.trace && traced(this, x), reject(x));
          });
          this.execute();
          return promise;
        },
        return() {
          prev && prev(CLOSE);
          return { done: true };
        }
      })
    };
  }
  describe() {
    this.options.simple = false;
    this.onlyDescribe = this.options.prepare = true;
    return this;
  }
  stream() {
    throw new Error(".stream has been renamed to .forEach");
  }
  forEach(fn) {
    this.forEachFn = fn;
    this.handle();
    return this;
  }
  raw() {
    this.isRaw = true;
    return this;
  }
  values() {
    this.isRaw = "values";
    return this;
  }
  parsers(parsers) {
    this.ownParsers = parsers || null;
    return this;
  }
  handle() {
    if (this.executed)
      return;
    this.executed = true;
    queueMicrotask(() => this.run());
  }
  run() {
    active(channels.query) ? start(channels.query, this.trace = context2(this), () => this.handler(this)) : this.handler(this);
  }
  execute() {
    this.handle();
    return this;
  }
  then(fulfilled, rejected) {
    this.handle();
    return super.then(fulfilled, rejected);
  }
  catch(rejected) {
    this.handle();
    return super.catch(rejected);
  }
  finally(fn) {
    this.handle();
    return super.finally(fn);
  }
}
function untime(q) {
  q.handler.options.timers.clearTimeout(q.timer);
  q.timer = null;
}
function timedOut(x) {
  return x.code === "57014" || x.code === "CONNECTION_DESTROYED" && !!x.cause && x.cause.code === "CANCEL_UNANSWERED";
}
function late(q, error) {
  const x = Errors.generic("QUERY_TIMEOUT", "The query did not finish within query_timeout (" + q.handler.options.query_timeout + " seconds)");
  x.cause = error.code === "CONNECTION_DESTROYED" ? error.cause : error;
  return queryError(x, q, q.handler.debug);
}
function context2(q) {
  const options = q.handler.options || {};
  let text = null;
  if (q.strings.length) {
    try {
      text = q.text;
    } catch (error) {
      text = null;
    }
  }
  return {
    query: text,
    parameters: undefined,
    database: options.database,
    user: userName(options),
    host: null,
    port: null,
    connection: null,
    statement: null,
    command: null,
    count: null,
    queued: now(),
    sent: null,
    firstByte: null,
    complete: null
  };
}
function traced(q, error, result) {
  const x = q.trace;
  q.trace = null;
  x.complete = now();
  if (result && typeof result === "object" && "command" in result) {
    x.command = result.command;
    x.count = result.count;
  }
  finish(channels.query, x, error, result);
}
function located() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 8;
  try {
    return trim(String(new Error().stack));
  } catch (error) {
    return "";
  } finally {
    Error.stackTraceLimit = limit;
  }
}
function trim(stack) {
  const lines = stack.split(`
`), i = lines.findIndex((x, i) => i > 0 && !ours(x));
  return i === -1 ? stack : lines.slice(0, i + 1).join(`
`);
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/startup.js
import crypto from "node:crypto";
import fs from "node:fs";

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/protocol.js
function Writer(size = 16384) {
  let b = Buffer.allocUnsafe(size), i = 0, at = 0;
  const w = {
    get length() {
      return i;
    },
    type(x) {
      fit(5);
      at = i;
      b[i] = x;
      i += 5;
      return w;
    },
    untyped() {
      fit(4);
      at = i;
      i += 4;
      return w;
    },
    end() {
      b.writeInt32BE(i - at - 1, at + 1);
      return w;
    },
    endUntyped() {
      b.writeInt32BE(i - at, at);
      return w;
    },
    str(x) {
      fit(x.length * 3 + 1);
      i += b.write(x, i);
      b[i++] = 0;
      return w;
    },
    bytes(x) {
      if (typeof x === "string") {
        fit(x.length * 3);
        i += b.write(x, i);
      } else {
        fit(x.length);
        b.set(x, i);
        i += x.length;
      }
      return w;
    },
    value(x) {
      if (x === null || x === undefined)
        return w.i32(-1);
      const n = i;
      i += 4;
      w.bytes(x);
      b.writeInt32BE(i - n - 4, n);
      return w;
    },
    u8(x) {
      fit(1);
      b[i++] = x;
      return w;
    },
    i16(x) {
      fit(2);
      b.writeInt16BE(x, i);
      i += 2;
      return w;
    },
    u16(x) {
      fit(2);
      b.writeUInt16BE(x, i);
      i += 2;
      return w;
    },
    i32(x) {
      fit(4);
      b.writeInt32BE(x, i);
      i += 4;
      return w;
    },
    truncate(n) {
      i = n;
      return w;
    },
    take() {
      const out = i < 4096 ? Buffer.from(b.subarray(0, i)) : b.subarray(0, i);
      i >= 4096 && (b = Buffer.allocUnsafe(size));
      i = at = 0;
      return out;
    }
  };
  return w;
  function fit(n) {
    if (b.length - i >= n)
      return;
    const prev = b;
    b = Buffer.allocUnsafe(Math.max(size, prev.length * 2, i + n));
    prev.copy(b, 0, 0, i);
  }
}
var own = Writer(1024);
var S = 83;
var H = 72;
var X = 88;
var c = 99;
var Q = 81;
var p = 112;
var d = 100;
var f = 102;
var D = 68;
var C = 67;
var E = 69;
var P = 80;
var B = 66;
var sync = (w) => w.type(S).end();
var flush = (w) => w.type(H).end();
var terminate = (w) => w.type(X).end();
var copyDone = (w) => w.type(c).end();
var sslRequest = (w) => w.untyped().i32(80877103).endUntyped();
var query2 = (w, text) => w.type(Q).str(text).end();
var password = (w, x) => w.type(p).str(x).end();
var saslResponse = (w, x) => w.type(p).bytes(x).end();
var copyData = (w, x) => w.type(d).bytes(x).end();
var copyFail = (w, x) => w.type(f).str(x).end();
var describe = (w, kind, name) => w.type(D).u8(kind.charCodeAt(0)).str(name).end();
var close = (w, kind, name) => w.type(C).u8(kind.charCodeAt(0)).str(name).end();
var execute = (w, portal, rows = 0) => w.type(E).str(portal).i32(rows).end();
var cancel = (w, pid, secret) => w.untyped().i32(80877102).i32(pid).i32(secret).endUntyped();
var Sync = one(sync);
var Flush = one(flush);
var Terminate = one(terminate);
var CopyDone = one(copyDone);
var SSLRequest = one(sslRequest);
var Query2 = one(query2);
var Password = one(password);
var SASLResponse = one(saslResponse);
var CopyData = one(copyData);
var CopyFail = one(copyFail);
var Describe = one(describe);
var Close = one(close);
var Execute = one(execute);
var Cancel = one(cancel);
var Startup = one(startup);
var SASL = one(sasl);
var Parse = one(parse);
var Bind = one(bind);
var Run = one(run);
function one(fn) {
  return (...xs) => {
    try {
      fn(own, ...xs);
    } catch (error) {
      own.truncate(0);
      throw error;
    }
    return own.take();
  };
}
function startup(w, parameters) {
  w.untyped().i32(196608);
  for (const k in parameters)
    parameters[k] && w.str(unbroken(k, k)).str(unbroken(k, "" + parameters[k]));
  return w.u8(0).endUntyped();
}
function unbroken(k, x) {
  if (x.indexOf("\x00") !== -1)
    throw Object.assign(new Error("The connection parameter " + k + " contains a NUL character"), { code: "NUL_CHARACTER" });
  return x;
}
function sasl(w, mechanism, initial) {
  return w.type(p).str(mechanism).i32(Buffer.byteLength(initial)).bytes(initial).end();
}
function parse(w, name, text, oids = []) {
  w.type(P).str(name).str(text).u16(oids.length);
  for (let j = 0;j < oids.length; j++)
    w.i32(oids[j] | 0);
  return w.end();
}
function bind(w, portal, name, values = [], formats = [], resultFormats = []) {
  w.type(B).str(portal).str(name).i16(formats.length);
  for (let j = 0;j < formats.length; j++)
    w.i16(formats[j]);
  w.u16(values.length);
  for (let j = 0;j < values.length; j++)
    w.value(values[j]);
  w.i16(resultFormats.length);
  for (let j = 0;j < resultFormats.length; j++)
    w.i16(resultFormats[j]);
  return w.end();
}
function run(w, portal, name, values, rows, flushing, formats) {
  bind(w, portal, name, values, undefined, formats || undefined);
  execute(w, portal, rows);
  return flushing ? flush(w) : sync(w);
}
var largest = 1073741824;
function Frames(onframe, shared = false, onerror = null) {
  const chunks = [], owned = new WeakSet;
  let data = null, owning = false, at = 0, part = null, filled = 0, paused = false, running = false, broken = false;
  return {
    push(x) {
      if (broken)
        return;
      chunks.push(shared && (paused || owning) ? own(x) : x);
      run();
    },
    get paused() {
      return paused;
    },
    owns(x) {
      return !shared || owned.has(x);
    },
    own(x) {
      owning = x;
      x && settle();
    },
    pause() {
      paused = true;
      settle();
    },
    resume() {
      paused = false;
      run();
    }
  };
  function own(x) {
    const copy = Buffer.from(x);
    owned.add(copy);
    return copy;
  }
  function settle() {
    if (!shared)
      return;
    data && at < data.length && !owned.has(data) && (data = own(data.subarray(at)), at = 0);
    for (let i = 0;i < chunks.length; i++)
      owned.has(chunks[i]) || (chunks[i] = own(chunks[i]));
  }
  function run() {
    if (running)
      return;
    running = true;
    try {
      while (true) {
        if (broken || paused || !(data && at < data.length || next()))
          break;
        part ? fill() : frame();
      }
    } finally {
      running = false;
    }
  }
  function invalid(length) {
    if (length >= 4 && length <= largest)
      return false;
    broken = true;
    chunks.length = 0;
    data = part = null;
    at = filled = 0;
    const error = Object.assign(new Error("The server sent a message with an invalid length (" + length + ")"), { code: "PROTOCOL_ERROR" });
    onerror && onerror(error);
    return true;
  }
  function next() {
    data = chunks.shift() || null;
    at = 0;
    return data !== null;
  }
  function frame() {
    const left = data.length - at;
    if (left < 5)
      return start(5);
    const length = data.readInt32BE(at + 1);
    if (invalid(length))
      return;
    const end = at + 1 + length;
    if (end > data.length)
      return start(end - at);
    const begin = at;
    at = end;
    onframe(data[begin], data, begin, end);
  }
  function start(length) {
    part = Buffer.allocUnsafe(length);
    shared && owned.add(part);
    filled = data.copy(part, 0, at);
    at = data.length;
  }
  function fill() {
    const n = data.copy(part, filled, at, at + part.length - filled);
    filled += n;
    at += n;
    if (filled < part.length)
      return;
    if (part.length === 5) {
      const head = part, length = head.readInt32BE(1);
      if (invalid(length))
        return;
      part = Buffer.allocUnsafe(1 + length);
      shared && owned.add(part);
      filled = head.copy(part);
      return filled === part.length && done();
    }
    done();
  }
  function done() {
    const x = part;
    part = null;
    onframe(x[0], x, 0, x.length);
  }
}
var errorFields = {
  83: "severity_local",
  86: "severity",
  67: "code",
  77: "message",
  68: "detail",
  72: "hint",
  80: "position",
  112: "internal_position",
  113: "internal_query",
  87: "where",
  115: "schema_name",
  116: "table_name",
  99: "column_name",
  100: "data_type_name",
  110: "constraint_name",
  70: "file",
  76: "line",
  82: "routine"
};
function error(x, start, end) {
  const fields = {};
  for (let i = start + 5;i < end - 1; ) {
    const zero = x.indexOf(0, i + 1);
    fields[errorFields[x[i]] || String.fromCharCode(x[i])] = x.toString("utf8", i + 1, zero);
    i = zero + 1;
  }
  fields.severity || (fields.severity = fields.severity_local);
  return fields;
}
var text = typeof Buffer.prototype.utf8Slice === "function" ? (x, start, end) => x.utf8Slice(start, end) : (x, start, end) => x.toString("utf8", start, end);
var u32 = (x, i) => (x[i] << 24 | x[i + 1] << 16 | x[i + 2] << 8 | x[i + 3]) >>> 0;
var u16 = (x, i) => x[i] << 8 | x[i + 1];
var field = (name, table, number, type) => ({ name, table, number, type });
function rowDescription(x, start, end, make = field) {
  const columns = new Array(x[start + 5] << 8 | x[start + 6]);
  for (let i = start + 7, j = 0;j < columns.length; j++) {
    let zero = i;
    while (x[zero] !== 0)
      zero++;
    columns[j] = make(text(x, i, zero), u32(x, zero + 1), u16(x, zero + 5), u32(x, zero + 7));
    i = zero + 19;
  }
  return columns;
}
function parameterDescription(x, start) {
  const oids = new Array(x.readUInt16BE(start + 5));
  for (let j = 0;j < oids.length; j++)
    oids[j] = x.readUInt32BE(start + 7 + j * 4);
  return oids;
}
function commandComplete(x, start, end) {
  const first = start + 5;
  let e = end - 1, count = null;
  while (true) {
    let s = e - 1;
    while (s >= first && x[s] >= 48 && x[s] <= 57)
      s--;
    if (s === e - 1 || s < first || x[s] !== 32)
      break;
    count === null && (count = +text(x, s + 1, e));
    e = s;
  }
  return { command: text(x, first, e), count };
}
function readyForQuery(x, start) {
  return String.fromCharCode(x[start + 5]);
}
function notification(x, start) {
  const zero = x.indexOf(0, start + 9);
  return {
    pid: x.readInt32BE(start + 5),
    channel: x.toString("utf8", start + 9, zero),
    payload: x.toString("utf8", zero + 1, x.indexOf(0, zero + 1))
  };
}
function parameterStatus(x, start) {
  const zero = x.indexOf(0, start + 5);
  return [x.toString("utf8", start + 5, zero), x.toString("utf8", zero + 1, x.indexOf(0, zero + 1))];
}
function backendKeyData(x, start) {
  return { pid: x.readInt32BE(start + 5), secret: x.readInt32BE(start + 9) };
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/socket.js
import net3 from "node:net";
import tls2 from "node:tls";
var noop2 = () => {};
var agent = globalThis.navigator && globalThis.navigator.userAgent || "";
var workers = agent.startsWith("Cloudflare-Workers");
var onreadSafe = !agent || agent.startsWith("Node.js") || agent.startsWith("Bun") || agent.startsWith("Deno");
var node = !agent || agent.startsWith("Node.js");
var contexts = new WeakMap;
async function Socket(options, host, port, track = noop2) {
  const raw = options.socket ? await options.socket(options, host, port) : await connect(options, host, port, track);
  return wrap(raw, host);
}
function secureOptions(ssl) {
  return ssl === "require" || ssl === "allow" || ssl === "prefer" ? workers ? {} : { rejectUnauthorized: false } : typeof ssl === "object" ? context3(ssl) : {};
}
function context3(ssl) {
  if (!node || ssl.secureContext || !ssl.ca)
    return ssl;
  const values = { ...ssl };
  let last = contexts.get(ssl);
  last && same2(values, last.values) || contexts.set(ssl, last = { values, secureContext: tls2.createSecureContext(values) });
  return { ...values, secureContext: last.secureContext };
}
function same2(a, b) {
  return [...Object.keys(a), ...Object.keys(b)].every((k) => a[k] === b[k]);
}
var secured = (options) => !!options.ssl && options.ssl !== "disable";
var direct = (options) => secured(options) && options.sslnegotiation === "direct";
function connect(options, host, port, track) {
  return new Promise((resolve, reject) => {
    const tlsNow = direct(options), plain = !secured(options), reads = (plain || tlsNow) && onreadSafe && options.onread !== false && {
      buffer: Buffer.allocUnsafe(65536),
      callback: (n, b) => socket.ondata(b.subarray(0, n))
    }, target = options.path ? { path: options.path } : { port, host }, socket = tlsNow ? tls2.connect({
      ...target,
      servername: net3.isIP(host || "") || options.path ? undefined : host,
      ...secureOptions(options.ssl),
      ALPNProtocols: ["postgresql"],
      ...reads ? { onread: reads } : {}
    }) : net3.connect({ ...target, ...reads ? { onread: reads } : {} });
    track(socket);
    socket.shared = !!reads;
    socket.secure = tlsNow;
    socket.ondata = noop2;
    socket.once("error", reject);
    socket.once(tlsNow ? "secureConnect" : "connect", () => {
      socket.off("error", reject);
      socket.setNoDelay(true);
      resolve(socket);
    });
  });
}
function wrap(socket, host) {
  let closed = false, failure = null;
  socket.shared && (socket.ondata = data);
  const x = {
    ondata: noop2,
    ondrain: noop2,
    onclose: noop2,
    get raw() {
      return socket;
    },
    get closed() {
      return closed;
    },
    get shared() {
      return !!socket.shared;
    },
    get negotiated() {
      return !!socket.secure || !!socket.negotiated;
    },
    get serial() {
      return !!socket.serial;
    },
    certificate() {
      const x = typeof socket.getPeerCertificate === "function" && socket.getPeerCertificate();
      return x && x.raw || null;
    },
    write: (data) => !closed && socket.write(data),
    upgrade,
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    ref: () => socket.ref && socket.ref(),
    unref: () => socket.unref && socket.unref(),
    end(data) {
      closed || (data ? socket.end(data) : socket.end());
    },
    destroy(error) {
      error && !failure && (failure = error);
      socket.destroy();
    },
    keepAlive(seconds) {
      seconds && socket.setKeepAlive && socket.setKeepAlive(true, 1000 * seconds);
    }
  };
  listen();
  return x;
  function listen() {
    socket.on("data", data);
    socket.on("drain", drain);
    socket.on("error", error);
    socket.on("close", close);
  }
  function unlisten() {
    socket.off("data", data);
    socket.off("drain", drain);
    socket.off("error", error);
    socket.off("close", close);
  }
  function data(buffer) {
    x.ondata(buffer);
  }
  function drain() {
    x.ondrain();
  }
  function error(err) {
    failure || (failure = err);
    socket.destroy();
    close();
  }
  function close() {
    if (closed)
      return;
    closed = true;
    x.onclose(failure);
  }
  function upgrade(options = {}) {
    return new Promise((resolve, reject) => {
      unlisten();
      const secure = tls2.connect({
        socket,
        host: host || undefined,
        servername: net3.isIP(host || "") ? undefined : host,
        ...options
      });
      const fail = (err) => {
        secure.off("secureConnect", ready);
        reject(err);
      };
      function ready() {
        secure.off("error", fail);
        socket = secure;
        listen();
        resolve(x);
      }
      secure.once("secureConnect", ready);
      secure.once("error", fail);
    });
  }
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/startup.js
var noop3 = () => {};
var R = 82;
var S2 = 83;
var K = 75;
var E2 = 69;
var N = 78;
var D2 = 68;
var Z = 90;
async function open(options, signal = { aborted: false, sockets: new Set }, first = 0) {
  const hosts = options.path ? [null] : options.host, wanted = options.target_session_attrs, passes = wanted === "prefer-standby" ? ["standby", "any"] : [wanted || "any"];
  let last;
  for (const want of passes) {
    for (let n = 0;n < hosts.length; n++) {
      const i = (first + n) % hosts.length, host = hosts[i], port = options.port[i] || options.port[0], [failed, error, ready] = await traced2(options, host, port, signal).then((x) => [false, null, x], (x) => [true, x]);
      if (!failed && fits(want, ready.attributes))
        return ready.index = i, ready;
      failed || ready.socket.end(Terminate());
      last = failed ? error : Errors.connection("CONNECTION_DESTROYED", options, host, port);
      if (signal.aborted)
        throw last;
    }
  }
  throw last;
}
function traced2(options, host, port, signal) {
  if (!active(channels.connect))
    return attempt(options, host, port, signal);
  const context = {
    host: options.path ? null : host,
    port: options.path ? null : port,
    path: options.path || null,
    database: options.database,
    user: userName(options),
    ssl: secured(options),
    sslnegotiation: options.sslnegotiation || "postgres"
  };
  let promise;
  start(channels.connect, context, () => promise = attempt(options, host, port, signal));
  return promise.then((ready) => {
    finish(channels.connect, context, null, {
      pid: ready.backend.pid,
      status: ready.status,
      readOnly: ready.attributes.readOnly,
      standby: ready.attributes.standby
    });
    return ready;
  }, (error) => {
    finish(channels.connect, context, error);
    throw error;
  });
}
function fits(want, { readOnly, standby }) {
  return want === "any" || want === "read-write" && !readOnly || want === "read-only" && readOnly || want === "primary" && !standby || want === "standby" && standby;
}
function attempt(options, host, port, signal) {
  const { setTimeout: setTimeout2, clearTimeout: clearTimeout2 } = options.timers, fail = (code) => Errors.connection(code, options, host, port);
  return new Promise((resolve, reject) => {
    const timer = options.connect_timeout && setTimeout2(() => done(true, fail("CONNECT_TIMEOUT")), options.connect_timeout * 1000);
    let socket = null, raw = null, settled = false;
    session().then((x) => done(false, null, x), (e) => done(true, e));
    function done(failed, error, ready) {
      if (settled)
        return;
      settled = true;
      timer && clearTimeout2(timer);
      socket && signal.sockets.delete(socket);
      signal.aborted && !failed && (failed = true, error = fail("CONNECTION_DESTROYED"));
      if (failed) {
        socket ? socket.destroy() : raw && raw.destroy();
        return reject(error);
      }
      ready.socket.onclose = () => {};
      resolve(ready);
    }
    async function session() {
      socket = await Socket(options, host, port, (x) => raw = x);
      if (settled || signal.aborted)
        return socket.destroy(), done(true, fail("CONNECTION_DESTROYED"));
      signal.sockets.add(socket);
      socket.onclose = (error) => done(true, signal.aborted ? fail("CONNECTION_DESTROYED") : error && error.code ? error : fail("CONNECTION_CLOSED"));
      socket.keepAlive(options.keep_alive);
      await negotiate(socket, options);
      const user = typeof options.user === "function" ? await options.user() : options.user;
      return startup(user, options.database || user);
    }
    function startup(user, database) {
      return new Promise((resolve, reject) => {
        const stored = () => pgpass(options.passfile, options.path ? "localhost" : host, port, database, user) || "", auth = Auth({ user, pass: options.pass || stored, binding: options.channel_binding, socket }), parameters = {}, backend = { pid: null, secret: null }, frames = Frames(frame, false, (error) => (reject(error), socket.destroy())), rows = [];
        let probing = false, status = null, authing = Promise.resolve();
        socket.ondata = (x) => frames.push(x);
        socket.write(Startup({ user, database, client_encoding: "UTF8", ...options.connection }));
        function frame(type, x, start, end) {
          try {
            type === R ? authenticate(Buffer.from(x.subarray(start, end))) : type === S2 ? (([k, v]) => parameters[k] = v)(parameterStatus(x, start)) : type === K ? Object.assign(backend, backendKeyData(x, start)) : type === E2 ? reject(Errors.postgres(error(x, start, end))) : type === N ? notice(error(x, start, end)) : type === D2 ? rows.push(x.toString("utf8", start + 11, start + 11 + x.readInt32BE(start + 7))) : type === Z && settled(readyForQuery(x, start), Buffer.from(x.subarray(end)));
          } catch (error) {
            reject(error);
          }
        }
        function notice(x) {
          try {
            options.onnotice ? options.onnotice(x) : options.onnotice === false || console.log(x);
          } catch (error) {
            noop3(error);
          }
        }
        function authenticate(x) {
          authing = authing.then(() => auth(x)).then((reply) => reply && socket.write(reply));
          authing.catch((error) => (reject(error), socket.destroy()));
        }
        function settled(x, rest) {
          authing.then(() => ready(x, rest), () => {});
        }
        function ready(x, rest) {
          if (!auth.authenticated)
            return reject(Errors.generic("AUTHENTICATION_INCOMPLETE", "The server was ready before it accepted the authentication"));
          status = x;
          const known = "in_hot_standby" in parameters && "default_transaction_read_only" in parameters;
          if (options.target_session_attrs && !known && !probing) {
            probing = true;
            return socket.write(Query2("show transaction_read_only; select pg_catalog.pg_is_in_recovery()"));
          }
          frames.pause();
          socket.ondata = () => {};
          socket.pause();
          resolve({
            socket,
            rest,
            backend,
            parameters,
            status,
            attributes: {
              readOnly: (known ? parameters.default_transaction_read_only : rows[0]) === "on",
              standby: known ? parameters.in_hot_standby === "on" : rows[1] === "t"
            },
            host,
            port,
            cancel: () => cancel2(options, host, port, backend)
          });
        }
      });
    }
  });
}
async function negotiate(socket, options) {
  if (!secured(options) || socket.negotiated)
    return;
  const ssl = options.ssl, tls = secureOptions(ssl);
  if (options.sslnegotiation === "direct")
    return socket.upgrade({ ...tls, ALPNProtocols: ["postgresql"] });
  const answer = new Promise((r) => socket.ondata = (x) => r(x[0]));
  socket.write(SSLRequest());
  if (await answer === S2)
    return socket.upgrade(tls);
  if (ssl !== "prefer" && ssl !== "allow")
    throw Errors.generic("SSL_NOT_SUPPORTED", "The server does not support SSL connections");
}
function cancel2(options, host, port, { pid, secret }) {
  const { setTimeout: setTimeout2, clearTimeout: clearTimeout2 } = options.timers;
  return new Promise((resolve, reject) => {
    let socket = null, raw = null, written = false, settled = false;
    const limit = options.cancel_timeout || options.connect_timeout, timer = limit && setTimeout2(() => done(!written && Errors.connection("CONNECT_TIMEOUT", options, host, port)), limit * 1000);
    Socket(options, host, port, (x) => raw = x).then(async (x) => {
      socket = x;
      if (settled)
        return socket.destroy();
      await negotiate(socket, options);
      socket.onclose = () => done();
      written = true;
      socket.end(Cancel(pid, secret));
    }).catch(done);
    function done(error) {
      if (settled)
        return;
      settled = true;
      timer && clearTimeout2(timer);
      socket ? socket.destroy() : raw && raw.destroy();
      error ? reject(error) : resolve();
    }
  });
}
var salted = new Map;
function Auth({ user, pass, binding = "prefer", socket }) {
  let nonce, signature, verified = true, bound = false, header = "n,,";
  respond.authenticated = false;
  return respond;
  async function respond(x) {
    const type = x.readInt32BE(5);
    if ((type === 3 || type === 5) && binding === "require")
      throw unbound("the server asked for " + (type === 3 ? "a cleartext" : "an MD5") + " password");
    return type === 0 ? ok() : type === 3 ? Password(await password()) : type === 5 ? Password("md5" + md5(Buffer.concat([Buffer.from(md5(await password() + user)), x.subarray(9, 13)]))) : type === 10 ? start(x) : type === 11 ? proceed(x, await password()) : type === 12 ? finish(x) : unsupported(type);
  }
  function start(x) {
    const offered = x.toString("utf8", 9).split("\x00"), certificate = binding !== "disable" && socket && socket.certificate && socket.certificate(), hash = certificate && endpoint(certificate), plus = !!hash && offered.includes("SCRAM-SHA-256-PLUS");
    if (binding === "require" && !plus)
      throw unbound(offered.includes("SCRAM-SHA-256-PLUS") ? "the server certificate could not be hashed for it" : "the server did not offer it");
    if (!plus && !offered.includes("SCRAM-SHA-256"))
      throw Errors.generic("SASL_MECHANISM_NOT_SUPPORTED", "The server offered no supported SASL mechanism");
    header = plus ? "p=tls-server-end-point,," : hash ? "y,," : "n,,";
    bound = plus ? hash : false;
    nonce = crypto.randomBytes(18).toString("base64");
    verified = false;
    return SASL(plus ? "SCRAM-SHA-256-PLUS" : "SCRAM-SHA-256", header + "n=*,r=" + nonce);
  }
  function proceed(x, pass) {
    const res = x.toString("utf8", 9).split(",").reduce((acc, x) => (acc[x[0]] = x.slice(2), acc), {}), key = sha256(pass + "\x00" + res.s + "\x00" + res.i).toString("base64");
    if (!res.r.startsWith(nonce))
      throw Errors.generic("SASL_NONCE_MISMATCH", "The server nonce does not start with the client nonce");
    if (!salted.has(key)) {
      salted.size >= 64 && salted.delete(salted.keys().next().value);
      salted.set(key, crypto.pbkdf2Sync(pass, Buffer.from(res.s, "base64"), +res.i, 32, "sha256"));
    }
    const saltedPassword = salted.get(key), clientKey = hmac(saltedPassword, "Client Key"), channel = (bound ? Buffer.concat([Buffer.from(header), bound]) : Buffer.from(header)).toString("base64"), auth = "n=*,r=" + nonce + ",r=" + res.r + ",s=" + res.s + ",i=" + res.i + ",c=" + channel + ",r=" + res.r;
    signature = hmac(hmac(saltedPassword, "Server Key"), auth).toString("base64");
    return SASLResponse("c=" + channel + ",r=" + res.r + ",p=" + xor(clientKey, hmac(sha256(clientKey), auth)).toString("base64"));
  }
  function finish(x) {
    if (!signature || x.toString("utf8", 9).split("\x00", 1)[0].slice(2) !== signature)
      throw Errors.generic("SASL_SIGNATURE_MISMATCH", "The server did not return the correct signature");
    verified = true;
    return null;
  }
  function ok() {
    if (!verified)
      throw Errors.generic("SASL_SIGNATURE_MISMATCH", "The server ended SCRAM authentication without proving it knows the password");
    if (binding === "require" && !bound)
      throw unbound("the server authenticated without it");
    respond.authenticated = true;
    return null;
  }
  function unsupported(type) {
    throw Errors.generic("AUTH_TYPE_NOT_IMPLEMENTED", "Authentication type " + type + " is not supported");
  }
  function password() {
    return Promise.resolve(typeof pass === "function" ? pass() : pass);
  }
}
function unbound(reason) {
  return Errors.generic("CHANNEL_BINDING_REQUIRED", "channel_binding is require, but " + reason);
}
var signatures = {
  "2a864886f70d010104": "sha256",
  "2a864886f70d010105": "sha256",
  "2a864886f70d01010e": "sha224",
  "2a864886f70d01010b": "sha256",
  "2a864886f70d01010c": "sha384",
  "2a864886f70d01010d": "sha512",
  "2a8648ce3d0401": "sha256",
  "2a8648ce3d040301": "sha224",
  "2a8648ce3d040302": "sha256",
  "2a8648ce3d040303": "sha384",
  "2a8648ce3d040304": "sha512",
  "2a8648ce380403": "sha256",
  "608648016503040302": "sha256"
};
var digests = {
  "2b0e03021a": "sha256",
  "608648016503040201": "sha256",
  "608648016503040202": "sha384",
  "608648016503040203": "sha512",
  "608648016503040204": "sha224"
};
function endpoint(certificate) {
  try {
    const x = Buffer.from(certificate), algorithm = signature(x);
    return algorithm ? crypto.createHash(algorithm).update(x).digest() : null;
  } catch (_) {
    return null;
  }
}
function signature(x) {
  const certificate = der(x, 0), tbs = der(x, certificate.body), algorithm = der(x, tbs.end), oid = der(x, algorithm.body), name = x[oid.start] === 6 && x.toString("hex", oid.body, oid.end);
  if (name !== "2a864886f70d01010a")
    return signatures[name];
  if (oid.end >= algorithm.end)
    return "sha256";
  const params = der(x, oid.end), first = params.body < params.end && der(x, params.body);
  if (!first || x[first.start] !== 160)
    return "sha256";
  const hash = der(x, der(x, first.body).body);
  return digests[x.toString("hex", hash.body, hash.end)];
}
function der(x, start) {
  let length = x[start + 1], body = start + 2;
  if (length & 128) {
    const n = length & 127;
    length = 0;
    for (let i = 0;i < n; i++)
      length = length * 256 + x[body + i];
    body += n;
  }
  if (body + length > x.length)
    throw new Error("Truncated certificate");
  return { start, body, end: body + length };
}
function md5(x) {
  return crypto.createHash("md5").update(x).digest("hex");
}
function hmac(key, x) {
  return crypto.createHmac("sha256", key).update(x).digest();
}
function sha256(x) {
  return crypto.createHash("sha256").update(x).digest();
}
function xor(a, b) {
  const x = Buffer.allocUnsafe(a.length);
  for (let i = 0;i < a.length; i++)
    x[i] = a[i] ^ b[i];
  return x;
}
function pgpass(file, host, port, database, user) {
  if (!file)
    return null;
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || process.platform !== "win32" && stat.mode & 63)
      return null;
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return null;
  }
  const wanted = [host, String(port), database, user];
  for (const line of text.split(/\r?\n/)) {
    const fields = line && line[0] !== "#" ? split(line) : [];
    if (fields.length === 5 && wanted.every((x, i) => fields[i] === "*" || fields[i] === x))
      return fields[4];
  }
  return null;
}
function split(line) {
  const fields = [];
  let field = "";
  for (let i = 0;i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length)
      field += line[++i];
    else if (c === ":" && fields.length < 4)
      fields.push(field), field = "";
    else
      field += c;
  }
  fields.push(field);
  return fields;
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/connection.js
import Stream from "node:stream";
var slow = 100;
var notable = 5;
var text2 = text;
var noop4 = () => {};
var ending = /^\s*(commit|end|abort|rollback(?!\s+to\b)|prepare\s+transaction)\b/i;
var limit = 1000;
var refused = "postgres.js: query could not be built";
var skip = Symbol("skip");
var held = Symbol("held");
var unknown = 100;
var states = new WeakMap;
var after = 16;
var variety = 16;
var ids = 1;
var compiles = true;
function Connection(ready, options, events) {
  const { socket } = ready, timers = options.timers, defer = timers.nextTick || process.nextTick, { transform } = options, sent = [], pending = [], running = new Set, open = new Set, prepared = new Map, out = Writer(), frames = Frames(frame, socket.shared, (error) => (connection.fatal = error, socket.destroy()));
  let blocker = null, stash = null, heard = timers.now(), rolling = false, fence = null, drained = null, status = ready.status, flushing = false, closed = null, closing = null, portals = 0, traced = 0, epoch = 0, headSince = 0, notables = 0;
  const connection = {
    id: ids++,
    host: ready.host,
    port: ready.port,
    backend: ready.backend,
    parameters: ready.parameters,
    prepared,
    lease: null,
    get status() {
      return status;
    },
    get inflight() {
      return sent.length + pending.length;
    },
    get exclusive() {
      return !!blocker && exclusive(blocker);
    },
    get copying() {
      return !!blocker && blocker.streaming && blocker.open;
    },
    get closed() {
      return closed;
    },
    get closing() {
      return !!closing;
    },
    send,
    batch,
    simple,
    describe: describe2,
    local,
    cancel,
    close: close2,
    destroy,
    go,
    ref: () => socket.ref(),
    unref: () => socket.unref(),
    backlog,
    heavy,
    get notable() {
      return notables > 0;
    }
  };
  socket.ondata = (x) => (heard = timers.now(), frames.push(x));
  socket.ondrain = ondrain;
  socket.onclose = onclose;
  ready.rest && ready.rest.length && frames.push(ready.rest);
  socket.resume();
  return connection;
  function ondrain() {
    const x = drained;
    drained = null;
    x && x();
  }
  function schedule(now) {
    if (now || out.length >= 65536)
      return flush2();
    flushing || (flushing = true, defer(flush2));
    return true;
  }
  function flush2() {
    flushing = false;
    if (closed)
      return out.take(), true;
    return out.length ? socket.write(out.take()) : true;
  }
  function holds(x) {
    return x.describing || x.described && socket.serial && !x.nosync && !x.done || x.gate && x.learn && !x.error || !!x.error && !x.done || x.flushing && !x.synced || x.streaming && x.open || x.alone && !x.done;
  }
  function exclusive(x) {
    return x.flushing || x.streaming || x.alone;
  }
  function refresh() {
    blocker && !holds(blocker) && (blocker = null);
    release();
  }
  function queue(x) {
    if (closed)
      return settleError(x, copy(closed));
    if (blocker && blocker.streaming && blocker.open)
      return settleError(x, Errors.generic("COPY_IN_PROGRESS", "You cannot execute queries during copy"));
    x.query && (x.query.state = connection.backend);
    if (fence)
      pending.splice(pending.indexOf(fence), 0, x);
    else if (x.ends && open.size)
      pending.push(fence = x);
    else if (blocker || pending.length)
      pending.push(x);
    else
      return write(x), schedule();
    release();
  }
  function release() {
    while (!blocker && pending.length && pending[0] !== fence)
      write(pending.shift());
    schedule();
  }
  function write(x) {
    if (x.kind === "local" && sent.length === 0)
      return queueMicrotask(() => settle(x));
    const mark = out.length;
    let result;
    try {
      result = x.write(x);
    } catch (error) {
      x.own = error;
      result = skip;
    }
    if (result === held) {
      out.truncate(mark);
      x.loose = false;
      blocker = sent.find((y) => y.gate && holds(y)) || null;
      blocker && blocker.nosync && !blocker.flushed && (blocker.flushed = true, flush(out), schedule());
      return pending.unshift(x);
    }
    if (result === skip) {
      out.truncate(mark);
      x.fresh = null;
      x.parses = [];
      x.portal = "";
      x.describing = x.synced = x.flushing = x.open = false;
      if (x.batch) {
        x.entry = null;
        parse(out, "", refused);
        x.parses = [""];
        abort(x);
      } else if (!x.own || x.kind === "step" || !connection.lease) {
        x.kind = "local";
        x.cost >= notable && notables--;
        x.cost = undefined;
        return sent.length === 0 ? queueMicrotask(() => settle(x)) : sent.push(x);
      } else {
        x.kind = "simple";
        x.text = refused;
        x.results = [];
        x.entry = null;
        sync2(x, true);
      }
    }
    x.fresh && register(x.fresh);
    x.portal && x.kind === "query" && open.add(x);
    x.query && (x.query.active = sent.length === 0);
    x.ends && epoch++;
    x.epoch = epoch;
    options.scheduler && sent.length === 0 && (headSince = timers.now());
    sent.push(x);
    holds(x) && (blocker = x);
    x.trace && wrote(x);
  }
  function sync2(x, refuse) {
    if (x.synced)
      return;
    x.synced = true;
    refuse ? query2(out, refused) : sync(out);
    schedule();
  }
  function register(entry) {
    const current = prepared.get(entry.name);
    current && prepared.delete(entry.name);
    prepared.set(entry.name, entry);
    entry.owner.entry = entry;
    entry.owner.fresh = null;
    if (prepared.size <= limit)
      return;
    for (const [name, x] of prepared) {
      if (x.state !== "parsing") {
        prepared.delete(name);
        close(out, "S", name);
        return;
      }
    }
  }
  function drop(entry) {
    prepared.get(entry.name) === entry && prepared.delete(entry.name);
  }
  function send(query) {
    const { statement } = query.wire, x = Exchange("query", query, connection.lease, extended);
    x.statement = statement;
    x.ends = statement.ends === undefined ? statement.ends = ending.test(statement.text) : statement.ends;
    options.scheduler && cost(x);
    queue(x);
  }
  function batch(query, parts) {
    const b = {
      query,
      parts,
      results: new Array(parts.length),
      settled: new Array(parts.length).fill(false),
      left: parts.length,
      error: null,
      index: -1,
      aborted: null
    };
    parts.forEach((part, i) => {
      part.resolve = (result) => batched(b, i, null, result);
      part.reject = (error) => batched(b, i, error);
      if (b.aborted)
        return batched(b, i, skipped(b.aborted, i));
      const x = Exchange("query", part, connection.lease, extended);
      x.statement = part.wire.statement;
      x.ends = x.statement.ends === undefined ? x.statement.ends = ending.test(x.statement.text) : x.statement.ends;
      x.batch = b;
      x.nosync = i < parts.length - 1;
      options.scheduler && cost(x);
      queue(x);
    });
  }
  function batched(b, i, error, result) {
    if (b.settled[i])
      return;
    b.settled[i] = true;
    b.left--;
    error ? (b.error === null || i < b.index && !error.skipped) && (b.error = error, b.index = i) : b.results[i] = result;
    if (b.left)
      return;
    const { query, parts, results } = b;
    if (b.error) {
      b.error.index = b.index;
      parts.forEach((part, j) => {
        Query.prototype.reject.call(part, j === b.index ? b.error : skipped(b.error, b.index));
        part.catch(noop4);
      });
      return query.reject(b.error);
    }
    parts.forEach((part, j) => Query.prototype.resolve.call(part, results[j]));
    query.resolve(results);
  }
  function skipped(error, index) {
    const x = copy(error);
    x.index = index;
    x.skipped = true;
    return x;
  }
  function part(x) {
    sent.shift();
    options.scheduler && timed(x);
    x.done = true;
    x.open = false;
    x.trace && traced--;
    blocker === x && (blocker = null);
    settle(x);
    const next = sent[0];
    if (next && next.query) {
      next.query.active = true;
      next.cancel && turn(next);
    }
    release();
  }
  function abort(x) {
    if (x.aborted)
      return;
    x.aborted = true;
    const b = x.batch, error = x.own || x.error;
    b.aborted = error;
    let synced = !x.nosync && x.synced;
    const at = sent.indexOf(x);
    for (let i = at === -1 ? sent.length : at + 1;i < sent.length; ) {
      const y = sent[i];
      if (y.batch === b) {
        sent.splice(i, 1);
        synced = synced || !y.nosync && y.synced;
        drop(y);
        blocker === y && (blocker = null);
      } else {
        i++;
      }
    }
    for (let i = 0;i < pending.length; ) {
      const y = pending[i];
      y.batch === b ? (pending.splice(i, 1), drop(y)) : i++;
    }
    synced || sync(out);
    x.nosync = false;
    x.synced = true;
    schedule();
    function drop(y) {
      y.entry && y.entry.owner === y && y.entry.state === "parsing" && (y.entry.state = "stale");
      y.done = true;
      y.trace && traced--;
      y.cost >= notable && notables--;
      settleError(y, skipped(error, b.parts.indexOf(y.query)));
    }
  }
  function cost(x) {
    const { query } = x;
    query.cost && !query.cursorFn && !query.streaming && (x.cost = query.cost.est === undefined ? unknown : query.cost.est);
    x.cost >= notable && notables++;
  }
  function timed(x) {
    const t = timers.now();
    if (x.cost !== undefined) {
      x.cost >= notable && notables--;
      const sample = t - headSince, c = x.query.cost;
      c.est = c.est === undefined || sample > c.est ? sample : c.est + (sample - c.est) * 0.1;
      events.ontimed && events.ontimed(sample, t);
    }
    headSince = t;
  }
  function backlog(t) {
    let w = 0;
    for (let i = 0;i < sent.length; i++) {
      const e = sent[i].cost || 0;
      if (i === 0) {
        const elapsed = t - headSince;
        w += elapsed < e ? e - elapsed : elapsed;
      } else {
        w += e;
      }
    }
    for (let i = 0;i < pending.length; i++)
      w += pending[i].cost || 0;
    return w;
  }
  function heavy() {
    for (let i = 0;i < sent.length; i++) {
      if (sent[i].cost >= slow)
        return true;
    }
    for (let i = 0;i < pending.length; i++) {
      if (pending[i].cost >= slow)
        return true;
    }
    return false;
  }
  function extended(x) {
    const { query } = x, { built } = query.wire, statement = x.statement, name = statement.name, current = name ? prepared.get(name) : null;
    if (query.cursorFn) {
      x.rows = query.cursorRows;
      x.portal = transaction() ? "c" + portals++ : "";
      x.flushing = !x.portal;
    }
    x.streaming = x.open = !!query.streaming;
    if (current && current.state === "parsing" && current.oids === null && current.owner && !current.owner.error) {
      if (!current.owner.loose)
        throw Errors.generic("STATEMENT_PENDING", "A statement was used before its description arrived");
      current.owner.gate = true;
      return held;
    }
    if (current && current !== x.previous && usable(current, statement)) {
      const b = query.isRaw === true || query.ownParsers ? null : binaries(current);
      x.entry = current;
      x.columns = b ? b.columns : current.columns;
      x.formats = b ? b.formats : null;
      x.values = serialize(current.oids, built, current);
      return run2(x, name);
    }
    if (x.retried) {
      x.verify = true;
      parse(out, "", statement.text, built.oids);
      describe(out, "S", "");
      flush(out);
      x.describing = true;
      return;
    }
    const typed = !inferred(built);
    name && (x.fresh = Entry(name, x, typed ? built.oids : null));
    current && close(out, "S", name);
    parse2(x, name, statement.text, built.oids);
    describe(out, "S", name);
    if (!typed && !loose(x, built)) {
      flush(out);
      x.describing = true;
      return;
    }
    x.learn = true;
    x.values = typed ? serialize(built.oids, built, x.fresh || {}) : untyped(built);
    run2(x, name);
  }
  function binaries(entry) {
    if (entry.binaryOf === entry.columns)
      return entry.binary;
    const columns = entry.columns, formats = new Array(columns.length);
    let binary = null;
    for (let i = 0;i < columns.length; i++) {
      const decode = events.binary(columns[i].type);
      formats[i] = decode ? 1 : 0;
      decode && ((binary || (binary = columns.slice()))[i] = { ...columns[i], decode });
    }
    entry.binaryOf = columns;
    return entry.binary = binary && { columns: binary, formats };
  }
  function loose(x, built) {
    if (!events.plain || x.query.cursorFn || x.streaming)
      return false;
    const { oids, values } = built;
    for (let i = 0;i < oids.length; i++) {
      if (!oids[i] && values[i] !== null && !(typeof values[i] === "number" && isFinite(values[i])))
        return false;
    }
    return x.loose = true;
  }
  function untyped(built) {
    const { oids, values } = built, out = new Array(values.length);
    for (let i = 0;i < values.length; i++)
      out[i] = values[i] === null ? null : oids[i] ? events.serializer(oids[i])(values[i]) : "" + values[i];
    return out;
  }
  function parse2(x, name, text, oids) {
    parse(out, name, text, oids);
    x.parses.push(name);
  }
  function run2(x, name) {
    const mark = out.length;
    try {
      x.nosync ? (bind(out, x.portal, name, x.values, undefined, x.formats || undefined), execute(out, x.portal, x.rows)) : run(out, x.portal, name, x.values, x.rows, x.flushing, x.formats);
    } catch (error) {
      out.truncate(mark);
      throw error;
    }
    x.flushing || (x.synced = true);
    const oids = x.entry ? x.entry.oids : x.params || (x.loose ? null : x.query.wire.built.oids);
    oids ? debug(x.statement.text, x.values, oids) : x.later = true;
  }
  function logged(item, oids) {
    item.later && oids && (item.later = false, debug(item.statement.text, item.values, oids));
  }
  function usable(entry, statement) {
    return entry.oids !== null && (entry.state === "parsing" || entry.state === "ready" && entry.version === statement.version);
  }
  function learned(entry, statement) {
    const shape = entry.oids.join() + ":" + entry.columns.map((x) => x.type).join();
    if (statement.shape !== shape) {
      statement.shape === undefined || statement.version++;
      statement.shape = shape;
    }
    entry.version = statement.version;
  }
  function inferred(built) {
    for (let i = 0;i < built.oids.length; i++) {
      if (!built.oids[i])
        return true;
    }
    return false;
  }
  function serialize(oids, built, cache) {
    const serializers = cache.serializers || (cache.serializers = oids.map(events.serializer)), values = built.values, out = new Array(values.length);
    for (let i = 0;i < values.length; i++) {
      out[i] = values[i] === null ? null : serializers[i](values[i]);
      out[i] === null || out[i] === undefined || typeof out[i] === "string" || out[i] instanceof Uint8Array || Buffer.byteLength(out[i]);
    }
    return out;
  }
  function transaction() {
    return !!connection.lease && connection.lease.kind === "transaction";
  }
  function described(x) {
    x.describing = false;
    x.described = true;
    const { built } = x.query.wire, name = x.statement.name, params = x.params || [], columns = x.columns || [];
    try {
      if (x.verify) {
        const previous = x.previous;
        if (previous && same(previous, params, columns)) {
          if (x.original) {
            x.own = x.original;
            return sync2(x);
          }
        } else if (previous) {
          stale(previous);
          x.statement.version++;
        }
        x.values = serialize(params, built, {});
        return run2(x, "");
      }
      const entry = x.entry;
      entry && (entry.oids = params, entry.columns = columns, learned(entry, x.statement));
      x.values = serialize(params, built, entry || {});
      run2(x, name);
    } catch (error) {
      x.own = error;
      x.batch ? (parse(out, "", refused), x.parses.push(""), abort(x)) : sync2(x, !!connection.lease);
    }
  }
  function same(entry, params, columns) {
    const a = entry.oids || [], b = entry.columns;
    return !!b && a.length === params.length && params.every((x, i) => x === a[i]) && b.length === columns.length && columns.every((x, i) => x.type === b[i].type);
  }
  function describe2(statement, oids, query) {
    return new Promise((resolve, reject) => {
      const x = Exchange("describe", null, connection.lease, (x) => {
        parse(out, "", statement.text, oids);
        describe(out, "S", "");
        sync2(x);
      });
      x.for = query || null;
      x.resolve = resolve;
      x.reject = reject;
      queue(x);
    });
  }
  function simple(query, sql) {
    const x = Exchange("simple", query, connection.lease, (x) => {
      debug(sql, [], []);
      query2(out, sql);
      x.synced = true;
    });
    x.text = sql;
    x.results = [];
    x.ends = ending.test(sql);
    x.streaming = x.open = !!query.streaming;
    options.scheduler && cost(x);
    queue(x);
  }
  function local(query, error) {
    queue(Exchange("query", query, connection.lease, () => {
      throw error;
    }));
  }
  function cancel(query) {
    if (query.parts)
      return cancelBatch(query);
    if (stash && sent[0] && sent[0].query === query) {
      sent[0].own = Errors.generic("57014", "canceling statement due to user request");
      go();
      return Promise.resolve();
    }
    if (running.has(query) || sent[0] && sent[0].query === query && sent[0].awaiting)
      return query.aborted = Errors.generic("57014", "canceling statement due to user request"), Promise.resolve();
    const i = pending.findIndex((x) => x.query === query || x.for === query);
    if (i !== -1) {
      const [x] = pending.splice(i, 1);
      x === fence && (fence = null);
      x.cost >= notable && notables--;
      settleError(x, Errors.generic("57014", "canceling statement due to user request"));
      release();
      return Promise.resolve();
    }
    const x = sent.find((x) => x.query === query || x.for === query);
    if (!x)
      return Promise.resolve();
    if (x === sent[0] && x.completed)
      return expect(x), Promise.resolve();
    if (x === sent[0] && (query.active || x.for))
      return cancelling(x);
    quiet(x);
    return new Promise((resolve, reject) => x.cancel = { resolve, reject });
  }
  function turn(x) {
    x.silence && (timers.clearTimeout(x.silence), x.silence = null);
    const go = () => {
      x.silence = null;
      if (closed || x.done || sent[0] !== x)
        return x.cancel.resolve();
      if (x.completed)
        return expect(x), x.cancel.resolve();
      cancelling(x).then(x.cancel.resolve, x.cancel.reject);
    };
    x.query && x.query.timedOut && options.query_timeout ? x.silence = timers.setTimeout(go, options.query_timeout * 1000) : defer(go);
  }
  function quiet(x) {
    if (!options.cancel_timeout || x.silence)
      return;
    const ms = options.cancel_timeout * 1000, check = () => {
      x.silence = null;
      const query = x.query || x.for;
      if (closed || x.done || !query || query.settled)
        return;
      const idle = timers.now() - heard;
      idle >= ms ? destroy(Errors.generic("CANCEL_UNANSWERED", "The server sent nothing within cancel_timeout (" + options.cancel_timeout + " seconds) while a canceled query waited, so whether it ran is unknown")) : x.silence = timers.setTimeout(check, ms - idle);
    };
    x.silence = timers.setTimeout(check, ms);
  }
  function cancelling(x) {
    expect(x);
    return ready.cancel();
  }
  function expect(x) {
    options.cancel_timeout && !x.unanswered && (x.unanswered = timers.setTimeout(() => unanswered(x), options.cancel_timeout * 1000));
  }
  function unanswered(x) {
    x.unanswered = null;
    const query = x.batch ? x.batch.query : x.query || x.for;
    if (closed || x.done && !x.batch || !query || query.settled)
      return;
    destroy(Errors.generic("CANCEL_UNANSWERED", "The server did not answer within cancel_timeout (" + options.cancel_timeout + " seconds) after a query was canceled, " + "so whether it ran is unknown"));
  }
  function answered(x) {
    x.silence && (timers.clearTimeout(x.silence), x.silence = null);
    x.unanswered && (!x.batch || x.batch.query.settled) && (timers.clearTimeout(x.unanswered), x.unanswered = null);
  }
  function cancelBatch(query) {
    const x = sent.find((x) => x.batch && x.batch.query === query);
    if (x)
      return x === sent[0] ? cancelling(x) : new Promise((resolve, reject) => x.cancel = { resolve, reject });
    const first = pending.find((x) => x.batch && x.batch.query === query);
    if (first) {
      first.own = Errors.generic("57014", "canceling statement due to user request");
      first.write = () => {
        throw first.own;
      };
    }
    return Promise.resolve();
  }
  function close2() {
    closing || (closing = new Promise((r) => {
      connection.onended = r;
      idle() && terminate();
    }));
    return closing;
  }
  function idle() {
    return sent.length === 0 && pending.length === 0;
  }
  function terminate() {
    if (closed)
      return connection.onended && connection.onended();
    flush2();
    socket.end(Terminate());
  }
  function destroy(error) {
    closing || (closing = Promise.resolve());
    socket.destroy(error);
  }
  function onclose(error) {
    if (closed)
      return;
    out.take();
    blocker = null;
    fence = null;
    notables = 0;
    const head = sent[0], failed = head && head.error && head.error.severity === "FATAL" ? head.error : null, fatal = connection.fatal || failed;
    connection.uncertain = !!(fatal && head && head.ends);
    closed = Errors.connection(closing ? "CONNECTION_DESTROYED" : "CONNECTION_CLOSED", options, ready.host, ready.port);
    closed.cause = fatal || error || undefined;
    sent.concat(pending).forEach((x) => x.cancel && x.cancel.resolve());
    sent.splice(0).forEach((x) => {
      x.stream && x.stream.destroy(closed);
      x.own ? settle(x) : failed ? settleError(x, x === head ? failed : copy(failed)) : settleError(x, copy(closed));
    });
    pending.splice(0).forEach((x) => x.own ? settle(x) : settleError(x, copy(closed)));
    running.forEach((query) => query.settled || query.reject(decorate(query, copy(closed))));
    running.clear();
    open.clear();
    connection.onended && connection.onended();
    events.onclose(connection, closed);
  }
  function decorate(query, error) {
    return queryError(error, query, options.debug);
  }
  function settleError(x, error) {
    answered(x);
    x.kind === "describe" ? x.reject(error) : x.query && !x.query.settled && x.query.reject(decorate(x.query, error));
  }
  function debug(text, values, oids) {
    typeof options.debug === "function" && options.debug(connection.id, text, values, oids);
  }
  function wrote(x) {
    const trace = x.trace;
    traced++;
    trace.query = x.text || x.statement.text;
    trace.statement = x.statement ? x.statement.name : "";
    trace.parameters = options.debug ? x.query.parameters : undefined;
    trace.connection = connection.id;
    trace.host = connection.host;
    trace.port = connection.port;
    trace.sent = now();
  }
  function first() {
    const x = sent[0];
    x && x.trace && x.trace.firstByte === null && (x.trace.firstByte = now());
  }
  function frame(type, x, start, end) {
    if (!events.typed && stash === null && (type === 84 || type === 116) && events.unknown(type === 84 ? rowDescription(x, start, end, oidOf) : parameterDescription(x, start))) {
      stash = { type, x: Buffer.from(x.subarray(start, end)) };
      frames.pause();
      return events.need(connection);
    }
    dispatch(type, x, start, end);
  }
  function go() {
    if (!stash)
      return;
    const { type, x } = stash;
    dispatch(type, x, 0, x.length);
    stash = null;
    frames.resume();
  }
  function dispatch(type, x, start, end) {
    traced && first();
    try {
      type === 68 ? DataRow(x, start) : type === 100 ? CopyData(x, start, end) : type === 90 ? ReadyForQuery(x, start) : type === 67 ? CommandComplete(x, start, end) : type === 50 ? BindComplete() : type === 49 ? ParseComplete() : type === 51 || (type === 116 ? ParameterDescription(x, start) : type === 84 ? RowDescription(x, start) : type === 110 ? NoData() : type === 69 ? ErrorResponse(x, start, end) : type === 115 ? PortalSuspended() : type === 73 ? EmptyQueryResponse() : type === 65 ? NotificationResponse(x, start) : type === 78 ? NoticeResponse(x, start, end) : type === 83 ? ParameterStatus(x, start) : type === 71 ? CopyInResponse() : type === 72 ? CopyOutResponse() : type === 87 ? CopyBothResponse() : type === 99 ? CopyDone() : type === 86 ? unsupported("FunctionCallResponse") : type === 118 && unsupported("NegotiateProtocolVersion"));
    } catch (error) {
      const x = sent[0];
      x ? fail(x, error) : destroy(error);
    }
    blocker && !holds(blocker) && (blocker = null, release());
    out.length && schedule();
  }
  function fail(x, error) {
    x.error = x.error || error;
    x.describing = false;
    x.open = false;
    x.batch ? abort(x) : sync2(x);
  }
  function unsupported(x) {
    sent[0] && fail(sent[0], Errors.notSupported(x));
  }
  function ParseComplete() {
    const x = sent[0], name = x.parses.shift();
    name && x.entry && x.entry.name === name && x.entry.owner === x && x.entry.state === "parsing" && (x.entry.state = "ready");
  }
  function BindComplete() {
    const x = sent[0];
    x.bound = true;
    if (!x.columns && x.entry) {
      x.columns = x.entry.columns;
      x.result.columns = x.columns;
    }
  }
  function ParameterDescription(x, start) {
    const item = sent[0];
    item.params = parameterDescription(x, start);
    item.loose && item.entry && item.entry.owner === item && item.entry.oids === null && (item.entry.oids = item.params);
    logged(item, item.params);
  }
  function RowDescription(x, start) {
    received(sent[0], rowDescription(x, start, 0, column));
  }
  function NoData() {
    received(sent[0], []);
  }
  function received(x, columns) {
    if (x.kind === "simple" && x.result.command !== null) {
      x.results.push(x.result);
      x.result = new Result;
    }
    x.columns = columns;
    x.result.columns = columns;
    if (x.learn) {
      x.learn = false;
      x.entry && x.entry.owner === x && (x.entry.columns = columns, learned(x.entry, x.statement));
    }
    x.describing && described(x);
  }
  function column(name, table, number, type) {
    const parser = events.parser(type);
    return {
      name: transform.column.from ? transform.column.from(name) : name,
      parser: parser.identity ? null : parser,
      decode: events.decoder(type, parser),
      table,
      number,
      type
    };
  }
  function DataRow(x, start) {
    const item = sent[0], { query } = item, raw = query.isRaw, from = raw !== true ? transform.value.from : null, shape = item.shaped === item.columns ? item.reader : (item.shaped = item.columns, item.reader = query.ownParsers && raw !== true ? Parsed(item.columns, query.ownParsers) : Rows(item.columns)), columns = shape.columns, fast = raw !== true && read(shape, !!raw, text2, from), n = columns.length, result = item.result;
    let row;
    if (fast) {
      row = fast(x, start + 7);
    } else {
      row = raw ? new Array(n) : {};
      let i = start + 7;
      for (let j = 0;j < n; j++) {
        const length = x[i] << 24 | x[i + 1] << 16 | x[i + 2] << 8 | x[i + 3], column = columns[j];
        i += 4;
        let value = null;
        if (length !== -1) {
          value = raw === true ? Buffer.from(x.subarray(i, i + length)) : column.decode ? column.decode(x, i, i + length) : column.parser ? column.parser(text2(x, i, i + length)) : text2(x, i, i + length);
          i += length;
        }
        from && (value = from(value, column));
        raw ? row[j] = value : column.name === "__proto__" ? own2(row, column.name, value) : row[column.name] = value;
      }
    }
    const out = transform.row.from ? transform.row.from(row) : row;
    query.forEachFn ? query.forEachFn(out, result) : result[result.length] = out;
  }
  function CommandComplete(x, start, end) {
    const item = sent[0], { command, count } = commandComplete(x, start, end), result = item.result;
    result.command = command;
    result.count = count;
    result.state = connection.backend;
    result.statement = item;
    item.query && (item.query.source = item);
    item.kind === "simple" || (result.columns = result.columns || item.columns);
    item.final && (item.stream && Object.assign(item.stream, { count, command }), item.final(), item.final = null);
    item.kind !== "simple" && (item.completed = true);
    if (item.kind === "simple") {
      item.results.push(item.result);
      item.result = new Result;
      return;
    }
    if (item.rows) {
      item.finished = true;
      item.flushing && sync2(item);
      if (result.count || result.length)
        (item.last = new Promise((r) => r(item.query.cursorFn(result)))).catch(noop4);
    }
    item.nosync && !item.error && part(item);
  }
  function unsafe(item) {
    const error = () => Errors.generic("UNSAFE_TRANSACTION", "Only use sql.begin, sql.reserved or max: 1");
    rolling = true;
    item.own = error();
    sent.forEach((x) => x.kind !== "local" && (x.own = error()));
    pending.unshift(Exchange("internal", null, null, (x) => (query2(out, "rollback"), x.synced = true)));
  }
  function EmptyQueryResponse() {
    const item = sent[0];
    item.kind === "simple" && (item.results.push(item.result), item.result = new Result);
    item.nosync && !item.error && part(item);
  }
  async function PortalSuspended() {
    const item = sent[0];
    if (!item.flushing)
      return item.suspended = true;
    try {
      item.awaiting = true;
      const next = await item.query.cursorFn(item.result);
      item.awaiting = false;
      item.result = new Result;
      if (closed || item.synced || sent[0] !== item)
        return;
      if (item.query.aborted)
        throw item.query.aborted;
      next === CLOSE ? (close(out, "P", ""), sync2(item)) : (execute(out, "", item.rows), flush(out), schedule());
    } catch (error) {
      item.awaiting = false;
      if (closed || item.synced || sent[0] !== item)
        return;
      fail(item, error);
    }
    refresh();
  }
  function ErrorResponse(x, start, end) {
    const item = sent[0], error2 = Errors.postgres(error(x, start, end));
    if (!item)
      return connection.fatal = error2;
    item.stream && item.stream.destroy(error2);
    item.final && (item.final(error2), item.final = null);
    fail(item, error2);
  }
  function ReadyForQuery(x, start) {
    status = readyForQuery(x, start);
    frames.own(false);
    const item = sent.shift();
    options.scheduler && timed(item);
    item.done = true;
    item.open = false;
    item.trace && traced--;
    item.kind === "internal" && (rolling = false);
    status !== "I" && !rolling && !item.lease && !connection.lease && options.max !== 1 && unsafe(item);
    blocker === item && (blocker = null);
    settle(item);
    item.entry && item.entry.owner === item && (item.entry.owner = null);
    while (sent.length && sent[0].kind === "local")
      settle(sent.shift());
    release();
    const next = sent[0];
    if (next && next.query) {
      next.query.active = true;
      next.cancel && turn(next);
    }
    closing && idle() && terminate();
    events.onready(connection);
  }
  function settle(x) {
    answered(x);
    settling(x);
    x.batch && answered(x);
  }
  function settling(x) {
    if (x.kind === "internal")
      return;
    if (x.kind === "describe") {
      return x.error ? x.reject(x.error) : x.resolve({ params: x.params || [], columns: x.columns });
    }
    const { query } = x, cursor = x.origin || (x.portal ? x : null);
    cursor && (x.own || x.error || !x.suspended) && unfence(cursor);
    if (x.own)
      return query.reject(decorate(query, x.own));
    if (x.error)
      return failed(x);
    if (x.suspended)
      return suspended(x);
    x.last ? x.last.then(() => query.settled || finish(x), (error) => query.settled || query.reject(decorate(query, error))) : query.settled || finish(x);
  }
  function unfence(cursor) {
    if (!open.delete(cursor) || open.size || !fence)
      return;
    fence = null;
    release();
  }
  function failed(x) {
    const entry = x.kind === "query" ? x.entry : null;
    const parsing = x.fresh || entry && entry.owner === x && entry.state === "parsing";
    if (x.error.code === "42P05" && x.kind === "query" && x.statement.name && parsing) {
      entry && drop(entry);
      x.statement.name += "_";
      return retryable(x) ? again(x, null) : settleError(x, x.error);
    }
    if (!entry)
      return settleError(x, x.error);
    if (entry.owner === x && entry.state === "parsing")
      return drop(entry), settleError(x, x.error);
    if (x.error.code === "26000") {
      drop(entry);
      return retryable(x) ? again(x, null) : settleError(x, x.error);
    }
    if (x.bound)
      return settleError(x, x.error);
    if (retryable(x))
      return again(x, x.error);
    stale(entry);
    settleError(x, x.error);
  }
  function stale(entry) {
    prepared.get(entry.name) === entry && (entry.state = "stale");
  }
  function retryable(x) {
    return !x.retried && !x.batch && !x.cancel && !x.query.cancelled && !x.query.cursorFn && !x.streaming && x.lease === connection.lease && status === "I" && !closing && (sent.length === 0 || !x.lease && options.max !== 1);
  }
  function again(x, original) {
    const retry = Exchange("query", x.query, x.lease, extended);
    retry.statement = x.statement;
    retry.ends = x.ends;
    retry.retried = true;
    retry.original = original;
    retry.previous = x.entry;
    retry.trace = x.trace;
    retry.cost = x.cost;
    if (sent.length)
      return queue(retry);
    pending.unshift(retry);
    release();
  }
  function suspended(x) {
    const cursor = x.origin || x, { query } = x;
    running.add(query);
    new Promise((r) => r(query.cursorFn(x.result))).then((next) => {
      running.delete(query);
      if (query.settled)
        return unfence(cursor);
      queue(step(cursor, next === CLOSE || !!query.aborted, query.aborted || null));
    }, (error) => {
      running.delete(query);
      if (query.settled)
        return unfence(cursor);
      queue(step(cursor, true, error));
    });
  }
  function step(cursor, end, failure) {
    const x = Exchange("step", cursor.query, cursor.lease, stepped);
    x.origin = cursor;
    x.statement = cursor.statement;
    x.entry = cursor.entry;
    x.columns = cursor.columns;
    x.portal = cursor.portal;
    x.rows = cursor.rows;
    x.end = end;
    x.failure = failure;
    return x;
  }
  function stepped(x) {
    const cursor = x.origin;
    if (connection.lease !== cursor.lease || cursor.epoch !== epoch) {
      if (x.failure)
        throw x.failure;
      if (!x.end)
        throw outlived();
      return skip;
    }
    x.own = x.failure;
    x.end ? close(out, "P", x.portal) : execute(out, x.portal, x.rows);
    sync2(x);
  }
  function outlived() {
    return Errors.generic("UNSAFE_TRANSACTION", "The cursor outlived its transaction");
  }
  function finish(x) {
    const { query } = x;
    if (x.kind === "simple") {
      x.result.command !== null && x.results.push(x.result);
      const results = x.results;
      return query.resolve(results.length > 1 ? results : results[0] || x.result);
    }
    query.resolve(x.result);
  }
  function NotificationResponse(x, start) {
    const { pid, channel, payload } = notification(x, start);
    events.onnotify && guard(events.onnotify, channel, payload, pid);
  }
  function guard(fn, ...xs) {
    try {
      fn(...xs);
    } catch (error) {
      noop4(error);
    }
  }
  function NoticeResponse(x, start, end) {
    const notice = error(x, start, end);
    listened(channels.notice) && channels.notice.publish({
      notice,
      connection: connection.id,
      host: connection.host,
      port: connection.port,
      database: options.database
    });
    options.onnotice ? guard(options.onnotice, notice) : options.onnotice === false || console.log(notice);
  }
  function ParameterStatus(x, start) {
    const [k, v] = parameterStatus(x, start);
    connection.parameters[k] = v;
    events.onparameter && guard(events.onparameter, k, v);
  }
  function writeData(chunk, callback) {
    copyData(out, chunk);
    flush2() ? callback() : drained = callback;
  }
  function writable(item) {
    return {
      autoDestroy: true,
      write(chunk, encoding, callback) {
        writeData(chunk, callback);
      },
      destroy(error, callback) {
        callback(error);
        item.stream = null;
        if (!item.copied && !closed && !item.error) {
          copyFail(out, (error || "The COPY stream was destroyed") + "");
          item.copied = true;
          item.open = false;
          schedule(true);
          refresh();
        }
      },
      final(callback) {
        copyDone(out);
        item.copied = true;
        item.open = false;
        item.final = callback;
        schedule(true);
        refresh();
      }
    };
  }
  function CopyInResponse() {
    const item = sent[0];
    item.stream = new Stream.Writable(writable(item));
    item.query.resolve(item.stream);
  }
  function readable(item) {
    return () => {
      item.wanted = true;
      if (!frames.paused)
        return;
      frames.resume();
      frames.paused || socket.resume();
    };
  }
  function abandoned(item) {
    return (error, callback) => {
      callback(error);
      if (!item.stream)
        return;
      item.stream = null;
      if (frames.paused) {
        frames.resume();
        frames.paused || socket.resume();
      }
    };
  }
  function CopyOutResponse() {
    const item = sent[0];
    item.stream = new Stream.Readable({ read: readable(item), destroy: abandoned(item) });
    item.open = false;
    frames.own(true);
    item.query.resolve(item.stream);
  }
  function CopyBothResponse() {
    const item = sent[0];
    item.stream = new Stream.Duplex({ ...writable(item), read: readable(item) });
    frames.own(true);
    item.query.resolve(item.stream);
  }
  function CopyData(x, start, end) {
    const item = sent[0];
    if (!item.stream)
      return;
    item.wanted = false;
    if (!item.stream.push(frames.owns(x) ? x.subarray(start + 5, end) : Buffer.from(x.subarray(start + 5, end))) && !item.wanted) {
      frames.pause();
      socket.pause();
    }
  }
  function CopyDone() {
    frames.own(false);
    const item = sent[0];
    item.stream && item.stream.push(null);
    item.stream = null;
  }
}
function oidOf(name, table, number, type) {
  return type;
}
function copy(error) {
  const x = Object.create(Object.getPrototypeOf(error), Object.getOwnPropertyDescriptors(error));
  Object.defineProperty(x, "stack", { value: error.stack, writable: true, configurable: true });
  ["query", "parameters", "args", "types"].forEach((k) => delete x[k]);
  return x;
}
function key(name) {
  const x = JSON.stringify(String(name));
  return name === "__proto__" ? "[" + x + "]" : x;
}
function own2(row, name, value) {
  Object.defineProperty(row, name, { value, writable: true, enumerable: true, configurable: true });
}
function Exchange(kind, query, lease, write) {
  return {
    kind,
    query,
    lease,
    write,
    trace: query && query.trace || null,
    statement: null,
    text: "",
    entry: null,
    fresh: null,
    previous: null,
    parses: [],
    values: null,
    params: null,
    columns: null,
    shaped: null,
    reader: null,
    result: new Result,
    results: null,
    origin: null,
    portal: "",
    rows: 0,
    end: false,
    failure: null,
    flushing: false,
    streaming: false,
    open: false,
    alone: !!(query && query.alone),
    describing: false,
    learn: false,
    batch: null,
    nosync: false,
    aborted: false,
    flushed: false,
    loose: false,
    gate: false,
    later: false,
    formats: null,
    verify: false,
    synced: false,
    bound: false,
    suspended: false,
    finished: false,
    done: false,
    ends: false,
    epoch: 0,
    retried: false,
    original: null,
    error: null,
    own: null,
    cancel: null,
    unanswered: null,
    silence: null,
    completed: false,
    for: null,
    stream: null,
    copied: false,
    wanted: false,
    final: null,
    resolve: null,
    reject: null,
    cost: undefined
  };
}
function Entry(name, owner, oids) {
  return { name, owner, oids, columns: null, serializers: null, binary: null, binaryOf: null, state: "parsing", version: -1 };
}
function Rows(columns) {
  let state = states.get(columns);
  if (state === undefined) {
    state = {
      columns,
      seen: 0,
      object: null,
      array: null,
      variants: null,
      compilable: compiles && columns.length <= 512 && !columns.some((x) => String(x.name) === "__proto__")
    };
    states.set(columns, state);
  }
  return state;
}
function Parsed(columns, parsers) {
  const state = Rows(columns), list = columns.map(typeof parsers === "function" ? (c) => parsers(c) || null : (c) => (c.type in parsers) ? parsers[c.type] || null : c.parser);
  if (list.every((x, i) => x === columns[i].parser))
    return state;
  const variants = state.variants || (state.variants = []), found = variants.find((v) => v.list.every((x, i) => x === list[i]));
  if (found)
    return found.state;
  const variant = { list, state: Rows(columns.map((c, i) => list[i] === c.parser ? c : { ...c, parser: list[i], decode: null })) };
  variants.length === variety && variants.shift();
  variants.push(variant);
  return variant.state;
}
function read(state, array, text, from) {
  const key = array ? "array" : "object";
  if (state[key] !== null)
    return state[key];
  if (!state.compilable || ++state.seen < after)
    return null;
  try {
    return state[key] = compile(state.columns, array, text, from);
  } catch (_) {
    compiles = state.compilable = false;
    return null;
  }
}
function compile(columns, array, text, from) {
  const locals = [], body = ["let l = 0"], at = "x, i, i + l";
  columns.forEach((c, j) => {
    c.decode ? locals.push("d" + j + " = c[" + j + "].decode") : c.parser && locals.push("p" + j + " = c[" + j + "].parser");
    const value = c.decode ? "d" + j + "(" + at + ")" : c.parser ? "p" + j + "(text(" + at + "))" : "text(" + at + ")";
    body.push("l = (x[i] << 24) | (x[i + 1] << 16) | (x[i + 2] << 8) | x[i + 3]", "i += 4", "let v" + j + " = null", "l !== -1 && (v" + j + " = " + value + ", i += l)", from ? "v" + j + " = from(v" + j + ", c[" + j + "])" : "");
  });
  body.push(array ? "return [" + columns.map((c, j) => "v" + j).join(",") + "]" : "return {" + columns.map((c, j) => key(c.name) + ":v" + j).join(",") + "}");
  return new Function("c", "text", "from", (locals.length ? "const " + locals.join(", ") + `
` : "") + `return function row(x, i) {
` + body.filter(Boolean).join(`
`) + `
}`)(columns, text, from);
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/pool.js
var begins = /\bbegin\b/i;
var noop5 = () => {};
var starts = /\bstart\b/gi;
var transaction = /^transaction\b/i;
function Pool(options, types) {
  const { setTimeout: setTimeout2, clearTimeout: clearTimeout2, now } = options.timers, statements = Statements(options.scheduler), connections = new Set, waiting = Queue(), events = {
    parser: types.parser,
    decoder: types.decoder,
    binary: types.binary,
    serializer: types.serializer,
    plain: types.plain,
    onready,
    onclose,
    onnotify: options.onnotify,
    onparameter,
    ontimed,
    typed: options.fetch_types === false,
    unknown: (oids) => !typesLoaded && types.unknown(oids),
    need
  }, work = { fast: 0, slow: 0, at: 0 };
  const signal = { aborted: false, sockets: new Set }, replacing = [], eager = types.named || !!options.eager_types, paused = new Set;
  let opening = 0, ending = null, used = false, endTimer = null, retries = 0, failingSince = null, nextAttempt = 0, retryTimer = null, typesLoaded = options.fetch_types === false, typesError = null, typesFailed = 0, failure = null, typesLoading = false, retryTypes = null, typeRetries = 0, typesFailing = null;
  const pool = {
    query,
    lease,
    cancel,
    end,
    close,
    get stats() {
      return {
        connections: connections.size,
        opening,
        idle: [...connections].filter((x) => x.inflight === 0 && !x.lease).length,
        leased: [...connections].filter((x) => x.lease).length,
        waiting: waiting.length
      };
    }
  };
  return pool;
  function query(q, lease) {
    options.query_timeout && !q.timer && !q.settled && !q.cursorFn && !q.streaming && deadline(q);
    if (ending && !lease)
      return q.reject(queryError(Errors.connection("CONNECTION_ENDED", options, options.host[0], options.port[0]), q, options.debug));
    if (q.parts)
      return batch(q, lease);
    let built;
    try {
      built = q.build();
    } catch (error) {
      return unbuilt(q, error, lease);
    }
    const free = !lease && options.max !== 1;
    if (q.options.simple && !built.values.length) {
      const known = (free || options.scheduler) && statements.known(built.text);
      q.alone = free && alone(known);
      options.scheduler && (q.cost = known);
      return place({ q, simple: built.text, exclusive: !!q.streaming || q.alone }, lease);
    }
    if (q.onlyDescribe)
      return describeOnly(q, built, lease);
    const statement = statements.get(built, options.prepare && q.options.prepare !== false);
    q.alone = free && alone(statement.live ? statement : statements.known(built.text));
    q.wire = { statement, built };
    options.scheduler && (q.cost = statement.cost);
    place({ q, statement, typed: !typesLoaded && unknown(built.oids), exclusive: !!q.cursorFn || !!q.streaming || q.alone }, lease);
  }
  function unknown(oids) {
    for (let i = 0;i < oids.length; i++) {
      if (oids[i] && !types.known(oids[i]))
        return true;
    }
    return false;
  }
  function deadline(q) {
    q.timer = setTimeout2(() => {
      q.timer = null;
      q.settled || (q.timedOut = true, cancel(q).catch(noop5));
    }, options.query_timeout * 1000);
  }
  function batch(q, lease) {
    const parts = q.parts;
    if (!parts.length)
      return q.resolve([]);
    for (let i = 0;i < parts.length; i++) {
      try {
        parts[i].build();
      } catch (error) {
        error && typeof error === "object" && (error.index = i);
        return unbuilt(q, error, lease);
      }
    }
    parts.forEach((x) => {
      const built = x.built;
      x.wire = { statement: statements.get(built, options.prepare && x.options.prepare !== false), built };
    });
    const run = (c) => (q.connection = c, c.batch(q, parts), q.onwrite && q.onwrite());
    place({ q, run, typed: !typesLoaded && parts.some((x) => unknown(x.built.oids)) }, lease);
  }
  function describeOnly(q, built, lease) {
    const statement = { name: "", text: built.text, oids: built.oids, columns: null }, run = (c) => (q.connection = c, c.describe(statement, built.oids, q).then(({ params, columns }) => q.resolve({ string: built.text, types: params, name: "", columns }), (error) => q.reject(queryError(error, q, options.debug))), q.onwrite && q.onwrite());
    lease ? run(lease.connection) : place({ run, q, reject: (error) => q.reject(queryError(error, q, options.debug)) });
  }
  function unbuilt(q, error, lease) {
    error = queryError(error, q, options.debug);
    if (!lease || lease.released || lease.connection.closed)
      return q.reject(error);
    q.connection = lease.connection;
    lease.connection.local(q, error);
    q.onwrite && q.onwrite();
  }
  function place(job, lease) {
    used = true;
    const missing = !lease && retype();
    if (missing)
      return reject(job, missing);
    if (job.q && job.q.cancelled)
      return job.q.reject(queryError(Errors.generic("57014", "canceling statement due to user request"), job.q, options.debug));
    if (lease) {
      return lease.connection.closed ? job.q.reject(queryError(lease.connection.closed, job.q, options.debug)) : lease.released ? job.q.reject(queryError(ended(lease), job.q, options.debug)) : run(lease.connection, job);
    }
    if (signal.aborted)
      return reject(job, Errors.connection("CONNECTION_DESTROYED", options, options.host[0], options.port[0]));
    if (failingFast())
      return reject(job, copy(failure.error));
    const c = waiting.length === 0 && pick(job);
    if (c)
      return run(c, job);
    waiting.push(wait(job));
    drain();
  }
  function wait(job) {
    if (!options.queue_timeout)
      return job;
    job.timer = setTimeout2(() => {
      job.timer = null;
      waiting.remove((x) => x === job) && reject(job, Errors.generic("QUEUE_TIMEOUT", "Waited more than " + options.queue_timeout + " seconds for a connection"));
    }, options.queue_timeout * 1000);
    typeof job.timer.unref === "function" && job.timer.unref();
    return job;
  }
  function started(job) {
    job.timer && (clearTimeout2(job.timer), job.timer = null);
  }
  function run(c, job) {
    started(job);
    hold(c);
    if (job.run)
      return job.run(c);
    job.q.connection = c;
    job.simple !== undefined ? c.simple(job.q, job.simple) : c.send(job.q);
    job.q.onwrite && job.q.onwrite();
  }
  function drain() {
    while (waiting.length) {
      const job = waiting.peek(), c = pick(job);
      if (!c && !copying(job))
        break;
      waiting.shift();
      !c ? reject(job, Errors.generic("COPY_IN_PROGRESS", "You cannot execute queries during copy")) : job.lease ? grant(c, job) : run(c, job);
    }
    waiting.length && listened(channels.pool) && event("wait", null, { waiting: waiting.length });
    grow();
  }
  function plain(job) {
    return !!job.q && !job.lease && !job.exclusive && !job.run;
  }
  function copying(job) {
    if (!job.q || connections.size + opening < options.max || connections.size === 0)
      return false;
    for (const c of connections) {
      if (!c.copying)
        return false;
    }
    return true;
  }
  function quiet(c) {
    return c.inflight === 0 || !!c.typing && !c.typing.settled && c.inflight === 1;
  }
  function usable(c) {
    return !c.closed && !c.closing && !c.lease && !c.releasing && !c.retiring && !c.exclusive && !c.loading;
  }
  function pick(job) {
    const statement = job.statement, any = !statement || !statement.name;
    if (!typesLoaded && (eager ? job.lease || job.typed : job.typed))
      return eager || need(), null;
    let best = null, soon = false;
    for (const c of connections) {
      c.loading && !c.closed && (soon = true);
      const free = usable(c);
      if (free && quiet(c)) {
        if (any || c.prepared.has(statement.name))
          return c;
        best = best && quiet(best) ? best : c;
      } else if (free && !job.lease && !job.exclusive && c.inflight < options.max_pipeline && (!best || c.inflight < best.inflight)) {
        best = c;
      }
    }
    if (best && quiet(best))
      return best;
    if (soon || connections.size + opening < options.max && !failingSince)
      return null;
    best && options.scheduler && job.q && needed(job) && (best = scheduled(job) || best);
    return best && opening && best.inflight >= Math.ceil(waiting.length / (opening + 1)) ? null : best;
  }
  function needed(job) {
    if (!job.q.cost || job.q.cost.est === undefined || job.q.cost.est >= notable)
      return true;
    for (const c of connections) {
      if (c.notable)
        return true;
    }
    return false;
  }
  function scheduled(job) {
    const t = now(), e = job.q.cost ? job.q.cost.est : undefined;
    if (e === undefined || e < slow)
      return soonest(t, Infinity, false);
    let heavy = 0;
    for (const c of connections)
      c.inflight && c.heavy() && heavy++;
    decay(t);
    const reserve = Math.max(1, Math.min(Math.ceil(work.fast / 2000 * 1.5) + 1, connections.size - Math.ceil(work.slow / 2000)));
    return heavy < connections.size - reserve ? soonest(t, Infinity, false) : soonest(t, 2 * e, true) || soonest(t, Infinity, false);
  }
  function soonest(t, most, heavy) {
    let best = null, value = Infinity, ties = 0;
    for (const c of connections) {
      const v = usable(c) && c.inflight < options.max_pipeline && (!heavy || c.heavy()) ? c.backlog(t) : Infinity;
      if (v <= most && v < value)
        best = c, value = v, ties = 1;
      else if (v <= most && v === value && v !== Infinity && Math.random() * ++ties < 1)
        best = c;
    }
    return best;
  }
  function ontimed(sample, t) {
    decay(t);
    sample < slow ? work.fast += sample : work.slow += sample;
  }
  function decay(t) {
    const d = Math.exp((work.at - t) / 2000);
    work.fast *= d;
    work.slow *= d;
    work.at = t;
  }
  function grow() {
    if (ending && waiting.length === 0)
      return;
    if (failingSince !== null) {
      if (opening || !waiting.length || retryTimer || [...connections].some((x) => x.loading))
        return;
      const wait = nextAttempt - now();
      return wait > 0 ? retryTimer = setTimeout2(() => (retryTimer = null, grow()), wait) : connect();
    }
    let loading = 0;
    for (const c of connections)
      c.loading && loading++;
    const wanted = Math.max(Math.min(waiting.length - opening - loading, options.max - connections.size - opening), used && !ending ? Math.min(options.min, options.max) - connections.size - opening : 0);
    for (let i = 0;i < wanted; i++)
      connect();
  }
  function connect() {
    opening++;
    retryTimer && (clearTimeout2(retryTimer), retryTimer = null);
    (options.open || open)(options, signal, replacing.length ? replacing.shift() : 0).then(opened, failed);
  }
  function copy(error) {
    if (!error || typeof error !== "object")
      return error;
    const x = Object.create(Object.getPrototypeOf(error), Object.getOwnPropertyDescriptors(error));
    Object.defineProperty(x, "stack", { value: error.stack, writable: true, configurable: true });
    ["query", "parameters", "args", "types"].forEach((k) => delete x[k]);
    return x;
  }
  function failingFast() {
    return !!failure && retries > 1 && opening === 0 && now() < nextAttempt && stuck();
  }
  function stuck() {
    for (const c of connections) {
      if (!c.lease)
        return false;
    }
    return true;
  }
  function opened(ready) {
    opening--;
    if (signal.aborted || ending && waiting.length === 0) {
      ready.socket.destroy();
      return finishing();
    }
    Object.entries(ready.parameters).forEach(([k, v]) => onparameter(k, v));
    const c = Connection(ready, options, events);
    c.index = ready.index || 0;
    connections.add(c);
    lifetime(c);
    listened(channels.pool) && event("open", c);
    typesLoaded || !eager || (typesLoading ? c.loading = true : loadTypes(c));
    c.loading || c.typing || eager && typesLoading || recovered();
    drain();
  }
  function recovered() {
    retries = 0;
    failingSince = null;
    failure = null;
  }
  function need(c) {
    c && paused.add(c);
    if (typesLoaded)
      return resume();
    if (typesLoading)
      return;
    typesLoading = true;
    const idle = [...connections].find((x) => !paused.has(x) && usable(x) && x.inflight === 0);
    idle ? fetched(types.load(runner(idle))) : (options.open || open)(options, signal, 0).then((ready) => {
      const c = Connection(ready, options, { ...events, onready: () => {}, onclose: () => {}, onparameter: () => {}, ontimed: () => {}, need: () => {} });
      fetched(types.load(runner(c)).finally(() => c.close()));
    }, (error) => fetched(Promise.reject(error)));
  }
  function fetched(loading) {
    let failure = null;
    loading.then(() => typesLoaded = true, (error) => error instanceof PostgresError ? typesLoaded = true : failure = error).then(() => {
      typesLoading = false;
      events.typed = typesLoaded;
      if (typesLoaded) {
        typeRetries = 0;
        typesFailing = null;
        return resume();
      }
      typesFailing === null && (typesFailing = now());
      typeRetries++;
      if (options.connect_timeout && now() - typesFailing >= options.connect_timeout * 1000) {
        typeRetries = 0;
        typesFailing = null;
        return [...paused].forEach((x) => {
          paused.delete(x);
          x.destroy(failure || Errors.connection("CONNECTION_CLOSED", options, x.host, x.port));
        });
      }
      const wait = 1000 * (typeof options.backoff === "function" ? options.backoff(typeRetries) : options.backoff);
      paused.size && (retryTypes = setTimeout2(() => (retryTypes = null, need()), wait));
    });
  }
  function resume() {
    const xs = [...paused];
    paused.clear();
    xs.forEach((x) => x.closed || x.go());
    drain();
  }
  function runner(c) {
    return (text) => new Promise((resolve, reject) => {
      const q = new Query([text], [], Object.assign(() => {}, { options }), { simple: true });
      q.executed = true;
      q.then(resolve, reject);
      bound(c, q);
      c.simple(q, text);
    });
  }
  function bound(c, q) {
    if (!options.query_timeout)
      return;
    const timer = setTimeout2(() => q.settled || c.cancel(q).catch(noop5), options.query_timeout * 1000);
    q.then(() => clearTimeout2(timer), () => clearTimeout2(timer));
  }
  function retype() {
    if (!typesError)
      return null;
    if (now() - typesFailed < 1000)
      return copy(typesError);
    typesError = null;
    connections.forEach((x) => x.loading = true);
    [...connections].some((x) => !x.closed && (loadTypes(x), true));
    return null;
  }
  function loadTypes(c) {
    hold(c);
    typesLoading = true;
    c.loading = types.named;
    c.typing = null;
    types.load((text) => new Promise((resolve, reject) => {
      const q = new Query([text], [], Object.assign(() => {}, { options }), { simple: true });
      q.executed = true;
      q.then(resolve, reject);
      types.named || (c.typing = q);
      bound(c, q);
      c.simple(q, text);
    })).then(() => typesLoaded = true, (error) => error instanceof PostgresError ? typesLoaded = true : error && error.code === "TYPE_NOT_FOUND" && (typesError = error, typesFailed = now())).then(() => {
      typesLoading = false;
      events.typed = typesLoaded;
      c.typing = null;
      connections.forEach((x) => x.loading = !typesLoaded && !typesError);
      (typesLoaded || typesError) && recovered();
      typesError ? waiting.take().forEach((job) => reject(job, copy(typesError))) : typesLoaded || [...connections].some((x) => !x.closed && !x.typing && (loadTypes(x), true));
      drain();
    });
  }
  function failed(error) {
    opening--;
    if (signal.aborted)
      return finishing();
    attempted(error);
    ending ? finishing() : grow();
  }
  function attempted(error) {
    failingSince === null && (failingSince = now());
    retries++;
    nextAttempt = now() + 1000 * (typeof options.backoff === "function" ? options.backoff(retries) : options.backoff);
    const transient = !!error && (error.code === "CONNECTION_CLOSED" || error.code === "53300"), expired = options.connect_timeout && now() - failingSince >= options.connect_timeout * 1000;
    failure = !transient || expired ? { error } : null;
    stuck() && opening === 0 && (failure || ending) && waiting.take().forEach((job, i) => reject(job, i ? copy(error) : error));
  }
  function reject(job, error) {
    started(job);
    job.lease ? job.reject(error) : job.q ? job.q.reject(queryError(error, job.q, options.debug)) : job.reject(error);
  }
  function lifetime(c) {
    const life = typeof options.max_lifetime === "function" ? options.max_lifetime() : options.max_lifetime;
    life && (c.lifeTimer = unref(setTimeout2(() => {
      c.retiring = true;
      c.inflight === 0 && !c.lease && c.close();
    }, life * 1000)));
    idle(c);
  }
  function event(name, c, extra) {
    channels.pool.publish({
      event: name,
      connection: c ? c.id : null,
      host: c ? c.host : null,
      port: c ? c.port : null,
      database: options.database,
      stats: pool.stats,
      ...extra
    });
  }
  function idle(c) {
    listened(channels.pool) && event("idle", c);
    if (c.inflight || c.lease)
      return;
    options.unref_sockets && !c.loading && waiting.length === 0 && c.unref();
    if (!options.idle_timeout)
      return;
    c.idleSince = now();
    c.idleTimer || (c.idleTimer = unref(setTimeout2(() => idled(c), options.idle_timeout * 1000)));
  }
  function hold(c) {
    options.unref_sockets && c.ref();
  }
  function unref(timer) {
    options.unref_sockets && timer && typeof timer.unref === "function" && timer.unref();
    return timer;
  }
  function idled(c) {
    c.idleTimer = null;
    if (c.inflight || c.lease || c.closed)
      return;
    if (connections.size <= options.min)
      return;
    const left = options.idle_timeout * 1000 - (now() - c.idleSince);
    left >= 1 ? c.idleTimer = unref(setTimeout2(() => idled(c), left)) : c.close();
  }
  function onready(c) {
    if (c.releasing) {
      if (c.inflight)
        return;
      c.releasing = false;
      if (c.status !== "I")
        return c.close();
    }
    if (c.inflight === 0 && !c.lease && (c.retiring || ending && waiting.length === 0))
      return c.close();
    idle(c);
    while (waiting.length > connections.size + opening && usable(c) && c.inflight < options.max_pipeline && plain(waiting.peek()))
      run(c, waiting.shift());
    waiting.length && !c.lease && c.inflight < options.max_pipeline && drain();
    ending && waiting.length === 0 && finishing();
  }
  function onclose(c, error) {
    connections.delete(c);
    (c.loading || c.typing) && !signal.aborted && attempted(copy(error));
    paused.delete(c);
    ending || replacing.push((c.index + 1) % (options.path ? 1 : options.host.length));
    replacing.length > options.max && replacing.shift();
    c.retired && c.retired.forEach((r) => r());
    c.idleTimer && clearTimeout2(c.idleTimer);
    c.lifeTimer && clearTimeout2(c.lifeTimer);
    c.lease && c.lease.onclose && c.lease.onclose(error.cause && error.cause.severity === "FATAL" && !c.uncertain ? error.cause : error.code === "CONNECTION_DESTROYED" ? Errors.connection("CONNECTION_CLOSED", options, c.host, c.port) : error);
    options.onclose && options.onclose(c.id);
    listened(channels.pool) && event("close", c, { error });
    connections.size === 0 && opening === 0 && statements.clear();
    drain();
    ending && finishing();
  }
  function onparameter(k, v) {
    options.parameters[k] !== v && (options.parameters[k] = v, options.onparameter && options.onparameter(k, v));
  }
  async function lease(kind) {
    used = true;
    await 1;
    if (ending)
      throw Errors.connection("CONNECTION_ENDED", options, options.host[0], options.port[0]);
    if (failingFast())
      throw copy(failure.error);
    const missing = retype();
    if (missing)
      throw missing;
    return new Promise((resolve, reject) => {
      waiting.push(wait({ lease: true, kind, resolve, reject, queued: listened(channels.pool) ? now() : 0 }));
      drain();
    });
  }
  function grant(c, job) {
    started(job);
    hold(c);
    c.idleTimer && (clearTimeout2(c.idleTimer), c.idleTimer = null);
    let chain = Promise.resolve(), released = false, lost;
    const closed = new Promise((_, reject) => lost = reject);
    closed.catch(() => {});
    const x = {
      kind: job.kind,
      error: null,
      connection: c,
      closed,
      get released() {
        return released;
      },
      send(q) {
        if (c.closed)
          return q.reject(queryError(c.closed, q, options.debug));
        if (released)
          return q.reject(queryError(ended(x), q, options.debug));
        chain = chain.then(() => new Promise((resolve) => {
          q.onwrite = resolve;
          q.then(resolve, resolve);
          query(q, x);
        }));
      },
      release() {
        if (released)
          return;
        released = true;
        c.lease === x && (c.lease = null);
        listened(channels.pool) && event("release", c, { kind: job.kind });
        if (c.closed)
          return;
        if (c.inflight)
          return c.releasing = true;
        c.status === "I" ? onready(c) : c.close();
      },
      onclose(error) {
        x.error = error;
        lost(error);
      }
    };
    c.lease = x;
    listened(channels.pool) && event("lease", c, { kind: job.kind, waited: job.queued ? now() - job.queued : 0 });
    job.resolve(x);
  }
  function ended(lease) {
    return Errors.generic("UNSAFE_TRANSACTION", "The " + lease.kind + " has ended");
  }
  function cancel(q) {
    if (waiting.remove((x) => x.q === q && (started(x), true))) {
      q.reject(queryError(Errors.generic("57014", "canceling statement due to user request"), q, options.debug));
      return Promise.resolve();
    }
    if (q.connection)
      return q.connection.cancel(q);
    q.cancelled = true;
    return Promise.resolve();
  }
  function end({ timeout = null } = {}) {
    if (ending)
      return ending;
    ending = new Promise((resolve) => {
      pool.ended = resolve;
      timeout !== null && (endTimer = setTimeout2(destroy, timeout * 1000));
      retryTimer && (clearTimeout2(retryTimer), retryTimer = null);
      Promise.resolve().then(finishing);
    });
    return ending;
  }
  function finishing() {
    if (!pool.ended)
      return;
    if (waiting.length === 0)
      connections.forEach((c) => c.inflight === 0 && !c.lease && c.close());
    if (connections.size === 0 && opening === 0 && waiting.length) {
      const error = Errors.connection("CONNECTION_ENDED", options, options.host[0], options.port[0]);
      waiting.take().forEach((job) => reject(job, error));
    }
    if (connections.size === 0 && (opening === 0 || signal.aborted) && waiting.length === 0) {
      endTimer && clearTimeout2(endTimer);
      retryTimer && clearTimeout2(retryTimer);
      retryTypes && clearTimeout2(retryTypes);
      const resolve = pool.ended;
      pool.ended = null;
      resolve();
    }
  }
  function destroy() {
    endTimer = null;
    signal.aborted = true;
    signal.sockets.forEach((x) => x.destroy());
    const error = Errors.connection("CONNECTION_DESTROYED", options, options.host[0], options.port[0]);
    waiting.take().forEach((job) => reject(job, error));
    connections.forEach((c) => c.destroy());
    connections.size === 0 && finishing();
  }
  function close() {
    used = false;
    return Promise.all([...connections].map((c) => c.lease ? new Promise((r) => (c.retiring = true, (c.retired || (c.retired = [])).push(r))) : c.close()));
  }
}
function Queue() {
  let xs = [], head = 0;
  return {
    get length() {
      return xs.length - head;
    },
    push: (x) => xs.push(x),
    peek: () => xs[head],
    shift() {
      const x = xs[head];
      xs[head++] = undefined;
      head === xs.length ? (xs = [], head = 0) : head > 1024 && head * 2 > xs.length && (xs = xs.slice(head), head = 0);
      return x;
    },
    take() {
      const all = xs.slice(head);
      xs = [];
      head = 0;
      return all;
    },
    remove(fn) {
      for (let i = head;i < xs.length; i++) {
        if (fn(xs[i]))
          return xs.splice(i, 1), true;
      }
      return false;
    }
  };
}
var limit2 = 2000;
function alone(x) {
  return x.alone === undefined ? x.alone = opens(x.text) : x.alone;
}
function opens(text) {
  if (begins.test(text))
    return true;
  starts.lastIndex = 0;
  let match;
  while (match = starts.exec(text)) {
    const from = match.index + 5;
    let i = from;
    while (true) {
      while (i < text.length && /\s/.test(text[i]))
        i++;
      if (text[i] !== "/" || text[i + 1] !== "*")
        break;
      const end = text.indexOf("*/", i + 2);
      if (end === -1)
        return false;
      i = end + 2;
    }
    if (i > from && transaction.test(text.slice(i, i + 12)))
      return true;
    starts.lastIndex = Math.max(starts.lastIndex, i);
  }
  return false;
}
function Statements(scheduler) {
  const prefix = Math.random().toString(36).slice(2, 10), map = new Map, templates = new WeakMap;
  let counter = 1, clock = 0;
  const texts = new Map;
  return { get, clear, known };
  function known(text) {
    let x = texts.get(text);
    if (x)
      return x;
    texts.set(text, x = { text, est: undefined, alone: undefined });
    texts.size > limit2 && texts.delete(texts.keys().next().value);
    return x;
  }
  function get(built, prepare) {
    if (!prepare)
      return unnamed(built.text);
    const tagged = !built.dynamic && (templates.get(built.strings) || set(built.strings)), cached = tagged && tagged.get(built.types);
    if (cached && cached.live)
      return cached.used = clock++, cached;
    const key = built.types + "\x00" + built.text;
    let statement = map.get(key);
    statement ? statement.used = clock++ : statement = add(key, built.text);
    tagged && tagged.set(built.types, statement);
    return statement;
  }
  function unnamed(text) {
    return {
      key: null,
      live: false,
      name: "",
      text,
      ends: undefined,
      shape: undefined,
      version: 0,
      used: 0,
      cost: scheduler ? known(text) : null
    };
  }
  function add(key, text) {
    const statement = {
      key,
      live: true,
      name: prefix + counter++,
      text,
      ends: undefined,
      shape: undefined,
      version: 0,
      used: clock++,
      cost: { est: undefined },
      alone: undefined
    };
    map.set(key, statement);
    map.size > limit2 && evict();
    return statement;
  }
  function evict() {
    let oldest = null;
    for (const x of map.values())
      (!oldest || x.used < oldest.used) && (oldest = x);
    oldest.live = false;
    map.delete(oldest.key);
  }
  function set(strings) {
    const x = new Map;
    templates.set(strings, x);
    return x;
  }
  function clear() {
    map.forEach((x) => x.live = false);
    map.clear();
  }
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/subscribe.js
var noop6 = () => {};
var statusInterval = 1e4;
var epoch = BigInt(Date.UTC(2000, 0, 1)) * 1000n;
var lsnToString = (x) => (x >> 32n).toString(16).toUpperCase() + "/" + (x & 0xFFFFFFFFn).toString(16).toUpperCase();
function Subscribe(postgres, options) {
  const subscribers = new Map, persistent = !!options.slot, slot = options.slot || "postgresjs_" + Math.random().toString(36).slice(2), state = {}, timers = options.timers;
  let connection, current = null, ended = false, retries = 0;
  const sql = subscribe.sql = postgres({
    ...options,
    query_timeout: 0,
    transform: { column: {}, value: {}, row: {} },
    max: 1,
    idle_timeout: null,
    max_lifetime: null,
    connection: {
      ...options.connection,
      replication: "database"
    },
    onclose: () => {
      current && current.stop();
      current = null;
      state.pid = state.secret = undefined;
      ended || restart();
    },
    no_subscribe: true,
    eager_types: true
  });
  const { end, close } = sql;
  sql.end = async () => {
    ended = true;
    current && await current.finish();
    return end();
  };
  sql.close = async () => {
    current && await current.finish();
    return close();
  };
  return subscribe;
  async function subscribe(event, fn, onsubscribe = noop6, onerror) {
    event = parseEvent(event);
    connection || (connection = init());
    const subscriber = { fn, onsubscribe, onerror };
    const fns = subscribers.has(event) ? subscribers.get(event).add(subscriber) : subscribers.set(event, new Set([subscriber])).get(event);
    const unsubscribe = () => {
      fns.delete(subscriber);
      fns.size === 0 && subscribers.delete(event);
    };
    return connection.then(() => {
      onsubscribe();
      return { unsubscribe, state, sql };
    }, (error) => {
      unsubscribe();
      connection = null;
      throw error;
    });
  }
  function restart() {
    const delay = Math.min(100 * 2 ** retries++, 1e4);
    connection = new Promise((r) => timers.setTimeout(r, retries === 1 ? 0 : delay)).then(() => ended || init()).then((x) => {
      retries = 0;
      ended || subscribers.forEach((event) => event.forEach(({ onsubscribe }) => onsubscribe()));
      return x;
    }, (error) => {
      report(error);
      ended || restart();
    });
    connection.catch(noop6);
  }
  async function init() {
    if (!options.publications)
      throw new Error("Missing publication names");
    await sql.unsafe(`CREATE_REPLICATION_SLOT ${slot}${persistent ? "" : " TEMPORARY"} LOGICAL pgoutput NOEXPORT_SNAPSHOT`).catch((error) => {
      if (!persistent || error.code !== "42710")
        throw error;
    });
    const query = sql.unsafe(`START_REPLICATION SLOT ${slot} LOGICAL 0/0 (proto_version '1', publication_names '${options.publications}')`);
    query.catch(noop6);
    const stream = await query.writable();
    current = Stream(stream);
    state.pid = query.state && query.state.pid;
    state.secret = query.state && query.state.secret;
    return current;
  }
  function Stream(stream) {
    const relations = {};
    let acked = 0n, received = 0n, transaction = null, queue = null, failed = false, stopped = false, timer = timers.setTimeout(tick, statusInterval), soon = null;
    stream.on("data", data);
    stream.on("error", (error) => failed || report(error));
    stream.on("close", () => {
      const unexpected = !stopped;
      stop();
      unexpected && close();
    });
    return { stop, finish };
    function data(x) {
      if (x[0] === 119) {
        received = max(received, x.readBigUInt64BE(9));
        parse2(x.subarray(25), relations, sql.options.parsers, message, options.transform);
      } else if (x[0] === 107) {
        received = max(received, x.readBigUInt64BE(1));
        idle() && (acked = max(acked, received));
        x[17] && status();
      }
    }
    function message(kind, x, info) {
      if (kind === "begin")
        return transaction = { lsn: x.lsn, end: null, time: x.time, xid: x.xid };
      if (kind === "commit") {
        const done = transaction;
        done.end = x.end;
        transaction = null;
        return run(() => commit(done));
      }
      const at = transaction || {};
      info.lsn = at.lsn && lsnToString(at.lsn);
      info.time = at.time;
      info.xid = at.xid;
      run(() => handle(x, info));
    }
    function run(fn) {
      if (failed || stopped)
        return;
      if (queue) {
        queue = queue.then(() => failed || stopped ? null : fn());
        return;
      }
      const result = fn();
      if (result && typeof result.then === "function") {
        queue = result;
        stream.pause();
        drain();
      }
    }
    function drain() {
      const at = queue;
      at.then(() => {
        if (queue !== at)
          return queue && drain();
        queue = null;
        stopped || failed || stream.resume();
      }, noop6);
    }
    function commit(done) {
      acked = max(acked, done.end);
      persistent && !soon && (soon = timers.setImmediate(() => (soon = null, status())));
    }
    function handle(row, info) {
      const path = info.relation.schema + "." + info.relation.table, key = row && info.relation.keys.length ? "=" + info.relation.keys.map((x) => row[x.name]) : "", pending = [];
      call(pending, "*", row, info);
      call(pending, "*:" + path, row, info);
      key && call(pending, "*:" + path + key, row, info);
      call(pending, info.command, row, info);
      call(pending, info.command + ":" + path, row, info);
      key && call(pending, info.command + ":" + path + key, row, info);
      return pending.length ? Promise.all(pending) : null;
    }
    function call(pending, event, row, info) {
      subscribers.has(event) && subscribers.get(event).forEach((subscriber) => {
        let result;
        try {
          result = subscriber.fn(row, info, event);
        } catch (error) {
          return fail(error, subscriber);
        }
        result && typeof result.then === "function" && pending.push(result.catch((error) => fail(error, subscriber)));
      });
    }
    function fail(error, subscriber) {
      report(error, subscriber);
      if (!persistent || failed)
        return;
      failed = true;
      queue = null;
      stop();
      stream.destroy(new Error("A subscriber failed, so the transaction is delivered again"));
      close();
    }
    function idle() {
      return !transaction && !queue;
    }
    function tick() {
      timer = null;
      if (stopped)
        return;
      status();
      timer = timers.setTimeout(tick, statusInterval);
    }
    function status() {
      if (stopped || stream.destroyed || !stream.writable)
        return;
      const x = Buffer.alloc(34);
      x[0] = 114;
      x.writeBigUInt64BE(acked, 1);
      x.writeBigUInt64BE(acked, 9);
      x.writeBigUInt64BE(acked, 17);
      x.writeBigInt64BE(BigInt(Date.now()) * 1000n - epoch, 25);
      stream.write(x);
    }
    async function finish() {
      queue && await queue.catch(noop6);
      if (!failed) {
        idle() && (acked = max(acked, received));
        status();
      }
      stop();
      stream.destroyed || await new Promise((r) => (stream.once("close", r), stream.end()));
    }
    function stop() {
      if (stopped)
        return;
      stopped = true;
      timer && timers.clearTimeout(timer);
      soon && timers.clearImmediate(soon);
      timer = soon = null;
    }
  }
  function report(error, subscriber) {
    const handlers = subscriber ? [subscriber.onerror] : [...subscribers.values()].flatMap((x) => [...x].map((x) => x.onerror));
    const listeners = handlers.filter(Boolean);
    listeners.length ? listeners.forEach((fn) => fn(error)) : console.error("postgres.js: logical replication error", error);
  }
}
function max(a, b) {
  return a > b ? a : b;
}
function Time(x) {
  return new Date(Date.UTC(2000, 0, 1) + Number(x / 1000n));
}
function parse2(x, relations, parsers, message, transform) {
  const type = x[0];
  if (type === 82) {
    let i = 1;
    const r = relations[x.readUInt32BE(i)] = {
      schema: x.toString("utf8", i += 4, i = x.indexOf(0, i)) || "pg_catalog",
      table: x.toString("utf8", i + 1, i = x.indexOf(0, i + 1)),
      columns: Array(x.readUInt16BE(i += 2)),
      keys: []
    };
    i += 2;
    let columnIndex = 0, column;
    while (i < x.length) {
      column = r.columns[columnIndex++] = {
        key: x[i++],
        name: transform.column.from ? transform.column.from(x.toString("utf8", i, i = x.indexOf(0, i))) : x.toString("utf8", i, i = x.indexOf(0, i)),
        type: x.readUInt32BE(i += 1),
        parser: parsers[x.readUInt32BE(i)],
        atttypmod: x.readUInt32BE(i += 4)
      };
      column.key && r.keys.push(column);
      i += 4;
    }
  } else if (type === 66) {
    message("begin", { lsn: x.readBigUInt64BE(1), time: Time(x.readBigInt64BE(9)), xid: x.readUInt32BE(17) });
  } else if (type === 67) {
    message("commit", { lsn: x.readBigUInt64BE(2), end: x.readBigUInt64BE(10) });
  } else if (type === 73) {
    const relation = relations[x.readUInt32BE(1)];
    message("change", tuples(x, relation.columns, 8, transform).row, { command: "insert", relation });
  } else if (type === 68) {
    let i = 1;
    const relation = relations[x.readUInt32BE(i)];
    i += 4;
    const key = x[i] === 75;
    message("change", key || x[i] === 79 ? tuples(x, relation.columns, i += 3, transform).row : null, { command: "delete", relation, key });
  } else if (type === 85) {
    let i = 1;
    const relation = relations[x.readUInt32BE(i)];
    i += 4;
    const key = x[i] === 75;
    const xs = key || x[i] === 79 ? tuples(x, relation.columns, i += 3, transform) : null;
    xs && (i = xs.i);
    const { row } = tuples(x, relation.columns, i + 3, transform);
    message("change", row, { command: "update", relation, key, old: xs && xs.row });
  } else if (type === 84) {
    const count = x.readUInt32BE(1), flags = x[5];
    for (let i = 0;i < count; i++) {
      message("change", null, {
        command: "truncate",
        relation: relations[x.readUInt32BE(6 + i * 4)],
        cascade: (flags & 1) === 1,
        restartIdentity: (flags & 2) === 2
      });
    }
  }
}
function tuples(x, columns, xi, transform) {
  let type, column, value;
  const row = {};
  for (let i = 0;i < columns.length; i++) {
    type = x[xi++];
    column = columns[i];
    value = type === 110 ? null : type === 117 ? undefined : column.parser(x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)));
    value = transform.value.from ? transform.value.from(value, column) : value;
    column.name === "__proto__" ? own2(row, column.name, value) : row[column.name] = value;
  }
  return { i: xi, row: transform.row.from ? transform.row.from(row) : row };
}
function parseEvent(x) {
  const [, command, path, key] = x.match(/^(\*|insert|update|delete|truncate)?:?([^.]+?\.?[^=]+)?=?(.+)?/i);
  return (command || "*") + (path ? ":" + (path.indexOf(".") === -1 ? "public." + path : path) : "") + (key ? "=" + key : "");
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/large.js
import Stream2 from "node:stream";
function largeObject(sql, oid, mode = 131072 | 262144) {
  return new Promise(async (resolve, reject) => {
    await sql.begin(async (sql) => {
      let finish;
      !oid && ([{ oid }] = await sql`select lo_creat(-1) as oid`);
      const [{ fd }] = await sql`select lo_open(${oid}, ${mode}) as fd`;
      const lo = {
        writable,
        readable,
        close: () => sql`select lo_close(${fd})`.then(finish),
        tell: () => sql`select lo_tell64(${fd})`,
        read: (x) => sql`select loread(${fd}, ${x}) as data`,
        write: (x) => sql`select lowrite(${fd}, ${x})`,
        truncate: (x) => sql`select lo_truncate64(${fd}, ${x})`,
        seek: (x, whence = 0) => sql`select lo_lseek64(${fd}, ${x}, ${whence})`,
        size: () => sql`
          select
            lo_lseek64(${fd}, location, 0) as position,
            seek.size
          from (
            select
              lo_lseek64($1, 0, 2) as size,
              tell.location
            from (select lo_tell64($1) as location) tell
          ) seek
        `
      };
      resolve(lo);
      return new Promise(async (r) => finish = r);
      async function readable({
        highWaterMark = 2048 * 8,
        start = 0,
        end = Infinity
      } = {}) {
        let max = end - start;
        start && await lo.seek(start);
        return new Stream2.Readable({
          highWaterMark,
          async read(size) {
            const l = Math.min(size, max);
            max -= l;
            const [{ data }] = await lo.read(l);
            data.length && this.push(data);
            if (data.length < l || max === 0)
              this.push(null);
          }
        });
      }
      async function writable({
        highWaterMark = 2048 * 8,
        start = 0
      } = {}) {
        start && await lo.seek(start);
        return new Stream2.Writable({
          highWaterMark,
          write(chunk, encoding, callback) {
            lo.write(chunk).then(() => callback(), callback);
          }
        });
      }
    }).catch(reject);
  });
}

// ../../node_modules/.bun/postgres@4.1.1/node_modules/postgres/src/index.js
Object.assign(Postgres, {
  PostgresError,
  toPascal,
  pascal,
  toCamel,
  camel,
  toKebab,
  kebab,
  fromPascal,
  fromCamel,
  fromKebab,
  BigInt: {
    to: 20,
    from: [20],
    parse: (x) => BigInt(x),
    serialize: (x) => x.toString()
  }
});
var src_default = Postgres;
function Postgres(a, b) {
  const options = parseOptions(a, b), types = options.shared_types || Types(options), pool = Pool(options, types), subscribe = options.no_subscribe || Subscribe(Postgres, { ...options, shared_types: types }), listener = Listen(options);
  if (types.named && options.fetch_types === false)
    throw Errors.generic("TYPE_NOT_FOUND", "Custom types given by name need fetch_types to look them up");
  options.resolve = types.resolve;
  options.parsers = view(types.parsers, types.parser);
  options.serializers = view(types.serializers, types.serializer);
  const sql = Sql(handler);
  Object.defineProperties(sql, {
    parameters: { get: () => options.parameters, enumerable: true },
    stats: { get: () => pool.stats, enumerable: true }
  });
  Object.assign(sql, {
    largeObject: largeObject.bind(null, sql),
    subscribe,
    CLOSE,
    END: CLOSE,
    PostgresError,
    options,
    reserve,
    listen: listener.listen,
    begin,
    close,
    end
  });
  Symbol.asyncDispose && (sql[Symbol.asyncDispose] = () => end());
  return sql;
  function handler(q) {
    pool.query(q);
  }
  function Sql(handler) {
    handler.debug = options.debug;
    handler.options = options;
    handler.cancel = handler.cancel || pool.cancel;
    const typed = (value, type) => new Parameter(value, type);
    Object.entries(options.types).forEach(([name, type]) => typed[name] = (x) => new Parameter(x, type.to));
    Object.assign(sql, {
      types: typed,
      typed,
      unsafe,
      identifier: (...parts) => {
        if (!parts.length)
          throw Errors.generic("NO_PARTS", "sql.identifier needs at least one part");
        return new Identifier(parts.map(identifier).join("."));
      },
      batch,
      notify,
      array,
      json,
      file
    });
    return sql;
    function sql(strings, ...args) {
      return strings && Array.isArray(strings.raw) ? new Query(strings, args, handler) : typeof strings === "string" && !args.length ? new Identifier(escapeIdentifier(options.transform.column.to ? options.transform.column.to(strings) : strings)) : new Builder(strings, args);
    }
    function unsafe(string, args = [], options = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options = args, args = []);
      return new Query([string], args, handler, {
        prepare: false,
        ...options,
        simple: "simple" in options ? options.simple : args.length === 0
      });
    }
    function batch(queries) {
      if (!Array.isArray(queries))
        throw Errors.generic("BATCH_NOT_ARRAY", "sql.batch takes an array of queries");
      queries.forEach((x, i) => {
        if (!(x instanceof Query))
          throw Errors.generic("BATCH_NOT_QUERY", "Item " + i + " of the batch is not a query");
        if (x.executed)
          throw Errors.generic("BATCH_EXECUTED", "Item " + i + " of the batch has already run");
        if (x.cursorFn || x.cursorRows || x.streaming || x.forEachFn || x.onlyDescribe)
          throw Errors.generic("BATCH_UNSUPPORTED", "Item " + i + " of the batch is a cursor, stream, forEach or describe");
      });
      const q = new Query([], [], handler, {});
      q.parts = queries;
      queries.forEach((x) => (x.executed = true, x.cancel = () => q.cancel()));
      return q;
    }
    async function notify(channel, payload) {
      return await sql`select pg_notify(${channel}, ${"" + payload})`;
    }
    function file(path, args = [], options = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options = args, args = []);
      const fileHandler = (query) => fs2.readFile(path, "utf8", (err, string) => {
        if (err)
          return query.reject(err);
        query.strings = [string];
        handler(query);
      });
      Object.assign(fileHandler, handler);
      return new Query([], args, fileHandler, {
        ...options,
        simple: "simple" in options ? options.simple : args.length === 0
      });
    }
  }
  function json(x) {
    return new Parameter(x, 3802);
  }
  function array() {
    throw Errors.generic("ARRAY_REMOVED", "sql.array() is removed in v4, pass the array as it is");
  }
  async function reserve() {
    const lease = await pool.lease("reserve"), reserved = Sql(Object.assign((q) => lease.send(q), { cancel: pool.cancel }));
    reserved.release = () => lease.release();
    Symbol.dispose && (reserved[Symbol.dispose] = reserved.release);
    Symbol.asyncDispose && (reserved[Symbol.asyncDispose] = async () => reserved.release());
    return reserved;
  }
  function begin(mode, fn) {
    !fn && (fn = mode, mode = "");
    if (!active(channels.transaction))
      return transaction(mode, fn, null);
    const context = {
      mode,
      database: options.database,
      user: userName(options),
      connection: null,
      host: null,
      port: null,
      outcome: null
    };
    let promise;
    start(channels.transaction, context, () => promise = transaction(mode, fn, context));
    return promise.then((result) => (finish(channels.transaction, context, null, result), result), (error) => {
      finish(channels.transaction, context, error);
      throw error;
    });
  }
  async function transaction(mode, fn, context) {
    const lease = await pool.lease("transaction");
    let savepoints = 0, prepare = null;
    context && Object.assign(context, {
      connection: lease.connection.id,
      host: lease.connection.host,
      port: lease.connection.port
    });
    try {
      await control(lease, "begin " + mode.replace(/[^a-z ]/ig, ""));
      const done = scope(fn);
      done.catch(() => {});
      return await Promise.race([done, lease.closed]);
    } finally {
      lease.release();
    }
    async function scope(fn, name, inside, above = () => false, outer = () => false) {
      let uncaught, result, rolled = null, after = null, ending = false;
      if (above())
        throw rolledBack();
      const stopped = () => !!rolled || above(), over = () => ending || outer(), scoped = Sql(Object.assign((q) => {
        if (stopped())
          return q.reject(after || (after = rolledBack()));
        if (over())
          return q.reject(Errors.generic("UNSAFE_TRANSACTION", "The transaction has ended"));
        q.catch((e) => uncaught || (uncaught = e));
        lease.send(q);
      }, { cancel: pool.cancel }));
      scoped.savepoint = savepoint;
      scoped.begin = nested;
      scoped.rollback = () => rolled || (rolled = control(lease, name ? "rollback to " + identifier(name) : "rollback").then(() => {}));
      scoped.prepare = (x) => {
        if (inside)
          throw Errors.generic("NESTED_TRANSACTION_MODE", "A nested transaction can not be prepared, only the outermost one");
        prepare = x.replace(/[^a-z0-9$\-_. ]/gi, "");
      };
      name && await control(lease, "savepoint " + identifier(name));
      try {
        result = await new Promise((resolve, reject) => {
          const x = fn(scoped);
          Promise.resolve(Array.isArray(x) ? Promise.all(x) : x).then(resolve, reject);
        });
        if (uncaught && !stopped())
          throw uncaught;
        if (lease.connection.closed)
          throw lease.error || lease.connection.closed;
      } catch (error) {
        ending = true;
        context && !name && (context.outcome = "rollback");
        stopped() ? rolled && await rolled.catch(() => {}) : lease.connection.closed || await control(lease, name ? "rollback to " + identifier(name) : "rollback");
        throw error instanceof PostgresError && error.code === "25P02" && uncaught || error;
      }
      if (stopped()) {
        rolled && await rolled;
        context && !name && (context.outcome = "rollback");
        if (after)
          throw after;
        return result;
      }
      if (!name) {
        ending = true;
        const done = await control(lease, prepare ? "prepare transaction '" + prepare.replace(/'/g, "''") + "'" : "commit");
        context && (context.outcome = prepare ? "prepare" : done.command === "COMMIT" ? "commit" : "rollback");
        if (!prepare && done.command !== "COMMIT")
          throw Errors.generic("TRANSACTION_ROLLED_BACK", "The server rolled back the transaction instead of committing it");
      }
      return result;
      function savepoint(name, fn) {
        if (name && Array.isArray(name.raw))
          return savepoint((sql) => sql.apply(sql, arguments));
        arguments.length === 1 && (fn = name, name = null);
        return scope(fn, "s" + savepoints++ + (name ? "_" + name : ""), false, stopped, over);
      }
      async function nested(inner, fn) {
        !fn && (fn = inner, inner = "");
        if (normal(inner) && normal(inner) !== normal(mode))
          throw Errors.generic("NESTED_TRANSACTION_MODE", "A nested transaction runs in a savepoint, which can not change the transaction mode");
        return scope(fn, "s" + savepoints++, true, stopped, over);
      }
    }
  }
  function rolledBack() {
    return Errors.generic("TRANSACTION_ROLLED_BACK", "The query was not sent, the transaction was rolled back with sql.rollback()");
  }
  function normal(x) {
    return (x || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  }
  function identifier(x) {
    return '"' + x.replace(/"/g, '""') + '"';
  }
  function control(lease, text) {
    const q = new Query([text], [], Object.assign((q) => lease.send(q), { options, cancel: pool.cancel }), { simple: true });
    return q.execute();
  }
  async function end(options) {
    await Promise.all([
      listener.end(),
      subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : null
    ]);
    return pool.end(options);
  }
  function close() {
    return pool.close();
  }
}
function Listen(options) {
  const channels2 = new Map;
  let sql = null, closing = null, alive = null;
  return {
    listen,
    end: () => {
      release();
      channels2.forEach((channel) => channel.timer && options.timers.clearTimeout(channel.timer));
      return closing || (sql ? closing = sql.end({ timeout: 0 }) : Promise.resolve());
    }
  };
  function connection() {
    return sql || (sql = Postgres({
      ...options,
      query_timeout: 0,
      max: 1,
      idle_timeout: null,
      max_lifetime: null,
      unref_sockets: true,
      fetch_types: false,
      no_subscribe: true,
      onclose() {
        if (closing)
          return;
        channels2.forEach((channel, name) => relisten(channel, name));
      },
      onnotify(channel, payload) {
        channels2.has(channel) && [...channels2.get(channel).listeners].forEach((l) => l.fn(payload));
      }
    }));
  }
  function relisten(channel, name, retries = 0) {
    channel.timer = null;
    channel.result = start(name);
    channel.result.then((result) => {
      Object.assign(channel.state, result.state);
      channel.listeners.forEach((l) => l.onlisten && l.onlisten());
    }, () => {
      if (closing || channels2.get(name) !== channel)
        return;
      retries++;
      const seconds = typeof options.backoff === "function" ? options.backoff(retries) : options.backoff;
      channel.timer = options.timers.setTimeout(() => !closing && channels2.get(name) === channel && relisten(channel, name, retries), seconds * 1000);
    });
  }
  function hold() {
    alive || (alive = setInterval(() => {}, 1 << 30));
  }
  function release() {
    alive && (clearInterval(alive), alive = null);
  }
  function start(name) {
    const x = connection();
    return x`listen ${x.identifier(name)}`;
  }
  async function listen(name, fn, onlisten) {
    const listener = { fn, onlisten };
    if (!channels2.has(name))
      channels2.set(name, { listeners: new Set, result: start(name), state: {} });
    const channel = channels2.get(name);
    channel.listeners.add(listener);
    hold();
    let result;
    try {
      result = await channel.result;
    } catch (error) {
      channel.listeners.delete(listener);
      channel.listeners.size || channels2.delete(name);
      channels2.size || release();
      throw error;
    }
    Object.assign(channel.state, result.state);
    listener.onlisten && listener.onlisten();
    return { state: channel.state, unlisten };
    async function unlisten() {
      if (!channel.listeners.delete(listener) || channel.listeners.size)
        return;
      channels2.get(name) === channel && channels2.delete(name);
      channels2.size || release();
      const x = sql;
      if (closing || !x)
        return;
      await x`unlisten ${x.identifier(name)}`.catch((e) => {
        if (!/^CONNECTION_/.test(e.code))
          throw e;
      });
    }
  }
}
function parseOptions(a, b) {
  if (a && a.shared)
    return a;
  const env = process.env, o = (!a || typeof a === "string" ? b : a) || {}, url = parseUrl(a), query = [...url.url.searchParams].reduce((a, [b, c]) => (a[b] = c, a), {}), targets = hosts(o, query, url, env), port = o.port || query.port || env.PGPORT || 5432, user = o.user || o.username || url.url.username || env.PGUSERNAME || env.PGUSER || osUsername();
  o.no_prepare && (o.prepare = false);
  query.sslmode && (query.ssl = query.sslmode, delete query.sslmode);
  "timeout" in o && (console.log("The timeout option is deprecated, use idle_timeout instead"), o.idle_timeout = o.timeout);
  const files = certificates(query);
  const ints = [
    "idle_timeout",
    "connect_timeout",
    "max_lifetime",
    "max_pipeline",
    "backoff",
    "keep_alive",
    "min",
    "queue_timeout",
    "query_timeout",
    "cancel_timeout"
  ];
  const defaults = {
    max: globalThis.Cloudflare ? 3 : 10,
    min: 0,
    ssl: false,
    sslnegotiation: null,
    channel_binding: "prefer",
    idle_timeout: null,
    connect_timeout: 30,
    queue_timeout: 0,
    query_timeout: 0,
    cancel_timeout: 5,
    max_lifetime,
    max_pipeline: 100,
    scheduler: true,
    backoff,
    keep_alive: 60,
    prepare: true,
    debug: false,
    fetch_types: true,
    infer: false,
    publications: "alltables",
    slot: null,
    target_session_attrs: null
  };
  const options = {
    host: targets.map((x) => x[0]),
    port: Array.isArray(port) ? port : targets.map((x) => o.port || query.port ? +port : x[1] || +port),
    path: o.path || targets[0][0].indexOf("/") > -1 && targets[0][0] + "/.s.PGSQL." + (targets[0][1] || port),
    database: o.database || o.db || (url.url.pathname || "").slice(1) || env.PGDATABASE || (typeof user === "function" ? null : user),
    user,
    pass: o.pass || o.password || url.url.password || env.PGPASSWORD || "",
    ...Object.entries(defaults).reduce((acc, [k, d]) => {
      const value = k in o && o[k] !== undefined ? o[k] : (k in query) ? query[k] === "disable" || query[k] === "false" ? false : query[k] : k === "ssl" && env.PGSSLMODE || env["PG" + k.toUpperCase()] || d;
      acc[k] = typeof value === "string" && ints.includes(k) ? +value : value;
      return acc;
    }, {}),
    connection: {
      application_name: env.PGAPPNAME || "postgres.js",
      ...o.connection,
      ...Object.entries(query).reduce((acc, [k, v]) => ((k in defaults) || k === "host" || k === "port" || (acc[k] = v), acc), {})
    },
    types: o.types || {},
    target_session_attrs: tsa(o, url.url, env),
    channel_binding: binding(o, url.url, env),
    onnotice: o.onnotice,
    onnotify: o.onnotify,
    onclose: o.onclose,
    onparameter: o.onparameter,
    socket: o.socket,
    onread: o.onread !== false,
    open: o.open,
    no_subscribe: o.no_subscribe,
    unref_sockets: !!o.unref_sockets,
    passfile: passfile(env),
    shared_types: o.shared_types,
    eager_types: !!o.eager_types,
    transform: parseTransform(o.transform || { undefined: undefined }),
    parameters: {},
    shared: { retries: 0 },
    timers: o.timers || {
      setTimeout,
      clearTimeout,
      setImmediate,
      clearImmediate,
      now: () => performance.now()
    }
  };
  options.ssl = withCertificates(options.ssl, files);
  options.infer = options.infer === true || options.infer === "true";
  options.max === 1 && (options.scheduler = false);
  return options;
}
function certificates(query) {
  const { sslrootcert, sslcert, sslkey } = query, files = {};
  delete query.sslrootcert;
  delete query.sslcert;
  delete query.sslkey;
  sslrootcert === "system" && (query.ssl = "verify-full");
  sslrootcert && sslrootcert !== "system" && (files.ca = fs2.readFileSync(sslrootcert));
  sslcert && (files.cert = fs2.readFileSync(sslcert));
  sslkey && (files.key = fs2.readFileSync(sslkey));
  Object.keys(files).length && !query.ssl && (query.ssl = process.env.PGSSLMODE || process.env.PGSSL || "require");
  return files;
}
function withCertificates(ssl, files) {
  if (!ssl || ssl === "disable" || !Object.keys(files).length)
    return ssl;
  return typeof ssl === "object" ? { ...files, ...ssl } : ssl === true || ssl === "true" || ssl === "verify-full" ? files : files.ca ? { ...files, checkServerIdentity: () => {
    return;
  } } : { ...files, rejectUnauthorized: false };
}
function tsa(o, url, env) {
  const x = o.target_session_attrs || url.searchParams.get("target_session_attrs") || env.PGTARGETSESSIONATTRS;
  if (!x || ["read-write", "read-only", "primary", "standby", "prefer-standby"].includes(x))
    return x;
  throw new Error("target_session_attrs " + x + " is not supported");
}
function binding(o, url, env) {
  const x = o.channel_binding || url.searchParams.get("channel_binding") || env.PGCHANNELBINDING || "prefer";
  if (["disable", "prefer", "require"].includes(x))
    return x;
  throw new Error("channel_binding " + x + " is not supported");
}
function backoff(retries) {
  return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20);
}
function max_lifetime() {
  return 60 * (30 + Math.random() * 30);
}
function parseTransform(x) {
  const value = typeof x.value === "function" ? x.value : x.value && x.value.from;
  return {
    undefined: x.undefined,
    json: x.json === true || (x.json === false ? false : undefined),
    column: {
      from: typeof x.column === "function" ? x.column : x.column && x.column.from,
      to: x.column && x.column.to
    },
    value: {
      from: x.json === false && value && value.keys ? undefined : value,
      to: x.value && x.value.to
    },
    row: {
      from: typeof x.row === "function" ? x.row : x.row && x.row.from,
      to: x.row && x.row.to
    }
  };
}
function parseUrl(url) {
  if (!url || typeof url !== "string")
    return { url: { searchParams: new Map }, targets: [] };
  const rest = url.slice(url.indexOf("://") + 3), end = rest.search(/[/?]/), authority = end === -1 ? rest : rest.slice(0, end), at = authority.lastIndexOf("@"), userinfo = at === -1 ? "" : authority.slice(0, at), colon = userinfo.indexOf(":"), tail = new URL("postgres://x" + (end === -1 ? "" : rest.slice(end)));
  return {
    url: {
      username: decode(colon === -1 ? userinfo : userinfo.slice(0, colon)),
      password: colon === -1 ? "" : decode(userinfo.slice(colon + 1)),
      pathname: decode(tail.pathname),
      searchParams: tail.searchParams
    },
    targets: authority.slice(at + 1) ? split2(authority.slice(at + 1), decode) : []
  };
}
function decode(x) {
  try {
    return decodeURIComponent(x);
  } catch (_) {
    return x;
  }
}
function hosts(o, query, url, env) {
  const given = o.hostname || o.host || query.host;
  if (given)
    return Array.isArray(given) ? given.map((x) => [x, null]) : split2(given);
  if (url.targets.some(([x]) => x))
    return url.targets;
  return split2(env.PGHOST || "localhost").map(([x, p], i) => [x, p || url.targets[i] && url.targets[i][1] || null]);
}
function split2(x, decoded = (x) => x) {
  return x.split(",").filter(Boolean).map((x) => {
    const m = x.match(/^\[([^\]]*)\](?::(\d*))?$/) || x.match(/^([^:]*)(?::(\d*))?$/) || [x, x];
    return [decoded(m[1]), m[2] ? +m[2] : null];
  });
}
function passfile(env) {
  try {
    return env.PGPASSFILE || (process.platform === "win32" ? (env.APPDATA || "") + "\\postgresql\\pgpass.conf" : os.homedir() + "/.pgpass");
  } catch (_) {
    return null;
  }
}
function osUsername() {
  try {
    return os.userInfo().username;
  } catch (_) {
    return process.env.USERNAME || process.env.USER || process.env.LOGNAME;
  }
}
function view(known, get) {
  return new Proxy(known, {
    get: (x, oid) => typeof oid === "symbol" ? x[oid] : get(+oid)
  });
}

function splitScript(script) {
  const parts = [];
  const head = /^(COPY [^\n]* FROM STDIN);\n/gm;
  let at = 0;
  for (let m = head.exec(script);m !== null; m = head.exec(script)) {
    parts.push({ sql: script.slice(at, m.index) });
    const start = m.index + m[0].length;
    const end = script.slice(start).search(/^\\\.\n/m);
    if (end < 0)
      throw new Error("a COPY block has no \\. end line");
    parts.push({ copy: m[1], data: script.slice(start, start + end) });
    at = start + end + 3;
    head.lastIndex = at;
  }
  parts.push({ sql: script.slice(at) });
  return parts.filter((p) => !("sql" in p) || p.sql.trim() !== "");
}
var ESC = { b: "\b", f: "\f", n: `
`, r: "\r", t: "\t", v: "\v" };
function copyRows(data) {
  return data.split(`
`).filter((l, i, all) => l !== "" || i < all.length - 1).map((line) => line.split("\t").map((v) => v === "\\N" ? null : v.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, e) => e[0] === "x" && e.length > 1 ? String.fromCharCode(parseInt(e.slice(1), 16)) : /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ESC[e] ?? e)));
}
var formatRows = (rows) => rows.map((r) => `${r.map((v) => v === null ? "" : v.toString("utf8")).join("\t")}
`).join("");
async function query3(sql, text) {
  if (/^\s*COPY\b[\s\S]*\bTO\s+STDOUT\s*;?\s*$/i.test(text)) {
    let out = "";
    for await (const chunk of await sql.unsafe(text).readable())
      out += chunk.toString();
    return out;
  }
  const r = await sql.unsafe(text).simple().raw();
  const results = r.length > 0 && r[0].command !== undefined ? r : [r];
  return results.map(formatRows).join("");
}
async function copyIn(sql, copy, data) {
  const m = /^COPY (.+?) \((.*)\) FROM STDIN$/.exec(copy);
  if (m === null)
    throw new Error("a COPY block names no column list");
  const rows = copyRows(data);
  if (rows.length === 0)
    return;
  const target = m[1], cols = m[2];
  const names = [...cols.matchAll(/"((?:[^"]|"")*)"/g)].map((c) => c[1].replace(/""/g, '"'));
  const found = await sql.unsafe(`SELECT a.attname::text AS name, a.atttypid::regtype::text AS type FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`, [target]);
  const typeOf = new Map(found.map((r) => [r.name, r.type]));
  const select = names.map((name, i) => {
    const t = typeOf.get(name);
    if (t === undefined)
      throw new Error(`column ${name} of ${target} was not found`);
    return `(r->>${i})::${t}`;
  }).join(", ");
  await sql.unsafe(`INSERT INTO ${target} (${cols}) SELECT ${select} FROM json_array_elements($1::text::json) r`, [JSON.stringify(rows)]);
}
function sslOf(mode) {
  if (mode === "disable")
    return false;
  if (mode === "require")
    return "require";
  if (mode === "verify-ca" || mode === "verify-full")
    return "verify-full";
  return "prefer";
}
var firstLine2 = (text) => text.split(`
`)[0];
function errorText(e, copyOf) {
  const err = e;
  if (err.severity !== undefined) {
    let out = `ERROR:  ${firstLine2(err.message ?? "")}
`;
    if (copyOf !== null)
      out += `CONTEXT:  COPY ${copyOf}, rows
`;
    else if (err.where)
      out += `CONTEXT:  ${firstLine2(err.where)}
`;
    return out;
  }
  return `dkod-db: error: the built-in Postgres client failed${err.code ? ` (${err.code})` : ""}: ${firstLine2(err.message ?? String(e))}
`;
}
function readArgs(extra, input) {
  const parts = [];
  let script = false, single = false;
  for (let i = 0;i < extra.length; i++) {
    const a = extra[i];
    if (a === "-c")
      parts.push({ sql: extra[++i] });
    else if (a === "-f" && extra[i + 1] === "-") {
      i++;
      script = true;
      parts.push(...splitScript(input ?? ""));
    } else if (a === "--single-transaction")
      single = true;
    else
      throw new Error(`psql argument ${a} is not supported`);
  }
  return { parts, script, single };
}
async function runPg(url, env, extra, input) {
  let args;
  let sql;
  try {
    args = readArgs(extra, input);
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode") ?? env.PGSSLMODE;
    u.searchParams.delete("sslmode");
    sql = src_default(u.toString(), {
      max: 1,
      prepare: false,
      fetch_types: false,
      onnotice: () => {},
      ssl: sslOf(mode),
      ...u.password === "" && env.PGPASSWORD ? { password: env.PGPASSWORD } : {},
      connect_timeout: Number(env.PGCONNECT_TIMEOUT ?? 10)
    });
  } catch (e) {
    return { status: 2, stdout: "", stderr: errorText(e, null) };
  }
  let stdout = "";
  let copyOf = null;
  const runAll = async (s) => {
    for (const p of args.parts) {
      if ("sql" in p) {
        copyOf = null;
        stdout += await query3(s, p.sql);
        continue;
      }
      copyOf = /^COPY (?:public\.)?"?(.+?)"? \(/.exec(p.copy)?.[1] ?? null;
      await copyIn(s, p.copy, p.data);
      copyOf = null;
    }
  };
  try {
    if (args.single)
      await sql.begin(runAll);
    else
      await runAll(sql);
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const connection = e.severity === undefined;
    return { status: connection ? 2 : args.script ? 3 : 1, stdout, stderr: errorText(e, copyOf) };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

function stateDir() {
  const dir = join5(homedir(), ".dkod", "db");
  mkdirSync(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
  return dir;
}
var exited = new Set;
process.exitCode = await runDbCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  readFile: (path) => {
    try {
      return readFileSync2(path, "utf8");
    } catch {
      return null;
    }
  },
  sha256: (path) => {
    try {
      return createHash5("sha256").update(readFileSync2(path)).digest("hex");
    } catch {
      return null;
    }
  },
  writeFile: (path, text) => writeFileSync(path, text, "utf8"),
  devicePath: () => join5(stateDir(), "device.json"),
  writePrivate: (path, text) => {
    writeFileSync(path, text, { encoding: "utf8", mode: 384 });
    chmodSync(path, 384);
  },
  pluginRoot: resolve(dirname(process.argv[1] ?? "."), "..", "..", ".."),
  exists: (path) => existsSync(path),
  fetch: (url, init) => dashboardFetch(url, init, (u, i) => fetch(u, i)),
  print: (line) => process.stdout.write(`${line}
`),
  now: () => Date.now(),
  schedule: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  uuid: () => randomUUID(),
  run: runProcess,
  pg: runPg,
  onStop: (fn) => {
    process.once("SIGINT", fn);
    process.once("SIGTERM", fn);
  },
  spawnDetached: (args, logPath) => {
    const log = openSync2(logPath, "w");
    const child = spawn2(process.execPath, [process.argv[1], ...args], { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync2(log);
    child.on("exit", () => {
      if (child.pid !== undefined)
        exited.add(child.pid);
    });
    child.unref();
    return child.pid ?? 0;
  },
  alive: (pid) => {
    if (exited.has(pid))
      return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal);
    } catch {}
  },
  stateDir,
  remove: (path) => {
    try {
      rmSync(path, { force: true });
    } catch {}
  },
  listDir: (path) => {
    try {
      return readdirSync2(path, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
    } catch {
      return [];
    }
  },
  listStates: () => {
    try {
      const dir = stateDir();
      return readdirSync2(dir).filter((name) => /^dkod-db-[0-9a-f]{16}\.json$/.test(name)).map((name) => join5(dir, name));
    } catch {
      return [];
    }
  }
});
