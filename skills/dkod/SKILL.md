---
name: dkod
description: Use for any request to build, create, change, fix, run, ship, deploy, "push to prod" or remove an app or code on this computer: it all goes through the company's DKOD, starting with a DKOD session. Also when the user asks what the org's policy or templates are, or wants to push or merge app code. Covers the dkoder MCP tools (session, policy, templates, sending the code, deploy questions, deploy, build answers, deliver, remove) and how Dkoder and the org's Guard rules treat pushes.
---

# DKOD

DKOD is the company's platform. It holds the org's policy, its app templates and its Deploy rules. The `dkod` MCP server that comes with Dkoder gives you its tools; their names end in `dkoder_<name>` (for example `dkoder.deliver`).

If a tool says the server needs sign-in, or the DKOD band above the prompt is yellow, tell the user: Sign in to DKOD at <your DKOD dashboard>/auth/org/start, then connect dkod: in Cursor, Settings, MCP, dkod, Connect; in Claude Code, type /mcp, pick dkod, Authenticate. They sign in with their company's own sign-in. In the Cursor CLI (`cursor-agent`), add the dkod server to `~/.cursor/mcp.json` and run `cursor-agent mcp login dkod` in the project folder; the sign-in is per project folder.

## The rules

- App code ships through Deliver (`dkoder.deliver`). Dkoder refuses `git push`, `gh pr merge` and GitHub API writes to the org's app repositories. Guard adds the org's own rules from its governance repo once the person signs in. When Dkoder or Guard refuses a call, tell the user why in one or two sentences and offer Deliver. Do not try another way around it.
- Pushes to the governance repository are allowed.
- When a dkod tool returns an error, stop. Do not retry it. Tell the user the one line it gives, and nothing more.
- Never write a secret value into a file. Put the name of the secret there and resolve it at run time.
- The app lives in the customer's GitHub org. Never use `dkod-ai/` as the app destination.
- Never `git push` the app, add a git remote for it, or make a GitHub repository for it. DKOD makes the app's repository on the first Deliver. To give DKOD the code, follow "Push to prod".
- Never invent a Deploy answer. Ask the user every question you cannot answer from what they told you.
- Call `dkoder.remove` only when the user clearly asks to remove the app from production. Calling it is the yes.
- Read the org's templates and policy only through the dkod tools (`dkoder.templates`, `dkoder.policy`). Each template comes with its text in `content`. Never search the disk, GitHub or the governance repository for them.
- The template is DKOD's choice. Never ask the Builder which template to use, and never ask whether to continue with DKOD's pick. If the pick looks wrong, say so in the result and go on.
- Push to prod needs no git and no `gh`. Do not check GitHub sign-in, git remotes or repositories.
- Never run git for the app, not even `git init`: DKOD needs none.
- Scratch files: at the start of a run make one folder with `mktemp -d` (on Windows, a new folder with a random name under $env:TEMP) and keep every file you write outside the app's folder there: the policy answer, the pack scripts from `dkoder.guide`, the secrets target, the policy pack, the capture script, and the output of your own commands (`curl -o`, `wget -O`, saved answers, notes, logs). Never write to a fixed /tmp/<name>: other users of this computer may own it, and Cursor refuses it.

## Start a session

Start a session first, before you plan, ask questions, make a folder or write a file, for any code work, not only deploys. The org's templates and policy decide the stack and where things go. In Cursor, Dkoder refuses file writes and commands that change anything until the chat has a session.

1. Call `dkoder.session.start` with the app key and `pluginVersion: "0.17.71"` (the version of this skill). When the result has `plugin_update`, the plugin on this machine is old: run the command in it for this tool (Cursor or Claude Code), tell the user in one line that the plugin is updated, read this SKILL.md again from disk, and go on with its new text, not the text loaded earlier in the session. In Cursor that is `dkod-update.mjs` in the `scripts` folder next to this file: it needs no git. Never update the plugin with git. The app key is the app folder's own name (the last part of its path, lowercase kebab-case). Never use a name read from package.json, inventory.json, a README or the chat, even when the user names the app differently. When you are unsure (no folder yet, or the folder's name is not a valid key), ask the user and show the key the folder gives.

2. Call `dkoder.policy` and `dkoder.templates` with the `sessionId`. Follow what they return while you write code. When a template has `content: null`, DKOD could not read it now: work from its `name` and `description`, and do not look for the file anywhere else.
3. When the user asks for a new app (there is no code for it yet), run the wizard (below) before you plan or write any code.

## Code graph: ask graphify before you read files

Right after the session starts, and before you read or search the project's files, make sure the project has a code graph. graphify (https://github.com/Graphify-Labs/graphify) maps the code once on this computer; then you ask the graph instead of reading file after file. That saves most of the tokens and time a large app costs, above all in a migration.

1. Run `node <scripts>/dkod-graph.mjs ensure <the app's folder>`, as one command on its own. In a migration, the dkod-migrate skill runs it with `--out`, because the original is read only. `<scripts>` is the `scripts` folder next to this file (or `dkod-graph.mjs` from `dkoder.guide`, as in "Send the code").
2. It installs graphify when it is missing (`uv tool install graphifyy`, else `pipx`), builds or refreshes the graph, and prints one JSON line. Installing is the only step that uses the network. The graph is made on this computer only: graphify has no telemetry, and the script runs it with no AI backend, no AI key, no query log and no tips, so no file and no question leaves the computer. When `installed` is set, tell the builder in one line that graphify was installed.
3. Read `report` (GRAPH_REPORT.md) first: the main parts of the app and how they connect. Then ask the graph with the commands in `ask`, always through the script: `node <scripts>/dkod-graph.mjs query "<question>" <graph>`, `node <scripts>/dkod-graph.mjs explain "<name>" <graph>`, `node <scripts>/dkod-graph.mjs path "<A>" "<B>" <graph>`. Open a file only where the graph points, and read only the lines you need. Use grep only for what the graph does not hold, such as config values, strings and CSS.
4. After you change many files, or when an answer looks out of date, run `ensure` again: it refreshes the graph from its cache.
5. On exit 2, graphify is missing and could not be installed: tell the builder the `install` line once, and work without the graph. On exit 1, tell the builder the `reason` in one line, and work without the graph. Never stop the DKOD work because of the graph.

- The graph stays on this computer. `ensure` adds `graphify-out/` to the app's `.gitignore`, and the pack scripts never send it.
- Never run `graphify` yourself: only through `dkod-graph.mjs`, which keeps it local. Never run `graphify install`, `graphify hook install` or the `/graphify` skill, and never give graphify an AI backend, an API key or `--backend`: they would send the builder's files to an AI service.

## New app: the wizard

The wizard asks the org's own questions for a new app, writes a PRD (the plan) for the user to approve, and then you build and test the app on this computer. Skip it when the app already has code, or when the user asks only for a change.

1. Call `dkoder.wizard.questions` with the `sessionId`. When the user attached a spec, send its text as `spec` and its file name as `spec_name` (prose only, no code or secrets): questions the spec clearly answers are not returned. Ask the questions only in this chat. Never open a web page or a browser for them.
2. The answer has the next `questions`, at most 4. Ask them with the client's question tool (in Cursor the question tool, in Claude Code `AskUserQuestion`), all in one turn:
   - Show each question's `why` under it.
   - A `choice` takes one option, a `multi` one or more. Put the `recommended` option first and mark it "(Recommended)".
   - A `text` question takes the user's own words. Show its `example`.
   - When the chosen option has `asks_emails`, ask for the email addresses too.
   - Never answer a question for the user, and never skip one.
3. Call `dkoder.wizard.answer` with the `sessionId` and `answers` by question `id`: `{ "option": "<id>" }`, `{ "options": ["<id>", ...] }`, or `{ "text": "..." }`, with `emails` where an option asks them. It returns the next questions. When it refuses an answer, ask the user that question again. Repeat until it answers `done: true`.
4. Call `dkoder.wizard.prd` with the `sessionId`. Show the PRD's summary in a few lines. Then ask with the client's question tool, one question with two options: "Approve" and "Change an answer". The user clicks; they never have to type.
   - On "Approve", call `dkoder.wizard.approve` with the `sessionId` and the `prd_at` exactly as given. It answers `approved` with the `template`, the `required_checks` and `deploy_answers`.
   - On "Change an answer", ask which answer and the new one, send it with `dkoder.wizard.answer`, call `dkoder.wizard.prd` again and ask again.
   - Never call `dkoder.wizard.approve` unless the user clicked "Approve". Write no code before it answers `approved`.
5. Build the app in its local folder from the template the PRD names (its text is in `dkoder.templates`). Copy the template's check scripts into `package.json`. Never write a scanner or checker of your own.
6. Test it on this computer. Install the dependencies (`bun install` for a bun template). Run every script in the PRD's "Required checks" (`bun run <name>`) and the policy checks (Policy checks, below). For a web app, start it and open it in a browser (Cursor's browser, or the browser tools you have), and check each page the PRD lists. For a service, start it and call its health endpoint. Fix what fails and run all of it again until everything passes.
7. Tell the user the app is ready and what passed. Keep the `deploy_answers` (from `dkoder.wizard.prd`): "Push to prod" uses them.

## Policy checks

The org's rules come with checks: `policy_pack` in the answer of `dkoder.policy`. Each check has a level. `block` must pass. `warn` is told to the user.

- In Claude Code, Dkoder runs the checks on every file write and commit. It refuses one that breaks a `block` check and says the file, the line and the rule. Change the code so it follows the rule. Do not try another way around it.
- Before you send the code, run every check on the app's folder. The code is read on this computer and is not sent.
  - With the tool `policy_check` (Dkoder's own, `mcp__dkod__policy_check`, in Claude Code): call it with the app's folder in `path`.
  - Without that tool (for example in Cursor), use `dkod-policy.mjs` in the `scripts` folder next to this file (or from `dkoder.guide`, as in "Send the code"). It needs Node (`node -v`). Write the answer of `dkoder.policy`, as it is, to a new file in the run's scratch folder (`mktemp -d`), never in the app's folder. Run `node <scripts>/dkod-policy.mjs check <that file> <the app's folder>`. It prints one JSON line. Delete the file after.
- The answer lists `findings`: rule, file, line and what to change. Fix every `block` finding and run the check again until `blocked` is false. Then tell the user each `warn` finding in one line.
- When there is no Node, tell the user the checks could not run on this computer.

## Cursor: allow the dkod tools

In Cursor, Auto-review can stop each dkod tool call and each DKOD script, and wait for the user to approve it. The fix is Cursor's allowlist. When a dkod call or script waits for approval, tell the user this once. Write the file only when the user asks you to.

- The file is `~/.cursor/permissions.json`. It applies to all projects. Put these two lists in it:

  ```json
  {
    "mcpAllowlist": ["dkod:*", "plugin-dkod-dkod:*"],
    "terminalAllowlist": ["node <scripts>/dkod-"]
  }
  ```

- `plugin-dkod-dkod` is the plugin's server. `dkod` is a server the user added by hand.
- In `terminalAllowlist`, write `<scripts>` as the full path of the `scripts` folder next to this file. Cursor then runs each DKOD script, the questions to the code graph among them, with no stop.
- These lists replace the allowlists in Cursor's settings. Copy the entries from there into the file too.
- Run Mode must be Auto-review, Allowlist or Run Everything. Cursor reads the file again by itself.
- "Allowlist (with Sandbox)" runs even the allowed DKOD scripts in Cursor's sandbox. The sandbox does not let a command write in `~/.cursor`, so `dkod-update.mjs` cannot update the plugin there. When a DKOD script says "Cursor's sandbox", tell the user: Cursor Settings, Agents, Run Mode: choose "Allowlist". Then run the script again. Cursor can ask once to approve the update; the user clicks Run.
- A Cursor team admin can set the same lists for everyone in the team dashboard.

## Cloud sessions

A cloud session (Claude Code on the web or the Desktop app's Cloud, a Cursor cloud agent) runs on another computer. Plugins do not load there, so this skill and its `scripts` folder may not be on disk. The DKOD MCP server works there when the user added it to that cloud:

- Claude Code cloud: on claude.ai, Settings, Connectors, add a custom connector with the DKOD MCP URL (`https://dashboard.dkod.app/api/v1/dkoder/mcp`, or the org's own dashboard), then sign in.
- Cursor cloud agent: add the same URL in the MCP list at cursor.com/agents. A Cursor team admin can add it for the whole team under Integrations & MCP.

When the dkod tools are missing in a cloud session, tell the user these steps. When there is no dkod skill on disk, call `dkoder.guide`: it returns this text and the names of the scripts. A `.env` file is usually not in a cloud copy of the code: then fill no secrets from it, and tell the user the names the app needs and that they type the values in the dashboard.

## Push to prod

When the user says "push to prod" (or ship, deploy, go live), do all of these steps. Do not stop to ask between them, except for the questions DKOD asks.

1. Start a session (above).
   - When the app is one DKOD did not build (its code was not made by the wizard or by a DKOD template), or when `dkoder.session.start` answered with a `migration`, do not deploy it: run the `dkod-migrate` skill's steps first. That skill sits next to this one; when it is not on disk, call `dkoder.guide` with `skill: "dkod-migrate"`.
2. Check the code again, every time, even when it passed before: run every required check script (the PRD's "Required checks", or `policy.required_checks` from `dkoder.policy`) and the policy checks (above). When anything fails, stop: fix it and run all of it again. Ship nothing that fails.
3. Send the code (below). Run each DKOD script as one command on its own, exactly as `node <scripts>/dkod-pack.mjs ...`. Write `<scripts>` as a full path, with no quotes. Never chain it with another command by `&&` or `;`. Then Cursor's allowlist matches it. When `put` fails with "expired", call `dkoder.source.target` again, then run `put <file> --ticket <the new upload_ticket>`.
4. If the app's folder has a `.env` file, fill the app's secrets from it (Secrets, below). Do not ask first. Use `.env.production` when there is one. Look only at the file names (`ls -a`); never open the file.
5. Deploy (below). When this app went through the wizard, pass the `deploy_answers` from `dkoder.wizard.prd` as they are, and do not ask the Deploy questions again. When `dkoder.deploy.questions` answers `none: true`, call `dkoder.deploy` with no `deploy_answers`. When the app needs no database, pass `no_database: true`.
6. Follow the build with `dkoder.build.status` about every 30 seconds until its state is `delivered` or `failed`. Answer its own questions as Deploy step 6 says.
7. Reply with the app's production URL: the build's `deploy.url`, or `delivery.cluster.live_url`, and whether it is up yet. If the build failed, say which step failed and why, in plain words.

Git and GitHub are DKOD's work, not the user's. When you report, never name repositories, commits, pull requests, branches, GitOps or GitHub access (the one `preflight` line of `dkoder.source.target`, which names the local folder, branch and commit, is the only exception), and never ask the user to do anything on GitHub. A setup problem only an admin can fix goes to the org's admins by itself.

A person who is not an admin (a Builder) can deploy, follow, answer, fill secrets for and remove only the apps whose code they sent with `dkoder.source.target`. When a tool answers `admin role required`, tell the user its `message`.

## Send the code

DKOD builds the code you send it. Send it again after each change, before you deploy. No git is needed. The code goes straight to the organization's own storage; DKOD servers never read it, and DKOD's worker in the organization drops env files and secrets before it commits.

The pack scripts are in the `scripts` folder next to this SKILL.md file. When that folder is not on disk (a cloud session, or this text came from `dkoder.guide`), call `dkoder.guide` with `script` set to the script's name, write its `content` to a new file in the run's scratch folder (`mktemp -d`, never the app's folder), and use that folder as `<scripts>`. They all do the same thing. Use the first one this computer can run:

| Check | Script | Run it as |
| --- | --- | --- |
| `node -v` | `dkod-pack.mjs` | `node <scripts>/dkod-pack.mjs` |
| `python3 -V` (Windows: `python -V`) | `dkod-pack.py` | `python3 <scripts>/dkod-pack.py` |
| `pwsh -v` | `dkod-pack.ps1` | `pwsh -NoProfile -File <scripts>/dkod-pack.ps1` |
| none of these | `dkod-pack.sh` | `sh <scripts>/dkod-pack.sh` |

On a Mac, `/usr/bin/python3` can be Apple's installer and not Python: running it opens a window that asks to install the developer tools. So on a Mac, when `command -v python3` prints `/usr/bin/python3` and `xcode-select -p` fails, do not run `python3 -V`: skip that row.

1. Pack: run `<run it as> pack <the app's folder>`. It prints one JSON line: `file` (the archive), `sha256`, `bytes`, `files` and, in a git folder with a commit, `git` (`folder`, `branch`, `head`, `head_at`, `dirty`). It leaves out `.env` files, `.git`, dependencies (`node_modules`, `.venv`), build output (`dist`, `build`, `.next`) and test reports (`test-results`, `playwright-report`), and honors the root `.gitignore` in a git repository and also outside git (plain names, `dir/`, simple `*` globs; a `!` negation line is not supported and is skipped).
2. Call `dkoder.source.target` with `sessionId`, `appKey`, `sha256` and `bytes`, and `git` as the pack script printed it when it printed one. When the answer has `preflight`, tell the user that one line first (folder, branch, commit, uncommitted files). When it has `warnings`, show each `message` and ask the user once whether to send this code anyway. Run `put` only after they say yes. With no warning, go on without asking.
3. Upload: run `<run it as> put <file> --ticket <upload_ticket>`, with the `upload_ticket` it returned, exactly as given. The script trades the ticket for the signed upload link itself, so you never write, show or see an upload URL. It sends the archive to the organization's storage, then deletes it. The ticket works once and expires after an hour; do not save it. When `put` fails with "expired", call `dkoder.source.target` again for a new `upload_ticket`.
4. Call `dkoder.source.done` with `sessionId`, `appKey`, the `slot` and `sha256`. When it answers `working`, call it again. When it answers `pushed`, the app is ready to deploy. When it refuses, tell the user why in one sentence.
5. If you stop before the upload ran, delete the archive `file`.

When `dkoder.source.target` answers `app_key_taken`, another app already has that key: ask the user for another app key and start a new session with it. For any other refusal, tell the user its `message`.

## Deploy

1. When you have `deploy_answers` from `dkoder.wizard.prd`, use them and skip this step. Otherwise call `dkoder.deploy.questions`. Ask the user each question. Use the question keys as `deploy_answers`. When it answers `none: true`, the org asks none: send no `deploy_answers`. When `dkoder.deploy` refuses the wizard's answers (the org changed its questions), call `dkoder.wizard.questions` and ask only what it returns.
2. Call `dkoder.deploy.business_metrics` with the `app_key`. If it returns rows, show them and ask which to add.
3. Call `dkoder.deploy.database` with the `app_key`. Show its `summary` and its `notice`. If `change.kind` is not `none`, make that change on the laptop as `change.steps` say, test it against a local Postgres (PGlite is enough), and send the code again before you deploy. If `worker.state` is `queued`, call it again in a minute. Never ask for, read or send a database password: DKOD makes it.
4. Call `dkoder.deploy` with `app_key`, `deploy_answers`, and `business_metrics` (`"all"`, `"none"` or a list of ids). Pass `no_database: true` when the app needs no database from DKOD.
5. Follow the build with `dkoder.build.status` (the build `id`). Do not call `dkoder.deploy` again to check on it: after delivery that starts a new build.
6. If the build asks its own questions, ask the user, then call `dkoder.build.answer` with `sessionId`, the build `id`, the `key`, and a `value` (or `skip: true`).

## Secrets

The app's secret values never go through you. DKOD never sees them either.

- When the app needs secret values and the user has them in a `.env` file, and you have the tool `secrets_from_env` (Dkoder's own, `mcp__dkod__secrets_from_env`, in Claude Code): call it with the `appKey` and the file's path in `envFile`. Dkoder reads the file on this computer, seals each value for the apps cluster and sends only the sealed text. The answer has names and counts.
- Without that tool (for example in Cursor), use `dkod-secrets.mjs` in the `scripts` folder next to this file (or from `dkoder.guide`, as in "Send the code"). It needs Node (`node -v`).
  1. Call `dkoder.secrets.target` with `sessionId` and `appKey`. Write its answer, as it is, to a new file in the run's scratch folder (`mktemp -d`), never in the app's folder. It holds names and a public certificate, no value.
  2. Run `node <scripts>/dkod-secrets.mjs seal <the .env file> <that file>`. It reads the `.env` file and seals each value on this computer. It prints one JSON line: the names and `save`.
  3. When `save` is not null, call `dkoder.secrets.save` with `sessionId`, `appKey`, and `certFingerprint` and `secrets` from `save`, copied exactly.
  4. Delete the file from step 1.
  5. When there is no Node, fill nothing: tell the user the names the app needs, and that they type the values in the dashboard: Launchpad, the app, Replace secrets.
- When `dkoder.secrets.target` answers `app_no_target`, fill the secrets after the first `dkoder.deploy`, then deploy again.
- Never read a `.env` file, never print one, and never put a secret value in a tool call, a file or a message. `dkoder.build.answer` is not for secret values.
- Tell the user what the answer says: which names it filled, which are `missing`, and which it did not fill and why (`local` points at this computer, `reference` refers to another name). For those, the user types the production value in the dashboard: Launchpad, the app, Replace secrets.
- It fills only the names the app's code reads. Pass `addOtherNames: true` (the script: `--others`) only when the user asks for the other names too.
- The values apply on the next deploy.
- When a deploy is held because the app reads values it does not have, call `dkoder.secrets.target`: those names are in `unset`. Ask the user about each one. A name with a value: fill it as above. A name the app does not need (the code has a default, or the feature is off, for example an old sign-in provider): call `dkoder.secrets.skip` with `sessionId`, `appKey` and `skip`, the names the user said are not needed. Never mark a name not needed without asking. Then deploy again.

## Dev database

First call `dkoder.devdb.status` with the app's key. Owner or admin only.

- `missing`: ask the person in the chat whether the app keeps data. If yes, call `dkoder.devdb.make` with `confirm: true`; without it the tool only says what it would make.
- `making`: DKOD made it and nobody has opened it yet. Start the helper now, below: the token it is handed is what turns Making into Ready.
- `ready`: the helper was handed a token before. Start it, below.
- `kept`: the app had one and it was dropped. Ask the person before you make it again.
- To delete the Dev database (a cancelled migration, a stuck `making`): ask the person first, since its data is lost, then call `dkoder.devdb.delete` with `confirm: true`. `dkoder.devdb.status` says `missing` afterwards.
- `no_dev_instance`, `off`, `no_app_databases`, `no_cloud_environment`: the organization's Dev instance is not made yet. Tell the person, and that an admin finishes it in Setup: Dev database.

When the plan's `change.kind` is not `none`, do the steps `dkoder.deploy.database` gives, including the `0001_baseline` migration, then run `node "<scripts>/dkod-db.mjs" migrate`. Dev and Prod then start from the same schema.

When the app has a Dev database, start the helper at the start of work, as a BACKGROUND command: `node "<scripts>/dkod-db.mjs" up --app <app key>` (in Claude Code, Bash with `run_in_background`; it stops when the session ends). In Cursor, or any agent with no background tool, run the one command `node "<scripts>/dkod-db.mjs" up --app <app key> --detach` (no `&&`, so the allowlist matches it): it starts the tunnel as a detached process, returns one JSON line once the database answers, and the tunnel keeps running. `node "<scripts>/dkod-db.mjs" down` stops it. `<scripts>` is the `scripts` folder next to this file. It needs Node (`node -v`) and this computer's Dkoder device token.

- It waits (up to 10 minutes, `--wait <seconds>` changes it) until the database answers `select 1`, and prints its ready line only then. If it exits saying the Dev database does not exist, follow that sentence: `dkoder.devdb.status`, then `dkoder.devdb.make` with `confirm: true` when it says `missing`, then run `up` again. Never run Docker or a local Postgres for it.
- It opens Postgres on `127.0.0.1:6543` and writes `DATABASE_URL` into the app's `.env.local`. The URL has no password: there is none. Never ask the user for a database password, and never put one in a file.
- It prints one ready line. If it exits with a sentence (not a member, no default domain, port busy), tell the user that sentence.
- After you add a migration, run `node "<scripts>/dkod-db.mjs" migrate` in the app's folder. It runs Drizzle or Alembic against the Dev database and prints a short summary.
- If `.env.local` is not in `.gitignore`, the helper warns. Add it to `.gitignore`.
- Never put a password, a token or a row in a message, a file or a tool call. `dkoder.devdb.status`, `dkoder.devdb.make` and `dkoder.devdb.delete` answer names and a state only.

## Ship

After Deploy, the build delivers on its own once every answer is in and every gate (if the org has one) is approved: no second click. Watch it with `dkoder.build.status`. Call `dkoder.deliver` with `sessionId` and the build `id` only for a build that is ready but did not move on. DKOD writes the code to the app repository and the GitOps repository; nobody pushes by hand. `dkoder.delivered` (repo, commit) says whether Deliver wrote a commit.

Use `dkoder.session.append` to record a step in the session: one `event` from its fixed list (for example `tests_passed` or `delivered`), with an optional build id and count. It takes no free text, because DKOD never receives your code.
