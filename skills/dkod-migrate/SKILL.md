---
name: dkod-migrate
description: Use when the builder says deploy, ship, migrate or "push to prod" for an app DKOD did not build, or when dkoder.session.start answers with a migration. The short, tracked steps that turn that app into a dk- app, bring its data into Dev and deploy it.
---

# Migrate an app DKOD did not build

The goal is simple: the app runs on DKOD, with its data. Copy the app's code into a new dk- app, fit it to the org's template, copy its data into Dev, and deploy. Do not rebuild the app from scratch and do not check it page by page: the builder looks at it after the deploy.

## Rules

- Keep going. Do the steps below one after the other in the same turn. Do not stop to report a step, and do not end your turn when a command or a background job finishes: read its output and go on. Stop only to ask the builder a question this file names, or when a step fails with a sentence you must show the builder.
- Only the builder answers this file's questions. When the question tool comes back with no answer (skipped, rejected, or "continue with the information you already have"), ask the same question in plain text with its options and end your turn. Never pick an option yourself.
- Run every DKOD script in the foreground, as one command on its own (no `&&`, no `;`, no `&`), so it returns its answer to you. `<scripts>` is the dkod skill's `scripts` folder (next to its SKILL.md). `<migrate>` is this skill's `scripts/dkod-migrate.mjs`.
- The original app is read only. Never write, install, build or generate anything in its folder, and never start it.
- Never change the builder's data stores or their users: no `ALTER ROLE`, `GRANT`, `CREATE DATABASE`, `createdb`, `dropdb`, no new local data store, no containers. The snapshot only reads the original's store. If it cannot read it, show the builder the sentence it printed and wait.
- Do not make a code graph in a migration, and do not write an app map, screenshots or a parity suite: this migration does not use them.
- Keep scratch files in one run folder: `mktemp -d` once at the start (the dkod skill's scratch-files rule), never in the app folders.
- Never do a step twice. An app that is already migrating, or already in prod, is continued: "Continue a migration" (below) says how. Start over only when the builder chose Start over.

## Steps

### 1. Start

1. Start a DKOD session as the dkod skill says. The app key is the original folder's own name (a folder `aisf-test-dko1411-x` gives `aisf-test-dko1411-x`; a different name in the request is not used). The dk- app's key is `dk-<that key>` (`dk-aisf-test-dko1411-x`).
2. Call `dkoder.migrate.start` with the `sessionId` and the app key. Keep `folder`, `templates` and `service_rules` from its answer. Never pick a template yourself. When its answer has `resumed: true`, the app is already migrating or already shipped: keep its `done` and do "Continue a migration" (below) after this step 1.
3. Make the `folder` it returned beside the original's folder (`<parent of the original>/dk-<key>`). When that folder is already there and the answer has `resumed: true`, use the folder as it is: ask nothing. When it is already there with no `resumed` (an earlier try was given up), ask the builder once: "dk-<key> is already there from an earlier try. Go on with it, or start over? Start over keeps the old folder as dk-<key>.old-<date> and deletes this app's Dev data." with the options "Go on" and "Start over" (the question tool; without one, ask in plain text and wait). On "Go on", use the folder as it is. On "Start over" (here, or when the builder asks for it at any time), rename the folder to `dk-<key>.old-<YYYYMMDD-HHMM>` with `mv` (never delete it), call `dkoder.devdb.delete` with the original's app key and `confirm: true`, call `dkoder.migrate.start` again with `restart: true`, then make the folder new. Write `<folder>/.dkod/migration.json` with the Write tool, exactly two fields: `original` (the original folder's absolute path) and `appKey` (the original's key).
4. Make the run folder with `mktemp -d`.

### 2. Snapshot the data

Run `node <migrate> snapshot <folder>`. It finds the original's data: the data URL in its `.env.local` or `.env` (also in the app's own subfolder, such as `gBall/.env.local`), single-file stores and data files. It only reads them. It prints one JSON line.

- `"mode":"snapshot"`: go on.
- `"mode":"new-app-only"`: it found no data. Run `node <scripts>/dkod-db.mjs detect --dir <the original's folder>`. When detect says `uses_database: true`, ask the builder for the original's data URL, then run snapshot again with `--db-url <url>`. Otherwise go on: the app has no data to bring.
- Exit 1: show the builder the sentence it printed, and wait for the answer.

### 3. Make the dk- app

1. Render the org's template: the one `dkoder.migrate.start` named for this kind of app. Save its `content` to a file in the run folder, and its `dkod` and `policy` values to `values.json` beside it (`{ "policy": {...}, "dkod": {...} }`). Run `node <migrate> render <that template file> <folder> <values.json>`. On `gaps`, answer them in `values.json` and run it again.
2. Copy the original's code into the `folder`: the folder the app runs from (where its package manifest and its start command are; in a repository with the app in a subfolder, that subfolder). Copy source, config, public files and the files the app reads at run time. Never copy `.env` files, `.git`, dependency folders, build output, single-file stores or the snapshot's data. Where the template wrote a file (Dockerfile, CI, `.dockerignore`), keep the template's file and never edit it: DKOD writes it again from the org's template at deploy, so an edit there never ships. Fit the app's code instead.
3. Fit the code to the template and the org's rules, and change nothing else: the start command and port the template expects, a server that listens on `0.0.0.0` in the container (an app that listens on `127.0.0.1` by default must listen on `0.0.0.0` when `PORT` is set or `NODE_ENV` is `production`, changed in its code: else every probe fails and the pod restarts), the probes (`/healthz`, `/readyz`, `/startupz`), JSON logs, a numeric non-root user, and `DATABASE_URL` as the name of the data URL. Each store and service follows `service_rules`: `stub` an in-process stub, `keep` a Dev instance by setting names, `public-read-only` GET/HEAD only with no credential, `refuse` the app runs without it. Never give the dk- app a real credential.
4. Install its dependencies in the `folder` with the package manager the dkod skill names for its stack, and keep the lock file. Make sure `.gitignore` covers `.env.local`.

### 4. Bring the data into Dev

Skip this step when the snapshot said `new-app-only` and the app keeps no data.

1. Call `dkoder.devdb.status` with the original's app key (never the `dk-` key). Call `dkoder.devdb.make` with `confirm: true` when it says `missing`.
2. Run `node <scripts>/dkod-db.mjs up --app <original key> --dir <folder> --detach`. It writes `DATABASE_URL` into `<folder>/.env.local`. When it asks for a code, do what the dkod skill's "Dev database" section says.
3. Run `node <scripts>/dkod-db.mjs migrate --dir <folder>`: the dk- app's own migrations make its tables in Dev.
4. Read `data_import` in the migration file. With `ask`, ask the builder once whether to bring the original's data (the question tool; without one, ask in plain text and wait). With `never`, skip the import.
5. Run `node <scripts>/dkod-db.mjs import --app <original key> --from snapshot --dir <folder>`. It reads the original's tables and copies their rows into Dev in one transaction, and prints the row counts per table. Show the builder the counts in one short list, and warn once that Dev is shared by every builder in the org. Then call `dkoder.migrate.report` with the `sessionId`, the original's app key and step `data_in_dev`: it records that the data is in Dev, so no later run imports it again. On exit 1 or 2, show the sentence it printed; fix what it names in the dk- app (for example a table its migrations do not make), run `migrate` and `import` again. Never insert or edit rows by hand. Never change the app's triggers, constraints or migrations so that the import passes: the import already turns the app's own triggers off for the copy, and the original's rows passed its rules. When it fails on such a rule, show the builder the sentence and wait.

### 4b. Bring the files

Every file the original reads or serves must be in the dk- app: images, JSON, text, any asset. Files in the original's repository come with its code (step 3.2). Files outside it, or that git ignores, never do: they go into the app's own private files bucket. A missing file is a broken page.

1. Run `node <migrate> files <folder>`. It prints one JSON line and writes `<folder>/.dkod/files.json`: the `groups` (a folder an env value of the original names, or a folder git ignores, with its files, size and the URL the code serves it at), `upload` (what to put), `not_found` (env values naming a folder that is not on this computer) and `db_refs` (links in the Dev data to files no group has). `groups: []` and no `not_found`: the app has no such files; skip to step 5.
2. When `not_found` is not empty, ask the builder where each folder is now, and run it again with `--dir <env name>=<folder>` for each (the original's env file is never edited). When a group says `moved_from`, the env value is old and the folder was found beside the app: say so to the builder.
3. Ask the builder once: "DKOD found these files outside the code: <each group: its env or folder, files, size>. Put them in the app's own private bucket?" with the options "Yes" and "Not these" (the question tool; without one, ask in plain text and wait). On "Not these", ask which to leave out, and leave out only those.
4. Run `node <migrate> install-files <folder>`. It writes `src/dkod-files.ts`: the app's files, from its bucket. Change the dk- app's code so that every read, write and listing of those folders goes through it (`readFile`, `readJson`, `writeFile`, `listFiles`, with the key `<key_prefix><path in the folder>`), and every route that serves them answers with `serveFile(request, key)` (`keyFromPath` turns the URL path into the path in the folder). Remove the env values that named the folders: the dk- app never reads a folder on disk for them. Keep the URLs the same (`url_prefix`), so every link in the data still works.
5. With the Dev database helper running (step 4.2; it also opens the dev files port), run `node <scripts>/dkod-db.mjs files --from <from> --prefix <prefix>` for each entry of `upload`. It puts every file into the app's dev bucket and names any file it could not put (exit 1). Run it again until it says every file is there. When it says the dev files bucket is not there yet, follow its sentence (`dkoder.devdb.make`); a deploy never makes the dev bucket. A group with `inside` goes up with its outer group: never put it twice.
6. Run `node <migrate> files <folder>` again: `db_refs.missing` must be empty. When it names files, they are links in the data to files that are nowhere: show the builder the list and ask whether to go on without them.
7. Start the dk- app locally (its `.env.local` has `DKOD_FILES_URL`) and open a few of its file URLs (`url_prefix` plus a path from the group): each must answer 200 with the right type.

### 5. Check the dk- app

1. Build it with its build script, and run the template's required checks.
2. Run `node <migrate> check-build <folder>`. It checks the template files, the lock file, `.gitignore`, that the data was imported, and the org's policy. It prints `"ok":true` or the problems. In a resumed migration whose `done.data_in_dev` is true, run `node <migrate> check-build <folder> --data-in-dev` instead: the data is already in Dev.
3. Run the dkod skill's policy checks on the `folder` only (never on the original).
4. Fix what any of them names and run them again, until all pass.

### 6. Deploy

1. Call `dkoder.migrate.report` with the `sessionId`, the original's app key and step `building`.
2. Ask the builder: "dk-<key> is built and its data is in Dev. Deploy it now?" with the options "Deploy" and "Not yet" (the question tool; without one, ask in plain text and wait). Never answer it yourself.
3. On "Deploy": call `dkoder.migrate.confirm` with the original's app key. Then do the dkod skill's "Push to prod" from the `folder`, with the app key `dk-<key>`: send the code, fill secrets, deploy, and follow `dkoder.build.status` until it is `delivered` and the app is up. The builder's "Deploy" and the import answer do not answer a Deploy governance question: ask every Deploy question not in `fixed` with the question tool, and never fill one in yourself.
4. The new prod database is empty. When step 4 imported data into Dev, ask the builder once: "Copy the Dev data of <key> into the prod database of dk-<key>?" with the options "Copy" and "No" (the question tool; without one, ask in plain text and wait). Never answer it yourself. On "Copy": call `dkoder.devdb.copy_to_prod` with `app_key` the original's key, `app` `dk-<key>` and `confirm: true`. DKOD copies it inside the cluster, once. While it says `copying`, call it again without `confirm` every minute. Show the builder its `message` when it says `copied`, `skipped` or `failed`. On `copied`, call `dkoder.migrate.report` with step `data_in_prod`, so no later run copies again. The running app writes its own rows (a log, a sync) right after the deploy, so `skipped` can name prod tables with rows: then ask the builder once, "The new prod database already has rows the app wrote since its deploy: <tables and counts>. Replace them with the Dev data?" with the options "Replace" and "Keep prod as it is". On "Replace": call it again with `confirm: true` and `replace: true`. When it answers `not_new` or `pick_env`, do what its `next` says. Never copy rows into prod any other way.
5. When step 4b put files into the dev bucket, ask the builder once: "Copy every file of <key> (images, JSON, any asset) into the private files bucket of dk-<key>?" with the options "Copy" and "No". Never answer it yourself. On "Copy": call `dkoder.files.copy_to_prod` with `app_key` the original's key, `app` `dk-<key>` and `confirm: true`. DKOD copies them inside the cluster, as the app, once; nothing is deleted. While it says `copying`, call it again without `confirm` every minute. It says `copied` only when every file is in the app's bucket (`files`, `bytes`, `missing: 0`); `failed` names the files that are not. Never say the app is done while a file is missing. Then open a few of the app's file URLs on its prod address: each must answer 200 with the right type.
6. Call `dkoder.migrate.report` with step `shipped`. Run `node <scripts>/dkod-db.mjs down --dir <folder>`, then `node <migrate> clean <folder> --run-dir <the run folder>`.
7. Reply with the app's URL, the imported row counts, whether the data is in prod, and how many files are in its bucket, in a few lines. Then do step 7 at once.

On "Not yet": ask what is wrong, fix it, and ask again.

### 7. Switch to the new app

After the first prod deploy, the builder moves to the new app. The original folder is kept as `<key>-archive`, the dk- folder takes the name `<key>`, and the app in prod loses the dk- prefix in its name and its URL. The prod data comes along. Nothing is deleted.

1. Ask the builder: "dk-<key> is live. Switch to it now? Your original folder is kept as <key>-archive, dk-<key> becomes <key>, and the app in prod becomes <key> (its URL loses dk-), with its data." with the options "Confirm" and "Not now" (the question tool; without one, ask in plain text and wait). Never answer it yourself. On "Not now", stop: the next chat asks again.
   In Cursor, do not ask this in the chat. Call `dkoder.migrate.switch` at once, as in point 2: Cursor shows the builder the same question as a pop-up. Allow is the Confirm. When the builder skips the pop-up, that is "Not now": stop, and do not ask again in this chat.
2. On "Confirm": call `dkoder.migrate.switch` with the `sessionId`, the original's app key and `confirm: true`. Do its `steps` in order. They are:
   1. Run `node <migrate> switch <the dk- folder> <the original folder>`. It renames the two folders and changes no file in them. On exit 1, show the builder the sentence it printed and wait.
   2. Run `node <scripts>/dkod-db.mjs up --app <key> --dir <the <key> folder> --detach`. The folder reads the same Dev database, and the same Dev files when the app has them, as before.
   3. Do the dkod skill's "Push to prod" from the `<key>` folder with the app key `<key>`. Follow `dkoder.build.status` until the app is up at its new URL.
   4. Ask the builder: "Copy the prod data of dk-<key> into <key>?" with the options "Copy" and "No". On "Copy", call `dkoder.devdb.copy_to_prod` with `app_key` `<key>`, `app` `<key>`, `from_app` `dk-<key>` and `confirm: true`, and follow it as in step 6.4 until it says `copied`.
   5. When the app has files (step 4b), call `dkoder.files.copy_to_prod` with `app_key` `<key>`, `app` `<key>` and `confirm: true` (the builder's Confirm covers it), and follow it as in step 6.5 until it says `copied`.
   6. Ask the builder: "<key> runs with its data. Remove dk-<key> from prod?" with the options "Remove" and "Keep". On "Remove", call `dkoder.remove` with the newest deployed build of dk-<key>. Its prod database is kept.
   7. Reply with the new URL in a few lines. From now on the builder works in the `<key>` folder as a normal DKOD app: change it, deploy, check it in Dev, deploy to prod.

## Continue a migration

When `dkoder.migrate.start` answers `resumed: true` (or `dkoder.session.start` gave a `migration` with `done`), DKOD already holds part of the work. `done.already_done` names it and `done.next` says what is left. Check what is done; do only what is missing. Never make, import, copy or deploy a thing again because this is a new chat.

- `dk_app`: the dk- app is in its `folder`. Never render, copy or install it again from scratch. When the folder is not on this computer, tell the builder and wait. Check it (step 5) and fix only what the checks name.
- `dev_database`: never call `dkoder.devdb.make`, but for one case: `dkod-db.mjs files` says the dev files bucket is not there yet (an app made before DKOD kept files), then call it once with `confirm: true`; it only adds the bucket. Start the helper (`dkod-db.mjs up`, step 4.2) and run `dkod-db.mjs migrate` (step 4.3): both are safe to run again.
- `data_in_dev`: skip the snapshot (step 2) and the import (step 4.4 and 4.5). Run check-build with `--data-in-dev`.
- `deployed`: prod runs the dk- app at `done.prod.url`. Send the code and deploy again only when you changed the code in this run (a fix the checks asked for, or the builder's request). `done.prod.up` false: follow the newest build with `dkoder.build.status` and fix what it names.
- `data_in_prod`: never call `dkoder.devdb.copy_to_prod` again. Without it, when `deployed` and `data_in_dev` are done, ask the copy question once (step 6.4).
- `shipped`: never report shipped again, and never call `dkoder.migrate.confirm` again. When `done.switched` is false, ask the switch question (step 7.1).
- `switched`: the builder already confirmed the switch. Never call `dkoder.migrate.switch` again with a new answer and never ask again. Check each part of step 7.2 and do only the parts not done: the folders (`node <migrate> switch` says `already: true` when they are switched), the deploy of `<key>`, the copy (never twice), the removal of dk-<key>. Then work on `<key>` as a normal DKOD app.
- Files (step 4b): `dkod-db.mjs files` puts only what the dev bucket lacks, and `dkoder.files.copy_to_prod` copies only what the app's bucket lacks: both are safe to run again, and both are needed until they say every file is there. An app shipped before DKOD kept files gets them now: run step 4b in the `<key>` folder when the app is switched (`files` finds the original in `<key>-archive`; never write a new `.dkod/migration.json` for it), deploy (the code now has `src/dkod-files.ts`, so the app gets its bucket), then step 6.5.
- Any other step whose DKOD tool says it is done is checked, never done again.

An attempt shipped before DKOD kept these two facts says `data_in_dev` and `data_in_prod` false. When `shipped` is done and `dev_database` is `ready`: do not snapshot or import; when the builder's app shows its data on Dev, report step `data_in_dev`. Do not copy to prod either: prod already serves users, so a copy is asked only when the builder asks for it.

Then go on from the first step that is not done, in the order of the steps above. When `done.next` says everything is done, reply in a few lines: the app's URL and what you checked.

## When a step is refused

The refusal names the state the migration is at and the step it waits for. Do that step, then go on. A refusal that says "report this Guard block first" is cleared by calling `dkoder_guard_report` with the object it gives, then retrying, without asking.

When the attempt was a mistake, or the app does not need migrating, call `dkoder.migrate.abandon`. Abandoning leaves the app's Dev data: ask the builder whether to delete it; on yes call `dkoder.devdb.delete` with the original's app key and `confirm: true`.
