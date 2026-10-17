---
name: dkod
description: Use when the user wants to build, ship, deploy, "push to prod" or remove an app through their company's DKOD, asks what the org's policy or templates are, or wants to push or merge app code. Covers the dkoder MCP tools (session, policy, templates, sending the code, deploy questions, deploy, build answers, deliver, remove) and how Dkoder and the org's Guard rules treat pushes.
---

# DKOD

DKOD is the company's platform. It holds the org's policy, its app templates and its Deploy rules. The `dkod` MCP server that comes with Dkoder gives you its tools; their names end in `dkoder_<name>` (for example `dkoder.deliver`).

If a tool says the server needs sign-in, or the DKOD band above the prompt is yellow, tell the user to type `/mcp`, pick `dkod` and choose Authenticate. They sign in with their company's own sign-in.

## The rules

- App code ships through Deliver (`dkoder.deliver`). Dkoder refuses `git push`, `gh pr merge` and GitHub API writes to the org's app repositories. Guard adds the org's own rules from its governance repo once the person signs in. When Dkoder or Guard refuses a call, tell the user why in one or two sentences and offer Deliver. Do not try another way around it.
- Pushes to the governance repository are allowed.
- Never write a secret value into a file. Put the name of the secret there and resolve it at run time.
- The app lives in the customer's GitHub org. Never use `dkod-ai/` as the app destination.
- Never `git push` the app, add a git remote for it, or make a GitHub repository for it. DKOD makes the app's repository on the first Deliver. To give DKOD the code, follow "Push to prod".
- Never invent a Deploy answer. Ask the user every question you cannot answer from what they told you.
- Call `dkoder.remove` only when the user clearly asks to remove the app from production. Calling it is the yes.

## Start a session

1. Call `dkoder.session.start` with the app key. The app key is the app's short name in lowercase kebab-case, usually the app's repository or folder name. If there is no app yet, ask the user for the name.
2. Call `dkoder.policy` and `dkoder.templates` with the `sessionId`. Follow what they return while you write code.

## Push to prod

When the user says "push to prod" (or ship, deploy, go live), do all of these steps. Do not stop to ask between them, except for the questions DKOD asks.

1. Start a session (above).
2. Send the code (below).
3. If the app's folder has a `.env` file, fill the app's secrets from it (Secrets, below). Do not ask first. Use `.env.production` when there is one. Look only at the file names (`ls -a`); never open the file.
4. Deploy (below). When `dkoder.deploy.questions` answers `none: true`, call `dkoder.deploy` with no `deploy_answers`. When the app needs no database, pass `no_database: true`.
5. Follow the build with `dkoder.build.status` about every 30 seconds until its state is `delivered` or `failed`. Answer its own questions as Deploy step 6 says.
6. Reply with the app's production URL: the build's `deploy.url`, or `delivery.cluster.live_url`. If the build failed, say which step failed and why.

A person who is not an admin (a Builder) can deploy, follow, answer, fill secrets for and remove only the apps whose code they sent with `dkoder.source.target`. When a tool answers `admin role required`, tell the user its `message`.

## Send the code

DKOD builds the code you send it. Send it again after each change, before you deploy. No git is needed. The code goes straight to the organization's own storage; DKOD servers never read it, and DKOD's worker in the organization drops env files and secrets before it commits.

The pack scripts are in the `scripts` folder next to this SKILL.md file. They all do the same thing. Use the first one this computer can run:

| Check | Script | Run it as |
| --- | --- | --- |
| `node -v` | `dkod-pack.mjs` | `node <scripts>/dkod-pack.mjs` |
| `python3 -V` (Windows: `python -V`) | `dkod-pack.py` | `python3 <scripts>/dkod-pack.py` |
| `pwsh -v` | `dkod-pack.ps1` | `pwsh -NoProfile -File <scripts>/dkod-pack.ps1` |
| none of these | `dkod-pack.sh` | `sh <scripts>/dkod-pack.sh` |

1. Pack: run `<run it as> pack <the app's folder>`. It prints one JSON line: `file` (the archive), `sha256`, `bytes` and `files`. It leaves out `.env` files, `.git`, dependencies (`node_modules`, `.venv`) and build output (`dist`, `build`, `.next`), and honors `.gitignore` in a git repository.
2. Call `dkoder.source.target` with `sessionId`, `appKey`, `sha256` and `bytes`.
3. Upload: run `<run it as> put <file> <put_args>`, with the `put_args` it returned pasted exactly as given. It sends the archive to the organization's storage, then deletes it. `put_args` works once and expires in minutes; do not save it or show it.
4. Call `dkoder.source.done` with `sessionId`, `appKey`, the `slot` and `sha256`. When it answers `working`, call it again. When it answers `pushed`, the app is ready to deploy. When it refuses, tell the user why in one sentence.
5. If you stop before the upload ran, delete the archive `file`.

When `dkoder.source.target` answers `app_key_taken`, another app already has that key: ask the user for another app key and start a new session with it. For any other refusal, tell the user its `message`.

## Deploy

1. Call `dkoder.deploy.questions`. Ask the user each question. Use the question keys as `deploy_answers`. When it answers `none: true`, the org asks none: send no `deploy_answers`.
2. Call `dkoder.deploy.business_metrics` with the `app_key`. If it returns rows, show them and ask which to add.
3. Call `dkoder.deploy.database` with the `app_key`. Show its `summary` and its `notice`. If `change.kind` is not `none`, make that change on the laptop as `change.steps` say, test it against a local Postgres (PGlite is enough), and send the code again before you deploy. If `worker.state` is `queued`, call it again in a minute. Never ask for, read or send a database password: DKOD makes it.
4. Call `dkoder.deploy` with `app_key`, `deploy_answers`, and `business_metrics` (`"all"`, `"none"` or a list of ids). Pass `no_database: true` when the app needs no database from DKOD.
5. Follow the build with `dkoder.build.status` (the build `id`). Do not call `dkoder.deploy` again to check on it: after delivery that starts a new build.
6. If the build asks its own questions, ask the user, then call `dkoder.build.answer` with `sessionId`, the build `id`, the `key`, and a `value` (or `skip: true`).

## Secrets

The app's secret values never go through you. DKOD never sees them either.

- When the app needs secret values and the user has them in a `.env` file, and you have the tool `secrets_from_env` (Dkoder's own, `mcp__dkod__secrets_from_env`, in Claude Code): call it with the `appKey` and the file's path in `envFile`. Dkoder reads the file on this computer, seals each value for the apps cluster and sends only the sealed text. The answer has names and counts.
- Without that tool (for example in Cursor), use `dkod-secrets.mjs` in the `scripts` folder next to this file. It needs Node (`node -v`).
  1. Call `dkoder.secrets.target` with `sessionId` and `appKey`. Write its answer, as it is, to a new file in the system's temp folder, never in the app's folder. It holds names and a public certificate, no value.
  2. Run `node <scripts>/dkod-secrets.mjs seal <the .env file> <that file>`. It reads the `.env` file and seals each value on this computer. It prints one JSON line: the names and `save`.
  3. When `save` is not null, call `dkoder.secrets.save` with `sessionId`, `appKey`, and `certFingerprint` and `secrets` from `save`, copied exactly.
  4. Delete the file from step 1.
  5. When there is no Node, fill nothing: tell the user the names the app needs, and that they type the values in the dashboard: Launchpad, the app, Replace secrets.
- When `dkoder.secrets.target` answers `app_no_target`, fill the secrets after the first `dkoder.deploy`, then deploy again.
- Never read a `.env` file, never print one, and never put a secret value in a tool call, a file or a message. `dkoder.build.answer` is not for secret values.
- Tell the user what the answer says: which names it filled, which are `missing`, and which it did not fill and why (`local` points at this computer, `reference` refers to another name). For those, the user types the production value in the dashboard: Launchpad, the app, Replace secrets.
- It fills only the names the app's code reads. Pass `addOtherNames: true` (the script: `--others`) only when the user asks for the other names too.
- The values apply on the next deploy.

## Ship

After Deploy, the build delivers on its own once every answer is in and every gate (if the org has one) is approved: no second click. Watch it with `dkoder.build.status`. Call `dkoder.deliver` with `sessionId` and the build `id` only for a build that is ready but did not move on. DKOD writes the code to the app repository and the GitOps repository; nobody pushes by hand. `dkoder.delivered` (repo, commit) says whether Deliver wrote a commit.

Use `dkoder.session.append` to record a step in the session: one `event` from its fixed list (for example `tests_passed` or `delivered`), with an optional build id and count. It takes no free text, because DKOD never receives your code.
