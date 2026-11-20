# Core prompts v2 (laptop A)

**How to use this file.** Paste one prompt at a time into the coding agent on laptop A, from the repository root. Wait until a step is finished and pushed before pasting the next. The steps are in the order they must be built; work at your own pace. Every step runs on the branch `feature/core`.

**Rule for every step.** No assistant attribution anywhere. No `Co-Authored-By` trailer, no "Generated with" line, and no mention of any AI assistant in commits, pull requests, code comments or documents. Commits use the human's own git identity.

**Where things stand.** Phase 0 is done: laptop A put contract v2, the v2 sample case, a v2 compatibility mock and a v2 core stub on `main`, and created `feature/core` from it. The v1 app keeps running on `src/contract/legacy` until the merge checkpoint. Laptop A starts with step 1; laptop B starts independently on `feature/ui`.

**Before step 1, the human checks once:**

1. `git checkout feature/core && git pull` succeeds.
2. `npm ci` has been run on this laptop since the last pull of `main`.
3. `.env` exists (copy `.env.example` if not).

---

## Step 1: Storage v2 and migration

```
Read docs/specs/00-overview.spec.md and docs/specs/01-core.spec.md completely. You are laptop A (core) on branch feature/core. Phase 0 is already on main (overview section 7); do not edit src/contract. The v1 app must keep working until the merge checkpoint (overview section 6): build v2 behind createRealServicesV2 and keep the v1 tests passing. You may edit only the paths in section 1 of docs/specs/01-core.spec.md. If you believe the contract or a frozen file must change, stop and write the request in docs/contract-requests-core.md instead.

Build step 1 of the core spec: Dexie version 2 with the new and changed tables, the per-profile routine revision counter, the pure v1-to-v2 mapping in src/core/db/migrate.ts implementing overview section 9.9 exactly, and the v2 seed of both sample profiles.

Write the tests first. They must include a populated v1 database built in the test with the v1 schema, upgraded in place, asserting that no document, file, medicine, event, question or share revocation token is lost and that every legacy medicine lands in the state of section 9.9.

Run npm run check. Add an entry to a "## v2" section of docs/progress-core.md: what was built, what the UI side should know, what was not tested. Commit as "core: storage v2 and migration from v1" and push. Stop.
```

## Step 2: Backup v2

```
Continue on feature/core under the same rules. Build step 2 of the core spec: backup format v2 with a consistent read, and an importer that accepts v1 (through migrateV1) and v2, validates references before replacing anything, and replaces everything in one transaction.

Tests: v2 round trip; a v1 backup produced in the test with the v1 format restores into a clean v2 database with nothing lost; wrong passphrase gives bad_passphrase and changes nothing; a corrupt file gives unsupported_file.

Run npm run check. Update docs/progress-core.md. Commit as "core: backup v2 reads v1 and v2" and push. Stop.
```

## Step 3: Documents v2 and drug reference evidence levels

```
Continue on feature/core. Build step 3 of the core spec: documents.add storing the original first, exact duplicates across every source within one profile, documents.update / fileRecord / assignProfile / remove (with the snapshots and active shares it reports), documents.file including the shipped sample documents, profiles.update and profiles.addPrescriber, and the evidence level on every drug reference entry according to src/core/drugref/SOURCES.md.

Tests: duplicates across sources and never across profiles; remove reports snapshots and shares; addPrescriber returns the existing doctor on a case-insensitive match and rejects an empty name; file type sniffing.

Run npm run check. Update docs/progress-core.md. Commit as "core: documents v2 and prescribers" and push. Stop.
```

## Step 4: Reading v2 and field evidence

```
Continue on feature/core. Read the current documentation of pdf.js, Tesseract.js and PaddleOCR.js for page handling, password errors, and word-level confidence and boxes before writing code.

Build step 4 of the core spec: reading.read on a stored document; every page of text PDFs, up to 4 OCR pages of scanned PDFs with pagesRead and pageCount; locked_pdf; rules/classify.ts; rules/patient.ts; rules/verify.ts with every flag reason from overview section 9.2; documents.fields and documents.reviewFields keeping human decisions across re-reads; cloud reading only with consent and always flagged.

Create small synthetic fixtures under src/core/reading/fixtures/ (text PDF, scanned multi-page PDF, blurry photo, locked PDF). Tests: every flag reason, including a strength read as "7? mg" and "6?0 mg" with raw kept literally; human decisions survive a re-read; no fetch at all without consent; locked_pdf; partial page coverage reported.

Run npm run check. Update docs/progress-core.md. Commit as "core: reading v2 with field evidence" and push. Stop.
```

## Step 5: Sample documents

```
Continue on feature/core. Build step 5 of the core spec: public/sample-docs/rx-rao-2026-11-13.pdf (the demo prescription of overview section 10, with the Aspirin strength printed so that the real reader flags it as needs_verification), the lab report PDF for Lakshmi Iyer, and the HbA1c PDF without a printed date. Generate them from HTML kept in src/core/reading/dev/sample-docs-html/, with invented clinic and lab names and the line "Synthetic sample document" on each page.

Prove it with a test that runs the real reader on the demo prescription and asserts the four lines and the flagged Aspirin strength.

Run npm run check. Update docs/progress-core.md. Commit as "core: v2 sample documents" and push. Stop.
```

## Step 6: The routine and contextual review

```
Continue on feature/core. Read overview sections 9.2 to 9.4 and 10 again before writing code.

Build step 6 of the core spec as pure rules with tests written first: rules/routine.ts, rules/proposal.ts and rules/decide.ts, then wire prescriptions.save, prescriptions.lines, routine.* and health.* in createRealServices.ts. Saving a prescription must never change the routine.

The golden test replays the v2 sample case through the same rules and asserts every value in fixtures `expected`, including the demo prescription's proposal rows, the effect of the decision sequence in overview section 10, 3450 mg, and that nothing crosses between the two profiles.

Also test: every row kind and every choice; skip then reopen; dismiss then proposalFor; the same lines saved twice; stale revision; undo and undo refused; the verification gate refusing, then succeeding after correction; "not mentioned" asked only for the same prescriber; an uncertain match never merging two medicines on its own. Keep 100% branch coverage of src/core/rules and report it.

Run npm run check. Update docs/progress-core.md with behaviour the mock should copy. Commit as "core: reported routine and contextual review" and push. Stop.
```

## Step 7: Attention, totals, search and Ask

```
Continue on feature/core. Build step 7 of the core spec: rules/attention.ts with stable ids, routine.ingredientTotals, rules/search.ts with undated records ordered after dated ones, and rules/ask.ts as a deterministic parser with no language model.

Write the Ask tests as a table of at least 40 English questions with their expected interpretation, including every example in the core spec. Add a test proving that instructions written inside a document's text have no effect beyond being searchable.

Run npm run check. Update docs/progress-core.md. Commit as "core: attention, search and ask" and push. Stop.
```

## Step 8: Passport, snapshots and sharing

```
Continue on feature/core. Build step 8 of the core spec: the live passport using todayFor from src/contract/today.ts, snapshots that are frozen and reused when identical, sharing bound to one snapshot and one profile with a versioned payload, sharing.listUnowned for v1 links, and sharing.open accepting v1 payloads. Make server error messages caregiver-ready, with no status codes in the text.

Tests: a snapshot reads exactly the same after a routine edit and after a document delete (with removedAt); snapshot reuse; two profiles with links never see each other's; a v1 payload opens; expiry, revoke and wrong key end to end against the real routes with an in-memory store.

Run npm run check. Update docs/progress-core.md. Commit as "core: passport snapshots and bound sharing" and push. Stop.
```

## Step 9: Gmail v2

```
Continue on feature/core. Read the current Gmail API documentation for message parts and attachments first.

Build step 9 of the core spec: one candidate per PDF attachment with alreadyImported for the given profile, importAttachment through documents.add with receivedAt kept apart from clinicalDate, import identity per profile, message and attachment, and an unassigned_import attention item on a patient mismatch.

Tests with mocked fetch: two PDFs in one email imported separately; importing for one profile leaves the message offered to the other; the same file by upload and by email is a duplicate; an expired token gives a clear message; a mismatch goes to attention.

Run npm run check. Update docs/progress-core.md. Commit as "core: Gmail per attachment and per profile" and push. Stop.
```

## Step 10: OCR benchmark harness

```
Continue on feature/core. Build step 10 of the core spec: extend src/core/reading/dev/ (not linked from the app) so both engines can be run on a phone over a set of synthetic packs and prescriptions, recording cold and warm time, bytes downloaded, which critical fields were right, wrong or flagged, and whether the cloud would have been offered, with a "Copy results" button producing a Markdown table.

Then give the human short instructions: start the dev server with --host, open the page on two phones on the same Wi-Fi, run the set, and paste the tables into docs/progress-core.md. Do not change the engine order yourself; Tesseract.js stays first until those results are in.

Run npm run check. Update docs/progress-core.md. Commit as "core: OCR benchmark harness" and push. Stop.
```

## Step 11: Server and deployment

```
Continue on feature/core. Read Deployxa's current documentation first.

Build step 11 of the core spec: the page parameter on /api/extract, .github/workflows/keepalive.yml, and the human's setup checklist in docs/progress-core.md (Supabase and schema.sql, Gemini key and model, Google OAuth client in Testing status with test users and origins, Deployxa build and start commands and environment variables, and a second-device check of a share link on the public URL).

Then give the human the same checklist as a numbered list, and stop for them to create the accounts. Do not put any real key in the repository.

Run npm run check. Commit as "core: server updates and deployment setup" and push. Stop.
```

## Step 12: Ready for the merge checkpoint

```
Continue on feature/core. Do step 12 of the core spec: run the whole suite, recheck 100% branch coverage of src/core/rules, and record in docs/progress-core.md which of the ten acceptance tests in overview section 13 are automated in core and which need the UI.

Then merge main into feature/core, run npm run check, push, and open a pull request into main titled "Core v2: records, verification, routine review, snapshots". Write a plain description of what changed and what was not tested, with no assistant attribution. Stop.
```

## Merge checkpoint (after both pull requests are merged)

```
Both feature/core and feature/ui are merged into main. Pull main and create the branch integration-v2.

1. Remove the v1 side as overview section 6 describes: delete src/contract/legacy, the v1 mock (src/ui/mock/createMockServices.ts and its v1 helpers, after checking nothing in src/ui still imports them), and the v1 core (src/core/createRealServices.ts and v1-only modules), and make src/services/index.ts export only v2 (`services` built from createMockServicesV2 or createRealServicesV2). Run npm run check. Commit as "chore: remove the v1 contract and services".
2. Set VITE_USE_MOCK=false. Run the app and the server locally. Walk the first release story in overview section 1 and all ten acceptance tests in section 13 in a real browser against the real services, at desktop and phone sizes. For every mismatch between what the UI expects and what the real services return, fix it inside src/core or server only. If the fix needs a UI or contract change, write it in docs/contract-requests-core.md and tell the human instead.
3. Deploy main to Deployxa following the checklist in docs/progress-core.md and confirm /api/health returns 200 on the public URL. Add the deployed origin to the Google OAuth client.
4. Walk the first release story once on the public URL from a phone, including opening a share link on a second device and revoking it.

Update docs/progress-core.md with the public URL, the results of each acceptance test, and anything still broken. Commit as "core: integration fixes and deploy", push integration-v2, and open a pull request into main with a plain description and no assistant attribution. Stop.
```
