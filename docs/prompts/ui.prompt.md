# UI prompts (laptop B)

How to use this file: paste one phase at a time into Claude on laptop B, from the repository root. Wait until the phase is finished and pushed before pasting the next. Phase 0 runs on `main`; every later phase runs on `feat/ui`.

Before Phase 0, the human does this once: create an empty GitHub repository named `carevault`, add the second GitHub account as a collaborator, clone it on laptop B, and copy the `docs/` folder (specs, prompts, design PNGs) into it.

---

## Phase 0: scaffold and contract (on `main`)

```
You are setting up the CareVault repository. Read docs/specs/00-overview.spec.md fully before doing anything, then docs/specs/02-ui.spec.md, then section 11 of docs/specs/01-core.spec.md (the npm scripts).

Work on the main branch. Do exactly this:

1. Create a Vite + React + TypeScript project in the repository root (keep the existing docs/ folder).
2. Install, at current stable versions, every dependency both sides will need, so package.json never changes again:
   react-router, tailwindcss and its Vite integration, motion, lucide-react, vite-plugin-pwa, @fontsource/inter, @fontsource/manrope, dexie, zod, qrcode, pdfjs-dist, tesseract.js, @paddleocr/paddleocr-js, onnxruntime-web, hono, @hono/node-server, @supabase/supabase-js, the current official Google Gen AI SDK for Node, and as dev dependencies: vitest, @testing-library/react, @testing-library/user-event, jsdom, fake-indexeddb, tsx, eslint with the TypeScript and React plugins, and the needed @types packages.
   Check each package's current documentation for the correct package name and setup; do not rely on memory.
3. Create src/contract/types.ts and src/contract/services.ts with the exact contents of sections 8.1 and 8.2 of the overview spec.
4. Create src/contract/fixtures/sampleCase.ts exporting the sample case from section 10 of the overview spec as typed constants with fixed ids and fixed timestamps: the profile, prescribers, medicines in their final expected state, events, documents, prescription lines for all three prescriptions, the three open review items, the visit with its two questions, and an `expected` object holding the diff rows, the ingredient totals (paracetamol 3450 mg/day from 1950 + 1500), the change summary and the status counts. Also export `SAMPLE_TODAY = '2026-11-14'`.
5. Create stubs:
   - src/core/createRealServices.ts exporting createRealServices() that throws "not implemented" from every method.
   - src/ui/mock/createMockServices.ts exporting createMockServices() that throws "not implemented" from every method.
   - src/services/index.ts exactly as shown in section 5 of the overview spec.
   - src/main.tsx rendering a placeholder page that says "CareVault scaffold".
6. Add the npm scripts from section 11 of the core spec. Configure Vitest with jsdom. Configure the Vite dev server to proxy /api to the local server port.
7. Create .env.example with the variables from section 12 of the overview spec, .gitignore (node_modules, dist, .env), and empty files docs/progress-core.md, docs/progress-ui.md, docs/contract-requests-core.md, docs/contract-requests-ui.md.
8. Create .github/workflows/ci.yml: on push and pull request, run npm ci and npm run check.
9. Add one test that imports the fixtures and checks 1950 + 1500 equals expected paracetamol perDay, so the test runner has something to run.
10. Run npm run check and fix anything that fails.
11. Commit as "chore: scaffold, contract and fixtures" and push to origin main.
12. Create the branch feat/ui and push it.

Finish by printing: the installed version of every dependency, and the full contents of src/contract/services.ts so the human can confirm it matches the spec. Do not start any other work.
```

After Phase 0 is pushed, tell laptop A to start. Then copy `.env.example` to `.env` and set `VITE_USE_MOCK=true`.

---

## Phase 1: design system, shell and mock

```
Read docs/specs/00-overview.spec.md fully, then docs/specs/02-ui.spec.md, then look at the five images in docs/design/. You are on branch feat/ui. You may edit only the paths listed in section 1 of the UI spec. Never import from src/core. If you believe a frozen file or the contract must change, stop and write the request in docs/contract-requests-ui.md instead of editing it.

Build:
1. Tailwind theme with the colour, type, radius and shadow tokens from section 3 of the UI spec; self-hosted Manrope and Inter; base styles in src/ui/styles. Check the current Tailwind documentation for how themes are configured in the installed version.
2. The components listed in section 3, each with its states, plus a private /dev/components route that shows them all (remove it from navigation; keep it for review).
3. Motion presets in src/ui/app/motion.ts following section 4, with reduced-motion handling in one place.
4. The app shell from section 6 (TopNav on desktop, BottomTabs on phone, ProfileSwitcher), React Router with every route from section 11 of the overview spec pointing at placeholder screens, and the profile context.
5. src/ui/mock/createMockServices.ts: a complete in-memory implementation of CareVaultServices backed by src/contract/fixtures/sampleCase.ts, with artificial delay, simple versions of the behaviour rules in section 9 of the overview spec, working subscribe(), and the failure switch described in section 1 of the UI spec.
6. useServiceQuery and useServiceAction hooks from section 5.

Tests: the mock returns the fixtures' expected counts; ReviewCard, Pill and Button render and respond to clicks.

Run npm run check. Append a short entry to docs/progress-ui.md. Commit as "ui: design system, shell, mock services" and push feat/ui. Stop.
```

## Phase 2: Welcome and Review

```
Continue on feat/ui under the same ownership rules. Build sections 7.1 and 7.2 of the UI spec.

The Review screen must match docs/design/CareVault-Main.png on desktop and docs/design/CareVault-Mobile.png at 390 px: same structure, wording, colours and proportions. On phone the list scrolls and nothing is hidden behind the tab bar.

Include: all four review kinds with their actions, the ConfirmDialog for "Stopped", toasts with Undo, the Next visit panel, the "Since the last visit" tiles with count-up, the recent records row, and the loading, empty and error states. The Welcome screen has "Try the sample profile" and the create-profile form with validation.

Tests: resolving an item removes its card and calls review.resolve with the right resolution; the empty state renders when there are no open items.

Run npm run check. Compare the result against both images and list any differences in docs/progress-ui.md. Commit as "ui: welcome and review" and push. Stop.
```

## Phase 3: Medicines and the scan flow

```
Continue on feat/ui. Build sections 7.3, 7.4 and 7.5 of the UI spec.

The Medicines screen must match docs/design/CareVault-Medicines.png. Use the exact safety sentence under the duplicate card. Show the total only when IngredientTotal.complete is true.

The scan flow has four steps (capture, reading, confirm, done). Build the cloud-consent branch for the cloud_consent_required error and show the CloudNotice whenever a photo is sent. Build the confirm form as a reusable component (SourceViewer beside editable fields, "Check this" markers on extracted fields, warnings under fields), because Phase 4 reuses it for prescription lines.

Medicine detail shows the history timeline and the status actions.

Tests: the duplicate card with complete and incomplete totals; extracted markers clear when a field is edited or confirmed; the consent panel appears on the consent error and nothing is sent without a click.

Run npm run check. Check the page at 390, 768 and 1280 px. Update docs/progress-ui.md. Commit as "ui: medicines and scan flow" and push. Stop.
```

## Phase 4: Records vault

```
Continue on feat/ui. Build sections 7.6 and 7.7 of the UI spec.

Records: search, category chips with counts, starred toggle, Grid and Timeline views, the upload Sheet with all its states (selecting, reading, review details, saving, saved, duplicate found, failed), first-page thumbnails with pdfjs-dist (read its current documentation for worker setup under Vite), and the empty state.

A prescription upload continues into the line-confirm step (reuse the Phase 3 form, one card per extracted line, with add and remove line), then calls prescriptions.apply and navigates to /visit showing the new comparison.

Document detail: preview with page navigation and zoom, metadata, star, confirm, delete with confirmation.

Tests: search filters the list; the duplicate dialog appears when add returns duplicateOf; confirming lines calls prescriptions.apply with the edited values.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: records vault and timeline" and push. Stop.
```

## Phase 5: Visit, passport and sharing

```
Continue on feat/ui. Build sections 7.8, 7.9 and 7.10 of the UI spec.

/visit must match docs/design/CareVault-Changes.png: appointment-mode pill, the two date tiles, one DiffRow card per row in the order added, changed, review, unchanged, with the struck-through and highlighted values, the answer buttons on review rows, questions for the doctor, reports to share, and the status panel (sticky bottom bar on phone). Handle "no next visit" and "no previous prescription".

/visit/passport must match docs/design/CareVault-Passport.png and print cleanly on one A4 page: write a print stylesheet, hide the toolbar in print, and check the print preview.

Share dialog: expiry choice, create link, QR code rendered with the qrcode library, copy link, active links with revoke, and the CloudNotice during upload. Use the exact explanation sentence from the spec.

/share/:id: no shell, reads the key from location.hash, renders the read-only passport, and has distinct states for loading, expired, revoked, not found and missing key.

Tests: each DiffRow kind renders its pill and cells; answering a review row updates the status panel count; the shared view shows the expired state when sharing.open rejects with code 'expired'.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: visit, passport, sharing" and push. Stop.
```

## Phase 6: settings, PWA, states and accessibility

```
Continue on feat/ui. Build sections 7.11, 8, 9, 10 and 11 of the UI spec.

1. Settings: profiles, cloud reading toggle with the plain explanation, Gmail import (connect, candidate list, import, session-only note), backup export and import with passphrase fields and the replace-data confirmation, reload sample data, About.
2. PWA: manifest, icons with the CV mark, service worker through vite-plugin-pwa that precaches the shell and does not cache /api.
3. Go through every screen and confirm the four states exist (loading, empty, ready, error). Use the mock failure switch to see each error state.
4. Accessibility pass: keyboard only, visible focus, labels, one h1 per page, live region for toasts, 200% zoom, reduced motion.
5. Responsive pass at 390, 768 and 1280 px on every screen.
6. Add a test that fails if any file under src/ui imports from src/core.

List anything you could not fix in docs/progress-ui.md. Run npm run check. Commit as "ui: settings, PWA, states, accessibility" and push. Then open a pull request from feat/ui into main titled "UI: all screens against the service contract". Stop.
```

## Phase 7: polish on real services (after the core side has pushed `integration`)

```
The integration branch now runs on the real services. Pull it and work there, still only inside the UI-owned paths.

1. Set VITE_USE_MOCK=false and run the app with the local server. Walk the demo path from section 13 of the overview spec on a 390 px wide screen and on desktop. Fix every UI problem that appears with real data: long product names, missing fields, slow reading, real error messages. If a problem is in the core, write it in docs/contract-requests-ui.md and tell the human.
2. Tune motion and loading states to the real timings, especially the scan step.
3. Write README.md: what CareVault does and for whom, a screenshot of each main screen, how the privacy design works (what stays on the phone, the three cases where data leaves), the tech stack, how to run it locally, the sample profile, and a clear "not medical advice, synthetic data only" note.
4. Capture clean screenshots of the five main screens into docs/screenshots/ for the project page.

Run npm run check. Update docs/progress-ui.md. Commit as "ui: polish on real services, README" and push integration. Stop.
```
