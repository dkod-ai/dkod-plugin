---
name: dkod-migrate
description: Use when the builder says deploy, ship, migrate or "push to prod" for an app DKOD did not build, or when dkoder.session.start answers with a migration. The short, tracked steps that turn that app into a dk- app, bring its data into Dev and deploy it.
---

# Migrate an app DKOD did not build

The goal is simple: the app runs on DKOD, with its data. Copy the app's code into a new dk- app, fit it to the org's template, copy its data into Dev, and deploy. Do not rebuild the app from scratch and do not check it page by page: the builder looks at it after the deploy.

## Rules

- Keep going. Do the steps below one after the other in the same turn. Do not stop to report a step, and do not end your turn when a command or a background job finishes: read its output and go on. Stop only to ask the builder a question this file names, or when a step fails with a sentence you must show the builder.
- Run every DKOD script in the foreground, as one command on its own (no `&&`, no `;`, no `&`), so it returns its answer to you. `<scripts>` is the dkod skill's `scripts` folder (next to its SKILL.md). `<migrate>` is this skill's `scripts/dkod-migrate.mjs`.
- The original app is read only. Never write, install, build or generate anything in its folder, and never start it.
- Never change the builder's data stores or their users: no `ALTER ROLE`, `GRANT`, `CREATE DATABASE`, `createdb`, `dropdb`, no new local data store, no containers. The snapshot only reads the original's store. If it cannot read it, show the builder the sentence it printed and wait.
- Do not make a code graph in a migration, and do not write an app map, screenshots or a parity suite: this migration does not use them.
- Keep scratch files in one run folder: `mktemp -d` once at the start (the dkod skill's scratch-files rule), never in the app folders.

## Steps

### 1. Start

1. Start a DKOD session as the dkod skill says. The app key is the original folder's own name (a folder `aisf-test-dko1411-x` gives `aisf-test-dko1411-x`; a different name in the request is not used). The dk- app's key is `dk-<that key>` (`dk-aisf-test-dko1411-x`).
2. Call `dkoder.migrate.start` with the `sessionId` and the app key. Keep `folder`, `templates` and `service_rules` from its answer. Never pick a template yourself.
3. Make the `folder` it returned beside the original's folder (`<parent of the original>/dk-<key>`). Write `<folder>/.dkod/migration.json` with the Write tool, exactly two fields: `original` (the original folder's absolute path) and `appKey` (the original's key).
4. Make the run folder with `mktemp -d`.

### 2. Snapshot the data

Run `node <migrate> snapshot <folder>`. It finds the original's data: the data URL in its `.env.local` or `.env` (also in the app's own subfolder, such as `gBall/.env.local`), single-file stores and data files. It only reads them. It prints one JSON line.

- `"mode":"snapshot"`: go on.
- `"mode":"new-app-only"`: it found no data. Run `node <scripts>/dkod-db.mjs detect --dir <the original's folder>`. When detect says `uses_database: true`, ask the builder for the original's data URL, then run snapshot again with `--db-url <url>`. Otherwise go on: the app has no data to bring.
- Exit 1: show the builder the sentence it printed, and wait for the answer.

### 3. Make the dk- app

1. Render the org's template: the one `dkoder.migrate.start` named for this kind of app. Save its `content` to a file in the run folder, and its `dkod` and `policy` values to `values.json` beside it (`{ "policy": {...}, "dkod": {...} }`). Run `node <migrate> render <that template file> <folder> <values.json>`. On `gaps`, answer them in `values.json` and run it again.
2. Copy the original's code into the `folder`: the folder the app runs from (where its package manifest and its start command are; in a repository with the app in a subfolder, that subfolder). Copy source, config, public files and the files the app reads at run time. Never copy `.env` files, `.git`, dependency folders, build output, single-file stores or the snapshot's data. Where the template wrote a file (Dockerfile, CI, `.dockerignore`), keep the template's file.
3. Fit the code to the template and the org's rules, and change nothing else: the start command and port the template expects, the probes (`/healthz`, `/readyz`, `/startupz`), JSON logs, a numeric non-root user, and `DATABASE_URL` as the name of the data URL. Each store and service follows `service_rules`: `stub` an in-process stub, `keep` a Dev instance by setting names, `public-read-only` GET/HEAD only with no credential, `refuse` the app runs without it. Never give the dk- app a real credential.
4. Install its dependencies in the `folder` with the package manager the dkod skill names for its stack, and keep the lock file. Make sure `.gitignore` covers `.env.local`.

### 4. Bring the data into Dev

Skip this step when the snapshot said `new-app-only` and the app keeps no data.

1. Call `dkoder.devdb.status` with the original's app key (never the `dk-` key). Call `dkoder.devdb.make` with `confirm: true` when it says `missing`.
2. Run `node <scripts>/dkod-db.mjs up --app <original key> --dir <folder> --detach`. It writes `DATABASE_URL` into `<folder>/.env.local`. When it asks for a code, do what the dkod skill's "Dev database" section says.
3. Run `node <scripts>/dkod-db.mjs migrate --dir <folder>`: the dk- app's own migrations make its tables in Dev.
4. Read `data_import` in the migration file. With `ask`, ask the builder once whether to bring the original's data (the question tool; without one, ask in plain text and wait). With `never`, skip the import.
5. Run `node <scripts>/dkod-db.mjs import --app <original key> --from snapshot --dir <folder>`. It reads the original's tables and copies their rows into Dev in one transaction, and prints the row counts per table. Show the builder the counts in one short list, and warn once that Dev is shared by every builder in the org. On exit 1 or 2, show the sentence it printed; fix what it names in the dk- app (for example a table its migrations do not make), run `migrate` and `import` again. Never insert or edit rows by hand.

### 5. Check the dk- app

1. Build it with its build script, and run the template's required checks.
2. Run `node <migrate> check-build <folder>`. It checks the template files, the lock file, `.gitignore`, that the data was imported, and the org's policy. It prints `"ok":true` or the problems.
3. Run the dkod skill's policy checks on the `folder` only (never on the original).
4. Fix what any of them names and run them again, until all pass.

### 6. Deploy

1. Call `dkoder.migrate.report` with the `sessionId`, the original's app key and step `building`.
2. Ask the builder: "dk-<key> is built and its data is in Dev. Deploy it now?" with the options "Deploy" and "Not yet" (the question tool; without one, ask in plain text and wait). Never answer it yourself.
3. On "Deploy": call `dkoder.migrate.confirm` with the original's app key. Then do the dkod skill's "Push to prod" from the `folder`, with the app key `dk-<key>`: send the code, fill secrets, deploy, and follow `dkoder.build.status` until it is `delivered` and the app is up. The builder's "Deploy" and the import answer do not answer a Deploy governance question: ask every Deploy question not in `fixed` with the question tool, and never fill one in yourself.
4. Call `dkoder.migrate.report` with step `shipped`. Run `node <scripts>/dkod-db.mjs down --dir <folder>`, then `node <migrate> clean <folder> --run-dir <the run folder>`.
5. Reply with the app's URL and the imported row counts, in a few lines.

On "Not yet": ask what is wrong, fix it, and ask again.

## When a step is refused

The refusal names the state the migration is at and the step it waits for. Do that step, then go on. A refusal that says "report this Guard block first" is cleared by calling `dkoder_guard_report` with the object it gives, then retrying, without asking.

When the attempt was a mistake, or the app does not need migrating, call `dkoder.migrate.abandon`. Abandoning leaves the app's Dev data: ask the builder whether to delete it; on yes call `dkoder.devdb.delete` with the original's app key and `confirm: true`.
