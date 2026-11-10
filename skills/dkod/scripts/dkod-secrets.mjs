// Built by packages/dkoder-plugin/scripts/build-secrets.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:secrets`.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

var ENV_FILE_MAX_BYTES = 256 * 1024;
var QUOTES = { "'": "single", '"': "double", "`": "backtick" };
var ESCAPES = { n: `
`, r: "\r", t: "\t", '"': '"', "\\": "\\" };
var isBlank = (char) => char === " " || char === "\t";
var isLetter = (char) => char !== undefined && (char >= "a" && char <= "z" || char >= "A" && char <= "Z");
var isDigit = (char) => char !== undefined && char >= "0" && char <= "9";
var isNameStart = (char) => isLetter(char) || char === "_";
var isNameChar = (char) => isNameStart(char) || isDigit(char) || char === "." || char === "-";
function parseEnvFile(input) {
  if (input.length > ENV_FILE_MAX_BYTES || new TextEncoder().encode(input).length > ENV_FILE_MAX_BYTES)
    return { ok: false, problem: "too_large" };
  if (input.includes("\x00"))
    return { ok: false, problem: "nul_byte" };
  const text = (input.charCodeAt(0) === 65279 ? input.slice(1) : input).replace(/\r\n?/g, `
`);
  const found = new Map;
  const skipped = [];
  let pos = 0;
  let line = 1;
  const lineEnd = (from) => {
    const at = text.indexOf(`
`, from);
    return at === -1 ? text.length : at;
  };
  const skipBlanks = (from) => {
    let at = from;
    while (isBlank(text[at]))
      at += 1;
    return at;
  };
  while (pos < text.length) {
    const startLine = line;
    let end = lineEnd(pos);
    let at = skipBlanks(pos);
    if (at < end && text[at] !== "#") {
      if (text.startsWith("export", at) && isBlank(text[at + 6]))
        at = skipBlanks(at + 6);
      const nameFrom = at;
      if (isNameStart(text[at]))
        while (isNameChar(text[at]))
          at += 1;
      const name = text.slice(nameFrom, at);
      at = skipBlanks(at);
      if (name === "" || text[at] !== "=") {
        skipped.push(startLine);
      } else {
        const afterEquals = at + 1;
        at = skipBlanks(afterEquals);
        const quote = QUOTES[text[at] ?? ""];
        if (quote !== undefined) {
          const mark = text[at];
          let close = at + 1;
          let value = "";
          while (close < text.length && text[close] !== mark) {
            const char = text[close];
            if (char === `
`)
              line += 1;
            if (quote === "double" && char === "\\" && close + 1 < text.length) {
              const next = text[close + 1];
              if (next === `
`)
                line += 1;
              value += ESCAPES[next] ?? char + next;
              close += 2;
            } else {
              value += char;
              close += 1;
            }
          }
          if (close >= text.length)
            return { ok: false, problem: "open_quote", line: startLine };
          end = lineEnd(close);
          const rest = skipBlanks(close + 1);
          if (rest >= end || text[rest] === "#")
            found.set(name, { name, value, line: startLine, quote });
          else
            skipped.push(startLine);
        } else {
          let stop = end;
          if (text[at] === "#" && at > afterEquals)
            stop = at;
          else
            for (let i = at + 1;i < end; i += 1)
              if (text[i] === "#" && isBlank(text[i - 1])) {
                stop = i;
                break;
              }
          while (stop > at && isBlank(text[stop - 1]))
            stop -= 1;
          found.set(name, { name, value: text.slice(at, stop), line: startLine, quote: "none" });
        }
      }
    }
    pos = end + 1;
    line += 1;
  }
  return { ok: true, entries: [...found.values()], skipped };
}
var isHostChar = (char) => isLetter(char) || isDigit(char) || char === "-" || char === "_";
function hasHost(text, host) {
  const numeric = isDigit(host[0]);
  for (let at = text.indexOf(host);at !== -1; at = text.indexOf(host, at + 1)) {
    const before = text[at - 1];
    const after = text[at + host.length];
    const startsClean = !isHostChar(before) && !(numeric && before === "." && isDigit(text[at - 2]));
    const endsClean = !isHostChar(after) && !(after === "." && (numeric ? isDigit(text[at + host.length + 1]) : true));
    if (startsClean && endsClean)
      return true;
  }
  return false;
}
function envValueIsLocal(value) {
  const text = value.toLowerCase();
  if (/^(?:file|sqlite3?):/.test(text.trim()))
    return true;
  return isHomePath(value.trim()) || hasHost(text, "localhost") || hasHost(text, "host.docker.internal") || hasHost(text, "127.0.0.1") || text.includes("[::1]") || text.trim() === "::1";
}
function isHomePath(value) {
  return /^(?:\/Users\/|\/home\/|~\/|[A-Za-z]:[\\/]Users[\\/])/.test(value);
}
function envValueHasReference(entry) {
  if (entry.quote === "single")
    return false;
  const { value } = entry;
  const lastClose = value.lastIndexOf("}");
  for (let at = value.indexOf("${");at !== -1 && at < lastClose; at = value.indexOf("${", at + 1)) {
    if (value[at - 1] !== "\\" && isNameStart(value[at + 2]))
      return true;
  }
  return false;
}

var EXTERNAL_DB_ENV = /^[A-Z][A-Z0-9_]*_DATABASE_URL(?:_UNPOOLED)?$/;
var EXTERNAL_DB_ENV_NAMES = new Set(["DATABASE_URL_UNPOOLED", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NO_SSL"]);
var isExternalDatabaseEnvName = (name) => name.length <= 200 && (EXTERNAL_DB_ENV.test(name) || EXTERNAL_DB_ENV_NAMES.has(name));
var SEQ_TYPES = new Set(["smallint", "integer", "bigint"]);
var KINDS = new Set(["p", "u", "c", "f", "x"]);

var DROP_RULES = new Set(["env_file", "secret_file", "key_store", "binary_not_scannable"]);
var GUESS_RULES = new Set(["secret_assignment"]);
var DIRS = [
  ["docs", new Set(["docs", "doc", "documentation", "openspec", "adr", "adrs", "rfcs"])],
  ["tests", new Set([
    "test",
    "tests",
    "__tests__",
    "spec",
    "specs",
    "e2e",
    "fixtures",
    "__fixtures__",
    "__mocks__",
    "mocks",
    "testdata",
    "test-data",
    "cypress",
    "playwright",
    "stories",
    ".storybook",
    "bench",
    "benchmarks",
    "examples",
    "example",
    "samples"
  ])],
  ["tooling", new Set([
    "scripts",
    "script",
    "tools",
    "hack",
    ".github",
    ".gitlab",
    ".circleci",
    ".buildkite",
    ".husky",
    ".claude",
    ".cursor",
    ".vscode",
    ".idea",
    ".devcontainer",
    ".dkod"
  ])],
  ["deploy", new Set([
    "infra",
    "infrastructure",
    "deploy",
    "deploys",
    "deployment",
    "deployments",
    "k8s",
    "kube",
    "kubernetes",
    "helm",
    "chart",
    "charts",
    "kustomize",
    "argocd",
    "argo",
    "terraform",
    "pulumi",
    "ansible",
    "manifests",
    "sealed-secrets",
    "sealedsecrets",
    "ops",
    "docker"
  ])]
];
var SCREAMING = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
var PUBLIC_PREFIXES = ["VITE_", "NEXT_PUBLIC_", "PUBLIC_", "EXPO_PUBLIC_", "REACT_APP_", "NUXT_PUBLIC_", "GATSBY_", "STORYBOOK_"];
var DKOD_PROVIDED = new Set(["PORT", "HOST", "HOSTNAME", "NODE_ENV"]);
var STRONG_LAST = new Set(["TOKEN", "SECRET", "PASSWORD", "PASSWD", "PWD", "PASS", "PASSPHRASE", "CREDENTIAL", "CREDENTIALS", "APIKEY", "SECRETKEY", "PRIVATEKEY"]);
var KEY_QUALIFIERS = new Set([
  "API",
  "SECRET",
  "ACCESS",
  "PRIVATE",
  "SIGNING",
  "SIGNATURE",
  "ENCRYPTION",
  "ENCRYPT",
  "CRYPTO",
  "CIPHER",
  "HMAC",
  "JWT",
  "LICENSE",
  "LICENCE",
  "AUTH",
  "CLIENT",
  "MASTER",
  "SERVICE",
  "ADMIN",
  "DEPLOY",
  "WEBHOOK",
  "SSH",
  "GPG",
  "PGP",
  "ROOT",
  "SHARED",
  "SERVER",
  "SUBSCRIPTION",
  "ROLE",
  "APP",
  "APPLICATION",
  "ACCOUNT",
  "INGEST",
  "WRITE",
  "MANAGEMENT"
]);
var NOT_CREDENTIAL_WORDS = new Set([
  "PUBLIC",
  "PUBLISHABLE",
  "STORAGE",
  "CACHE",
  "COOKIE",
  "HEADER",
  "PARAM",
  "FIELD",
  "PREFIX",
  "NAME",
  "LABEL",
  "I18N",
  "EVENT",
  "ROUTE",
  "PATH",
  "FILE",
  "DIR",
  "TYPE",
  "LENGTH",
  "TTL",
  "EXPIRY",
  "EXPIRES",
  "TIMEOUT",
  "MAX",
  "MIN",
  "LIMIT",
  "COUNT",
  "SIZE",
  "VERSION",
  "VERSIONS",
  "ENABLED",
  "DISABLED",
  "MODE",
  "PENDING",
  "DISMISSED",
  "STATS",
  "QUERY",
  "ID"
]);
var CONNECTION_WORDS = new Set(["DATABASE", "DB", "POSTGRES", "POSTGRESQL", "PG", "MYSQL", "MARIADB", "MONGO", "MONGODB", "REDIS", "VALKEY", "AMQP", "RABBITMQ", "CLOUDINARY"]);
var N = "([A-Z][A-Z0-9_]*)";
var Q = "[\"'`]";
var ENV_READ_PATTERNS = [
  new RegExp(`\\bprocess\\??\\.env\\??\\.${N}`, "g"),
  new RegExp(`\\bprocess\\??\\.env\\??\\.?\\[\\s*${Q}${N}${Q}\\s*\\]`, "g"),
  new RegExp(`\\bimport\\.meta\\.env\\??\\.${N}`, "g"),
  new RegExp(`\\bBun\\.env\\.${N}`, "g"),
  new RegExp(`\\bDeno\\.env\\.get\\(\\s*${Q}${N}${Q}`, "g"),
  new RegExp(`\\b(?:c|ctx|context)\\.env\\.${N}`, "g"),
  new RegExp(`\\bos\\.environ\\[\\s*${Q}${N}${Q}\\s*\\]`, "g"),
  new RegExp(`\\b(?:os\\.)?environ\\.get\\(\\s*${Q}${N}${Q}`, "g"),
  new RegExp(`\\bos\\.getenv\\(\\s*${Q}${N}${Q}`, "g"),
  new RegExp(`\\b(?:env|config)\\(\\s*${Q}${N}${Q}`, "g"),
  new RegExp(`\\bos\\.(?:Getenv|LookupEnv)\\(\\s*${Q}${N}${Q}`, "g"),
  new RegExp(`\\benv::var(?:_os)?\\(\\s*"${N}"`, "g"),
  new RegExp(`\\b(?:option_)?env!\\(\\s*"${N}"`, "g"),
  new RegExp(`\\bdotenvy?::var\\(\\s*"${N}"`, "g"),
  new RegExp(`\\bENV(?:\\.fetch\\(\\s*|\\[\\s*)${Q}${N}${Q}`, "g"),
  new RegExp(`\\bgetenv\\(\\s*${Q}${N}${Q}`, "g"),
  new RegExp(`\\$_(?:ENV|SERVER)\\[\\s*${Q}${N}${Q}`, "g"),
  new RegExp(`\\bSystem\\.getenv\\(\\s*"${N}"`, "g"),
  new RegExp(`\\bEnvironment\\.GetEnvironmentVariable\\(\\s*"${N}"`, "g"),
  new RegExp(`\\bSystem\\.(?:get_env|fetch_env!?)\\(\\s*"${N}"`, "g")
];
var ATTRIBUTE_PATTERNS = [
  [/\.rs$/i, new RegExp(`\\benv\\s*=\\s*"${N}"`, "g")],
  [/\.go$/i, new RegExp(`\\benv(?:config)?:"${N}`, "g")],
  [/\.py$/i, new RegExp(`\\b(?:env|validation_alias|alias)\\s*=\\s*${Q}${N}${Q}`, "g")]
];
var ENV_OBJECT = String.raw`(?:process\??\.env|import\.meta\.env|Bun\.env)\b`;
var ALIAS_BINDING = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]{0,40})\s*(?::[^=\n]{0,80})?=[^;\n]{0,120}?` + ENV_OBJECT, "g");
var ALIAS_FUNCTION = new RegExp(String.raw`\bfunction\s+([A-Za-z_$][\w$]{0,40})\s*\([^)]{0,80}\)[^{]{0,120}\{[^}]{0,300}?` + ENV_OBJECT, "g");
function isPublicBuildEnvName(name) {
  return SCREAMING.test(name) && PUBLIC_PREFIXES.some((p) => name.startsWith(p) && name.length > p.length);
}
var PLATFORM_NAMES = new Set([
  "CI",
  "TZ",
  "PATH",
  "HOME",
  "PWD",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "TMPDIR",
  "TEMP",
  "TMP",
  "DEBUG",
  "VERCEL",
  "NETLIFY",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_DEBUG",
  "PYTHONPATH",
  "FORCE_COLOR",
  "NO_COLOR",
  "COLORTERM",
  "MODE",
  "DEV",
  "PROD",
  "SSR"
]);

var RESPONSIBILITIES = {
  responsibility_manager: { label: "Responsibilities manager", description: "Assign other organization members to responsibilities.", scope: "organization" },
  security: { label: "CISO / Security", description: "Approve security policy, access and network boundaries.", scope: "organization" },
  platform: { label: "DevOps / Platform", description: "Supply infrastructure, deployment and operational settings.", scope: "organization" },
  identity: { label: "IT / Identity", description: "Configure sign-in and identity-provider references.", scope: "organization" },
  ai_manager: { label: "AI Manager", description: "Authorize AI features, credentials, consent and spending limits.", scope: "organization" },
  source_control: { label: "Source-control owner", description: "Connect source control and submit reviewed governance changes.", scope: "organization" },
  fleet: { label: "Fleet owner", description: "Configure and verify the fleet rollout.", scope: "organization" },
  compliance: { label: "Compliance coordinator", description: "Coordinate the pilot scope and its evidence.", scope: "organization" },
  source_owner: { label: "Source owner", description: "Approve the current boundary for one assigned pilot source.", scope: "compliance_source" },
  fde: { label: "DKOD FDE", description: "Coordinate setup assistance and evidence of acceptance.", scope: "organization" }
};

var ENV_NAME = /^[A-Z](?:[A-Z0-9_]{0,61}[A-Z0-9])?$/;
function isRuntimeSecretName(name) {
  return ENV_NAME.test(name) && !isPublicBuildEnvName(name);
}
var RUNTIME_SECRET_OWNER_KEYS = Object.keys(RESPONSIBILITIES).filter((key) => key !== "source_owner" && key !== "fde" && key !== "responsibility_manager");
var RUNTIME_SECRET_VALUE_MAX = 32 * 1024;
var APP_SECRETS_MAX = 50;
var DATABASE_ENV_NAMES = ["DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSSLROOTCERT"];
var isDatabaseEnvName = (name) => DATABASE_ENV_NAMES.includes(name);
var withoutDatabaseEnvNames = (names) => names.filter((name) => !isDatabaseEnvName(name));
var REDIS_ENV_NAMES = ["REDIS_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD"];
var isRedisEnvName = (name) => REDIS_ENV_NAMES.includes(name);

var subtle = globalThis.crypto.subtle;
var own = (bytes) => new Uint8Array(bytes);
var SESSION_KEY_BYTES = 32;
var GCM_NONCE_BYTES = 12;
function sealingLabel(namespace, name, scope = "strict") {
  const text = scope === "cluster-wide" ? "" : scope === "namespace-wide" ? namespace : `${namespace}/${name}`;
  return new TextEncoder().encode(text);
}

class SealingError extends Error {
  code;
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "SealingError";
  }
}
var MIN_SEALING_KEY_BITS = 2048;
var CLOCK_SKEW_MS = 5 * 60 * 1000;
var oaep = (label) => label.length > 0 ? { name: "RSA-OAEP", label: own(label) } : { name: "RSA-OAEP" };
async function hybridEncrypt(publicKey, plaintext, label) {
  const sessionKey = globalThis.crypto.getRandomValues(new Uint8Array(SESSION_KEY_BYTES));
  try {
    const aes = await subtle.importKey("raw", sessionKey, { name: "AES-GCM" }, false, ["encrypt"]);
    const rsaCiphertext = new Uint8Array(await subtle.encrypt(oaep(label), publicKey, sessionKey));
    if (rsaCiphertext.length > 65535)
      throw new SealingError("sealing_input_invalid");
    const copy = own(plaintext);
    const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(GCM_NONCE_BYTES) }, aes, copy).finally(() => copy.fill(0)));
    const out = new Uint8Array(2 + rsaCiphertext.length + sealed.length);
    out[0] = rsaCiphertext.length >> 8;
    out[1] = rsaCiphertext.length & 255;
    out.set(rsaCiphertext, 2);
    out.set(sealed, 2 + rsaCiphertext.length);
    return out;
  } finally {
    sessionKey.fill(0);
  }
}
function bytesToBase64(bytes) {
  let text = "";
  for (let i = 0;i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
var BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
function base64ToBytes(text) {
  if (!BASE64.test(text))
    return null;
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0;i < raw.length; i++)
    out[i] = raw.charCodeAt(i);
  return out;
}
var hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
function tlv(der, at, limit) {
  if (at + 2 > limit)
    throw new SealingError("sealing_cert_invalid");
  const tag = der[at];
  let length = der[at + 1], start = at + 2;
  if (length & 128) {
    const count = length & 127;
    if (count === 0 || count > 3 || start + count > limit)
      throw new SealingError("sealing_cert_invalid");
    length = 0;
    for (let i = 0;i < count; i++)
      length = length << 8 | der[start + i];
    start += count;
  }
  const end = start + length;
  if (end > limit)
    throw new SealingError("sealing_cert_invalid");
  return { tag, at, start, end, next: end };
}
function children(der, parent) {
  const out = [];
  for (let at = parent.start;at < parent.end; ) {
    const child = tlv(der, at, parent.end);
    out.push(child);
    at = child.next;
  }
  return out;
}
var SEQUENCE = 48;
var UTC_TIME = 23;
var GENERALIZED_TIME = 24;
function timeOf(der, node) {
  const text = new TextDecoder().decode(der.subarray(node.start, node.end));
  const m = node.tag === UTC_TIME ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text) : node.tag === GENERALIZED_TIME ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text) : null;
  if (!m)
    throw new SealingError("sealing_cert_invalid");
  let year = Number(m[1]);
  if (node.tag === UTC_TIME)
    year += year >= 50 ? 1900 : 2000;
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}
function certDerFromPem(pem) {
  const m = /^\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----\s*$/.exec(pem);
  const der = m ? base64ToBytes(m[1].replace(/\s+/g, "")) : null;
  if (der === null || der.length < 64)
    throw new SealingError("sealing_cert_invalid");
  return der;
}
function certParts(der) {
  const cert = tlv(der, 0, der.length);
  if (cert.tag !== SEQUENCE || cert.end !== der.length)
    throw new SealingError("sealing_cert_invalid");
  const tbs = children(der, cert)[0];
  if (!tbs || tbs.tag !== SEQUENCE)
    throw new SealingError("sealing_cert_invalid");
  const fields = children(der, tbs);
  const rest = fields[0]?.tag === 160 ? fields.slice(1) : fields;
  const validity = rest[3], spki = rest[5];
  if (!validity || validity.tag !== SEQUENCE || !spki || spki.tag !== SEQUENCE)
    throw new SealingError("sealing_cert_invalid");
  const [from, to] = children(der, validity);
  if (!from || !to)
    throw new SealingError("sealing_cert_invalid");
  return { spki: der.slice(spki.at, spki.end), notBefore: timeOf(der, from), notAfter: timeOf(der, to) };
}
async function inspectSealingCertPem(pem, now = Date.now()) {
  const der = certDerFromPem(pem);
  const { spki, notBefore, notAfter } = certParts(der);
  if (notBefore > now + CLOCK_SKEW_MS)
    throw new SealingError("sealing_cert_invalid");
  if (notAfter <= now)
    throw new SealingError("sealing_cert_expired");
  let key;
  try {
    key = await subtle.importKey("spki", own(spki), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  } catch {
    throw new SealingError("sealing_cert_not_rsa");
  }
  const bits = key.algorithm.modulusLength ?? 0;
  if (bits < MIN_SEALING_KEY_BITS)
    throw new SealingError("sealing_cert_weak");
  return { key, fingerprint: hex(new Uint8Array(await subtle.digest("SHA-256", own(der)))), bits };
}

var AGENT_APP_SECRET = "OPENROUTER_API_KEY";
function runtimeSecretRows(needed) {
  return [...new Set(needed)].filter((name) => isRuntimeSecretName(name) && name !== AGENT_APP_SECRET).sort();
}
function askedSecretNames(names, databaseMade, redisMade = false) {
  return (databaseMade ? withoutDatabaseEnvNames(names).filter((name) => !isExternalDatabaseEnvName(name)) : [...names]).filter((name) => !(redisMade && isRedisEnvName(name)));
}
function askedUnsetNames(unset, needed, databaseMade, redisMade) {
  const asked = new Set(needed);
  const names = [...new Set(unset.map((n) => n.name))].filter((name) => isRuntimeSecretName(name) && name !== AGENT_APP_SECRET && !asked.has(name));
  return (databaseMade ? withoutDatabaseEnvNames(names).filter((name) => !isExternalDatabaseEnvName(name)) : names).filter((name) => !(redisMade && isRedisEnvName(name)));
}
function heldWhy(entry) {
  if (entry.value === "")
    return "empty";
  if (new TextEncoder().encode(entry.value).length > RUNTIME_SECRET_VALUE_MAX)
    return "too_long";
  if (envValueHasReference(entry))
    return "reference";
  if (envValueIsLocal(entry.value))
    return "local";
  return null;
}
function planEnvImport({ entries, rows, sealed, usesOrg, settled, given, room }) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const plan = { fill: [], replaced: [], org: [], missing: [], held: [], given: [], others: [], othersOver: 0, unusable: 0 };
  for (const name of rows) {
    const entry = byName.get(name);
    if (entry === undefined) {
      if (!settled.has(name))
        plan.missing.push(name);
    } else if (usesOrg.has(name)) {
      plan.org.push(name);
    } else {
      const why = heldWhy(entry);
      if (why === null) {
        plan.fill.push({ name, value: entry.value });
        if (sealed.has(name))
          plan.replaced.push(name);
      } else if (!settled.has(name)) {
        plan.held.push({ name, why });
      }
    }
  }
  const shown = new Set(rows);
  const others = [];
  for (const entry of entries) {
    if (shown.has(entry.name))
      continue;
    if (given(entry.name) || DKOD_PROVIDED.has(entry.name))
      plan.given.push(entry.name);
    else if (!isRuntimeSecretName(entry.name))
      plan.unusable += 1;
    else if (heldWhy(entry) === null)
      others.push({ name: entry.name, value: entry.value });
  }
  const fits = Math.max(0, room);
  plan.others = others.slice(0, fits);
  plan.othersOver = others.length - plan.others.length;
  return plan;
}
async function sealAppSecrets(cert, target, values) {
  const inspected = await inspectSealingCertPem(cert.pem);
  if (inspected.fingerprint !== cert.fingerprint)
    throw new Error("cert_mismatch");
  const secrets = [];
  for (const { name, value } of values) {
    const plain = new TextEncoder().encode(value);
    try {
      const sealed = {};
      for (const ns of target.namespaces)
        sealed[ns] = bytesToBase64(await hybridEncrypt(inspected.key, plain, sealingLabel(ns, target.secretName)));
      secrets.push({ name, sealed });
    } finally {
      plain.fill(0);
    }
  }
  return { certFingerprint: inspected.fingerprint, secrets };
}
function envFillRows(view) {
  const { managedDatabase: db, managedRedis: redis } = view.target;
  const read = runtimeSecretRows(view.needed);
  const unset = askedUnsetNames(view.unset.map((name) => ({ name })), read, db, redis);
  return [...new Set([...askedSecretNames(read, db, redis), ...unset, ...view.sealed])];
}
function planEnvFill(view, entries) {
  const { managedDatabase: db, managedRedis: redis } = view.target;
  const rows = envFillRows(view);
  const sealed = new Set(view.sealed);
  const usesOrg = new Set(view.usesOrg);
  return planEnvImport({
    entries,
    rows,
    sealed,
    usesOrg,
    settled: new Set([...sealed, ...usesOrg, ...view.skipped]),
    given: (name) => db && isDatabaseEnvName(name) || redis && isRedisEnvName(name) || name === AGENT_APP_SECRET,
    room: APP_SECRETS_MAX - rows.length
  });
}
function envFillReport(plan, othersAdded) {
  return {
    filled: plan.fill.map((f) => f.name),
    replaced: [...plan.replaced],
    missing: [...plan.missing],
    notFilled: plan.held.map((h) => ({ name: h.name, why: h.why })),
    usesOrgSecret: [...plan.org],
    givenByDkod: [...plan.given],
    otherNames: plan.others.map((o) => o.name),
    otherNamesAdded: othersAdded && plan.others.length > 0,
    otherNamesOverLimit: plan.othersOver,
    unusableNames: plan.unusable
  };
}

var ENV_SECRETS_TOOL = "secrets_from_env";
var ENV_SECRETS_TOOL_FULL = `mcp__dkod__${ENV_SECRETS_TOOL}`;
var record = (v) => typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
var names = (v) => Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
function viewFrom(body) {
  const b = record(body), cert = record(b?.cert), target = record(b?.target);
  const namespaces = names(target?.namespaces), needed = names(b?.needed), unset = names(b?.unset), sealed = names(b?.sealed), usesOrg = names(b?.usesOrg), skipped = names(b?.skipped);
  if (!cert || !target || typeof cert.pem !== "string" || typeof cert.fingerprint !== "string" || typeof target.secretName !== "string")
    return null;
  if (!namespaces || namespaces.length === 0 || !needed || !unset || !sealed || !usesOrg || !skipped)
    return null;
  return {
    cert: { pem: cert.pem, fingerprint: cert.fingerprint },
    target: { secretName: target.secretName, namespaces, managedDatabase: target.managedDatabase === true, managedRedis: target.managedRedis === true },
    needed,
    unset,
    sealed,
    usesOrg,
    skipped
  };
}

var SKIP = new Set(["node_modules", ".git", ".venv", "venv", "dist", "build", ".next", ".turbo", ".dkod", "coverage", "test-results", "playwright-report", "__pycache__", ".cache"]);

var MAX_MESSAGE_BYTES = 16 << 20;
var MAX_HANDSHAKE_BYTES = 16 << 10;

var MAX_FILE_BYTES = 5 * 1024 ** 3;
var HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "authorization", "content-length"]);
var PART_BYTES = 8 << 20;

var WAIT_LIMIT_MS = 10 * 60000;
var GATEWAY_LOAD_BUDGET_MS = 2 * 60000;
var PENDING_CAP = 1 << 20;
var RENEW_BEFORE_MS = 5 * 60000;
var USAGE = [
  "Usage:",
  "  node dkod-db.mjs up --app <app key> [--org <org_id>] [--port 6543] [--files-port <port + 1>] [--dir <app folder>] [--wait <seconds>] [--detach]",
  "  node dkod-db.mjs files --from <folder> [--prefix media/] [--dir <app folder>] [--jobs 32]   (while `up` runs)",
  "  node dkod-db.mjs down [--dir <app folder>] [--all]",
  "  node dkod-db.mjs migrate [--dir <app folder>] [--port 6543]",
  "  node dkod-db.mjs import --app <app key> --from <local postgres URL | snapshot> [--dir <app folder>] [--port 6543]",
  "  node dkod-db.mjs detect [--dir <app folder>]"
].join(`
`);
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
  const candidates = [configPath, env.CLAUDE_PLUGIN_ROOT && `${env.CLAUDE_PLUGIN_ROOT}/dkoder.json`, env.CURSOR_PLUGIN_ROOT && `${env.CURSOR_PLUGIN_ROOT}/dkoder.json`, pluginRoot && `${pluginRoot}/dkoder.json`];
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
  return devicePath ? readDeviceFile(devicePath, readFile) : null;
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
var CODE_GONE = "The connect code was refused: it works once, for 60 seconds. Call dkoder.devdb.connect again and run this at once with the new code.";
async function connectWithCode(code, dashboardUrl, io) {
  if (!/^dkodc_[a-z0-9]{16,64}_[A-Za-z0-9_-]{20,}$/.test(code))
    return "--code takes the code dkoder.devdb.connect gave (it starts with dkodc_).";
  let res;
  try {
    res = await io.fetch(`${dashboardUrl}/api/v1/dkoder/connect/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  } catch {
    return "Could not reach the dashboard. Check the network, then call dkoder.devdb.connect again.";
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
  } catch {
    throw new TokenError("unavailable", "Could not reach the dashboard. Check the network and try again.");
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

var refuse = (error, message) => ({ ok: false, error, message });
var nodeFetchText = async (url) => {
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};
function certUrl(inner) {
  const cert = typeof inner === "object" && inner !== null ? inner.cert : undefined;
  const url = typeof cert === "object" && cert !== null ? cert.url : undefined;
  if (typeof url !== "string")
    return null;
  try {
    const u = new URL(url);
    const loopback = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
    if (u.protocol !== "https:" && !loopback || !u.pathname.startsWith("/api/v1/dkoder/sealing-cert/"))
      return null;
    return u.toString();
  } catch {
    return null;
  }
}
async function withFetchedPem(inner, url, fetchText) {
  const pem = await fetchText(url);
  if (pem === null || !pem.includes("BEGIN CERTIFICATE"))
    return null;
  const b = inner;
  return { ...b, cert: { ...b.cert, pem } };
}
var CERT_UNREACHABLE = "The sealing certificate could not be read from cert.url in the target file. Call dkoder.secrets.target again, write its answer to the file again, and retry.";
async function sealFromEnv(envText, targetText, addOthers, fetchText = nodeFetchText) {
  const parsed = parseEnvFile(envText);
  if (!parsed.ok) {
    if (parsed.problem === "too_large")
      return refuse("file_too_large", "The .env file is larger than 256 KB.");
    if (parsed.problem === "nul_byte")
      return refuse("not_text", "The .env file is not a text file.");
    return refuse("open_quote", parsed.line === undefined ? "A line of the .env file opens a quote that does not close." : `Line ${parsed.line} of the .env file opens a quote that does not close.`);
  }
  if (parsed.entries.length === 0)
    return refuse("nothing_found", "No NAME=value line was found in the .env file.");
  let target;
  try {
    target = JSON.parse(targetText);
  } catch {
    return refuse("target_unreadable", "The target file is not the JSON answer of dkoder.secrets.target.");
  }
  let inner = typeof target === "object" && target !== null && "structuredContent" in target ? target.structuredContent : target;
  const url = certUrl(inner);
  const pemOf = (x) => x?.cert?.pem;
  if (url !== null && typeof pemOf(inner) !== "string") {
    const fetched = await withFetchedPem(inner, url, fetchText);
    if (fetched === null)
      return refuse("cert_unreachable", CERT_UNREACHABLE);
    inner = fetched;
  }
  let view = viewFrom(inner);
  if (view === null)
    return refuse("target_unreadable", "The target file is not the JSON answer of dkoder.secrets.target.");
  const plan = planEnvFill(view, parsed.entries);
  const values = [...plan.fill, ...addOthers ? plan.others : []];
  const report = envFillReport(plan, addOthers);
  if (values.length === 0)
    return { ok: true, save: null, next: "No name was filled, so there is nothing to save.", ...report };
  const next = "Run this again with --send --session <sessionId> --app <appKey>: it saves the sealed text itself. Never copy save into dkoder.secrets.save by hand. Then deploy the app again.";
  try {
    return { ok: true, save: await sealAppSecrets(view.cert, view.target, values), next, ...report };
  } catch {
    if (url !== null) {
      const fetched = await withFetchedPem(inner, url, fetchText);
      view = fetched === null ? null : viewFrom(fetched);
      if (view === null)
        return refuse("cert_unreachable", CERT_UNREACHABLE);
      try {
        return { ok: true, save: await sealAppSecrets(view.cert, view.target, values), next, ...report };
      } catch {}
    }
    return refuse("seal_failed", "The certificate in the target file does not match cert.fingerprint, so nothing was sealed. It was most likely changed when the file was written. Call dkoder.secrets.target again and write its answer to the file again, leaving out cert.pem: this script gets it from cert.url.");
  }
}
var USAGE2 = "Usage: node dkod-secrets.mjs seal <.env file> <target file> [--others] [--send --session <sessionId> --app <appKey> [--org <org_id>] [--code <code> --dashboard <url>]]";
var APP_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;
var SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
function toolAnswer(text) {
  const line = text.trimStart().startsWith("{") ? text : text.split(`
`).find((l) => l.startsWith("data:"))?.slice(5) ?? "";
  try {
    const rpc = JSON.parse(line);
    if (!rpc.result)
      return { isError: true, body: { error: "rpc_error", message: typeof rpc.error?.message === "string" ? rpc.error.message : "DKOD refused the call." } };
    const r = rpc.result;
    let body = r.structuredContent;
    if (typeof body !== "object" || body === null) {
      const t = r.content?.[0]?.text;
      try {
        body = typeof t === "string" ? JSON.parse(t) : null;
      } catch {
        body = { message: typeof t === "string" ? t : "" };
      }
    }
    return { isError: r.isError === true, body: typeof body === "object" && body !== null ? body : {} };
  } catch {
    return null;
  }
}
async function sendSealed(save, sessionId, appKey, flags, io) {
  const dbIo = io;
  let creds = null;
  if (flags.code !== undefined) {
    const dashboardUrl = dashboardFor(flags.dashboard, io);
    if (dashboardUrl === null)
      return { ok: false, error: "bad_dashboard", message: "--dashboard takes the dashboard_url dkoder.devdb.connect gave (https)." };
    const got = await connectWithCode(flags.code, dashboardUrl, dbIo);
    if (typeof got === "string")
      return { ok: false, error: "no_device", message: got };
    creds = got;
  } else {
    const devicePath = io.devicePath?.();
    const own = flags.org && devicePath ? readDeviceFile(orgDevicePath(devicePath, flags.org), io.readFile) : null;
    creds = own ?? resolveCredentials(io.env, undefined, io.readFile, io.pluginRoot, devicePath);
  }
  if (creds === null)
    return { ok: false, error: "no_device", message: NO_DEVICE };
  if (flags.org && creds.org && creds.org !== flags.org)
    return { ok: false, error: "no_device", message: wrongOrg(creds.org, flags.org) };
  try {
    creds = await freshCredentials(creds, dbIo);
  } catch (error) {
    return { ok: false, error: "no_device", message: error instanceof TokenError ? error.message : NO_DEVICE };
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "dkoder.secrets.save", arguments: { sessionId, appKey, certFingerprint: save.certFingerprint, secrets: save.secrets } }
  });
  let res;
  try {
    res = await io.fetch(`${creds.dashboardUrl}/api/v1/dkoder/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body
    });
  } catch {
    return { ok: false, error: "unreachable", message: "Could not reach the dashboard. Check the network and run this again." };
  }
  if (res.status === 401)
    return { ok: false, error: "no_device", message: `DKOD did not accept this computer's helper token. ${NO_DEVICE}` };
  if (res.status === 404)
    return { ok: false, error: "no_device", message: `DKOD did not find this session for this computer's helper login, which can be another DKOD organization's. Call the DKOD tool dkoder.devdb.connect in this session, then run this same command again at once with --code <code> --dashboard <dashboard_url> from its answer.` };
  const answer = res.status === 200 ? toolAnswer(await res.text()) : null;
  if (answer === null)
    return { ok: false, error: "unavailable", message: "DKOD could not save the secrets right now. Run this again in a minute." };
  const b = answer.body;
  if (answer.isError)
    return { ok: false, error: typeof b.error === "string" ? b.error : "refused", message: typeof b.message === "string" ? b.message : "DKOD refused the save." };
  const names = (v) => Array.isArray(v) ? v.filter((n) => typeof n === "string") : [];
  return { ok: true, saved: names(b.saved), has: names(b.has) };
}
var VALUE_FLAGS = new Set(["--session", "--app", "--code", "--dashboard", "--org"]);
async function runSecretsCli(argv, io) {
  const [command, envFile, targetFile, ...rest] = argv;
  const flags = new Set;
  const values = new Map;
  let bad = false;
  for (let i = 0;i < rest.length; i++) {
    const f = rest[i];
    if (VALUE_FLAGS.has(f)) {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--"))
        bad = true;
      else
        values.set(f, v);
      i++;
    } else if (f === "--others" || f === "--send")
      flags.add(f);
    else
      bad = true;
  }
  const send = flags.has("--send");
  const session = values.get("--session"), app = values.get("--app");
  if (send && (!session || !SESSION_ID.test(session) || !app || !APP_KEY.test(app) || !io.send))
    bad = true;
  if (!send && values.size > 0)
    bad = true;
  if (command !== "seal" || !envFile || !targetFile || bad) {
    io.print(JSON.stringify(refuse("usage", USAGE2)));
    return 2;
  }
  let envText, targetText;
  try {
    envText = io.read(envFile);
  } catch {
    io.print(JSON.stringify(refuse("file_unreadable", "The .env file could not be read. Check the path.")));
    return 1;
  }
  try {
    targetText = io.read(targetFile);
  } catch {
    io.print(JSON.stringify(refuse("target_unreadable", "The target file could not be read. Check the path.")));
    return 1;
  }
  let result;
  try {
    result = await sealFromEnv(envText, targetText, flags.has("--others"));
  } catch {
    result = refuse("failed", "The secrets could not be sealed.");
  }
  envText = "";
  if (!send || !result.ok) {
    io.print(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
  const { save, next: _next, ...report } = result;
  if (save === null) {
    io.print(JSON.stringify({ ...report, sent: false, next: "No name was filled, so nothing was saved." }));
    return 0;
  }
  const org = values.get("--org");
  if (org !== undefined && !ORG_ID.test(org)) {
    io.print(JSON.stringify({ ...report, sent: false, error: "usage", message: "--org takes the org_id that dkoder.devdb.status gave." }));
    return 2;
  }
  const sent = await sendSealed(save, session, app, { code: values.get("--code"), dashboard: values.get("--dashboard"), org }, io.send);
  if (!sent.ok) {
    io.print(JSON.stringify({ ...report, ok: false, sent: false, error: sent.error, message: sent.message }));
    return 1;
  }
  io.print(JSON.stringify({ ...report, sent: true, saved: sent.saved, has: sent.has, next: "Saved in DKOD. Deploy the app again so the values apply." }));
  return 0;
}

function devicePath() {
  const dir = join(homedir(), ".dkod", "db");
  mkdirSync(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
  return join(dir, "device.json");
}
process.exitCode = await runSecretsCli(process.argv.slice(2), {
  read: (path) => readFileSync(path, "utf8"),
  print: (line) => process.stdout.write(`${line}
`),
  send: {
    env: process.env,
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (path, text) => writeFileSync(path, text, "utf8"),
    writePrivate: (path, text) => {
      writeFileSync(path, text, { encoding: "utf8", mode: 384 });
      chmodSync(path, 384);
    },
    devicePath,
    pluginRoot: resolve(dirname(process.argv[1] ?? "."), "..", "..", ".."),
    fetch: async (url, init) => await fetch(url, { ...init, redirect: "error" }),
    now: () => Date.now()
  }
});
