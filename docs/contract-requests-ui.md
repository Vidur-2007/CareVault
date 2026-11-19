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
