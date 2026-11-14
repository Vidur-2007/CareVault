# Core prompts (laptop A)

How to use this file: paste one phase at a time into Claude on laptop A, from the repository root. Wait until the phase is finished and pushed before pasting the next. Every phase runs on `feat/core`.

Before Phase 1, the human does this once: wait for laptop B to push Phase 0 to `main`, then `git clone` the repository, run `npm install`, and run `git checkout -b feat/core` followed by `git push -u origin feat/core`. Copy `.env.example` to `.env`.

---

## Phase 1: local database

```
Read docs/specs/00-overview.spec.md and docs/specs/01-core.spec.md. You are on branch feat/core. You may edit only the paths listed in section 1 of the core spec. If you believe a frozen file or the contract must change, stop and write the request in docs/contract-requests-core.md instead of editing it.

Build section 3 of the core spec:
- src/core/db/schema.ts, repos.ts, events.ts with the tables and indexes listed.
- src/core/db/seed.ts: loadSampleProfile() that writes the sample case from src/contract/fixtures/sampleCase.ts into the database. It must be idempotent: calling it twice leaves one copy.
- Tests with fake-indexeddb: every repo round-trips its type; multi-table writes roll back together on failure; subscribe listeners fire once per write batch.

Run npm run check. Append a short entry to docs/progress-core.md (what was built, anything the UI side should know). Commit as "core: local database and seed" and push feat/core. Stop.
```

## Phase 2: rules engine

```
Continue on feat/core under the same ownership rules. Read section 9 and section 10 of the overview spec and section 4 of the core spec again before writing code.

Build src/core/rules as pure functions with no database or network access: normalize, totals, diff, status, review, passport, change summary. Write the tests first.

Required tests:
- The golden test: start from the raw inputs of the sample case (the three prescriptions applied in date order, the two home-scan products, the Pantoprazole history) and assert every value in fixtures `expected`, including the diff rows, the four statuses, the three open review items, the 3450 mg/day total and the change summary.
- Every edge case listed in section 4 of the core spec.

Rules for this phase: no model calls, no randomness inside rules (ids and timestamps are passed in), totals rounded to at most 3 decimals. Report branch coverage for src/core/rules and raise it until every branch is covered.

Run npm run check. Update docs/progress-core.md. Commit as "core: rules engine with golden test" and push. Stop.
```

## Phase 3: real services

```
Continue on feat/core. Implement createRealServices() in src/core/createRealServices.ts for these groups: profiles, medicines, documents (including sha256 duplicate detection and file storage), prescriptions, review, visits (including buildPassport and changeSummary), settings, and subscribe. Each method loads state through the repos, calls the rules, and writes the plan inside one transaction.

Leave reading, sharing, gmail and backup rejecting with ServiceError('unknown', 'not built yet') for now.

Add a contract test that calls every implemented method against fake-indexeddb after loadSampleProfile() and asserts the results equal the fixtures `expected` values. Add tests for: resolving each review resolution, undo-style reversal by calling setStatus, applying a new prescription through the service and reading latestDiff back.

Run npm run check. Update docs/progress-core.md with any behaviour the UI mock should copy. Commit as "core: services over database and rules" and push. Stop.
```

## Phase 4: document reading

```
Continue on feat/core. Build sections 5 and 6 of the core spec.

1. Drug reference: src/core/drugref/table.json, lookup.ts and SOURCES.md. Include every product in the sample case and about 40 common Indian products. Only include a composition you can confirm from a pack label or the manufacturer's page, and record the source. If you cannot confirm an entry, leave it out and list it under "unconfirmed" in SOURCES.md for the human.
2. Synthetic sample documents in public/sample-docs/: the six documents from the sample case, generated from HTML with an invented clinic name.
3. OcrEngine interface with two implementations (PaddleOCR.js and Tesseract.js), loaded lazily. Read the current documentation of both libraries before writing code.
4. pdfText.ts, parse.ts, quality.ts, read.ts as specified. parse.ts must be deterministic and unit-tested with raw text samples for: a pack label with a composition line, a printed prescription with 1-0-1 dosing, a lab report header.
5. Wire services.reading.read. The cloud path calls POST /api/extract through src/core/reading/cloud.ts; until the server exists, test it with a mocked fetch.

Then write a small manual test page under src/core/reading/dev/ (not linked from the app) that lets the human drop an image and see timing and output for each engine. Ask the human to run it on a phone with ten real pack photos, and record their results and the engine decision in docs/progress-core.md. Do not choose the engine yourself without those results; default to Tesseract.js until they are in.

Run npm run check. Commit as "core: document reading and drug reference" and push. Stop.
```

## Phase 5: server, sharing and backup

```
Continue on feat/core. Build sections 7, 9 and 10 of the core spec.

1. server/: Hono app with static serving and SPA fallback, POST /api/extract, the three /api/share routes, GET /api/health, zod validation, size limits, rate limit, and server/schema.sql. Read the current Gemini API documentation for structured JSON output and for the model ids available on the free tier; take the model id from GEMINI_MODEL.
2. src/core/share: crypto.ts and client.ts; wire services.sharing (create, list, revoke, open).
3. src/core/backup: wire services.backup.
4. Tests: encrypt then decrypt round-trip; a wrong key fails; share routes with a faked Supabase client (create, fetch, expired gives 410, revoked gives 410, wrong revoke token gives 403); backup round-trip and wrong passphrase.

Then give the human a numbered checklist, and write the same list into docs/progress-core.md: create the Supabase project and run schema.sql; create the Gemini API key in AI Studio; fill .env; run the server locally; confirm a share link opens in a second browser and stops working after revoke.

Run npm run check. Commit as "core: server, encrypted sharing, backup" and push. Stop.
```

## Phase 6: Gmail import

```
Continue on feat/core. Build section 8 of the core spec: src/core/gmail/token.ts and api.ts, and wire services.gmail. Read the current Google Identity Services documentation for the token model first.

The access token lives in memory only. Imported attachments become DocumentRecords with source 'email' and state 'pending_confirmation', and open a new_document review item. Test api.ts with mocked fetch responses.

Write the Google Cloud setup steps for the human into docs/progress-core.md: create the project, enable the Gmail API, configure the OAuth consent screen in Testing status, add the test Gmail address as a test user, create the Web client id with the local and deployed origins, put it in VITE_GOOGLE_CLIENT_ID. Also describe how to prepare the test inbox with three synthetic report emails.

Run npm run check. Commit as "core: Gmail import" and push. Then open a pull request from feat/core into main titled "Core: data, rules, reading, server". Stop.
```

## Phase 7: integration and deploy (after both pull requests are merged)

```
Both feat/core and feat/ui are merged into main. Pull main and create the branch integration.

1. Set VITE_USE_MOCK=false. Run the app and the server locally. Walk the demo path from section 13 of the overview spec. For every mismatch between what the UI expects and what the real services return, fix it inside src/core only. If the fix would need a UI or contract change, write it in docs/contract-requests-core.md and tell the human instead.
2. Add .github/workflows/keepalive.yml as specified.
3. Deploy main to Deployxa: read Deployxa's current documentation, configure build and start commands and the environment variables, and confirm /api/health returns 200 on the public URL. Add the deployed origin to the Google OAuth client.
4. Run the demo path once on the deployed URL from a phone.

Update docs/progress-core.md with the public URL and anything still broken. Commit as "core: integration fixes and deploy", push integration, and open a pull request into main. Stop.
```
