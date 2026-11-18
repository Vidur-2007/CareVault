# Contract requests from the UI side

## 1. Add a doctor when a prescription comes from a new prescriber (raised 2026-11-18, phase 4)

**Problem.** When an uploaded prescription is from a doctor who is not yet in `profiles.prescribers(profileId)`, the UI cannot add them. The contract has no write method for prescribers. `prescriptions.apply` needs a `prescriberId`, so today the caregiver must pick an existing doctor. A prescription from a new doctor cannot be saved as a prescription.

**Proposed change** (additive, `src/contract/services.ts`):

```ts
profiles: {
  // ...existing methods
  addPrescriber(profileId: T.ID, input: { name: string; specialty: string }): Promise<T.Prescriber>;
};
```

**UI until then.** The details step shows "“Dr. X” was read from the document but is not one of this profile’s doctors." The caregiver can still save the file under another type, such as Other.

## 2. Precache the pdf.js worker for offline previews (raised 2026-11-18, phase 4)

**Problem.** `vite.config.ts` precaches `**/*.{js,css,html,svg,png,ico,woff2}`. The pdf.js worker is emitted as `assets/pdf.worker.min-*.mjs`, so it is not precached. Offline, PDF thumbnails and the document preview fall back to an icon and the download link.

**Proposed change** (`vite.config.ts`, frozen):
- Add `mjs` to `workbox.globPatterns`.
- Raise `workbox.maximumFileSizeToCacheInBytes` to about 3 MB, because the worker is about 1.3 MB, under the 2 MB default, but close to it.

Low priority. Images and everything else already work offline.
