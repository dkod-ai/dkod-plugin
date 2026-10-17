// Built by packages/dkoder-plugin/scripts/build-secrets.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:secrets`.
import { readFileSync } from "node:fs";

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
  return hasHost(text, "localhost") || hasHost(text, "host.docker.internal") || hasHost(text, "127.0.0.1") || text.includes("[::1]") || text.trim() === "::1";
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
    if (given(entry.name))
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

var refuse = (error, message) => ({ ok: false, error, message });
async function sealFromEnv(envText, targetText, addOthers) {
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
  const inner = typeof target === "object" && target !== null && "structuredContent" in target ? target.structuredContent : target;
  const view = viewFrom(inner);
  if (view === null)
    return refuse("target_unreadable", "The target file is not the JSON answer of dkoder.secrets.target.");
  const plan = planEnvFill(view, parsed.entries);
  const values = [...plan.fill, ...addOthers ? plan.others : []];
  const report = envFillReport(plan, addOthers);
  if (values.length === 0)
    return { ok: true, save: null, next: "No name was filled, so there is nothing to save.", ...report };
  try {
    const save = await sealAppSecrets(view.cert, view.target, values);
    return { ok: true, save, next: "Send save to dkoder.secrets.save as it is: certFingerprint and secrets, with the sessionId and appKey. Then deploy the app again.", ...report };
  } catch {
    return refuse("seal_failed", "The values could not be sealed on this computer. The apps cluster's sealing certificate did not check out. Call dkoder.secrets.target again and retry.");
  }
}
var USAGE = "Usage: node dkod-secrets.mjs seal <.env file> <target file> [--others]";
async function runSecretsCli(argv, io) {
  const [command, envFile, targetFile, ...rest] = argv;
  const flags = new Set(rest);
  if (command !== "seal" || !envFile || !targetFile || [...flags].some((f) => f !== "--others")) {
    io.print(JSON.stringify(refuse("usage", USAGE)));
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
  io.print(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

process.exitCode = await runSecretsCli(process.argv.slice(2), {
  read: (path) => readFileSync(path, "utf8"),
  print: (line) => process.stdout.write(`${line}
`)
});
