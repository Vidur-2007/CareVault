
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
