# CareVault: overall build spec

Read this file first on both laptops. It describes the whole application and the contract that lets two people build it separately. The two part specs (`01-core.spec.md`, `02-ui.spec.md`) add detail; where they disagree with this file, this file wins.

## 1. What CareVault is

CareVault is a family health passport. An adult child (the caregiver) manages the medicines and medical documents of an older parent. The app answers four questions:

1. What medicines is the patient taking right now?
2. What changed after the last doctor visit?
3. Do two products at home contain the same active ingredient?
4. What should we take to the next appointment?

The core loop:

```
Scan medicines at home -> caregiver confirms -> current medication list
        -> doctor visit -> scan new prescription -> compare with the last one
        -> review items -> caregiver answers -> updated passport -> next visit
```

Hackathon: GenHacks, track Healthcare & Environmental. Submission closes 26 December 2026, 12:00 AM Eastern (10:30 AM IST the same day). Plan to finish by 24 December.

## 2. Safety and privacy rules (apply to every line of code and copy)

- AI only reads documents and returns structured fields. It never diagnoses, never recommends treatment, never tells anyone to stop a medicine.
- All arithmetic, unit conversion, ingredient matching, comparison and status changes are deterministic TypeScript with unit tests. No model output is ever used as a number without caregiver confirmation.
- Every extracted field is `extracted` until the caregiver confirms it. The original image or PDF is always kept and shown beside the fields.
- The app never assumes. A medicine missing from a new prescription becomes a question, never an automatic stop.
- Copy uses "possible", "please verify with a pharmacist or the prescriber". Never "safe", "unsafe", "overdose", "you should".
- The health record lives in the browser (IndexedDB). It leaves the phone in exactly three cases, each behind an explicit action: cloud reading of one image (consent toggle plus per-use notice), Gmail import (browser-only token), sharing a passport (encrypted on the phone first).
- All demo data is synthetic.

## 3. Scope

In scope:

- Patient profiles (one caregiver device, several profiles)
- Medicine scan, extraction, confirmation, statuses, history
- Duplicate-ingredient detection and daily totals
- Prescription upload and comparison with the previous prescription from the same prescriber
- Review inbox
- Health records vault with timeline, search by title and type, starring, exact-duplicate detection by file hash
- Appointment mode, "what changed since last visit", questions for the doctor
- Doctor Visit Passport, print to PDF, encrypted QR share link with expiry and revoke
- Gmail import of PDF attachments from a test inbox
- Encrypted backup export and import
- Sample profile that loads the demo case in one tap

Out of scope: chatbot, diagnosis, reminders, lab value trends, multi-device sync, multi-caregiver roles, emergency card, doctor dashboards, ABHA or hospital integrations.

## 4. Tech stack (all free)

| Layer | Choice |
| --- | --- |
| App | Vite, React, TypeScript, React Router, Tailwind CSS, Motion for React (`motion`), `lucide-react`, installable PWA (`vite-plugin-pwa`) |
| Fonts | Manrope (headings) and Inter (body), self-hosted through `@fontsource` |
| Local records | Dexie over IndexedDB |
| Rules engine | Pure TypeScript, Vitest |
| On-device reading | PaddleOCR.js (`@paddleocr/paddleocr-js`, PP-OCRv5, `onnxruntime-web`) with `tesseract.js` as fallback; `pdfjs-dist` for text PDFs |
| Cloud reading | Gemini API on the free tier, JSON-schema output, called only from the server |
| Drug reference | JSON table bundled with the app |
| Gmail import | Google Identity Services token model, `gmail.readonly`, OAuth app left in Testing status |
| Sharing | Web Crypto AES-GCM, key in the URL fragment, `qrcode` |
| Server | Node with Hono: two API endpoints plus static file serving |
| Share store | One Supabase Postgres table (free plan) |
| Hosting | Deployxa, deployed from the GitHub `main` branch |
| Validation | `zod` for anything that crosses a boundary |

Install current stable versions. Before using any library API, check its current documentation; do not rely on memory for package APIs.

Known free-tier catches: Supabase pauses a project after 7 days without a database request (add a scheduled GitHub Actions ping). Gemini free-tier content may be used by Google, so only synthetic documents go through it. Deployxa free plan: 3 projects, 512 MB RAM, 1 GB storage.

## 5. Architecture

```
PHONE BROWSER
  React UI (src/ui)  --calls-->  CareVaultServices (src/contract/services.ts)
                                     |
                 mock implementation (src/ui/mock)   used while building the UI
                 real implementation (src/core)      Dexie + rules + reading
SERVER (server/, on Deployxa)
  POST /api/extract        -> Gemini API (key in env)
  POST /api/share          -> Supabase table "shares" (ciphertext only)
  GET  /api/share/:id
  DELETE /api/share/:id
  static files (the built app)
OUTSIDE
  Gmail API (called from the browser with a short-lived token)
```

The UI never imports from `src/core`. The core never imports from `src/ui`. Both import only from `src/contract`. `src/services/index.ts` picks the implementation:

```ts
// src/services/index.ts  (frozen after Phase 0)
import type { CareVaultServices } from '../contract/services';
import { createMockServices } from '../ui/mock/createMockServices';
import { createRealServices } from '../core/createRealServices';

export const services: CareVaultServices =
  import.meta.env.VITE_USE_MOCK === 'true' ? createMockServices() : createRealServices();
```

## 6. Repository layout and file ownership

```
carevault/
├─ docs/
│  ├─ specs/
│  │  ├─ 00-overview.spec.md
│  │  ├─ 01-core.spec.md
│  │  └─ 02-ui.spec.md
│  ├─ prompts/
│  │  ├─ core.prompt.md
│  │  └─ ui.prompt.md
│  ├─ design/                  five PNG mockups (reference for the UI)
│  ├─ screenshots/             UI owns (final screenshots for the project page)
│  ├─ progress-core.md         written by the core side after each phase
│  ├─ progress-ui.md           written by the UI side after each phase
│  ├─ contract-requests-core.md
│  └─ contract-requests-ui.md
├─ src/
│  ├─ contract/                FROZEN after Phase 0
│  │  ├─ types.ts
│  │  ├─ services.ts
│  │  └─ fixtures/sampleCase.ts
│  ├─ services/index.ts        FROZEN after Phase 0
│  ├─ core/                    CORE owns
│  │  ├─ createRealServices.ts
│  │  ├─ db/  rules/  reading/  drugref/  share/  gmail/  backup/
│  ├─ ui/                      UI owns
│  │  ├─ app/  components/  screens/  hooks/  styles/  mock/
│  └─ main.tsx                 UI owns
├─ server/                     CORE owns
├─ public/
│  ├─ sample-docs/             CORE owns (synthetic prescriptions and reports)
│  └─ (everything else)        UI owns (icons, manifest assets)
├─ index.html                  UI owns
├─ .github/workflows/          CORE owns (ci.yml is created in Phase 0; core adds keepalive.yml)
├─ package.json, tsconfig*.json, vite.config.ts, .env.example, .gitignore   FROZEN after Phase 0
└─ README.md                   UI owns (final write-up); CORE adds a "Running the server" section by request
```

Ownership rules:

- Never edit a file the other side owns. Never edit a frozen file.
- All dependencies for both sides are installed in Phase 0, so `package.json` does not change afterwards.
- If you need a change to a frozen file or to the contract, stop. Write the request in your `docs/contract-requests-<side>.md` and tell the human. The human applies agreed changes on `main` in one small commit, and both branches merge `main`.

## 7. Git workflow

Two GitHub accounts, one repository. The owner account creates the repo and adds the second account as a collaborator.

1. Phase 0 happens once, on `main`, on the UI laptop (laptop B). It creates the scaffold, the contract, the fixtures and the stubs. This is the only time the core laptop waits.
2. UI laptop: `git checkout -b feat/ui`. Core laptop: `git clone`, then `git checkout -b feat/core`.
3. After every phase: run `npm run check` (typecheck, tests, build), commit, `git push origin <branch>`.
4. When a side has finished its last build phase, it opens a pull request into `main`. Because of the ownership rules, the two pull requests touch different files and merge without conflicts. Either can merge first; the second runs `git merge origin/main` before merging.
5. Integration runs on a branch `integration` created from `main` after both merges. The core side goes first (switch to real services, fix mismatches inside `src/core`), then the UI side polishes.

Commit messages: `core: <what>` or `ui: <what>`.

## 8. The contract

Phase 0 creates these two files exactly as written here.

### 8.1 `src/contract/types.ts`

```ts
export type ID = string;            // crypto.randomUUID()
export type ISODate = string;       // 'YYYY-MM-DD'
export type ISODateTime = string;   // full ISO 8601

export interface Profile {
  id: ID;
  name: string;
  relation: string;                 // 'Father'
  birthYear: number | null;
  caregiverName: string;            // shown as "Prepared by"
  caregiverRelation: string;        // 'daughter'
  createdAt: ISODateTime;
}

export interface Prescriber {
  id: ID;
  profileId: ID;
  name: string;                     // 'Dr. Kavita Rao'
  specialty: string;                // 'Cardiology'
}

export type DoseUnit = 'mcg' | 'mg' | 'g' | 'ml' | 'IU';

export interface Ingredient {
  name: string;                     // normalized, lowercase: 'paracetamol'
  strength: number;                 // per dose unit (one tablet, one capsule)
  unit: DoseUnit;
}

export type MedicineForm = 'tablet' | 'capsule' | 'syrup' | 'other';

export type MedicineStatus =
  | 'found_at_home'        // scanned at home, not confirmed as taken
  | 'confirmed_current'    // caregiver confirmed the patient takes it
  | 'needs_confirmation'   // a question is open about it
  | 'stopped';             // caregiver marked it stopped or replaced

export type FieldState = 'extracted' | 'confirmed';

export interface Medicine {
  id: ID;
  profileId: ID;
  productName: string;              // 'Dolo 650'
  ingredients: Ingredient[];
  form: MedicineForm;
  dosesPerDay: number | null;       // dose units per day as entered; null = unknown
  instruction: string;              // '1 tablet, morning'
  prescriberId: ID | null;
  status: MedicineStatus;
  origin: 'home_scan' | 'prescription' | 'manual';
  sourceDocumentId: ID | null;
  fieldState: FieldState;
  replacedByMedicineId: ID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type MedicationEventType =
  | 'added' | 'confirmed' | 'strength_changed' | 'instruction_changed'
  | 'flagged_for_review' | 'marked_stopped' | 'replaced';

export interface MedicationEvent {
  id: ID;
  profileId: ID;
  medicineId: ID;
  type: MedicationEventType;
  at: ISODateTime;
  documentId: ID | null;
  detail: string;                   // human-readable, e.g. '5 mg to 10 mg'
}

export type DocumentType =
  | 'prescription' | 'lab_report' | 'test' | 'discharge_summary' | 'other';

export interface DocumentRecord {
  id: ID;
  profileId: ID;
  type: DocumentType;
  title: string;                    // 'Lipid profile'
  documentDate: ISODate;
  source: 'upload' | 'scan' | 'email';
  state: 'pending_confirmation' | 'confirmed';
  starred: boolean;
  prescriberId: ID | null;
  mimeType: string;
  sha256: string;                   // for exact-duplicate detection
  addedAt: ISODateTime;
}

export interface PrescriptionLine {
  id: ID;
  documentId: ID;
  productName: string;
  ingredients: Ingredient[];
  form: MedicineForm;
  dosesPerDay: number | null;
  instruction: string;
  fieldState: FieldState;
}

export type ReviewKind =
  | 'confirm_medicine' | 'possible_duplicate' | 'unclear_extraction' | 'new_document';

export type ReviewResolution =
  | 'still_taking' | 'stopped' | 'ask_doctor' | 'only_one' | 'added' | 'dismissed';

export interface ReviewItem {
  id: ID;
  profileId: ID;
  kind: ReviewKind;
  title: string;
  body: string;
  medicineIds: ID[];
  documentId: ID | null;
  createdAt: ISODateTime;
  resolvedAt: ISODateTime | null;
  resolution: ReviewResolution | null;
}

export interface Question {
  id: ID;
  text: string;
  source: 'review' | 'manual';
}

export interface Visit {
  id: ID;
  profileId: ID;
  prescriberId: ID;
  at: ISODateTime;
  questions: Question[];
  sharedDocumentIds: ID[];
}

export interface IngredientTotal {
  ingredient: string;
  unit: DoseUnit;
  perDay: number;                   // sum over parts, in `unit`
  parts: { medicineId: ID; productName: string; perDay: number }[];
  complete: boolean;                // false if any part has dosesPerDay = null
}

export type DiffKind = 'added' | 'changed' | 'unchanged' | 'review';

export interface PrescriptionDiffRow {
  kind: DiffKind;
  previous: PrescriptionLine | null;
  latest: PrescriptionLine | null;
  note: string;
  reviewItemId: ID | null;
}

export interface PrescriptionDiff {
  prescriberId: ID;
  previousDocumentId: ID | null;
  latestDocumentId: ID;
  rows: PrescriptionDiffRow[];
}

export interface ChangeSummary {
  since: ISODate;                   // date of the last prescription from the next visit's prescriber
  added: number;
  changed: number;
  toConfirm: number;
  newDocuments: number;
}

export interface Passport {
  patientName: string;
  patientAge: number | null;
  preparedBy: string;               // 'Anjali Iyer, daughter'
  preparedOn: ISODate;
  visitAt: ISODateTime | null;
  prescriberName: string | null;
  prescriberSpecialty: string | null;
  currentMedicines: {
    productName: string; instruction: string; prescriberName: string | null;
  }[];
  changesSince: ISODate | null;
  changes: { kind: 'added' | 'changed' | 'unconfirmed'; text: string }[];
  flags: string[];
  documents: { title: string; documentDate: ISODate }[];
  questions: string[];
}

export interface ExtractedLine {
  productName: string;
  ingredients: Ingredient[];
  form: MedicineForm;
  dosesPerDay: number | null;
  instruction: string;
  warnings: string[];               // e.g. 'Strength not found in drug reference'
}

export interface ExtractionCandidate {
  documentType: DocumentType;
  documentDate: ISODate | null;
  prescriberName: string | null;
  lines: ExtractedLine[];
  engine: 'on_device' | 'cloud';
  rawText: string;
  needsCloud: boolean;              // true when on-device reading was too poor to use
}

export interface ShareLink {
  id: ID;
  url: string;                      // https://<host>/share/<id>#<key>
  expiresAt: ISODateTime;
  revoked: boolean;
}

export interface GmailCandidate {
  messageId: string;
  subject: string;
  from: string;
  date: ISODate;
  attachmentName: string;
}

export class ServiceError extends Error {
  constructor(
    public code:
      | 'not_found' | 'cloud_consent_required' | 'network' | 'expired'
      | 'revoked' | 'bad_passphrase' | 'unsupported_file' | 'unknown',
    message: string,
  ) { super(message); }
}
```

### 8.2 `src/contract/services.ts`

```ts
import type * as T from './types';

export interface CareVaultServices {
  profiles: {
    list(): Promise<T.Profile[]>;
    create(input: Omit<T.Profile, 'id' | 'createdAt'>): Promise<T.Profile>;
    loadSampleProfile(): Promise<T.Profile>;      // seeds the demo case, idempotent
    prescribers(profileId: T.ID): Promise<T.Prescriber[]>;
  };
  medicines: {
    list(profileId: T.ID): Promise<T.Medicine[]>;
    get(id: T.ID): Promise<T.Medicine>;
    history(medicineId: T.ID): Promise<T.MedicationEvent[]>;
    addFromLine(profileId: T.ID, line: T.ExtractedLine,
      opts: { origin: T.Medicine['origin']; documentId: T.ID | null }): Promise<T.Medicine>;
    confirm(id: T.ID, patch?: Partial<Pick<T.Medicine,
      'productName' | 'ingredients' | 'form' | 'dosesPerDay' | 'instruction'>>): Promise<T.Medicine>;
    setStatus(id: T.ID, status: T.MedicineStatus): Promise<T.Medicine>;
    ingredientTotals(profileId: T.ID): Promise<T.IngredientTotal[]>;  // only ingredients in 2+ active medicines
  };
  reading: {
    read(file: Blob, opts: { allowCloud: boolean }): Promise<T.ExtractionCandidate>;
  };
  documents: {
    list(profileId: T.ID): Promise<T.DocumentRecord[]>;
    get(id: T.ID): Promise<T.DocumentRecord>;
    add(profileId: T.ID, file: Blob, meta: Pick<T.DocumentRecord,
      'type' | 'title' | 'documentDate' | 'source' | 'prescriberId'>):
      Promise<{ record: T.DocumentRecord; duplicateOf: T.ID | null }>;
    confirm(id: T.ID): Promise<T.DocumentRecord>;
    remove(id: T.ID): Promise<void>;
    star(id: T.ID, starred: boolean): Promise<T.DocumentRecord>;
    file(id: T.ID): Promise<Blob>;
    search(profileId: T.ID, text: string): Promise<T.DocumentRecord[]>;
  };
  prescriptions: {
    // Saves confirmed lines for a prescription document, updates medicines, creates review items.
    apply(profileId: T.ID, documentId: T.ID, prescriberId: T.ID,
      lines: T.ExtractedLine[]): Promise<T.PrescriptionDiff>;
    latestDiff(profileId: T.ID, prescriberId: T.ID): Promise<T.PrescriptionDiff | null>;
  };
  review: {
    listOpen(profileId: T.ID): Promise<T.ReviewItem[]>;
    resolve(id: T.ID, resolution: T.ReviewResolution,
      opts?: { keepMedicineId?: T.ID }): Promise<void>;
  };
  visits: {
    next(profileId: T.ID): Promise<T.Visit | null>;
    save(visit: Omit<T.Visit, 'id'> & { id?: T.ID }): Promise<T.Visit>;
    addQuestion(visitId: T.ID, text: string): Promise<T.Visit>;
    removeQuestion(visitId: T.ID, questionId: T.ID): Promise<T.Visit>;
    setSharedDocuments(visitId: T.ID, documentIds: T.ID[]): Promise<T.Visit>;
    changeSummary(profileId: T.ID): Promise<T.ChangeSummary | null>;
    buildPassport(profileId: T.ID): Promise<T.Passport>;
  };
  sharing: {
    create(passport: T.Passport, hours: number): Promise<T.ShareLink>;
    list(): Promise<T.ShareLink[]>;
    revoke(id: T.ID): Promise<void>;
    open(id: T.ID, key: string): Promise<T.Passport>;   // used by the public /share/:id page
  };
  gmail: {
    connect(): Promise<void>;                            // opens Google consent
    findCandidates(): Promise<T.GmailCandidate[]>;
    importAttachment(profileId: T.ID, messageId: string): Promise<T.DocumentRecord>;
  };
  backup: {
    export(passphrase: string): Promise<Blob>;
    import(file: Blob, passphrase: string): Promise<void>;
  };
  settings: {
    get(): Promise<{ cloudReadingAllowed: boolean }>;
    setCloudReadingAllowed(value: boolean): Promise<void>;
  };
  // Fires after any write. The UI re-runs its queries.
  subscribe(listener: () => void): () => void;
}
```

Every method rejects with `ServiceError` on failure. `reading.read` rejects with code `cloud_consent_required` when on-device reading is too poor and `allowCloud` is false.

## 9. Behaviour rules (deterministic)

Active medicine = status `found_at_home`, `confirmed_current` or `needs_confirmation`.

Status changes:

| Event | Result |
| --- | --- |
| Medicine added from a home scan | `found_at_home`, event `added` |
| Caregiver confirms a medicine | `confirmed_current`, `fieldState: 'confirmed'`, event `confirmed` |
| Prescription applied, line is new for that prescriber | New medicine `confirmed_current`, event `added` |
| Prescription applied, same ingredient set, strength or doses differ | Old medicine `stopped` with `replacedByMedicineId`, event `replaced`; new medicine `confirmed_current`, event `strength_changed` or `instruction_changed` |
| Prescription applied, line identical to previous | No change |
| Medicine was on the previous prescription from the same prescriber and is absent from the new one | `needs_confirmation`, event `flagged_for_review`, one `confirm_medicine` review item. Never `stopped` automatically. |
| Medicines from other prescribers | Never touched by this comparison |
| Review resolved `still_taking` | `confirmed_current` |
| Review resolved `stopped` | `stopped`, event `marked_stopped` |
| Review resolved `ask_doctor` | Status unchanged; a question is added to the next visit; the item counts as resolved in the inbox but appears on the passport as unconfirmed |

Matching: two lines are the same medicine when their sets of normalized ingredient names are equal. Brand names are never used for matching.

Duplicates: for each normalized ingredient that appears in two or more active medicines, create one `possible_duplicate` review item (do not create a second one for the same set of medicines). `perDay = strength x dosesPerDay`, converted to a common unit (1 g = 1000 mg, 1 mg = 1000 mcg). If any `dosesPerDay` is null, `complete` is false and the UI shows the parts without a total. The app does not compare totals with any limit.

Change summary: `since` is the date of the latest prescription from the next visit's prescriber. Counts come from that prescription's diff plus documents added on or after that date, excluding the prescription itself.

## 10. The sample case (fixtures and golden test)

`src/contract/fixtures/sampleCase.ts` exports this data and the expected results. The mock serves it; the core seeds it and must reproduce the expected results in a test. "Today" in the sample is 2026-11-14.

Profile: Ramesh Iyer, relation Father, birthYear 1955, caregiver Anjali Iyer, daughter.

Prescribers: Dr. Kavita Rao (Cardiology), Dr. Suresh Menon (Diabetology).

| Prescription | Date | Lines |
| --- | --- | --- |
| Rao, previous | 2026-08-05 | Amlodipine 5 mg, 1/day, "1 tablet, morning" · Telmisartan 40 mg, 1/day, "1 tablet, morning" · Atorvastatin 10 mg, 1/day, "1 tablet, night" |
| Rao, latest | 2026-10-28 | Amlodipine 10 mg, 1/day, "1 tablet, morning" · Telmisartan 40 mg, 1/day, "1 tablet, morning" · Rosuvastatin 10 mg, 1/day, "1 tablet, night" |
| Menon | 2026-07-14 | Metformin 500 mg, 2/day, "1 tablet, twice a day" |

Home scan products: Dolo 650 (paracetamol 650 mg, 3/day), Crocin Advance 500 (paracetamol 500 mg, 3/day). Both `found_at_home`.

Earlier history: Pantoprazole 40 mg marked stopped on 2026-08-05.

Documents: Lipid profile (lab_report, 2026-11-12, upload, confirmed) · Cardiology prescription (2026-10-28, scan, confirmed) · ECG report (test, 2026-09-15, upload, confirmed) · HbA1c report (lab_report, 2026-11-12, email, pending_confirmation) · Cardiology prescription (2026-08-05, scan, confirmed) · Diabetes prescription (2026-07-14, scan, confirmed).

Next visit: 2026-11-18T10:30 local, Dr. Kavita Rao.

Expected results:

- Medicines: confirmed_current = Amlodipine 10 mg, Rosuvastatin 10 mg, Telmisartan 40 mg, Metformin 500 mg. needs_confirmation = Atorvastatin 10 mg. found_at_home = Dolo 650, Crocin Advance 500. stopped = Amlodipine 5 mg (replaced), Pantoprazole 40 mg.
- Diff Rao 2026-08-05 to 2026-10-28: added Rosuvastatin; changed Amlodipine 5 mg to 10 mg; unchanged Telmisartan; review Atorvastatin.
- Ingredient totals: paracetamol 3450 mg/day = 1950 + 1500, complete.
- Open review items: 3 (confirm Atorvastatin; possible duplicate paracetamol; new document HbA1c).
- Change summary: since 2026-10-28, added 1, changed 1, toConfirm 1, newDocuments 2.
- Questions on the visit: "Does Rosuvastatin replace Atorvastatin, or should he take both?" and "Can he use Dolo 650 and Crocin Advance on the same day? Both contain paracetamol."

## 11. UI summary (detail in `02-ui.spec.md`)

Four sections: Review (home), Medicines, Records, Visit. Profile switcher at the top. Desktop uses a top navigation bar; phones use a bottom tab bar. The five PNG files in `docs/design/` are the visual reference: same layout, colours, type and wording.

Routes: `/` · `/medicines` · `/medicines/scan` · `/medicines/:id` · `/records` · `/records/:id` · `/visit` · `/visit/passport` · `/settings` · `/welcome` · `/share/:id` (public, no navigation).

## 12. Server API (detail in `01-core.spec.md`)

| Method and path | Body | Returns |
| --- | --- | --- |
| POST `/api/extract` | `{ imageBase64, mimeType }` | `ExtractionCandidate` fields with `engine: 'cloud'` |
| POST `/api/share` | `{ ciphertext, iv, expiresAt }` | `{ id, revokeToken }` |
| GET `/api/share/:id` | none | `{ ciphertext, iv }`, or 404, or 410 when expired or revoked |
| DELETE `/api/share/:id` | header `x-revoke-token` | 204 |

Environment variables (`.env.example`): `GEMINI_API_KEY`, `GEMINI_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_USE_MOCK`, `PORT`. Never commit real values.

## 13. Definition of done

- `npm run check` passes: typecheck, all tests, production build.
- With `VITE_USE_MOCK=false`, "Try the sample profile" produces every expected result in section 10 on screen.
- The demo path works on a phone browser: scan a pack, confirm, see a duplicate flag, upload a prescription, see the comparison, answer a review item, open the passport, share by QR, open the link on a second device, revoke it.
- Deployed on Deployxa from `main`, public GitHub repo, README explains what it is and how to run it.

## 14. Open decisions for the humans

- Demo country is assumed to be India (Indian brand names in the drug reference). Change the drug table if this changes.
- The OCR library is chosen in core Phase 4 after a test on real packs. Until then the UI treats reading as a service that may be slow or may ask for cloud consent.
