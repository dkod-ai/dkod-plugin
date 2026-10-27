// Built by packages/dkoder-plugin/scripts/build-claude.ts from dkod-app. Do not edit: run `bun run --cwd packages/dkoder-plugin build:claude`.
var MAX_DEPTH = 4;
var MAX_LINE = 64 * 1024;
var OPERATORS = ["&&", "||", ";;", "|&", ";", "|", "&", "(", ")", `
`];
function tokenize(line, subs) {
  const out = [];
  let word = "";
  let inWord = false;
  const flush = () => {
    if (inWord)
      out.push({ kind: "word", text: word });
    word = "";
    inWord = false;
  };
  let i = 0;
  const n = Math.min(line.length, MAX_LINE);
  const readParen = (start) => {
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      const c = line[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "'") {
        const end = line.indexOf("'", j + 1);
        j = end < 0 ? n : end + 1;
        continue;
      }
      if (c === '"') {
        j += 1;
        while (j < n && line[j] !== '"')
          j += line[j] === "\\" ? 2 : 1;
        j += 1;
        continue;
      }
      if (c === "(")
        depth += 1;
      else if (c === ")")
        depth -= 1;
      j += 1;
    }
    return j;
  };
  const readBacktick = (start) => {
    let j = start;
    while (j < n && line[j] !== "`")
      j += line[j] === "\\" ? 2 : 1;
    return j;
  };
  while (i < n) {
    const c = line[i];
    if (c === "\\") {
      if (line[i + 1] === `
`) {
        i += 2;
        continue;
      }
      word += line[i + 1] ?? "";
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      const stop = end < 0 ? n : end;
      word += line.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === "$" && line[i + 1] === "'") {
      let j = i + 2;
      while (j < n && line[j] !== "'") {
        if (line[j] === "\\" && j + 1 < n) {
          const e = line[j + 1];
          word += e === "n" ? `
` : e === "t" ? "\t" : e;
          j += 2;
        } else {
          word += line[j];
          j += 1;
        }
      }
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && line[j] !== '"') {
        const d = line[j];
        if (d === "\\" && j + 1 < n && '"\\$`\n'.includes(line[j + 1])) {
          if (line[j + 1] !== `
`)
            word += line[j + 1];
          j += 2;
          continue;
        }
        if (d === "$" && line[j + 1] === "(") {
          const end = readParen(j + 2);
          subs.push(line.slice(j + 2, end - 1));
          word += line.slice(j, end);
          j = end;
          continue;
        }
        if (d === "`") {
          const end = readBacktick(j + 1);
          subs.push(line.slice(j + 1, end));
          word += line.slice(j, end + 1);
          j = end + 1;
          continue;
        }
        word += d;
        j += 1;
      }
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === "$" && line[i + 1] === "(") {
      const end = readParen(i + 2);
      subs.push(line.slice(i + 2, end - 1));
      word += line.slice(i, end);
      inWord = true;
      i = end;
      continue;
    }
    if (c === "`") {
      const end = readBacktick(i + 1);
      subs.push(line.slice(i + 1, end));
      word += line.slice(i, end + 1);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === "#" && !inWord) {
      const end = line.indexOf(`
`, i);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      flush();
      i += 1;
      continue;
    }
    const op = OPERATORS.find((o) => line.startsWith(o, i));
    if (op !== undefined) {
      flush();
      out.push({ kind: "op", text: op });
      i += op.length;
      continue;
    }
    if (c === ">" || c === "<") {
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      }
      flush();
      if (line.startsWith("<<", i) && line[i + 2] !== "<") {
        const m = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([A-Za-z0-9_.-]+))/.exec(line.slice(i, i + 200));
        if (m) {
          const delim = m[2] ?? m[3] ?? m[4] ?? "";
          const nl = line.indexOf(`
`, i);
          let bodyEnd = n;
          if (nl >= 0) {
            let k = nl + 1;
            while (k < n) {
              const e = line.indexOf(`
`, k);
              const stop = e < 0 ? n : e;
              const text = m[1] === "-" ? line.slice(k, stop).replace(/^\t+/, "") : line.slice(k, stop);
              if (text === delim) {
                bodyEnd = stop;
                break;
              }
              k = stop + 1;
            }
            const rest = line.slice(i + m[0].length, nl);
            out.push(...tokenize(rest, subs));
            out.push({ kind: "op", text: `
` });
          }
          i = bodyEnd;
          continue;
        }
      }
      let j = i;
      while (j < n && (line[j] === ">" || line[j] === "<" || line[j] === "&" || line[j] === "|" || line[j] === "-"))
        j += 1;
      const op = line.slice(i, j);
      out.push({ kind: "op", text: "redirect", write: op.includes(">") && !op.endsWith("&") });
      i = j;
      continue;
    }
    word += c;
    inWord = true;
    i += 1;
  }
  flush();
  return out;
}
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
function programName(word) {
  const slash = word.lastIndexOf("/");
  return slash < 0 ? word : word.slice(slash + 1);
}
function joinCd(current, target) {
  if (target.startsWith("/") || target.startsWith("~"))
    return target;
  if (current === "" || current === ".")
    return target;
  return `${current.replace(/\/$/, "")}/${target}`;
}
var KEYWORDS = new Set(["!", "if", "elif", "then", "else", "while", "until", "do", "time", "coproc"]);
var SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
function unwrap(argv, env) {
  let a = argv;
  for (let guard = 0;guard < 8 && a.length > 0; guard += 1) {
    const prog = programName(a[0]);
    if (prog === "env") {
      let i = 1;
      while (i < a.length && (a[i].startsWith("-") || ASSIGNMENT.test(a[i]))) {
        if (ASSIGNMENT.test(a[i]))
          env = [...env, a[i]];
        if (a[i] === "-u" || a[i] === "-C" || a[i] === "-S")
          i += 1;
        i += 1;
      }
      a = a.slice(i);
      continue;
    }
    if (prog === "command" || prog === "builtin" || prog === "exec" || prog === "nohup" || prog === "time" || prog === "nice") {
      let i = 1;
      while (i < a.length && a[i].startsWith("-"))
        i += a[i] === "-n" && prog === "nice" ? 2 : 1;
      a = a.slice(i);
      continue;
    }
    if (prog === "sudo" || prog === "doas") {
      let i = 1;
      while (i < a.length && a[i].startsWith("-"))
        i += ["-u", "-g", "-C", "-D", "-h", "-p", "-U"].includes(a[i]) ? 2 : 1;
      a = a.slice(i);
      continue;
    }
    if (prog === "timeout") {
      let i = 1;
      while (i < a.length && a[i].startsWith("-"))
        i += a[i] === "-s" || a[i] === "-k" ? 2 : 1;
      a = a.slice(i + 1);
      continue;
    }
    if (prog === "xargs") {
      let i = 1;
      while (i < a.length && a[i].startsWith("-"))
        i += ["-I", "-n", "-P", "-L", "-s", "-d", "-E"].includes(a[i]) ? 2 : 1;
      a = a.slice(i);
      continue;
    }
    if (SHELLS.has(prog)) {
      const c = a.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w));
      if (c > 0 && a[c + 1] !== undefined)
        return { argv: a, env, script: a[c + 1] };
      return { argv: a, env, script: null };
    }
    if (prog === "eval")
      return { argv: a, env, script: a.slice(1).join(" ") };
    break;
  }
  return { argv: a, env, script: null };
}
function parseCommands(line, depth = 0) {
  if (depth > MAX_DEPTH)
    return [];
  const subs = [];
  const tokens = tokenize(line, subs);
  const out = [];
  let cd = "";
  let words = [];
  let skipNext = false;
  let writeNext = false;
  let writes = [];
  const end = () => {
    const targets = writes;
    writes = [];
    if (words.length === 0)
      return;
    let i = 0;
    const env = [];
    while (i < words.length && ASSIGNMENT.test(words[i]))
      env.push(words[i++]);
    const raw = words.slice(i);
    words = [];
    if (raw.length === 0)
      return;
    const { argv, env: allEnv, script } = unwrap(raw, env);
    if (argv.length === 0)
      return;
    if (programName(argv[0]) === "cd" || programName(argv[0]) === "pushd") {
      const target = argv.slice(1).find((w) => !w.startsWith("-"));
      cd = target === undefined ? "~" : joinCd(cd, target);
      return;
    }
    out.push(targets.length > 0 ? { argv, env: allEnv, cd, writes: targets } : { argv, env: allEnv, cd });
    if (script !== null) {
      for (const inner of parseCommands(script, depth + 1))
        out.push({ ...inner, cd: inner.cd === "" ? cd : joinCd(cd, inner.cd) });
    }
  };
  for (const t of tokens) {
    if (t.kind === "op") {
      if (t.text === "redirect") {
        skipNext = true;
        writeNext = t.write === true;
        continue;
      }
      end();
      continue;
    }
    if (skipNext) {
      skipNext = false;
      if (writeNext)
        writes.push(t.text);
      continue;
    }
    if (t.text === "{" || t.text === "}") {
      end();
      continue;
    }
    if (words.length === 0 && KEYWORDS.has(t.text))
      continue;
    words.push(t.text);
  }
  end();
  for (const body of subs)
    for (const inner of parseCommands(body, depth + 1))
      out.push(inner);
  return out;
}

function literalMessage(word) {
  if (!/[`$]/.test(word))
    return word;
  const t = word.trim();
  const open = /^\$\(cat[ \t]*<<-?[ \t]*(?:'(\w+)'|"(\w+)"|(\w+))[ \t]*\n/.exec(t);
  if (open !== null && t.endsWith(")")) {
    const delim = open[1] ?? open[2] ?? open[3];
    const lines = t.slice(open[0].length, -1).split(`
`);
    const end = lines.findIndex((l) => l.trim() === delim);
    if (end >= 0 && lines.slice(end + 1).every((l) => l.trim() === "")) {
      const body = lines.slice(0, end).join(`
`);
      return open[3] !== undefined && /[`$]/.test(body) ? null : body.replace(/\n+$/, "");
    }
    return null;
  }
  const printf = /^\$\(printf[ \t]+'%s\\n'((?:[ \t]+'[^']*')+)[ \t]*\)$/.exec(t);
  if (printf !== null)
    return [...printf[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join(`
`).replace(/\n+$/, "");
  return null;
}
var join = (a, b) => b === "" ? a : a === "" ? b : b.startsWith("/") || b.startsWith("~") ? b : `${a.replace(/\/$/, "")}/${b}`;
var GIT_GLOBAL_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env", "--super-prefix", "--list-cmds", "--attr-source"]);
var GIT_GLOBAL_HARMLESS = new Set(["-C", "-P", "--no-pager", "--paginate", "-p", "--no-optional-locks", "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs", "--no-replace-objects", "--no-lazy-fetch", "--no-advice", "--bare"]);
var PUSH_VALUE = new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo", "--signed"]);
var COMMIT_VALUE = new Set(["-m", "--message", "-F", "--file", "-C", "--reuse-message", "-c", "--reedit-message", "--author", "--date", "-t", "--template", "--fixup", "--squash", "--cleanup", "--trailer", "--pathspec-from-file"]);
var GIT_BUILTINS = new Set("add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore checkout cherry cherry-pick citool clean clone column commit commit-graph commit-tree config count-objects credential describe diff diff-files diff-index diff-tree difftool fetch for-each-ref format-patch fsck gc grep hash-object help init interpret-trailers log ls-files ls-remote ls-tree maintenance merge merge-base merge-file merge-tree mergetool mktag mktree mv name-rev notes pack-objects prune pull push range-diff read-tree rebase reflog remote repack replace request-pull rerere reset restore rev-list rev-parse revert rm send-pack shortlog show show-branch show-ref sparse-checkout stash status submodule switch symbolic-ref tag update-index update-ref var verify-commit verify-pack verify-tag version whatchanged worktree write-tree lfs".split(" "));
var GH_GROUPS = new Set("alias api attestation auth browse cache co codespace completion config copilot extension gist gpg-key help issue label org pr preview project release repo ruleset run search secret ssh-key status variable workflow".split(" "));
var HOOKS_PATH = /hookspath/i;
var HARMLESS_GIT_ENV = /^GIT_(SSH_COMMAND|SSH|TERMINAL_PROMPT|ASKPASS|PAGER|EDITOR|SEQUENCE_EDITOR|TRACE[A-Z_]*|AUTHOR_[A-Z]+|COMMITTER_[A-Z]+|PROGRESS_DELAY|REDACT_COOKIES|CURL_VERBOSE|HTTP_LOW_SPEED_[A-Z]+|OPTIONAL_LOCKS|FLUSH)=/;
var RISKY_ALIAS = /(^|\s)(push|send-pack|merge|api)(\s|$)|^!/;
function pushAction(cmd, dir, rest, opaque, out) {
  let force = false;
  let remote = null;
  let sawRemote = false;
  for (let j = 0;j < rest.length; j += 1) {
    const w = rest[j];
    if (w === "--")
      continue;
    if (w.startsWith("--repo=")) {
      remote = w.slice("--repo=".length);
      sawRemote = true;
      continue;
    }
    if (w === "--repo") {
      remote = rest[j + 1] ?? null;
      sawRemote = true;
      j += 1;
      continue;
    }
    if (w === "--no-verify") {
      out.push({ kind: "hook-bypass", cmd, dir, how: "git push --no-verify" });
      continue;
    }
    if (w === "--force" || w.startsWith("--force-with-lease") || w === "--force-if-includes" || w === "--mirror" || w === "--delete") {
      force = true;
      continue;
    }
    if (w.startsWith("--receive-pack") || w.startsWith("--exec"))
      opaque = opaque ?? "a custom receive-pack";
    if (/^-[A-Za-z]+$/.test(w)) {
      if (w.includes("f") || w.includes("d"))
        force = true;
      if (PUSH_VALUE.has(w))
        j += 1;
      continue;
    }
    if (w.startsWith("-")) {
      if (PUSH_VALUE.has(w))
        j += 1;
      continue;
    }
    if (!sawRemote) {
      remote = w;
      sawRemote = true;
      continue;
    }
    if (w.startsWith("+") || w.startsWith(":"))
      force = true;
  }
  out.push({ kind: "push", cmd, dir, remote, force, opaque });
}
var remoteKey = (dir, name) => `${dir.replace(/^\.\/?/, "").replace(/\/+$/, "")}\x00${name}`;
var CLONE_VALUE = new Set(["-b", "--branch", "-o", "--origin", "--depth", "-c", "--config", "--reference", "--reference-if-able", "--template", "-u", "--upload-pack", "--separate-git-dir", "--filter", "-j", "--jobs", "--shallow-since", "--shallow-exclude", "--bundle-uri"]);
function gitActions(cmd, depth, made = new Map) {
  const out = [];
  let dir = cmd.cd;
  const direct = programName(cmd.argv[0] ?? "").slice("git-".length);
  const a = direct === "" ? cmd.argv : ["git", direct, ...cmd.argv.slice(1)];
  let opaque = null;
  for (const e of cmd.env) {
    if (/^GIT_CONFIG/.test(e) && HOOKS_PATH.test(e))
      out.push({ kind: "hook-bypass", cmd, dir, how: "a hooks path set in the environment" });
    if (/^GIT_/.test(e) && !HARMLESS_GIT_ENV.test(e))
      opaque = opaque ?? `${e.split("=")[0]} in the environment`;
  }
  const local = new Map;
  const prefix = ["git"];
  let i = 1;
  while (i < a.length && a[i].startsWith("-")) {
    const opt = a[i];
    const eq = opt.indexOf("=");
    const name = eq < 0 ? opt : opt.slice(0, eq);
    const value = eq < 0 ? a[i + 1] : opt.slice(eq + 1);
    const width = GIT_GLOBAL_VALUE.has(name) && eq < 0 ? 2 : 1;
    if (name === "-C" && value !== undefined)
      dir = join(dir, value);
    else
      prefix.push(...a.slice(i, i + width));
    if ((name === "-c" || name === "--config-env") && value !== undefined) {
      if (HOOKS_PATH.test(value))
        out.push({ kind: "hook-bypass", cmd, dir, how: "git -c core.hooksPath" });
      const alias = /^alias\.([^=]+)=(.*)$/s.exec(value);
      if (alias)
        local.set(alias[1].toLowerCase(), alias[2]);
    }
    if (!GIT_GLOBAL_HARMLESS.has(name))
      opaque = opaque ?? `git ${name}`;
    i += width;
  }
  const sub = a[i];
  const rest = a.slice(i + 1);
  if (sub === undefined)
    return out;
  const inline = local.get(sub.toLowerCase());
  if (inline !== undefined && !GIT_BUILTINS.has(sub)) {
    out.push(...expandAlias("git", inline, prefix, rest, { ...cmd, cd: dir }, depth));
    return out;
  }
  if (sub === "clone") {
    let origin = "origin";
    const pos = [];
    for (let j = 0;j < rest.length; j += 1) {
      const w = rest[j];
      const eq = w.indexOf("=");
      if (w === "-o" || w === "--origin")
        origin = rest[j + 1] ?? origin;
      else if (w.startsWith("--origin="))
        origin = w.slice(eq + 1);
      if (w.startsWith("-")) {
        if (eq < 0 && CLONE_VALUE.has(w))
          j += 1;
        continue;
      }
      pos.push(w);
    }
    const [url, target] = pos;
    if (url !== undefined) {
      const base = target ?? url.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "";
      if (base !== "")
        made.set(remoteKey(join(dir, base), origin), url);
    }
    if (made.size === 0)
      made.set("", "");
    return out;
  }
  if (sub === "remote" && (rest[0] === "add" || rest[0] === "set-url")) {
    const pos = rest.slice(1).filter((w) => !w.startsWith("-"));
    made.set(remoteKey(dir, pos[0] ?? ""), pos[pos.length - 1] ?? "");
    return out;
  }
  if (sub === "push") {
    pushAction(cmd, dir, rest, opaque, out);
    const p = out[out.length - 1];
    if (p.kind === "push" && made.size > 0) {
      p.lineRemote = true;
      const url = made.get(remoteKey(dir, p.remote ?? "origin"));
      if (url !== undefined)
        p.also = [url];
    }
    return out;
  }
  if (sub === "send-pack") {
    const remote = rest.find((w) => !w.startsWith("-")) ?? null;
    out.push({ kind: "push", cmd, dir, remote, force: rest.includes("--force"), opaque });
    return out;
  }
  if (sub === "commit") {
    let all = false;
    const paragraphs = [];
    let elsewhere = false;
    for (let j = 0;j < rest.length; j += 1) {
      const w = rest[j];
      if (w === "--no-verify") {
        out.push({ kind: "hook-bypass", cmd, dir, how: "git commit --no-verify" });
        continue;
      }
      if (w === "--all" || w === "--include" || w === "--only") {
        all = true;
        continue;
      }
      if (w === "--") {
        if (j + 1 < rest.length)
          all = true;
        break;
      }
      if (/^-[A-Za-z]+$/.test(w)) {
        for (let k = 1;k < w.length; k += 1) {
          const ch = w[k];
          if (ch === "n")
            out.push({ kind: "hook-bypass", cmd, dir, how: "git commit -n" });
          if (ch === "a" || ch === "i" || ch === "o")
            all = true;
          if (COMMIT_VALUE.has(`-${ch}`)) {
            const value = k === w.length - 1 ? rest[j + 1] : w.slice(k + 1);
            if (k === w.length - 1)
              j += 1;
            if (ch === "m")
              paragraphs.push(value === undefined ? null : literalMessage(value));
            else if (ch === "F" || ch === "C" || ch === "c")
              elsewhere = true;
            break;
          }
        }
        continue;
      }
      if (w.startsWith("-")) {
        const [flag, inline] = w.includes("=") ? [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)] : [w, undefined];
        const value = inline ?? (COMMIT_VALUE.has(flag) ? rest[j + 1] : undefined);
        if (inline === undefined && COMMIT_VALUE.has(flag))
          j += 1;
        if (flag === "--message")
          paragraphs.push(value === undefined ? null : literalMessage(value));
        else if (flag === "--file" || flag === "--reuse-message" || flag === "--reedit-message" || flag === "--fixup" || flag === "--squash")
          elsewhere = true;
        continue;
      }
      all = true;
    }
    const message = elsewhere || paragraphs.length === 0 || paragraphs.includes(null) ? null : paragraphs.join(`

`);
    out.push({ kind: "commit", cmd, dir, all, message });
    return out;
  }
  if (sub === "config") {
    if (rest.some((w) => HOOKS_PATH.test(w)))
      out.push({ kind: "hook-bypass", cmd, dir, how: "git config core.hooksPath" });
    const key = rest.findIndex((w) => /^alias\./i.test(w));
    if (key >= 0) {
      const value = rest.slice(key + 1).join(" ");
      if (RISKY_ALIAS.test(value.trim()))
        out.push({ kind: "hook-bypass", cmd, dir, how: `a git alias for "${value.slice(0, 40)}"` });
    }
    return out;
  }
  if (["merge", "rebase", "am", "cherry-pick", "revert", "pull"].includes(sub) && rest.includes("--no-verify")) {
    out.push({ kind: "hook-bypass", cmd, dir, how: `git ${sub} --no-verify` });
    return out;
  }
  if (!GIT_BUILTINS.has(sub))
    out.push({ kind: "alias", tool: "git", name: sub, prefix, args: rest, cmd, dir });
  return out;
}
var MAX_ALIAS_DEPTH = 3;
function expandAlias(tool, value, prefix, args, cmd, depth = 0) {
  if (depth >= MAX_ALIAS_DEPTH)
    return [{ kind: "hook-bypass", cmd, dir: cmd.cd, how: `a ${tool} alias nested too deep to read` }];
  const quoted = args.map((w) => `'${w.replace(/'/g, `'\\''`)}'`).join(" ");
  if (value.startsWith("!")) {
    const inner = parseCommands(`${value.slice(1)} ${quoted}`).map((c) => ({ ...c, cd: join(cmd.cd, c.cd) }));
    return actionsOf(inner, depth + 1);
  }
  const words = parseCommands(value)[0]?.argv ?? [];
  const argv = [...prefix, ...words, ...args];
  return actionsOf([{ argv, env: cmd.env, cd: cmd.cd }], depth + 1);
}
var REPO_ARG = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
function repoFromRef(ref) {
  const url = /^https?:\/\/[^/]+\/(?:api\/v3\/)?(?:repos\/)?([^/\s]+)\/([^/\s#?]+)/.exec(ref);
  if (url)
    return `${url[1]}/${url[2].replace(/\.git$/, "")}`;
  const host = /^(?:[^/\s]+\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})$/.exec(ref);
  if (host && REPO_ARG.test(host[1]))
    return host[1];
  return null;
}
function rawPath(endpoint) {
  let p = endpoint.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  if (!endpoint.includes("://"))
    p = p.replace(/^api\.github\.com(?::\d+)?/i, "");
  try {
    p = decodeURIComponent(p);
  } catch {}
  return p.replace(/[?#].*$/, "").replace(/\/{2,}/g, "/").replace(/^\//, "");
}
function apiPath(endpoint) {
  return rawPath(endpoint).replace(/^api\/v3\//i, "");
}
function repoFromApiPath(endpoint) {
  const m = /^repos\/([^/]+)\/([^/]+)/i.exec(apiPath(endpoint));
  if (!m)
    return null;
  return m[1] === "{owner}" || m[2] === "{repo}" || m[1] === ":owner" || m[2] === ":repo" ? "current" : `${m[1]}/${m[2]}`;
}
var WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
var GH_REPO_WRITES = new Set(["delete", "edit", "rename", "archive", "unarchive", "sync", "set-default"]);
var isDynamic = (w) => /[$`]/.test(w);
function ghActions(cmd) {
  const a = cmd.argv;
  const dir = cmd.cd;
  const envRepo = cmd.env.filter((e) => e.startsWith("GH_REPO=")).pop()?.slice("GH_REPO=".length) ?? null;
  let repoFlag = envRepo !== null && envRepo !== "" ? envRepo : null;
  const words = [];
  for (let i = 1;i < a.length; i += 1) {
    const w = a[i];
    if (w === "-R" || w === "--repo") {
      repoFlag = a[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (w.startsWith("--repo=")) {
      repoFlag = w.slice("--repo=".length);
      continue;
    }
    if (/^-R./.test(w)) {
      repoFlag = w.slice(w[2] === "=" ? 3 : 2);
      continue;
    }
    words.push(w);
  }
  const repo = repoFlag === null ? null : isDynamic(repoFlag) ? "unknown" : repoFromRef(repoFlag) ?? repoFlag;
  const targetRepo = (target) => target === undefined ? repo : isDynamic(target) ? "unknown" : repoFromRef(target) ?? repo;
  const [group, verb] = words;
  if (group === undefined)
    return [];
  if (group === "pr" && verb === "merge") {
    const target = words.slice(2).find((w) => !w.startsWith("-"));
    if (target !== undefined && isDynamic(target))
      return [{ kind: "merge", cmd, dir, repo: "unknown" }];
    const fromUrl = target !== undefined && target.includes("://") ? repoFromRef(target) : null;
    return [{ kind: "merge", cmd, dir, repo: fromUrl ?? repo }];
  }
  if (group === "repo" && verb !== undefined && GH_REPO_WRITES.has(verb)) {
    return [{ kind: "repo-write", cmd, dir, repo: targetRepo(words.slice(2).find((w) => !w.startsWith("-"))) }];
  }
  if (group === "repo" && verb === "create" && words.includes("--push")) {
    return [{ kind: "repo-write", cmd, dir, repo: targetRepo(words.slice(2).find((w) => !w.startsWith("-"))) }];
  }
  if (group === "alias" && (verb === "set" || verb === "import")) {
    const value = words.slice(3).filter((w) => !w.startsWith("-")).join(" ");
    if (verb === "import" || RISKY_ALIAS.test(value.trim()) || words.includes("--shell") || words.includes("-s")) {
      return [{ kind: "hook-bypass", cmd, dir, how: verb === "import" ? "gh alias import" : `a gh alias for "${value.slice(0, 40)}"` }];
    }
    return [];
  }
  if (group === "api") {
    let method = null;
    let hasFields = false;
    let endpoint = null;
    let mutation = false;
    for (let i = 1;i < words.length; i += 1) {
      const w = words[i];
      if (w === "-X" || w === "--method") {
        method = (words[i + 1] ?? "").toUpperCase();
        i += 1;
        continue;
      }
      if (w.startsWith("--method=")) {
        method = w.slice("--method=".length).toUpperCase();
        continue;
      }
      if (/^-X[A-Za-z]+$/.test(w)) {
        method = w.slice(2).toUpperCase();
        continue;
      }
      if (w === "-f" || w === "-F" || w === "--field" || w === "--raw-field" || w === "--input") {
        hasFields = true;
        if (/^query=\s*mutation\b/.test(words[i + 1] ?? ""))
          mutation = true;
        i += 1;
        continue;
      }
      if (/^--(?:raw-)?field=/.test(w) || w.startsWith("--input=")) {
        hasFields = true;
        if (/=query=\s*mutation\b/.test(w))
          mutation = true;
        continue;
      }
      if (w === "-H" || w === "--header" || w === "-q" || w === "--jq" || w === "-t" || w === "--template" || w === "--cache" || w === "-p" || w === "--preview" || w === "--hostname") {
        i += 1;
        continue;
      }
      if (w.startsWith("-"))
        continue;
      if (endpoint === null)
        endpoint = w;
    }
    const isWrite = method !== null ? WRITE_METHODS.has(method) : hasFields;
    if (!isWrite || endpoint === null)
      return [];
    if (isDynamic(endpoint))
      return [{ kind: "api-write", cmd, dir, repo: "unknown" }];
    if (/^graphql\/?$/i.test(apiPath(endpoint)))
      return mutation || hasFields ? [{ kind: "api-write", cmd, dir, repo }] : [];
    const named = repoFromApiPath(endpoint);
    if (named === null)
      return /^[a-z]/i.test(apiPath(endpoint)) && !/^repos\b/i.test(apiPath(endpoint)) ? [] : [{ kind: "api-write", cmd, dir, repo: "unknown" }];
    return [{ kind: "api-write", cmd, dir, repo: named === "current" ? repo : named }];
  }
  if (!GH_GROUPS.has(group))
    return [{ kind: "alias", tool: "gh", name: group, prefix: ["gh", ...repoFlag !== null ? ["-R", repoFlag] : []], args: words.slice(1), cmd, dir }];
  return [];
}
var HTTP_TOOLS = new Set(["curl", "wget", "http", "https", "xh", "xhs"]);
function isGitHubApi(w) {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]*@)?([^/:?#]+)/i.exec(w.trim());
  const host = (m?.[1] ?? "").toLowerCase().replace(/\.$/, "");
  if (host === "api.github.com")
    return true;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(w.trim()) && /^api\/v3(\/|$)/i.test(rawPath(w));
}
var CURL_VALUE = new Set(["-H", "--header", "-o", "--output", "-u", "--user", "-A", "--user-agent", "-e", "--referer", "-b", "--cookie", "-c", "--cookie-jar", "-w", "--write-out", "-m", "--max-time", "--connect-timeout", "-x", "--proxy", "--retry", "-r", "--range", "-E", "--cert", "--cacert", "--key", "--resolve", "--connect-to", "--oauth2-bearer"]);
var CURL_SHORT_VALUE = "HouAebcwmxrEK";
function httpActions(cmd) {
  const prog = programName(cmd.argv[0] ?? "");
  const args = cmd.argv.slice(1);
  let write = false;
  let opaque = false;
  const urls = [];
  for (let i = 0;i < args.length; i += 1) {
    const w = args[i];
    if (prog === "curl") {
      if (w === "--url") {
        urls.push(args[i + 1] ?? "");
        i += 1;
        continue;
      }
      if (w.startsWith("--url=")) {
        urls.push(w.slice(6));
        continue;
      }
      if (w === "-K" || w === "--config") {
        opaque = true;
        i += 1;
        continue;
      }
      if (w.startsWith("--config=")) {
        opaque = true;
        continue;
      }
      if (w === "--request" || w === "-X") {
        write = write || WRITE_METHODS.has((args[i + 1] ?? "").toUpperCase());
        i += 1;
        continue;
      }
      if (w.startsWith("--request=")) {
        write = write || WRITE_METHODS.has(w.slice(10).toUpperCase());
        continue;
      }
      if (/^--(data|json|form|upload-file)/.test(w)) {
        write = true;
        if (!w.includes("="))
          i += 1;
        continue;
      }
      if (CURL_VALUE.has(w)) {
        i += 1;
        continue;
      }
      if (/^-[A-Za-z]/.test(w)) {
        const body = w.slice(1);
        for (let k = 0;k < body.length; k += 1) {
          const ch = body[k];
          const tail = body.slice(k + 1);
          const value = tail !== "" ? tail : args[i + 1] ?? "";
          if (ch === "X") {
            write = write || WRITE_METHODS.has(value.toUpperCase());
            if (tail === "")
              i += 1;
            break;
          }
          if (ch === "d" || ch === "F" || ch === "T") {
            write = true;
            if (tail === "")
              i += 1;
            break;
          }
          if (ch === "K") {
            opaque = true;
            if (tail === "")
              i += 1;
            break;
          }
          if (CURL_SHORT_VALUE.includes(ch)) {
            if (tail === "")
              i += 1;
            break;
          }
        }
        continue;
      }
      if (w.startsWith("-"))
        continue;
      urls.push(w);
    } else if (prog === "wget") {
      if (/^--method=/i.test(w))
        write = write || WRITE_METHODS.has(w.slice(9).toUpperCase());
      else if (w === "--method") {
        write = write || WRITE_METHODS.has((args[i + 1] ?? "").toUpperCase());
        i += 1;
      } else if (/^--(post|body)-(data|file)/.test(w))
        write = true;
      else if (!w.startsWith("-"))
        urls.push(w);
    } else {
      if (/^[A-Za-z]+$/.test(w) && WRITE_METHODS.has(w.toUpperCase())) {
        write = true;
        continue;
      }
      if (w.startsWith("-"))
        continue;
      if (isGitHubApi(w) || /^[a-z][a-z0-9+.-]*:\/\//i.test(w)) {
        urls.push(w);
        continue;
      }
      if (/^[^=:@]+(:=|==|=|@)/.test(w))
        write = true;
    }
  }
  if (opaque)
    return [{ kind: "api-write", cmd, dir: cmd.cd, repo: "unknown" }];
  const api = urls.filter(isGitHubApi);
  if (!write || api.length === 0)
    return [];
  const out = [];
  for (const u of api) {
    const path = apiPath(u);
    const repo = repoFromApiPath(u);
    if (repo !== null && repo !== "current")
      out.push({ kind: "api-write", cmd, dir: cmd.cd, repo });
    else if (/^graphql\/?$/i.test(path) || !/^[a-z]/i.test(path) || /^repos\b/i.test(path))
      out.push({ kind: "api-write", cmd, dir: cmd.cd, repo: "unknown" });
  }
  return out;
}
var EXPORTERS = new Set(["export", "declare", "typeset", "readonly", "local", "set"]);
function actionsOf(cmds, depth = 0) {
  const out = [];
  const made = new Map;
  const lineEnv = [];
  for (const cmd of cmds) {
    const prog = programName(cmd.argv[0] ?? "");
    lineEnv.push(...cmd.env.filter((e) => e.startsWith("GH_REPO=")).filter(() => cmd.argv.length === 0));
    if (EXPORTERS.has(prog))
      lineEnv.push(...cmd.argv.slice(1).filter((w) => w.startsWith("GH_REPO=")));
    if (prog === "git" || prog.startsWith("git-") && GIT_BUILTINS.has(prog.slice(4)))
      out.push(...gitActions(cmd, depth, made));
    else if (prog === "gh")
      out.push(...ghActions(lineEnv.length > 0 ? { ...cmd, env: [...lineEnv, ...cmd.env] } : cmd));
    else if (HTTP_TOOLS.has(prog))
      out.push(...httpActions(cmd));
  }
  return out;
}
function repoFromRemoteUrl(url) {
  const u = url.trim();
  const full = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?[^/:]+(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u);
  if (full)
    return `${full[1]}/${full[2]}`;
  const scp = /^(?:[^@/:]+@)?[^/:]+:\/?([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u);
  if (scp && !u.startsWith("/") && !u.startsWith("."))
    return `${scp[1]}/${scp[2]}`;
  return null;
}

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
    notFilled: plan.held.map((h2) => ({ name: h2.name, why: h2.why })),
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
var ENV_SECRETS_SPEC = {
  name: ENV_SECRETS_TOOL,
  description: "Fill a DKOD app's secrets from a .env file on this computer. Give the file's PATH: Dkoder reads the file here, seals each value on this computer for the apps cluster, and sends only the sealed text. DKOD never sees a value, and neither do you. Never read a .env file yourself and never put a secret value in a tool call. The answer has names and counts only. Only the names the app reads are filled; a value that points at localhost or refers to another name is listed, not filled. The values apply on the next deploy.",
  inputSchema: {
    type: "object",
    properties: {
      appKey: { type: "string", description: "The app's key, as in dkoder.session.start." },
      envFile: { type: "string", description: "The path of the .env file: absolute, or relative to the session's folder. A path only, never the file's text." },
      sessionId: { type: "string", description: "The dkoder session for this app, if one is open. Left out, Dkoder opens one." },
      addOtherNames: { type: "boolean", description: "Also add the names in the file that the app's code does not read. Default false." }
    },
    required: ["appKey", "envFile"],
    additionalProperties: false
  },
  isDeferred: false
};
var APP_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
var refuse = (error, message) => ({ ok: false, error, message });
var record = (v) => typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
var names = (v) => Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
function serverRefusal(body, fallback) {
  const b = record(body);
  const error = typeof b?.error === "string" ? b.error.slice(0, 64) : "refused";
  const message = typeof b?.message === "string" ? b.message.slice(0, 300) : fallback;
  return refuse(error, message);
}
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
function absolutePath(cwd, path) {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path))
    return path;
  return `${cwd.replace(/[\\/]+$/, "")}/${path}`;
}
async function fillSecretsFromEnv(io, input) {
  const { appKey, envFile } = input;
  if (typeof appKey !== "string" || !APP_KEY.test(appKey))
    return refuse("invalid_request", "Give the app's key in appKey.");
  if (typeof envFile !== "string" || envFile === "" || envFile.length > 1024 || envFile.includes("\x00") || envFile.includes(`
`))
    return refuse("invalid_request", "Give the path of the .env file in envFile. A path only, never the file's text.");
  let text;
  try {
    text = await io.read(absolutePath(await io.cwd(), envFile));
  } catch {
    return refuse("file_unreadable", "Dkoder could not read that file. Check the path.");
  }
  const parsed = parseEnvFile(text);
  text = "";
  if (!parsed.ok) {
    if (parsed.problem === "too_large")
      return refuse("file_too_large", "This file is larger than 256 KB.");
    if (parsed.problem === "nul_byte")
      return refuse("not_text", "This is not a text file.");
    return refuse("open_quote", parsed.line === undefined ? "A line opens a quote that does not close." : `Line ${parsed.line} opens a quote that does not close.`);
  }
  if (parsed.entries.length === 0)
    return refuse("nothing_found", "No NAME=value line was found in that file.");
  const signedOut = refuse("not_signed_in", "DKOD is not connected. Type /mcp, pick dkod, then Authenticate. Then try again.");
  let sessionId = typeof input.sessionId === "string" && input.sessionId !== "" ? input.sessionId : null;
  if (sessionId === null) {
    const started = await io.call("dkoder.session.start", { appKey });
    if (started === null)
      return signedOut;
    const id = record(started.body)?.id;
    if (!started.ok || typeof id !== "string")
      return serverRefusal(started.body, "DKOD could not open a session for this app.");
    sessionId = id;
  }
  const target = await io.call("dkoder.secrets.target", { sessionId, appKey });
  if (target === null)
    return signedOut;
  if (!target.ok)
    return serverRefusal(target.body, "DKOD could not say what to seal this app's secrets for.");
  const view = viewFrom(target.body);
  if (view === null)
    return refuse("unavailable", "DKOD's answer could not be read. Update the dkod plugin, then try again.");
  const plan = planEnvFill(view, parsed.entries);
  const addOthers = input.addOtherNames === true;
  const values = [...plan.fill, ...addOthers ? plan.others : []];
  const report = envFillReport(plan, addOthers);
  if (values.length === 0)
    return { ok: true, appKey, saved: false, next: "No name was filled, so nothing was saved.", ...report };
  let sealed;
  try {
    sealed = await sealAppSecrets(view.cert, view.target, values);
  } catch {
    return refuse("seal_failed", "The values could not be sealed on this computer. The apps cluster's sealing certificate did not check out. Try again; if it keeps failing, tell your DKOD admin.");
  }
  const saved = await io.call("dkoder.secrets.save", { sessionId, appKey, certFingerprint: sealed.certFingerprint, secrets: sealed.secrets });
  if (saved === null)
    return signedOut;
  if (!saved.ok)
    return serverRefusal(saved.body, "DKOD could not save the sealed secrets. Try again.");
  return { ok: true, appKey, saved: true, next: "The values are sealed and saved. Deploy the app again to use them.", ...report };
}

var TICK_MS = 120;
var CYCLE_TICKS = 34;
var PULSE_TICKS = 12;
var PULSE_TEXT_MS = 8000;
var WORD = ["D", "K", "O", "D"];
var COLORS = {
  cyan: "#22d3ee",
  cyanLight: "#cffafe",
  yellow: "#facc15",
  yellowLight: "#fef9c3",
  green: "#4ade80",
  coral: "#fb7185",
  dim: "#94a3b8"
};
function signedIn(auth) {
  return auth === "ok" || auth === "checking";
}
function wordmark(frame, auth) {
  const base = signedIn(auth) ? COLORS.cyan : COLORS.yellow;
  const light = signedIn(auth) ? COLORS.cyanLight : COLORS.yellowLight;
  return WORD.map((ch, i) => i === frame ? { ch, color: light, bold: true } : { ch, color: base, bold: true });
}
function wordmarkFrame(tick) {
  const at = (tick % CYCLE_TICKS + CYCLE_TICKS) % CYCLE_TICKS;
  return at < WORD.length ? at : -1;
}
var PULSE_GLYPHS = ["◇", "◈", "◆", "◈"];
function icon(pulse, pulseFrame) {
  if (pulse === null || pulseFrame < 0 || pulseFrame >= PULSE_TICKS)
    return { glyph: "◈", color: COLORS.cyan };
  const color = pulse.decision === "allowed" ? COLORS.green : pulse.decision === "blocked" ? COLORS.coral : COLORS.yellow;
  return { glyph: PULSE_GLYPHS[pulseFrame % PULSE_GLYPHS.length], color };
}
function message(auth, pulse, now, status) {
  if (pulse !== null && now - pulse.at < PULSE_TEXT_MS) {
    const color = pulse.decision === "allowed" ? COLORS.green : pulse.decision === "blocked" ? COLORS.coral : COLORS.yellow;
    return { text: pulse.text, color };
  }
  if (auth === "signin")
    return { text: "Sign in to DKOD for Deliver and your organization's Guard rules: type /mcp, pick dkod, then Authenticate", color: COLORS.yellow };
  if (auth === "device")
    return { text: "This device is not enrolled in your organization's Guard. Ask your DKOD admin.", color: COLORS.yellow };
  if (auth === "offline")
    return { text: "DKOD is not connected. Type /mcp and connect dkod.", color: COLORS.yellow };
  return { text: status, color: COLORS.dim };
}
function pulseText(decision, action, repo) {
  const verb = decision === "allowed" ? "checked" : decision === "blocked" ? "blocked" : "declined";
  const what = action === "blocked-command" ? "a command" : action.replace(/-/g, " ");
  return repo === null ? `${verb} ${what}` : `${verb} ${what} · ${repo}`;
}
function bandTree(el, view) {
  const letters = wordmark(view.frame, view.auth).map((l) => h(el.Text, { color: l.color, bold: l.bold }, l.ch));
  const mark = icon(view.pulse, view.pulseFrame);
  const words = message(view.auth, view.pulse, view.now, view.status);
  return h(el.Box, { key: "dkod-band", flexDirection: "row" }, h(el.Text, null, ...letters), h(el.Text, { color: mark.color, bold: true }, `  ${mark.glyph} `), h(el.Text, { color: COLORS.dim }, "Dkoder  "), h(el.Text, { color: words.color, wrap: "truncate-end" }, words.text));
}
function withBelow(el, ours, below) {
  if (below === null || below === undefined || below === false)
    return ours;
  return h(el.Box, { key: "dkod-stack", flexDirection: "column" }, ours, below);
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
  "commit.conventional",
  "migration.stack"
];

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

var IGNORED_BASENAMES = new Set(["readme.md", "license", "license.md", "licence", "licence.md"]);
var MAX_ASSET_BYTES = 512 * 1024;

var NAMESPACES = new Set(["app", "policy", "answers", "dkod"]);

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

var REMOVED_SECRET = "DKOD_REMOVED_SECRET";
var ASSIGNMENT_RE = /^[\s\-*]*(?:(?:export|ENV|ARG|const|let|var|readonly|private|public|static|final)\s+)*["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?[ \t]*(?::[ \t]*[A-Za-z_][A-Za-z0-9_<>[\]|]*[ \t]*)?[:=](.*)$/;
var SECRET_KEY_RE = /^(.*_)?(secret|password|passwd|token|api_key|apikey|private_key)$/i;
function normaliseKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[.-]/g, "_").toLowerCase();
}
function looksLikeReference(value) {
  const v = value.trim().replace(/^["'`]/, "").replace(/["'`],?;?$/, "").trim();
  if (v === "" || v === "null" || v === "~" || v === "true" || v === "false" || v === "{}" || v === "[]")
    return true;
  if (v.includes(REMOVED_SECRET))
    return true;
  if (v === "|" || v === ">" || v === "|-" || v === ">-")
    return true;
  if (/^\{\{[^}]*\}\}$/.test(v))
    return true;
  if (/\$\{[^}]*\}/.test(v) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v) || v.startsWith("$("))
    return true;
  if (/^%\([^)]*\)s$/.test(v))
    return true;
  if (/(process|Bun|Deno|import\.meta)\.env\b/.test(v) || v.includes("env[") || /\bos\.environ\b/.test(v) || /\bgetenv\b/i.test(v))
    return true;
  if (/\bsecretKeyRef\b|\bvalueFrom\b|\bexternalSecret\b/.test(v))
    return true;
  if (/^<[^<>]+>$/.test(v))
    return true;
  return false;
}
var CODE_FILE_RE = /\.(?:[cm]?[jt]sx?|py|go|java|kt|kts|rb|rs|cs|php|swift|scala|dart)$/;
function looksLikeCodeExpression(path, value) {
  if (isConfigFile(path) || !CODE_FILE_RE.test(basename(path)))
    return false;
  const v = value.trim().replace(/[,;]$/, "").trim();
  if (!v.includes("(") && !v.includes(".") && !/^(?:await|new)[ \t]/.test(v))
    return false;
  return /^(?:await[ \t]+|new[ \t]+)?[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*[ \t]*(?:[!?]?\(.*)?$/.test(v);
}
function nameWords(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase().split(/[_.-]/).filter((w) => w !== "");
}
var SECRET_LAST_WORDS = new Set(["secret", "token", "apikey", "credential", "credentials"]);
var PASSWORD_WORDS = new Set(["password", "passwd", "pwd", "pass", "passphrase"]);
var KEY_QUALIFIERS2 = new Set(["api", "private", "secret", "access", "signing", "encryption", "master", "client"]);
var DESCRIBING_LAST_WORDS = new Set([
  "id",
  "ids",
  "hash",
  "ref",
  "refs",
  "name",
  "names",
  "path",
  "paths",
  "url",
  "uri",
  "file",
  "dir",
  "enc",
  "encrypted",
  "count",
  "kind",
  "type",
  "header",
  "headers",
  "state",
  "scope",
  "scopes",
  "label",
  "prefix",
  "length",
  "len",
  "env",
  "var",
  "field",
  "tag",
  "version",
  "digest",
  "ttl",
  "expiry",
  "expires",
  "at"
]);
function secretNameKind(name) {
  const words = nameWords(name);
  const last = words.at(-1);
  if (last === undefined || DESCRIBING_LAST_WORDS.has(last))
    return null;
  if (words.join("_").endsWith("key_name"))
    return null;
  if (words.length === 1 && last === "pass")
    return "secret";
  if (PASSWORD_WORDS.has(last))
    return "password";
  if (SECRET_LAST_WORDS.has(last))
    return "secret";
  if (last === "base" && words.at(-2) === "key" && words.at(-3) === "secret")
    return "secret";
  if (last !== "key" || words.length < 2)
    return null;
  return KEY_QUALIFIERS2.has(words.at(-2)) ? "secret" : "any_key";
}
function isSecretName(name) {
  return secretNameKind(name) !== null;
}
function isFakeValue(value) {
  return /example/i.test(value) || /^(.)\1*$/.test(value) || /x{8}/i.test(value);
}
function entropy(value) {
  const counts = new Map;
  for (const ch of value)
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
function charClasses(value) {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
}
var TIER_B_PLACEHOLDER = /test|example|sample|placeholder|dummy|fake|changeme|change_me|your|xxx|redacted|secret-value|todo|<|>|\.\.\./i;
var DEFAULT_PASSWORD = /^(password|passwd|secret|admin|root|postgres|mysql|redis|guest|default|changeit)$/i;
function looksRandom(value) {
  if (/^[0-9a-fA-F]+$/.test(value))
    return value.length >= 16 && entropy(value) >= 3;
  return entropy(value) >= 3.5 && charClasses(value) >= 2;
}
function notSecretShape(value) {
  if (value.includes(REMOVED_SECRET) || looksLikeReference(value))
    return true;
  if (/^(\/|\.\/|\.\.\/|~\/)/.test(value) || /\.[a-z0-9]{1,5}$/.test(value))
    return true;
  if (value.includes("://"))
    return true;
  if (/\d\.\d/.test(value) || /sha256:/i.test(value))
    return true;
  if (/\$\{|\$\(|\{\{|process\.env|os\.environ|import\.meta\.env|%/.test(value))
    return true;
  return TIER_B_PLACEHOLDER.test(value);
}
var IDENTIFIER_PART = "(?:[a-z]+(?:[0-9]+[a-z]*)?|[0-9]+[a-z]*)";
var CAMEL_PART = "[a-z]+[0-9]*(?:[A-Z][a-z]+[0-9]*)*";
var DOTTED_CAMEL_KEY = new RegExp(`^${CAMEL_PART}(?:\\.${CAMEL_PART})+$`);
var IDENTIFIER_VALUE = new RegExp(`^${IDENTIFIER_PART}(?:[._/-]${IDENTIFIER_PART})*$`);
function looksLikeSecretLiteral(value, kind) {
  const password = kind === "password";
  if (value.length < (password ? 8 : 16) || /\s/.test(value))
    return false;
  if (notSecretShape(value))
    return false;
  if (password)
    return !DEFAULT_PASSWORD.test(value);
  if (/^[A-Z][A-Z0-9_]+$/.test(value))
    return false;
  if (kind === "any_key" && DOTTED_CAMEL_KEY.test(value))
    return false;
  if (IDENTIFIER_VALUE.test(value))
    return false;
  return looksRandom(value);
}
var TEST_OR_DOC_DIR = /(^|\/)(test|tests|__tests__|spec|specs|fixtures?|testdata|examples?|docs?)\//i;
var TEST_OR_DOC_FILE = /\.(test|spec)\.[a-z]+$|_test\.(go|py|rs)$|\.(md|mdx|txt|rst)$/i;
function isTestOrDocPath(path) {
  return TEST_OR_DOC_DIR.test(path) || TEST_OR_DOC_FILE.test(path);
}
var PEM_LABEL = "PRIV" + "ATE KEY";
var PEM_BEGIN_RE = new RegExp(`-----BEGIN ([A-Z0-9 ]{0,40})${PEM_LABEL}( BLOCK)?-----`, "g");
var PEM_BODY_RE = /(?:[A-Za-z0-9+/=\s]|\\[nr]){40,}/y;
var hasDigit = (v) => /\d/.test(v);
var VALUE_PATTERNS = [
  { rule: "aws_access_key_id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { rule: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{36,255}/g },
  { rule: "github_token", re: /\bgithub_pat_[A-Za-z0-9_]{50,255}/g },
  { rule: "gitlab_token", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { rule: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { rule: "openrouter_key", re: /\bsk-or-[A-Za-z0-9_-]{20,}/g },
  { rule: "openai_key", re: /\bsk-proj-[A-Za-z0-9_-]{20,}/g },
  { rule: "openai_key", re: /\bsk-[A-Za-z0-9_-]{20,}/g, accept: hasDigit },
  { rule: "xai_key", re: /\bxai-[A-Za-z0-9]{20,}/g },
  { rule: "groq_key", re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { rule: "huggingface_token", re: /\bhf_[A-Za-z0-9]{30,}/g },
  { rule: "npm_token", re: /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g },
  { rule: "pypi_token", re: /\bpypi-[A-Za-z0-9_-]{50,}/g },
  { rule: "sendgrid_key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { rule: "shopify_token", re: /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}(?![a-fA-F0-9])/g },
  { rule: "aws_secret_access_key", re: /aws_secret_access_key["']?[ \t]*[:=][ \t]*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/dgi, group: 1 },
  { rule: "stripe_key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { rule: "slack_token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { rule: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { rule: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { rule: "registry_auth", re: /:_(?:authToken|auth|password)[ \t]*=[ \t]*"?([^\s"#;]+)/dg, group: 1 },
  { rule: "db_url_password", re: /:\/\/[^\s:@/'"`]+:([^\s@/'"`]+)@/dg, group: 1 }
];
var AWS_SECRET_RE = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g;
var AWS_PAIR_WINDOW = 400;
var awsSecretShaped = (v) => /^[A-Za-z0-9/+=]{40}$/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9/+]/.test(v);
var DOCKER_AUTH_RE = /"auth"[ \t]*:[ \t]*"([A-Za-z0-9+/=]{8,})"/dg;
var INLINE_ASSIGNMENT_RE = /(?<![A-Za-z0-9_.$-])["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?[ \t]*(?::[ \t]*[A-Za-z_][A-Za-z0-9_<>[\]|]*[ \t]*)?[:=][ \t]*/g;
var LINE_START_PREFIX = /^[\s\-*]*(?:(?:export|ENV|ARG)\s+)*$/;
var BEARER_RE = /\bBearer[ \t]+([A-Za-z0-9._~+/-]{20,}=*)/dg;
var QUOTED = {
  '"': /^"((?:\\.|[^"\\\n])*)"/,
  "'": /^'((?:\\.|[^'\\\n])*)'/,
  "`": /^`((?:\\.|[^`\\\n])*)`/
};
var ASSIGNMENT_LINE_CAP = 20 * 1024;
function basename(path) {
  return (path.split("/").pop() ?? path).toLowerCase();
}
function isConfigFile(path) {
  const base = basename(path);
  if (base === "dockerfile" || base.startsWith("dockerfile.") || base.startsWith(".env") || base.endsWith(".env"))
    return true;
  if ([".npmrc", ".yarnrc", ".yarnrc.yml", ".pypirc", ".netrc", "_netrc", ".dev.vars", ".flaskenv", ".pgpass", ".my.cnf"].includes(base))
    return true;
  return /\.(ya?ml|properties|ini|cfg|conf|toml|env|envrc|example|sample|template|tfvars|vars)$/.test(base);
}
function lineStarts(content) {
  const starts = [0];
  for (let i = 0;i < content.length; i += 1)
    if (content.charCodeAt(i) === 10)
      starts.push(i + 1);
  return starts;
}
function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (starts[mid] <= offset)
      lo = mid;
    else
      hi = mid - 1;
  }
  return lo + 1;
}
function pemHits(content) {
  const out = [];
  PEM_BEGIN_RE.lastIndex = 0;
  for (let m = PEM_BEGIN_RE.exec(content);m; m = PEM_BEGIN_RE.exec(content)) {
    const start = m.index;
    const after = start + m[0].length;
    const endMarker = `-----END ${m[1] ?? ""}${PEM_LABEL}${m[2] ?? ""}-----`;
    const endAt = content.indexOf(endMarker, after);
    if (endAt >= 0) {
      out.push({ start, end: endAt + endMarker.length });
      PEM_BEGIN_RE.lastIndex = endAt + endMarker.length;
      continue;
    }
    PEM_BODY_RE.lastIndex = after;
    const body = PEM_BODY_RE.exec(content);
    if (body && (body[0].match(/[A-Za-z0-9+/]/g)?.length ?? 0) >= 32)
      out.push({ start, end: after + body[0].length });
  }
  return out;
}
function literalOf(rhs, config) {
  const quote = QUOTED[rhs[0] ?? ""];
  if (quote) {
    const quoted = quote.exec(rhs);
    if (!quoted)
      return null;
    if (rhs[0] === "`" && quoted[1].includes("${"))
      return null;
    return { value: quoted[1], offset: 1 };
  }
  if (!config)
    return null;
  const bare = /^[^\s#;,]+/.exec(rhs);
  return bare ? { value: bare[0], offset: 0 } : null;
}
function detectSecrets(path, content) {
  const starts = lineStarts(content);
  const lines = content.split(`
`);
  const raw = [];
  const nameOnLine = (index) => {
    const text = (lines[index] ?? "").slice(0, ASSIGNMENT_LINE_CAP).replace(/\r$/, "");
    const m = ASSIGNMENT_RE.exec(text);
    if (!m)
      return null;
    return isSecretName(m[1]) ? m[1] : null;
  };
  const nameAt = (offset) => nameOnLine(lineOf(starts, offset) - 1);
  for (const span of pemHits(content))
    raw.push({ rule: "private_key", name: nameAt(span.start), ...span });
  const awsIds = [];
  for (const p of VALUE_PATTERNS) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(content);m; m = p.re.exec(content)) {
      const value = m[p.group ?? 0] ?? "";
      if (value === "" || value.includes(REMOVED_SECRET) || isFakeValue(value))
        continue;
      if (p.accept && !p.accept(value))
        continue;
      if (p.rule === "db_url_password" && value.length < 6)
        continue;
      if ((p.rule === "db_url_password" || p.rule === "registry_auth") && (looksLikeReference(value) || /%s|\{\{|^\$/.test(value) || /^(password|pass|secret|changeme)$/i.test(value)))
        continue;
      const start = p.group ? m.indices?.[p.group]?.[0] ?? -1 : m.index;
      if (start < 0)
        continue;
      raw.push({ rule: p.rule, name: nameAt(start), start, end: start + value.length });
      if (p.rule === "aws_access_key_id")
        awsIds.push({ start, end: start + value.length });
    }
  }
  for (const id of awsIds) {
    const from = Math.max(0, id.start - AWS_PAIR_WINDOW);
    const window = content.slice(from, Math.min(content.length, id.end + AWS_PAIR_WINDOW));
    AWS_SECRET_RE.lastIndex = 0;
    for (let m = AWS_SECRET_RE.exec(window);m; m = AWS_SECRET_RE.exec(window)) {
      if (!awsSecretShaped(m[0]) || isFakeValue(m[0]))
        continue;
      const start = from + m.index;
      raw.push({ rule: "aws_secret_access_key", name: nameAt(start), start, end: start + 40 });
    }
  }
  const base = basename(path);
  if (base === ".netrc" || base === "_netrc") {
    const re = /\bpassword[ \t]+([^\s]+)/dg;
    for (let m = re.exec(content);m; m = re.exec(content)) {
      const start = m.indices?.[1]?.[0] ?? -1;
      if (start >= 0 && !m[1].includes(REMOVED_SECRET) && !isFakeValue(m[1]))
        raw.push({ rule: "netrc_password", name: null, start, end: start + m[1].length });
    }
  }
  if (base === "config.json" && content.includes('"auths"')) {
    DOCKER_AUTH_RE.lastIndex = 0;
    for (let m = DOCKER_AUTH_RE.exec(content);m; m = DOCKER_AUTH_RE.exec(content)) {
      const start = m.indices?.[1]?.[0] ?? -1;
      if (start >= 0 && !isFakeValue(m[1]))
        raw.push({ rule: "registry_auth", name: null, start, end: start + m[1].length });
    }
  }
  const config = isConfigFile(path);
  const tierB = !isTestOrDocPath(path);
  for (let i = 0;i < lines.length; i += 1) {
    const line = lines[i].slice(0, ASSIGNMENT_LINE_CAP).replace(/\r$/, "");
    const isComment = /^\s*(#|\/\/|\/\*|\*)/.test(line);
    INLINE_ASSIGNMENT_RE.lastIndex = 0;
    for (let m = INLINE_ASSIGNMENT_RE.exec(line);m; m = INLINE_ASSIGNMENT_RE.exec(line)) {
      const name = m[1];
      const rhsAt = m.index + m[0].length;
      const lineAssignment = config && LINE_START_PREFIX.test(line.slice(0, m.index));
      const literal = literalOf(line.slice(rhsAt), lineAssignment);
      if (!literal)
        continue;
      const at = rhsAt + literal.offset;
      INLINE_ASSIGNMENT_RE.lastIndex = Math.max(INLINE_ASSIGNMENT_RE.lastIndex, at + literal.value.length);
      const span = { start: starts[i] + at, end: starts[i] + at + literal.value.length };
      if (/aws.*secret/.test(normaliseKey(name)) && awsSecretShaped(literal.value) && !isFakeValue(literal.value)) {
        raw.push({ rule: "aws_secret_access_key", name: isSecretName(name) ? name : null, ...span });
        continue;
      }
      const kind = tierB && !isComment ? secretNameKind(name) : null;
      if (kind === null || !looksLikeSecretLiteral(literal.value, kind))
        continue;
      raw.push({ rule: "secret_assignment", name, ...span });
    }
    if (!tierB || isComment)
      continue;
    BEARER_RE.lastIndex = 0;
    for (let m = BEARER_RE.exec(line);m; m = BEARER_RE.exec(line)) {
      const token = m[1];
      const at = m.indices?.[1]?.[0] ?? -1;
      if (at < 0 || notSecretShape(token) || !looksRandom(token.replace(/=+$/, "")))
        continue;
      raw.push({ rule: "bearer_token", name: null, start: starts[i] + at, end: starts[i] + at + token.length });
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let reached = -1;
  for (const hit of raw) {
    if (hit.start < reached)
      continue;
    out.push({ ...hit, line: lineOf(starts, hit.start) });
    reached = hit.end;
  }
  return out;
}

function checkPathSafety(file) {
  if (!safeRepoPath(file.path)) {
    return [{ rule: "path-safety", path: file.path, message: `${file.path} is not a path this build may write: a repository path may not be absolute, contain a ".." segment, contain a backslash or a line break, or exceed 256 characters.` }];
  }
  if (file.path === ".git" || file.path.startsWith(".git/")) {
    return [{ rule: "path-safety", path: file.path, message: `${file.path} is inside the git directory, which is not part of the application.` }];
  }
  return [];
}
function checkSecrets(file) {
  const out = [];
  const lines = file.content.split(`
`);
  for (let i = 0;i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, "");
    if (/^\s*(#|\/\/)/.test(line))
      continue;
    const match = ASSIGNMENT_RE.exec(line);
    if (!match)
      continue;
    const key = normaliseKey(match[1]);
    if (key.endsWith("_ref") || key.endsWith("_name") || key.endsWith("_path"))
      continue;
    if (!SECRET_KEY_RE.test(key))
      continue;
    if (looksLikeReference(match[2]))
      continue;
    if (!/^\s*\*/.test(line) && looksLikeCodeExpression(file.path, match[2]))
      continue;
    out.push({
      rule: "no-plaintext-secrets",
      path: file.path,
      line: i + 1,
      message: `${file.path} line ${String(i + 1)} sets ${match[1]} to a literal value. Put the NAME of a secret there and resolve it at run time; this file is committed to git and anything written in it stays in the history forever.`
    });
  }
  const flagged = new Set(out.map((f) => f.line));
  for (const hit of detectSecrets(file.path, file.content)) {
    if (flagged.has(hit.line))
      continue;
    flagged.add(hit.line);
    out.push({
      rule: "no-plaintext-secrets",
      path: file.path,
      line: hit.line,
      message: `${file.path} line ${String(hit.line)} carries what looks like a secret (${hit.rule}). Put the NAME of a secret there and resolve it at run time; this file is committed to git and anything written in it stays in the history forever.`
    });
  }
  return out;
}
function isContainerFile(path) {
  const base = path.split("/").pop() ?? path;
  return base === "Dockerfile" || base === "Containerfile" || /\.[Dd]ockerfile$/.test(base) || /^Dockerfile\./.test(base);
}
var FROM_RE = /^\s*FROM\s+(?:--[^\s]+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
function tagOf(image) {
  if (image.includes("@"))
    return { pinned: true, tag: null };
  const lastSlash = image.lastIndexOf("/");
  const colon = image.indexOf(":", lastSlash + 1);
  if (colon < 0)
    return { pinned: false, tag: null };
  const tag = image.slice(colon + 1);
  return { pinned: tag !== "" && tag !== "latest", tag };
}
function checkPinnedImages(file) {
  if (!isContainerFile(file.path))
    return [];
  const out = [];
  const stages = new Set;
  const lines = file.content.split(`
`);
  for (let i = 0;i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, "");
    if (/^\s*#/.test(line))
      continue;
    const match = FROM_RE.exec(line);
    if (!match)
      continue;
    const image = match[1];
    const alias = match[2];
    if (alias !== undefined)
      stages.add(alias.toLowerCase());
    if (image.toLowerCase() === "scratch")
      continue;
    if (stages.has(image.toLowerCase()))
      continue;
    if (image.includes("$"))
      continue;
    const { pinned, tag } = tagOf(image);
    if (pinned)
      continue;
    out.push({
      rule: "pinned-images",
      path: file.path,
      line: i + 1,
      message: tag === "latest" ? `${file.path} line ${String(i + 1)} builds FROM ${image}. ":latest" is whatever the registry held this morning; name a version or a digest.` : `${file.path} line ${String(i + 1)} builds FROM ${image} with no tag, which means ":latest". Name a version or a digest.`
    });
  }
  return out;
}
var USER_RE = /^\s*USER\s+(\S+)\s*$/i;
function checkNonRoot(file) {
  if (!isContainerFile(file.path))
    return [];
  const lines = file.content.split(`
`).map((line) => line.replace(/\r$/, ""));
  let lastFrom = -1;
  for (let i = 0;i < lines.length; i += 1) {
    if (/^\s*#/.test(lines[i]))
      continue;
    if (FROM_RE.test(lines[i]))
      lastFrom = i;
  }
  if (lastFrom < 0)
    return [];
  let user = null;
  for (let i = lastFrom + 1;i < lines.length; i += 1) {
    if (/^\s*#/.test(lines[i]))
      continue;
    const match = USER_RE.exec(lines[i]);
    if (match)
      user = { name: match[1], line: i + 1 };
  }
  if (user === null) {
    return [{ rule: "non-root", path: file.path, message: `${file.path} never sets USER, so the container runs as root. Create an unprivileged user and switch to it before the entry point.` }];
  }
  const name = user.name.split(":")[0].toLowerCase();
  if (name === "root" || name === "0" || name.includes("$")) {
    return [
      {
        rule: "non-root",
        path: file.path,
        line: user.line,
        message: name.includes("$") ? `${file.path} line ${String(user.line)} sets USER from a variable, so whether the container runs as root depends on a value this file does not fix.` : `${file.path} line ${String(user.line)} sets USER to ${user.name}, so the container runs as root.`
      }
    ];
  }
  return [];
}
function checkOverwrite(file, templatePaths, mayOverwrite = []) {
  if (!templatePaths.includes(file.path))
    return [];
  if (mayOverwrite.includes(file.path))
    return [];
  return [
    {
      rule: "overwrite",
      path: file.path,
      message: `${file.path} was produced by the template and the agent replaced it. Check the change against what the template intended; the shell is what makes a generated application reviewable.`
    }
  ];
}
function checkGuardrails(input) {
  const out = [];
  for (const file of input.files) {
    out.push(...checkPathSafety(file));
    out.push(...checkSecrets(file));
    out.push(...checkPinnedImages(file));
    out.push(...checkNonRoot(file));
    out.push(...checkOverwrite(file, input.templatePaths, input.mayOverwrite ?? []));
  }
  return out;
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
      for (const h2 of hits)
        findings.push(toFinding(rule.name, check.use, level, check.message, def.title, h2));
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
function evaluateCommit(pack, message) {
  const findings = [];
  let checked = 0;
  for (const rule of pack.rules) {
    for (const check of rule.checks) {
      const level = check.level ?? rule.level;
      const def = CATALOG[check.use];
      if (level === "off" || def.scope !== "commit" || !def.runCommit)
        continue;
      checked += 1;
      for (const h2 of def.runCommit(message, check.with))
        findings.push(toFinding(rule.name, check.use, level, check.message, def.title, h2));
    }
  }
  return finish(findings, checked);
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

var GUARD_LIMITS = { repos: 100, commands: 100, commandWords: 8, patterns: 50, regexLength: 200, reasonLength: 300 };
var REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
var OWNER_WILDCARD = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/\*$/;
var NAME = /^[a-z][a-z0-9_-]{0,39}$/;
var WORD2 = /^[^\s]{1,100}$/;
var obj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function onlyKeys(v, allowed, at, out) {
  for (const k of Object.keys(v))
    if (!allowed.includes(k))
      out.push({ path: at ? `${at}.${k}` : k, message: `${k} is not a guard.yaml key. guard.yaml can only add blocks; the floor DKOD ships cannot be changed here.` });
}
var lower = (s) => s.toLowerCase();
function stringList2(v, at, max, out) {
  if (v === undefined)
    return [];
  if (!Array.isArray(v)) {
    out.push({ path: at, message: `${at} must be a list.` });
    return [];
  }
  if (v.length > max)
    out.push({ path: at, message: `${at} has more than ${max} entries.` });
  const seen = new Set;
  const items = [];
  v.forEach((x, i) => {
    if (typeof x !== "string") {
      out.push({ path: `${at}[${i}]`, message: "Each entry must be a string." });
      return;
    }
    if (seen.has(lower(x)))
      out.push({ path: `${at}[${i}]`, message: `${x} is listed twice.` });
    seen.add(lower(x));
    items.push(x);
  });
  return items;
}
function guardRegexIssue(regex) {
  if (regex.length === 0)
    return "regex is empty.";
  if (regex.length > GUARD_LIMITS.regexLength)
    return `regex is longer than ${GUARD_LIMITS.regexLength} characters.`;
  let i = 0;
  let prefix = 0;
  let seenAtom = false;
  let variable = 0;
  const quantifier = () => {
    const c = regex[i];
    if (c === "+" || c === "*" || c === "?") {
      i++;
      return "variable";
    }
    if (c !== "{")
      return null;
    const m = /^\{(\d{1,3})(,(\d{1,3})?)?\}/.exec(regex.slice(i));
    if (!m)
      throw new Error("A { must be a count like {32} or {16,64}.");
    i += m[0].length;
    const lo = Number(m[1]);
    if (m[2] === undefined)
      return lo === 0 ? null : "fixed";
    if (m[3] === undefined)
      throw new Error("An open count like {16,} is not allowed; give an upper bound.");
    if (Number(m[3]) < lo)
      throw new Error("A count's upper bound is below its lower bound.");
    return Number(m[3]) === lo ? "fixed" : "variable";
  };
  try {
    while (i < regex.length) {
      const c = regex[i];
      let literal = false;
      if (c === "[") {
        const end = regex.indexOf("]", i + 2);
        if (end === -1)
          return "a character class is not closed.";
        const body = regex.slice(i + 1, end);
        if (body.includes("[") || body.includes("\\"))
          return "a character class may hold only plain characters and ranges.";
        i = end + 1;
      } else if (c === "\\") {
        const n = regex[i + 1];
        if (n === undefined)
          return "regex ends with a backslash.";
        if (/[dws]/.test(n)) {
          i += 2;
        } else if (/[\\.\-_/+*?()[\]{}|^$]/.test(n)) {
          i += 2;
          literal = true;
        } else
          return `\\${n} is not allowed; use \\d, \\w, \\s or an escaped symbol.`;
      } else if ("()|^$".includes(c)) {
        return "groups, alternation and anchors are not allowed.";
      } else if ("+*?{}]".includes(c)) {
        return `${c} must follow a character or a class.`;
      } else if (c === ".") {
        i++;
      } else {
        i++;
        literal = true;
      }
      const q = quantifier();
      if (q === "variable")
        variable++;
      if (literal && q === null && !seenAtom)
        prefix++;
      else
        seenAtom = true;
    }
  } catch (e) {
    return e.message;
  }
  if (prefix < 3)
    return "regex must start with a literal prefix of at least 3 characters, like itk_.";
  if (variable > 1)
    return "regex may have at most one variable-length part (+, *, ? or {m,n}).";
  try {
    new RegExp(regex);
  } catch {
    return "regex does not compile.";
  }
  return null;
}
function validateGuard(doc, ctx = {}) {
  const out = [];
  if (!obj(doc))
    return [{ path: "", message: "guard.yaml must be a mapping at the top level." }];
  onlyKeys(doc, ["version", "protected_repos", "direct_push_allowed", "blocked_commands", "secret_patterns"], "", out);
  if (doc.version !== 1)
    out.push({ path: "version", message: "version must be 1." });
  const protectedRepos = stringList2(doc.protected_repos, "protected_repos", GUARD_LIMITS.repos, out);
  protectedRepos.forEach((r, i) => {
    if (!REPO.test(r) && !OWNER_WILDCARD.test(r))
      out.push({ path: `protected_repos[${i}]`, message: `${r} is not owner/name or owner/*.` });
  });
  const direct = stringList2(doc.direct_push_allowed, "direct_push_allowed", GUARD_LIMITS.repos, out);
  const protectedExact = new Set(protectedRepos.filter((r) => REPO.test(r)).map(lower));
  const protectedOwners = new Set(protectedRepos.filter((r) => OWNER_WILDCARD.test(r)).map((r) => lower(r.split("/")[0])));
  const gitops = ctx.gitopsRepo ? lower(ctx.gitopsRepo) : null;
  direct.forEach((r, i) => {
    const at = `direct_push_allowed[${i}]`;
    if (!REPO.test(r)) {
      out.push({ path: at, message: `${r} is not owner/name. Wildcards are not allowed here.` });
      return;
    }
    const key = lower(r);
    if (protectedExact.has(key) || protectedOwners.has(key.split("/")[0]))
      out.push({ path: at, message: `${r} is also protected. A repo cannot be both; the block wins, so remove it here.` });
    if (gitops !== null && key === gitops)
      out.push({ path: at, message: `${r} is the GitOps repo. Changes there go through Deliver, never a direct push.` });
  });
  if (doc.blocked_commands !== undefined) {
    if (!Array.isArray(doc.blocked_commands))
      out.push({ path: "blocked_commands", message: "blocked_commands must be a list." });
    else {
      if (doc.blocked_commands.length > GUARD_LIMITS.commands)
        out.push({ path: "blocked_commands", message: `blocked_commands has more than ${GUARD_LIMITS.commands} entries.` });
      doc.blocked_commands.forEach((c, i) => {
        const at = `blocked_commands[${i}]`;
        if (!obj(c)) {
          out.push({ path: at, message: "Each entry must have command and reason." });
          return;
        }
        onlyKeys(c, ["command", "reason"], at, out);
        if (!Array.isArray(c.command) || c.command.length === 0 || c.command.length > GUARD_LIMITS.commandWords || !c.command.every((w) => typeof w === "string" && WORD2.test(w))) {
          out.push({ path: `${at}.command`, message: `command must be a list of 1 to ${GUARD_LIMITS.commandWords} words, like [kubectl, delete].` });
        }
        if (typeof c.reason !== "string" || c.reason.trim().length === 0 || c.reason.length > GUARD_LIMITS.reasonLength) {
          out.push({ path: `${at}.reason`, message: `reason must be a sentence of up to ${GUARD_LIMITS.reasonLength} characters; the builder sees it.` });
        }
      });
    }
  }
  if (doc.secret_patterns !== undefined) {
    if (!Array.isArray(doc.secret_patterns))
      out.push({ path: "secret_patterns", message: "secret_patterns must be a list." });
    else {
      if (doc.secret_patterns.length > GUARD_LIMITS.patterns)
        out.push({ path: "secret_patterns", message: `secret_patterns has more than ${GUARD_LIMITS.patterns} entries.` });
      const names = new Set;
      doc.secret_patterns.forEach((p, i) => {
        const at = `secret_patterns[${i}]`;
        if (!obj(p)) {
          out.push({ path: at, message: "Each entry must have name and regex." });
          return;
        }
        onlyKeys(p, ["name", "regex"], at, out);
        if (typeof p.name !== "string" || !NAME.test(p.name))
          out.push({ path: `${at}.name`, message: "name must be lower-case letters, digits, - or _." });
        else if (names.has(p.name))
          out.push({ path: `${at}.name`, message: `${p.name} is listed twice.` });
        else
          names.add(p.name);
        if (typeof p.regex !== "string") {
          out.push({ path: `${at}.regex`, message: "regex must be a string." });
          return;
        }
        const issue = guardRegexIssue(p.regex);
        if (issue !== null)
          out.push({ path: `${at}.regex`, message: issue });
      });
    }
  }
  return out;
}

var lower2 = (s) => s.toLowerCase();
function effectiveGuard(config) {
  if (config.guard === null)
    return null;
  return validateGuard(config.guard, { gitopsRepo: config.gitopsRepo }).length === 0 ? config.guard : null;
}
function classifyRepo(repo, config) {
  const key = lower2(repo);
  const owner = key.split("/")[0];
  if (config.gitopsRepo !== null && key === lower2(config.gitopsRepo))
    return "protected";
  if (config.appRepos.some((r) => lower2(r) === key))
    return "protected";
  if (config.governanceRepo !== null && key === lower2(config.governanceRepo))
    return "governance";
  const guard = effectiveGuard(config);
  for (const p of guard?.protected_repos ?? []) {
    const k = lower2(p);
    if (k === key || k.endsWith("/*") && k.slice(0, -2) === owner)
      return "protected";
  }
  if (!config.owners.some((o) => lower2(o) === owner))
    return "outside";
  if ((guard?.direct_push_allowed ?? []).some((r) => lower2(r) === key))
    return "allowed";
  return "protected";
}
function ruleLayer(rule) {
  return rule === "blocked-command" || rule === "guardrails" || rule === "policy" ? "guard" : "floor";
}
function migrationRecord(text) {
  if (text === null)
    return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null)
    return null;
  const { original, appKey } = parsed;
  if (typeof original !== "string" || original.trim() === "")
    return null;
  return { original: normalizePath(original) || "/", appKey: typeof appKey === "string" ? appKey : null };
}
function normalizePath(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".")
      continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..")
        parts.pop();
      else if (!path.startsWith("/"))
        parts.push("..");
    } else
      parts.push(part);
  }
  return `${path.startsWith("/") ? "/" : ""}${parts.join("/")}`;
}
function insideFolder(folder, path) {
  const dir = normalizePath(folder) || "/";
  const p = normalizePath(path);
  return dir === "/" ? p.startsWith("/") : p === dir || p.startsWith(`${dir}/`);
}
function recordRefusal() {
  return {
    rule: "original-read-only",
    message: "The migration record (.dkod/migration.json) is what keeps the original app read only: leave it as it is. Run dkod-migrate.mjs clean <folder> after the shipped step to close the migration."
  };
}
function originalRefusal(original) {
  return {
    rule: "original-read-only",
    message: `The original app at ${original} is read only while a migration is open: you read it, you never change it or its data. Build in the dk- app's folder; to run the original's own tests, start it with the snapshot (dkod-migrate.mjs snapshot).`
  };
}
function parityRefusal() {
  return {
    rule: "parity-frozen",
    message: "The parity suite (tests/parity/) is frozen: its sha256 was reported with the run on the original, and a changed suite would not match it. To change it, run dkod-migrate.mjs unfreeze <folder> and start the attempt again (dkoder.migrate.start)."
  };
}
var DELIVER = "App code ships through Deliver (the dkoder.deliver tool), never a direct push or merge.";
function governanceMessage(repo) {
  return `${repo} is your org's governance repo. It changes only through the DKOD dashboard, by an org admin. Dkoder does not push, merge or write to it.`;
}
function describe(a) {
  if (a.kind === "push")
    return "git push";
  if (a.kind === "merge")
    return "gh pr merge";
  if (a.kind === "api-write")
    return "a gh api write";
  if (a.kind === "repo-write")
    return `gh repo ${a.cmd.argv.find((w, i) => i > 1 && !w.startsWith("-")) ?? "write"}`;
  return a.cmd.argv.slice(0, 2).join(" ");
}
function worst(repos, config) {
  const order = ["protected", "governance", "allowed", "outside"];
  let best = { cls: "outside", repo: null };
  for (const r of repos) {
    const cls = classifyRepo(r, config);
    if (order.indexOf(cls) < order.indexOf(best.cls))
      best = { cls, repo: r };
  }
  return best;
}
function matchesBlocked(argv, command) {
  if (argv.length === 0 || command.length === 0)
    return false;
  if (programName(argv[0]) !== command[0])
    return false;
  let want = 1;
  for (const w of argv.slice(1)) {
    if (want >= command.length)
      break;
    if (w === command[want])
      want += 1;
    else if (!w.startsWith("-"))
      return false;
  }
  return want >= command.length;
}
async function decideBash(cmds, config, resolver, seen = []) {
  const guard = effectiveGuard(config);
  const judged = (action, repo, org) => {
    seen.push({ action, repo, org });
    return true;
  };
  for (const cmd of cmds) {
    for (const b of guard?.blocked_commands ?? []) {
      if (matchesBlocked(cmd.argv, b.command) && judged("blocked-command", null, true))
        return { rule: "blocked-command", message: `${b.command.join(" ")} is blocked by your org's guard.yaml: ${b.reason}` };
    }
  }
  const queue = actionsOf(cmds);
  for (let expansions = 0;queue.length > 0; ) {
    const a = queue.shift();
    if (a.kind === "alias") {
      const value = resolver.alias === undefined ? undefined : await resolver.alias(a.tool, a.dir, a.name);
      if (value === null)
        continue;
      if (value === undefined) {
        const remotes = await resolver.repoRemotes(a.dir);
        const { cls, repo } = worst(remotes, config);
        if (remotes.length > 0 && cls === "outside")
          continue;
        judged("alias", repo, true);
        return { rule: "deliver-only", ...repo !== null ? { repo } : {}, message: `Dkoder could not tell what "${a.tool} ${a.name}" runs, so it did not run. Use the plain ${a.tool} command.` };
      }
      if ((expansions += 1) > 20 && judged("alias", null, true))
        return { rule: "no-hook-bypass", message: "This command expands too many aliases for Dkoder to read. Run the git or gh command directly." };
      queue.unshift(...expandAlias(a.tool, value, a.prefix, a.args, { ...a.cmd, cd: a.dir }));
      continue;
    }
    if (a.kind === "commit") {
      const { cls, repo } = worst(await resolver.repoRemotes(a.dir), config);
      judged("commit", repo, cls !== "outside");
      continue;
    }
    if (a.kind === "hook-bypass") {
      const remotes = await resolver.repoRemotes(a.dir);
      const { cls, repo } = worst(remotes, config);
      judged("hook-bypass", repo, remotes.length === 0 || cls !== "outside");
      if (remotes.length > 0 && cls === "outside")
        continue;
      return { rule: "no-hook-bypass", ...repo !== null ? { repo } : {}, message: `${a.how} is not allowed: it skips the checks your org runs before code leaves this machine.` };
    }
    if (a.kind === "push") {
      if (a.opaque !== null && config.owners.length > 0) {
        judged("push", null, true);
        return { rule: "deliver-only", message: `Dkoder cannot tell where this push goes (${a.opaque}). Run a plain git push, or ship with Deliver. ${DELIVER}` };
      }
      const targets = await resolver.pushTargets(a.dir, a.remote);
      const lineUrls = (a.also ?? []).map(repoFromRemoteUrl);
      const also = lineUrls.filter((r) => r !== null);
      if (a.lineRemote === true && config.owners.length > 0 && (targets === null && also.length === 0 || also.length < lineUrls.length)) {
        judged("push", null, true);
        return { rule: "deliver-only", message: `Dkoder cannot tell where this push goes: an earlier command in the same line makes the remote. Run the push as its own command, or ship with Deliver. ${DELIVER}` };
      }
      const repos = [...targets ?? await resolver.repoRemotes(a.dir), ...also];
      const { cls, repo } = worst(repos, config);
      judged("push", repo, cls !== "outside" || targets === null);
      if (targets === null && also.length === 0 && cls !== "outside") {
        return { rule: "deliver-only", ...repo !== null ? { repo } : {}, message: `Dkoder could not tell which repo this push goes to, and this folder has an org remote. ${DELIVER}` };
      }
      if (cls === "governance")
        return { rule: "deliver-only", repo, message: governanceMessage(repo) };
      if (cls === "protected") {
        if (a.force)
          return { rule: "no-force-push", repo, message: `Force push to ${repo} is not allowed. ${DELIVER}` };
        return { rule: "deliver-only", repo, message: `git push to ${repo} is not allowed. ${DELIVER}` };
      }
      continue;
    }
    if (a.repo === "unknown") {
      if (config.owners.length === 0)
        continue;
      judged(a.kind, null, true);
      const what = a.kind === "api-write" ? "GitHub API write" : describe(a);
      return { rule: "deliver-only", message: `Dkoder could not tell which repo this ${what} reaches, so it did not run. ${DELIVER}` };
    }
    const repos = a.repo !== null ? [a.repo] : await resolver.repoRemotes(a.dir);
    const { cls, repo } = worst(repos, config);
    judged(a.kind, repo, cls !== "outside");
    if (cls === "governance")
      return { rule: "deliver-only", repo, message: governanceMessage(repo) };
    if (cls === "protected")
      return { rule: "deliver-only", repo, message: `${describe(a)} on ${repo} is not allowed. ${DELIVER}` };
  }
  return null;
}
function commitTargets(cmds) {
  return actionsOf(cmds).flatMap((a) => a.kind === "commit" ? [{ dir: a.dir, all: a.all, message: a.message }] : []);
}
var MAX_SCAN_CHARS = 8 * 1024 * 1024;
function checkFile(path, content, config) {
  if (content.length > MAX_SCAN_CHARS) {
    return [{ rule: "no-secrets", message: `${path} is larger than ${String(MAX_SCAN_CHARS / 1024 / 1024)} MB, too large for Dkoder to check for secrets. Keep large data out of the repo.` }];
  }
  const text = content;
  const out = [];
  const findings = checkGuardrails({ files: [{ path, content: text }], templatePaths: [] });
  for (const f of findings) {
    out.push({ rule: f.rule === "no-plaintext-secrets" ? "no-secrets" : "guardrails", message: `${f.rule}: ${f.message}`, ...f.line !== undefined ? { line: f.line } : {} });
  }
  const guard = effectiveGuard(config);
  for (const p of guard?.secret_patterns ?? []) {
    if (guardRegexIssue(p.regex) !== null)
      continue;
    const re = new RegExp(p.regex, "g");
    const m = re.exec(text);
    if (m) {
      const line = text.slice(0, m.index).split(`
`).length;
      out.push({ rule: "no-secrets", line, message: `no-plaintext-secrets: ${path} line ${String(line)} matches your org's secret pattern ${p.name}. Put the NAME of a secret there and resolve it at run time.` });
    }
  }
  if (config.policyPack !== undefined && config.policyPack.rules.length > 0) {
    for (const f of evaluate(config.policyPack, [{ path, text }], { stage: "write" }).findings) {
      if (f.level === "block")
        out.push(policyRefusal(f));
    }
  }
  return out;
}
function policyRefusal(f) {
  const where = f.path === null ? "" : f.line === null ? `${f.path}: ` : `${f.path} line ${String(f.line)}: `;
  return {
    rule: "policy",
    check: f.check,
    message: `${f.rule}: ${where}${f.message}. Change the code so it follows the rule.`,
    ...f.line !== null ? { line: f.line } : {},
    ...CATALOG[f.check].byName === true && f.line === null ? { wholeFile: true } : {}
  };
}
function checkCommitMessage(message, config) {
  if (message === null || config.policyPack === undefined || config.policyPack.rules.length === 0)
    return [];
  return evaluateCommit(config.policyPack, message).findings.filter((f) => f.level === "block").map(policyRefusal);
}
function newFindings(path, before, after, config) {
  const found = checkFile(path, after, config);
  if (before === null || found.length === 0)
    return found;
  const lineText = (text, line) => line === undefined ? "" : text.split(`
`)[line - 1] ?? "";
  const key = (f, text) => `${f.rule}\x00${f.check ?? ""}\x00${lineText(text, f.line)}`;
  const old = new Set(checkFile(path, before, config).map((f) => key(f, before)));
  return found.filter((f) => f.wholeFile === true || !old.has(key(f, after)));
}
var SHIP_VERB = /\b(?:git\s+push|gh\s+pr\s+merge|force[- ]?push(?:ed|ing)?|push(?:ed|ing)?|merg(?:e|ed|ing))\b/i;
var SHIP_DIRECT = /\b(?:main|master|trunk|default\s+branch|directly|direct|straight|right\s+away|--admin|admin\s+merge|without\s+(?:a\s+)?(?:pr|pull\s+request|review|deliver))\b/i;
function asksDirectShip(text) {
  const t = text.slice(0, 20000);
  if (/\bgh\s+pr\s+merge\b/i.test(t) || /\bforce[- ]?push/i.test(t) || /\bgit\s+push\b[^\n]*(?:--force|-f\b)/i.test(t))
    return true;
  return SHIP_VERB.test(t) && SHIP_DIRECT.test(t);
}

var POLICY_CHECK_TOOL = "policy_check";
var POLICY_CHECK_TOOL_FULL = `mcp__dkod__${POLICY_CHECK_TOOL}`;
var POLICY_CHECK_SPEC = {
  name: POLICY_CHECK_TOOL,
  description: "Run your organization's policy checks on an app folder on this computer: every check of the org's rules, the ones that read one file and the ones that need the whole folder. The code stays here; only the findings come back (file, line, rule, what to change). Run it before dkoder.deploy or dkoder.deliver. Fix every block finding and run it again. Tell the person about each warn finding.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The app's folder: absolute, or relative to the session's folder. Default: the session's folder." }
    },
    additionalProperties: false
  },
  isDeferred: false
};
var MAX_FOLDER_FILES = 5000;
var MAX_READ_BYTES = 64 * 1024 * 1024;
var MAX_SHOWN = 50;
var refuse2 = (error, message) => ({ ok: false, error, message });
function packSummary(pack) {
  const lines = [];
  for (const r of pack.rules) {
    const titles = new Set;
    for (const c of r.checks) {
      const level = c.level ?? r.level;
      if (level !== "off")
        titles.add(`${CATALOG[c.use].title}${level === "warn" ? " (warn)" : ""}`);
    }
    if (titles.size > 0)
      lines.push(`- ${r.name}: ${[...titles].join("; ")}`);
  }
  return lines.join(`
`);
}
async function checkFolder(pack, dir, io) {
  if (!pack || pack.rules.length === 0) {
    return { ok: true, folder: dir, files: 0, skipped: 0, checked: 0, blocked: false, findings: [], summary: "", next: "Your organization's rules have no checks yet. Nothing to fix." };
  }
  const listed = await io.list(dir).catch(() => null);
  if (listed === null)
    return refuse2("cannot_list", "Dkoder could not list the files of that folder. Check the path, then try again.");
  if (listed.length > MAX_FOLDER_FILES)
    return refuse2("too_many_files", `That folder has more than ${String(MAX_FOLDER_FILES)} files. Run the check on the app's own folder.`);
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

var STUBS = new Set(["git", "python3"]);
async function which(host, dirs, name) {
  for (const dir of dirs)
    if (await host.exists(`${dir}/${name}`).catch(() => false))
      return dir;
  return null;
}
async function realTool(host, tool) {
  if (!STUBS.has(tool) || host.path === undefined)
    return true;
  const path = await host.path().catch(() => {
    return;
  }) ?? "";
  const dirs = path.split(":").filter((d) => d !== "").map((d) => d.replace(/\/+$/, "") || "/");
  if (await which(host, dirs, tool) !== "/usr/bin")
    return true;
  const select = await which(host, dirs, "xcode-select");
  if (select === null)
    return true;
  const r = await host.run([`${select}/xcode-select`, "-p"], { timeoutMs: 5000 }).catch(() => null);
  if (r === null)
    return true;
  const developer = r.exitCode === 0 ? r.stdout.trim() : "";
  return developer !== "" && await host.exists(`${developer}/usr/bin/${tool}`).catch(() => false);
}
async function runReal(host, argv, init, known) {
  const tool = argv[0] ?? "";
  if (STUBS.has(tool)) {
    let real = known.get(tool);
    if (real === undefined)
      known.set(tool, real = realTool(host, tool));
    if (!await real)
      return { exitCode: 127, stdout: "", stderr: `${tool}: only the macOS stub is installed, so it did not run` };
  }
  return host.run(argv, init);
}

var EMPTY = { owners: [], governanceRepo: null, gitopsRepo: null, appRepos: [], guard: null };
var strings = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
var str = (v) => typeof v === "string" && v.length > 0 ? v : null;
function configFrom(v) {
  if (typeof v !== "object" || v === null)
    return EMPTY;
  const o = v;
  const pack = o.policyPack === undefined || o.policyPack === null ? null : readPack(o.policyPack);
  return {
    owners: strings(o.owners),
    governanceRepo: str(o.governanceRepo),
    gitopsRepo: str(o.gitopsRepo),
    appRepos: strings(o.appRepos),
    guard: typeof o.guard === "object" && o.guard !== null ? o.guard : null,
    ...typeof o.policyText === "string" ? { policyText: o.policyText } : {},
    ...pack !== null && pack.rules.length > 0 ? { policyPack: pack } : {},
    ...typeof o.governanceSha === "string" && /^[0-9a-f]{40}$/.test(o.governanceSha) ? { governanceSha: o.governanceSha } : {}
  };
}
function mergeConfig(base, live, trusted = true) {
  if (live === null)
    return base;
  if (!trusted) {
    const guard = live.guard === null ? null : { ...live.guard };
    if (guard !== null)
      delete guard.direct_push_allowed;
    live = { ...live, governanceRepo: null, guard };
  }
  const union = (a, b) => [...new Set([...a, ...b].map((s) => s.toLowerCase()))];
  return {
    owners: union(base.owners, live.owners),
    governanceRepo: base.governanceRepo ?? live.governanceRepo,
    gitopsRepo: live.gitopsRepo ?? base.gitopsRepo,
    appRepos: union(base.appRepos, live.appRepos),
    guard: live.guard ?? base.guard,
    ...live.policyText ?? base.policyText ? { policyText: live.policyText ?? base.policyText } : {},
    ...live.policyPack ?? base.policyPack ? { policyPack: live.policyPack ?? base.policyPack } : {},
    ...live.governanceSha ?? base.governanceSha ? { governanceSha: live.governanceSha ?? base.governanceSha } : {}
  };
}
function rulesText(config) {
  const lines = [
    "# Dkoder (DKOD's floor, the same for every organization)",
    "Dkoder checks every command and file write.",
    "- App code ships through Deliver (the dkoder.deliver tool of the DKOD MCP server). Never git push, gh pr merge or write through the GitHub API to an app repo of the organization.",
    "- Never write a secret value into a file, and never commit one. Put the NAME of a secret in the file and resolve it at run time.",
    "- Never skip git hooks (--no-verify, core.hooksPath) and never force push to an organization repo.",
    "- When Dkoder or Guard refuses a call, tell the person why and take the DKOD path instead. Do not try another way around it."
  ];
  if (config.governanceRepo !== null)
    lines.push(`- The governance repo ${config.governanceRepo} changes only through the DKOD dashboard, by an org admin. Never push, merge or write to it from here.`);
  if (config.policyText)
    lines.push("", "## Guard: your organization's policy", config.policyText);
  if (config.policyPack) {
    lines.push("", "## Guard: the checks of your organization's rules", "Dkoder runs these checks on every file write and commit, and refuses one that breaks a check at level block. Write code that passes them from the start.", `Before you deploy, run the tool ${POLICY_CHECK_TOOL_FULL} on the app's folder. Fix every block finding, then tell the person about each warn finding.`, packSummary(config.policyPack));
  }
  return lines.join(`
`);
}
var PATH_KEYS = ["file_path", "notebook_path", "path", "filePath", "filename", "file_name", "file", "target_file", "targetFile", "destination", "dest", "uri"];
var CONTENT_KEYS = ["content", "contents", "file_text", "fileText", "text", "data", "body", "new_source", "code"];
var NEW_KEYS = ["new_string", "new_str", "newText", "new_text", "insert_text", "replacement"];
var OLD_KEYS = ["old_string", "old_str", "oldText", "old_text"];
function writeShape(e) {
  const pick = (keys, from = e) => {
    for (const k of keys)
      if (typeof from[k] === "string")
        return from[k];
    return null;
  };
  const target = pick(PATH_KEYS);
  const cell = typeof e.new_source === "string";
  const content = pick(CONTENT_KEYS);
  const edits = [];
  if (Array.isArray(e.edits)) {
    for (const x of e.edits) {
      if (typeof x !== "object" || x === null)
        continue;
      const r = x;
      const n = pick(NEW_KEYS, r);
      if (n !== null)
        edits.push({ old_string: pick(OLD_KEYS, r) ?? "", new_string: n, replace_all: r.replace_all === true });
    }
  } else {
    const n = pick(NEW_KEYS);
    if (n !== null)
      edits.push({ old_string: pick(OLD_KEYS) ?? "", new_string: n, replace_all: e.replace_all === true });
  }
  if (content === null && edits.length === 0)
    return null;
  if (target === null && content !== null && edits.length === 0 && !["content", "contents", "file_text", "fileText", "code"].some((k) => typeof e[k] === "string"))
    return null;
  return { target, content, edits, cell };
}
function dirname(p) {
  const i = p.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}
function createGuard(initial) {
  let config = initial?.config ?? EMPTY;
  let install = initial?.install ?? {};
  let loaded = initial?.config !== undefined;
  let device = "none";
  const tools = new Map;
  const run = (io, argv, init) => runReal(io, argv, init, tools);
  const git = async (io, cwd, args) => {
    try {
      const r = await run(io, ["git", "-C", cwd, ...args], { timeoutMs: 1e4 });
      return r.exitCode === 0 ? r.stdout : null;
    } catch {
      return null;
    }
  };
  const absolute = async (io, dir) => {
    const base = await io.cwd();
    if (dir.startsWith("/"))
      return dir;
    if (dir === "~" || dir.startsWith("~/"))
      return `${await io.home() ?? ""}${dir.slice(1)}`;
    return dir === "" ? base : `${base.replace(/\/$/, "")}/${dir}`;
  };
  const reposOf = (urls) => [...new Set(urls.split(`
`).map((l) => repoFromRemoteUrl(l.trim().split(/\s+/)[1] ?? l.trim())).filter((r) => r !== null))];
  const resolver = (io) => ({
    async alias(tool, dir, name) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))
        return;
      try {
        const cwd = await absolute(io, dir);
        if (tool === "git") {
          const r = await run(io, ["git", "-C", cwd, "config", "--get", `alias.${name}`], { timeoutMs: 1e4 });
          if (r.exitCode === 1 && r.stdout === "")
            return null;
          return r.exitCode === 0 ? r.stdout.replace(/\n$/, "") : undefined;
        }
        const r = await io.run(["gh", "alias", "list"], { cwd, timeoutMs: 1e4 });
        if (r.exitCode !== 0)
          return /no aliases configured/i.test(r.stderr + r.stdout) ? null : undefined;
        const line = r.stdout.split(`
`).find((l) => l.startsWith(`${name}:`));
        return line === undefined ? null : line.slice(name.length + 1).trim().replace(/^'(.*)'$/, "$1");
      } catch {
        return;
      }
    },
    async repoRemotes(dir) {
      const out = await git(io, await absolute(io, dir), ["remote", "-v"]);
      return out === null ? [] : reposOf(out);
    },
    async pushTargets(dir, remote) {
      const cwd = await absolute(io, dir);
      let name = remote;
      if (name === null) {
        const up = await git(io, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{push}"]);
        name = up !== null && up.includes("/") ? up.trim().split("/")[0] : (await git(io, cwd, ["config", "--get", "remote.pushDefault"]))?.trim() || "origin";
      }
      const found = new Set;
      if (!name.includes(":") && !name.includes("/")) {
        const urls = await git(io, cwd, ["remote", "get-url", "--push", "--all", name]);
        if (urls !== null)
          for (const r of reposOf(urls))
            found.add(r);
      } else {
        const direct = repoFromRemoteUrl(name);
        if (direct !== null)
          found.add(direct);
      }
      const expanded = await git(io, cwd, ["ls-remote", "--get-url", name]);
      if (expanded !== null) {
        const r = repoFromRemoteUrl(expanded.trim());
        if (r !== null)
          found.add(r);
      }
      if (found.size === 0)
        return name.startsWith("/") || name.startsWith(".") ? [] : null;
      return [...found];
    }
  });
  const load = async (io) => {
    if (loaded)
      return config;
    let file = {};
    try {
      file = JSON.parse(await io.read(`${io.root}/dkoder.json`));
    } catch {
      file = {};
    }
    install = file;
    const baked = configFrom(file);
    let live = null;
    let trusted = true;
    device = "none";
    if (file.dashboardUrl && file.token) {
      device = "offline";
      try {
        const id = typeof file.deviceId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(file.deviceId) ? `?device=${encodeURIComponent(file.deviceId)}` : "";
        const r = await io.fetch(`${file.dashboardUrl.replace(/\/$/, "")}/api/v1/dkoder/config${id}`, { headers: { authorization: `Bearer ${file.token}` } });
        if (r.status === 401 || r.status === 403)
          device = "refused";
        if (r.ok) {
          live = configFrom(JSON.parse(r.text));
          await io.keepConfig(live);
          device = "ok";
        }
      } catch {
        live = null;
      }
    }
    if (live === null && !file.token && io.mcpConfig) {
      try {
        const answer = await io.mcpConfig();
        if (typeof answer === "object" && answer !== null && answer.enabled === true) {
          live = configFrom(answer);
          await io.keepConfig(live);
          await io.keepHookConfig?.({ owners: live.owners, appRepos: live.appRepos })?.catch(() => {
            return;
          });
        }
      } catch {
        live = null;
      }
    }
    if (live === null) {
      try {
        const kept = await io.keptConfig();
        if (kept !== undefined) {
          live = configFrom(kept);
          trusted = false;
        }
      } catch {
        live = null;
      }
    }
    config = mergeConfig(baked, live, trusted);
    loaded = true;
    return config;
  };
  const send = (io, event) => {
    if (event.kind === "action")
      io.pulse?.(event.decision, pulseText(event.decision, event.action, event.repo));
    if (!install.dashboardUrl || !install.token)
      return;
    const device = typeof install.deviceId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(install.deviceId) ? { device: install.deviceId } : {};
    const body = JSON.stringify({ ...event, ...device, agent: "claude-code", at: new Date().toISOString() });
    io.fetch(`${install.dashboardUrl.replace(/\/$/, "")}/api/v1/dkoder/events`, { method: "POST", headers: { authorization: `Bearer ${install.token}`, "content-type": "application/json" }, body }).catch(() => {
      return;
    });
  };
  const report = (io, tool, r, action) => send(io, { kind: "action", action, decision: "blocked", rule: r.rule, repo: r.repo ?? null, tool });
  const allowed = (io, tool, j) => {
    if (j.org)
      send(io, { kind: "action", action: j.action, decision: "allowed", rule: null, repo: j.repo, tool });
  };
  const refuse = (io, tool, found, action) => {
    for (const r of found)
      report(io, tool, r, action);
    const shown = found.slice(0, 5).map((r) => `- ${ruleLayer(r.rule) === "guard" ? "Guard, your organization's rule" : "Dkoder floor"}: ${r.message}`);
    if (found.length > 5)
      shown.push(`- and ${String(found.length - 5)} more.`);
    return { deny: `${refusedBy(found)}
${shown.join(`
`)}
Do not try another way to run it. Tell the person why, and offer the allowed way above.` };
  };
  const rootOf = async (io, path) => {
    let dir = dirname(path);
    for (let i = 0;i < 40 && dir !== "/"; i += 1) {
      if (await io.exists(dir)) {
        const top = await git(io, dir, ["rev-parse", "--show-toplevel"]);
        return top === null ? null : top.trim();
      }
      dir = dirname(dir);
    }
    return null;
  };
  const outside = async (io, root, cfg) => {
    if (root === null)
      return false;
    const remotes = await resolver(io).repoRemotes(root);
    return remotes.length > 0 && remotes.every((r) => classifyRepo(r, cfg) === "outside");
  };
  const relative = async (io, root, path) => {
    const base = root ?? await io.cwd();
    const prefix = `${base.replace(/\/$/, "")}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path.split("/").pop() ?? path;
  };
  const readOrNull = async (io, path) => {
    try {
      return await io.exists(path) ? await io.read(path) : null;
    } catch {
      return null;
    }
  };
  const recordFile = async (io) => `${(await io.cwd()).replace(/\/$/, "")}/.dkod/migration.json`;
  const migration = async (io) => {
    return migrationRecord(await readOrNull(io, await recordFile(io)));
  };
  const frozenSuite = async (io) => {
    const cwd = (await io.cwd()).replace(/\/$/, "");
    return await readOrNull(io, `${cwd}/.dkod/parity/freeze.json`) === null ? null : `${cwd}/tests/parity`;
  };
  const checkWrite = async (io, e, seen = []) => {
    const shape = writeShape(e);
    if (shape === null) {
      const named = PATH_KEYS.map((k) => e[k]).find((v) => typeof v === "string");
      if (named === undefined)
        return [];
      const path = named.startsWith("/") ? named : await absolute(io, named);
      const suite = await frozenSuite(io);
      if (suite !== null && insideFolder(suite, path))
        return [parityRefusal()];
      if (await migration(io) === null)
        return [];
      return insideFolder(dirname(await recordFile(io)), path) ? [recordRefusal()] : [];
    }
    const { target, content, edits, cell } = shape;
    const cfg = await load(io);
    if (target === null)
      return newFindings(`${e.tool}.txt`, null, content ?? edits.map((ed) => ed.new_string).join(`
`), cfg);
    const path = target.startsWith("/") ? target : await absolute(io, target);
    const suite = await frozenSuite(io);
    if (suite !== null && insideFolder(suite, path))
      return [parityRefusal()];
    const record = await migration(io);
    if (record !== null && insideFolder(record.original, path))
      return [originalRefusal(record.original)];
    if (record !== null) {
      const file = await recordFile(io);
      if (normalizePath(path) === normalizePath(file)) {
        const next = content === null ? null : migrationRecord(content);
        if (next === null || next.original !== record.original)
          return [recordRefusal()];
      } else if (insideFolder(dirname(file), path))
        return [recordRefusal()];
    }
    const root = await rootOf(io, path);
    const remotes = root === null ? [] : await resolver(io).repoRemotes(root);
    if (remotes.length > 0 && remotes.every((r) => classifyRepo(r, cfg) === "outside"))
      return [];
    seen.push({ action: "write", repo: remotes.find((r) => classifyRepo(r, cfg) !== "outside") ?? null, org: true });
    const rel = await relative(io, root, path);
    const before = await readOrNull(io, path);
    if (cell)
      return newFindings(rel, null, content, cfg);
    if (content !== null)
      return newFindings(rel, before, content, cfg);
    let after = before ?? "";
    for (const ed of edits) {
      if (ed.old_string === "" || !after.includes(ed.old_string))
        return newFindings(rel, null, ed.new_string, cfg);
      after = ed.replace_all ? after.split(ed.old_string).join(ed.new_string) : after.replace(ed.old_string, () => ed.new_string);
    }
    return newFindings(rel, before, after, cfg);
  };
  const MAX_COMMIT_FILES = 2000;
  const tooMany = (n) => ({ rule: "no-secrets", message: `This commit takes ${String(n)} files, more than Guard checks at once (${String(MAX_COMMIT_FILES)}). Commit in smaller parts.` });
  const checkCommit = async (io, command) => {
    const cmds = parseCommands(command);
    const targets = commitTargets(cmds);
    if (targets.length === 0)
      return [];
    const cfg = await load(io);
    const adds = cmds.length > 1 || cmds.some((c) => c.argv.includes("add"));
    const out = [];
    for (const t of targets) {
      const top = await git(io, await absolute(io, t.dir), ["rev-parse", "--show-toplevel"]);
      if (top === null)
        continue;
      const root = top.trim();
      if (await outside(io, root, cfg))
        continue;
      out.push(...checkCommitMessage(t.message, cfg));
      const staged = (await git(io, root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]) ?? "").split("\x00").filter(Boolean);
      const seen = new Set;
      if (staged.length > MAX_COMMIT_FILES)
        return [tooMany(staged.length)];
      for (const file of staged) {
        seen.add(file);
        const text = await git(io, root, ["show", `:${file}`]);
        if (text !== null && !text.includes("\x00"))
          out.push(...newFindings(file, null, text, cfg));
      }
      if (t.all || adds) {
        const changed = (await git(io, root, ["ls-files", "-m", "-o", "--exclude-standard", "-z"]) ?? "").split("\x00").filter(Boolean);
        if (changed.length > MAX_COMMIT_FILES)
          return [tooMany(changed.length)];
        for (const file of changed) {
          if (seen.has(file))
            continue;
          const text = await readOrNull(io, `${root}/${file}`);
          if (text !== null && !text.includes("\x00"))
            out.push(...newFindings(file, null, text, cfg));
        }
      }
    }
    return out;
  };
  const sessionStart = async (io, cwd) => {
    const cfg = await load(io);
    const remotes = await resolver(io).repoRemotes(cwd);
    const protectedRepo = remotes.find((r) => classifyRepo(r, cfg) === "protected");
    const orgRepo = remotes.find((r) => classifyRepo(r, cfg) !== "outside");
    send(io, { kind: "session", repo: orgRepo ?? null });
    const guardOn = cfg.owners.length > 0 ? "on, Guard on" : "on";
    io.status(protectedRepo !== undefined ? `Dkoder: ${guardOn} · ${protectedRepo.split("/")[1]}, Deliver required` : `Dkoder: ${guardOn}`);
  };
  const promptNote = async (io, text) => {
    if (!asksDirectShip(text))
      return null;
    const cfg = await load(io);
    const remotes = await resolver(io).repoRemotes(await io.cwd());
    const named = [...cfg.appRepos, ...cfg.gitopsRepo !== null ? [cfg.gitopsRepo] : []].filter((r) => text.toLowerCase().includes(r.toLowerCase()));
    const repo = [...remotes, ...named].find((r) => classifyRepo(r, cfg) === "protected");
    if (repo === undefined)
      return null;
    send(io, { kind: "action", action: "direct-ship-request", decision: "declined", rule: "deliver-only", repo, tool: "prompt" });
    return [
      `Dkoder: this message asks to push or merge code directly. ${repo} is an app repo of your organization, and your organization's rules (with DKOD's floor) do not allow that.`,
      DELIVER,
      "Do the rest of the work. Do not run git push, gh pr merge or a GitHub API write for it: Dkoder refuses them. Tell the person, in one or two sentences, why it will not be pushed or merged directly, and offer Deliver."
    ].join(`
`);
  };
  const promptSection = async (io) => ({ id: "dkod", text: rulesText(await load(io)), scope: "session" });
  const failClosed = async (tool, check) => {
    try {
      return await check();
    } catch (err) {
      return { deny: `Dkoder could not check this ${tool} call (${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}), so it did not run. Try again; if it keeps failing, tell your DKOD admin.` };
    }
  };
  const bash = (io, command) => failClosed("Bash", () => bashCheck(io, command));
  const bashCheck = async (io, command) => {
    const cfg = await load(io);
    const cmds = parseCommands(command);
    const suite = await frozenSuite(io);
    if (suite !== null && changesOriginal(suite, await io.cwd(), await io.home() ?? "", cmds))
      return refuse(io, "Bash", [parityRefusal()], "write");
    const record = await migration(io);
    if (record !== null) {
      const base = await io.cwd();
      const home = await io.home() ?? "";
      if (changesOriginal(record.original, base, home, cmds))
        return refuse(io, "Bash", [originalRefusal(record.original)], "write");
      if (changesOriginal(dirname(await recordFile(io)), base, home, cmds))
        return refuse(io, "Bash", [recordRefusal()], "write");
    }
    const seen = [];
    const blocked = await decideBash(cmds, cfg, resolver(io), seen);
    if (blocked !== null)
      return refuse(io, "Bash", [blocked], seen[seen.length - 1]?.action ?? "command");
    const secrets = await checkCommit(io, command);
    if (secrets.length > 0)
      return refuse(io, "Bash", secrets, "commit");
    for (const j of seen)
      allowed(io, "Bash", j);
    return null;
  };
  const write = (io, e) => failClosed(e.tool, async () => {
    const seen = [];
    const found = await checkWrite(io, e, seen);
    const repo = seen[0]?.repo ?? undefined;
    if (found.length > 0)
      return refuse(io, e.tool, found.map((f) => f.repo === undefined && repo !== undefined ? { ...f, repo } : f), "write");
    for (const j of seen)
      allowed(io, e.tool, j);
    return null;
  });
  const deviceState = () => device;
  const afterSignIn = async (io) => {
    if (install.token)
      return;
    loaded = false;
    await load(io);
    await sessionStart(io, await io.cwd());
  };
  let seenVersion = null;
  const refresh = async (io) => {
    if (!loaded)
      return;
    let answer;
    if (install.dashboardUrl && install.token) {
      const r = await io.fetch(`${install.dashboardUrl.replace(/\/$/, "")}/api/v1/dkoder/config/version`, { headers: { authorization: `Bearer ${install.token}` } }).catch(() => null);
      answer = r?.ok ? JSON.parse(r.text) : undefined;
    } else if (io.mcpVersion)
      answer = await io.mcpVersion().catch(() => {
        return;
      });
    const sha = answer?.governanceSha;
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha) || sha === config.governanceSha || sha === seenVersion)
      return;
    seenVersion = sha;
    const before = config;
    loaded = false;
    await load(io);
    if (config.governanceSha !== sha)
      config = before;
  };
  return { sessionStart, promptSection, promptNote, bash, write, load, checkWrite, checkCommit, resolver, deviceState, afterSignIn, refresh, run };
}
function refusedBy(found) {
  const layers = new Set(found.map((r) => ruleLayer(r.rule)));
  if (layers.size > 1)
    return "Dkoder refused this, by DKOD's floor and your organization's Guard rules.";
  return layers.has("guard") ? "Guard refused this, by your organization's rules." : "Dkoder refused this, by DKOD's floor (the rules every organization has).";
}
var DKODER_DIR = ".dkoder";
var DKODER_FILES_DENY = `Dkoder refused this: it touches Dkoder's own files (${DKODER_DIR}). Leave them alone.`;
var WRITERS = new Set(["cp", "mv", "tee", "touch", "mkdir", "rm", "rmdir", "ln", "install", "rsync", "truncate", "chmod", "chown", "chflags", "dd", "sed", "unzip", "tar", "ditto"]);
var INTERPRETERS = new Set(["python", "python3", "node", "bun", "deno", "perl", "ruby", "osascript"]);
function inDkoderDir(word) {
  if (/\s/.test(word))
    return false;
  const p = word.replace(/\\/g, "/").replace(/\/+$/, "");
  return p === DKODER_DIR || p.endsWith(`/${DKODER_DIR}`) || p.startsWith(`${DKODER_DIR}/`) || p.includes(`/${DKODER_DIR}/`);
}
var underCd = (cd, word) => cd === "" || word.startsWith("/") || word.startsWith("~") ? word : `${cd}/${word}`;
function touchesDkoderFiles(e) {
  for (const path of [e.file_path, e.notebook_path, e.path])
    if (typeof path === "string" && inDkoderDir(path))
      return true;
  if (typeof e.command !== "string" || !e.command.includes(DKODER_DIR))
    return false;
  for (const cmd of parseCommands(e.command)) {
    if (inDkoderDir(cmd.cd))
      return true;
    if ((cmd.writes ?? []).some((w) => inDkoderDir(underCd(cmd.cd, w))))
      return true;
    const program = programName(cmd.argv[0] ?? "");
    const args = cmd.argv.slice(1);
    if (WRITERS.has(program) && args.some((a) => inDkoderDir(underCd(cmd.cd, a))))
      return true;
    if (INTERPRETERS.has(program) && args.some((a) => a.includes(DKODER_DIR)))
      return true;
  }
  return false;
}
var INSTALLERS = new Set(["npm", "yarn", "pnpm", "bun", "pip", "pip3", "poetry", "cargo", "go", "composer"]);
var INSTALL_WORDS = new Set(["install", "i", "add", "ci", "update", "upgrade", "up", "link", "uninstall", "un", "remove", "rm", "prune", "dedupe", "rebuild", "get"]);
var PATH_FLAGS = new Set(["--prefix", "--cwd", "-C", "--dir", "--cd", "--directory", "--manifest-path", "--workspace", "-w"]);
var VALUE_FLAGS = new Set([...PATH_FLAGS, "--filter", "-F", "--registry", "--cache", "--userconfig", "--python", "--target", "--package", "-p", "--loglevel"]);
var runsInstall = (program, args) => {
  if (!INSTALLERS.has(program))
    return false;
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("+"))
      continue;
    if (a.startsWith("-")) {
      if (VALUE_FLAGS.has(a) && !(a === "-w" && INSTALL_WORDS.has(args[i + 1] ?? "")))
        i++;
      continue;
    }
    if (program === "yarn" && a === "workspace") {
      i++;
      continue;
    }
    return INSTALL_WORDS.has(a);
  }
  return false;
};
var GIT_LOOK = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files"]);
function changesOriginal(original, base, home, cmds) {
  const inside = (path) => insideFolder(original, path);
  const full = (cd, word) => {
    const here = cd === "" ? base : cd.startsWith("/") ? cd : cd.startsWith("~") ? `${home}${cd.slice(1)}` : `${base.replace(/\/$/, "")}/${cd}`;
    if (word.startsWith("/"))
      return word;
    if (word.startsWith("~"))
      return `${home}${word.slice(1)}`;
    return `${here.replace(/\/$/, "")}/${word}`;
  };
  for (const cmd of cmds) {
    const program = programName(cmd.argv[0] ?? "");
    const args = cmd.argv.slice(1);
    if ((cmd.writes ?? []).some((w) => inside(full(cmd.cd, w))))
      return true;
    const here = full(cmd.cd, ".");
    if (WRITERS.has(program) && (inside(here) || args.some((a) => inside(full(cmd.cd, a)))))
      return true;
    if (program === "git") {
      let i = 0;
      let dir = here;
      while (i < args.length && (args[i] === "-C" || args[i] === "-c")) {
        if (args[i] === "-C" && args[i + 1] !== undefined)
          dir = full(cmd.cd, args[i + 1]);
        i += 2;
      }
      if (inside(dir) && !GIT_LOOK.has(args[i] ?? ""))
        return true;
    }
    const installs = runsInstall(program, args);
    if (installs && (inside(here) || args.some((a) => inside(full(cmd.cd, a.replace(/^--[\w-]+=/, ""))))))
      return true;
  }
  return false;
}
var AUTH = { plugin: "dkod", key: "auth" };
var FRAME = { plugin: "dkod", key: "frame" };
var PULSE = { plugin: "dkod", key: "pulse" };
var PULSE_FRAME = { plugin: "dkod", key: "pulseFrame" };
var STATUS = { plugin: "dkod", key: "status" };
var AUTH_EVERY_TICKS = Math.round(20000 / TICK_MS);
var AUTH_OUT_EVERY_TICKS = Math.round(1000 / TICK_MS);
var HEARTBEAT_EVERY_TICKS = Math.round(5000 / TICK_MS);
var RULES_EVERY_MS = 10 * 60000;
var RULES_EVERY_TICKS = Math.round(RULES_EVERY_MS / TICK_MS);
function failedCheck(next) {
  const kind = next.error?.kind;
  return kind === "throw" || kind === "timeout";
}
var timedOut = (tool) => `Dkoder could not finish checking this ${tool} call in time, so it did not run. Try again; if it keeps failing, tell your DKOD admin.`;
function deviceFacts(id, home, pluginVersion, agentVersion) {
  const short = (v) => typeof v === "string" && /^[A-Za-z0-9_.+-]{1,64}$/.test(v) ? v : null;
  const os = home === undefined ? null : home.startsWith("/Users/") ? "macos" : home.startsWith("/home/") || home === "/root" ? "linux" : /^[A-Za-z]:/.test(home) ? "windows" : null;
  return { id, os, pluginVersion: short(pluginVersion), agentVersion: short(agentVersion) };
}
var NOTE_SECTION = "dkod-request";
var STALE_SECTION = "dkod-stale-tools";
function callShape(e) {
  const sorted = (v) => Array.isArray(v) ? v.map(sorted) : typeof v === "object" && v !== null ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  const { tool_use_id: _id, consent: _consent, ...rest } = e;
  return JSON.stringify(sorted(rest));
}
function passedCalls(size = 64) {
  const shapes = [];
  return {
    remember(e) {
      shapes.push(callShape(e));
      if (shapes.length > size)
        shapes.shift();
    },
    seen(e) {
      const i = shapes.indexOf(callShape(e));
      if (i < 0)
        return false;
      shapes.splice(i, 1);
      return true;
    }
  };
}
var DKOD_MCP_TOOL = /^mcp__(?:plugin_dkod_)?dkod__dkoder_/;
var STALE_TOOLS_NOTE = "Your dkod tool list is older than the DKOD server: a tool or a field may be missing or changed. Ask the person to type /mcp, pick dkod, then Reconnect. If they reconnected already, go on.";
var TOOLS_CHECK_MS = 2 * 60000;
function toolsWatch() {
  let seen;
  let checkedAt = Number.NEGATIVE_INFINITY;
  return {
    start(version, now) {
      if (seen === undefined)
        seen = version;
      if (checkedAt === Number.NEGATIVE_INFINITY)
        checkedAt = now;
    },
    async after(tool, now, versionNow) {
      if (!DKOD_MCP_TOOL.test(tool) || now - checkedAt < TOOLS_CHECK_MS)
        return null;
      checkedAt = now;
      const current = await versionNow();
      if (current === undefined)
        return null;
      const moved = seen !== undefined && current !== seen;
      seen = current;
      return moved ? STALE_TOOLS_NOTE : null;
    }
  };
}
function toolsVersionIn(out) {
  if (out.isError === true)
    return;
  try {
    const v = JSON.parse(out.content.find((c) => c.type === "text")?.text ?? "null")?.toolsVersion;
    return typeof v === "string" && /^[0-9a-f]{12}$/.test(v) ? v : undefined;
  } catch {
    return;
  }
}
function register(on) {
  const guard = createGuard();
  const passed = passedCalls();
  const tools = toolsWatch();
  let promptNote = null;
  let noteFor = null;
  let staleNote = null;
  let tick = 0;
  let pulseAt = -1;
  let timer = null;
  let heartbeat = async () => {
    return;
  };
  let recheckAuth = async () => {
    return;
  };
  let authOut = false;
  let refreshRules = async () => {
    return;
  };
  on("session.start", async ($, e, next) => {
    const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkoder.config"), keepConfig: (v) => $.store.set("dkoder.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => {
      $.state.set(STATUS, t ?? "").catch(() => {
        return;
      });
    }, cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), path: () => $.env.get("PATH"), mcpConfig: async () => {
      const r = await $.mcp.connect("dkod");
      if (!r.isConnected)
        return;
      const kept = await $.store.get("dkoder.deviceId").catch(() => {
        return;
      });
      const id = typeof kept === "string" && /^[0-9a-f]{32}$/.test(kept) ? kept : crypto.randomUUID().replace(/-/g, "");
      if (id !== kept)
        await $.store.set("dkoder.deviceId", id).catch(() => {
          return;
        });
      const pluginVersion = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then((t) => JSON.parse(t).version).catch(() => {
        return;
      });
      const agentVersion = await $.session.version().then((v) => v.version).catch(() => {
        return;
      });
      const out = await $.mcp.call(r.server, "dkoder.guard.config", { device: deviceFacts(id, await $.env.get("HOME").catch(() => {
        return;
      }), pluginVersion, agentVersion) });
      const text = out.isError ? undefined : out.content.find((c) => c.type === "text")?.text;
      return text === undefined ? undefined : JSON.parse(text);
    }, mcpVersion: async () => {
      const r = await $.mcp.connect("dkod");
      if (!r.isConnected)
        return;
      const out = await $.mcp.call(r.server, "dkoder.guard.version", {});
      const text = out.isError ? undefined : out.content.find((c) => c.type === "text")?.text;
      return text === undefined ? undefined : JSON.parse(text);
    }, keepHookConfig: async (c) => {
      const h2 = await $.env.get("HOME");
      if (h2)
        await $.fs.write(`${h2}/.dkoder/guard.json`, `${JSON.stringify(c)}
`);
    } };
    const home = await $.env.get("HOME").catch(() => {
      return;
    });
    const sid = await $.session.id().catch(() => "");
    const beat = async () => {
      if (!home || !/^[A-Za-z0-9_-]+$/.test(sid))
        return;
      await $.fs.write(`${home}/.dkoder/heartbeat/${sid}`, String(Math.floor(await $.clock.now() / 1000))).catch(() => {
        return;
      });
    };
    heartbeat = beat;
    await beat();
    await $.tool.register(ENV_SECRETS_SPEC).catch(() => {
      return;
    });
    await $.tool.register(POLICY_CHECK_SPEC).catch(() => {
      return;
    });
    await guard.sessionStart(io, e.cwd);
    let told = false;
    let wasOut = false;
    let checking = false;
    const checkAuth = async () => {
      if (checking)
        return;
      checking = true;
      try {
        await checkAuthOnce();
      } finally {
        checking = false;
      }
    };
    const checkAuthOnce = async () => {
      const device = guard.deviceState();
      const r = await $.mcp.connect("dkod").catch(() => null);
      const auth = r === null ? "offline" : r.isConnected ? device === "refused" ? "device" : "ok" : r.reason === "auth" ? "signin" : device === "refused" ? "device" : "offline";
      await $.state.set(AUTH, auth);
      authOut = !signedIn(auth);
      if (auth === "ok" && wasOut)
        await guard.afterSignIn(io).catch(() => {
          return;
        });
      wasOut = auth === "signin";
      if (!signedIn(auth) && !told) {
        told = true;
        $.ui.toast(auth === "signin" ? "DKOD: sign in to use Deliver. Type /mcp, pick dkod, then Authenticate." : auth === "device" ? "Dkoder: this device is not enrolled in your organization's Guard. Ask your DKOD admin." : "DKOD is not connected. Type /mcp and connect dkod.");
      }
      if (signedIn(auth))
        told = false;
    };
    recheckAuth = checkAuth;
    refreshRules = () => guard.refresh(io);
    await checkAuth().catch(() => {
      return;
    });
    await (async () => {
      const r = await $.mcp.connect("dkod");
      if (!r.isConnected)
        return;
      const out = await $.mcp.call(r.server, "dkoder.guard.config", { only: "tools_version" });
      tools.start(toolsVersionIn(out), await $.clock.now());
    })().catch(() => {
      return;
    });
    if (timer === null) {
      timer = $.clock.every(TICK_MS, () => {
        tick += 1;
        const frame = wordmarkFrame(tick);
        if (frame !== wordmarkFrame(tick - 1))
          $.state.set(FRAME, frame);
        if (pulseAt >= 0) {
          const since = tick - pulseAt;
          if (since <= PULSE_TICKS)
            $.state.set(PULSE_FRAME, since);
          else if (since * TICK_MS >= PULSE_TEXT_MS) {
            pulseAt = -1;
            $.state.set(PULSE, null);
          }
        }
        if (tick % (authOut ? AUTH_OUT_EVERY_TICKS : AUTH_EVERY_TICKS) === 0)
          recheckAuth().catch(() => {
            return;
          });
        if (tick % HEARTBEAT_EVERY_TICKS === 0)
          heartbeat();
        if (tick % RULES_EVERY_TICKS === 0)
          refreshRules().catch(() => {
            return;
          });
        if (tick >= CYCLE_TICKS * 1000)
          tick = 0;
      });
    }
    return next(e);
  });
  on("prompt.submit", async ($, e, next) => {
    const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkoder.config"), keepConfig: (v) => $.store.set("dkoder.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), path: () => $.env.get("PATH"), pulse: (decision, text) => {
      pulseAt = tick;
      $.clock.now().then((at) => $.state.set(PULSE, { decision, text, at })).catch(() => {
        return;
      });
      $.state.set(PULSE_FRAME, 0).catch(() => {
        return;
      });
    } };
    noteFor = e.text;
    if (authOut)
      recheckAuth().catch(() => {
        return;
      });
    promptNote = await guard.promptNote(io, e.text).catch(() => null);
    const notes = [promptNote, staleNote].filter((n) => n !== null);
    staleNote = null;
    return next(notes.length === 0 ? e : { ...e, context: [...e.context ?? [], ...notes] });
  });
  on("prompt.compose", async ($, e, next) => {
    const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkoder.config"), keepConfig: (v) => $.store.set("dkoder.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), path: () => $.env.get("PATH") };
    const typed = [...await $.session.messages().catch(() => [])].reverse().find((m) => m.role === "user" && (m.toolResults?.length ?? 0) === 0 && m.text.trim() !== "")?.text ?? null;
    if (typed !== null && typed !== noteFor) {
      noteFor = typed;
      promptNote = await guard.promptNote(io, typed).catch(() => null);
    }
    const r = await next(e);
    const ours = (s) => s.id === "dkod" || s.id === NOTE_SECTION || s.id === STALE_SECTION;
    return { sections: [...r.sections.filter((s) => !ours(s)), await guard.promptSection(io), ...promptNote === null ? [] : [{ id: NOTE_SECTION, text: promptNote, scope: "session" }], ...staleNote === null ? [] : [{ id: STALE_SECTION, text: staleNote, scope: "session" }]] };
  });
  on("tool.call", async ($, e, next) => {
    if (DKOD_MCP_TOOL.test(e.tool)) {
      const ran = await next(e);
      (async () => {
        const note = await tools.after(e.tool, await $.clock.now(), async () => {
          const r = await $.mcp.connect("dkod");
          if (!r.isConnected)
            return;
          return toolsVersionIn(await $.mcp.call(r.server, "dkoder.guard.config", { only: "tools_version" }));
        });
        if (note !== null)
          staleNote = note;
      })().catch(() => {
        return;
      });
      return ran;
    }
    if (typeof e.command !== "string" && writeShape(e) === null)
      return next(e);
    if (touchesDkoderFiles(e))
      return { deny: DKODER_FILES_DENY };
    try {
      const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkoder.config"), keepConfig: (v) => $.store.set("dkoder.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), path: () => $.env.get("PATH"), pulse: (decision, text) => {
        pulseAt = tick;
        $.clock.now().then((at) => $.state.set(PULSE, { decision, text, at })).catch(() => {
          return;
        });
        $.state.set(PULSE_FRAME, 0).catch(() => {
          return;
        });
      } };
      if (typeof e.command === "string") {
        const refused = await guard.bash(io, e.command);
        if (refused !== null)
          return refused;
      }
      const refused = await guard.write(io, e);
      if (refused !== null)
        return refused;
      passed.remember(e);
      return next(e);
    } catch (err) {
      return { deny: `Dkoder could not check this ${e.tool} call (${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}), so it did not run. Try again; if it keeps failing, tell your DKOD admin.` };
    }
  }).catch(async ($, e, next) => failedCheck(next) ? { deny: timedOut(e.tool) } : next(e));
  on("tool.call", { tool: "mcp__dkod__secrets_from_env" }, async ($, e) => {
    const answer = await fillSecretsFromEnv({
      read: (p) => $.fs.read(p),
      cwd: () => $.session.cwd(),
      call: async (tool, args) => {
        const r = await $.mcp.connect("dkod").catch(() => null);
        if (r === null || !r.isConnected)
          return null;
        const out = await $.mcp.call(r.server, tool, args);
        const text = out.content.find((c) => c.type === "text")?.text;
        let body = null;
        try {
          body = text === undefined ? null : JSON.parse(text);
        } catch {
          body = null;
        }
        return { ok: out.isError !== true, body };
      }
    }, e).catch(() => ({ ok: false, error: "failed", message: "Dkoder could not fill the secrets from that file. Nothing was saved. Try again." }));
    return { result: JSON.stringify(answer) };
  }).catch(async () => ({ deny: "Dkoder could not fill the secrets from that file in time. Check in the dashboard what was saved (Launchpad, the app, Replace secrets), then try again." }));
  on("tool.call", { tool: "mcp__dkod__policy_check" }, async ($, e) => {
    const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkoder.config"), keepConfig: (v) => $.store.set("dkoder.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), path: () => $.env.get("PATH") };
    const answer = await (async () => {
      const cfg = await guard.load(io);
      const cwd = await $.session.cwd();
      const asked = typeof e.path === "string" && e.path.trim() !== "" ? e.path.trim() : null;
      const dir = asked === null ? cwd : absolutePath(cwd, asked);
      return checkFolder(cfg.policyPack, dir, { list: (d) => listWithShell((a, i) => guard.run(io, a, i), d), read: (p) => $.fs.read(p) });
    })().catch(() => ({ ok: false, error: "failed", message: "Dkoder could not run the policy checks. Try again." }));
    return { result: JSON.stringify(answer) };
  }).catch(async () => ({ deny: "Dkoder could not finish the policy checks in time. Run them on the app's own folder, or try again." }));
  on("tool.check", async ($, e, next) => {
    const r = await next(e);
    if (r.decision === "deny")
      return r;
    const call = { ...typeof e.input === "object" && e.input !== null ? e.input : {}, tool: e.tool };
    if (typeof call.command !== "string" && writeShape(call) === null)
      return r;
    if (touchesDkoderFiles(call))
      return { decision: "deny", reason: DKODER_FILES_DENY };
    if (passed.seen(call))
      return r;
    try {
      const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkoder.config"), keepConfig: (v) => $.store.set("dkoder.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), path: () => $.env.get("PATH"), pulse: (decision, text) => {
        pulseAt = tick;
        $.clock.now().then((at) => $.state.set(PULSE, { decision, text, at })).catch(() => {
          return;
        });
        $.state.set(PULSE_FRAME, 0).catch(() => {
          return;
        });
      } };
      const refused = (typeof call.command === "string" ? await guard.bash(io, call.command) : null) ?? await guard.write(io, call);
      return refused === null ? r : { decision: "deny", reason: refused.deny };
    } catch (err) {
      return { decision: "deny", reason: `Dkoder could not check this ${e.tool} call (${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}), so it did not run. Try again; if it keeps failing, tell your DKOD admin.` };
    }
  }).catch(async ($, e, next) => failedCheck(next) ? { decision: "deny", reason: timedOut(e.tool) } : next(e));
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey)
      return next(e);
    const [auth, frame, pulse, pulseFrame, status] = await Promise.all([$.state.get(AUTH), $.state.get(FRAME), $.state.get(PULSE), $.state.get(PULSE_FRAME), $.state.get(STATUS)]);
    const el = $.ui.resolve(e);
    const ours = bandTree(el, {
      auth: auth.value ?? "checking",
      frame: typeof frame.value === "number" ? frame.value : -1,
      pulse: pulse.value ?? null,
      pulseFrame: typeof pulseFrame.value === "number" ? pulseFrame.value : -1,
      now: await $.clock.now(),
      status: typeof status.value === "string" && status.value !== "" ? status.value.replace(/^Dkoder: /, "") : "on"
    });
    return withBelow(el, ours, await next(e));
  });
}
export {
  register
};
