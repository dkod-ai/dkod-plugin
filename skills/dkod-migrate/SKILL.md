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
5. Call `dkoder.migrate.report` with step `shipped`. Run `node <scripts>/dkod-db.mjs down --dir <folder>`, then `node <migrate> clean <folder> --run-dir <the run folder>`.
6. Reply with the app's URL, the imported row counts, and whether the data is in prod, in a few lines.

On "Not yet": ask what is wrong, fix it, and ask again.

## Continue a migration

When `dkoder.migrate.start` answers `resumed: true` (or `dkoder.session.start` gave a `migration` with `done`), DKOD already holds part of the work. `done.already_done` names it and `done.next` says what is left. Check what is done; do only what is missing. Never make, import, copy or deploy a thing again because this is a new chat.

- `dk_app`: the dk- app is in its `folder`. Never render, copy or install it again from scratch. When the folder is not on this computer, tell the builder and wait. Check it (step 5) and fix only what the checks name.
- `dev_database`: never call `dkoder.devdb.make`. Start the helper (`dkod-db.mjs up`, step 4.2) and run `dkod-db.mjs migrate` (step 4.3): both are safe to run again.
- `data_in_dev`: skip the snapshot (step 2) and the import (step 4.4 and 4.5). Run check-build with `--data-in-dev`.
- `deployed`: prod runs the dk- app at `done.prod.url`. Send the code and deploy again only when you changed the code in this run (a fix the checks asked for, or the builder's request). `done.prod.up` false: follow the newest build with `dkoder.build.status` and fix what it names.
- `data_in_prod`: never call `dkoder.devdb.copy_to_prod` again. Without it, when `deployed` and `data_in_dev` are done, ask the copy question once (step 6.4).
- `shipped`: never report shipped again, and never call `dkoder.migrate.confirm` again.
- Any other step whose DKOD tool says it is done (for example the app's files, when `dkoder.files.status` says every file is in the bucket) is checked, never done again.

An attempt shipped before DKOD kept these two facts says `data_in_dev` and `data_in_prod` false. When `shipped` is done and `dev_database` is `ready`: do not snapshot or import; when the builder's app shows its data on Dev, report step `data_in_dev`. Do not copy to prod either: prod already serves users, so a copy is asked only when the builder asks for it.

Then go on from the first step that is not done, in the order of the steps above. When `done.next` says everything is done, reply in a few lines: the app's URL and what you checked.

## When a step is refused

The refusal names the state the migration is at and the step it waits for. Do that step, then go on. A refusal that says "report this Guard block first" is cleared by calling `dkoder_guard_report` with the object it gives, then retrying, without asking.

When the attempt was a mistake, or the app does not need migrating, call `dkoder.migrate.abandon`. Abandoning leaves the app's Dev data: ask the builder whether to delete it; on yes call `dkoder.devdb.delete` with the original's app key and `confirm: true`.
