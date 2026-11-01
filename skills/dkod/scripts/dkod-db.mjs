// Built by packages/dkoder-plugin/scripts/build-db.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:db`.
import { createHash as createHash4, randomUUID } from "node:crypto";
import { spawn as spawn2 } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";

import { createHash as createHash3, randomBytes as randomBytes2 } from "node:crypto";
import net2 from "node:net";
import { resolve as resolvePath } from "node:path";

import { createHash } from "node:crypto";
function sealOf(r, nonce) {
  const body = { mode: r.mode, scratch: r.scratch, files: r.files, databases: (r.databases ?? []).map((d) => ({ name: d.name, url: d.url, tables: d.tables ?? null, ...d.source === undefined ? {} : { source: d.source } })), env: r.env, message: r.message ?? null, ...r.bases === undefined ? {} : { bases: r.bases }, ...r.source === undefined ? {} : { source: r.source }, ...r.checks === undefined ? {} : { checks: r.checks } };
  return createHash("sha256").update(JSON.stringify(body)).update(nonce).digest("hex");
}

var q = (name) => `"${name.replace(/"/g, '""')}"`;
async function query(run, env, base, sql, cwd) {
  const res = await run("sqlite3", ["-readonly", "-json", base, sql], env, cwd);
  if (res.status === 127)
    return { ok: false, missing: true, reason: "the sqlite3 binary is not on PATH" };
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
  const socket = secure ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }) : net.connect({ host, port });
  const finish = (code, reason) => {
    if (closed)
      return;
    closed = true;
    handlers.onClose?.(code, reason);
  };
  const write = (data) => {
    if (socket.destroyed || !socket.writable)
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
    socket.destroy();
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
    socket.write(lines.join(`\r
`));
  };
  socket.once(secure ? "secureConnect" : "connect", sendRequest);
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
          socket.end();
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
  socket.on("data", (chunk) => {
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
        socket.destroy();
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
        socket.removeAllListeners("data");
        socket.destroy();
        closed = true;
        handlers.onRefused?.(status, reason);
      };
      if (rest.length >= want) {
        deliver(rest);
        return;
      }
      let body = rest;
      socket.removeAllListeners("data");
      socket.on("data", (more) => {
        body = Buffer.concat([body, more]);
        if (body.length >= want)
          deliver(body);
      });
      return;
    }
    if (got.get("upgrade")?.toLowerCase() !== "websocket" || got.get("sec-websocket-accept") !== expectedAccept) {
      socket.destroy();
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
  socket.on("drain", () => {
    if (needDrain) {
      needDrain = false;
      handlers.onDrain?.();
    }
  });
  socket.on("error", (error) => finish(1006, error.code ?? "socket_error"));
  socket.on("close", () => finish(1006, "connection closed"));
  return {
    sendBinary: (data) => write(frame(2, data)),
    sendText: (text) => write(frame(1, Buffer.from(text))),
    close(code = 1000, reason = "") {
      if (closed || sentClose)
        return;
      if (!opened) {
        socket.destroy();
        finish(code, reason);
        return;
      }
      sentClose = true;
      write(frame(8, closeBody(code, reason)));
      setTimeout(() => socket.destroy(), 1000).unref();
    },
    pause: () => {
      socket.pause();
    },
    resume: () => {
      socket.resume();
    }
  };
}

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
  up: ["app", "port", "dir", "gateway", "config", "wait"],
  down: ["dir"],
  migrate: ["dir", "port"],
  explain: [],
  import: ["app", "from", "dir", "port"]
};
var BOOLEAN_FLAGS = { up: ["detach"], down: ["all"] };
function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || !(command in FLAGS))
    return { error: "usage" };
  const flags = new Map;
  for (let i = 0;i < rest.length; i += 2) {
    const name = rest[i]?.startsWith("--") ? rest[i].slice(2) : null;
    if (name !== null && BOOLEAN_FLAGS[command]?.includes(name)) {
      flags.set(name, "true");
      i--;
      continue;
    }
    const value = rest[i + 1];
    if (name === null || value === undefined || !FLAGS[command].includes(name))
      return { error: "usage" };
    flags.set(name, value);
  }
  return { command, flags };
}
var USAGE = [
  "Usage:",
  "  node dkod-db.mjs up --app <app key> [--port 6543] [--dir <app folder>] [--wait <seconds>] [--detach]",
  "  node dkod-db.mjs down [--dir <app folder>] [--all]",
  "  node dkod-db.mjs migrate [--dir <app folder>] [--port 6543]",
  "  node dkod-db.mjs import --app <app key> --from <local postgres URL | snapshot> [--dir <app folder>] [--port 6543]"
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
var NO_DEVICE = "This computer has no Dkoder device token. Install Dkoder here first, then run this again.";
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
function resolveCredentials(env, configPath, readFile) {
  if (env.DKOD_URL && env.DKODER_TOKEN) {
    const dashboardUrl = trustedDashboard(env.DKOD_URL);
    return dashboardUrl ? { dashboardUrl, token: env.DKODER_TOKEN } : null;
  }
  const candidates = [configPath, env.CLAUDE_PLUGIN_ROOT && `${env.CLAUDE_PLUGIN_ROOT}/dkoder.json`, env.CURSOR_PLUGIN_ROOT && `${env.CURSOR_PLUGIN_ROOT}/dkoder.json`];
  for (const path of candidates) {
    if (!path)
      continue;
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
  return null;
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
  } catch {
    throw new TokenError("unavailable", "Could not reach the dashboard. Check the network and try again.");
  }
  const raw = await res.text().catch(() => "");
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {}
  if (res.status === 401)
    throw new TokenError("refused", "The dashboard refused this computer's device token. Reinstall Dkoder or ask your admin for a new one.");
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
  return { token: body.token, expiresAt, gatewayUrl: typeof body.gateway_url === "string" ? body.gateway_url : null };
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
var join = (dir, name) => dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}/${name}`;
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
  const dir = flags.get("dir") ?? cwd;
  const creds = resolveCredentials(io.env, flags.get("config"), io.readFile);
  if (!creds)
    return fail(2, NO_DEVICE);
  let issued;
  try {
    issued = await fetchDbToken(creds, app, io);
  } catch (error) {
    return fail(error instanceof TokenError && error.kind === "unavailable" ? 1 : 2, error instanceof Error ? error.message : "Could not get a token.");
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
      const next = await fetchDbToken(creds, app, io);
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
      if (!ws.sendBinary(chunk))
        sock.pause();
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
          if (!ws.sendBinary(chunk))
            sock.pause();
        pending = [];
      },
      onBinary(data) {
        if (!sock.write(data)) {
          ws.pause();
          sock.once("drain", () => ws.resume());
        }
      },
      onText(text) {
        try {
          if (JSON.parse(text).type === "renewed")
            io.print("dkod-db: token renewed");
        } catch {}
      },
      onDrain() {
        sock.resume();
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
      const next = await fetchDbToken(creds, app, io);
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
  const envPath = join(dir, ".env.local");
  io.writeFile(envPath, mergeDatabaseUrl(io.readFile(envPath), databaseUrlOf(app, actualPort)));
  if (!gitignoreCoversEnvLocal(io.readFile(join(dir, ".gitignore"))))
    io.print("dkod-db: warning: .gitignore does not ignore .env.local. Add it so it is never committed.");
  io.print(`dkod-db: ${app} Dev database on 127.0.0.1:${actualPort} (DATABASE_URL in .env.local)`);
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
        await new Promise((resolve) => server.close(() => resolve()));
      }
    }
  };
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
async function runMigrate(flags, io, cwd, exists) {
  const say = (line) => io.print(`dkod-db: ${line}`);
  const dir = flags.get("dir") ?? cwd;
  const url = readDatabaseUrl(io.readFile(join(dir, ".env.local")));
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
  const drizzle = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"].some((f) => exists(join(dir, f)));
  const tool = drizzle ? { name: "drizzle-kit", cmd: "bunx", args: ["drizzle-kit", "migrate"] } : exists(join(dir, "alembic.ini")) ? { name: "alembic", cmd: "alembic", args: ["upgrade", "head"] } : null;
  if (!tool) {
    say("No migration tool found: expected drizzle.config.ts (or .js, .mjs) or alembic.ini in the app folder.");
    return 2;
  }
  const env = { DATABASE_URL: url };
  for (const name of ["PATH", "HOME", "USER", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot", "LANG"])
    if (io.env[name] !== undefined)
      env[name] = io.env[name];
  const result = await io.run(tool.cmd, tool.args, env, dir);
  const applied = `${result.stdout}
${result.stderr}`.split(`
`).filter((l) => APPLIED.test(l)).length;
  say(`${tool.name} finished with exit status ${result.status}; ${applied} line${applied === 1 ? "" : "s"} look like applied migrations.`);
  if (result.status !== 0) {
    const tail = result.stderr.trim().split(`
`).slice(-20);
    for (const l of tail)
      io.print(l);
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
function safeErrors(stderr) {
  const out = [];
  for (const l of stderr.split(`
`)) {
    const m = /ERROR:\s+(.*)$/.exec(l);
    if (m)
      out.push(`ERROR: ${m[1].replace(/["'].*$/, "…")}`);
    else if (/^psql: error: /.test(l))
      out.push(l.replace(/["'].*$/, "…"));
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
async function importSqlite(c) {
  const { io, say, dir, app } = c;
  const cannot = (why) => {
    say(`the original's data is in SQLite and cannot be imported: ${why}`);
    return 2;
  };
  const noBinary = "the sqlite3 binary is not on PATH. Install it, then run import again.";
  for (const b of c.bases) {
    const got = io.sha256?.(b.base) ?? null;
    if (got === null)
      return cannot("the snapshot's untouched base copy is gone. Run `dkod-migrate.mjs snapshot` again, rerun the suite and freeze again.");
    if (got !== b.sha256) {
      say(`the base copy of ${b.rel} is not the data the suite was frozen on (its sha256 changed after the snapshot). Run \`dkod-migrate.mjs snapshot\` again, rerun the suite and freeze again.`);
      return 1;
    }
  }
  const mapped = readSqliteMapTables(io.readFile(join(dir, ".dkod/map/app-map.json")));
  if (mapped.length === 0) {
    say("The migration map has no tables to import (.dkod/map/app-map.json).");
    return 2;
  }
  const baseOf = (store) => c.bases.length === 1 ? c.bases[0] : c.bases.find((b) => store !== null && (store === b.rel || b.rel.endsWith(`/${store}`) || store.endsWith(`/${b.rel}`)));
  const schemas = new Map;
  for (const b of c.bases)
    schemas.set(b.rel, await sqliteSchema(io.run, c.baseEnv, b.base, dir));
  for (const s of schemas.values())
    if (!s.ok)
      return cannot(s.missing ? noBinary : `${s.reason}. Run \`dkod-migrate.mjs snapshot\` again.`);
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
      say(`Table ${name} is not in the Dev database. Run the app's db:migrate first.`);
      return 2;
    }
    const src = sourceCols.get(name).cols;
    const cols = src.filter((col) => have.has(col));
    if (cols.length === 0) {
      say(`Table ${name} shares no column with the Dev database.`);
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
  const ordered = fkOrder(tables.map((t) => t.name), edges);
  if ("cycle" in ordered) {
    say(`These tables reference each other in a cycle, so no copy order exists: ${ordered.cycle.join(", ")}.`);
    return 2;
  }
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
${emptyGuard(inOrder)}`;
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
  const mapped = readFlatMapTables(io.readFile(join(dir, ".dkod/map/app-map.json")));
  const stem = (rel) => (rel.split("/").pop() ?? rel).replace(/\.[^.]*$/, "");
  const storeHit = (store, rel) => store !== null && (store === rel || rel.endsWith(`/${store}`) || store.endsWith(`/${rel}`));
  const picked = [];
  const skipped = [];
  for (const b of c.bases) {
    const table = mapped.find((t) => storeHit(t.store, b.rel))?.name ?? mapped.find((t) => t.name === stem(b.rel))?.name ?? (c.bases.length === 1 && mapped.length === 1 ? mapped[0].name : undefined);
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
${emptyGuard(tables)}`;
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
  const snapshotFile = join(dir, ".dkod/snapshot.json");
  let sourceRaw = from;
  let snapshotMode = false;
  let sqliteBases = null;
  let flatBases = [];
  if (!/^postgres(ql)?:\/\//i.test(from)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(from) || from !== "snapshot" && !/\.json$/i.test(from)) {
      say(IMPORT_LOCAL_ONLY);
      return 2;
    }
    let rec = null;
    try {
      rec = JSON.parse(io.readFile(from === "snapshot" ? snapshotFile : /^([/\\]|[a-z]:[/\\])/i.test(from) ? from : join(dir, from)) ?? "null");
    } catch {}
    const r = rec;
    const dbs = r && r.mode === "snapshot" && Array.isArray(r.databases) ? r.databases : [];
    const pg = dbs.find((d) => typeof d.url === "string" && /^postgres(ql)?:\/\//i.test(d.url));
    if (!pg) {
      const bases = Array.isArray(r?.bases) ? r.bases.filter((b) => typeof b?.base === "string" && typeof b.rel === "string" && typeof b.sha256 === "string") : [];
      const hasSqlite = bases.length > 0 || Array.isArray(r?.files) && r.files.some((f) => typeof f === "string" && /\.(?:sqlite|sqlite3|db|db3)$/i.test(f));
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
  const password = sourcePassword || io.env.PGPASSWORD || "";
  source.password = "";
  const sourceUrl = source.toString();
  const devRaw = readDatabaseUrl(io.readFile(join(dir, ".env.local")));
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
  const freezeText = io.readFile(join(dir, ".dkod/parity/freeze.json"));
  if (freezeText === null) {
    say("There is no .dkod/parity/freeze.json. Freeze the parity suite (step 3 of the dkod-migrate skill) before the import.");
    return 2;
  }
  const baseEnv = { ...PG_TIMEOUT };
  for (const name of ["PATH", "HOME", "USER", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot", "LANG"])
    if (io.env[name] !== undefined)
      baseEnv[name] = io.env[name];
  const srcEnv = password ? { ...baseEnv, PGPASSWORD: password } : baseEnv;
  const devEnv = { ...baseEnv, PGSSLMODE: "disable" };
  const psql = (url, env, extra, input) => io.run("psql", ["-w", "-X", "-q", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "--dbname", url, ...extra], env, dir, input);
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
    const ctx = { app, dir, io, say, baseEnv, devUrl, devEnv, bases: sqliteBases, snapshotFile, psql, failed };
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
  const frozenData = readFreezeData(freezeText);
  if (frozenData === null) {
    say("freeze.json records no data identity (no Postgres scratch database was frozen on). Run `dkod-migrate.mjs snapshot`, rerun the suite and freeze again.");
    return 1;
  }
  const mapped = readMapTables(io.readFile(join(dir, ".dkod/map/app-map.json")));
  if (mapped.length === 0) {
    say("The migration map has no tables to import (.dkod/map/app-map.json).");
    return 2;
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
  const tables = [];
  for (const name of present) {
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
  const ordered = fkOrder(tables.map((t) => t.name), edges);
  if ("cycle" in ordered) {
    say(`These tables reference each other in a cycle, so no copy order exists: ${ordered.cycle.join(", ")}.`);
    return 2;
  }
  const byName = new Map(tables.map((t) => [t.name, t]));
  const inOrder = ordered.order.map((n) => byName.get(n));
  const srcHash = await psql(sourceUrl, srcEnv, ["-f", "-"], `${PG_SETTINGS}
${inOrder.map(hashSql).join(`
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
    for (const n of differing)
      say(`Dev table ${n} already has rows that differ from the original's: the dk- app's own migrations insert rows in ${n} that differ from the original's. Change those migrations to insert exactly the original's rows (or none), then drop and remake Dev, run db:migrate and import again. Never delete or edit Dev rows by hand; import never overwrites.`);
    const refused = inOrder.map((t, i) => ({ name: t.name, source: expected[i], dev: before[i], match: before[i].rows === expected[i].rows && before[i].md5 === expected[i].md5 }));
    io.print(JSON.stringify({ ok: false, app, tables: refused, already_present: alreadyPresent, imported: false }));
    return 1;
  }
  say(`warning: ${DEV_WARNING}`);
  if (alreadyPresent.length > 0)
    say(`these tables already hold the original's rows, so they were not copied: ${alreadyPresent.join(", ")}.`);
  let script = `${PG_SETTINGS}
`;
  script += emptyGuard(toCopy);
  for (const t of toCopy) {
    const cols = t.cols.map(quoteIdent).join(", ");
    const data = await psql(sourceUrl, srcEnv, ["-c", PG_SETTINGS, "-c", `COPY (SELECT ${cols} FROM public.${quoteIdent(t.name)}) TO STDOUT`]);
    if (data.status !== 0)
      return failed(`Could not read table ${t.name} from the original.`, data.stderr);
    script += `COPY public.${quoteIdent(t.name)} (${cols}) FROM STDIN;
${data.stdout}${data.stdout === "" || data.stdout.endsWith(`
`) ? "" : `
`}\\.
`;
  }
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
    for (const l of safeErrors(devRun.stderr))
      io.print(l);
    io.print(JSON.stringify({ ok: false, app, tables: report, already_present: alreadyPresent, imported: false }));
    return 1;
  }
  const importedTables = {};
  inOrder.forEach((t, i) => {
    importedTables[t.name] = { cols: t.cols, rows: report[i].dev.rows, md5: report[i].dev.md5 };
  });
  const marks = { imported: true, imported_tables: importedTables, dev_url: devUrl };
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
  io.print(JSON.stringify({ ok: true, app, tables: report, already_present: alreadyPresent, imported: true, skipped_tables: skippedTables, dropped_columns: droppedColumns }));
  return 0;
}
function statePaths(io, dir) {
  const resolved = resolvePath(dir);
  const base = join(io.stateDir(), `dkod-db-${createHash3("sha256").update(resolved).digest("hex").slice(0, 16)}`);
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
var sleep = (io, ms) => new Promise((resolve) => {
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
    await sleep(io, POLL_MS);
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
      say(`Port ${wanted} is held by the dkod-db tunnel for app ${h.app} (pid ${h.pid}) started in ${h.dir}. Stop it with: node dkod-db.mjs down --dir ${h.dir} (or down --all), then run this again.`);
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
    await sleep(io, POLL_MS);
    const log = io.readFile(paths.log) ?? "";
    const port = Number(READY_LINE.exec(log)?.[1] ?? 0);
    if (port > 0 && readDatabaseUrl(io.readFile(join(paths.dir, ".env.local"))) !== null && await probe(port)) {
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
    io.print(USAGE);
    return 2;
  }
  switch (args.command) {
    case "up": {
      if (args.flags.has("detach"))
        return await runUpDetached(args.flags, io);
      const started = await startUp(args.flags, io, io.cwd);
      if ("exit" in started)
        return started.exit;
      await new Promise((resolve) => io.onStop(resolve));
      await started.handle.stop();
      return 0;
    }
    case "down":
      return await runDown(args.flags, io);
    case "migrate":
      return await runMigrate(args.flags, io, io.cwd, io.exists);
    case "explain":
      io.print("dkod-db: explain is coming in DKO-1052");
      return 2;
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
    child.on("error", () => resolve({ status: 127, stdout, stderr: `${stderr}Could not start ${cmd}.
` }));
    child.on("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

function stateDir() {
  const dir = join2(homedir(), ".dkod", "db");
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
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  sha256: (path) => {
    try {
      return createHash4("sha256").update(readFileSync(path)).digest("hex");
    } catch {
      return null;
    }
  },
  writeFile: (path, text) => writeFileSync(path, text, "utf8"),
  exists: (path) => existsSync(path),
  fetch: async (url, init) => await fetch(url, init),
  print: (line) => process.stdout.write(`${line}
`),
  now: () => Date.now(),
  schedule: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  uuid: () => randomUUID(),
  run: runProcess,
  onStop: (fn) => {
    process.once("SIGINT", fn);
    process.once("SIGTERM", fn);
  },
  spawnDetached: (args, logPath) => {
    const log = openSync(logPath, "w");
    const child = spawn2(process.execPath, [process.argv[1], ...args], { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync(log);
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
  listStates: () => {
    try {
      const dir = stateDir();
      return readdirSync(dir).filter((name) => /^dkod-db-[0-9a-f]{16}\.json$/.test(name)).map((name) => join2(dir, name));
    } catch {
      return [];
    }
  }
});
