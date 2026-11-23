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

---

## v2

### Step 0: review of contract v2 (2026-11-23)

**Branch.** `feature/ui` was created from `main` at `026a605` ("chore: contract v2 and fixtures") and pushed with upstream tracking. `npm run check` passes on it: 35 test files, 508 tests, build OK.

**Contract against overview §8.** Compared mechanically: each code block of §8.1–8.3 was extracted and diffed with the file.
- `src/contract/types.ts`, `services.ts` and `today.ts` are identical to §8.1, §8.2 and §8.3. The only addition is a 4-line "FROZEN after Phase 0" header comment in each.

**Fixtures against overview §10.** `src/contract/fixtures/sampleCase.ts` agrees with §10:
- **Ramesh:** profile with emergency contact; Dr. Rao and Dr. Menon; the six documents with their kinds, clinical dates and sources. The HbA1c report is `pending_review`, undated, with `receivedAt` 2026-11-12T20:05+05:30 and patient `match`.
- **Routine:** all nine entries with the statuses, sources, prescribers, last-confirmed dates and doses per day of the table. Amlodipine 5 mg is replaced by Amlodipine 10 mg; Atorvastatin is `uncertain`.
- **Health entries:** Sulfa allergy; high blood pressure; type 2 diabetes.
- **Next visit:** 18 Nov 10:30 with Dr. Rao, with both questions and the two shared reports.
- **Lakshmi:** Dr. Khan; the thyroid profile of 2026-10-02; Levothyroxine 50 mcg `taking`; the explicit "No known allergies"; no visit.
- **`expected`:**
  - the passport order (Rao group alphabetical, then Menon, then no prescriber: "Crocin Advance 500" before "Dolo 650");
  - 3450 mg = 1950 + 1500;
  - attention kinds;
  - newest-first document order with HbA1c last;
  - the three searches and three Ask questions;
  - the demo prescription's five rows, `passiveNotMentionedCount: 3`, the three decisions and the state after them.
- **Not stated in §10, and fine:** Lakshmi's emergency contact (the fixture uses Anjali's number), and Aspirin's instruction "1 tablet, afternoon" (from 0-1-0).

**Side-by-side setup (§6).**
- `src/services/index.ts` exports `services` (v1) and the factory `createServicesV2()`, with the export names `createMockServicesV2` and `createRealServicesV2` as the spec requires.
- Importing it builds the v1 services, but v1's `createRealServices()` only constructs its Dexie object and Dexie opens lazily. So the v2 app does not open the v1 database. Checked; noted for laptop A.

**The compatibility mock** (`src/ui/mock/v2/createMockServicesV2.ts`) is what UI step 1 replaces. Its `TEMPORARY` gaps:
- reading returns an empty candidate, with no field evidence and no "7? mg";
- the hash is fake (`mock-<size>-<type>`), so duplicates are not real;
- `prescriptions.save` returns no proposal;
- `routine.undo`, `decide` and `dismiss` are not built;
- `routine.revision` is always 0;
- `setStatus` records no event;
- `documents.remove` returns no snapshots or shares;
- `records.ask` is not built;
- `attention.list` covers only duplicates;
- `recentChanges` is empty, and the passport's current-medicine order is not the spec's;
- Gmail and backup are not built;
- there is no delay and no `cvMockFail` switch.

**Raised in `docs/contract-requests-ui.md` (v2 section).** Nothing in `src/contract`, `src/core` or `src/services` was changed.
1. **v2-1 (needs an answer before steps 4 and 6):** the format of `FieldEvidence.value` per field, and whether `prescriptions.save` / `routine.add` take critical values from the verified evidence or from the `lines` passed in. This is where the "no unverified value reaches the routine" gate is enforced, so it should be defined once.
2. **v2-2 (blocks one action in step 4):** "Retake the photo, keeping all decisions" has no method. Proposed: `documents.replaceOriginal(id, file)`, keeping the earlier original. Until it is decided, the default is to leave the action out.
3. **v2-3:** no `DocumentKind` for medicine packs. Proposed: add `medicine_pack`. Until then, the UI treats "`other` with exactly one medicine line" as a pack.
4. **v2-4 (clarification):** whether setting the date by hand (`documents.update`) or assigning the profile marks the matching field evidence as corrected or confirmed. Otherwise "Needs attention" may never clear.
5. **v2-5 (minor):** a fixed vocabulary for `RecordHit.matchedOn`.
- **v1 request #2** (precaching the pdf.js worker) is still open. **#1** (add a prescriber) and **#5** (error wording) are resolved by v2.
- **Note:** the demo prescription PDF (`rx-rao-2026-11-13.pdf`) and Lakshmi's thyroid PDF are not in `public/sample-docs/` yet (laptop A).

**Working rule noted.** Overview §2 says commits, pull requests and files carry no assistant attribution. From this step on, commit messages are only `ui: <what>`.

### Step 1: mock services v2 (2026-11-23)

**What was built.** The Phase 0 compatibility mock is replaced by an in-memory mock of every method of contract v2. The export is still `createMockServicesV2` (with `MockV2Options`), so `src/services/index.ts` is unchanged. The v1 app and the v1 mock are untouched. The code lives in `src/ui/mock/v2/`:
- `createMockServicesV2.ts`: the services, the 300–800 ms delay, the failure switch, cloned results and a debounced `subscribe`;
- `state.ts`: the tables, seeded from the v2 sample case;
- `routine.ts`: revisions, events, the verification gate, proposals, `decide`, undo and totals;
- `passport.ts`: the live passport and attention items;
- `search.ts`: `records.search` and the deterministic `records.ask`;
- `reading.ts`: the reading scenarios and the synthetic Gmail inbox;
- `migrate.ts`: v1 mock backups mapped per overview §9.9;
- `text.ts`: small helpers (matching, units, dates, names, SHA-256).

**Overview §9, in simple form:**
- **Documents:**
  - the original is stored first, as `pending_review`, with a real SHA-256;
  - exact duplicates are found within the same profile only;
  - `remove` deletes the file, lines, evidence and proposal, sets `removedAt` in the snapshots that list the document, and returns those snapshots' active shares;
  - `assignProfile` moves the record and its evidence.
- **Field verification:**
  - `reviewFields` confirms, corrects or leaves a value unknown;
  - re-reading keeps every human decision;
  - a line is verified only when all its evidence is `user_confirmed` or `user_corrected`;
  - `started`, `not_started`, `started_new` and `routine.add` with a `documentId` are refused with `verification_required` while the line is unverified.
- **Proposals:**
  - all row kinds (`new`, `changed`, `same`, `not_mentioned` for the same prescriber only, passive entries, `uncertain_match`), in the spec order, with the choices of the table;
  - every effect of the table, with events that record `before` and `after`;
  - `ask_doctor` adds a question to the next visit;
  - `same_medicine` and `different_medicine` offer the row again;
  - stale protection through a per-profile revision;
  - idempotent decisions and saves;
  - dismiss and reopen with `proposalFor`;
  - undo, refused with `stale` after a later change to the same entry.
- **Totals and attention:** totals follow §9.5 (taking and uncertain entries; mass units converted; incomplete totals give 0). All four attention kinds are built.
- **Passport and snapshots:**
  - the spec order of current medicines;
  - unconfirmed entries (uncertain and legacy-pending);
  - recent changes over the last 90 days;
  - duplicate flags;
  - snapshots that are frozen and reused when identical;
  - shares bound to a snapshot, listed per profile, with `listUnowned` for v1 links.
- **Search and Ask:** search uses every `RecordQuery` field and fills `matchedOn`. Ask understands latest / last N / first, kinds, test names, a doctor by name or specialty, a facility, years, months and "last year", questions and medicines. Anything else is `understood: false` with a hint.
- **`todayFor`:** the sample profiles stay on 14 Nov 2026; new profiles use the device date.
- **Gmail and backup:**
  - **Gmail:** a synthetic inbox with one email carrying two reports and one email for another patient. `alreadyImported` is tracked per profile.
  - **Backup:** a JSON backup with a passphrase check (including file contents). v1 mock backups are mapped per §9.9.

**Reading scenarios** (chosen by file name, documented at the top of `reading.ts`):
- **The demo prescription** (`rx-rao-2026-11-13.pdf`): Aspirin's strength reads "7? mg" as `needs_verification` ("Unclear digit"). Correcting it to 75 makes the line "Aspirin 75 mg".
- **A photo:** a Dolo 650 pack; the OCR'd strength and unit need a look, and the frequency is not on the pack. With `blurry` in the name, the photo needs the cloud reader.
- **Reports** (`lipid`, `hba1c`, `thyroid`, `ecg`, `kidney`, `cbc`, `x-ray`): dated from the file name.
- **Modifiers in the name:** `locked` gives a password-protected PDF, `pages` reads 2 of 5 pages, and `mismatch` puts another patient's name on it.
- **The seeded documents:** their stored details and lines, with no evidence.

**Failure switch** (`localStorage.cvMockFail`, a comma list):
- a group name (`profiles`, `documents`, `reading`, `prescriptions`, `routine`, `health`, `attention`, `records`, `visits`, `passport`, `sharing`, `gmail`, `backup`, `settings`) or `all` makes those calls reject with `network`;
- `stale` makes `decide` and `undo` reject with `stale`;
- `locked` makes reading any PDF reject with `locked_pdf`;
- `cloud_consent` rejects reading unless `allowCloud` is true; with it, reading uses the cloud engine and every field needs verification;
- `verification` makes every value-writing routine change from a document reject with `verification_required`.

**Tests.**
- `createMockServicesV2.test.ts` (22 tests) checks every value in fixtures `expected`:
  - Ramesh's routine statuses, document order, totals, attention, passport, searches and Ask;
  - Lakshmi's passport, totals, attention and documents, and that nothing crosses between profiles;
  - the demo prescription end to end: the reading; the five rows with kinds, entries, `asked` and `blockedByVerification`; `passiveNotMentionedCount`; the gate; the verified lines after the correction; the three decisions; the state after them; idempotence; stale.
  - It also covers duplicates, snapshots and shares, undo, the pack gate, Gmail, backup and v1 migration.
- `failureSwitches.test.ts` (9 tests) has one test per switch, plus reading the switch from `localStorage` and the default delay.
- `npm run check` passes: 36 test files, 534 tests, build OK. Lint is clean.

**Where the mock differs from the spec, or had to choose:**
1. **The Aspirin row in `expected.demoPrescription.proposalRows`** has `lineProductName: 'Aspirin 75 mg'` together with `blockedByVerification: true`. These cannot hold at the same moment: before the check the strength is unknown. The test checks the row in two phases. Before the check, it compares kinds, entries, `asked` and `blocked`, and the line reads "Aspirin 7? mg". After correcting the strength to 75, it compares the product names. Laptop A's golden test meets the same question.
2. **A line with no field evidence counts as verified.** These are lines typed by the user or seeded; overview §9.2 only speaks of lines with evidence.
3. **v2-1 is built provisionally as proposed.** Evidence values use the proposed formats, such as strength `"75"` and frequency `"1"`. Reviewed evidence wins over the values passed to `prescriptions.save` and `routine.add`.
4. **v2-4 is built provisionally as proposed.** A date set with `documents.update` marks the date evidence `user_corrected` (or `unknown` when cleared). `assignProfile` marks `patient_name` `user_confirmed` and clears the mismatch.
5. **`still_taking` and `kept_previous` set the entry to `taking`,** as well as refreshing `lastConfirmedAt`. The table says "no change", but leaving an `uncertain` entry unconfirmed after the user said "still taking" contradicts the meaning of `taking`. This needs a word from the core side.
6. **`reading.read` writes only the facts it read to the record:** the patient name and match, and the pages. Kind, title and date stay with the details step, which writes them through `documents.update`.
7. **Undo of an event that created an entry removes that entry.** Undo is also refused with `stale` when the event was already undone.
8. **Changing a row's answer is refused,** except from `skip`. The way to change an applied answer is Undo in the history.
9. **Mock-only data:**
   - one seeded v1 share link (owner unknown), so Settings' "Older share links" can be built;
   - `gmail.findCandidates` rejects with `not_configured` until `connect()` is called;
   - backup passphrases need at least 8 characters.
10. **Ask texts** follow the example form ("Latest report with Lipid profile: 12 Nov 2026, Lakeside Diagnostics."). "First" answers say "earliest in CareVault".
11. **`matchedOn`** uses the vocabulary proposed in v2-5.

**Open questions:**
- the Aspirin row in `expected` (point 1);
- the effect of `still_taking` on `uncertain` entries (point 5);
- v2-1 to v2-5 are still unanswered;
- the demo and thyroid PDFs are still missing from `public/sample-docs/`, so the mock serves generated placeholders.

### Step 2: shell, navigation, profile menu, Welcome (2026-11-23)

**The app is now v2.** `src/main.tsx` renders the v2 app. `ServicesProvider` calls `createServicesV2()` once, the first time the app needs it, as overview section 6 asks. The contexts, `useServices`, `useServiceQuery`, `useServiceAction` and `toServiceError` use contract v2. `src/services/index.ts` is unchanged; it still builds the v1 services on import, which only constructs Dexie (checked in step 0). The v1 mock stays, because `src/services/index.ts` imports it and laptop A removes it at the merge checkpoint.

**Navigation (UI spec section 3).**
- Home, Records, Passport and Ask: bottom tabs on phones, a top bar on desktop.
- **The profile menu** (the profile button, on every size) holds:
  - switch profile;
  - "Add a profile" (`/welcome?new=profile`, which opens the form at once and offers "Back to Home");
  - Settings.
- **Routes:** every route of overview section 11 is defined. `/welcome` and `/share/:id` have no navigation. `/passport/print/:snapshotId` keeps the shell, whose bars are already hidden in print. The private `/dev/components` gallery stays.
  - Welcome is built. Every other route shows a placeholder naming the step that builds it (`PLANNED_ROUTES` in `src/ui/app/routes.tsx`). Each step replaces its placeholders.
- **`document.title`:** set on every route as "<page> · CareVault" by `useDocumentTitle`, during commit, so the title never lags behind the page. Welcome is "Welcome", or "Add a profile" from the profile menu. Unknown paths are "Page not found".
- **Dates:** `src/ui/lib/today.ts` no longer has its own rule (the v1 "mock means 14 Nov" check is gone). `todayForProfile(id)` is `todayFor(id, deviceToday())`. The profile context exposes `today` for the open profile. The profile menu computes each profile's age with that profile's own `todayFor`, so Ramesh is 71 on the sample calendar and a new profile uses the device's year.
- **Profile switch:**
  - Queries are keyed on the profile id, so they never return another profile's result.
  - The shell also keys the screen on the profile id, so a switch remounts it with no state left over.
  - On a page that belongs to one profile (`/records/…`, `/passport/…`), the switch moves to that section's list.

**Welcome (4.1).**
- "Try the sample profiles" loads both sample profiles and opens Ramesh.
- The create form has the optional emergency contact (up to 100 characters; empty becomes `null`).
- The choice "I manage my own records" hides the relation and the caregiver fields. It saves relation "Myself" with an empty caregiver name and relation, and the name field reads "Your name".
- Validation, linked errors and focus on the first invalid field work as in v1.

**Retired.**
- **The screens the spec retires:** the Review home screen (with `review/*`), Medicines (with `medicines/*`), Scan (with `scan/*`), Visit (with `visit/*`), the v1 medicine detail, and `DiffRow` and `ReviewCard`, with their tests.
- **v1 screens rebuilt in later steps:** the v1 Records, record detail, Passport, Settings and Share screens were written against contract v1 and cannot run on v2. They and their sub-folders are removed; their routes show placeholders until steps 3, 5, 7 and 9 rebuild them. The v1 code stays in git history (`fe3b890`) to port from.
- **The deferred-Undo pattern:** it is now a general hook, `useDeferredCommits`, that holds any write while its Undo toast is open. It no longer calls `review.resolve`.

**Kept.**
- The design system;
- the components of UI spec section 2;
- the motion presets;
- the hooks and the lazy screens.

Components still typed on v1 (`DocumentCard`, `PassportView`, `MedicineRow`, `TimelineItem`, `pills`, `lineForm`, `lib/format`, `lib/labels`) compile as they are and move to v2 types in the step that first uses them. `DocumentThumbnail` already reads the v2 `documents.file` result. `toServiceError` maps the v2 codes with the wording of UI spec section 8.

**Tests.**
- `App.test.tsx` (7 tests):
  - the four tabs and the profile menu with Settings;
  - moving between sections;
  - no profiles goes to Welcome, and the sample profiles load;
  - **every route renders**, with one `h1`, the expected `document.title`, and navigation only where it belongs;
  - **switching profile never shows the previous profile's data:**
    - a test screen loads the routine and the prescribers;
    - a MutationObserver records every text that appears during the switch, and none of the previous profile's medicines or doctors ever appears, in either direction;
    - I checked the test by making `useServiceQuery` return results for old keys: it fails;
  - a switch on a record page goes to Records, and the choice is kept;
  - the stored profile opens on start.
- `WelcomeScreen.test.tsx` (8 tests): validation, including "I manage my own records" and the contact; errors and focus; creating a caregiver profile with a contact, and checking its age on the device date; creating a self-managed profile; and "Add a profile".
- `toServiceError.test.ts`: the section 8 wording.
- `npm run check` passes: 25 test files, 439 tests, build OK. The counts dropped from 534 because the tests of the removed v1 screens went with them. Lint is clean.
- In a browser with `VITE_USE_MOCK=true`, the app starts on v2: Home on a phone width, and Records on desktop with the top bar and the profile menu. Headless Edge cannot render narrower than about 500 px, so the phone check was at 520 px.

**Differs from the spec, or chosen here:**
- Placeholders say which step builds the screen. They are visible to anyone running the app until those steps land.
- The mock starts seeded, as in v1, so a fresh browser opens on the sample profiles rather than Welcome. With the real services, a fresh device goes to Welcome.
- "Add a profile" reuses Welcome (`?new=profile`) instead of a separate page.

**Open questions:** none new. The questions of step 1 still stand.

### Step 3: records, search and record detail (2026-11-23)

**Records (`/records`, 4.3)**, in `screens/RecordsScreen.tsx`:
- **One search field.** It runs `records.search` 250 ms after typing stops.
- **Filters:**
  - kind chips with counts (only the kinds present, plus All);
  - "Starred";
  - doctor (the profile's prescribers);
  - facility (the facilities on the records);
  - a From / To date range;
  - sort: newest or oldest first.
  - On phones, doctor, facility and dates sit behind "More filters", which shows how many are in use, so the results stay near the top. On desktop they are always visible.
- **"Matched:" labels:** each result says what matched, from `matchedOn` ("Matched: title, test name", "Matched: doctor"). They appear once a search or filter is in use.
- **Ask:** a question-like phrase ("latest lipid profile", "prescriptions from my cardiologist", anything ending in "?") offers "Ask CareVault: “…”", linking to `/ask?q=…` for step 8.
- **Views:** Grid and Timeline, remembered on this device.
  - The timeline groups by month of `clinicalDate`, in the sort order. Undated records always form the final "Date not known" group, dated by `addedAt`: "Added 12 Nov from email".
  - With a date range set, the screen says that records with no known date are left out.
- **Every item shows its source:** "uploaded PDF", "PDF from email", "photo from the camera", or "scanned with the camera" for a camera PDF.
- **Undated and pending records** carry "Date not known" and "Not yet filed" pills.
- **Star** from the grid.
- **Other states:** loading, error with Retry, empty ("No records yet" with "Add the first record"), and no match (with "Clear the search and filters").

**Record detail (`/records/:id`, 4.5)**, in `screens/RecordDetailScreen.tsx`:
- **The original:** the v1 preview is kept, with pages, zoom and download. Two changes:
  - the scroll area is focusable, with a label, so the keyboard can scroll a zoomed page (v1 finding);
  - a newer page or zoom now cancels the render in progress (`renderPdfPage` takes an `AbortSignal`).
  - The original is fetched once per record, not through a subscribed query, so starring or editing no longer reloads it.
- **Details:**
  - kind;
  - the date and its source ("Date from the document", "Date set by you", "Date not known · received by email on 12 Nov 2026");
  - doctor, facility, tests and labels;
  - the patient name read and whether it matches the profile;
  - "Read 2 of 5 pages";
  - how and when it was added;
  - the status.
- **Actions:**
  - **Star.**
  - **Edit the details:** a dialog with kind, title, date (may be left empty), doctor, facility, tests and labels. It shows linked errors and moves focus to the first one. It sends only the changed fields to `documents.update`.
  - **File it** for pending records.
  - **Delete.**
- **Prescriptions:** the saved lines, each with "Checked" or "Check this value".
- **Another profile's record:** opening one by link shows "Record not found".

**Delete (`screens/records/DeleteRecordDialog.tsx`).**
- **Before deleting,** the dialog lists the saved passports that list the record: "Passport revision 1, shared on 23 Nov 2026". It says they keep the record's title and date and will show the original as removed.
- **When those passports have active links,** a checkbox, ticked by default, reads "Also turn off the active link to this passport".
- **On Delete,** the dialog calls `documents.remove`. When the box is ticked, it revokes exactly the `activeShares` returned by that call. Then it shows "Deleted Lipid profile and turned off one link" and returns to Records.

**Shared pieces moved to v2:** `DocumentCard` (with a `note` line for "Matched:"), `TimelineItem` (all eight kinds), and `lib/labels.ts`, which now holds the kind labels, source text, date-source text and pages text. The pure helpers are in `screens/records/recordsText.ts`.

**Tests.**
- `RecordsScreen.test.tsx` (10 tests):
  - the full list with sources;
  - search by test ("Matched: title, test name");
  - filter by doctor, and text matching a specialty;
  - filter by facility;
  - a date range, which leaves undated records out;
  - kind chips, sort and star;
  - the Ask offer and clearing;
  - **the timeline's final "Date not known" group**, in both sort orders;
  - error and empty states.
- `RecordDetailScreen.test.tsx` (12 tests):
  - the undated email record and filing it;
  - "Read 2 of 5 pages" and a name mismatch;
  - editing, including errors, "Date set by you" and the doctor;
  - star;
  - prescription lines;
  - another profile's record;
  - **delete:**
    - listing the snapshot and revoking its link (the link is revoked and the snapshot keeps the record with `removedAt`);
    - with the box cleared, the link stays active;
    - no passport lists it;
  - the helpers.
- `npm run check` passes: 27 test files, 461 tests, build OK. Lint is clean.
- **Browser check:** with `VITE_USE_MOCK=true`, I took real-time screenshots through the DevTools protocol at 1280 and 390 px: the grid with first-page thumbnails, the detail with the rendered page, and the phone layout. Headless Edge's `--virtual-time-budget` leaves pdf.js renders unfinished, which looked like a blank preview. Real time shows they render.

**Differs from the spec, or chosen here:**
- "Check the values" and "Review changes to the current routine" are not on the detail yet; steps 4 and 6 add them.
- The delete dialog works out which passports list the record and which links are active from `passport.snapshots` and `sharing.list` *before* deleting, so it can ask. The links it revokes are the ones `documents.remove` returns.
- "Matched:" uses the mock's vocabulary (request v2-5): title, tag, test name, facility, doctor, specialty, kind, date.
- With a date range set, undated records are left out, as the mock and `RecordQuery` do. The screen says so.

**Open questions:** none new.

### Step 4: add a record and Check the values (2026-11-23)

**Add a record (`/records/add`, 4.4)** is `screens/AddRecordScreen.tsx`, a single flow with its steps in `screens/records/add/`:
1. **Capture:** "Take a photo" (`accept="image/*" capture="environment"`), "Choose a photo or PDF", "Import from Gmail", and tips for a clear photo.
2. **Saved first:** `documents.add` runs before anything is read.
   - A duplicate shows "This file is already in the records (added <date>)" with three choices:
     - *Use the existing record* removes the new copy and opens the existing one;
     - *Keep both* reads the new copy;
     - *Cancel* removes the new copy.
   - Otherwise: "Saved. Reading it on this device…"
3. **Reading:** the v1 progress indicator, with "Enter by hand" always available.
   - **Cloud consent:** `cloud_consent_required`, or a candidate with `needsCloud`, shows the consent panel: "This page is hard to read on the device. Send this one page to the cloud reader?" with *Send this page*, *Retake the photo* (photos only) and *Enter by hand*. Only *Send this page* calls `reading.read` with `allowCloud: true`, while the CloudNotice is shown.
   - **Locked PDF:** `locked_pdf` goes to the details step with "This PDF is password-protected. It is saved; fill in the details by hand."
   - **Other errors:** shown with Retry and Enter by hand.
4. **Details:** kind, title, date on the document (it may be empty; the hint says what was read), doctor and facility.
   - **Pages:** "Read 2 of 5 pages" is highlighted when not every page was read.
   - **Doctor:** the name read is matched to the profile's doctors by surname. Otherwise "Add this doctor", prefilled with the name read, calls `profiles.addPrescriber` and selects the doctor.
   - **Patient mismatch:** "This looks like a record for Sunita Rao. Is it for Ramesh Iyer?" must be answered before going on:
     - *Yes* confirms the `patient_name` value;
     - *It is for another profile* (choose a profile, then Move it) calls `assignProfile` and returns to Records;
     - *Not ours* removes the record.
5. **Check the values** when any value is flagged (`needs_verification`); otherwise "File it".
6. **Prescriptions:** the lines with the checks applied ("Aspirin 75 mg"). *Save prescription* calls `prescriptions.save` and files the record. Then it shows either "Prescription saved. Some medicines differ from the current routine. Review them now?" (*Review changes* → `/records/:id/review`, *Not now*) or "…No differences with the current routine."
7. **Pack photos:**
   - "Add it to the routine?", with optional doses a day and how it is taken;
   - *He takes it* (the wording follows the profile; "I take it" for "Myself"), *Not sure* and *Just keep the photo*;
   - `routine.add` with source `from_pack` and the document. On `verification_required` the flow goes back to Check the values.
- **Gmail (4.10):**
  - *Connect Gmail* runs `gmail.connect` straight from the tap, under the CloudNotice "Reading your inbox for report attachments".
  - The list has one row per PDF attachment, with subject, sender, received date and "Already imported".
  - The chosen attachments are imported. Each one joins the flow at step 2, one after the other ("Continue with the next report").
- **Leaving the flow** at any step after step 2 keeps the record as "Not yet filed".

**Check the values (`/records/:id/verify` and inside the flow, 4.6)** is `screens/records/CheckValues.tsx`:
- **Layout:** the original on one side (on top on phones, shorter there) and the values on the other.
- **What is shown:** only `needs_verification` and `extracted` values, grouped by medicine line, with flagged values first. Checked values collapse into "N values already checked".
- **Each value shows:**
  - a plain title ("Strength not clear");
  - the literal text read in a monospace chip (`7? mg`);
  - the value as read, the reasons and the page;
  - "Show on the original", which jumps the viewer to that page (`DocumentPreview` gained `jumpTo`).
- **Actions:**
  - *Correct*: a box that starts with the value read. For strengths it has a unit select, and the unit chosen also answers the unit value.
  - *It is right*: disabled when nothing clear was read, with the reason.
  - *Leave unknown*.
  - *Retake the photo*: photos only.
  - *These N look right*: per group, confirms only the values read cleanly, never a flagged one.
- **Saving** sends every decision in one `reviewFields` call.
- **On its own page,** it returns to the record, or to a safe in-app `return` path for the review gate in step 6.
- **Record page:** it now shows "One value needs a check" with "Check the values" when something is flagged, or a quiet link when only values read cleanly remain. A confirmed mismatch shows "… · you confirmed it is Ramesh Iyer's record".

**Retake the photo, keeping all decisions (request v2-2 is still open).**
- The contract cannot replace a record's original, so the retake is saved as a new record. The earlier record's decisions are applied to the new photo's matching fields (`carryDecisions`):
  - a typed correction and "Leave unknown" carry over as they were;
  - "It is right" carries over only when the new photo reads the same value, because otherwise the value on screen is new.
- **The earlier photo is never removed on its own,** following "the original file is always kept". The details step offers *Remove the earlier photo*.
- With `documents.replaceOriginal` (v2-2), the decisions would stay on one record.

**Mock and core aligned.** I compared with `feature/core` (`createRealServicesV2`) and changed the mock to match it:
- `prescriptions.save` marks the saved lines' `extracted` values `user_confirmed`;
- `routine.add` with a document refuses only `needs_verification` or `unknown` values, and confirms the `extracted` ones.

**Tests.**
- `AddRecordScreen.test.tsx` (21 tests), including what the step names:
  - **duplicates:** use existing, keep both, cancel;
  - **leaving the flow** keeps "Not yet filed";
  - **the consent panel:** reading with the cloud only after "Send this page", and "Enter by hand";
  - **a locked PDF;**
  - **partial pages** ("Read 2 of 5 pages");
  - **the demo prescription:** correcting "7? mg" to 75 mg, ending with "Aspirin 75 mg", every line verified, the record filed and the routine unchanged;
  - **Leave unknown** keeps the line unverified, and *These N look right* leaves the flagged value alone;
  - **"Check later";**
  - **the pack ending and the gate;**
  - **retake keeps earlier decisions;**
  - **mismatch:** Yes, another profile, not ours;
  - **Add this doctor;**
  - **Gmail import;**
  - **the verify page:** one `reviewFields` call, and the retake link.
- `checkText.test.ts` (6 tests): titles, parsing corrections, applying checks to lines, carrying decisions, grouping, matching doctors.
- `npm run check` passes: 29 test files, 488 tests, build OK. Lint is clean.
- **Browser check:** real-time screenshots through the DevTools protocol at 1280 and 390 px of the details step and Check the values for the demo prescription, with no page errors. Three changes came from them:
  - a repeated "The details" heading was removed;
  - the per-group "These N look right" button and flagged-first order were added, because the demo shows 24 values;
  - the original is shorter on phones.

**Differs from the spec, or chosen here:**
- **Pack detection:** a pack is "kind `other` with exactly one line" until request v2-3 adds a kind.
- **Prescription lines:** they are shown, not edited, in the add flow. Corrections happen in Check the values, where the original is beside them.
- **Filing:** "Save prescription" and the pack choices also file the record.
- **Accepted read dates** become "Date set by you". Raised as request v2-6.
- **Mismatch "Yes"** confirms the patient name value; `patientMatch` stays `mismatch`, and the screen shows the confirmation (request v2-7).
- **Multiple Gmail imports** go through the flow one at a time.

**Open questions:**
- **v2-6:** the read-date source.
- **v2-7:** the mismatch answer.
- **v2-2:** replacing an original on retake.

### Step 5: passport and the reported routine (2026-11-23)

**Passport (`/passport`, 4.8)** is `screens/PassportScreen.tsx`, with its sections in `screens/passport/`:
- **The patient strip:** name, age (from `todayFor`), relation, emergency contact (or "not added") and prepared by.
- **"Save a snapshot":** calls `passport.snapshot(…, 'manual')`. When nothing changed it says "Nothing changed since passport N. It is kept as it is."
- **Current medicines:** `taking` entries in the passport order of overview 9.6, which is visit prescriber first, then other prescribers by name, then none, and A to Z within each. Each shows:
  - ingredients and how it is taken;
  - the source label ("Reported by Anjali", "From a prescription", "From the pack");
  - the doctor;
  - "Last confirmed 30 Oct";
  - a link to its detail.
- **"Add a medicine he takes"** (the wording follows the profile: "she", "they", or "I" for "Myself"):
  - **The form:** name, any number of ingredients with strength and unit, form, doses a day and how it is taken. Errors are linked and focus moves to the first.
  - **Saved as:** `routine.add` with status `taking`, source caregiver-reported (or patient-reported for "Myself") and no document, so no gate applies.
- **"Current use not confirmed"** lists `uncertain` and legacy-pending entries:
  - "Still taking";
  - "Stopped", after a confirmation ("Mark Atorvastatin 10 mg as stopped? … You can change this later").
  - Legacy entries are answered through `resolveLegacy`, so they leave the batch too.
- **"Choose the medicines he still takes":** while legacy entries are pending, a checklist settles them all at once with `resolveLegacy`. It says printing and sharing stay possible, and a snapshot can be saved meanwhile; the pending entries appear as unconfirmed in it.
- **Possible duplicate ingredients:** the v1 card rebuilt for v2.
  - The products side by side.
  - "If both are taken as entered", with the total only when it is complete. Otherwise it says "No total" and which product's frequency is missing.
  - The fixed sentence of overview 9.5: "These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber."
- **Allergies and history:**
  - allergies in three states, each with a pill: listed, "No known allergies" (one explicit entry, with Undo) and "Not recorded" (the passport says so; it is not the same as no allergies);
  - adding a real allergy replaces "No known allergies";
  - conditions and procedures, with add and remove.
- **Recent changes:** from `passport.live` (last 90 days), each with a kind pill.
- **The next visit:** weekday, date, doctor and time, with "Change the visit". With no visit, "Add the next visit" opens a form with doctor, date and time. It offers "Add a doctor" when the profile has none.
- **Questions for the doctor:** add and remove.
- **Reports to share:** a checklist of filed records, starred first. Pack photos are left out until request v2-3. It notes that files are not included in a link.
- **Earlier passports:** "Passport 3 · 14 Nov 2026 · printed", newest first, linking to `/passport/snapshots/:id` (step 7 builds that page).

**Medicine detail (`/passport/medicines/:id`, 4.9)** is `screens/MedicineDetailScreen.tsx`:
- **Details:**
  - ingredients, how it is taken, doses a day;
  - the source label and the doctor;
  - the source record (a link, or "The source record was removed");
  - last confirmed;
  - "Replaced by" with a link.
- **"What is true now?":** Taking, Not sure, Not started and Stopped. Not started and Stopped are confirmed first. The wording records what is taken; it never advises starting or stopping.
- **History,** newest first, with a before-and-after table per event (name, strength, doses a day, how it is taken, status).
- **Edit:** the same form as Add; the change is recorded as a history event.
- **"Undo the latest change"** (`routine.undo`):
  - It is not offered when the latest event is itself an undo.
  - Undoing the event that created an entry removes it and returns to the Passport.
  - On `stale` it shows "A later change was made; see the history."
- **Another profile's medicine:** opening one by link shows "Medicine not found".

**Tests.**
- `PassportScreen.test.tsx` (12 tests):
  - the sample passport: the strip, the order of `expected` current medicines, source labels and dates, not confirmed, allergies, conditions, questions, reports and recent changes;
  - snapshot save and reuse;
  - **adding a medicine by hand without a prescription** (validation, then a `caregiver_reported` / `taking` entry with no document);
  - **status change with confirmation** (cancel keeps it; confirm stops it);
  - "Still taking";
  - **the legacy batch:** from an imported v1 mock backup, a snapshot saved while pending, then one kept and the rest stopped;
  - **the three allergy states:** listed, then not recorded, then no known allergies, then listed;
  - conditions and procedures;
  - **the duplicate card with a complete total** (3,450 mg = 1,950 + 1,500) **and an incomplete one** (no total, "how often not entered");
  - questions and reports;
  - adding the next visit for Lakshmi.
- `MedicineDetailScreen.test.tsx` (10 tests):
  - fields, source record, "Replaced by", and history with before and after;
  - **status change with confirmation;**
  - **undo;**
  - **undo refused** (`stale`);
  - edit, then undo the edit;
  - undo of a hand-added entry removes it;
  - a removed source record;
  - another profile's medicine;
  - the helpers.
- `npm run check` passes: 31 test files, 510 tests, build OK. Lint is clean.
- **Browser check:** real-time screenshots through the DevTools protocol of the Passport at 1280 and 390 px and of the medicine detail at 1280 px, with no page errors. Two changes came from them:
  - the allergy and history cards use at most two columns, with each entry's text taking the space;
  - recent changes show their kind as a pill instead of a doubled prefix ("Started: Started …").

**Differs from the spec, or chosen here:**
- **Print and Share with QR** are not in the header yet; step 7 adds them with the snapshot, print and share screens. "Save a snapshot" is there now, so earlier passports can be made and listed.
- **The medicines section** is built from `routine.list` with the passport's ordering rule, not from `passport.live`, because `currentMedicines` has no entry ids to link to the detail. The two use the same rule, and the test checks the order against `expected`.
- **"Still taking"** on an unconfirmed entry sets it to `taking`, as in step 1, point 5. On a legacy entry it goes through `resolveLegacy`.
- **Hand-entered ingredient rows:** a row left fully empty is dropped, so a medicine can be added with its name alone. It then takes no part in duplicate checks.

**Open questions:** none new.

### Step 6: Review changes (2026-11-23)

**Review changes (`/records/:id/review`, 4.7)** is `screens/ReviewChangesScreen.tsx`, with its parts in `screens/review/`:
- **Header:** "What changed on this prescription", then "Dr. Kavita Rao · 13 Nov 2026. Nothing changes until you choose."
- **One card per asked row,** in the order changed, new, not_mentioned, uncertain_match. Each card has:
  - a pill (Changed, New, Not mentioned, Possible match);
  - the routine value ("In the routine now") beside the prescription value ("On this prescription");
  - the question and its choices as radio buttons, with the exact wording of the spec.
- **Pronouns:** the wording follows the profile relation ("he", "she", "they"). For "Myself" the questions say "you" and the answers say "I" ("Yes, I have started 80 mg").
- **"No change" rows** collapse into one line ("2 medicines are the same as in the routine", with their names). `passiveNotMentionedCount` becomes "3 other medicines in the routine are not on this prescription. Nothing changes for them." Neither has buttons.
- **Blocked rows** (`blockedByVerification`):
  - They lose the choices that write values (`started`, `not_started`, `started_new`).
  - They show the value as read ("It reads “7? mg” on the original") and "Check the strength first". The wording names the flagged field, or says "values" when several are flagged.
  - The link goes to `/records/:id/verify?return=…/review`. Check the values brings the user back, and the choices made before leaving are still there.
  - If the core still returns `verification_required`, the screen sends the user to the check, with the return link.
- **Choices are held on screen** and sent together with "Save these choices": one `routine.decide` call, in card order, with the proposal's `routineRevision`.
  - Held choices are kept in `sessionStorage` per record, so they survive the trip to Check the values.
  - They are cleared once saved, or by Not now.
- **Confirmation first:** "No, he has stopped" and "He is not taking it" open a confirmation before they are held:
  - "Mark Atorvastatin 10 mg as stopped?";
  - for a new row, "Leave Aspirin out of the routine?".
- **On `stale`:**
  - an alert says the routine changed since this review was prepared and that it has been refreshed;
  - the proposal is reloaded;
  - a held choice is kept only when its row still matches (same kind, line and routine entry) and the choice is still offered;
  - the others are named ("Choose again for Atorvastatin 10 mg: it changed").
- **"Not now"** calls `routine.dismiss` and returns to the record. The add flow's "Not now" (4.4) now dismisses too.
- **After saving:**
  - a summary with one sentence per answer ("Telmisartan updated to 80 mg.", "Aspirin added.", "Atorvastatin unchanged.");
  - an Undo for each change. It undoes that answer's events, newest first, and removes the question it added for the next visit. If a later change touched the medicine, it shows "A later change was made; see the history." with a link to the medicine's history;
  - rows reopened by an undo, or offered again after Same medicine or Different medicine, appear under "Still to answer".
- **Record detail (4.5)** gains "Changes to the current routine" for prescriptions. From `routine.proposalFor`, it shows how many differences have no answer yet, or "No differences with the current routine", and links to "Review changes to the current routine". This is how a skipped or put-off review is reopened.

**The mock** now matches the core in two places I found on `feature/core`:
- `routine.undo` of an event made by a review reopens that row (decision cleared, proposal open).
- `proposalFor` compares a prescription that has lines but no stored review, and stores the result.

**Tests.**
- `ReviewChangesScreen.test.tsx` (14 tests):
  - **the demo prescription's rows as in fixtures `expected`:** kinds, entries, asked and blocked; the three cards in order with their pills, questions and exact choices; the "No change" and passive lines without buttons;
  - **blocked row, then Check the values, then back:** correcting 7? to 75 mg; the earlier choice kept; Aspirin now offered "Yes, he takes it"; saved;
  - `verification_required` from `decide` routes to the check;
  - **skip leaves no trace:** the routine, the history and `attention.list` are unchanged, and Home shows nothing;
  - **Not now, then reopen from the record:** `dismiss` is called and the held choices are forgotten;
  - **stale reload keeping the choices that still match,** with the second save sent at the new revision;
  - **the summary and per-change Undo** with the decisions of `expected` (the passport's current medicines equal `afterDecisions`). Undoing Telmisartan reopens its row; undoing Aspirin brings the passport back to the sample;
  - both confirmations; Undo of an ask-the-doctor answer removes its question; Undo refused after a later change;
  - nothing to review; another profile's record; load error with Try again;
  - a slow reload after saving never shows the answered cards again;
  - the wording helpers (pronouns, "Myself", names, doses, counts, sentences, matching held choices).
- `createMockServicesV2.test.ts` has two new tests for the mock changes above. The add-flow test checks that its "Not now" dismisses.
- `npm run check` passes: 32 test files, 526 tests, build OK. Lint is clean.
- **Browser check:** real-time screenshots of the review at 1280 and 390 px: blocked Aspirin, the stop confirmation, and the summary. No page errors. One fix came from them: with the mock's real delays, the answered cards showed again for a moment after saving while the review reloaded. The screen now shows the proposal returned by `decide` until the reload arrives, and a test covers it.

**Differs from the spec, or chosen here:**
- **The not_mentioned pill** reads "Not mentioned". "Not on this prescription" is already the card's right-hand side.
- **Rows answered before** (other than skipped) are listed under "Answered earlier" with their answer. Skipped rows are offered again when the review is reopened.
- **Undo of a "changed to the new dose" answer** undoes both of its events (the new entry and the replaced one), so the routine returns to how it was.
- **The record page calls `proposalFor`.** As in the core, this reopens a put-off review. Nothing about reviews reaches Home either way.

**Open questions:** none new.

### Step 7: snapshots, print and share (2026-11-23)

**`PassportView`** (`components/PassportView.tsx`) is rebuilt on the v2 `Passport`. It is used by the snapshot page, the print page and the public page.
- **Header:** "Health passport", "Passport 3 · prepared 14 Nov 2026", and the visit line.
- **Patient box:** patient, emergency contact, prepared by, prepared on.
- **Safety information first:**
  - allergies in their three states ("Not recorded" says it is not the same as no allergies);
  - "Flag for review" with the overview 9.5 sentence;
  - current medicines (product, how taken, prescriber, source and last confirmed);
  - "Current use not confirmed".
- **Then:** conditions and procedures, recent changes, questions, and "Reports included". The reports show title, kind and date, with "Original removed on <date>" for a record deleted since. They never link back to the record. "Original files are not included in the link" follows the list.
- **No repeated words:**
  - the ingredient line appears only when it adds to the name (Dolo 650 shows "paracetamol 650 mg"; Amlodipine 10 mg shows nothing more);
  - a reason that repeats its heading is left out;
  - a recent change drops the word its pill already says (`lib/changes.ts`, also used on the Passport screen, where "Started · Started …" remained from step 5).
- **On phones** each medicine row stacks with the same markup, so print and desktop keep the table and nothing overflows.

**Print** (`/passport/print/:snapshotId`, `screens/PrintScreen.tsx`):
- **Getting there:**
  - from the Passport, Print first calls `passport.snapshot(profileId, 'print')`, which creates a snapshot or reuses the identical latest one, then opens the print page;
  - from a saved snapshot, that snapshot is printed as it is.
- **Opening the print dialog:** it opens once per history entry, after a short wait so the QR has rendered. Going back to the page does not print again.
- **The QR:** printed only for an active link to that exact snapshot (`qrLinkFor`). The link is chosen by the `?link=` id when that link belongs to the snapshot, otherwise the snapshot's newest link. It is never picked from the profile's links by expiry. With no such link the toolbar says "No QR code is printed: there is no active link to this passport" and offers Share with QR.
- **The toolbar** (not printed) names the snapshot and the report titles listed, and says "Original files are not included in the link."
- **Print styles** (`styles/index.css`):
  - small blocks stay whole;
  - tables split with the header repeated;
  - headings stay with what follows;
  - the passport has no height limit or hidden overflow, so a long passport continues on further pages and nothing is cut.
  - The sample prints as two A4 pages: allergies, the flag, all medicines and the unconfirmed entry are on page 1.

**Share** (`screens/passport/ShareDialog.tsx`, `usePassportOutputs.tsx`):
- **Getting there:** from the Passport, "Share with QR" calls `passport.snapshot(profileId, 'share')`; from a snapshot or the print page, that snapshot is used.
- **The dialog:**
  - it names the passport ("Passport 1 · prepared 14 Nov 2026");
  - it says "The passport is encrypted on this device. Anyone with the link can read it until it expires.";
  - expiry 2, 8 or 24 hours, then `sharing.create(snapshotId, hours)`;
  - it shows the QR of the link just made (by id), its expiry, the link, Copy link, "Print with this QR code" and Revoke;
  - other active links to the same snapshot are listed, and their QR is shown only when chosen.
- **"Active links"** (`ActiveLinks.tsx`) lists `sharing.list(profileId)` with the passport each opens, its expiry, Copy link and Revoke. It appears on the Passport and on each snapshot (that snapshot's links only). No QR is shown there.

**Snapshot view** (`/passport/snapshots/:id`, `screens/SnapshotScreen.tsx`): "Passport 3" with "Passport 3 · prepared 14 Nov 2026 · saved for printing", a note that it is a saved copy that does not change, Print, Share with QR, its active links, and the frozen `PassportView`. Another profile's snapshot shows "Passport not found", and so does its print page.

**Public page** (`/share/:id`, `screens/ShareScreen.tsx`):
- **No navigation, no analytics.** The key is read from the hash only.
- **It works on a device with no profiles:** a doctor opening the link is never sent to Welcome.
- **It shows** the passport read-only with its revision and date.
- **States:** loading ("Opening and decrypting the passport…"), missing key ("This link is incomplete"), not found, revoked, expired, and other errors with Try again.

**Also changed:**
- **Earlier passports** on the Passport read "Passport 1 · 14 Nov 2026 · shared". They use the date the passport was prepared (from `todayFor`), not the device time it was saved.
- **Review pills (step 6):** the review cards now use the proposal pills of UI spec section 2:
  - "Newly prescribed" (blue);
  - "Different strength" or "Different instructions" (amber);
  - "Not on this prescription" (new grey-outline pill tone);
  - "Possible match" (amber).
  - The not-mentioned card's prescription side now reads "Not listed on it".

**Tests.**
- `SnapshotPrintShare.test.tsx` (12 tests):
  - **printing creates a snapshot** (`snapshot(…, 'print')`) and prints it, **reuses it** when nothing changed, and makes passport 2 after a routine change; printing a saved snapshot makes none; the printed page carries allergies, the unconfirmed entry, the flag and the reports note;
  - **the printed QR only for that snapshot:**
    - no QR for passport 2 while passport 1 has a longer-lived link;
    - passport 2's own link once made;
    - another snapshot's link asked for by id is ignored;
    - none after Revoke;
  - the share dialog: wording, expiry choices, `create(snapshotId, 2)`, the QR of that link, then "Print with this QR code" printing exactly that link;
  - Revoke from the active links;
  - the `qrLinkFor` and `changeText` helpers;
  - **two profiles never cross:** Ramesh's snapshot and print page are not found for Lakshmi; her print has her data only and no QR; her link list is empty;
  - **a snapshot reads the same after a routine edit** (status, instruction, new allergy) **and after a record delete**, where only "Original removed on <date>" is added and nothing links back;
  - **the share page states:** valid link (with loading), no profiles on the device, missing key, not found, revoked, expired, error then Try again.
- Updated: `App.test.tsx` (the new routes and titles), `PassportScreen.test.tsx` (the earlier-passport date and the recent-change wording), `ReviewChangesScreen.test.tsx` (the pills).
- `npm run check` passes: 33 test files, 537 tests, build OK. Lint is clean.
- **Browser check** (real time, headless Edge):
  - the share dialog, then "Print with this QR code";
  - the print page with that QR, and the print dialog opened once;
  - an A4 PDF through the DevTools protocol: two pages, nothing cut;
  - the public page opened from the link at 1280 and 390 px.
  - No page errors. The fixes it led to are listed above (repeated words, the phone table, the earlier-passport date).
- **One flaky test fixed at its cause:**
  - The print page used to clear its "print now" flag by rewriting history. If you left the page quickly, that could interrupt the next navigation, so it now remembers printed history entries instead.
  - The tests wait for each page's own content, because navigations render as transitions.

**Differs from the spec, or chosen here:**
- **The printed title** is "Health passport", as the passport is no longer only for a visit; the visit line follows when there is one.
- **Sources on the passport** read "Reported by the caregiver" or "Reported by the patient": the frozen passport has no names to put there.
- **The print dialog opens on its own** when arriving from Print; "Print this page" is there to print again.
- **The mock keeps links in memory,** so a share link opened in a new tab of the dev build shows "not found". With the real services the link works across devices.

**Open questions:** none new.

### Step 8: Ask (2026-11-23)

**Ask (`/ask`, 4.12)** is `screens/AskScreen.tsx`, with its wording in `screens/ask/askText.ts`:
- **Header:** "Ask CareVault" and "Ask about Ramesh's records: a test, a doctor, a place or a date."
- **The question box:** "Your question", a search field with an Ask button.
- **The five example chips** of the spec. Each one asks straight away:
  - "Latest lipid profile";
  - "Prescriptions from the cardiologist";
  - "Last three HbA1c reports";
  - "What questions did I save?";
  - the medicines question in the profile's words: "What medicines does he take?", "…does she take?", "…do they take?", or "…do I take?" for "Myself".
- **One question at a time:**
  - The question lives in the address (`?q=`), so the Records "Ask CareVault" link opens with its answer and Back after opening a result returns to the same answer.
  - Nothing else is kept: no chat history and no model. The answer is `records.ask`, which reads the question with fixed rules.
- **The answer:**
  - "Looking for: latest report with Lipid profile" (`interpretedAs`), then the factual `text` as given by the services;
  - **records found:** cards that open `/records/:id`, each with title, kind, date ("Date not known" when there is none), facility or doctor, source ("uploaded PDF", "PDF from email") and "Matched: …";
  - **questions:** the saved questions, and "Open the questions in the passport" (`/passport#questions`);
  - **medicines:** cards that open each medicine's detail, and "Open the current medicines in the passport" (`/passport#medicines`).
  - The Passport opens at that section: the questions card and the medicines section now carry those ids, and the page scrolls to the hash once loaded.
- **Not understood:** "CareVault can search your records by test, doctor, place and date. Try: latest lipid profile or prescriptions from the cardiologist." The two examples are inline links that ask; the full set is just above.
- **The footer:** "Answers come from the records on this device. CareVault does not give medical advice."
- **States:** loading (skeleton, announced politely), error with Try again, no answer before a question is asked.

**Tests.**
- `AskScreen.test.tsx` (7 tests):
  - the box, the five chips in order, the footer, and no answer at first;
  - **each example chip:** it asks its question (in the address too) and shows exactly the `interpretedAs` and `text` of `records.ask`, with result links matching its records, questions or medicines;
  - the sample case answers:
    - Lipid profile with "12 Nov 2026 · Lakeside Diagnostics", its source and "Matched: test name";
    - the two cardiology prescriptions, newest first;
    - the undated HbA1c report shown as "Date not known";
    - the six medicines taken;
  - **understood false:** the hint, no "Looking for", no results, and its examples ask;
  - **results open the right record** (Lipid profile), medicine (Metformin) and passport section (`#questions`); Back returns to the answer;
  - Lakshmi gets nothing of Ramesh's, and her chip says "she";
  - the wording helpers.
- `App.test.tsx`: `/ask` now renders "Ask CareVault".
- `npm run check` passes: 34 test files, 544 tests, build OK. Lint is clean.
- **Browser check:** real-time screenshots of Ask at 1280 and 390 px (an answer with records, the medicines answer, not understood), with no page errors. One change came from them: the not-understood hint first repeated all five chips just below the same five chips, and now names two examples inline.

**Differs from the spec, or chosen here:**
- **The not-understood text** shown is the spec's sentence, not the services' own `text` (which says much the same with other examples).
- **The page heading** is "Ask CareVault"; the navigation item and the page title stay "Ask".

**Open questions:** none new.

### Step 9: Home, Gmail import and Settings (2026-11-23)

**Home (`/`, 4.2)** is `screens/HomeScreen.tsx`, with its wording in `screens/home/homeText.ts`:
- **The header:** the patient's name and "Father · 71 years · cared for by Anjali Iyer" ("Your own records" for "Myself").
- **The passport card:** name and age, "6 medicines being taken", "Current use not confirmed" with the entries, the allergy state (listed, "No known allergies" or "Allergies not recorded"), and "Open the passport".
- **The next visit**, when there is one: day, doctor and time, with "Prepare for the visit" (to the Passport).
- **"Needs attention":** `attention.list` filtered to the four kinds only (`HOME_KINDS`). Anything else the list might hold is never shown. Each card has its pill, title, body and one action:
  - unverified fields: "Check the values" → `/records/:id/verify`;
  - unassigned import: "Choose whose record this is", which opens a dialog to give it to a profile (`documents.assignProfile`) or "Not ours: remove it";
  - possible duplicate ingredient: "Review the products" → `/passport#duplicates`;
  - legacy routine review: "Choose the medicines he still takes" (in the profile's words) → `/passport#legacy-review`.
  - With nothing to show, the section is absent: no "everything is done" banner. No medicine-status question and no prescription review ever appear on Home.
- **Add a record** ("Add a record", "From Gmail") and **the Ask box**, which opens `/ask?q=…`.
- **Recently added:** the three newest records by when they were added.
- **The Gmail line,** when Gmail was connected this session: "Gmail connected for this session · Check for new reports".
- **Layout:** two columns on desktop. On phones one column in the spec's order: passport card and visit first, then attention, add and ask, recent records.

**Gmail import (4.10):**
- **In the add flow:** the step 4 Gmail step, now with "Already imported" as a pill. Already imported rows start unticked.
- **Rows:** one per PDF attachment, so two attachments of one email are two rows, imported separately, and each joins the add flow at step 2.
- **Shortcut:** `/records/add?from=gmail` opens the add flow straight on the Gmail step (from Home and Settings).
- **"Connected this session"** is kept in memory (`lib/gmailSession.ts`), as the permission is: a reload forgets it.

**Settings (`/settings`, 4.13)** is `screens/SettingsScreen.tsx` with `screens/settings/`:
- **Profiles:** each with relation, age, caregiver and emergency contact; Edit (the Welcome form in an edit mode, `profiles.update`), Switch, and Add a profile. `/settings#add-profile` opens the add form.
- **Doctors of the current profile:** the list, and add with name and specialty (`profiles.addPrescriber`), with a linked error when the name is empty.
- **Cloud reading:** as v1, worded for pages.
- **Gmail:** "Connect Gmail for this session" (`gmail.connect` straight from the tap, with the CloudNotice), then "Gmail connected for this session · Check for new reports".
- **Backup:** the v1 save and restore, with the note "Backups made with earlier versions can still be restored".
- **Older share links:** the active links from `sharing.listUnowned()`, each with its expiry and Revoke. "No older links are open." when there are none.
- **Sample data:** "Load the sample profiles".
- **About.**

**Tests.**
- `HomeSettings.test.tsx` (11 tests):
  - **two attachments of one email are separate rows**, imported separately into two records, then the details step;
  - **"Already imported" per profile:** the kidney report imported for Ramesh shows "Already imported" (unticked) for him and not for Lakshmi;
  - Home's passport card, visit, add, Ask box (to `/ask?q=`) and the three newest records;
  - **Home shows only the four kinds:** the attention list is given extra kinds, including a "Is he still taking …?" item; only the four show, each with exactly one action and the right target; no medicine-status question, status button or review link;
  - Lakshmi's Home has no attention section and no banner;
  - assigning an email import to another profile;
  - the Gmail line;
  - the helpers;
  - **older share links are listed from `sharing.listUnowned`** (never in a profile's links) **and can be revoked**;
  - editing a profile's emergency contact, adding a doctor, switching profile;
  - cloud reading, Gmail connect, the backup note and sample data.
- Updated:
  - `App.test.tsx`: Home's heading is the profile's name, `/` and `/settings` are real routes, and the route test now has a longer time limit since every route loads its own screen;
  - `WelcomeScreen.test.tsx` and `ReviewChangesScreen.test.tsx` (Home's heading).
- `npm run check` passes: 35 test files, 555 tests, build OK. Lint is clean.
- **Browser check:** real-time screenshots of Home at 1280 and 390 px and Settings at 1280 px, after connecting Gmail, with no page errors. One change came from them: on phones the passport card and next visit now come first, as the spec lists them.

**Differs from the spec, or chosen here:**
- **Home's heading** is the patient's name; the tab and page title stay "Home".
- **The legacy review action** opens the Passport at the batch review (`#legacy-review`) rather than a separate page.
- **"Not ours: remove it"** in the assign dialog removes the record at once, like the Delete on the record page; the item says whose name was read.

**Open questions:** none new.

### Step 10: accessibility and responsive polish (2026-11-23)

**How it was checked.**
- **axe-core 4.10.2** was installed in a scratch folder (not in `package.json`) and injected into the page through the DevTools protocol, in headless Edge, against the dev build with `VITE_USE_MOCK=true`.
- **What it covered** (22 page states, at 1280 px and at 390 px as a phone, so 44 checks):
  - every v2 route: Home, Records (grid and timeline), Add a record, three record pages (a lab report, a prescription, the demo prescription with its flagged value), Check the values, Review changes, Passport, a medicine, a snapshot, Print, Ask (an answer and "not understood"), Settings, Welcome, Not found, and the share page (open, and without its key);
  - two dialog states: the share dialog and the Edit profile sheet.
  - The script navigates inside the app, so the snapshot, the share link and the uploaded prescription made at the start stay in the mock.
- **At 390 px, also checked:**
  - horizontal scroll (page scroll width, and any element past the right edge);
  - one `h1` per page;
  - tap targets under 44 px.
  - The tap-target check measures what a finger hits: the label of a visually hidden or bare input, the whole card for a stretched link, and the row for a stretched checkbox label. Links and buttons inside a sentence are exempt, as in WCAG 2.5.8.

**Before** (44 checks): 12 serious and 5 moderate axe nodes, no horizontal scroll, and small tap targets on most pages.
- **Serious, color-contrast:** the unselected options of the segmented control (Records "Sort" and "View", the share expiry) were grey text on the grey track at 4.38:1. This is the v1 "unselected filter chips" finding; the Records filter chips themselves were already at text-ink-2.
- **Moderate, heading-order** (v1 finding): the record cards on Records are `h3` directly under the page's `h1`.
- **Moderate, region** (v1 finding): the share page's logo and top line were outside any landmark, in the open, missing-key and error states.
- **Small tap targets at 390 px:**
  - the logo link in the phone bar (36 px);
  - "All records" on Home (19 px);
  - the record links in the Timeline (20 px);
  - the medicine links under "Current use not confirmed" (24 px);
  - the source-record and "Replaced by" links on the medicine detail (20 px);
  - checkboxes whose only target was the 24 px box and the label text;
  - the skip link when focused.
  - The first run of the script also listed text fields (measured by their caption), visually hidden file inputs and stretched card links; those were the script's mistakes, not the app's, and were corrected in the script.

**Fixes.**
- **`SegmentedControl`:** unselected options use text-ink-2, which passes on the grey track.
- **Records:** a visually hidden `h2` ("6 records") above the grid, so the cards' `h3` follow in order.
- **Share page:** the logo and the top line are in a `header`, and the loading state's content in `main`, so nothing is outside a landmark.
- **Squashed logo on the passport header** (v1 finding): `PassportView` shrank the logo with `[&_span:first-child]:size-8`, which also matched the logo's outer span and forced the whole logo into a 32 px square. `Logo` now has a `small` size with a fixed square mark, and the passport uses it.
- **Keyboard access to the PDF preview** (v1 finding): already fixed in step 3 (the scroll area has `tabindex="0"`, `role="region"` and a label); checked again here.
- **Tap targets:**
  - those links are now at least 44 px tall (`inline-flex min-h-11 items-center`);
  - the skip link is 44 px when focused;
  - `Checkbox` stretches its label over the whole row (at least 48 px), so a tap anywhere on the row toggles it. Its accessible name is unchanged.

**After** (44 checks): no axe findings at any impact, not only serious and critical. No horizontal scroll at 390 px, no tap target under 44 px, and exactly one `h1` on every page.

**Tests.**
- `npm run check` passes: 35 test files, 555 tests, build OK, three runs in a row. Lint is clean.
- **Test limits raised for the UI tests:** with 35 jsdom files in parallel on this machine, the first test of a file (which loads the lazy screens) sometimes needed more than Vitest's 5 s, and a `findBy` more than 4 s. Failures moved between files from run to run. `src/ui/test/configureTesting.ts` now sets 8 s for `findBy` and 20 s per test, for the UI tests only (the frozen global setup and `vite.config.ts` are unchanged).

**Not changed:** the inline example links in Ask's "not understood" hint stay inline in the sentence (WCAG 2.5.8 exception).

**Open questions:** none new.

### Step 11: ready for the merge checkpoint (2026-11-23)

**README.md** is rewritten for v2:
- what CareVault v2 is and does;
- the first release story, step by step, with the exact values to expect;
- the screens, with the new screenshots;
- privacy (the three ways data leaves the device);
- how to run it with the mock or the real services;
- the sample data (both profiles), the stack and the layout.

**Screenshots:** `docs/screenshots/` now holds every v2 screen at 1280 px and 390 px, 17 screens and 34 PNGs (2.7 MB), taken with the mock in headless Edge:
- Welcome, Home;
- Records (grid, timeline, search), a record, Add a record, Check the values (the "7? mg" Aspirin strength beside the original), Review changes (with a blocked Aspirin row);
- Passport, a medicine, the share dialog, a snapshot, Print (with the QR of its link), the shared page;
- Ask, Settings.

The seven v1 screenshots of retired screens (Review home, Medicines, Visit) are removed.

**The first release story, walked against the mock on a 390 px screen** (scripted through the DevTools protocol in headless Edge; 26 of 26 checks passed, no page errors):
1. **The demo prescription is saved.** The original is saved first and read, and the Aspirin strength is flagged as "7? mg" with "Unclear digit".
2. **The value is corrected.** It is corrected to 75 mg in Check the values; the prescription then reads "Aspirin 75 mg", is saved, and the review is offered.
3. **One medicine is updated.**
   - The review has one card per asked row (Telmisartan, Aspirin, Atorvastatin).
   - "Yes, he has started 80 mg" for Telmisartan and Skip for the other two gives "Telmisartan updated to 80 mg. Aspirin unchanged. Atorvastatin unchanged."
   - The passport takes Telmisartan 80 mg and no longer 40 mg. Aspirin is not added; Atorvastatin is still "not confirmed".
   - Nothing about the skipped questions appears on Home.
4. **The latest lipid profile is found.** Records search "lipid profile" (newest first) lists Lipid profile first. Ask "latest lipid profile" answers "Latest report with Lipid profile: 12 Nov 2026, Lakeside Diagnostics."
5. **Print and QR match.** Share with QR, then "Print with this QR code". The print dialog opens, and the printed QR is the link just made. The link opens the same snapshot (same patient, "Passport 1 · prepared 14 Nov 2026"), whose text is exactly the printed passport's (the QR slot aside).
6. **Nothing breaks it:**
   - a backup is saved;
   - Lakshmi's passport and print carry none of Ramesh's data and no QR, and Ramesh's snapshot is "not found" for her;
   - after marking Dolo 650 as stopped, the live passport changes and the snapshot reads exactly as before;
   - after restoring the backup, the snapshot and its QR link read exactly as before, and the routine is as it was at the backup.

**The merge:** `main` was merged into `feature/ui`. It had nothing new, since `feature/core` is not merged yet; laptop A merges after this pull request (overview section 13). `npm run check` passes.

**Not tested here** (also listed in the pull request):
- the real services (`VITE_USE_MOCK=false`): the UI was built and walked against the mock only; the walk against the real services is the checkpoint's step 3 on `integration-v2`;
- the demo prescription PDF comes from `feature/core` (laptop A). It is not on this branch, so the walk used a copy taken from that branch;
- Gmail against a real account, the cloud reader, and the share server;
- printing on paper (the print layout was checked as an A4 PDF in step 7);
- a phone with a real camera, and screen readers (the checks were axe and the keyboard).
