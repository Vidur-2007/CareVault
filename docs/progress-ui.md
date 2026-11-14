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
