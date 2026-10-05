---
name: dkod
description: Use when the user wants to build, ship, deploy or remove an app through their company's DKOD, asks what the org's policy or templates are, or wants to push or merge app code. Covers the dkoder MCP tools (session, policy, templates, deploy questions, deploy, build answers, deliver, remove) and how Dkoder and the org's Guard rules treat pushes.
---

# DKOD

DKOD is the company's platform. It holds the org's policy, its app templates and its Deploy rules. The `dkod` MCP server that comes with Dkoder gives you its tools; their names end in `dkoder_<name>` (for example `dkoder.deliver`).

If a tool says the server needs sign-in, or the DKOD band above the prompt is yellow, tell the user to type `/mcp`, pick `dkod` and choose Authenticate. They sign in with their company's own sign-in.

## The rules

- App code ships through Deliver (`dkoder.deliver`). Dkoder refuses `git push`, `gh pr merge` and GitHub API writes to the org's app repositories. Guard adds the org's own rules from its governance repo once the person signs in. When Dkoder or Guard refuses a call, tell the user why in one or two sentences and offer Deliver. Do not try another way around it.
- Pushes to the governance repository are allowed.
- Never write a secret value into a file. Put the name of the secret there and resolve it at run time.
- The app lives in the customer's GitHub org. Never use `dkod-ai/` as the app destination.
- Never invent a Deploy answer. Ask the user every question you cannot answer from what they told you.
- Call `dkoder.remove` only when the user clearly asks to remove the app from production. Calling it is the yes.

## Start a session

1. Call `dkoder.session.start` with the app key.
2. Call `dkoder.policy` and `dkoder.templates` with the `sessionId`. Follow what they return while you write code.

## Deploy

1. Call `dkoder.deploy.questions`. Ask the user each question. Use the question keys as `deploy_answers`.
2. Call `dkoder.deploy.business_metrics` with the `app_key`. If it returns rows, show them and ask which to add.
3. Call `dkoder.deploy` with `app_key`, `deploy_answers`, and `business_metrics` (`"all"`, `"none"` or a list of ids).
4. Follow the build with `dkoder.build.status` (the build `id`). Do not call `dkoder.deploy` again to check on it: after delivery that starts a new build.
5. If the build asks its own questions, ask the user, then call `dkoder.build.answer` with `sessionId`, the build `id`, the `key`, and a `value` (or `skip: true`).

## Ship

When the build is ready, call `dkoder.deliver` with `sessionId` and the build `id`. DKOD writes the code to the app repository and the GitOps repository; nobody pushes by hand. `dkoder.guard.delivered` (repo, commit) says whether Deliver wrote a commit.

Use `dkoder.session.append` to add a note to the session when something worth recording happens.
