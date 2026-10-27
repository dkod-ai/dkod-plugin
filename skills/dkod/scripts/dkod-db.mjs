// Built by packages/dkoder-plugin/scripts/build-db.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:db`.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import net2 from "node:net";

import { createHash, randomBytes } from "node:crypto";
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
  const expectedAccept = createHash("sha1").update(key + GUID).digest("base64");
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

var DB_APP_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;
var DEFAULT_PORT = 6543;
var WAIT_LIMIT_MS = 10 * 60000;
var CHECK_TIMEOUT_MS = 15000;
var CHECK_RETRY_MS = 1e4;
var PENDING_CAP = 1 << 20;
var RENEW_BEFORE_MS = 5 * 60000;
var RENEW_MIN_MS = 30000;
var RETRY_STEPS_MS = [30000, 60000, 120000, 300000];
var FLAGS = {
  up: ["app", "port", "dir", "gateway", "config", "wait"],
  migrate: ["dir", "port"],
  explain: [],
  import: []
};
function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || !(command in FLAGS))
    return { error: "usage" };
  const flags = new Map;
  for (let i = 0;i < rest.length; i += 2) {
    const name = rest[i]?.startsWith("--") ? rest[i].slice(2) : null;
    const value = rest[i + 1];
    if (name === null || value === undefined || !FLAGS[command].includes(name))
      return { error: "usage" };
    flags.set(name, value);
  }
  return { command, flags };
}
var USAGE = [
  "Usage:",
  "  node dkod-db.mjs up --app <app key> [--port 6543] [--dir <app folder>] [--wait <seconds>]",
  "  node dkod-db.mjs migrate [--dir <app folder>] [--port 6543]"
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
            for (let i = 0;i < body.length && body[i] !== 0; ) {
              const end = body.indexOf(0, i + 1);
              if (end < 0)
                break;
              if (String.fromCharCode(body[i]) === "C")
                code = body.subarray(i + 1, end).toString();
              i = end + 1;
            }
            finish({ kind: code === "3D000" ? "no_database" : "not_open" });
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
  for (;; ) {
    const checked = await checkDatabase(gateway, app, issued.token, io);
    if (checked.kind === "ready")
      break;
    if (checked.kind === "refused")
      return fail(2, `connect refused: ${checked.reason}`);
    if (checked.kind === "no_database")
      sawNoDatabase = true;
    const elapsed = io.now() - startedAt;
    if (elapsed + CHECK_RETRY_MS > waitMs)
      return fail(1, sawNoDatabase ? missingDb(app) : notReachable(app));
    io.print(`dkod-db: waiting for DKOD to make the ${app} Dev database (${Math.round(elapsed / 1000)} s of ${Math.round(waitMs / 1000)} s)`);
    await new Promise((resolve) => {
      io.schedule(CHECK_RETRY_MS, resolve);
    });
  }
  let token = issued.token;
  let expiresAt = issued.expiresAt;
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
async function runDbCli(argv, io) {
  const args = parseArgs(argv);
  if ("error" in args) {
    io.print(USAGE);
    return 2;
  }
  switch (args.command) {
    case "up": {
      const started = await startUp(args.flags, io, io.cwd);
      if ("exit" in started)
        return started.exit;
      await new Promise((resolve) => io.onStop(resolve));
      await started.handle.stop();
      return 0;
    }
    case "migrate":
      return await runMigrate(args.flags, io, io.cwd, io.exists);
    case "explain":
      io.print("dkod-db: explain is coming in DKO-1052");
      return 2;
    default:
      io.print("dkod-db: import is coming in DKO-1053");
      return 2;
  }
}

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
  run: (cmd, args, env, cwd) => new Promise((resolve) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
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
  }),
  onStop: (fn) => {
    process.once("SIGINT", fn);
    process.once("SIGTERM", fn);
  }
});
