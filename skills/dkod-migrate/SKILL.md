---
name: dkod-migrate
description: Use when the builder says deploy, ship or "push to prod" for an app DKOD did not build, or when dkoder.session.start answers with a migration. The tracked steps that turn that app into a dk- app DKOD ships.
---

# Migrate an app DKOD did not build

The original app and its data are read only: you read them, you never change them. The dk- app is a new app, built in the `folder` that `dkoder.migrate.start` returns.

Call `dkoder.migrate.start` first, with the `sessionId` and the app key, and take `migration`, `folder`, `templates` and `steps` from its answer. What the app is built on, and with which template, comes from that answer and from the dkod skill. This file says only the order of the steps: never pick a template yourself.

Deploy and the code upload stay held until the builder confirms parity. A step out of order is refused and nothing moves.

## The steps, in order

### 1. Start

Make the `folder` the call returned, beside the original app's folder. Write `<folder>/.dkod/migration.json` with exactly two fields: `original`, the original folder's absolute path, and `appKey`, the app key. Calling start again on the same app starts the attempt over and clears every fact reported so far.

### 2. Map the original

Map the original app so completely that the dk- app can be built from the map and the parity suite alone. The map lives in `<folder>/.dkod/map/` and stays on this computer.

1. Take the data snapshot first (step 3's `<scripts>/dkod-migrate.mjs` snapshot <folder>), and run the original on that scratch data, never on its own. The original stays read only.
2. Write `<folder>/.dkod/map/app-map.json` in the app map shape: `summary`, `routes`, `stores`, `services`, `settings`, `background`, `local_only`, `flows` and `pages`, with the enums and caps of the `dkoder.migrate.report` schema. A setting is a NAME, never a value. Add `tables`, a list of `{ store, name, columns }`, for the original's tables and columns.
3. Visit every page and every state of it with a headless browser (Playwright, run through `npx`): `default`, `empty`, `loading`, `error`, `signed_out`, and each tooltip, dialog, menu, hover and focus state. For each, save a screenshot and the computed styles (colours, fonts, sizes, spacing) to `.dkod/map/design/pages/<slug>/<state>.png` and `<state>.json`. The `<slug>` is the page path in lower case with every run of other characters as `-`; `/` is `home`. A page without a `default.png` fails the check.
4. List the original's css, fonts, icons and images in `.dkod/map/assets/assets.json` as `[{ "kind": "css|font|icon|image", "path": "<path in the original>" }]`, and copy the files into `.dkod/map/assets/`.
5. Run `<scripts>/dkod-migrate.mjs` check-map <folder>. It checks the map against the app map shape, lists the routes it finds in the original's router files that the map misses (`missing_routes`) and the pages without a screenshot (`pages_without_screenshot`). Fix what it names and run it again until it prints `"ok":true`.
6. Call `dkoder.migrate.report` with the `sessionId`, the app key, step `mapped`, and `map`: send only names and counts, never a file, a value or a screenshot.

### 3. Write the parity suite

Write a Playwright suite in `<folder>/tests/parity/` from the map, and get every test to pass on the original before you write a line of the dk- app. Tag every test in its title, so `freeze` can check the suite against the map:

- `@api METHOD /path`: one per `api` route of the map (the API kind: status and response shape).
- `@page /path`: one per page route and page of the map (the end-to-end kind: the page renders and its main actions work).
- `@flow <name>`: one per flow of the map, named as the map names it (end-to-end).
- `@data`: write, read back, restart the app, read again. Needed when the map has stores (the data kind).
- `@design /path <state>`: one per page state that has a screenshot in `.dkod/map/design`, with `toHaveScreenshot("<slug>-<state>.png")` and the baseline copied from `.dkod/map/design/pages/<slug>/<state>.png` to `tests/parity/__baselines__/<slug>-<state>.png` (the design kind). The dk- app's `parity` project reads baselines from that folder with that name (`snapshotPathTemplate: "{testDir}/__baselines__/{arg}{ext}"`).

The suite reads only `PARITY_BASE_URL` to pick the app, so the same files run on the original and on the dk- app unchanged. Run it on a copy of the original's data, never on its own: run `<scripts>/dkod-migrate.mjs` snapshot <folder>, the way the dkod skill runs its own scripts, and start the original with the values its answer printed. The dk- app does not exist yet, so write `tests/parity/playwright.config.ts` first: one project `parity` with `testDir: "."`, `snapshotPathTemplate: "{testDir}/__baselines__/{arg}{ext}"`, `use.baseURL` from `PARITY_BASE_URL`, and `expect.toHaveScreenshot.maxDiffPixelRatio` from `PARITY_MAX_DIFF_RATIO` (the `parity.visual_max_diff_ratio` of the migration file; set that variable in every run here; when it is not the default 0.001, also put `PARITY_MAX_DIFF_RATIO=<the ratio>` before `playwright test` in the app's `parity` script). The sha256 covers `tests/parity` only, so this file is part of the frozen suite and nothing outside the folder is. Run it with `PARITY_BASE_URL=<the original's url> PARITY_MAX_DIFF_RATIO=<the ratio> npx playwright test -c tests/parity/playwright.config.ts --reporter=json > <a file outside .dkod>`, for example in the system temp folder.

When a test fails on the original, `freeze` lists it as an original failure. With `original_failures: ask` (the default of the migration file), show the builder each failing title and ask: fix the test, or drop it. Drop means you remove the test and say so in your reply to the builder. Run the suite again after every change.

Then run `<scripts>/dkod-migrate.mjs` freeze <folder> <that report file>. It prints a coverage report. With a gap (`missing`) or a failure it exits 1 and writes nothing: fix it and run it again. When it prints `"ok":true` it has written `.dkod/parity/freeze.json` and printed `sha256` and `counts`. Report step `tests_green_on_original` with `suite_sha256` set to that `sha256` and `counts` set to that `counts` (`tests`, `original_passed`, `original_failed`). It is the sha256 the app's CI prints for the same files (`PARITY_SUITE_SHA`), and it is the one the parity step runs again. Never compute it by hand.

After the freeze, never edit `tests/parity`: Dkoder refuses it. To change the suite, run `<scripts>/dkod-migrate.mjs` unfreeze <folder> and start the attempt again with `dkoder.migrate.start`, because a changed suite has a new sha256 the server does not match.

### 4. Build the dk- app

Build the dk- app in the `folder`, on the stack and on the template the start call returned. Report step `building` when this step starts. The map and the frozen suite are the spec; the original's code is not.

1. Start from the template's text: the template that `dkoder.templates` named in the start call. Never pick another.
2. Copy the files listed in `.dkod/map/assets/assets.json` from the original as they are, into the places the template serves them from. Never redraw one: `check-build` compares the bytes.
3. Write every route, page, API path and flow of the map, so the frozen suite can pass on the dk- app.
4. Write the data layer the stack names: a schema from the map's `tables`, and a `0001_baseline` migration made from it. The original's data files, and any driver for them, stay out of the `folder`.
5. Give the app its Dev data: do the dkod skill's section on Dev data. Call `dkoder.devdb.status`, and `dkoder.devdb.make` when it asks for it; run `dkod-db.mjs` up so it writes `DATABASE_URL` into `.env.local`; then run `dkod-db.mjs` migrate. `.env.local` must be in `.gitignore`, and you never read or print its values.
6. Read `data_import` in the migration file. With `ask`, ask the builder whether to bring the original's data. On a yes, say that data import is not available yet (it comes later) and that the dk- app starts with an empty, migrated Dev store; invent no import command. Seed only through the suite's own setup. With `never`, do not ask.
7. Loop until everything passes: start the dk- app on the Dev data, and run the frozen suite on it with `PARITY_BASE_URL=<the dk- app's url>`, `PARITY_MAX_DIFF_RATIO` and `--reporter=json`, writing to a file outside `.dkod`. Then run `<scripts>/dkod-migrate.mjs` check-build <folder> <that report file>, each required check of the template (run its script by name, as the PRD's "Required checks" list them) and the dkod skill's policy checks, the stack rule among them. Fix what any of them names and run all of it again, until the suite is green, `check-build` prints `"ok":true` and no policy finding blocks.

`check-build` fails on a suite edited after the freeze, a baseline test that fails or is missing, a map table with no schema, no `0001_baseline` migration, a data file in the `folder`, an asset that is not byte-identical, and a `.env.local` that is not ignored. Keep its `counts` for step 5.

### 5. Parity

The builder judges parity, not you. Do these in order:

1. Start the original from the snapshot's values (`.dkod/snapshot.json`, its `env`) on the scratch data, on its own port. Start the dk- app on the Dev data, on another port.
2. Run the frozen suite on each app with `PARITY_BASE_URL` set to that app's url and `--reporter=json`, writing each report to a file outside `.dkod`.
3. Run `<scripts>/dkod-migrate.mjs` side-by-side <folder> <original report file> <dk report file>. It prints the parity report (routes, flows, tests passed on each app, `visual_diff`, `data_imported`) and the question. It exits 1 on a changed suite, a missing report or a failing test: fix it and run from 2 again.
4. Open both urls side by side in the browser.
5. Show the builder the report it printed. Report step `parity_passed` with `parity_sha256` set to the same sha256 you sent as `suite_sha256`, and with its `counts` (`tests`, `original_passed`, `original_failed`, `new_passed`, `new_failed`, `visual_diff`).
6. Ask the builder its `question` with the client's question tool, with the options "Ready to deploy" and "Not yet".
7. On "Ready to deploy", call `dkoder.migrate.confirm`: it is the only call that moves a migration to `confirmed`. Then go on to the section after this one, Push to prod. On "Not yet", ask what is wrong, fix it, and start step 5 again from 1.

Never confirm for the builder. Call `dkoder.migrate.confirm` only after the builder answered "Ready to deploy".

### 6. Push to prod

From the dk- folder, push to prod as the dkod skill's "Push to prod" says, with the dk- app's app key. Then report step `shipped`, and run `<scripts>/dkod-migrate.mjs` clean <folder>: it removes the copy of the original's data and closes the migration, so the original is writable again.

## When a step is refused

The refusal names the state the migration is at and the step it waits for. Nothing moves: do that step, then report it.

When the attempt was a mistake, or the app turns out not to need migrating, call `dkoder.migrate.abandon`. The attempt is cancelled, and Deploy and the code upload are open again.
