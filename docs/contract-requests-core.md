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
