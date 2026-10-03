import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";

const guard = join(import.meta.dir, "..", "hooks", "guard-push.sh");

const APP = "git@github.com:customer-org/my-app.git";
const GOV = "https://github.com/customer-org/governance.git";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(opts: { session?: boolean; stamp?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dkod-guard-"));
  dirs.push(dir);
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir });
  git("init", "-q");
  git("remote", "add", "origin", APP);
  git("remote", "add", "gov", GOV);
  const dk = join(dir, ".git", "dkoder");
  mkdirSync(dk, { recursive: true });
  if (opts.session !== false) {
    writeFileSync(join(dk, "session"), `sessionId=s1\nappKey=my-app\nappRemote=${APP}\ngovernanceRemote=${GOV}\n`);
  }
  if (opts.stamp) writeFileSync(join(dk, "deliver"), opts.stamp);
  return dir;
}

function run(command: string, cwd: string) {
  const r = spawnSync("sh", [guard], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
  });
  return { code: r.status, err: r.stderr.toString() };
}

describe("guard-push", () => {
  test("ignores commands that are not git push", () => {
    expect(run("ls -la", repo()).code).toBe(0);
    expect(run("git status", repo()).code).toBe(0);
  });

  test("blocks a push to the app remote without a Deliver stamp", () => {
    const r = run("git push origin main", repo());
    expect(r.code).toBe(2);
    expect(r.err).toContain("dkoder.deliver");
  });

  test("blocks a bare git push that defaults to origin", () => {
    expect(run("git push", repo()).code).toBe(2);
  });

  test("blocks a push by URL and after cd", () => {
    const dir = repo();
    expect(run(`git push ${APP} main`, dir).code).toBe(2);
    expect(run(`cd ${dir} && git push -u origin HEAD`, "/").code).toBe(2);
    expect(run(`git -C ${dir} push origin main`, "/").code).toBe(2);
  });

  test("allows the governance remote", () => {
    expect(run("git push gov main", repo()).code).toBe(0);
  });

  test("allows when there is no session file", () => {
    expect(run("git push origin main", repo({ session: false })).code).toBe(0);
  });

  test("allows with a matching Deliver stamp", () => {
    const dir = repo({ stamp: `sessionId=s1\nappKey=my-app\nremote=https://github.com/customer-org/my-app\n` });
    expect(run("git push origin main", dir).code).toBe(0);
  });

  test("blocks with a stamp from another session", () => {
    const dir = repo({ stamp: `sessionId=old\nappKey=my-app\nremote=${APP}\n` });
    expect(run("git push origin main", dir).code).toBe(2);
  });

  test("ignores a directory that is not a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "dkod-guard-"));
    dirs.push(dir);
    expect(run("git push origin main", dir).code).toBe(0);
  });
});
