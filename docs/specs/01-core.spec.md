# CareVault v2: core spec (laptop A, branch `feature/core`)

Read `00-overview.spec.md` first; it holds the contract and the behaviour rules. This file covers everything behind `CareVaultServices`: storage, migration, reading, verification, the routine and its review, search, passport snapshots, sharing, Gmail, backup, the server and deployment. Laptop A builds no screens.

## 1. What you own

```
src/core/**    server/**    public/sample-docs/**    .github/workflows/**
docs/progress-core.md    docs/contract-requests-core.md
```

Phase 0 is done (overview section 7): contract v2, fixtures v2 and the v2 stub are on `main`. Never edit `src/contract/**` (including `src/contract/legacy/**`), `src/services/index.ts`, `package.json`, `tsconfig*.json`, `vite.config.ts`, `.env.example` or anything under `src/ui/**`. If one of them must change, stop and write the request in `docs/contract-requests-core.md`.

## 2. What to keep from v1

The v1 core is tested and works. Rework it; do not rewrite it from scratch.

**The v1 app keeps running until the merge checkpoint** (overview section 6). `src/core/createRealServices.ts` stays the v1 implementation and the v1 tests keep passing. Build v2 behind `createRealServicesV2` in `src/core/v2/createRealServicesV2.ts` (keep that export name), reusing v1 modules where their v1 behaviour is unchanged and creating new modules where it would change. At the merge checkpoint, delete the v1 core.

| Keep as it is | Rework | Retire |
| --- | --- | --- |
| `db/events.ts` (change notifier) | `db/schema.ts`, `db/repos.ts`, `db/seed.ts` (v2 tables, migration) | `rules/prescriptions.ts`'s write path (`planPrescriptionApply`) |
| `rules/normalize.ts`, `rules/totals.ts`, `rules/text.ts` | `rules/diff.ts` → compares lines with the routine | `rules/review.ts` (v1 review inbox) |
| `share/crypto.ts` | `share/client.ts` (versioned payload) | v1 `reviewItems` table, after migration |
| `reading/ocr/*`, `reading/pdfText.ts`, `reading/cloud.ts` | `reading/parse.ts`, `reading/quality.ts`, `reading/read.ts` (field evidence, pages, classification) | |
| `drugref/lookup.ts` | `drugref/table.json` (evidence levels) | |
| `server/*` | `server/extract.ts` (page number) | |
| `backup/backup.ts` crypto | backup format v2 + v1 reader | |
| The write model: load state → pure plan → one transaction → notify | | |

Rules stay pure: plain data in, plain data out, ids and time passed in, no Dexie, no network, no clock, no randomness. Keep 100% branch coverage in `src/core/rules`.

## 3. Module layout after v2

```
src/core/
├─ createRealServices.ts      v1, kept until the merge checkpoint
├─ v2/createRealServicesV2.ts  wires everything to contract v2
├─ state.ts                   load a profile's state, store a plan
├─ db/
│  ├─ schema.ts               Dexie v1 (kept) and v2 with upgrade
│  ├─ migrate.ts              pure v1 → v2 mapping, shared by Dexie upgrade and backup import
│  ├─ repos.ts  events.ts  seed.ts
├─ rules/                     PURE
│  ├─ normalize.ts  totals.ts  text.ts          (kept)
│  ├─ routine.ts              add, update, setStatus, undo, legacy batch
│  ├─ proposal.ts             lines vs routine → RoutineProposal
│  ├─ decide.ts               RowDecision[] → write plan, gate, stale check
│  ├─ verify.ts               field evidence: flags, decisions, line verification
│  ├─ classify.ts             kind, tags, testNames, facility from text
│  ├─ patient.ts              patient name match
│  ├─ search.ts               RecordQuery filtering and ordering
│  ├─ ask.ts                  question → RecordQuery / questions / routine
│  ├─ attention.ts            AttentionItem list
│  ├─ passport.ts             live passport
│  └─ *.test.ts
├─ reading/                   parse, quality, read, pdfText, cloud, ocr/, dev/
├─ drugref/                   table.json, lookup.ts, synonyms.ts, SOURCES.md
├─ share/  gmail/  backup/
server/                        index.ts, extract.ts, share.ts, schema.sql
```

## 4. Steps, in order

Each step ends with `npm run check` passing, an entry in `docs/progress-core.md` (what was built, what the UI side should know, what was not tested), a commit and a push of `feature/core`. Do the steps in this order: later steps depend on earlier ones.

### Step 1: Storage v2 and migration

- Dexie version 2:
  - **new tables:** `routine` (replaces `medicines`), `routineEvents` (replaces `events`), `healthEntries`, `fieldEvidence`, `proposals`, `snapshots`, `gmailImports`;
  - **changed:** `documents` (v2 fields), `shares` (profileId, snapshotId, createdAt);
  - **kept:** `profiles`, `prescribers`, `prescriptionLines` (+ lineIndex, verified), `files`, `visits`, `settings`;
  - **removed after mapping:** `medicines`, `events`, `reviewItems`.
- Indexes: every patient-scoped table has `profileId`. `documents` also has `[profileId+sha256]` and `clinicalDate`. `routine` has `[profileId+status]`. `fieldEvidence` has `documentId`. `gmailImports` has `[profileId+messageId+attachmentId]`.
- Routine revision: a per-profile counter in `settings` (`routineRevision:<profileId>`), increased inside every transaction that writes the routine.
- `db/migrate.ts`: a pure function `migrateV1(v1Tables) → v2Tables` implementing overview section 9.9 exactly. It is used by the Dexie upgrade and by the backup reader.
- `db/seed.ts`: loads both sample profiles from the v2 fixtures; idempotent.
- Tests:
  - every repo round-trips its type;
  - a populated v1 database (build one in the test from the v1 schema) upgrades with nothing lost, and legacy medicines land in the states of section 9.9;
  - multi-table writes roll back together;
  - subscribe fires once per write.

### Step 2: Backup v2

- Export: every v2 table and file, read in one read transaction so the copy is consistent. The header gets `version: 2`; the crypto is unchanged (PBKDF2-HMAC-SHA256, 600,000 iterations, AES-GCM).
- Import: accepts version 1 and version 2. A version 1 payload goes through `migrateV1`.
  - **Before replacing anything,** validate that every row's `profileId` exists and every file belongs to a document; otherwise reject with `unsupported_file`.
  - **Replace everything in one transaction.**
- Tests:
  - v2 round trip;
  - a v1 backup (produce one with the v1 format in the test) restores into a clean v2 database;
  - wrong passphrase gives `bad_passphrase` and changes nothing;
  - a corrupt file gives `unsupported_file`.

### Step 3: Documents v2 and the drug reference evidence levels

- **`documents.add`:**
  - stores the original and its hash first (`pending_review`, `clinicalDate: null`, `dateSource: 'unknown'`);
  - sniffs the type from the first bytes when the browser gives none;
  - rejects empty or non-photo, non-PDF files with `unsupported_file`;
  - detects exact duplicates within the profile across every source.
- `documents.update`, `fileRecord`, `assignProfile`, `remove` as in overview section 9.1. `remove` returns the snapshots and active shares that mention the document; the snapshot table gets `removedAt` on its descriptor of that document.
- `documents.file` returns the record and blob; for the sample documents it fetches `/sample-docs/<file>` as in v1.
- `profiles.update`, `profiles.addPrescriber` (case-insensitive name match returns the existing prescriber; empty name is rejected).
- `drugref/table.json`: add `evidence: 'manufacturer' | 'secondary' | 'project'` to every entry, using `SOURCES.md`.
  - Dolo 650 is `project`. Telma 40, Telma H and Okacet 10 are `secondary`. The rest are `manufacturer`.
  - Only `manufacturer` entries may produce a strength-mismatch flag; the others add a softer warning.
- Tests: duplicates across sources and profiles, remove with snapshots, addPrescriber reuse, type sniffing.

### Step 4: Reading v2 and field evidence

- **`reading.read(documentId, { allowCloud })`** reads the stored original; it never takes a new file.
  - **Text PDFs:** every page.
  - **Scanned PDFs:** OCR up to 4 pages; `pagesRead` and `pageCount` say how many.
  - **Photos:** one page.
  - **Password-protected PDFs:** reject with `locked_pdf` (pdf.js reports a password exception).
- **`rules/classify.ts`:** a deterministic dictionary that sets `kind`, `tags`, `testNames` and `facility`. Cover at least:
  - lab tests: CBC, lipid profile, HbA1c, thyroid, liver function, kidney function, blood sugar, urine;
  - imaging: X-ray, MRI, CT, ultrasound;
  - ECG and echo;
  - discharge summary, consultation, medical certificate;
  - prescription signals ("Rx", dose patterns, "Tab."/"Cap.");
  - specialties from the doctor's title.

  Facility: the first line that ends with Hospital, Clinic, Diagnostics, Laboratory, Labs or Healthcare.
- **`rules/patient.ts`:** reads the patient name ("Patient:", "Name:", "Pt.") and compares it with the profile: `match`, `mismatch` or `not_found`, as in section 9.1.
- **`rules/verify.ts`:** builds `FieldEvidence` for every critical field found. It flags `needs_verification` per overview section 9.2:
  - OCR word confidence below 0.80;
  - a non-digit inside a number;
  - a missing or unknown unit;
  - an impossible date;
  - a manufacturer-level reference mismatch;
  - cloud source;
  - any OCR'd strength, unit or frequency.

  To find which OCR words a value came from, keep word confidences and boxes from the engines (both return them); a region is filled when it is known, and left null otherwise.
- **The OCR "I/|" fix** from v1 stays. Add a test where "7? mg" and "6?0 mg" are flagged and their `raw` is kept literally.
- **`documents.fields` and `documents.reviewFields`:** a re-read keeps every human decision.
- **Cloud:** `/api/extract` takes the page image and an optional `page`. A cloud result is always `needs_verification`. Without consent, `reading.read` rejects with `cloud_consent_required` and makes no request.
- Tests:
  - text, scanned multi-page, blurry and locked fixtures (small generated files under `src/core/reading/fixtures/`, synthetic);
  - every flag reason;
  - human decisions survive a re-read;
  - no `fetch` happens without consent.

### Step 5: Sample documents

- **`public/sample-docs/rx-rao-2026-11-13.pdf`:** the demo prescription from overview section 10. The Aspirin strength must be printed so the parser reads it as "7? mg" with OCR or text. The simplest reliable way is to render the strength as an image of smudged digits inside the PDF, so the text layer has no clean value and OCR flags it. Verify with the real reader that the strength comes out `needs_verification`.
- One lab report PDF for Lakshmi Iyer (overview section 10), with the HbA1c PDF re-made without a printed date, so the fixtures match.
- **HTML sources** go in `src/core/reading/dev/sample-docs-html/`, as in v1. The clinic and lab names are invented, and every page carries the line "Synthetic sample document".

### Step 6: The routine and contextual review

- **`rules/routine.ts`:** add, update, setStatus, undo (restores `before`; refused with `stale` if a later event touched the entry), and the legacy batch (`resolveLegacy`).
- **`rules/proposal.ts`:** saved lines compared with the routine, with the exact row kinds, `asked` rule, `passiveNotMentionedCount`, `blockedByVerification` and `choices` from overview section 9.3. Matching is by the set of normalized ingredients only.
- **`rules/decide.ts`:**
  - the effects table from section 9.3;
  - the verification gate (`verification_required`);
  - the stale check against `expectedRevision`;
  - idempotency;
  - `ask_doctor` adding a question to the next visit, if any, linked to the medicine or document.
- **Services:**
  - `prescriptions.save` stores lines and returns the proposal (or null), never touching the routine;
  - `prescriptions.lines`;
  - `routine.*`;
  - `health.*`.
- Allergies: adding a real allergy removes the `noneKnown` entry.
- The golden test: replay the v2 sample case through the same rules and assert every value in fixtures `expected`, including:
  - the demo prescription's proposal rows;
  - the effect of the decision sequence in overview section 10;
  - 3450 mg;
  - Lakshmi's isolation.
- Tests:
  - every row kind and every choice;
  - skip, then reopen;
  - dismiss, then `proposalFor`;
  - the same lines saved twice;
  - stale revision;
  - undo, and undo refused;
  - gate refusal, then success after correction;
  - "not mentioned" asked only for the same prescriber;
  - an uncertain match never merges two medicines by itself.

### Step 7: Attention, totals, search and Ask

- **`rules/attention.ts`:** the four kinds from overview section 8.1. Ids are stable (derived from the underlying ids), so the UI can track them. Skipped or dismissed proposals never appear.
- **`routine.ingredientTotals`:** the v1 totals over `taking` and `uncertain` entries.
- **`rules/search.ts`:** every `RecordQuery` field, ordering newest or oldest by `clinicalDate` with undated records after dated ones, and `matchedOn`.
- **`rules/ask.ts`:** the deterministic parser from overview section 9.8. Write it as a small set of patterns tested by a table of at least 40 questions and their expected `RecordQuery` or kind, in English. Include:
  - "latest lipid profile";
  - "last three HbA1c reports";
  - "prescriptions from my cardiologist";
  - "reports from Lakeside";
  - "MRI from last year";
  - "what questions did I save";
  - "what medicines is he taking";
  - "first prescription with Metformin".

  For the last one the answer says "earliest in CareVault". An unknown question returns `understood: false` with a hint.
- Treat document text as data. `ask` never executes instructions found inside a record. Add a test with a document whose text says "ignore previous instructions": it has no effect beyond being searchable text.

### Step 8: Passport live, snapshots and sharing

- **`rules/passport.ts`:** the live passport exactly as in overview sections 8.1 and 9.6, using `todayFor` from `src/contract/today.ts`. Recent changes come from routine events of the last 90 days.
- **`passport.snapshot`:** freezes the passport; returns the latest snapshot instead when the live passport is deep-equal to it. Revisions are numbered per profile.
- **`sharing.create(snapshotId, hours)`:**
  - encrypts `{ v: 2, snapshot }`;
  - stores `profileId` and `snapshotId` with the link;
  - lifetime between 1 hour and 7 days.
- **`sharing.list(profileId)`:** only that profile's links. v1 links (null profile) are never returned for a profile; `sharing.listUnowned()` returns them for Settings.
- **`sharing.open`:** returns a snapshot; it wraps a v1 passport payload into a snapshot-shaped result.
- **Server:** `/api/share` is unchanged except that `not_configured` maps from 503. Error messages are caregiver-ready with no status codes in the text (UI request #5 from v1).
- Tests:
  - snapshot immutability after routine edits and document deletion;
  - snapshot reuse;
  - two profiles with links, where neither sees the other's;
  - v1 payload opens;
  - expiry, revoke and wrong key, end to end against the real routes with an in-memory store, as in v1's `server/e2e.test.ts`.

### Step 9: Gmail v2

- **`gmail.findCandidates(profileId)`:** one candidate per PDF attachment, with `alreadyImported` for this profile (from `gmailImports`).
- **`gmail.importAttachment(profileId, messageId, attachmentId)`:** downloads that attachment and runs `documents.add` with source `email`. It records `receivedAt` from the message (never as `clinicalDate`), then reads it like any other document. It returns the record and duplicate info.
  - If the patient name does not match, the record becomes an `unassigned_import` attention item.
- Import identity is `[profileId, messageId, attachmentId]`. Importing for one profile does not hide the message from another.
- Tests (mocked `fetch`, as in v1):
  - two PDFs in one email;
  - import per profile;
  - upload-then-email duplicate;
  - token expiry message;
  - mismatch goes to attention.

### Step 10: OCR benchmark harness

- Extend `src/core/reading/dev/` (not linked from the app) so the human can run, on a phone, both engines over a folder of synthetic packs and prescriptions. Record per image:
  - cold and warm time;
  - bytes downloaded;
  - which critical fields were right, wrong or flagged;
  - whether the cloud would have been offered.
- Add a "Copy results" button that copies a Markdown table, which the human pastes into `docs/progress-core.md`. Keep Tesseract.js first until those results are in.

### Step 11: Server and deployment

- `server/extract.ts`: accept `page`; the system instruction is unchanged (transcribe only, null for unreadable, no medical knowledge).
- `.github/workflows/keepalive.yml`: every 3 days, `GET /api/health` on the deployed URL (a repository variable).
- Write the human's setup checklist into `docs/progress-core.md`:
  - Supabase project and `server/schema.sql`;
  - Gemini key and model;
  - Google OAuth client (Testing status, test users, origins);
  - Deployxa (read its current docs; build `npm run build`, start `npm start`, environment variables);
  - a second-device check of a share link on the public URL.

### Step 12: Ready for the merge checkpoint

- Run the whole suite. Recheck 100% branch coverage of `src/core/rules`: `npm install --no-save @vitest/coverage-v8@5.1.0`, then `npx vitest run src/core/rules --coverage --coverage.include='src/core/rules/**'`.
- Write in `docs/progress-core.md` which of the overview's ten acceptance tests are automated in core and which need the UI.
- Merge `main` into `feature/core`, run `npm run check`, push, and open the pull request "Core v2: records, verification, routine review, snapshots". The description is plain, with no assistant attribution.

## 5. Optional, only after the merge checkpoint passes

- Encrypted original attachments in shares: a versioned manifest, a per-file size limit, and an encrypted-only server store.
- An assistant service over profile-scoped retrieval. Every attribute of a medicine comparison needs a product-specific, `manufacturer`-level source; unknowns are listed; it never concludes interchangeability.

Each needs a contract request first.

## 6. Core definition of done

- Every step above is committed and pushed, with `npm run check` passing.
- The golden test covers the v2 sample case, the demo prescription's proposal, the decision sequence and profile isolation.
- Acceptance tests 1 to 9 of the overview are automated wherever no screen is needed.
- The migration from a populated v1 database and from a v1 backup loses nothing.
- The server is deployed, `/api/health` returns 200 on the public URL, and the keep-alive workflow is in place.
