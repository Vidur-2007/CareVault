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
