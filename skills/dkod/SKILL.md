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
3. Deploy (below). When `dkoder.deploy.questions` answers `none: true`, call `dkoder.deploy` with no `deploy_answers`. When the app needs no database, pass `no_database: true`.
4. Follow the build with `dkoder.build.status` about every 30 seconds until its state is `delivered` or `failed`. Answer its own questions as Deploy step 6 says.
5. Reply with the app's production URL: the build's `deploy.url`, or `delivery.cluster.live_url`. If the build failed, say which step failed and why.

## Send the code

DKOD builds the code you send it. Send it again after each change, before you deploy. The code goes straight to the organization's own storage; DKOD servers never read it, and DKOD's worker in the organization drops env files and secrets before it commits.

1. If the folder is not a git repository, run `git init -q`. It is only for the file list. Never commit for DKOD, never add a remote, never push.
2. Make the archive. Run this in the app's folder, as one command:

   ```sh
   d="$(mktemp -d)" && git ls-files -co --exclude-standard -z -- . ':(exclude,glob)**/.env*' | COPYFILE_DISABLE=1 tar -c --format ustar --no-recursion --null -T - -f "$d/src.tar" && shasum -a 256 "$d/src.tar" && wc -c < "$d/src.tar"
   ```

   It holds the files git would keep (`.gitignore` is honored) and never a `.env` file. It prints the SHA-256 and the archive's path (ending in `/src.tar`) on one line, then the size in bytes. Where there is no `shasum`, put `sha256sum` in its place.
3. Call `dkoder.source.target` with `sessionId`, `appKey`, `sha256`, `bytes`, and the archive's path as `file`. Run the `command` it returns in the terminal, exactly as given. It sends the archive and then deletes it. It works once and expires in minutes; do not save it or show it.
4. Call `dkoder.source.done` with `sessionId`, `appKey`, the `slot` and `sha256`. When it answers `working`, call it again. When it answers `pushed`, the app is ready to deploy. When it refuses, tell the user why in one sentence.
5. If you stop before the upload command ran, delete the archive's folder (the path without `/src.tar`) with `rm -r`.

When `dkoder.source.target` answers `candidate_push_disabled`, your organization does not take app code yet. Tell the user that an admin turns it on in the DKOD dashboard: Settings, Data handling, "Push candidate source to GitHub". When it answers `app_key_taken`, a computer DKOD scans already has an app with that key: ask the user for another app key and start a new session with it.

## Deploy

1. Call `dkoder.deploy.questions`. Ask the user each question. Use the question keys as `deploy_answers`. When it answers `none: true`, the org asks none: send no `deploy_answers`.
2. Call `dkoder.deploy.business_metrics` with the `app_key`. If it returns rows, show them and ask which to add.
3. Call `dkoder.deploy.database` with the `app_key`. Show its `summary` and its `notice`. If `change.kind` is not `none`, make that change on the laptop as `change.steps` say, test it against a local Postgres (PGlite is enough), and send the code again before you deploy. If `worker.state` is `queued`, call it again in a minute. Never ask for, read or send a database password: DKOD makes it.
4. Call `dkoder.deploy` with `app_key`, `deploy_answers`, and `business_metrics` (`"all"`, `"none"` or a list of ids). Pass `no_database: true` when the app needs no database from DKOD.
5. Follow the build with `dkoder.build.status` (the build `id`). Do not call `dkoder.deploy` again to check on it: after delivery that starts a new build.
6. If the build asks its own questions, ask the user, then call `dkoder.build.answer` with `sessionId`, the build `id`, the `key`, and a `value` (or `skip: true`).

## Secrets

The app's secret values never go through you. DKOD never sees them either.

- When the app needs secret values and the user has them in a `.env` file, call `secrets_from_env` (Dkoder's own tool, `mcp__dkod__secrets_from_env`) with the `appKey` and the file's path in `envFile`. Dkoder reads the file on this computer, seals each value for the apps cluster and sends only the sealed text. The answer has names and counts.
- Never read a `.env` file, never print one, and never put a secret value in a tool call, a file or a message. `dkoder.build.answer` is not for secret values.
- Tell the user what the answer says: which names it filled, which are `missing`, and which it did not fill and why (`local` points at this computer, `reference` refers to another name). For those, the user types the production value in the dashboard: Launchpad, the app, Replace secrets.
- It fills only the names the app's code reads. Pass `addOtherNames: true` only when the user asks for the other names too.
- The values apply on the next deploy.

## Ship

After Deploy, the build delivers on its own once every answer is in and every gate (if the org has one) is approved: no second click. Watch it with `dkoder.build.status`. Call `dkoder.deliver` with `sessionId` and the build `id` only for a build that is ready but did not move on. DKOD writes the code to the app repository and the GitOps repository; nobody pushes by hand. `dkoder.delivered` (repo, commit) says whether Deliver wrote a commit.

Use `dkoder.session.append` to record a step in the session: one `event` from its fixed list (for example `tests_passed` or `delivered`), with an optional build id and count. It takes no free text, because DKOD never receives your code.
