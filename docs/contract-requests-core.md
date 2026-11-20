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

## 2. The demo Aspirin row's name before the check (open, raised in core step 6)

**Problem.** In `src/contract/fixtures/sampleCase.ts`, `expected.demoPrescription.proposalRows` lists the Aspirin row as `lineProductName: 'Aspirin 75 mg'` together with `blockedByVerification: true`. The two cannot hold at once. While the row is blocked, the strength has not been checked, so the line still reads `Aspirin 7? mg` (the same fixture's `aspirinStrengthAsRead`). Once it is corrected to 75 mg, the line is `Aspirin 75 mg` and the row is no longer blocked.

**How the core tests it now** (`src/core/v2/golden.test.ts`): kinds, routine entries, `asked` and `blockedByVerification` are checked against the fixture right after saving, and the name is checked as `Aspirin ${aspirinStrengthAsRead}`. After the correction, every field of every row is checked, including `lineProductName`, with `blockedByVerification: false`.

**Requested change** (fixtures only, no type change): either
- document on `proposalRows` that `lineProductName` is the name after verification, or
- add `lineProductNameBeforeCheck: 'Aspirin 7? mg'` to the Aspirin row.

**Until it is agreed:** nothing in the frozen files was changed. A mock that returns `Aspirin 75 mg` while blocked shows a value the user has not confirmed yet. The UI should show the line as read until the check is done.
