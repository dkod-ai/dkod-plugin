---
name: dkod
description: Use when the user wants to build, ship, deploy or remove an app through their company's DKOD, asks what the org's policy or templates are, or is about to push an app to its customer repository. Covers the dkoder MCP tools (session, policy, templates, deploy questions, deploy, build answers, deliver, remove) and the session and deliver files the push guard reads.
---

# DKOD

DKOD is the company's platform. It holds the org's policy, its app templates and its Deploy rules. The `dkod` MCP server gives you its tools. In Claude Code they show as `mcp__dkod__dkoder_<name>` (for example `dkoder.deliver` is `mcp__dkod__dkoder_deliver`).

If a tool says the server needs sign-in, tell the user to run `/mcp`, pick `dkod` and choose Authenticate. They sign in with their company's own sign-in.

## The rules

- Ship with Deliver. Call `dkoder.deliver`. Never `git push` to the customer app repository yourself. The plugin's push guard refuses that push until Deliver has run.
- The app lives in the customer's GitHub org. Never use `dkod-ai/` as the app destination.
- Pushes to the governance repository are always allowed.
- Never invent a Deploy answer. Ask the user every question you cannot answer from what they told you.
- Call `dkoder.remove` only when the user clearly asks to remove the app from production. Calling it is the yes.

## Start a session

1. Call `dkoder.session.start` with the app key.
2. Write the session file at `$(git rev-parse --git-dir)/dkoder/session`. It is `key=value` lines, not JSON:

```
sessionId=<id from the tool response>
appKey=<the app key>
appRemote=<the customer app repository URL>
governanceRemote=<the governance repository URL>
```

Find the git dir with local `git rev-parse --git-dir` only. Do not change `core.hooksPath`.

3. Call `dkoder.policy` and `dkoder.templates` with the `sessionId`. Follow what they return while you write code.

## Deploy

1. Call `dkoder.deploy.questions`. Ask the user each question. Use the question keys as `deploy_answers`.
2. Call `dkoder.deploy.business_metrics` with the `app_key`. If it returns rows, show them and ask which to add.
3. Call `dkoder.deploy` with `app_key`, `deploy_answers`, and `business_metrics` (`"all"`, `"none"` or a list of ids).
4. If the build asks its own questions, ask the user, then call `dkoder.build.answer` with `sessionId`, the build `id`, the `key`, and a `value` (or `skip: true`).

## Ship

1. When the build is ready, call `dkoder.deliver` with `sessionId` and the build `id`.
2. Only when it returns ok (not an error), write the deliver stamp at `$(git rev-parse --git-dir)/dkoder/deliver`, in `key=value` lines:

```
sessionId=<same as the session file>
appKey=<same as the session file>
remote=<the app remote you delivered to, same URL as appRemote>
```

Use `dkoder.session.append` to add a note to the session when something worth recording happens.
