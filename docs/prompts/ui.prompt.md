# UI prompts v2 (laptop B)

**How to use this file.** Paste one prompt at a time into the coding agent on laptop B, from the repository root. Wait until a step is finished and pushed before pasting the next. The steps are in the order they must be built; work at your own pace. Every step runs on the branch `feature/ui`.

**Rule for every step.** No assistant attribution anywhere. No `Co-Authored-By` trailer, no "Generated with" line, and no mention of any AI assistant in commits, pull requests, code comments or documents. Commits use the human's own git identity.

**Where things stand.** Phase 0 is done: laptop A put contract v2, the v2 sample case, a v2 compatibility mock and a v2 core stub on `main`. The v1 app keeps running on `src/contract/legacy` until the merge checkpoint. Laptop B does not wait for laptop A at any point before the merge checkpoint.

**Before the first prompt, the human does this once:**

1. Run `git checkout main && git pull`, then `npm ci`.
2. Check that `.env` exists (copy `.env.example` if not) and set `VITE_USE_MOCK=true` for building the screens.

---

## Step 0: Review Phase 0 and branch

```
Read docs/specs/00-overview.spec.md and docs/specs/02-ui.spec.md completely. You are laptop B (UI). Phase 0 is already on main, written by laptop A (overview section 7).

1. Create the branch feature/ui from the current main and push it with upstream tracking.
2. Run npm run check and confirm it passes.
3. Review, without editing them: src/contract/types.ts, src/contract/services.ts and src/contract/today.ts against overview section 8; src/contract/fixtures/sampleCase.ts against overview section 10; and the v1/v2 side-by-side setup in overview section 6 (src/services/index.ts, src/ui/mock/v2/createMockServicesV2.ts).
4. Write anything you disagree with, or anything the UI cannot be built from, in docs/contract-requests-ui.md with a reason, and tell the human. Do not change src/contract, src/core or src/services yourself.

Record the review as the first entry of a new "## v2" section in docs/progress-ui.md. Commit as "ui: review of contract v2" and push feature/ui. Stop.
```

## Step 1: Mock services v2

```
Continue on feature/ui. You may edit only the paths in section 1 of docs/specs/02-ui.spec.md. The v1 app must keep working until the merge checkpoint (overview section 6): build the v2 screens against src/contract and createServicesV2(), and keep the export name createMockServicesV2. If you believe the contract or a frozen file must change, stop and write the request in docs/contract-requests-ui.md instead.

Build section 5 of the UI spec: replace the Phase 0 compatibility mock in src/ui/mock/v2/createMockServicesV2.ts with in-memory mock services for every method of contract v2, from the v2 fixtures, with the artificial delay and the localStorage.cvMockFail switches (including 'stale', 'locked', 'cloud_consent', 'verification', 'reading', 'all'). Apply simple versions of overview section 9: proposals with all row kinds, the verification gate, stale revisions, duplicates, snapshots and shares bound to a snapshot, attention items, deterministic search and ask, and todayFor.

Write a test that the mock reproduces every value in fixtures `expected`, and a test per failure switch.

Run npm run check. Add an entry to the "## v2" section of docs/progress-ui.md: what was built, what differs from the spec, open questions. Commit as "ui: mock services v2" and push. Stop.
```

## Step 2: Shell, navigation, profile menu, Welcome

```
Continue on feature/ui. Build section 3 and screen 4.1 of the UI spec as the v2 app, using createServicesV2() and switching src/main.tsx to it: the v2 navigation (Home, Records, Passport, Ask, with Settings behind the profile menu), every v2 route pointing at its screen or a placeholder, document.title per route, todayFor for every date, cached data cleared on profile switch, and Welcome with the "I manage my own records" option and the emergency contact.

Retire the v1 routes and screens that the spec retires. Keep the design system and reusable components.

Tests: every route renders; titles are set; switching profile never shows the previous profile's data, even briefly.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: v2 shell and navigation" and push. Stop.
```

## Step 3: Records, search and record detail

```
Continue on feature/ui. Build screens 4.3 and 4.5 of the UI spec (verification and review links come in later steps): search with filters and "Matched:" labels, grid and timeline with an undated group, source shown on each item, the record detail with metadata, date source and page coverage, edit, star, file, and delete with the snapshots it affects and the offer to revoke their links.

Tests: search by test, doctor, facility and date; undated records in their own group; delete listing snapshots and revoking links.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: records and search" and push. Stop.
```

## Step 4: Add a record and Check the values

```
Continue on feature/ui. Build screens 4.4 and 4.6 of the UI spec: one add flow for camera, file and Gmail that saves the original first; the duplicate choices; reading progress with page coverage; the cloud consent panel; the locked PDF message; details with "Add this doctor" and the patient-mismatch choices; the pack-photo ending; and Check the values with the original beside each flagged field, the literal value read, reasons, page jump, Correct / It is right / Leave unknown / Retake the photo.

Tests: each duplicate choice; consent panel; locked PDF; partial pages; correcting "7? mg" to 75 mg; leave unknown; retake keeps earlier decisions; mismatch handling; leaving the flow keeps the original as "Not yet filed".

Run npm run check. Update docs/progress-ui.md. Commit as "ui: add a record and field verification" and push. Stop.
```

## Step 5: Passport and the routine

```
Continue on feature/ui. Build screens 4.8 and 4.9 of the UI spec: the live passport with the patient strip and next visit; current medicines with source labels and last-confirmed dates; "Current use not confirmed" with the legacy batch review that never blocks printing; manual "Add a medicine he takes"; the possible duplicate ingredient card; allergies with three states, conditions and procedures; recent changes; questions; reports to share; the list of earlier passports; and the medicine detail with before-and-after history and Undo.

Tests: manual add without a prescription; status change with confirmation; undo and undo refused; legacy batch; the three allergy states; the duplicate card with complete and incomplete totals.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: passport and reported routine" and push. Stop.
```

## Step 6: Review changes

```
Continue on feature/ui. Read overview sections 9.2 and 9.3 again. Build screen 4.7 of the UI spec: one card per asked row with exactly the questions and choices in the spec; "No change" and passive rows collapsed without buttons; blocked rows sending the user to Check the values and back; choices sent together with expectedRevision; confirmation before any "stopped" or "not taking"; stale handling that reloads and keeps matching choices; Not now; and the after-save summary with per-change Undo.

Tests: the demo prescription's rows exactly as in fixtures `expected`; blocked row → verify → return → choose; skip leaves nothing on Home; Not now then reopen from the record page; stale reload keeping choices; summary and Undo.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: contextual prescription review" and push. Stop.
```

## Step 7: Snapshots, print and share

```
Continue on feature/ui. Build section 4.11 of the UI spec: the snapshot view; print that always creates or reuses a snapshot first and prints a QR only for a link to that exact snapshot; print styles that continue on further pages rather than hide allergies, unconfirmed entries or flags; share bound to a snapshot with expiry choices, QR, copy and revoke; and the public share page with its states.

Never choose a QR from a list of links by expiry.

Tests: print creates or reuses a snapshot; the printed QR only for that snapshot; two profiles never cross; a snapshot reads the same after a routine edit and after a document delete; the share page states.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: snapshots, print and share" and push. Stop.
```

## Step 8: Ask

```
Continue on feature/ui. Build screen 4.12 of the UI spec: the question box with example chips, the interpretedAs sentence, the factual answer text, result cards that open the record or passport section, the not-understood hint, and the footer. No model and no chat history.

Tests: each example chip; understood false; results open the right record.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: ask CareVault" and push. Stop.
```

## Step 9: Gmail import, Home, Settings

```
Continue on feature/ui. Build screens 4.2, 4.10 and 4.13 of the UI spec: Home with the passport card, next visit, the "Needs attention" list limited to its four kinds, Add a record, the Ask box and recent records; Gmail import with one row per PDF attachment and "Already imported" per profile, joining the add flow; and Settings with profiles, doctors, cloud reading, Gmail, backup with the version note, older share links (sharing.listUnowned) and sample data.

Tests: two attachments of one email are separate rows; "Already imported" per profile; Home shows only the four attention kinds and never a medicine-status question; older links can be revoked.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: home, Gmail import and settings" and push. Stop.
```

## Step 10: Accessibility, responsive and polish

```
Continue on feature/ui. Do step 10 of the UI spec: run an axe check on every route at 1280 px and 390 px (install axe-core in a scratch folder, not in package.json, and inject it into the page), fix every serious and critical finding, clear the v1 findings listed in the spec, and confirm no horizontal scroll at 390 px and tap targets of at least 44 px.

Record the before-and-after findings in docs/progress-ui.md. Run npm run check. Commit as "ui: accessibility and responsive polish" and push. Stop.
```

## Step 11: Ready for the merge checkpoint

```
Continue on feature/ui. Do step 11 of the UI spec: update README.md (what CareVault v2 is, how to run it, the first release story), take screenshots of every screen at desktop and phone size into docs/screenshots/, and walk the first release story against the mock.

Then merge main into feature/ui, run npm run check, push, and open a pull request into main titled "UI v2: records, verification, routine review, passport". Write a plain description of what changed and what was not tested, with no assistant attribution. Stop.
```

## Merge checkpoint (after laptop A's integration pass)

```
Both pull requests are merged and laptop A has pushed integration-v2 (with the v1 side removed). Check it out.

Run the app with VITE_USE_MOCK=false against the real services. Walk the first release story and the ten acceptance tests in overview section 13 at desktop and phone sizes. Fix only UI-side mismatches in src/ui. If a fix needs a core or contract change, write it in docs/contract-requests-ui.md and tell the human. Polish copy, empty states and print output on the real data.

Update docs/progress-ui.md with the results. Commit as "ui: polish on real services", push integration-v2, and tell the human it is ready to merge into main. Stop.
```
