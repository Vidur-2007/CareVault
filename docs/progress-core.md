
## Phase 1: local database (2026-11-14)

Built:
- `src/core/db/schema.ts`: Dexie database `carevault`, version 1, with the eleven tables and indexes from core spec section 3.
- `src/core/db/repos.ts`: one typed repo per table. `repos.transaction(fn)` groups writes into one atomic batch over every table; a failure inside it rolls all of them back.
- `src/core/db/events.ts`: the change notifier behind `subscribe()`. It fires once per write batch, after the batch is committed, and never for a batch that rolled back.
- `src/core/db/seed.ts`: `loadSampleProfile(repos)` writes the fixture sample case in one batch.
- 28 tests against `fake-indexeddb`.

For the UI side:
- `loadSampleProfile` behaves like the mock: if the sample profile already exists it writes nothing and returns it, so the caregiver's changes to the sample are kept. There is no "reset the sample" yet.
- Lists that the contract returns in time order are sorted by the actual instant. Rows with the same timestamp have no guaranteed order between them.
- Sample documents have no stored file until Phase 4 creates `public/sample-docs/`.
- `createRealServices()` is still the Phase 0 stub. It is wired in Phase 3.

Notes for the core side:
- `reviewItems.resolvedAt` is indexed as the spec says, but IndexedDB does not index `null`, so open items are read by `profileId` and filtered in memory.
- Tests that store a `Blob` need `// @vitest-environment node` at the top of the file: jsdom's `Blob` does not survive the structured clone that `fake-indexeddb` performs.
- Inside `repos.transaction`, await only repo calls. Hashing, `fetch` and timers must happen before the batch, otherwise IndexedDB commits early.

## Phase 2: rules engine (2026-11-14)

Built `src/core/rules` as pure functions. Nothing in it reads a clock, a random source, the database or the network; ids and timestamps are passed in through a `RuleContext`.

- `normalize.ts`: ingredient names (lowercase, bracketed notes, pharmacopoeia marks and salt words removed, synonyms mapped), unit conversion, `sameMedicine`.
- `totals.ts`: duplicate groups and daily totals.
- `diff.ts`: prescription comparison.
- `prescriptions.ts`: `planPrescriptionApply` and `buildDiff`.
- `status.ts`: add, confirm and set-status plans with their events.
- `review.ts`: which review items should exist, which are stale, and what each answer changes.
- `visits.ts`, `passport.ts`: next visit, questions, change summary, passport.
- `types.ts`: `RulesState`, `WritePlan`, `applyPlan`, `mergePlans`.
- `src/core/drugref/synonyms.ts`: ingredient synonyms (Phase 4 folds these into the drug reference).

Tests: 161 in `src/core/rules`, branch coverage 100% (402 of 402). The golden test replays the sample case from its raw inputs in date order and gets the fixtures back exactly: all nine medicines field for field, the twelve history events, the three review items word for word, the diff, 3450 mg, the change summary and the passport.

Coverage is measured with `@vitest/coverage-v8`, which is not in `package.json`. To repeat it: `npm install --no-save @vitest/coverage-v8@5.1.0`, then `npx vitest run src/core/rules --coverage --coverage.include='src/core/rules/**'`.

Behaviour the UI side should know (the mock differs in places):
- **Incomplete totals.** When any part has no `dosesPerDay`, `complete` is false and `perDay` of the total is `0`, not a partial sum. Parts with a known number per day still carry their own `perDay`.
- **Mixed units.** One ingredient can have more than one total: mass in one, ml in another, IU in a third. Mass totals use the unit that was entered if all parts agree, otherwise mg.
- **Wording.** Review item titles, the review note on a diff row and generated questions use he, she or they from the profile relation, with the same word lists as `src/ui/lib/pronouns.ts`. Example: "Is he still taking Atorvastatin 10 mg?".
- **`only_one` needs `keepMedicineId`.** Without it, or with an id that is not in the item, `review.resolve` rejects. The mock stops every product in that case.
- **`ask_doctor`** adds a question only if the next visit has none that already names the same products. With no upcoming visit the item is still resolved and no question is stored.
- **Stale items close by themselves.** A duplicate question disappears when its medicines are no longer a duplicate (one was stopped, or a third joined and a new question replaced it). A confirm question closes when the medicine's status is changed directly. Setting a medicine back to `needs_confirmation` opens a new question, which is how an answer can be reversed.
- **Reapplying a prescription** that already has stored lines changes nothing, even if the lines passed in differ.
- **An older prescription added late** (dated before one already stored for that prescriber) only stores its lines. The medicine list follows the newest prescription.
- **A medicine that returns** on a later prescription while its question is open is confirmed again and the question is closed.
- **Passport.** `changesSince` is the date of the previous prescription. A medicine parked with "ask the doctor" stays in `changes` as `unconfirmed`. Current medicines are ordered: the visit's prescriber first, then other prescribers by name, then medicines with no prescriber.

Open point: nothing in overview section 9 creates an `unclear_extraction` item, so the rules never open one. They can be resolved if something else creates them.

## Phase 3: real services (2026-11-14)

`createRealServices()` now implements profiles, medicines, documents, prescriptions, review, visits, settings and `subscribe`. Reading, sharing, Gmail and backup reject with `ServiceError('unknown', 'not built yet')` until their phases.

How a write works: load the profile's state, ask the rules for a plan, add the review-inbox refresh, store everything in one transaction, notify subscribers once. If a rule rejects, nothing is stored and nobody is notified. Every method rejects with a `ServiceError`; unexpected failures are wrapped as `unknown`.

Files: `src/core/createRealServices.ts`, `src/core/state.ts` (load state, store plan). `createRealServices` takes optional `{ db, now, newId }` for tests.

Tests: 49 in `createRealServices.test.ts` against `fake-indexeddb`: every built method after `loadSampleProfile()` against the fixture `expected` values, each review resolution, reversing an answer with `setStatus`, a new prescription applied through the service and read back with `latestDiff`, duplicate detection by file hash, and the error paths. `npm run check` passes with 239 tests. The services have not been run in a real browser yet; that happens in Phase 7.

Behaviour the UI mock should copy, or that differs from it:
- **Sample clock.** For the sample profile "today" is fixed at `SAMPLE_TODAY` (2026-11-14), as in the mock, so its visit on 18 November stays the next visit and the passport says "prepared on 14 November" whatever the real date. Every other profile uses the device's date. This answers the clock question in `progress-ui.md`.
- **`documents.add`** always stores the record as `pending_confirmation`, like the mock; call `documents.confirm` when the caregiver saves it. It rejects with `unsupported_file` for an empty file or anything that is not a PDF or an image. When the browser gives no type, the type is read from the first bytes (PDF, JPEG, PNG). `duplicateOf` is the earliest document of the same profile with the same hash; the new record is still stored, so "Discard" means calling `documents.remove`.
- **`documents.confirm`** on an emailed report also closes its `new_document` review item as `added`. `review.resolve(id, 'dismissed')` on a `new_document` item deletes the unconfirmed document and its file.
- **`documents.remove`** also deletes the file, the prescription lines of that document, the document's review item, and takes it off every visit's list of reports to share. Medicines that came from it stay, with `sourceDocumentId` still pointing at the removed document, so "View source" should handle `not_found`.
- **`documents.file`** rejects with `not_found` when no file is stored. That is the case for all six sample documents until Phase 4 adds `public/sample-docs/`.
- **`documents.list` and `search`** return newest first by document date, then by time added. Search matches the title or the type in words ("lab report").
- **`prescriptions.apply`** rejects an empty list of lines, an unknown document or an unknown prescriber, and stores nothing in those cases. It files the document as a prescription from the given prescriber if it was not already.
- **`visits.save` and `setSharedDocuments`** drop document ids that do not exist and repeated ids. `visits.save` rejects an unknown prescriber or an unreadable date.
- **`visits.addQuestion`** ignores a question whose text is already on the visit (ignoring case).
- **`medicines.setStatus`** with the status the medicine already has changes nothing and adds no history.
- **`profiles.prescribers`** is sorted by name.

Blocked on the contract: there is no way to create a prescriber. See `docs/contract-requests-core.md`, request 1.

## Phase 4: document reading and drug reference (2026-11-14)

Built:
- **Drug reference** (`src/core/drugref`): `table.json` with 70 products and 26 ingredient synonyms, `lookup.ts` (exact and near matching on names and aliases, finding product names in text, cross-check), and `SOURCES.md` with the source of every entry, the entries that need a second look, and the products left out as unconfirmed. Nine combination products contain paracetamol.
- **Sample documents** (`public/sample-docs/`): six PDFs with a text layer, generated with headless Chrome from the HTML in `src/core/reading/dev/sample-docs-html/`. Clinic ("Sunrise Heart and Diabetes Clinic"), lab ("Lakeside Diagnostics"), doctors and patient are invented.
- **Reading** (`src/core/reading`): `parse.ts` (deterministic: strengths, composition lines, dose patterns, dates, "Dr." names, document type), `quality.ts`, `pdfText.ts`, `cloud.ts` (zod-checked client for `POST /api/extract`), `ocr/tesseract.ts`, `ocr/paddle.ts`, and `read.ts`, which ties them together. `services.reading.read` is wired.
- `documents.file` now returns the shipped PDF for the six sample documents (fetched from `/sample-docs/`), so the sample profile has previews.

Tests: 41 in `reading.test.ts`. Each of the six sample PDFs is read on the device, without OCR and without the cloud, and the three prescriptions give exactly the lines of the sample case. The cloud path is tested with a mocked `fetch`. `npm run check` passes with 281 tests.

Not tested: the two OCR engines and rendering a scanned PDF page need a real browser. They are thin wrappers and have never been run. That is what the phone test below is for.

How `reading.read` decides:
1. A PDF with a text layer is parsed directly. A photo or a scanned PDF goes through OCR (page 1 only for a PDF).
2. The cloud is offered when the text is under 20 characters, OCR confidence is under 0.6, or a prescription or pack names no product or ingredient the drug reference knows. Reports are never sent for that last reason.
3. Without `allowCloud` that rejects with `cloud_consent_required`. With it, one image goes to `/api/extract`.
4. Every line is compared with the drug reference. A disagreement adds a warning to the line and changes nothing.

For the UI side:
- **Warnings to expect.** A pack usually gives "How often it is taken was not found." A brand name on a prescription with no printed composition gives "The ingredients were not printed. They were filled in from the drug reference for X. Please check."
- **Instructions** are worded like the sample case: `1-0-0` is "1 tablet, morning", `0-0-1` is "1 tablet, night", `1-0-1` is "1 tablet, twice a day". An uneven pattern reads "2 morning, 1 night".
- **Numeric dates are read day first** (28/10/2026). Manufacturing, expiry and birth dates are skipped.
- **Until Phase 5** there is no `/api/extract`, so a read that needs the cloud and has consent rejects with `network`.
- **First scan is slow.** The OCR engine and its model download on the first photo. Text PDFs do not need them.

### OCR engine decision: waiting for a phone test

Tesseract.js is the default and PaddleOCR.js is the fallback, as the prompt requires until real results are in. What is known so far, from the build only:

| | Tesseract.js | PaddleOCR.js |
| --- | --- | --- |
| Code shipped with the app | under 1 kB of glue; the library loads its worker, core and English model from the jsDelivr CDN at run time | about 105 MB of JavaScript before compression (OpenCV.js 25.7 MB, onnxruntime-web 79 MB), about 30 MB gzipped |
| Models | English model from the CDN | two PP-OCRv5 model archives from `paddle-model-ecology.bj.bcebos.com` at run time |

Both engines fetch code or models from third-party hosts on first use. The photo itself stays on the device. If that is not acceptable for the demo, the files can be self-hosted from the server; say so and it goes into Phase 5.

**For the human, on a mid-range phone:**
1. On the laptop: `npm run dev -- --host`, and note the Network address it prints.
2. On the phone, on the same Wi-Fi, open `http://<that address>/src/core/reading/dev/index.html`.
3. Choose at least ten real pack photos and two printed prescriptions. Each is read by both engines.
4. Press "Copy results" and paste the table here, under this heading.
5. Note anything the table does not show: a long first load, the phone getting hot, the page reloading.

The decision (which engine is first, whether the other stays as fallback) is made from that table, not before.

### Unconfirmed drug reference entries

See `src/core/drugref/SOURCES.md`. In short: 70 products are in; Dolo 650, Telma 40, Telma H and Okacet 10 are in but need a look at the pack or the page; about 25 well-known products (Glycomet, Ecosprin, Amlong, Omez, Saridon and others) are left out because no manufacturer source confirmed them.

## Phase 5: server, encrypted sharing, backup (2026-11-14)

Built:
- **Server** (`server/`): one Hono app. `index.ts` (app, rate limit, health, static files with the app shell as fallback), `extract.ts` (`POST /api/extract`, Gemini with a JSON response schema), `share.ts` (the three share routes and the Supabase store), `schema.sql`.
- **Sharing** (`src/core/share`): `crypto.ts` (AES-GCM, 256-bit key, 96-bit IV, both new for every share) and `client.ts`. `services.sharing` is wired: create, list, revoke, open.
- **Backup** (`src/core/backup/backup.ts`): `services.backup` is wired. PBKDF2-HMAC-SHA256 with 600,000 iterations (OWASP Password Storage Cheat Sheet, read 2026-11-14), a random 16-byte salt, AES-GCM. The file is one line of JSON (`format`, `version`, `kdf`, `iterations`, `salt`, `iv`), a newline, then the ciphertext.

Tests: 17 for the server routes with a faked Supabase client, and 16 end to end in `server/e2e.test.ts`, where the real services talk to the real routes over an in-memory store: a link made on one "phone" opens on a second device from the link alone, stops at expiry, stops after revoke, and fails with a wrong key. `npm run check` passes with 314 tests. The built server was started and answered on `/api/health`, a client route (`/share/abc` gets the app shell), a sample PDF, and the API with nothing configured (503).

Not tested: a real Supabase project and a real Gemini key. The checklist below covers both.

What the server does and does not do:
- It stores ciphertext, an IV, an expiry and a SHA-256 hash of the revoke token. It never receives the key, which is only in the link after `#`.
- Expiry is capped at 7 days from now; ciphertext at 200 KB; images at 6 MB. 60 requests a minute per client address on `/api`.
- It logs nothing about requests. Errors go back as a short JSON message with no detail from the database or the model.
- `GET /api/health` always returns 200 with `{ ok, shareStore, cloudReading }`. `shareStore` is the result of one small query on the `shares` table.
- Without Supabase settings the share routes answer 503; without Gemini settings `/api/extract` answers 503. The app still starts.

For the UI side:
- **`sharing.create(passport, hours)`** keeps `hours` between 1 and 168. The link is `<origin>/share/<id>#<key>`. `sharing.list()` returns newest expiry first and includes expired and revoked links; filter on `expiresAt` and `revoked` for "active links".
- **`sharing.open(id, key)`** rejects with `not_found`, `expired`, `revoked`, `network`, or `unknown` (wrong or missing key, or the link holds something that is not a passport).
- **`sharing.revoke`** rejects with `network` when offline and leaves the link marked as not revoked, so it can be tried again.
- **`backup.export(passphrase)`** rejects an empty passphrase. It takes about a second because of key derivation. The blob's type is `application/vnd.carevault.backup`; a `.carevault` file name is a reasonable choice.
- **`backup.import`** rejects with `bad_passphrase` (wrong passphrase, or a damaged file: the two cannot be told apart) or `unsupported_file` (not a backup). Nothing on the device changes unless the whole backup decrypts and checks out. Ask for confirmation before calling it: it replaces everything.
- A backup includes the share links and their revoke tokens, so a restored device can still revoke them.

### Checklist for the human

1. **Supabase.** Create a project at supabase.com (free plan). Open the SQL editor, paste `server/schema.sql`, run it. Under Project Settings, API, copy the project URL and the `service_role` key. The service role key can read and write everything: it goes in `.env` on the server only, never in the browser and never in git.
2. **Gemini.** Create an API key at https://aistudio.google.com/apikey. Pick a model that takes images and is available on your free tier: Google's model page lists `gemini-3.5-flash-lite` as the fast, low-cost option and `gemini-3.8-flash` as a stable general one, but it does not say which are free, so check the rate-limit page in AI Studio for your key. On the free tier Google may use what is sent, so send synthetic documents only.
3. **Fill `.env`** (it is already in `.gitignore`):
   ```
   GEMINI_API_KEY=...
   GEMINI_MODEL=gemini-3.5-flash-lite
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   VITE_USE_MOCK=false
   PORT=8787
   ```
4. **Run locally.** `npm run build`, then `npm start`, and open http://localhost:8787. Or, while developing: `npm run dev:server` in one terminal and `npm run dev` in another. Check http://localhost:8787/api/health: it should show `"shareStore": true` and `"cloudReading": true`.
5. **Confirm a share link.** Load the sample profile, open the Doctor Visit Passport, create a link. Open the link in a second browser (or a private window): the passport appears. Revoke it on the first, reload on the second: it says the link was revoked. In Supabase, look at the `shares` table: one row, and its `ciphertext` is unreadable.
6. **Confirm cloud reading** with a photo of a pack that the device cannot read (or any photo, with Wi-Fi model downloads blocked): agree to send it, and the fields should come back with `engine: 'cloud'`.

Step 5 needs the UI's passport and share screens, so it can only be done after the two branches are merged, or against the mock for the screens and `curl` for the API.

## Phase 6: Gmail import (2026-11-14)

Built:
- `src/core/gmail/token.ts`: Google Identity Services token model, scope `gmail.readonly` only. The script loads on the first "Connect". The access token is held in memory and treated as expired a minute before Google's own expiry. It is never written to IndexedDB and never sent to our server.
- `src/core/gmail/api.ts`: three read-only calls to the Gmail REST API (search, read a message, download an attachment).
- `services.gmail` is wired: `connect`, `findCandidates`, `importAttachment`.

Tests: 13 in `gmail.test.ts` with mocked `fetch` responses and a stand-in for Google's sign-in. `npm run check` passes with 327 tests. Rules branch coverage is still 100%.

Not tested: a real Google sign-in and a real inbox. That needs the Google Cloud setup below and a browser.

Behaviour:
- **Search.** `has:attachment filename:pdf newer_than:60d (report OR lab OR result OR prescription)`, at most 20 messages. A candidate is a message with at least one PDF; `attachmentName` is the first PDF.
- **Import.** The PDF is stored as a `DocumentRecord` with `source: 'email'`, `state: 'pending_confirmation'`. Its title is the file name without `.pdf`, its date is the day the email arrived, and its type is guessed from the subject and file name only (the PDF is not read at this point). A `new_document` review item opens for it: "Add this ... to his records?".
- **Already imported.** Importing the same attachment again returns the existing document. Imported message ids are remembered (in the settings table), so `findCandidates` does not offer them again, even after "Not his" removed the document.
- **Errors.** Not connected, or the token has expired: `unknown` with "Connect Gmail first." or "The Gmail connection has expired. Please connect again." No client id: `unknown` naming `VITE_GOOGLE_CLIENT_ID`. Consent refused or the window closed: `unknown`, with "Nothing was read." in the message.

For the UI side:
- Call `gmail.connect()` straight from the tap on "Connect Gmail". Browsers block the Google window if it is opened later.
- A connection lasts about an hour and does not survive a page reload. After a reload `findCandidates` rejects with "Connect Gmail first."
- Show the CloudNotice ("Reading your inbox for report attachments") around `findCandidates` and `importAttachment`: both talk to Google.

### Google Cloud setup, for the human

1. Go to https://console.cloud.google.com and create a project (for example "CareVault demo").
2. APIs and Services, Library: search for "Gmail API" and enable it.
3. APIs and Services, OAuth consent screen: choose External, fill in the app name and your email, and leave the publishing status on **Testing**. Do not publish: `gmail.readonly` is a restricted scope and a published app would need Google's security review.
4. On the same screen, add the scope `https://www.googleapis.com/auth/gmail.readonly`, and under Test users add the team's test Gmail address. Only test users can connect.
5. APIs and Services, Credentials: Create credentials, OAuth client ID, type "Web application". Under Authorised JavaScript origins add `http://localhost:5173` and `http://localhost:8787` now, and the deployed origin once it exists. No redirect URI is needed for the token model.
6. Copy the client id (it ends in `.apps.googleusercontent.com`) into `.env` as `VITE_GOOGLE_CLIENT_ID`, and into the build environment on Deployxa. It is not a secret, but it is read at build time, so rebuild after changing it.
7. In Testing status Google shows an "unverified app" screen. Choose Continue.

### Preparing the test inbox

Use the test Gmail address from step 4 and send it three emails from any other account, each with one PDF attached. The files in `public/sample-docs/` work well:

| Subject | Attachment |
| --- | --- |
| Your HbA1c lab report | `hba1c-report-2026-11-12.pdf` |
| Lipid profile result | `lipid-profile-2026-11-12.pdf` |
| ECG test report | `ecg-report-2026-09-15.pdf` |

Each subject contains one of the words the search looks for (report, lab, result, prescription). Use synthetic documents only: this inbox is read by the app, and on the demo it is on screen.

## State of the core side after Phase 6

All build phases (1 to 6) are done and pushed on `feat/core`. Open before integration:

1. **Contract request 1** (`docs/contract-requests-core.md`): there is no way to create a prescriber, so a profile that is not the sample cannot apply a prescription or save a visit.
2. **OCR phone test** (Phase 4 above): needed to choose the engine. Tesseract.js is the default until then.
3. **Drug reference spot checks** (`src/core/drugref/SOURCES.md`): four entries to confirm, about 25 products left out.
4. **Accounts**: Supabase, Gemini key, Google OAuth client (checklists in Phases 5 and 6).
5. Nothing has been run in a real browser or against real Supabase, Gemini or Gmail. That is Phase 7.

## v2

### Phase 0: contract v2 and fixtures

Built on `main` by laptop A, so that both laptops start from the same commit:
- **The v2 contract:** `src/contract/types.ts`, `services.ts` and `today.ts`, copied from `docs/specs/00-overview.spec.md` section 8 word for word (60 service methods plus `subscribe`).
- **The v2 sample case:** `src/contract/fixtures/sampleCase.ts`, with two profiles (Ramesh and Lakshmi), the routine stated explicitly with sources and confirmation dates, routine history, allergies and conditions, the next visit, the demo prescription's expected review rows, and `expected`. `sampleCase.test.ts` checks it is internally consistent.
- **The v1 contract** moved unchanged to `src/contract/legacy/`; every v1 import points there. The v1 app and its tests are unchanged.
- **`src/services/index.ts`:** `services` (v1, temporary) and `createServicesV2()`.

Temporary until replaced (marked `TEMPORARY` in the code):
- `src/core/v2/createRealServicesV2.ts`: every v2 method rejects with `ServiceError('unknown', 'not built yet')`. Core steps 1 to 9 replace it.
- `src/ui/mock/v2/createMockServicesV2.ts`: a compatibility mock serving the sample case. Reading, proposals, `decide`, `undo`, `ask`, Gmail import and backup are not modelled; the passport's medicine order and recent changes are simplified. UI step 1 replaces it.
- The v1 side (`src/contract/legacy`, the v1 mock and the v1 core) is removed at the merge checkpoint.

`npm run check`: 35 test files, 508 tests, build passing. `eslint .` clean.

### Step 1: storage v2 and migration from v1

Built, under `src/core/v2/db/` (moved to `src/core/db/` when the v1 side is removed at the merge checkpoint):
- **`schema.ts`: Dexie database `carevault`, upgraded in place.**
  - Version 1 is the v1 schema, unchanged.
  - Version 2 adds the v2 tables: `routine`, `routineEvents`, `healthEntries`, `fieldEvidence`, `proposals`, `snapshots`, `gmailImports`.
  - Version 2 also re-indexes `documents` (`[profileId+sha256]`, `clinicalDate`) and `shares` (`profileId`), and maps every v1 row with `migrateV1` while the v1 tables still exist.
  - Version 3 removes `medicines`, `events` and `reviewItems`.
  - Two steps, because Dexie does not document reading a table in the same version that deletes it.
- **`migrate.ts`:** the pure v1 → v2 mapping of overview section 9.9, function by function. The backup reader uses it in step 2.
- **`repos.ts`:** typed repos for every v2 table, atomic batches, one notification per batch, and the per-profile routine revision (`routineRevision.get` and `.bump`, stored in `settings` as `routineRevision:<profileId>`).
- **`seed.ts`:** `loadSampleProfiles` writes each sample profile that is missing, in one batch, and leaves existing ones untouched.

Tests: 29.
- **`migrate.test.ts`:** every row of the 9.9 table, documents, lines, events, visits, shares and settings.
- **`db.test.ts`:**
  - the schema and indexes;
  - every repo round-trips;
  - profile isolation;
  - rollback across tables, including the revision;
  - one notification per batch;
  - seed idempotency;
  - **a populated v1 database built with the v1 code and upgraded in place.** It checks that no profile, prescriber, document, file, line, visit, question, medicine, event, share revocation token or setting is lost, and that each v1 sample medicine lands in its 9.9 state.

`npm run check`: 37 files, 537 tests, build passing. The v1 app and its tests are unchanged.

Notes for the UI side and the demo:
- **The v1 and v2 sample profiles share the id `sample-profile-ramesh`.** On a browser that loaded the v1 sample, the upgraded data keeps that migrated v1 copy. All its medicines are then "previously listed" and pending the batch review, which is correct behaviour for real data. `loadSampleProfiles` adds only Lakshmi there. **For the demo, use a fresh browser profile** (or clear site data) so the v2 sample case loads as specified.
- **Do not run the v1 app and real v2 services in the same browser profile.** Once upgraded to version 3, v1 code can no longer open the database.
- **v1 Gmail import history is not carried over.** The global list of imported message ids cannot be tied to a profile or an attachment, so a previously imported email may be offered again once; the duplicate check by file hash still catches it.

Not tested: the upgrade in a real browser's IndexedDB (only fake-indexeddb). That happens at the merge checkpoint.

### Step 2: backup v2

Built: `src/core/v2/backup/backup.ts` (moves to `src/core/backup/` at the merge checkpoint).
- **The format is unchanged from v1:** a JSON header line (`format`, `version`, `kdf`, `iterations`, `salt`, `iv`), a newline, then AES-GCM ciphertext; PBKDF2-HMAC-SHA256 with 600,000 iterations and a random salt. The header now says `version: 2`.
- **Export** reads every table in one read transaction, so the copy is consistent. File bytes are encoded after the transaction ends, so it doesn't end early.
- **Import** accepts version 1 and version 2. A version 1 payload is brought to v2 with the same `migrateV1` as the database upgrade. Before anything is replaced, every reference must resolve:
  - each profile-scoped row's profile;
  - each share's profile (null is allowed for v1 links);
  - each line's and checked value's document;
  - each history entry's medicine;
  - each file's record.

  Then everything is replaced in one transaction.

Errors (for the UI):
- `bad_passphrase`: wrong passphrase, or a damaged file. AES-GCM cannot tell the two apart.
- `unsupported_file`: not a backup, an unknown version, a missing table, or a broken reference. The message names the problem, for example "This backup could not be read: a prescription line has no document."
- `unknown` on export: an empty passphrase.

In every refusal case the device is untouched.

Tests: 10.
- A v2 round trip into a device that had other data: every table and file comes back identical, including the routine revision and share revoke tokens.
- **A real v1 backup made by the v1 exporter** restores into a clean v2 database: migrated per section 9.9, files, v1 share tokens and visit questions intact, the new tables empty.
- Wrong passphrase, a damaged file, not-a-backup, an unknown version and a broken reference each leave the device byte-for-byte unchanged.
- Each kind of broken reference is named.

`npm run check`: 38 files, 547 tests, build passing.

Not wired yet: `services.backup` in `createRealServicesV2` still rejects as "not built yet". The services are wired together once documents exist (step 3 onwards). Not tested: a real browser download and restore; that is at the merge checkpoint.

### Step 3: documents v2, doctors, drug reference evidence levels

Built in `src/core/v2/createRealServicesV2.ts`, now the real v2 services for:
- **Profiles:** `profiles.list`, `create`, `update`, `loadSampleProfile` (both sample profiles), `prescribers` and **`addPrescriber`**. `addPrescriber` trims the name, returns the existing doctor of that profile on a case-insensitive name match, and rejects an empty name or an unknown profile.
- **Documents:** `add`, `get`, `list`, `update`, `file`, `fileRecord`, `remove`, `assignProfile`.
- **Settings and wiring:** `settings`, `subscribe`, and `backup` (step 2's module, now wired).

Behaviour for the UI side:
- **`documents.add`** stores the original and its record in one transaction before any reading:
  - The record starts `pending_review`, kind `other`, no date (`dateSource: 'unknown'`), patient match `not_found`.
  - The title is `meta.title`, else the file name without its extension, else "New record".
  - The type is read from the first bytes when the browser gives none (PDF, JPEG, PNG, WebP). An empty file, or anything that is not a photo or a PDF, is `unsupported_file`.
- **Duplicates:** `duplicate` is the earliest record of the same profile with the same hash, from any source. The new record is stored too, so "use the existing record" and "cancel" both mean `documents.remove(newId)`.
- **`documents.update`:**
  - **Dates:** setting `clinicalDate` makes `dateSource: 'user'`; null makes it `'unknown'`. A date that does not exist (2026-02-30) or is not `YYYY-MM-DD` is refused.
  - **Tags** are lowercased and de-duplicated, **test names** trimmed and de-duplicated, and an empty facility becomes null.
  - **The doctor** must belong to the same profile (`not_found` otherwise).
- **`documents.list`:** newest clinical date first; undated records last, newest added first.
- **`documents.remove`** deletes the record, its file, lines, checked values and proposals, and takes it off visits. It returns the snapshots that mention it (their descriptor gets `removedAt`) and the active, unexpired, unrevoked links to those snapshots. The revoke token is never returned.
- **`documents.assignProfile`** moves a record and its checked values to another profile and clears its doctor, because a doctor belongs to one profile.

Drug reference: every entry in `table.json` has `evidence`. 59 are `manufacturer`; Telma 40, Telma H and Okacet 10 are `secondary`; Dolo 650 and the seven generic sample-case names are `project`. `SOURCES.md` has the table.
- **Deviation from the core spec,** which said "the rest are manufacturer": the seven generic names have no manufacturer source, so I marked them `project`. That only makes reading v2 more cautious with them.

Tests: 18 in `createRealServicesV2.test.ts`, replacing the Phase 0 stub test.
- profiles and doctors, including reuse and isolation;
- every document operation, with duplicates across sources but never across profiles;
- type sniffing and refusals that store nothing;
- date validation;
- remove's effect on snapshots, links and visits;
- reassignment;
- sample files and offline;
- the backup through the services;
- one notification per write;
- the evidence levels;
- an exact list of methods still pending.

`npm run check`: 38 files, 564 tests, build passing. `eslint .` clean.

Still pending (reject as "not built yet"): `documents.fields` and `documents.reviewFields`, `reading.read` (step 4); `prescriptions`, `routine`, `health` (step 6); `attention`, `records` (step 7); `visits`, `passport`, `sharing` (step 8); `gmail` (step 9).
