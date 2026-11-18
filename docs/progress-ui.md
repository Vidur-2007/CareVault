# UI progress

## Phase 1: design system, shell, mock services (2026-11-14)

Built:
- Theme in `src/ui/styles/index.css` (Tailwind 4 `@theme`): every colour, type size, radius and shadow token from UI spec section 3. The default Tailwind palette is switched off, so only spec colours exist. Inter and Manrope are self-hosted through `@fontsource` and imported in `src/main.tsx`.
- Motion presets in `src/ui/app/motion.ts`. `useMotionPresets()` is the only place that reads reduced motion; `useCountUp()` is there too. `MotionConfig reducedMotion="user"` wraps the app.
- All components from section 3 in `src/ui/components` (barrel: `index.ts`). The gallery at `/dev/components` shows each one in its states. It is not linked from navigation.
- The app shell has a top bar on desktop and a compact bar with bottom tabs on phones, plus the profile switcher, the cloud notice slot and a skip link. Every route from overview section 11 points at a placeholder screen. `/welcome` and `/share/:id` render without the shell.
- Contexts: services, profile (current id kept in `localStorage['cv.profileId']`), toast and cloud notice. Hooks: `useServiceQuery`, `useServiceAction`, `useServices`, `useProfile`, `useToast`, `useCloudNotice`.
- Mock services in `src/ui/mock`. They implement the whole contract in memory from the fixtures and apply simple versions of the overview section 9 rules.

Mock switches, for checking states by hand in the browser console:
- `localStorage.cvMockFail = 'reading'` makes `reading.read` reject. It also takes a comma list of method groups (`'review,documents'`) or `'all'`.
- `localStorage.cvMockFail = 'cloud_consent'` makes `reading.read` reject with `cloud_consent_required` unless `allowCloud` is true.
- To clear either: `localStorage.removeItem('cvMockFail')`.
- In tests: `createMockServices({ delayMs: 0, seeded: false, fail: () => null })`.

Tests: the mock reproduces the fixture expectations (status counts, 3 open items, 3450 mg, diff rows, change summary). There are also component tests for Pill, Button and ReviewCard, and a shell smoke test covering every route.

Notes for later phases and for the core side:
- **Clock.** The mock's "today" is fixed at `SAMPLE_TODAY`, so the sample visit on 18 Nov stays upcoming. After 18 Nov the real services will have no upcoming visit for the sample profile unless the core side does something similar. This needs a decision before the demo (the deadline is 26 Dec).
- **Undo.** Undo for review answers has no contract method. Plan for phase 2: delay the `review.resolve` call until the 5-second Undo toast expires. No contract change needed.
- **Mock wording.** The mock's own copy (new review items, questions, diff notes) avoids pronouns. Screens add he/she/they from the profile relation (`src/ui/lib/pronouns.ts`).
- **PWA icons.** The manifest names `public/pwa-192x192.png` and `public/pwa-512x512.png`; these are still to be added (PWA phase).
- **Bundle size.** The main JS chunk is about 564 kB, and the build warns. Split screens with `React.lazy` once they are real. pdf.js is already loaded only on demand.

## Phase 2: Welcome and Review (2026-11-14)

Built:
- **Welcome (`/welcome`, 7.1)** has two actions, "Try the sample profile" and "Create a profile".
  - The form asks for name, relation, optional birth year, your name and your relation.
  - Validation lives in `screens/welcome/validateProfile.ts`. Errors show on submit, are linked to their fields, and focus moves to the first invalid field; after that they update as you type.
  - On success the profile is selected and Review opens.
- **Review (`/`, 7.2)** has:
  - The header: date line, greeting, the answer sentence and "Prepare for the visit".
  - All four review kinds with their actions.
  - A ConfirmDialog before "Stopped".
  - Toasts with Undo.
  - The Next visit panel.
  - "Since the last visit" tiles that count up.
  - The three most recent confirmed records, with "2 medicine changes found" on the latest prescription.
  - Loading, empty and error states.
  - The phone layout follows `CareVault-Mobile.png`: "3 things to review", the visit line and a compact next-visit link.
- **Undo** (`screens/review/useDeferredResolutions.ts`): an answer hides the card and is sent to `review.resolve` only when the 5-second toast closes without Undo. Leaving the screen, or the page being hidden, sends held answers immediately.
- **Shared changes:**
  - `.page-gutter` now gives 1240 px of content with the gutter outside it, to match the mockup's 100 px inset at 1440.
  - Card titles (h3/h4) are Inter 600, as in the spec; page and section titles stay Manrope 700.
  - The meta line of `DocumentCard` can carry "2 medicine changes found" in place of the state.
  - The phone `main` padding includes the safe-area inset.

Compared against the mockups. Screenshots were taken at 1440 px and at 390×844 with headless Edge (DevTools device emulation, reduced motion) against the mock. Desktop matches `CareVault-Main.png` in structure, wording, colours and proportions. Phone matches `CareVault-Mobile.png`, and the last section scrolls clear of the tab bar.

Remaining differences:
1. **Greeting.** It follows the time of day ("Good evening" in the evening). The mockup shows "Good morning".
2. **Phone card text.**
   - The phone mockup uses shorter card text, e.g. "At home, but missing from the 28 Oct prescription." The app shows the review item's single `body`, the same text as on desktop. The phone mockup also shows the duplicate card with no body; the app keeps it.
   - The phone mockup has a shorter duplicate title ("Two products contain paracetamol"); the app uses the fixture title "Two products at home contain paracetamol".
   - Matching any of these would need a short-body field in the contract or invented copy, so I left them.
3. **"View both prescriptions" on phone.** The link stays on phone, centred under the buttons. The phone mockup ends the card after "Ask the doctor". I kept the link so the action is reachable on phones.
4. **Next visit and stat-tile numbers.** These use Manrope 700. The mockup's weight looks slightly lighter; this is within the spec's heading rule.
5. **Phone below the fold.** The mockup shows only the top of the page. Below the cards, the app follows UI spec §9: "Since the last visit", then the recent records, stacked.

Tests: Review covers the three cards and the sentence; Still taking, Stopped (with the dialog, and cancel), Add to records and Undo; empty and error states. Welcome covers validation and focus, creating a profile, and the `validateProfile` unit cases. The copy variants are unit-tested. 48 tests in total.

## Phase 3: Medicines, scan flow, medicine detail (2026-11-18)

Built:
- **Medicines (`/medicines`, 7.3)** has:
  - The title, the explanation and "Scan a medicine".
  - Four stat tiles.
  - A duplicate card per `IngredientTotal`.
  - The Needs confirmation, Found at home, Confirmed current and Previous or stopped sections.
  - Loading, empty and error states.
- **The duplicate card** (`screens/medicines/DuplicateCard.tsx`):
  - It shows the products side by side.
  - It shows the "If both are taken as entered" total only when `complete` is true. Otherwise it shows "Add how often each is taken to see a total" and the known parts, with no number.
  - The exact safety sentence is always shown.
  - "Add to questions for the doctor" does nothing if the question is already on the visit, and says so.
  - "He only takes one of these" opens a choice of which product is taken; the others are marked stopped.
  - Arriving at `/medicines#possible-duplicates` scrolls to it.
- **Last change** in the Confirmed current table comes from each medicine's history. A change on or after the last visit's prescription date gets a pill ("5 mg to 10 mg, 28 Oct", "Added 28 Oct"); anything older reads "No change since …".
- **Scan (`/medicines/scan`, 7.4)** has four steps: Photo, Reading, Check, Done.
  - **Reading** always runs on the device first (`allowCloud: false`) and shows "On this device".
  - **`cloud_consent_required`** opens the consent panel, with "Send this photo" and "Enter by hand". Nothing is sent until "Send this photo" is pressed. While the photo is sent, the shell's CloudNotice reads "Sending this photo to the cloud reader".
  - **Read errors** offer Retry, Enter by hand, or Take another photo.
  - **Saving** keeps the photo as a record ("Photo of Dolo 650", type Other, source scan), so the original is always kept. It then adds the medicine as found at home, and confirms it when "Save and confirm he takes it" is chosen.
  - **Done** reports a duplicate the new medicine created, with a link to the card.
- **The reusable confirm form** (`components/lineForm/`):
  - `LineConfirmForm` puts the source viewer beside the editable fields. "Check this" is shown on every extracted field until that field is edited, "Everything matches the original" is pressed, or the line is saved.
  - Warnings appear under the field they are about (`warningsByField`); anything unmatched goes in a box at the top.
  - Numbers are never guessed: "650mg" is an error, not 650.
  - Phase 4 can use `LineConfirmForm` per prescription line, or `useLineDraft` with `LineFields` beside a single `SourceViewer`.
- **Medicine detail (`/medicines/:id`, 7.5)** has:
  - The name, pills, ingredients, instruction, per-day count, prescriber and source link, plus the replacement link for replaced medicines.
  - The history timeline, newest first, with document links.
  - Actions by status:
    - found at home: confirm, check details, mark stopped;
    - needs confirmation: still taking, stopped, ask the doctor;
    - confirmed: edit details (opens the confirm form in a Sheet), mark stopped;
    - stopped: taken again.
  - "Stopped" always asks first.
- **Atorvastatin answers** on Medicines and detail use the same Undo mechanism as Review when a review item is open. `useDeferredResolutions` moved to `src/ui/hooks`.

Responsive check: screenshots at 390, 768 and 1280 px (headless Edge, DevTools emulation) of Medicines, the scan confirm step and the detail page. Fixes made from them:
- **Top bar:** below 1024 px it uses tighter spacing and the compact profile switcher. It overflowed at 768.
- **Medicine rows and the Confirmed current table** switch to their wide layout at 900 px, with two-column stacked cards on tablets. The table was cramped at 768.
- **Confirm form:** strength and unit stack on phones, so the "Check this" markers no longer misalign the inputs.
- **Ingredient line:** a medicine row no longer repeats its own name as the ingredient line.

Differences from `CareVault-Medicines.png`:
1. **Product line in the duplicate card.** The mockup says "Label: up to 3 tablets a day · found at home". The app says "Entered: 3 tablets a day · found at home". `dosesPerDay` is what the caregiver entered, not the pack label, and the contract has no label-maximum field.
2. **Atorvastatin's pill.** The mockup shows "Found at home". The app shows "Needs confirmation", per the pill table in UI spec §3 and its status.
3. **Found at home section.** The app has it, as UI spec 7.3 requires. The mockup has no such section, but the sample has Dolo 650 and Crocin Advance 500 at home.
4. **Instruction wording.** The Atorvastatin row reads "1 tablet, night · not on Dr. Rao's prescription of 28 Oct". The mockup's "One tablet at night" is reworded; the app shows the instruction as entered.

Tests (73 in total):
- The duplicate card with a complete and an incomplete total, the exact safety sentence, and the actions.
- Extracted markers: cleared by editing one field, by "Everything matches the original", and on save; warnings under fields; errors and focus.
- The scan flow:
  - on-device read;
  - the consent panel on `cloud_consent_required` with no cloud call before the click;
  - the cloud notice while sending;
  - "Enter by hand" never sends;
  - saving keeps the photo and reports the duplicate;
  - the read error state.
- Medicines: sections, counts and Last change; Still taking resolving the review item; "only one of these".
- Detail: details, source and history; mark stopped; not found.

Test notes:
- UI tests import `src/ui/test/configureTesting.ts`, which raises Testing Library's `findBy` timeout to 4 s; the 1 s default flaked on a busy machine. The frozen `src/test/setup.ts` is unchanged.
- Review tests pin `Date` to 14 Nov 2026, 09:00. Since the real date passed 14 Nov, "on Wednesday" became "today".

## Phase 4: Records vault, timeline, document detail (2026-11-18)

Built:
- **Records (`/records`, 7.6):**
  - **Search** by title and type through `documents.search`, 250 ms after typing stops.
  - **Category chips** with counts (All, Prescriptions, Lab reports, Tests, Discharge summaries, Other).
  - **A "Starred only" toggle.**
  - **A Grid / Timeline switch**, remembered on this device.
  - **Grid:** `DocumentCard`s with first-page thumbnails (`components/DocumentThumbnail.tsx`), star buttons and "Not yet confirmed".
  - **Timeline:** grouped by month, newest first, with a type icon. The latest prescription from each doctor shows "2 medicine changes found" (added plus changed, the same count as on Review).
  - **Empty states:** with no records, an invitation to upload that mentions Gmail import in Settings; with no matches, a "Show all records" reset.
  - **Loading and error states.**
- **Thumbnails and preview with pdf.js (pdfjs-dist 6.5):**
  - `GlobalWorkerOptions.workerSrc` is set from the Vite `?url` import of `pdfjs-dist/build/pdf.worker.min.mjs`. That emits the same-version worker as an asset, which is what the current pdf.js bundler example does.
  - The optional `rendererSrc` (new renderer worker) is not set, so pages render on the main thread.
  - pdf.js and its worker load only when the first PDF is shown. Thumbnails load only when a card nears the viewport.
  - Where pdf.js cannot run (no `DOMMatrix`, as in jsdom), an icon and a download link appear instead.
  - In pdfjs-dist 6, documents are released with `pdf.loadingTask.destroy()`.
- **Upload sheet (`screens/records/AddRecordSheet.tsx`).** Steps:
  - **selecting:** pick a PDF or photo.
  - **reading:** on the device, with "On this device"; the cloud-consent branch reuses the new `components/CloudConsentPanel` (shared with Scan).
  - **review details:** "Looks like a prescription from Dr. X dated Y", with editable type, title, date and doctor, plus "Check this" on read values.
  - **saving.**
  - **duplicate found:** "This looks like a file you already added on <date>", with Discard (removes the new copy) or Keep both.
  - **saved:** with "Open it" and "Add another".
  - **failed:** with Retry.
- **Prescription uploads** continue to `PrescriptionLinesStep`:
  - One card per extracted line, built from the phase 3 `useLineDraft` and `LineFields`, beside the original in a wide sheet.
  - Add a line and Remove a line.
  - "This line matches" clears the line's markers.
  - On save, every line is validated, the first error is focused, and then `prescriptions.apply` is called. The app then goes to `/visit`, which shows the comparison (the Visit placeholder now renders the latest diff with `DiffRow`; the rest of appointment mode is phase 5).
- **Document detail (`/records/:id`, 7.7):**
  - **Preview** (`screens/records/DocumentPreview.tsx`): previous and next page with "Page n of N", zoom from 50 to 300% with a fit button, and a download link to the original. Only the zoomed content scrolls sideways.
  - **Metadata** and a **Star** toggle.
  - **Confirm** for pending records, and **Delete** after confirmation. For an emailed record with an open "new document" review item, Confirm and Delete answer that item ("added" or "dismissed") so the Review inbox stays in step.
  - **For a prescription:** its medicine lines, when it is one of the two most recent from that doctor, and "See the comparison".
- **Robustness:** the motion "reveal" preset now leaves out `whileInView` when `IntersectionObserver` is missing (old browsers, jsdom); Motion threw without it.

Checked with screenshots at 1280 and 390 px: grid and timeline, the details step, the wide lines step, and document detail. pdf.js renders thumbnails and pages in Edge.

Contract limits (requests in `docs/contract-requests-ui.md`):
1. **No way to add a doctor.** A prescription from a doctor not yet in the profile cannot be applied.
2. **PDF previews do not work offline.** The pdf.js worker is not precached; `vite.config.ts` is frozen.
3. **Lines for older prescriptions are not shown.** The contract only exposes lines through `latestDiff`, so detail shows lines only for the latest and previous prescription per doctor. No change requested.

Tests (85 in total):
- **Search** filters the list and calls `documents.search`.
- **Chips and starred** filter the list.
- **Timeline** grouping and the changes count.
- **Duplicate warning:** it appears when `documents.add` returns `duplicateOf`, and Discard removes the copy.
- **Confirming lines** calls `prescriptions.apply` with the edited values (changed strength, removed line, added line), then lands on `/visit` showing the comparison.
- **An invalid line** blocks apply and focuses the field.
- **Detail:** metadata, star, confirm through the review item, page and zoom controls, prescription lines, delete after confirmation.
- **Pure helpers:** counts, month grouping, doctor matching, details validation.

## Phase 5: Visit, passport, sharing (2026-11-18)

Built:
- **Visit (`/visit`, 7.8)** matches `CareVault-Changes.png`:
  - **The header:** the "Appointment mode · Wednesday, 18 Nov, 10:30 am" pill, the title, and the "Comparing Dr. X’s two prescriptions…" sentence.
  - **The date tiles:** Previous and Latest, each with "Open the scan".
  - **One `DiffRow` per row,** ordered added, changed, review, unchanged (`visit/visitText.ts` orders them; the UI never relies on the service's order). Old strength or instructions are struck through and the new ones highlighted. Review rows carry the three answers, with the mockup's sentence using the profile's pronouns.
  - **The side column:** Questions for the doctor (list, remove, add with a labelled input), Reports to share (confirmed reports, starred first; pending ones listed but disabled), and the dark status panel ("1 item still needs your answer" / "Everything is answered") with "Open the Doctor Visit Passport".
  - **Phone:** under 900 px the status panel becomes a bar fixed above the tab bar.
- **Visit edge cases:**
  - **Answers** to review rows use the same Undo mechanism as Review. The status count drops as soon as a row is answered.
  - **No next visit:** a form to add one (doctor, date, time), saved through `visits.save` with the device's UTC offset.
  - **No previous prescription:** the Previous tile says so, a note explains why every medicine is "added", and the next prescription will be compared with this one.
  - **No prescription at all:** a link to Records.
- **Passport (`/visit/passport`, 7.9)** matches `CareVault-Passport.png`. `components/PassportView.tsx` is presentational and shared with the public view. It has:
  - the logo, title and visit line;
  - the QR box with the newest active link and its short expiry;
  - the patient strip, the current medicines table and the changes with pills;
  - Flag for review, Reports shared and Questions from the family;
  - the exact disclaimer.

  The toolbar has "Print or save as PDF" (`window.print()`) and "Share with QR".
- **Print:** `@page { size: A4; margin: 12mm 14mm }`, plus print-only sizes on the passport. The shell header, tab bar, toasts and toolbar are hidden (`data-print-hide`, `print:hidden`), and the sections avoid page breaks. Checked by printing through Edge (`Page.printToPDF`, A4, CSS page size): with and without the QR box it is 1 page, and the render was inspected.
- **Share dialog** (`passport/ShareDialog.tsx`):
  - The exact explanation sentence from the spec.
  - Expiry choice (2, 8 or 24 hours) and "Create link".
  - The CloudNotice "Uploading the encrypted passport", in the dialog and in the shell, while `sharing.create` runs.
  - A QR code drawn as SVG with `qrcode`'s `toString(url, { type: 'svg' })`, which needs no canvas and prints sharply.
  - The expiry in local time, the link in a read-only field, and Copy link (falls back to selecting the text when the clipboard is unavailable).
  - Revoke, and a list of other active links, each with Revoke.
- **Shared view (`/share/:id`, 7.10):**
  - No shell, no navigation, and no requests beyond `sharing.open`.
  - The key comes from `location.hash` and is never put anywhere else.
  - States: loading ("Opening and decrypting the passport…"), the read-only passport with a Print button, expired, revoked, not found, missing key (`sharing.open` is not called), and any other error with Try again.

Differences from the mockups:
1. **The changed row's footnote.** The mockup's line about a 5 mg strip "still in the home inventory" needs data the contract does not have. The app says "The 5 mg strength is listed as replaced by 10 mg from 28 October."
2. **Questions card.** It has an "Add" button beside the input, which the mockup lacks; Enter also adds.
3. **Passport wording.** The flag and change texts come from the services (the mock writes "Possible duplicate ingredient (paracetamol): Dolo 650 and Crocin Advance 500."). The mockup's longer flag sentence would come from the core `buildPassport`.
4. **The QR box.** It appears only once a share link exists. Before that, there is no QR to show.

Tests (103 in total):
- **`DiffRow`:** each kind renders its pill and both cells (struck and highlighted values, missing cells, review answers), plus the changed-instructions variant.
- **Visit:**
  - the mockup structure and row order;
  - **answering a review row changes the status count from 1 to "Everything is answered"**, then resolves the item when the Undo window ends;
  - questions add and remove, and the shared reports toggle;
  - the no-visit form;
  - the first-prescription note;
  - the error state.
- **Passport:** sections and disclaimer; share with 24 h, QR SVG, link, copy fallback, revoke; the cloud notice while uploading.
- **Shared view:** **expired when `sharing.open` rejects with `expired`**; revoked; not found; missing key (no call); opening a link created on the device.

## Phase 6: Settings, PWA, states, accessibility (2026-11-18)

Built:
- **Settings (`/settings`, 7.11):**
  - **Profiles:** list, switch, and add (the welcome form in a Sheet; the profile switcher's "Add a profile" opens it directly).
  - **Cloud reading:** a toggle with the plain explanation, a `role="switch"`.
  - **Gmail import:** Connect, the candidate list with Import, the "Access lasts for this session only…" note, and the CloudNotice "Reading your inbox for report attachments" while searching and importing. Imported reports wait in Review as new documents.
  - **Backup export:** passphrase plus confirmation, at least 8 characters, downloads `carevault-backup-<date>.cvbackup`.
  - **Backup import:** file plus passphrase, then a ConfirmDialog "Replace all data on this device?". A wrong passphrase shows a field error.
  - **Sample data:** load the sample profile again.
  - **About:** where data lives; not medical advice.
- **What the cloud-reading setting does.** Reading always tries on the device first.
  - **Off (default):** a hard-to-read photo or document still gets the per-photo consent panel.
  - **On:** it is sent without the question, and the CloudNotice still shows before each send. This is the "consent toggle plus per-use notice" from overview §2. It applies to both Scan and Add a record.
- **PWA:**
  - Icons `public/pwa-192x192.png` and `pwa-512x512.png` (also the maskable icon) and `apple-touch-icon.png`, rendered from the CV mark in Manrope 700 on teal, with the letters inside the maskable safe zone.
  - `favicon.svg` is now the CV mark instead of the Vite default.
  - `index.html`: description, Apple touch icon, and `viewport-fit=cover` so the safe-area insets work.
  - Build check: the manifest lists all three icons; the service worker precaches the shell, the icons and every screen chunk; the navigation fallback denylists `/^\/api\//`; there is no runtime caching of `/api`.
- **Code splitting:** every screen except Review loads on demand (`React.lazy` behind a labelled fallback). The main chunk went from 727 kB to 249 kB; the build's large-chunk warning is gone.
- **The four states, tested on every screen** (`src/ui/screensStates.test.tsx`, 26 tests):
  - **loading:** all non-profile calls never resolve; each screen shows its labelled loading status and no error;
  - **error:** the mock failure switch for every group except profiles; each screen shows its error panel;
  - **ready;**
  - **empty:** a new profile with no data shows Review, Medicines, Records and Visit empty states and an empty passport.
- **Accessibility pass:**
  - **Per screen** (tested on every screen, ready and empty, plus Welcome and the shared view): exactly one h1; every input, select and textarea labelled; every button and link named; every image with alt text; a polite live region for toasts.
  - **Keyboard, in Edge at 1280 px:** Tab 20 times on every route; every focused element had a visible focus ring.
  - **200% zoom and responsive, in Edge:** every route at 390, 640 (a 1280 px window at 200%), 768 and 1280 px. No horizontal page scroll, no element past the viewport. 44 of 44 route/width pairs were clean, before and after code splitting.
  - **Contrast** (`src/ui/contrast.test.ts`): every text/background token pair the UI uses is at least 4.5:1. Two places put secondary grey text on the grey tint (4.4:1), the record-chip counts and the inactive scan steps; both now use ink-2.
  - **Reduced motion:** every preset becomes a fade or nothing (`motion.ts`), CSS animations and transitions are cut under `prefers-reduced-motion`, and `MotionConfig reducedMotion="user"` wraps the app.
- **A focus bug found by the backup tests, now fixed** (`useFocusTrap`). Closing a dialog returned focus to its trigger after the exit animation, even if an error handler had already focused a field. The caregiver's typing then jumped to the button mid-word. Focus is now returned only if nothing else has taken it.
- **Architecture test** (`src/ui/architecture.test.ts`): fails if any file under `src/ui` imports `src/core`, by static import, re-export, side-effect import, dynamic `import()` or `require()`. A second test checks the scanner catches each of those forms. The ESLint rule from phase 0 still applies too.

Could not fix in the UI (needs another owner or a frozen file):
1. **Offline PDF previews.** The pdf.js worker (`.mjs`) is not precached, because `vite.config.ts` is frozen. Request 2 in `docs/contract-requests-ui.md`.
2. **New doctors.** A prescription from a doctor not yet in the profile cannot be applied: there is no `addPrescriber` in the contract. Request 1.
3. **The sample visit date.** The sample visit is 18 Nov 2026. With the real services it stops being "next" after that date, before the demo on 24–26 Dec. The mock keeps "today" at 14 Nov; the core seed (or the fixture, through the human) needs a decision.
4. **Deleting a profile.** Settings cannot delete a profile; the contract has no method for it. Not requested; out of scope for the demo.
5. **Real Gmail consent.** The Google consent screen and the token model are on the core side. The UI only calls `gmail.connect()` and shows the session note. Not checked against a real Google account yet (phase 7).
6. **Checks not automated:** a real screen reader and real browser zoom (the 200% check used an equivalent 640 px viewport). To do by hand on a phone during phase 7.

Tests: 158 in total.

## Phase 7: polish on the real services (2026-11-18)

**There is no `integration` branch yet.** Neither PR has been merged into `main`, and overview §7 has the core side create `integration` after both merges. So this phase:
- tested on a local, unpushed merge of `feat/ui` and `origin/feat/core`;
- committed the UI fixes on `feat/ui`, which updates PR #1.

When `integration` exists, these commits arrive with `feat/ui`.

**Walk-through.** The demo path of overview §13 was run on the real services: `VITE_USE_MOCK=false`, `npm run dev`, and the Hono server from `server/index.ts`. Steps:
1. A fresh browser loads the sample profile.
2. Review and Medicines.
3. A pack photo is scanned (real on-device OCR), confirmed and saved.
4. A prescription PDF is uploaded, its lines confirmed and applied, ending on the comparison.
5. Visit, then the passport, then share.
6. A share link that does not exist.
7. Settings with Gmail.

It was run at 390 px and 1280 px in headless Edge, with every step screenshotted and console errors recorded (none). Long product names and instructions were entered by hand and checked at both widths: they wrap without overflow.

This machine has no Gemini, Supabase or Google keys. Cloud reading, sharing and Gmail were therefore checked on their real "not set up / unreachable" paths only.

Fixed on `feat/ui`:
- **Typecheck of the merged code.**
  - `@types/qrcode` begins with `/// <reference types="node" />`, so importing `qrcode` put Node's types into the whole app program. Two core tests that expect Node types to be absent then failed. The UI now imports `qrcode/lib/browser.js` with a small local declaration (`src/ui/types/qrcode-browser.d.ts`). It is the same library, and its browser build renders SVG without a canvas.
  - The architecture test now reads files with `import.meta.glob(..., { query: '?raw' })` instead of `node:fs`, for the same reason.
- **Error text.** Real messages such as "(503)" or "VITE_GOOGLE_CLIENT_ID is missing" no longer reach the screen. `toServiceError` turns `network` errors into "CareVault could not reach the server. Check the internet connection and try again.", removes status codes, and turns setting names into "This feature is not set up on this copy of CareVault yet." Every query, action and catch in the UI goes through it. The share dialog no longer repeats itself.
- **Reading timings.** Reading a text PDF takes about half a second; a clear photo about 4 s once the OCR engine is loaded. The core notes the first photo downloads the engine and model, which can take much longer on a phone. The new `components/ReadingProgress.tsx` (Scan and Add a record):
  - after 6 s, says the first photo downloads the reader once and the photo stays on the device;
  - after 25 s, says it is taking longer than usual;
  - always offers "Enter by hand instead". A late result after that is ignored.
- **Reports to share.** Pack photos kept from Scan (type other, source scan) are no longer offered as reports to share at the visit.
- **Phone layout.**
  - Toasts sit at the top, so they no longer cover the tab bar or the Visit status bar.
  - In the confirm steps, the original document has its own scroll box (55% of the screen height). A real prescription page no longer pushes the fields a whole screen down.

README and screenshots:
- `README.md`: what CareVault does and for whom; screenshots of the main screens; the privacy design (what stays on the phone, the three cases where data leaves); the tech stack; how to run it locally; the sample profile; the "not medical advice, synthetic data only" note. The core side adds "Running the server" by request (overview §6).
- `docs/screenshots/` was captured on the **real services** from a fresh browser: `review-desktop`, `medicines-desktop`, `visit-desktop`, `passport-desktop`, `records-desktop` at 1440 px (the passport at 1000 px), and `review-mobile`, `visit-mobile` at 390 px (2x). The browser clock was set to the sample day (14 Nov 2026, 9:00) so the greeting matches the mockups, with reduced motion so nothing is captured mid-animation.

Not fixed in the UI (requests in `docs/contract-requests-ui.md`):
1. **#3, urgent: the merged build fails.** vite-plugin-pwa refuses to precache PaddleOCR's 11.3 MB and 10.5 MB files. The fix is one line in the frozen `vite.config.ts`. Until then `npm run check` fails on any merge of the two branches, though not on either branch alone.
2. **#4: product name from the pack subtitle.** OCR took "Paracetamol Tablets IP 650 mg" as the product name instead of "DOLO 650". The core parses it; the UI shows it as "Check this".
3. **#1: adding a doctor.** Still open, now requested by both sides.
4. **Not checked here:** real Gmail sign-in, real Supabase sharing across two devices, real Gemini reading, and a mid-range phone. These need the keys and a phone (checklist in `progress-core.md`).

Tests: 163 on `feat/ui`. On the trial merge, 485 pass; only the build step fails (#3).
