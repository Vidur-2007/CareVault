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

## Status update (2026-11-18, phase 7 trial on the real services)

- **#1 (add a prescriber)** is also raised by the core side as their request #1, with the same method. One agreed change to `src/contract/services.ts` would close both.
- **The sample visit date** (from `progress-ui.md`) is solved by the core: the real services keep the sample profile's calendar on 14 Nov 2026, as the mock does.

## 3. The merged build fails: the PWA precache meets the OCR bundle (raised 2026-11-18, phase 7) (urgent)

**Problem.** On `feat/ui` + `feat/core` merged, `npm run build` (and so `npm run check`, CI and deployment) fails:

```
Configure "workbox.maximumFileSizeToCacheInBytes" to change the limit: the default value is 2 MiB.
  - assets/worker-entry-*.js is 11.3 MB, and won't be precached.
  - assets/dist-*.js is 10.5 MB, and won't be precached.
```

vite-plugin-pwa 2 treats this as an error. The two files are PaddleOCR.js (onnxruntime-web and OpenCV.js), which the real reading code imports lazily. Neither branch fails alone: `feat/core`'s `main.tsx` is still the phase 0 placeholder, so its build never includes the reading code.

**Proposed change** (`vite.config.ts`, frozen), in `VitePWA({ workbox })`:

```ts
globIgnores: ['**/worker-entry-*.js', '**/dist-*.js', '**/ort*.wasm'],
```

The OCR engine should not be precached: it loads on the first scan, as core spec §5 says. If the file names are not stable enough to match, raising `maximumFileSizeToCacheInBytes` is the other way to stop the error.

**Also for the core side:** about 22 MB of OCR code ships with the app even if Tesseract stays the default. Until the phone test decides the engine, consider leaving PaddleOCR out of the build.

## 4. Reading a pack photo: the product name is taken from the subtitle (raised 2026-11-18, phase 7) (core)

On a clear, flat pack photo printed with "DOLO 650" in large type and "Paracetamol Tablets IP 650 mg" below it, `reading.read` returned `productName: "Paracetamol Tablets IP 650 mg"`. The ingredient and strength were right. The drug reference knows "Dolo 650", so the brand line should win.

The UI marks the field "Check this" and the caregiver can correct it, so this is not blocking.

## 5. Error messages with technical detail (raised 2026-11-18, phase 7) (core, FYI)

Some real service messages carry text meant for developers:
- "The link could not be created (503). Please try again."
- "The passport could not be loaded (503)."
- "Gmail import is not set up: VITE_GOOGLE_CLIENT_ID is missing."

The UI now rewrites these before showing them (`src/ui/hooks/toServiceError.ts`):
- `network` becomes "CareVault could not reach the server. Check the internet connection and try again.";
- status codes are removed;
- setting names become "This feature is not set up on this copy of CareVault yet."

Nothing is needed. If the core prefers to send caregiver-ready text, the UI keeps working either way.

**#3 applied on `main` (2026-11-18), with the human's approval:** `workbox.globIgnores: ['**/worker-entry-*.js', '**/dist-*.js']` in `vite.config.ts`. Checked on a merge of `main` and `feat/core`: `npm run check` passes (489 tests). The two OCR files are still emitted and load on the first scan; they are not precached.

---

# v2

## Status of the v1 requests (2026-11-23)

| v1 request | Status in v2 |
| --- | --- |
| #1 add a prescriber | **Resolved:** `profiles.addPrescriber` is in contract v2 (§8.2). |
| #2 precache the pdf.js worker | **Still open.** The worker (`assets/pdf.worker.min-*.mjs`) is still not precached, so PDF previews do not work offline. One line in `vite.config.ts`: add `mjs` to `globPatterns`. Low priority. |
| #3 OCR bundle and precache | Applied on `main`. |
| #4 pack name from the subtitle | Core; still open on their side. |
| #5 technical error text | **Resolved:** v2 adds `not_configured`, and UI spec §8 fixes the wording. |

## v2-1. Field values: their format, and whether `lines` or the evidence wins (raised 2026-11-23, step 0)

**Why the UI cannot build it as written.** Verification happens on `FieldEvidence` (`reviewFields`). The routine is written from `ExtractedLine` values (`prescriptions.save(documentId, prescriberId, lines)`, and `routine.add(..., { documentId })` for packs). The contract does not say how the two meet:

1. **`FieldEvidence.value` is a string with no defined format per field.** For a strength, is it `"75"` or `"75 mg"` (there is a separate `unit` field)? For `frequency`, is it doses per day (`"1"`) or the printed pattern (`"0-1-0"`)? For `document_date`, is it ISO `YYYY-MM-DD`? For `ingredient`, is it the normalized name? The UI writes `correct` values and the core parses them, so both must agree.
2. **Which value reaches the routine?** After the user corrects Aspirin's strength to 75 mg in `reviewFields`, does `prescriptions.save` take the strength from the `lines` the UI passes, or rebuild it from the evidence? If `lines` says 75 and the evidence says something else (or the reverse), which wins, and is that an error? This is the safety gate of overview §2 ("No unverified critical value reaches the routine"). It must not depend on the UI copying values correctly.

**Proposed change** (types comments and §9.2, no new methods):
- `FieldEvidence.value` formats:
  - `medicine_name`: the product name as text;
  - `ingredient`: the normalized lowercase name;
  - `strength`: a decimal number with no unit (`"75"`, `"0.5"`);
  - `unit`: one of `DoseUnit`;
  - `frequency`: doses per day as a decimal number (`"1"`);
  - `instruction`: free text;
  - `document_date`: `YYYY-MM-DD`;
  - `patient_name`: free text.
- **The evidence is the source of truth for every critical field that has evidence.** `prescriptions.save` and `routine.add(..., { documentId })` rebuild those fields from the latest `user_confirmed` / `user_corrected` evidence and ignore the values passed in `lines`. Fields without evidence come from `lines`. `PrescriptionLine.verified` is computed from the evidence as now.

The UI will still pass corrected values in `lines` (they come back from `reading.read` / `documents.fields`), so either answer works for the UI. The point is to define it once, for both sides.

## v2-2. "Retake the photo, keeping all decisions": no way to replace a record's original (raised 2026-11-23, step 0)

**Why the UI cannot build it as written.** UI spec §4.6 has *Retake the photo (back to capture for this record, keeping all decisions)*. The contract can only add a new record (`documents.add`). Field decisions belong to a `documentId`, so a retaken photo saved as a new record starts with no decisions. Re-reading the old record reads the old, blurry photo again.

**Proposed change** (`src/contract/services.ts`, `documents`):

```ts
// Adds a better photo or scan of the same document. The earlier original is kept (never lost)
// and the new one becomes the one that is read and shown first. Field decisions are kept.
replaceOriginal(id: T.ID, file: Blob): Promise<T.DocumentRecord>;
```

The earlier file stays available, following principle §2 "The original file is always kept". A `reading.read(id, …)` afterwards reads the new file and keeps every human decision (§9.2 already says re-reading keeps them).

**Until it is agreed:** *Retake the photo* will save the new photo as a new record, and say plainly that decisions start again. Or the action is left out of step 4. The human chooses; the default is to leave it out.

## v2-3. Pack photos have no document kind (raised 2026-11-23, step 0)

**Why it matters.** UI spec §4.4 step 7 ends the flow for *pack photos* with "Add it to the routine?". `DocumentKind` has no value for a medicine pack, so neither `ExtractionCandidate.kind` nor the stored record can say "this is a pack". The UI would have to guess. In v1 the guess leaked pack photos into "Reports to share" (fixed in phase 7 with a heuristic).

**Proposed change** (`src/contract/types.ts`):

```ts
export type DocumentKind =
  | 'prescription' | 'lab_report' | 'imaging' | 'test' | 'discharge_summary'
  | 'consultation' | 'certificate' | 'medicine_pack' | 'other';
```

The core classifier returns `medicine_pack` when the page reads as a pack (a product from the drug reference, a composition line, no prescriber or patient). The user can change it in the details step like any kind. Records lists them under "Medicine packs". Reports to share never offers them.

**Until it is agreed:** the UI treats a document as a pack when `kind` is `other` and the reading returned exactly one medicine line. It says so in a code comment and the progress file.

## v2-4. Setting the date or patient by hand and its field evidence (raised 2026-11-23, step 0) (clarification)

**Question.** If `document_date` evidence is `needs_verification` and the user types the date in the details step (`documents.update({ clinicalDate })`, which sets `dateSource: 'user'`), does that evidence become `user_corrected`? If not, the record stays in "Needs attention" (`unverified_fields`) after the user has fixed it. The same question applies to `patient_name` after `assignProfile`.

**Proposed rule** (§9.2): `documents.update` with `clinicalDate` marks any `document_date` evidence of that document `user_corrected` with the new value (or `unknown` when set to null). `assignProfile` marks `patient_name` evidence `user_confirmed`. Otherwise the UI must also call `reviewFields` in the same step, and the contract should say that instead.

## v2-5. `RecordHit.matchedOn` vocabulary (raised 2026-11-23, step 0) (minor)

The UI shows "Matched: test name" from `matchedOn`. The values are only shown as an example in a comment (`['test name', 'doctor']`). Proposed fixed list, for mock and core alike: `'title' | 'tag' | 'test name' | 'facility' | 'doctor' | 'specialty' | 'kind' | 'date'`. It could stay `string[]`, with the list written in the comment. Not blocking.

## Notes, not requests

- **Missing sample PDFs.** `public/sample-docs/rx-rao-2026-11-13.pdf` (the demo prescription with "7? mg") and `thyroid-profile-lakshmi-2026-10-02.pdf` are not there yet. They are laptop A's per overview §10. Until they exist, the mock serves a generated placeholder PDF for them.
- **`src/services/index.ts` builds the v1 services on import.** I checked this is safe: v1's `createRealServices()` only constructs its Dexie object, and Dexie opens lazily, so the v2 app does not open the v1 database. Laptop A should keep the v1 constructor free of database calls until the checkpoint.
