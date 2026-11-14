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
