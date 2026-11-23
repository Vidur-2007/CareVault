# Contract requests from the core side

## 1. A way to add a prescriber (open, raised 2026-11-14 in Phase 3)

**Problem.** The contract can list prescribers (`profiles.prescribers`) but cannot create one. Two methods need a `prescriberId` that already exists:

- `prescriptions.apply(profileId, documentId, prescriberId, lines)`
- `visits.save({ prescriberId, ... })`

The sample profile is seeded with two prescribers, so the demo case works. A profile made with "Create a profile" has none and no way to get one, so for that profile a prescription cannot be applied and a visit cannot be saved. Both calls reject with `not_found`. This affects UI spec 7.6 ("Looks like a prescription from Dr. X ... with editable ... prescriber") and 7.8 ("a form to add one (prescriber, date, time)").

**Requested change** to `src/contract/services.ts`, in `profiles`:

```ts
addPrescriber(profileId: T.ID, input: { name: string; specialty: string }): Promise<T.Prescriber>;
```

Behaviour the core would implement: trims both fields, rejects an empty name, and returns the existing prescriber when the profile already has one with the same name (ignoring case), so scanning a second prescription from the same doctor does not create a duplicate.

**Until it is agreed:** nothing in the frozen files was changed. The core has no workaround; prescribers exist only through the sample profile.

## Status (v2)

Request 1 is resolved in contract v2: `profiles.addPrescriber(profileId, { name, specialty })` is part of `docs/specs/00-overview.spec.md`, section 8.2. New requests for v2 go below this line.

## 2. The demo Aspirin row's name before the check (resolved before core step 7)

**Problem.** In `src/contract/fixtures/sampleCase.ts`, `expected.demoPrescription.proposalRows` lists the Aspirin row as `lineProductName: 'Aspirin 75 mg'` together with `blockedByVerification: true`. The two cannot hold at once. While the row is blocked, the strength has not been checked, so the line still reads `Aspirin 7? mg` (the same fixture's `aspirinStrengthAsRead`). Once it is corrected to 75 mg, the line is `Aspirin 75 mg` and the row is no longer blocked.

**How the core tests it now** (`src/core/v2/golden.test.ts`): kinds, routine entries, `asked` and `blockedByVerification` are checked against the fixture right after saving, and the name is checked as `Aspirin ${aspirinStrengthAsRead}`. After the correction, every field of every row is checked, including `lineProductName`, with `blockedByVerification: false`.

**Requested change** (fixtures only, no type change): either
- document on `proposalRows` that `lineProductName` is the name after verification, or
- add `lineProductNameBeforeCheck: 'Aspirin 7? mg'` to the Aspirin row.

**Until it is agreed:** nothing in the frozen files was changed. A mock that returns `Aspirin 75 mg` while blocked shows a value the user has not confirmed yet. The UI should show the line as read until the check is done.

**Resolution.** Agreed and applied, before laptop B started v2, so no coordination was needed:
- `proposalRows` is now the review right after saving: Aspirin is `Aspirin 7? mg` and blocked;
- the new `proposalRowsAfterCheck` is the review after the strength is corrected to 75 mg: Aspirin is `Aspirin 75 mg` and not blocked;
- the golden test compares every field of every row in both states. It also checks that the blocked line cannot reach the routine: `started` is refused, a batch that includes it is refused as a whole, and no event is written.

**Convention recorded at the same time:** `routine.history` and `routine.profileHistory` return events newest first. This is noted in `src/contract/services.ts`, overview 8.2 and UI spec 7, so the mock on laptop B follows it.

## Answers to the UI requests (core, before the merge checkpoint)

Agreed with the human. The contract comments and overview 9.1 and 9.2 are updated to match, and the core implements each answer.

| UI request | Answer | In core |
| --- | --- | --- |
| v2-1 value formats; `lines` or evidence | **Accepted.** The formats are written on `FieldEvidence.value`, and the evidence is the source of truth. | `prescriptions.save`, as the UI proposed. A flagged or unknown value cannot be replaced through `lines`. One addition: an `extracted` value edited in the line form is recorded as `user_corrected` with the line's value (not ignored), so an edit made there is kept and audited. |
| v2-2 retake the photo | **Deferred** to after the checkpoint (needs a new method and several originals per record). The UI leaves the action out, its own default. | None. |
| v2-3 `medicine_pack` kind | **Agreed, deferred to laptop B after the checkpoint.** Adding the kind changes the UI's `Record<DocumentKind, …>` maps and its `isPack` guess, which are laptop B's files. The core will then classify packs as `medicine_pack`. | None yet. |
| v2-4 date or patient set by hand | **Accepted.** | `documents.update({ clinicalDate })` corrects the `document_date` evidence (or marks it `unknown` when cleared). `assignProfile` confirms the `patient_name` evidence. |
| v2-5 `matchedOn` vocabulary | **Accepted**, with the labels core also uses: `'title' \| 'tag' \| 'test name' \| 'facility' \| 'doctor' \| 'specialty' \| 'kind' \| 'date' \| 'starred' \| 'medicine'` (Ask only). | The doctor's name now matches as `doctor` and the specialty as `specialty`. |
| v2-6 printed date shown as "Date set by you" | **Accepted.** | Accepting the date read from the document keeps `dateSource: 'document'` and confirms its evidence. |
| v2-7 "Yes, it is this profile's" | **Intended:** `patientMatch` stays `mismatch`, because the paper says another name, and the confirmed `patient_name` evidence records the answer. | **Bug fixed:** the `unassigned_import` attention item now goes away once the patient name is confirmed or corrected. Before, it stayed for good. |
