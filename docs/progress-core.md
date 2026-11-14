
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
