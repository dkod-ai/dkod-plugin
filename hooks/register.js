// Built by packages/guard/scripts/build-claude.ts from dkod-app. Do not edit: run `bun run --cwd packages/guard build:claude`.
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
      const op2 = line.slice(i, j);
      out.push({ kind: "op", text: "redirect", write: op2.includes(">") && !op2.endsWith("&") });
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
        for (const ch of w.slice(1)) {
          if (ch === "n")
            out.push({ kind: "hook-bypass", cmd, dir, how: "git commit -n" });
          if (ch === "a" || ch === "i" || ch === "o")
            all = true;
          if (COMMIT_VALUE.has(`-${ch}`)) {
            if (w.endsWith(ch))
              j += 1;
            break;
          }
        }
        continue;
      }
      if (w.startsWith("-")) {
        if (!w.includes("=") && COMMIT_VALUE.has(w))
          j += 1;
        continue;
      }
      all = true;
    }
    out.push({ kind: "commit", cmd, dir, all });
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
function ghActions(cmd) {
  const a = cmd.argv;
  const dir = cmd.cd;
  let repoFlag = null;
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
    words.push(w);
  }
  const repo = repoFlag === null ? null : repoFromRef(repoFlag) ?? repoFlag;
  const [group, verb] = words;
  if (group === undefined)
    return [];
  if (group === "pr" && verb === "merge") {
    const target = words.slice(2).find((w) => !w.startsWith("-"));
    const fromUrl = target !== undefined && target.includes("://") ? repoFromRef(target) : null;
    return [{ kind: "merge", cmd, dir, repo: fromUrl ?? repo }];
  }
  if (group === "repo" && verb !== undefined && GH_REPO_WRITES.has(verb)) {
    const target = words.slice(2).find((w) => !w.startsWith("-"));
    return [{ kind: "repo-write", cmd, dir, repo: (target !== undefined ? repoFromRef(target) : null) ?? repo }];
  }
  if (group === "repo" && verb === "create" && words.includes("--push")) {
    const target = words.slice(2).find((w) => !w.startsWith("-"));
    return [{ kind: "repo-write", cmd, dir, repo: (target !== undefined ? repoFromRef(target) : null) ?? repo }];
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
function actionsOf(cmds, depth = 0) {
  const out = [];
  const made = new Map;
  for (const cmd of cmds) {
    const prog = programName(cmd.argv[0] ?? "");
    if (prog === "git" || prog.startsWith("git-") && GIT_BUILTINS.has(prog.slice(4)))
      out.push(...gitActions(cmd, depth, made));
    else if (prog === "gh")
      out.push(...ghActions(cmd));
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
    return { text: "Sign in to DKOD: type /mcp, pick dkod, then Authenticate", color: COLORS.yellow };
  if (auth === "device")
    return { text: "This device is not enrolled in DKOD Guard. Ask your DKOD admin.", color: COLORS.yellow };
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
  return h(el.Box, { key: "dkod-guard-band", flexDirection: "row" }, h(el.Text, null, ...letters), h(el.Text, { color: mark.color, bold: true }, `  ${mark.glyph} `), h(el.Text, { color: COLORS.dim }, "Guard  "), h(el.Text, { color: words.color, wrap: "truncate-end" }, words.text));
}
function withBelow(el, ours, below) {
  if (below === null || below === undefined || below === false)
    return ours;
  return h(el.Box, { key: "dkod-guard-stack", flexDirection: "column" }, ours, below);
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
function nameWords(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase().split(/[_.-]/).filter((w) => w !== "");
}
var SECRET_LAST_WORDS = new Set(["secret", "token", "apikey", "credential", "credentials"]);
var PASSWORD_WORDS = new Set(["password", "passwd", "pwd", "pass", "passphrase"]);
var KEY_QUALIFIERS = new Set(["api", "private", "secret", "access", "signing", "encryption", "master", "client"]);
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
  if (PASSWORD_WORDS.has(last))
    return "password";
  if (SECRET_LAST_WORDS.has(last))
    return "secret";
  if (last === "base" && words.at(-2) === "key" && words.at(-3) === "secret")
    return "secret";
  if (last !== "key" || words.length < 2)
    return null;
  return KEY_QUALIFIERS.has(words.at(-2)) ? "secret" : "any_key";
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
var IDENTIFIER_VALUE = new RegExp(`^${IDENTIFIER_PART}(?:[._-]${IDENTIFIER_PART})*$`);
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
    if (/^\s*(#|\/\/)/.test(line))
      continue;
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
      const kind = tierB ? secretNameKind(name) : null;
      if (kind === null || !looksLikeSecretLiteral(literal.value, kind))
        continue;
      raw.push({ rule: "secret_assignment", name, ...span });
    }
    if (!tierB)
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
function stringList(v, at, max, out) {
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
  const protectedRepos = stringList(doc.protected_repos, "protected_repos", GUARD_LIMITS.repos, out);
  protectedRepos.forEach((r, i) => {
    if (!REPO.test(r) && !OWNER_WILDCARD.test(r))
      out.push({ path: `protected_repos[${i}]`, message: `${r} is not owner/name or owner/*.` });
  });
  const direct = stringList(doc.direct_push_allowed, "direct_push_allowed", GUARD_LIMITS.repos, out);
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
var DELIVER = "App code ships through Deliver (the dkoder.deliver tool), never a direct push or merge.";
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
  const order = ["protected", "allowed", "governance", "outside"];
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
        const { cls: cls2, repo: repo2 } = worst(remotes, config);
        if (remotes.length > 0 && (cls2 === "outside" || cls2 === "governance"))
          continue;
        judged("alias", repo2, true);
        return { rule: "deliver-only", ...repo2 !== null ? { repo: repo2 } : {}, message: `Guard could not tell what "${a.tool} ${a.name}" runs, so it did not run. Use the plain ${a.tool} command.` };
      }
      if ((expansions += 1) > 20 && judged("alias", null, true))
        return { rule: "no-hook-bypass", message: "This command expands too many aliases for Guard to read. Run the git or gh command directly." };
      queue.unshift(...expandAlias(a.tool, value, a.prefix, a.args, { ...a.cmd, cd: a.dir }));
      continue;
    }
    if (a.kind === "commit") {
      const { cls: cls2, repo: repo2 } = worst(await resolver.repoRemotes(a.dir), config);
      judged("commit", repo2, cls2 !== "outside");
      continue;
    }
    if (a.kind === "hook-bypass") {
      const remotes = await resolver.repoRemotes(a.dir);
      const { cls: cls2, repo: repo2 } = worst(remotes, config);
      judged("hook-bypass", repo2, remotes.length === 0 || cls2 !== "outside");
      if (remotes.length > 0 && (cls2 === "outside" || cls2 === "governance"))
        continue;
      return { rule: "no-hook-bypass", ...repo2 !== null ? { repo: repo2 } : {}, message: `${a.how} is not allowed: it skips the checks your org runs before code leaves this machine.` };
    }
    if (a.kind === "push") {
      if (a.opaque !== null && config.owners.length > 0) {
        judged("push", null, true);
        return { rule: "deliver-only", message: `Guard cannot tell where this push goes (${a.opaque}). Run a plain git push, or ship with Deliver. ${DELIVER}` };
      }
      const targets = await resolver.pushTargets(a.dir, a.remote);
      const lineUrls = (a.also ?? []).map(repoFromRemoteUrl);
      const also = lineUrls.filter((r) => r !== null);
      if (a.lineRemote === true && config.owners.length > 0 && (targets === null && also.length === 0 || also.length < lineUrls.length)) {
        judged("push", null, true);
        return { rule: "deliver-only", message: `Guard cannot tell where this push goes: an earlier command in the same line makes the remote. Run the push as its own command, or ship with Deliver. ${DELIVER}` };
      }
      const repos2 = [...targets ?? await resolver.repoRemotes(a.dir), ...also];
      const { cls: cls2, repo: repo2 } = worst(repos2, config);
      judged("push", repo2, cls2 !== "outside" || targets === null);
      if (targets === null && also.length === 0 && cls2 !== "outside" && cls2 !== "governance") {
        return { rule: "deliver-only", ...repo2 !== null ? { repo: repo2 } : {}, message: `Guard could not tell which repo this push goes to, and this folder has an org remote. ${DELIVER}` };
      }
      if (cls2 === "protected") {
        if (a.force)
          return { rule: "no-force-push", repo: repo2, message: `Force push to ${repo2} is not allowed. ${DELIVER}` };
        return { rule: "deliver-only", repo: repo2, message: `git push to ${repo2} is not allowed. ${DELIVER}` };
      }
      continue;
    }
    if (a.kind === "api-write" && a.repo === "unknown") {
      if (config.owners.length === 0)
        continue;
      judged(a.kind, null, true);
      return { rule: "deliver-only", message: `Guard could not tell which repo this GitHub API write reaches, so it did not run. ${DELIVER}` };
    }
    const repos = a.repo !== null ? [a.repo] : await resolver.repoRemotes(a.dir);
    const { cls, repo } = worst(repos, config);
    judged(a.kind, repo, cls !== "outside");
    if (cls === "protected")
      return { rule: "deliver-only", repo, message: `${describe(a)} on ${repo} is not allowed. ${DELIVER}` };
  }
  return null;
}
function commitTargets(cmds) {
  return actionsOf(cmds).flatMap((a) => a.kind === "commit" ? [{ dir: a.dir, all: a.all }] : []);
}
var MAX_SCAN_CHARS = 8 * 1024 * 1024;
function checkFile(path, content, config) {
  if (content.length > MAX_SCAN_CHARS) {
    return [{ rule: "no-secrets", message: `${path} is larger than ${String(MAX_SCAN_CHARS / 1024 / 1024)} MB, too large for Guard to check for secrets. Keep large data out of the repo.` }];
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
  return out;
}
function newFindings(path, before, after, config) {
  const found = checkFile(path, after, config);
  if (before === null || found.length === 0)
    return found;
  const lineText = (text, line) => line === undefined ? "" : text.split(`
`)[line - 1] ?? "";
  const old = new Set(checkFile(path, before, config).map((f) => `${f.rule}\x00${lineText(before, f.line)}`));
  return found.filter((f) => !old.has(`${f.rule}\x00${lineText(after, f.line)}`));
}
var SHIP_VERB = /\b(?:git\s+push|gh\s+pr\s+merge|force[- ]?push(?:ed|ing)?|push(?:ed|ing)?|merg(?:e|ed|ing))\b/i;
var SHIP_DIRECT = /\b(?:main|master|trunk|default\s+branch|directly|direct|straight|right\s+away|--admin|admin\s+merge|without\s+(?:a\s+)?(?:pr|pull\s+request|review|deliver))\b/i;
function asksDirectShip(text) {
  const t = text.slice(0, 20000);
  if (/\bgh\s+pr\s+merge\b/i.test(t) || /\bforce[- ]?push/i.test(t) || /\bgit\s+push\b[^\n]*(?:--force|-f\b)/i.test(t))
    return true;
  return SHIP_VERB.test(t) && SHIP_DIRECT.test(t);
}

var EMPTY = { owners: [], governanceRepo: null, gitopsRepo: null, appRepos: [], guard: null };
var strings = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
var str = (v) => typeof v === "string" && v.length > 0 ? v : null;
function configFrom(v) {
  if (typeof v !== "object" || v === null)
    return EMPTY;
  const o = v;
  return {
    owners: strings(o.owners),
    governanceRepo: str(o.governanceRepo),
    gitopsRepo: str(o.gitopsRepo),
    appRepos: strings(o.appRepos),
    guard: typeof o.guard === "object" && o.guard !== null ? o.guard : null,
    ...typeof o.policyText === "string" ? { policyText: o.policyText } : {}
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
    ...live.policyText ?? base.policyText ? { policyText: live.policyText ?? base.policyText } : {}
  };
}
function rulesText(config) {
  const lines = [
    "# DKOD Guard (your organization's rules)",
    "DKOD Guard is installed by your organization and checks every command and file write.",
    "- App code ships through Deliver (the dkoder.deliver tool of the DKOD MCP server). Never git push, gh pr merge or write through the GitHub API to an app repo of the organization.",
    "- Never write a secret value into a file, and never commit one. Put the NAME of a secret in the file and resolve it at run time.",
    "- Never skip git hooks (--no-verify, core.hooksPath) and never force push to an organization repo.",
    "- When Guard refuses a call, tell the person why and take the DKOD path instead. Do not try another way around it."
  ];
  if (config.governanceRepo !== null)
    lines.push(`- The governance repo ${config.governanceRepo} may be pushed to directly.`);
  if (config.policyText)
    lines.push("", "## Organization policy", config.policyText);
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
  const git = async (io, cwd, args) => {
    try {
      const r = await io.run(["git", "-C", cwd, ...args], { timeoutMs: 1e4 });
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
          const r2 = await io.run(["git", "-C", cwd, "config", "--get", `alias.${name}`], { timeoutMs: 1e4 });
          if (r2.exitCode === 1 && r2.stdout === "")
            return null;
          return r2.exitCode === 0 ? r2.stdout.replace(/\n$/, "") : undefined;
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
      file = JSON.parse(await io.read(`${io.root}/guard.json`));
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
        const r = await io.fetch(`${file.dashboardUrl.replace(/\/$/, "")}/api/v1/guard/config`, { headers: { authorization: `Bearer ${file.token}` } });
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
    const device2 = typeof install.deviceId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(install.deviceId) ? { device: install.deviceId } : {};
    const body = JSON.stringify({ ...event, ...device2, agent: "claude-code", at: new Date().toISOString() });
    io.fetch(`${install.dashboardUrl.replace(/\/$/, "")}/api/v1/guard/events`, { method: "POST", headers: { authorization: `Bearer ${install.token}`, "content-type": "application/json" }, body }).catch(() => {
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
    const shown = found.slice(0, 5).map((r) => `- ${r.message}`);
    if (found.length > 5)
      shown.push(`- and ${String(found.length - 5)} more.`);
    return { deny: `DKOD Guard refused this, by your organization's rules.
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
  const checkWrite = async (io, e, seen = []) => {
    const shape = writeShape(e);
    if (shape === null)
      return [];
    const { target, content, edits, cell } = shape;
    const cfg = await load(io);
    if (target === null)
      return newFindings(`${e.tool}.txt`, null, content ?? edits.map((ed) => ed.new_string).join(`
`), cfg);
    const path = target.startsWith("/") ? target : await absolute(io, target);
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
    io.status(protectedRepo !== undefined ? `DKOD Guard: ${protectedRepo.split("/")[1]}, Deliver required` : "DKOD Guard: on");
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
      `DKOD Guard: this message asks to push or merge code directly. ${repo} is an app repo of your organization, and your organization's rules (with DKOD's floor) do not allow that.`,
      DELIVER,
      "Do the rest of the work. Do not run git push, gh pr merge or a GitHub API write for it: Guard refuses them. Tell the person, in one or two sentences, why it will not be pushed or merged directly, and offer Deliver."
    ].join(`
`);
  };
  const promptSection = async (io) => ({ id: "dkod-guard", text: rulesText(await load(io)), scope: "session" });
  const failClosed = async (tool, check) => {
    try {
      return await check();
    } catch (err) {
      return { deny: `DKOD Guard could not check this ${tool} call (${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}), so it did not run. Try again; if it keeps failing, tell your DKOD admin.` };
    }
  };
  const bash = (io, command) => failClosed("Bash", () => bashCheck(io, command));
  const bashCheck = async (io, command) => {
    const cfg = await load(io);
    const seen = [];
    const blocked = await decideBash(parseCommands(command), cfg, resolver(io), seen);
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
  return { sessionStart, promptSection, promptNote, bash, write, load, checkWrite, checkCommit, resolver, deviceState };
}
var GUARD_DIR = ".dkod-guard";
var GUARD_FILES_DENY = `DKOD Guard refused this: it touches DKOD Guard's own files (${GUARD_DIR}). Leave them alone.`;
var WRITERS = new Set(["cp", "mv", "tee", "touch", "mkdir", "rm", "rmdir", "ln", "install", "rsync", "truncate", "chmod", "chown", "chflags", "dd", "sed", "unzip", "tar", "ditto"]);
var INTERPRETERS = new Set(["python", "python3", "node", "bun", "deno", "perl", "ruby", "osascript"]);
function inGuardDir(word) {
  if (/\s/.test(word))
    return false;
  const p = word.replace(/\\/g, "/").replace(/\/+$/, "");
  return p === GUARD_DIR || p.endsWith(`/${GUARD_DIR}`) || p.startsWith(`${GUARD_DIR}/`) || p.includes(`/${GUARD_DIR}/`);
}
var underCd = (cd, word) => cd === "" || word.startsWith("/") || word.startsWith("~") ? word : `${cd}/${word}`;
function touchesGuardFiles(e) {
  for (const path of [e.file_path, e.notebook_path, e.path])
    if (typeof path === "string" && inGuardDir(path))
      return true;
  if (typeof e.command !== "string" || !e.command.includes(GUARD_DIR))
    return false;
  for (const cmd of parseCommands(e.command)) {
    if (inGuardDir(cmd.cd))
      return true;
    if ((cmd.writes ?? []).some((w) => inGuardDir(underCd(cmd.cd, w))))
      return true;
    const program = programName(cmd.argv[0] ?? "");
    const args = cmd.argv.slice(1);
    if (WRITERS.has(program) && args.some((a) => inGuardDir(underCd(cmd.cd, a))))
      return true;
    if (INTERPRETERS.has(program) && args.some((a) => a.includes(GUARD_DIR)))
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
var HEARTBEAT_EVERY_TICKS = Math.round(5000 / TICK_MS);
function register(on) {
  const guard = createGuard();
  let tick = 0;
  let pulseAt = -1;
  let timer = null;
  let heartbeat = async () => {
    return;
  };
  on("session.start", async ($, e, next) => {
    const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkod-guard.config"), keepConfig: (v) => $.store.set("dkod-guard.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => {
      $.state.set(STATUS, t ?? "").catch(() => {
        return;
      });
    }, cwd: () => $.session.cwd(), home: () => $.env.get("HOME") };
    const home = await $.env.get("HOME").catch(() => {
      return;
    });
    const sid = await $.session.id().catch(() => "");
    const beat = async () => {
      if (!home || !/^[A-Za-z0-9_-]+$/.test(sid))
        return;
      await $.fs.write(`${home}/.dkod-guard/heartbeat/${sid}`, String(Math.floor(await $.clock.now() / 1000))).catch(() => {
        return;
      });
    };
    heartbeat = beat;
    await beat();
    await guard.sessionStart(io, e.cwd);
    let told = false;
    const checkAuth = async () => {
      const device = guard.deviceState();
      const r = await $.mcp.connect("dkod").catch(() => null);
      const auth = r === null ? "offline" : r.isConnected ? device === "refused" ? "device" : "ok" : r.reason === "auth" ? "signin" : device === "refused" ? "device" : "offline";
      await $.state.set(AUTH, auth);
      if (!signedIn(auth) && !told) {
        told = true;
        $.ui.toast(auth === "signin" ? "DKOD: sign in to use Deliver. Type /mcp, pick dkod, then Authenticate." : auth === "device" ? "DKOD Guard: this device is not enrolled. Ask your DKOD admin." : "DKOD is not connected. Type /mcp and connect dkod.");
      }
      if (signedIn(auth))
        told = false;
    };
    await checkAuth().catch(() => {
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
        if (tick % AUTH_EVERY_TICKS === 0)
          checkAuth().catch(() => {
            return;
          });
        if (tick % HEARTBEAT_EVERY_TICKS === 0)
          heartbeat();
        if (tick >= CYCLE_TICKS * 1000)
          tick = 0;
      });
    }
    return next(e);
  });
  on("prompt.submit", async ($, e, next) => {
    const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkod-guard.config"), keepConfig: (v) => $.store.set("dkod-guard.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), pulse: (decision, text) => {
      pulseAt = tick;
      $.clock.now().then((at) => $.state.set(PULSE, { decision, text, at })).catch(() => {
        return;
      });
      $.state.set(PULSE_FRAME, 0).catch(() => {
        return;
      });
    } };
    const note = await guard.promptNote(io, e.text).catch(() => null);
    return next(note === null ? e : { ...e, context: [...e.context ?? [], note] });
  });
  on("prompt.compose", async ($, e, next) => {
    const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkod-guard.config"), keepConfig: (v) => $.store.set("dkod-guard.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME") };
    const r = await next(e);
    return { sections: [...r.sections, await guard.promptSection(io)] };
  });
  on("tool.call", async ($, e, next) => {
    if (typeof e.command !== "string" && writeShape(e) === null)
      return next(e);
    if (touchesGuardFiles(e))
      return { deny: GUARD_FILES_DENY };
    try {
      const io = { root: $.plugin.root, read: (p) => $.fs.read(p), exists: (p) => $.fs.exists(p), run: (a, i) => $.process.run(a, i), keptConfig: () => $.store.get("dkod-guard.config"), keepConfig: (v) => $.store.set("dkod-guard.config", v), fetch: (u, i) => $.http.fetch(u, i), status: (t) => $.ui.status(t), cwd: () => $.session.cwd(), home: () => $.env.get("HOME"), pulse: (decision, text) => {
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
      return await guard.write(io, e) ?? next(e);
    } catch (err) {
      return { deny: `DKOD Guard could not check this ${e.tool} call (${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}), so it did not run. Try again; if it keeps failing, tell your DKOD admin.` };
    }
  });
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
      status: typeof status.value === "string" && status.value !== "" ? status.value.replace(/^DKOD Guard: /, "") : "on"
    });
    return withBelow(el, ours, await next(e));
  });
}
export {
  register
};
