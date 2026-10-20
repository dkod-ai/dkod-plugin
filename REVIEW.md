# Review instructions

This repo has no `CLAUDE.md`. Rules come from `README.md`, `hooks/`, `rules/` and `skills/dkod/SKILL.md`. This file only tunes what a review flags.

## What Important means here

Flag as Important when a diff breaks one of these.

- Refusals weakened: `hooks/backstop.sh` must still block `git push`, `gh pr merge` and GitHub API writes to org app repos, secrets written to files, and skipped git hooks (`--no-verify`, `core.hooksPath`). Source: `README.md`, header of `hooks/backstop.sh`.
- Hook exit codes: exit 2 blocks, exit 0 allows. A path that now allows by mistake is Important. Source: `hooks/backstop.sh`.
- Guard's own files: the agent must not be able to write `.dkoder`. Source: `hooks/backstop.sh`.
- Secret patterns in `hooks/backstop.sh` that the app's `secret-guard.ts` does not also catch (the script header says they must match).
- Hand edits to `hooks/register.js`. It is built from dkod-app (`build:claude`); the header says do not edit.
- Skill or rule text that lets the agent push the app, make a repository for it, run git for it, invent a Deploy answer, or use `dkod-ai/` as the app destination. Source: `skills/dkod/SKILL.md`, `rules/dkod-first.mdc`.
- Dkoder and Guard mixed up (see the table in `README.md`).
- Version drift: `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, the marketplace files and `pluginVersion` in `SKILL.md` must agree.
- A secret, token or password in any file. The MCP URL in `.mcp.json` must stay `https://dashboard.dkod.app/api/v1/dkoder/mcp`.
- A claim that the rules are a security boundary against a person. The README says they are not.

## Cap the nits

Report at most 5 Nits. Drop the rest.

## Do not report

CI runs `claude plugin validate .` and `claude plugin test .` (`.github/workflows/ci.yml`).

- Manifest schema errors that `plugin validate` catches.
- Generated or binary files: `hooks/register.js`, `assets/readme/*.svg`.
- Wording of README art and badges.

## Always check

1. A change to a `backstop.sh` pattern: is there a test in `test/` for it?
2. A new hook or matcher in `hooks/hooks.json`: does it run in `--safe-mode`?
3. A version bump: are all manifests and `SKILL.md` bumped together?
4. A script in `skills/dkod/scripts/`: do the node, python, sh and ps1 variants still agree?
5. New skill text: does it claim a behaviour the server tools do not have?
6. The Cursor files: do they still avoid anything that needs the Claude Code band?

## Evidence

A behaviour claim needs a `file:line` citation. Do not infer from a name. A security finding must show the path from input to the weak code. If you cannot show it, drop the finding or mark it Nit.
