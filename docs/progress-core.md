
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

### Step 4: reading v2 and field evidence

Built, as new v2 modules (the v1 reader is unchanged):
- **`src/core/v2/reading/parse.ts`:** a parser that works page by page and keeps the literal text of every value it reads. An unclear digit stays as read (`7? mg`, no value); a missing strength stays missing; a bare number with no unit is marked unclear. A `Tab.` line still becomes a medicine line when its name is a known ingredient, even with no readable strength. The v1 helpers for dates, doses, forms and doctor names are reused.
- **`src/core/v2/reading/pdf.ts`:** every page of a text PDF, the page count, and one page rendered for OCR. A password-protected PDF rejects with `locked_pdf` (pdf.js reports `PasswordException`).
- **`src/core/v2/reading/ocr.ts`:** Tesseract.js (asks for `blocks` output, which is off by default since v6) and PaddleOCR.js, both returning lines with word confidence (0 to 1) and boxes. Both load on first use. Tesseract.js stays first.
- **`src/core/v2/reading/read.ts`:**
  - a text PDF is read from its text layer, every page, with no OCR;
  - a scanned PDF gets OCR on at most the first 4 pages;
  - a photo gets OCR.

  When the read is not good enough (under 20 characters, confidence under 0.6, or no known medicine on a prescription or pack), it rejects with `cloud_consent_required` unless cloud reading is allowed. **No request is made without consent.** The cloud client's v1 errors become v2 errors, and a 503 becomes `not_configured`.
- **`src/core/v2/rules/classify.ts`:** kind, tags, test names (CBC, lipid profile, HbA1c, thyroid, liver, kidney, blood sugar, urine, X-ray, MRI, CT, ultrasound, ECG, echo), facility, specialty and a suggested title.
- **`src/core/v2/rules/patient.ts`:** reads "Patient:", "Name:" and "Pt." and matches against the profile, ignoring case, titles, order and initials, and allowing one extra name word. A different first name is a mismatch.
- **`src/core/v2/rules/verify.ts`:** one `FieldEvidence` per critical field, flagged per overview 9.2:
  - word confidence below 0.80;
  - an unclear digit;
  - a missing strength or unit;
  - not a real date;
  - another patient's name;
  - a strength that differs from a **manufacturer-level** reference entry (weaker entries only add a line warning);
  - a value taken from the reference, or from the cloud;
  - any strength, unit or frequency read from a photo.

  It also handles decisions (confirm, correct, leave unknown), the merge on re-read (human decisions always kept) and line verification.
- **Services:** `reading.read(documentId, { allowCloud })`, `documents.fields`, `documents.reviewFields`.

For the UI side:
- **`reading.read` stores two things:** the field evidence, and on the record only `pageCount`, `pagesRead`, `patientNameRead` and `patientMatch`. Kind, title, date, tags, test names and facility come back in the candidate as suggestions; save them with `documents.update`.
- **An unreadable strength** appears in `candidate.lines` as strength `0`; its evidence (`raw`, `value: null`, `needs_verification`) is what to show. After a correction, the next read's lines carry the corrected value.
- **Evidence is ordered:** document-level fields first, then each line, its fields in reading order.
- **`documents.reviewFields` errors:**
  - `not_found` for a field that is not part of the record;
  - `unknown` ("Please enter the corrected value.") for a correction with no value;
  - nothing is stored on either refusal.
- **A field left `unknown`** keeps its line unverified. A frequency is only evidenced when a dose was printed, so a pack with no dose does not block adding it.
- **Note for step 6:** a line is `verified` only when all its fields are confirmed or corrected. Plan: `prescriptions.save` treats the lines the user saves as reviewed, turning their `extracted` fields into `user_confirmed`, but never `needs_verification` or `unknown` ones. That is how the demo's Telmisartan row is unblocked while Aspirin stays blocked, as in fixtures `expected`.

Fixtures (synthetic, in `src/core/v2/reading/fixtures/`, with their HTML sources):
- a two-page text prescription;
- a five-page scanned PDF with no text layer;
- a blurred photo;
- **a real password-protected PDF.** No PDF tool on this machine could encrypt, so it is built from the PDF reference's RC4 security handler (R2); Poppler's `pdfinfo` refuses it with "Incorrect password".

Tests: 110 for v2 rules, parsing and reading, plus 9 through the services. Branch coverage of `src/core/v2/rules` and `src/core/v2/reading/parse.ts`: **100%** (339 of 339). Bugs found and fixed along the way:
- the reference check ignored evidence levels;
- "Pt." with no colon was not read as a patient label;
- an `Inj.` line was labelled a tablet; it is now `other`, since the contract has no injection form.

`npm run check`: 40 files, 617 tests, build passing. `eslint .` clean.

Not tested here: the two OCR engines themselves and rendering a scanned page, which need a real browser (Node has no canvas, and the engines download models). Tests use the engines' real output shapes with fixed values. The phone benchmark in step 10 runs them for real.

### Step 5: v2 sample documents

Built in `public/sample-docs/`, from HTML in `src/core/reading/dev/sample-docs-html/` (invented clinic and lab, and the line "Synthetic sample document made for the CareVault demo" on every page):
- **`rx-rao-2026-11-13.pdf`, the demo prescription.** Dr. Kavita Rao, 13 Nov 2026, four lines:
  - Amlodipine 10 mg 1-0-0;
  - Telmisartan 80 mg 1-0-0;
  - Rosuvastatin 10 mg 0-0-1;
  - Aspirin with a smudged strength, 0-1-0.

  On paper the second digit is an ink blot; the text layer reads `7? mg`, so the reader flags it ("A digit could not be read") and has no value for it. It is the only flagged field on the page.
- **`thyroid-profile-lakshmi-2026-10-02.pdf`:** Lakshmi Iyer's thyroid profile, 2 Oct 2026, referred by Dr. Farah Khan.
- **`hba1c-report-2026-11-12.pdf`:** remade with no printed date, so the emailed report stays undated, as in the v2 sample case.
  - The v1 copy, with its date, moved to `hba1c-report-2026-11-12-v1.pdf`, and the v1 core's own file map points there, so v1 behaviour and its tests are unchanged.
  - The v2 contract's file name (frozen) is the undated one.

Tests: 6 in `src/core/v2/reading/sampleDocs.test.ts`, using the real v2 reader through the services (pdf.js only; the test fails if OCR or the cloud is ever needed):
- the demo prescription's four lines, its one flag, and the literal `7? mg`;
- after correcting the strength to 75 mg, its lines equal fixtures `expected.demoPrescription.verifiedLines` exactly;
- the HbA1c report has no date;
- Lakshmi's report matches her profile;
- every seeded document has its file and reads back its sample-case date on the device.

`npm run check`: 41 files, 623 tests, build passing.

For the demo: photograph or upload `public/sample-docs/rx-rao-2026-11-13.pdf` as the new prescription. Uploading the PDF uses its text layer; a photo of the printed page goes through OCR, which may read the blot differently but will still flag it.

### Step 6: the reported routine and contextual review

Rules, all pure (state in, plan out, ids and time passed in):
- **`src/core/v2/rules/routine.ts`:**
  - add, update, setStatus (a stopped entry taken again is `restarted`) and the legacy batch (`resolveLegacy`);
  - undo, which restores `before`, undoes a replacement as one change, and is refused with `stale` when a later event touched the entry;
  - the verification gate, and allergies, where "No known allergies" is exclusive with listed allergies.
- **`src/core/v2/rules/proposal.ts`:** saved lines against the routine (`taking`, `uncertain`, `not_started`):
  - row kinds, `asked`, `choices`, `blockedByVerification`, the row order and `passiveNotMentionedCount`, as in overview 9.3;
  - matching by the set of normalized ingredients only. When several entries share them, an identical entry wins, then this prescriber's, then the first by name;
  - a name that matches an entry whose ingredients differ, or a line with no ingredients, is `uncertain_match` and is never merged.
- **`src/core/v2/rules/decide.ts`:** the effects table, checked in full before anything is applied:
  - the gate on `started` and `started_new`;
  - the stale check;
  - idempotency;
  - `ask_doctor`, which adds a question to the next visit (no duplicate text) and turns a changed or missing entry into `uncertain`;
  - `same_medicine` and `different_medicine`, which reclassify the row and offer it again.

Services (`createRealServicesV2`):
- **`prescriptions.save`** stores the lines and never touches the routine. Values still `extracted` on the saved lines become `user_confirmed`, because the user saw them in the line form; flagged values and values left unknown keep the line unverified. Saving the same lines again returns the same proposal and writes nothing. When nothing differs, it returns `null` and removes an earlier proposal.
- **`prescriptions.lines`**.
- **`routine.*`:**
  - `proposalFor` always recomputes against the current routine and lines, keeps the decisions, and reopens a dismissed review.
  - `decide` writes the routine, the events, the visit and the proposal in one transaction and raises the revision once.
  - `undo` reopens the review row whose decision it reverses.
  - `history` and `profileHistory` are newest first.
- **`routine.ingredientTotals`**, using the v1 totals over `taking` and `uncertain` entries. It is used here for the 3450 mg check; step 7 keeps it.
- **`health.*`**.
- **`documents.reviewFields`** also corrects the saved lines, so "Check the values" unblocks the row.

How a proposal remembers things (stored with it, never returned):
- which entry an uncertain line was said to be;
- which entries each decision wrote, so undo can reopen the row.

Rows decided with a routine-changing answer are kept exactly as decided. Skipped and ask-the-doctor rows are compared afresh. A proposal is `reviewed` when every asked row has an answer other than skip.

Tests:
- **`src/core/v2/review.test.ts`, 41 tests through the services:**
  - every row kind and every choice;
  - skip, then reopen;
  - dismiss, then `proposalFor`;
  - the same lines saved twice;
  - stale;
  - undo, undo refused, and undoing either half of a replacement;
  - gate refusal, then success after correction;
  - "not mentioned" asked only for the same prescriber;
  - uncertain matches never merging;
  - the pack gate;
  - allergies;
  - the two profiles kept apart.
- **`src/core/v2/golden.test.ts`:** reads the demo PDF with the real reader. The rows match the fixture, Aspirin is blocked and named exactly as printed, and `started` is refused. After the strength is corrected, the rows and lines match the fixture exactly. The sample decisions then give the expected routine. It also checks 3450 mg and that Lakshmi is untouched.
- **`src/core/v2/rules/review.rules.test.ts`:** the edge paths. It found one bug: undoing an addition whose entry was already gone crashed while recording the event. Fixed.

Branch coverage of `src/core/v2/rules`: **100%** (509 of 509). `npm run check`: 44 files, 677 tests, build passing. `eslint` clean.

Contract request 2 is filed: the fixture names the blocked Aspirin row `Aspirin 75 mg`, which cannot be true before the check.

TEMPORARY, still `not built yet`: attention and records (step 7); visits, passport and sharing (step 8); gmail (step 9).

### Before step 7: contract request 2 resolved

- **Fixtures:** `expected.demoPrescription.proposalRows` is now the state right after saving, with Aspirin as `Aspirin 7? mg` and blocked. The new `proposalRowsAfterCheck` is the state after the correction to 75 mg, with Aspirin as `Aspirin 75 mg` and not blocked. Overview section 10 says the same.
- **Tests:**
  - the golden test compares every field of every row in both states;
  - it shows the blocked line cannot reach the routine: `started` is refused, a batch that includes it is refused as a whole (Telmisartan stays unchanged), and no event or Aspirin entry is written;
  - a fixture test checks the two states differ only in the Aspirin row.
- **Convention:** `routine.history` and `routine.profileHistory` are newest first. This is noted in `src/contract/services.ts`, overview 8.2 and UI spec 7.

### Step 7: attention, totals, search and Ask

Rules, all pure:
- **`src/core/v2/rules/attention.ts`:** the four kinds. Ids are derived from their cause, so they stay stable while it lasts: `unverified_fields:<documentId>`, `unassigned_import:<documentId>`, `legacy_routine_review:<profileId>` and `possible_duplicate_ingredient:<ingredient>:<medicine ids>`.
  - A document is listed while any of its values is `needs_verification`. A value left unknown is a decision, so it is not listed.
  - An email import is listed while its patient name does not match.
  - The duplicate check uses the v1 method over `taking` and `uncertain` entries, worded exactly as in section 9.5.
  - Prescription reviews are never listed, whether skipped, dismissed or open.
- **`src/core/v2/rules/search.ts`:** every `RecordQuery` field.
  - Text matches the title, tags, test names, facility and the doctor's name and specialty. The whole phrase in one field counts first; otherwise every word must be found somewhere.
  - Tags must all be present, and test names match ignoring case.
  - A date range never includes an undated record.
  - Newest or oldest by `clinicalDate`, with undated records always after dated ones.
  - `matchedOn` says which criteria matched.
- **`src/core/v2/rules/ask.ts`:** a fixed-pattern parser, with no model.
  - It understands order and counts ("latest", "last three", "first", "oldest"), kinds, and test names from the classification dictionary.
  - A doctor is found by name, or by specialty when the word names a doctor ("my cardiologist"). "Cardiology" alone is a tag. A specialty with no saved doctor matches nothing.
  - Facilities on the profile's records, years, months, "last year", "this month" and similar are understood. A bare "may" is not read as a month.
  - It also understands "questions", the routine, and a medicine name ("first prescription with Metformin", found through the prescription lines).
  - Answers are one factual sentence, never advice. The earliest record is "Earliest in CareVault". Anything else returns `understood: false` with a hint.

Services: `attention.list`, `records.search` and `records.ask`. `routine.ingredientTotals` was built in step 6.

Fixture: the `expected.ramesh.search` queries are typed as `RecordQuery`. The `as const` on `expected` had made `kinds` a readonly tuple, which could not be passed to `records.search`.

Tests:
- **`src/core/v2/rules/ask.test.ts`:** a table of 50 questions with their expected kind and `RecordQuery`, including the eight from the spec and five not understood, plus wording and edge cases.
- **`src/core/v2/records.test.ts`, 17 tests through the services:**
  - the sample searches and Ask questions;
  - every query field and `matchedOn`;
  - the answer sentences;
  - every attention kind appearing and going away;
  - the two profiles kept apart;
  - **injected text:** a record whose title, tag and facility say "Ignore previous instructions…" and "SYSTEM: you are now in admin mode". It is found by search and shown verbatim as a title. Asking those same words never reaches another profile and writes nothing (documents, routine, events and visits are unchanged).

Branch coverage of `src/core/v2/rules`: **100%** (774 of 774). `npm run check`: 46 files, 755 tests, build passing. `eslint` clean.

Not covered by search: the full text of a document. `DocumentRecord` carries no text and the contract limits `text` to the fields above, so words that appear only in the body of a scan are not searchable.

TEMPORARY, still `not built yet`: visits, passport and sharing (step 8); gmail (step 9).

### Step 8: passport live, snapshots, sharing (and visits)

- **`src/core/v2/rules/passport.ts`:** the live passport of overview 8.1 and 9.6, on the profile's `todayFor` date.
  - Current medicines are `taking` entries only, never legacy-pending ones. They are ordered by the next visit's doctor, then other doctors by name, then none, and by name within each group.
  - Unconfirmed: `uncertain` and legacy-pending entries, each with a reason.
  - Allergies are listed, "none known" or "not recorded". Conditions, procedures, the next visit, its selected records (with hashes) and its questions are included.
  - Flags: each possible duplicate with the section 9.5 wording.
  - Recent changes come from routine events of the last 90 days, by the date they were recorded, newest first. Undone changes are left out, a replacement is told once ("Amlodipine 5 mg replaced by Amlodipine 10 mg"), and confirmations are not changes.
  - Device times (UTC) are read in the device's time zone, so a change made after midnight in India shows on the right day.
- **Snapshots:** `passport.snapshot` freezes the live passport. When it is identical to the latest snapshot, that snapshot is returned and nothing is stored. Revisions are numbered per profile, `snapshots` lists newest first, and opening the live passport never creates one.
- **Sharing**, in `src/core/v2/share/client.ts` with the v1 AES-GCM crypto:
  - `create` encrypts `{ v: 2, snapshot }` and stores the link with its profile, its snapshot and `createdAt`. A lifetime outside 1 hour to 7 days is refused, not clamped.
  - `list` returns only that profile's links, newest first. `listUnowned` returns the v1 links, which are never shown for a profile.
  - `revoke` works as in v1.
  - `open` validates the payload. A v1 passport is wrapped as a snapshot (revision 0, no profile, allergies "not recorded"), and anything else is refused.
  - A 503 from the server becomes `not_configured`. No message carries a status code. The server is unchanged.
- **Visits:**
  - `next` is the first visit on or after the profile's today.
  - `save` checks the doctor and the time, refuses another profile's visit id, tidies and de-duplicates questions, and drops records that are not this profile's.
  - `addQuestion` keeps a question once and checks that a linked medicine or record belongs to the profile.
  - `removeQuestion`.
  - `setSharedDocuments` refuses another profile's record with `not_found`.

Tests:
- `src/core/v2/passport.test.ts`, 15 tests: the sample passports, recent changes, ordering, snapshot reuse and revisions, immutability after routine edits and a document deletion (only `removedAt` changes), and every visit method.
- `server/e2e-v2.test.ts`, 10 tests against the real server routes with an in-memory store:
  - the doctor opens exactly the shared snapshot, and the server only holds ciphertext;
  - a later routine change does not alter what the link shows;
  - expiry, revoke and a wrong key;
  - lifetimes;
  - two profiles that never see each other's links, and v1 links listed only as unowned;
  - a v1 link opening as a snapshot;
  - a bad payload;
  - a server with sharing off, and offline.
- `src/core/v2/rules/passport.rules.test.ts` and `src/core/v2/share/client.test.ts`: the edge paths and every server status.
- The v2 tests pass in the local time zone, `TZ=Asia/Kolkata` and `TZ=UTC`.

Branch coverage of `src/core/v2/rules` and `src/core/v2/share`: **100%** (898 of 898). `npm run check`: 50 files, 791 tests, build passing. `eslint` clean.

TEMPORARY, still `not built yet`: gmail (step 9).

### Step 9: Gmail v2

- **`src/core/v2/gmail/api.ts`:** read-only Gmail calls with the caregiver's in-memory token, using v1's token source (`core/gmail/token.ts`) unchanged.
  - One candidate per PDF attachment, so two PDFs in one email are two rows. Images are never offered. `receivedAt` is the message's arrival time.
  - **Attachment identity.** Gmail's own attachment id is not stable: it can change every time the same message is fetched. The `attachmentId` CareVault hands out is therefore the attachment's part id within its message (stable), falling back to Gmail's id only when a part has none. The current Gmail id is looked up at download time. The tests' fake Gmail issues a new id on every fetch to prove this.
- **`gmail.findCandidates(profileId)`:** `alreadyImported` comes from `gmailImports` for this profile, and only while the imported record still exists.
- **`gmail.importAttachment(profileId, messageId, attachmentId)`:**
  - stores the original, its record (source `email`, `receivedAt` from the message, `clinicalDate` null) and the import identity `[profileId, messageId, attachmentId]` in one transaction;
  - then reads it on the device, like any other record (no cloud without consent);
  - a failed reading keeps the record;
  - the same attachment again for the same profile returns the existing record;
  - a file already uploaded is reported as a duplicate;
  - a different patient name becomes an `unassigned_import` attention item.
- **`documents.add`** and email imports share one storing helper, so both keep "original first, before any reading".
- **`gmail.connect`:**
  - a copy with no Google client id gives `not_configured` ("Gmail import is not set up on this copy.");
  - before any connection, a call says "Connect Gmail first.";
  - after the token expires, or Gmail refuses it, the message is "The Gmail connection has expired. Please connect again.";
  - no message carries a status code.
- **Every method of contract v2 is now built.** The `notBuilt` placeholder and its test are gone.

Tests: `src/core/v2/gmail/gmail.test.ts`, 15 tests with mocked `fetch`:
- two PDFs in one email;
- import per profile, where one profile's import does not hide the message from the other;
- the same attachment twice, and again after the record is removed;
- upload-then-email duplicate;
- a mismatch going to attention, until it is assigned;
- a failed reading keeping the record;
- an empty inbox and an empty attachment;
- unknown profile, message or attachment, with nothing stored;
- connect first, token expiry, a refused token, no client id, offline and a failing Gmail;
- the token never stored.

Branch coverage of `src/core/v2/rules`, `src/core/v2/share` and `src/core/v2/gmail`: **100%** (933 of 933). `npm run check`: 51 files, 805 tests, build passing. `eslint` clean.

### Step 10: OCR benchmark harness

The harness is a dev page (`src/core/reading/dev/index.html`). It is not linked from the app and not in the production build; the build was checked for it.
- **The set:** eight synthetic images in `src/core/reading/dev/benchmark/`, rendered with headless Chrome from `benchmark-html/` by `render-benchmark.sh`. Each carries "Synthetic benchmark image made for the CareVault OCR test".
  - Five packs: two clean, one stylised script brand (white on red), one tilted with glare across the strength line, one tilted and blurred.
  - Three prescriptions: a clean printed one with old-style numerals, the demo prescription with the smudged Aspirin strength, and one in a handwriting-style font.
  - What each one says is in `benchmarkSet.ts`.
- **The page:** it runs Tesseract.js, then PaddleOCR.js, over the set (or your own photos, which are timed only). For every image and engine it records:
  - cold time (a new engine; the first image also downloads the model) and warm time (the same engine again);
  - bytes downloaded and stored (see the limits below);
  - OCR confidence;
  - whether the cloud would have been offered (`needsCloud`, the app's own rule);
  - each critical field (name, ingredient, strength, unit, frequency): right, right but asked to check, wrong but flagged, **wrong and not flagged**, or not read.

  The reading goes through the real v2 parser and field-evidence rules. "Copy results" copies a Markdown table: per image, per engine totals, and a list of every wrong value that was not flagged. On a phone that refuses the clipboard over plain http, the table appears in a box to copy by hand. `?autorun&device=<name>` starts the set from a link.
- **Scoring** is in `src/core/v2/reading/benchmark.ts`, tested in `benchmark.test.ts` (18 tests). The answer key is checked against the parser: the exact printed text of every image is scored, and nothing may be wrong except the known limits listed in the test.
- **Engine order unchanged:** Tesseract.js stays first until phone results are in.

**Parser bug found by the benchmark, fixed:** on a pack, the ingredient name ran back across the line break into the brand line. "Crocin" above "Paracetamol Tablets IP 500 mg" read as one name, "Crocin Paracetamol", so nothing was found, even from perfect text. Dolo worked only because its brand is in the drug reference and its "650" stopped the run. Names now stop at a line break, with a regression test in `reading.test.ts`.

**Known parser limit, not fixed:** a brand printed on two lines ("Crocin" / "ADVANCE") gives only the first line as the product name. The ingredient and strength are right. The benchmark reports this as "wrong, not flagged" on purpose.

**Limits of the byte counts:** "Downloaded" sees only requests the page itself makes; a model fetched inside a worker, or from a server that hides sizes, is not counted. "Stored" is the growth of the site's storage, which catches models the engines cache. For an exact figure, use the Network panel through remote debugging (chrome://inspect from a computer).

#### How to run it on a phone

1. On the computer, on the same Wi-Fi as the phones: `npm run dev -- --host`. Vite prints a Network address, such as `http://192.168.1.20:5173/`.
2. On each phone, open `http://<that address>/src/core/reading/dev/index.html`, type the phone's name, and press **Run the benchmark set**. Keep the screen on; the first run downloads the models and can take several minutes.
3. Press **Copy results** and paste the table below, under "Benchmark results". Do this on two phones, ideally one mid-range Android.
4. Optionally, add a few real pack photos with "your own photos" (timed and cloud-checked only).

#### Smoke run on this Mac (not a phone)

To prove the harness works end to end before anyone takes it to a phone, the set was run once in headless Chrome on this Mac, driven over the Chrome debugging protocol with `?autorun`. **These are desktop numbers: they say nothing about phone speed.** What they do show:

- **The design's "always check a strength from a photo" rule earned its place.** Tesseract read the ink blot in the demo prescription as a clean "78 mg", with 0.90 confidence and no "?". Only that rule stopped "Aspirin 78 mg" reaching the routine unchecked. PaddleOCR read the blot as "7•mg", which the parser flags as unreadable.
- **Tesseract drops large coloured brand lines.** On the Dolo and Telma packs it never read the brand, so the product name came from the composition line ("Paracetamol Tablets IP 650 mg"). The ingredient and strength were right. PaddleOCR read both brands.
- **On the blurred, tilted pack, Tesseract read nothing usable** ("Pantoprazoye … Pao mo"), and the app would offer the cloud. PaddleOCR read it fully.
- **PaddleOCR misread old-style numerals** ("Telmisartan 8o mg", "51-0-0"), losing that line's strength and one frequency; they were not read, not misread. It also failed its very first load ("Failed to fetch") before downloading 28.2 MB on the next attempt; the phone runs should watch for this.
- **Cold start:** Tesseract downloaded about 3.6 MB (stored) and started in under a second here; PaddleOCR downloaded 28.2 MB.
- Across both engines, the only "wrong and not flagged" values are product names. No strength, unit, frequency or ingredient was wrong without a flag.

Possible parser improvements this suggests, **not made**, to avoid tuning the parser to its own synthetic test set before real phone photos are in:
- read a letter "o" between a digit and a unit as zero ("8o mg");
- prefer a large brand line over a composition line as the product name.

##### Smoke run: MacBook headless Chrome (smoke run, not a phone), 2026-11-20

User agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36`

| Image | Engine | Cold (s) | Warm (s) | Downloaded | Stored | Confidence | Right | Right, asked | Wrong, flagged | Wrong, NOT flagged | Not read | Cloud offered |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pack-dolo-650.png | tesseract | 0.9 | 0.1 | 127 KB | 3.6 MB | 0.93 | 1 | 2 | 0 | 1 | 0 | no |
| pack-telma-40.png | tesseract | 0.2 | 0.1 | 0 B | 0 B | 0.92 | 1 | 2 | 0 | 1 | 0 | no |
| pack-crocin-advance.png | tesseract | 0.2 | 0.1 | 0 B | 0 B | 0.89 | 1 | 2 | 0 | 1 | 0 | no |
| pack-glycomet-glare.png | tesseract | 0.1 | 0.1 | 0 B | 0 B | 0.91 | 2 | 2 | 0 | 0 | 0 | no |
| pack-pan-40-blurred.png | tesseract | 0.2 | 0.1 | 0 B | 0 B | 0.76 | 0 | 0 | 0 | 0 | 4 | yes |
| rx-printed-clean.png | tesseract | 0.3 | 0.2 | 0 B | 0 B | 0.91 | 6 | 9 | 0 | 0 | 0 | no |
| rx-demo-smudged.png | tesseract | 0.3 | 0.2 | 0 B | 0 B | 0.90 | 7 | 12 | 1 | 0 | 0 | no |
| rx-handwriting-style.png | tesseract | 0.2 | 0.1 | 0 B | 0 B | 0.92 | 2 | 3 | 0 | 0 | 0 | no |
| pack-dolo-650.png | paddle | – | – | – | – | – | – | – | – | – | – | failed: Failed to fetch |
| pack-telma-40.png | paddle | 5.8 | 0.2 | 28.2 MB | 0 B | 0.99 | 2 | 2 | 0 | 0 | 0 | no |
| pack-crocin-advance.png | paddle | 0.3 | 0.1 | 0 B | 0 B | 0.95 | 1 | 2 | 0 | 1 | 0 | no |
| pack-glycomet-glare.png | paddle | 0.2 | 0.1 | 0 B | 0 B | 0.98 | 2 | 2 | 0 | 0 | 0 | no |
| pack-pan-40-blurred.png | paddle | 0.2 | 0.1 | 0 B | 0 B | 0.99 | 1 | 3 | 0 | 0 | 0 | no |
| rx-printed-clean.png | paddle | 0.3 | 0.2 | 0 B | 0 B | 0.98 | 6 | 9 | 0 | 0 | 0 | no |
| rx-demo-smudged.png | paddle | 0.3 | 0.2 | 0 B | 0 B | 0.98 | 7 | 7 | 2 | 0 | 4 | no |
| rx-handwriting-style.png | paddle | 0.3 | 0.2 | 0 B | 0 B | 0.98 | 2 | 3 | 0 | 0 | 0 | no |

| Engine | Images | Mean warm (s) | Right | Right, asked | Wrong, flagged | Wrong, NOT flagged | Not read | Cloud offered |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tesseract | 8 | 0.1 | 20 | 32 | 1 | 3 | 4 | 1 |
| paddle | 7 | 0.2 | 21 | 28 | 2 | 1 | 4 | 0 |

Wrong and not flagged:
- pack-dolo-650.png, tesseract: Dolo 650, medicine_name read as "Paracetamol Tablets IP 650 mg", printed "Dolo 650"
- pack-telma-40.png, tesseract: Telma 40, medicine_name read as "Telmisartan Tablets IP 40 mg", printed "Telma 40"
- pack-crocin-advance.png, tesseract: Crocin Advance, medicine_name read as "Advance", printed "Crocin Advance"
- pack-crocin-advance.png, paddle: Crocin Advance, medicine_name read as "Crocin", printed "Crocin Advance"

#### Benchmark results (phones)

(Paste the phone tables here.)

### Step 11: server updates and deployment setup

- **`POST /api/extract` takes an optional `page`** (a whole number from 1 to 500). It goes into the user turn sent with the image: "It is page 2 of the document." The system instruction is unchanged (transcribe only, null for unreadable, no medical knowledge), and a test checks that. The cloud client sends the page when it has one, and the v2 reader sends page 1 for the first page of a scanned PDF and no page for a photo.
- **v2 cloud errors:** a 503 becomes `not_configured`, "Cloud reading is not set up on this server yet.", and other messages lose their status code, e.g. "(500)".
- **`.github/workflows/keepalive.yml`:** every 3 days (and by hand), `GET /api/health` on the repository variable `CAREVAULT_URL`.
  - It does nothing when the variable is not set.
  - It fails if the app does not answer, and warns if the share store does not.
  - The health route's one cheap query keeps a free Supabase project from pausing after a week without activity.
- **Deployment rehearsed locally:** `npm run build` then `PORT=8899 npm start`.
  - `/api/health` answers `{ ok: true, shareStore: false, cloudReading: false }` with no keys set.
  - The app and its client-side routes (e.g. `/share/:id`) are served.
  - `/api/extract` answers "not set up".
  - The OCR benchmark page and its images are not served in production.

#### Setup checklist (for the human)

No real key goes in the repository. Values go into the hosting dashboard, and into a local `.env` (git-ignored) for local use.

1. **Supabase (share store).**
   1. Create a free project at supabase.com. A region near the users (Mumbai) keeps links fast.
   2. In the SQL editor, run `server/schema.sql` once. It creates the `shares` table with row level security on and no policies, so only the server's service role can use it.
   3. In Project Settings > API, copy the **Project URL** to `SUPABASE_URL` and the **service_role** key to `SUPABASE_SERVICE_ROLE_KEY`. The service role key is a server secret: never put it in a `VITE_` variable.
   4. Free projects pause after about a week without activity. The keep-alive workflow (step 5) prevents that.
2. **Gemini (cloud reading, used only with consent per document).**
   1. In Google AI Studio, create an API key and put it in `GEMINI_API_KEY`.
   2. Set `GEMINI_MODEL` to a current model from AI Studio's model list that accepts images and structured JSON output. A Flash-class model is enough; the server sends temperature 0 and a JSON schema.
   3. Check Google's current terms before real patient documents go to the cloud reader: on unpaid tiers, Google may use prompts to improve its products. A key on a billing-enabled project avoids that.
3. **Google OAuth client (Gmail import).**
   1. In Google Cloud Console, create a project and enable the **Gmail API**.
   2. On the OAuth consent screen, choose External, publishing status **Testing**, and the scope `.../auth/gmail.readonly`. Add each caregiver's Gmail address as a **test user**; only they can connect while in Testing, which also avoids Google's verification for this restricted scope.
   3. Under Credentials > Create OAuth client ID > **Web application**, add the **Authorized JavaScript origins**: `http://localhost:5173` for development, and the public `https://` URL once it exists. No redirect URI is needed: the app uses the token model.
   4. Put the client ID in `VITE_GOOGLE_CLIENT_ID`.
4. **Deployxa (hosting).** Its public docs say projects connect from GitHub, GitLab or Bitbucket; it detects the build and start commands, which can be overridden; secrets are stored encrypted; deployments are health-checked; and custom domains get automatic HTTPS. The free plan has 3 projects and 512 MB of RAM. They do not say how environment variables are entered, whether they are visible at build time, which port is expected, or whether free apps sleep. Check those in the dashboard.
   1. Connect the GitHub repository and deploy the `main` branch. Until the merge checkpoint, `main` is the v1 app.
   2. **Build command:** `npm run build`. It builds the app with Vite and compiles the server. The install must include devDependencies (Vite and TypeScript are build tools), so use `npm ci` and do not set `NODE_ENV=production` for the install step.
   3. **Start command:** `npm start` (`node dist-server/server/index.js`). Node 22.12 or newer, as in `package.json` `engines`.
   4. **Runtime variables:** `GEMINI_API_KEY`, `GEMINI_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   5. **Build-time variables:** `VITE_GOOGLE_CLIENT_ID` and `VITE_USE_MOCK=false`. Vite writes these into the app while building, so they must be available to the build step. After changing one, redeploy.
   6. **Port:** the server listens on `PORT`. If Deployxa does not set it, set `PORT` to the port it expects.
   7. **Health check path**, if asked: `/api/health`.
   8. After the first deploy, open `https://<public URL>/api/health`. With every key set it answers `{"ok":true,"shareStore":true,"cloudReading":true}`.
5. **Keep-alive.** In the GitHub repository, go to Settings > Secrets and variables > Actions > **Variables** and add `CAREVAULT_URL` = the public URL. Then run the "Keep alive" workflow once from the Actions tab. GitHub stops scheduled workflows in a repository with no activity for 60 days; a push or a manual run restarts them.
6. **Add the public URL to the OAuth client's JavaScript origins** (step 3.3), then check that "Connect Gmail" opens Google's window on the public site.
7. **Second-device check of a share link.**
   1. On phone A, open the public URL, load the sample profile, and share Ramesh's passport for 1 hour.
   2. Open the link on phone B, on mobile data and not signed in to anything. The same passport appears.
   3. On phone A, revoke the link. Reloading on phone B shows "This link was revoked."
   4. Repeat after the merge checkpoint, when the v2 app is on `main`.

### Step 12: ready for the merge checkpoint

**Laptop B's contract requests answered** (see `docs/contract-requests-core.md`): v2-1, v2-4, v2-5, v2-6 and v2-7 are implemented in core; v2-2 is deferred; v2-3 is agreed but deferred to laptop B, because it changes UI files. New tests:
- evidence wins over the lines on save, including an edit in the line form becoming a correction;
- accepting, changing and clearing a date;
- assigning a profile;
- "Yes, it is this profile's" clearing the attention item;
- the `specialty` label;
- the reconcile rule's edge paths.

**Coverage:**
- `src/core/rules` (v1): 100% of branches (411 of 411).
- `src/core/v2/rules`, `share`, `gmail`, `reading/parse.ts` and `reading/benchmark.ts`: 100% (1166 of 1166).

`npm run check`: 52 files, 834 tests, build passing. `eslint` clean.

**The ten acceptance tests of overview section 13:**

| # | Acceptance test | Automated in core | Needs the UI (walked at the checkpoint) |
| --- | --- | --- | --- |
| 1 | "7? mg" + "Yes, started" refused until verified; the passport shows the corrected value | `golden.test.ts` (real reader on the demo PDF, refusal, correction, decisions), `review.test.ts` (gate) | Check the values beside the original; the blocked row in Review changes |
| 2 | Omitted medicine, question skipped: unchanged, never raised again | `review.test.ts` (skip, then reopen), `records.test.ts` (a skipped or dismissed review never appears in attention) | Home shows nothing about it |
| 3 | Same prescription saved twice: same proposal, no events | `review.test.ts` | None |
| 4 | v1 database and v1 backup brought to v2 with nothing lost | `db/db.test.ts` (Dexie upgrade in place), `db/migrate.test.ts` (every mapping of 9.9), `backup/backup.test.ts` (v1 backup) | The batch review of legacy medicines |
| 5 | Two profiles with shares: no cross QR, `sharing.list` per profile | `server/e2e-v2.test.ts`, `passport.test.ts` | The QR printed on each passport |
| 6 | Email per profile; upload-then-email duplicate; two PDFs in one email | `gmail/gmail.test.ts` | Real Gmail account (needs the OAuth client) |
| 7 | Snapshot unchanged after a routine edit and a deleted original | `passport.test.ts` | "Original removed on …" on the snapshot page |
| 8 | No cloud without consent; locked PDF kept, `locked_pdf` | `reading/reading.test.ts`, `createRealServicesV2.test.ts` | The consent prompt |
| 9 | Each QR opens its snapshot; wrong key, revoked, expired | `server/e2e-v2.test.ts` (real routes) | The shared page's states; second device on the public URL |
| 10 | `npm run check` passes on `main` after the merge | Run at the merge | None |
