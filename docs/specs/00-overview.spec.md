# CareVault v2: overall build spec

Read this file first on both laptops. It replaces the v1 build documents and is self-contained. The product vision and the discussion behind these decisions are kept by the team in `docs/Audit.md`. Where this file and the brief in `docs/Audit.md` disagree, this file wins: it is the agreed, buildable version.

The two part specs add detail: `01-core.spec.md` for laptop A, `02-ui.spec.md` for laptop B. Where they disagree with this file, this file wins.

## 1. What CareVault v2 is

A family health passport. A patient, or a caregiver acting for one, keeps medical records, the medicines the patient actually takes, and the information a doctor needs at a visit, in one place on their own device.

The central journey:

```
Collect a record → read it on the device → the user verifies what matters
   → file it (records, timeline, search)
   → if it is a prescription: show what differs from the current routine
   → the user decides what actually changed → the routine updates
   → before a visit: freeze a passport snapshot → print it or share it by QR
```

The demonstration that proves v2 works (the "first release story"):

1. A caregiver saves a new prescription, even though one strength on it is unreadable.
2. They check that value against the original and correct it.
3. They review what the prescription changes and update exactly one medicine; they skip a question and nothing changes.
4. They find the latest lipid profile by searching.
5. They prepare a passport whose printed page and QR code show the same patient at the same moment.
6. A second profile, a later routine edit and a backup restore do not break any of the above.

## 2. Principles (apply to every line of code and copy)

- **AI extracts and organizes. People verify and decide. Doctors make clinical decisions.**
- **Saving a prescription never changes the routine.** The routine changes only through choices the user makes. Being prescribed a medicine is not the same as taking it.
- **A missing medicine is never stopped automatically.** It is not even asked about unless the same doctor prescribed it.
- **No unverified critical value reaches the routine or the passport.** Critical fields: medicine name, ingredient, strength, unit, frequency, instruction, document date, patient name.
- **The original file is always kept** and shown beside extracted values.
- **All arithmetic, matching and state changes are deterministic TypeScript under test.** No model output is used as a number without user verification.
- **Copy says "possible" and "please verify with a pharmacist or the prescriber".** Never "safe", "unsafe", "overdose", "you should", "interchangeable".
- **Local first.** Records live in the browser (IndexedDB). Data leaves the device only in three explicit cases: cloud reading of one document (per-document consent), Gmail import (browser token), and sharing a passport (encrypted on the device first).
- **All demo data is synthetic.**
- **No assistant attribution.** Commits, pull requests and files carry no AI co-author line, no "Generated with" line and no mention of an AI assistant. Commits use the human's git identity only.

## 3. Scope of v2

In scope, in build order:

1. Records vault: upload, camera and Gmail ingestion through one pipeline; original kept; classification (kind, tags, test names, facility); clinical date separate from date added; duplicates; search; timeline.
2. Field-level verification of critical fields, with the original beside them.
3. The reported routine: manual entry, edits, history, undo; allergies and relevant history.
4. Contextual prescription review: differences between a saved prescription and the routine, decided by the user.
5. Passport: live view, snapshots, print, PDF, QR share bound to a snapshot.
6. "Ask CareVault": deterministic, local retrieval over the user's own records.
7. Deployment.

Optional, only after the first release story passes at the merge checkpoint: encrypted original attachments in shares; an assistant service with evidence-graded medicine comparison.

Out of scope for v2: LLM-generated answers, background Gmail sync, lab-value extraction and trends, imaging interpretation, drawing source regions on the original, automated substitutions, reminders, multi-device sync, caregiver accounts and logins, ABHA or hospital integrations.

## 4. Tech stack

Unchanged from v1, all already installed: Vite, React, TypeScript, React Router, Tailwind CSS, Motion, `lucide-react`, PWA, Dexie, Vitest, Tesseract.js, PaddleOCR.js, pdf.js, Gemini (server only), Hono, Supabase (share store), Google Identity Services, Web Crypto, `qrcode`, `zod`.

`package.json` stays frozen. If a dependency is truly needed, request it in `docs/contract-requests-<side>.md`. Before using any library API, read its current documentation.

## 5. Architecture

```
BROWSER
  Screens (src/ui) ──calls──▶ CareVaultServices v2 (src/contract/services.ts)
                                 ├─ mock implementation (src/ui/mock)    laptop B
                                 └─ real implementation (src/core)       laptop A
                                      reading/  OCR, PDF text, parser, field evidence
                                      drugref/  bundled reference with evidence levels
                                      rules/    pure: proposals, decisions, totals, passport, search
                                      db/       Dexie v2 + migration from v1
                                      share/ gmail/ backup/
SERVER (server/, Hono)
  POST /api/extract      one document page image → Gemini → fields (nothing stored)
  /api/share             encrypted snapshots, Supabase table "shares"
  GET  /api/health       liveness + one cheap share-store query
  static app with SPA fallback
```

The UI never imports from `src/core`; the core never imports from `src/ui`. Both import only from `src/contract`. `src/services/index.ts` picks the implementation with `VITE_USE_MOCK`, as in v1.

## 6. Ownership and git workflow

| Path | Owner |
| --- | --- |
| `src/contract/**` (types, services, fixtures, today helper) | Written once in Phase 0 by laptop A; frozen afterwards |
| `src/contract/legacy/**` (the v1 contract) | Frozen; deleted at the merge checkpoint |
| `src/core/**` (including `src/core/v2/createRealServicesV2.ts`), `server/**`, `public/sample-docs/**`, `.github/workflows/**` | Laptop A |
| `src/ui/**` (including `src/ui/mock/v2/createMockServicesV2.ts`), `src/main.tsx`, `index.html`, `public/*` except `sample-docs` | Laptop B |
| `package.json`, `tsconfig*.json`, `vite.config.ts`, `.env.example`, `.gitignore`, `src/services/index.ts` | Frozen; change only through a contract request |
| `docs/progress-core.md`, `docs/contract-requests-core.md` | Laptop A |
| `docs/progress-ui.md`, `docs/contract-requests-ui.md`, `docs/screenshots/**`, `README.md` | Laptop B |

Workflow:

1. **Phase 0 is done.** Laptop A wrote contract v2, fixtures v2 and the today helper on `main` (section 7), with a v2 compatibility mock and a v2 core stub so the build passes. Nobody waits: laptop B reviews it as its first step, on its own branch.
2. **Laptop A** works on `feature/core`, created from the Phase 0 commit. **Laptop B** creates `feature/ui` from the same commit.
3. **Each step** ends with `npm run check` (typecheck, tests, build), an entry in the side's progress file, a commit and a push of the branch.
4. **Neither side edits the other's files**, or the other side's tests and fixtures, to make a failure pass. A needed contract change stops work on that point: write it in `docs/contract-requests-<side>.md`, tell the human, and the human applies the agreed change on `main`; both branches then merge `main`.
5. **The merge checkpoint** (section 13) happens once both sides have finished their last step.

**v1 and v2 side by side until the merge.** The current app keeps running on contract v1 during the whole build, so nothing that works today breaks:

| | v1 (current app) | v2 (being built) |
| --- | --- | --- |
| Contract | `src/contract/legacy/` | `src/contract/` |
| Services | `services` from `src/services/index.ts` | `createServicesV2()` from `src/services/index.ts` |
| Mock | `src/ui/mock/createMockServices.ts` | `src/ui/mock/v2/createMockServicesV2.ts` (laptop B) |
| Real | `src/core/createRealServices.ts` | `src/core/v2/createRealServicesV2.ts` (laptop A) |

Rules:
- Build v2 in new modules, or in v1 modules whose v1 behaviour stays unchanged. The v1 tests keep passing until the merge checkpoint.
- Keep the two v2 export names: `createMockServicesV2` and `createRealServicesV2`. `src/services/index.ts` depends on them.
- `createServicesV2()` is a factory: call it once when the v2 app starts. The v1 and v2 databases must never be opened in the same page.
- Laptop B switches `src/main.tsx` to the v2 app when its v2 screens are ready.
- At the merge checkpoint, laptop A deletes `src/contract/legacy/`, the v1 mock and the v1 core, and makes `src/services/index.ts` export only v2.

Commit messages: `core: <what>` or `ui: <what>`. Pull request titles: "Core v2: …", "UI v2: …". No assistant attribution anywhere (section 2).

## 7. Phase 0 (done on `main` by laptop A)

What Phase 0 put on `main`:

1. `src/contract/types.ts`, `src/contract/services.ts` and `src/contract/today.ts`, copied from section 8, word for word.
2. `src/contract/fixtures/sampleCase.ts`: the v2 sample case of section 10, with fixed ids, `SAMPLE_TODAY`, `SAMPLE_PROFILE_IDS`, `SAMPLE_DOCUMENT_FILES` and `expected`. `sampleCase.test.ts` checks that it is internally consistent.
3. The v1 contract moved unchanged to `src/contract/legacy/`; every v1 import points there.
4. `src/ui/mock/v2/createMockServicesV2.ts`: a compatibility mock that serves the sample case with simple behaviour. Unmodelled methods are marked `TEMPORARY` and reject with `ServiceError('unknown', 'not built yet')`. Laptop B replaces it in UI step 1.
5. `src/core/v2/createRealServicesV2.ts`: every v2 method rejects with `ServiceError('unknown', 'not built yet')`. Laptop A replaces it step by step.
6. `src/services/index.ts` exports `services` (v1, temporary) and `createServicesV2()`.

`npm run check` passed on that commit. The v1 app and all v1 tests are unchanged.

## 8. The contract v2

### 8.1 `src/contract/types.ts`

```ts
export type ID = string;            // crypto.randomUUID()
export type ISODate = string;       // 'YYYY-MM-DD'
export type ISODateTime = string;   // full ISO 8601

// ---------- people ----------

export interface Profile {
  id: ID;
  name: string;
  relation: string;                 // 'Father', or 'Myself'
  birthYear: number | null;
  caregiverName: string;            // '' when the patient manages their own records
  caregiverRelation: string;        // 'daughter', or ''
  emergencyContact: string | null;
  createdAt: ISODateTime;
}

export interface Prescriber {
  id: ID;
  profileId: ID;
  name: string;                     // 'Dr. Kavita Rao'
  specialty: string;                // 'Cardiology', or ''
}

// ---------- medicines ----------

export type DoseUnit = 'mcg' | 'mg' | 'g' | 'ml' | 'IU';

export interface Ingredient {
  name: string;                     // normalized, lowercase: 'paracetamol'
  strength: number;                 // per dose unit
  unit: DoseUnit;
}

export type MedicineForm = 'tablet' | 'capsule' | 'syrup' | 'other';

/** What the patient reports, not what a prescription says. */
export type RoutineStatus =
  | 'taking'              // the user confirmed it is taken
  | 'not_started'         // prescribed, the user said it has not been started
  | 'uncertain'           // current use is not known: shown as unconfirmed, never as current
  | 'stopped';            // the user said it is no longer taken

export type RoutineSource =
  | 'patient_reported' | 'caregiver_reported' | 'from_prescription' | 'from_pack' | 'legacy';

export interface RoutineMedicine {
  id: ID;
  profileId: ID;
  productName: string;
  ingredients: Ingredient[];
  form: MedicineForm;
  dosesPerDay: number | null;       // null = unknown
  instruction: string;              // '1 tablet, morning'
  status: RoutineStatus;
  source: RoutineSource;
  prescriberId: ID | null;          // the doctor whose prescription this entry last came from
  sourceDocumentId: ID | null;
  replacedByMedicineId: ID | null;  // set when a changed dose created a new entry
  lastConfirmedAt: ISODateTime | null;
  legacyStatus: string | null;      // v1 status, kept for audit after migration
  legacyReviewPending: boolean;     // true until the user includes or excludes it in the batch review
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** The fields a routine entry is built from. */
export type RoutineMedicineInput = Pick<RoutineMedicine,
  'productName' | 'ingredients' | 'form' | 'dosesPerDay' | 'instruction'>;

export type RoutineEventType =
  | 'added' | 'confirmed' | 'changed' | 'not_started' | 'stopped' | 'restarted'
  | 'marked_uncertain' | 'replaced' | 'undone' | 'migrated';

export interface RoutineEvent {
  id: ID;
  profileId: ID;
  medicineId: ID;
  type: RoutineEventType;
  at: ISODateTime;
  documentId: ID | null;
  proposalId: ID | null;
  before: RoutineMedicine | null;   // the entry before this event; null when it was created
  after: RoutineMedicine | null;    // the entry after this event
  undoesEventId: ID | null;         // for 'undone'
  detail: string;                   // human-readable: '40 mg to 80 mg'
}

// ---------- allergies and history ----------

export type HealthEntryKind = 'allergy' | 'condition' | 'procedure' | 'note';

export interface HealthEntry {
  id: ID;
  profileId: ID;
  kind: HealthEntryKind;
  text: string;                     // 'Penicillin: rash'
  noneKnown: boolean;               // true only for the explicit "No known allergies" entry; text is then ''
  source: 'patient_reported' | 'caregiver_reported' | 'from_document';
  documentId: ID | null;
  recordedAt: ISODateTime;
}

// ---------- documents ----------

export type DocumentKind =
  | 'prescription' | 'lab_report' | 'imaging' | 'test' | 'discharge_summary'
  | 'consultation' | 'certificate' | 'other';

export type DateSource = 'document' | 'email_received' | 'user' | 'unknown';

export interface DocumentRecord {
  id: ID;
  profileId: ID;
  kind: DocumentKind;
  title: string;                    // 'Lipid profile'
  clinicalDate: ISODate | null;     // the date on the document; null when not known
  dateSource: DateSource;
  addedAt: ISODateTime;             // when it entered CareVault
  receivedAt: ISODateTime | null;   // email receipt time, for email imports
  source: 'camera' | 'upload' | 'email';
  state: 'pending_review' | 'filed';
  starred: boolean;
  prescriberId: ID | null;
  facility: string | null;          // lab or hospital name, as printed
  tags: string[];                   // lowercase labels: ['cardiology', 'blood test']
  testNames: string[];              // ['Lipid profile', 'HbA1c']
  patientNameRead: string | null;   // the patient name found on the document, if any
  patientMatch: 'match' | 'mismatch' | 'not_found';
  mimeType: string;
  sha256: string;
  pageCount: number | null;
  pagesRead: number | null;         // pages actually processed; may be less than pageCount
}

export interface DuplicateInfo {
  existingId: ID;
  existingTitle: string;
  existingAddedAt: ISODateTime;
  exact: true;                      // v2 detects exact (hash) duplicates only
}

// ---------- reading and verification ----------

export type CriticalField =
  | 'medicine_name' | 'ingredient' | 'strength' | 'unit' | 'frequency' | 'instruction'
  | 'document_date' | 'patient_name';

export type FieldStatus =
  | 'extracted'             // read automatically, looks consistent, not yet reviewed
  | 'needs_verification'    // read automatically and flagged: low confidence, malformed, reference mismatch
  | 'user_corrected'        // the user changed the value
  | 'user_confirmed'        // the user reviewed the value and kept it
  | 'unknown';              // the user chose to leave it unknown

export interface FieldEvidence {
  id: ID;
  profileId: ID;
  documentId: ID;
  field: CriticalField;
  lineIndex: number | null;         // which medicine line; null for document-level fields
  ingredientIndex: number | null;   // which ingredient within the line
  page: number | null;              // 1-based page the value was read from
  raw: string | null;               // the literal text read, e.g. '6?0 mg'
  value: string | null;             // the current value: proposed, corrected or confirmed
  status: FieldStatus;
  reasons: string[];                // why it needs verification: 'Unclear digit', 'Missing unit'
  source: 'pdf_text' | 'ocr' | 'cloud' | 'user';
  confidence: number | null;        // 0 to 1, from OCR, when available
  region: { x: number; y: number; width: number; height: number } | null; // page pixels, optional
  reviewedAt: ISODateTime | null;
}

export interface FieldDecision {
  evidenceId: ID;
  action: 'confirm' | 'correct' | 'leave_unknown';
  value?: string;                   // required for 'correct'
}

export interface ExtractedLine {
  lineIndex: number;
  productName: string;
  ingredients: Ingredient[];
  form: MedicineForm;
  dosesPerDay: number | null;
  instruction: string;
  warnings: string[];
}

export interface ExtractionCandidate {
  documentId: ID;
  kind: DocumentKind;
  title: string;                    // a suggested title
  clinicalDate: ISODate | null;
  prescriberName: string | null;
  facility: string | null;
  patientNameRead: string | null;
  patientMatch: 'match' | 'mismatch' | 'not_found';
  tags: string[];
  testNames: string[];
  lines: ExtractedLine[];
  fields: FieldEvidence[];          // evidence for every critical field found
  engine: 'pdf_text' | 'on_device' | 'cloud';
  rawText: string;
  pageCount: number | null;
  pagesRead: number | null;
  needsCloud: boolean;
}

// ---------- prescriptions and contextual review ----------

export interface PrescriptionLine {
  id: ID;
  documentId: ID;
  lineIndex: number;
  productName: string;
  ingredients: Ingredient[];
  form: MedicineForm;
  dosesPerDay: number | null;
  instruction: string;
  verified: boolean;                // every critical field of the line is user_confirmed or user_corrected
}

export type ProposalRowKind = 'new' | 'changed' | 'same' | 'not_mentioned' | 'uncertain_match';

export type ProposalChoice =
  // changed
  | 'started_new' | 'kept_previous'
  // new
  | 'started' | 'not_started'
  // not_mentioned
  | 'still_taking'
  // uncertain_match
  | 'same_medicine' | 'different_medicine'
  // shared
  | 'not_taking' | 'ask_doctor' | 'skip';

export interface ProposalRow {
  id: ID;
  kind: ProposalRowKind;
  line: PrescriptionLine | null;    // null for not_mentioned
  medicine: RoutineMedicine | null; // null for new
  asked: boolean;                   // false for 'same' and for passive not_mentioned rows
  blockedByVerification: boolean;   // true while the line has unverified critical fields
  choices: ProposalChoice[];        // the choices allowed for this row (section 9.3)
  decision: ProposalChoice | null;
  decidedAt: ISODateTime | null;
  note: string;                     // '40 mg to 80 mg', 'Not on this prescription'
}

export interface RoutineProposal {
  id: ID;
  profileId: ID;
  documentId: ID;
  prescriberId: ID | null;
  createdAt: ISODateTime;
  routineRevision: number;          // the routine revision the rows were computed against
  rows: ProposalRow[];
  passiveNotMentionedCount: number; // routine entries not on this prescription and not asked about
  status: 'open' | 'reviewed' | 'dismissed';
}

export interface RowDecision {
  rowId: ID;
  choice: ProposalChoice;
}

// ---------- totals, attention ----------

export interface IngredientTotal {
  ingredient: string;
  unit: DoseUnit;
  perDay: number;                   // 0 when complete is false
  parts: { medicineId: ID; productName: string; perDay: number }[];
  complete: boolean;
}

export type AttentionKind =
  | 'unverified_fields'             // a document has fields needing verification
  | 'unassigned_import'             // an email import whose patient did not match
  | 'possible_duplicate_ingredient'
  | 'legacy_routine_review';        // migrated medicines waiting for the batch review

export interface AttentionItem {
  id: ID;                           // stable for the same underlying condition
  kind: AttentionKind;
  title: string;
  body: string;
  documentId: ID | null;
  medicineIds: ID[];
}

// ---------- visits and questions ----------

export interface Question {
  id: ID;
  text: string;
  source: 'review' | 'manual';
  medicineId: ID | null;
  documentId: ID | null;
}

export interface Visit {
  id: ID;
  profileId: ID;
  prescriberId: ID;
  at: ISODateTime;
  questions: Question[];
  sharedDocumentIds: ID[];
}

// ---------- passport ----------

export interface Passport {
  profileId: ID;
  patientName: string;
  patientAge: number | null;
  emergencyContact: string | null;
  preparedBy: string;               // 'Anjali Iyer, daughter', or the patient's own name
  preparedOn: ISODate;
  visit: { at: ISODateTime; prescriberName: string; specialty: string } | null;
  currentMedicines: {
    productName: string; ingredientsText: string; instruction: string;
    prescriberName: string | null; source: RoutineSource; lastConfirmedOn: ISODate | null;
  }[];                              // status 'taking' only
  unconfirmed: { productName: string; reason: string }[]; // 'uncertain' and legacy-pending entries
  allergies: { state: 'listed' | 'none_known' | 'not_recorded'; items: string[] };
  conditions: string[];
  procedures: string[];
  recentChanges: { kind: 'started' | 'changed' | 'stopped' | 'not_started'; text: string; on: ISODate }[];
  flags: string[];                  // possible duplicate ingredients, worded as in section 9.5
  documents: SnapshotDocument[];
  questions: string[];
}

export interface SnapshotDocument {
  documentId: ID;
  title: string;
  kind: DocumentKind;
  clinicalDate: ISODate | null;
  sha256: string;
  removedAt: ISODateTime | null;    // set when the original was deleted after the snapshot
}

export interface PassportSnapshot {
  id: ID;
  profileId: ID;
  createdAt: ISODateTime;
  reason: 'manual' | 'print' | 'share';
  passport: Passport;               // frozen; never regenerated
  revision: number;                 // 1, 2, 3 … per profile
}

// ---------- sharing ----------

export interface ShareLink {
  id: ID;
  profileId: ID | null;             // null only for v1 links whose owner cannot be proven
  snapshotId: ID | null;            // null only for v1 links
  url: string;                      // https://<host>/share/<id>#<key>
  createdAt: ISODateTime | null;
  expiresAt: ISODateTime;
  revoked: boolean;
}

// ---------- search and ask ----------

export interface RecordQuery {
  text?: string;                    // matched against title, tags, test names, facility, doctor
  kinds?: DocumentKind[];
  tags?: string[];
  testName?: string;
  prescriberId?: ID;
  facility?: string;
  from?: ISODate;                   // on clinicalDate
  to?: ISODate;
  starredOnly?: boolean;
  sort?: 'newest' | 'oldest';       // default newest; undated records come after dated ones
  limit?: number;
}

export interface RecordHit {
  document: DocumentRecord;
  matchedOn: string[];              // ['test name', 'doctor']
}

export interface AskAnswer {
  understood: boolean;
  kind: 'documents' | 'questions' | 'routine' | 'not_understood';
  interpretedAs: string;            // 'Latest lab report with test "Lipid profile"'
  query: RecordQuery | null;
  documents: RecordHit[];
  questions: Question[];
  medicines: RoutineMedicine[];
  text: string;                     // a short, factual sentence; never advice
}

// ---------- Gmail ----------

export interface GmailCandidate {
  messageId: string;
  attachmentId: string;
  subject: string;
  from: string;
  receivedAt: ISODateTime;
  attachmentName: string;
  alreadyImported: boolean;         // for this profile
}

// ---------- errors ----------

export class ServiceError extends Error {
  constructor(
    public code:
      | 'not_found' | 'cloud_consent_required' | 'network' | 'expired' | 'revoked'
      | 'bad_passphrase' | 'unsupported_file' | 'locked_pdf' | 'not_configured'
      | 'verification_required' | 'stale' | 'unknown',
    message: string,
  ) { super(message); }
}
```

Error code meanings, in caregiver-ready words that the UI may show as they are:

| Code | When |
| --- | --- |
| `not_found` | the id is not on this device, or the shared link does not exist |
| `cloud_consent_required` | reading on the device was not good enough and cloud reading was not allowed |
| `network` | the server or Google could not be reached |
| `expired`, `revoked` | shared link |
| `bad_passphrase` | backup |
| `unsupported_file` | not a photo or a PDF, or empty |
| `locked_pdf` | a password-protected PDF; the original is kept, nothing is read |
| `not_configured` | a server feature (sharing, cloud reading, Gmail) is not set up on this copy |
| `verification_required` | a choice would write an unverified critical value to the routine |
| `stale` | the routine changed since the proposal was computed; the message says what changed |
| `unknown` | anything else, with a readable message |

### 8.2 `src/contract/services.ts`

```ts
import type * as T from './types';

export interface CareVaultServices {
  profiles: {
    list(): Promise<T.Profile[]>;
    create(input: Omit<T.Profile, 'id' | 'createdAt'>): Promise<T.Profile>;
    update(id: T.ID, patch: Partial<Omit<T.Profile, 'id' | 'createdAt'>>): Promise<T.Profile>;
    loadSampleProfile(): Promise<T.Profile>;            // seeds both sample profiles, idempotent
    prescribers(profileId: T.ID): Promise<T.Prescriber[]>;
    // Returns the existing prescriber when the name matches case-insensitively.
    addPrescriber(profileId: T.ID, input: { name: string; specialty: string }): Promise<T.Prescriber>;
  };

  documents: {
    // Stores the original first, as 'pending_review'. Reading happens afterwards.
    add(profileId: T.ID, file: Blob, meta: { source: T.DocumentRecord['source']; title?: string }):
      Promise<{ record: T.DocumentRecord; duplicate: T.DuplicateInfo | null }>;
    get(id: T.ID): Promise<T.DocumentRecord>;
    list(profileId: T.ID): Promise<T.DocumentRecord[]>;           // newest clinical date first, undated last
    update(id: T.ID, patch: Partial<Pick<T.DocumentRecord,
      'kind' | 'title' | 'clinicalDate' | 'prescriberId' | 'facility' | 'tags' | 'testNames' | 'starred'>>):
      Promise<T.DocumentRecord>;                                   // clinicalDate set here makes dateSource 'user'
    file(id: T.ID): Promise<T.DocumentRecord & { blob: Blob }>;    // also works for the shipped sample documents
    fileRecord(id: T.ID): Promise<T.DocumentRecord>;               // marks it 'filed'
    remove(id: T.ID): Promise<{ snapshotsMentioning: T.ID[]; activeShares: T.ShareLink[] }>;
    assignProfile(id: T.ID, profileId: T.ID): Promise<T.DocumentRecord>;  // for unassigned email imports
    fields(id: T.ID): Promise<T.FieldEvidence[]>;
    reviewFields(id: T.ID, decisions: T.FieldDecision[]): Promise<T.FieldEvidence[]>;
  };

  reading: {
    // Reads a stored document. Never stores routine changes. Human field decisions are kept on re-read.
    read(documentId: T.ID, opts: { allowCloud: boolean }): Promise<T.ExtractionCandidate>;
  };

  prescriptions: {
    // Stores the prescription lines. Never changes the routine. Returns the proposal,
    // or null when nothing differs from the routine.
    save(documentId: T.ID, prescriberId: T.ID, lines: T.ExtractedLine[]):
      Promise<{ lines: T.PrescriptionLine[]; proposal: T.RoutineProposal | null }>;
    lines(documentId: T.ID): Promise<T.PrescriptionLine[]>;
  };

  routine: {
    list(profileId: T.ID): Promise<T.RoutineMedicine[]>;
    get(id: T.ID): Promise<T.RoutineMedicine>;
    history(medicineId: T.ID): Promise<T.RoutineEvent[]>;
    profileHistory(profileId: T.ID): Promise<T.RoutineEvent[]>;
    revision(profileId: T.ID): Promise<number>;
    add(profileId: T.ID, input: T.RoutineMedicineInput,
      opts: { status: 'taking' | 'uncertain'; source: T.RoutineSource; documentId: T.ID | null }):
      Promise<T.RoutineMedicine>;
    update(id: T.ID, patch: Partial<T.RoutineMedicineInput>): Promise<T.RoutineMedicine>;
    setStatus(id: T.ID, status: T.RoutineStatus): Promise<T.RoutineMedicine>;
    undo(eventId: T.ID): Promise<T.RoutineMedicine>;
    // Contextual review
    proposalFor(documentId: T.ID): Promise<T.RoutineProposal | null>;  // recomputed if the routine changed
    decide(proposalId: T.ID, decisions: T.RowDecision[], expectedRevision: number):
      Promise<{ proposal: T.RoutineProposal; changed: T.RoutineMedicine[]; questionsAdded: T.Question[] }>;
    dismiss(proposalId: T.ID): Promise<T.RoutineProposal>;
    // Batch review of migrated (legacy) entries
    resolveLegacy(profileId: T.ID, takingIds: T.ID[], notTakingIds: T.ID[]): Promise<T.RoutineMedicine[]>;
    ingredientTotals(profileId: T.ID): Promise<T.IngredientTotal[]>;
  };

  health: {
    list(profileId: T.ID): Promise<T.HealthEntry[]>;
    add(profileId: T.ID, input: Omit<T.HealthEntry, 'id' | 'profileId' | 'recordedAt'>): Promise<T.HealthEntry>;
    remove(id: T.ID): Promise<void>;
  };

  attention: {
    list(profileId: T.ID): Promise<T.AttentionItem[]>;
  };

  records: {
    search(profileId: T.ID, query: T.RecordQuery): Promise<T.RecordHit[]>;
    ask(profileId: T.ID, question: string): Promise<T.AskAnswer>;
  };

  visits: {
    next(profileId: T.ID): Promise<T.Visit | null>;
    save(visit: Omit<T.Visit, 'id'> & { id?: T.ID }): Promise<T.Visit>;
    addQuestion(visitId: T.ID, text: string, link?: { medicineId?: T.ID; documentId?: T.ID }): Promise<T.Visit>;
    removeQuestion(visitId: T.ID, questionId: T.ID): Promise<T.Visit>;
    setSharedDocuments(visitId: T.ID, documentIds: T.ID[]): Promise<T.Visit>;
  };

  passport: {
    live(profileId: T.ID): Promise<T.Passport>;        // computed now, never stored
    snapshot(profileId: T.ID, reason: T.PassportSnapshot['reason']): Promise<T.PassportSnapshot>;
    // Reuses the latest snapshot when the live passport is identical to it.
    snapshots(profileId: T.ID): Promise<T.PassportSnapshot[]>;   // newest first
    getSnapshot(id: T.ID): Promise<T.PassportSnapshot>;
  };

  sharing: {
    create(snapshotId: T.ID, hours: number): Promise<T.ShareLink>;
    list(profileId: T.ID): Promise<T.ShareLink[]>;     // never returns another profile's links
    listUnowned(): Promise<T.ShareLink[]>;            // v1 links whose owner cannot be proven; Settings only
    revoke(id: T.ID): Promise<void>;
    open(id: T.ID, key: string): Promise<T.PassportSnapshot>;   // public /share/:id page
  };

  gmail: {
    connect(): Promise<void>;
    findCandidates(profileId: T.ID): Promise<T.GmailCandidate[]>;   // one row per PDF attachment
    importAttachment(profileId: T.ID, messageId: string, attachmentId: string):
      Promise<{ record: T.DocumentRecord; duplicate: T.DuplicateInfo | null }>;
  };

  backup: {
    export(passphrase: string): Promise<Blob>;
    import(file: Blob, passphrase: string): Promise<void>;          // reads v1 and v2 backups
  };

  settings: {
    get(): Promise<{ cloudReadingAllowed: boolean }>;
    setCloudReadingAllowed(value: boolean): Promise<void>;
  };

  subscribe(listener: () => void): () => void;
}
```

Every method rejects with `ServiceError` on failure. Every patient-scoped read and write is limited to one profile: no method returns another profile's data.

### 8.3 `src/contract/today.ts`

```ts
import { SAMPLE_PROFILE_IDS, SAMPLE_TODAY } from './fixtures/sampleCase';
import type { ID, ISODate } from './types';

/** "Today" for a profile. The sample profiles keep their own calendar so the demo never ages. */
export function todayFor(profileId: ID | null, deviceToday: ISODate): ISODate {
  return profileId !== null && (SAMPLE_PROFILE_IDS as readonly string[]).includes(profileId)
    ? SAMPLE_TODAY
    : deviceToday;
}
```

Both sides use it for every date shown or computed: date lines, ages, "next visit", the passport's "Prepared on".

## 9. Behaviour rules (deterministic)

### 9.1 Documents

- `documents.add` stores the original blob and a SHA-256 hash in one transaction **before** any reading, with state `pending_review`, `clinicalDate: null`, `dateSource: 'unknown'`. A reading failure never loses the original.
- **Exact duplicates:** a file whose hash matches a document of the same profile, from any source, returns `duplicate`. The UI offers *Use the existing record* (remove the new one), *Keep both*, *Cancel* (remove the new one). Documents of other profiles never count.
- **Dates:** `clinicalDate` comes only from the document text (day-first for numeric dates; manufacturing, expiry and birth dates are ignored) or from the user. Email receipt time is stored in `receivedAt`, never in `clinicalDate`. Undated records sort after dated ones and are shown in an "Undated" group.
- **Patient match:** compare the name read with the profile name, ignoring case, initials, titles ("Mr", "Smt") and word order. A `mismatch` never files the record on its own: for email imports it becomes an `unassigned_import` attention item until the user assigns a profile or removes the record.
- **Classification:** `kind`, `tags`, `testNames` and `facility` come from a deterministic keyword dictionary (core spec). A document may carry several tags. The user can edit all of them.
- **Locked PDFs:** stored, and `reading.read` rejects with `locked_pdf`. The record can still be filed by hand.
- **Pages:** text PDFs read every page. Scanned PDFs are OCR'd up to the page limit in the core spec; `pagesRead` and `pageCount` let the UI say "Read 2 of 5 pages".
- **Removing** a document deletes its file, its lines and its field evidence. It returns the snapshots that mention it (they keep their descriptor and get `removedAt`) and the active shares of those snapshots, so the UI can offer to revoke them.

### 9.2 Field verification

- Reading produces one `FieldEvidence` per critical field found, per page and line.
- A field becomes `needs_verification` when any of these holds; `reasons` says which:
  - OCR word confidence below the threshold in the core spec;
  - malformed value: a non-digit inside a number ("6?0"), a missing or unknown unit, an impossible date;
  - the product is in the drug reference and the strength disagrees with it;
  - the value came from the cloud reader (always reviewed);
  - the field is a strength, unit or frequency read by OCR (these always need a look, whatever the confidence).
- `reviewFields` applies `confirm` (→ `user_confirmed`), `correct` (→ `user_corrected`, new value) or `leave_unknown` (→ `unknown`). Re-reading a document keeps every human decision; it only adds or refreshes `extracted` and `needs_verification` evidence.
- A prescription line is `verified` when all its critical fields are `user_confirmed` or `user_corrected`. A field left `unknown` keeps the line unverified.
- **The gate:** a routine write that takes values from a line (`started`, `started_new`, `same_medicine` followed by a change, or `routine.add` with a `documentId`) is refused with `verification_required` while the line is unverified. Saving the document, filing it and recording a question are never blocked.

### 9.3 Contextual review

`prescriptions.save` stores the lines (no routine change) and computes a proposal against the profile's current routine (entries with status `taking`, `uncertain` or `not_started`):

| Row kind | When | Asked? | Choices |
| --- | --- | --- | --- |
| `new` | no routine entry has the same set of active ingredients | yes | `started`, `not_started`, `not_taking`, `ask_doctor`, `skip` |
| `changed` | same ingredients, different strength, doses per day, form or instruction | yes | `started_new`, `kept_previous`, `not_taking`, `ask_doctor`, `skip` |
| `same` | identical to a routine entry | no | none; listed as "No change" |
| `not_mentioned` | a routine entry missing from the prescription **whose `prescriberId` is this prescriber** | yes | `still_taking`, `not_taking`, `ask_doctor`, `skip` |
| (passive) | every other routine entry missing from the prescription | no | none; only `passiveNotMentionedCount` |
| `uncertain_match` | ingredients could not be determined for the line, or a brand matches a routine entry by name but the ingredients differ or are unknown | yes | `same_medicine`, `different_medicine`, `ask_doctor`, `skip` |

Matching is by the set of normalized active ingredients; brand names are never enough to call two medicines the same. Rows are ordered `changed`, `new`, `not_mentioned`, `uncertain_match`, `same`, each group in the order of the prescription's lines (`not_mentioned` by product name). If every row is `same` or passive, `save` returns `proposal: null` and the UI shows "No differences with the current routine".

Effects of each choice, all applied in one transaction by `routine.decide`, each with a `RoutineEvent` that records `before` and `after`:

| Choice | Effect on the routine |
| --- | --- |
| `started` | add the line as a routine entry: `taking`, source `from_prescription`, `lastConfirmedAt` now |
| `not_started` | add it with status `not_started` (kept for reference; never shown as current) |
| `started_new` | old entry → `stopped` with `replacedByMedicineId`; new entry from the line → `taking` |
| `kept_previous` | no change; `lastConfirmedAt` of the old entry set to now |
| `still_taking` | no change; `lastConfirmedAt` set to now |
| `not_taking` (changed or not_mentioned) | entry → `stopped` (the UI confirms first) |
| `not_taking` (new) | nothing added; the decision is recorded on the proposal |
| `ask_doctor` | no routine change; a question is added to the next visit if there is one; `changed` and `not_mentioned` entries become `uncertain` |
| `same_medicine` | the row becomes `changed` or `same` against that entry, and is offered again |
| `different_medicine` | the row becomes `new`, and is offered again |
| `skip` | nothing; the row stays undecided and is never turned into a reminder or attention item |

Further rules:
- **Stale protection:** `decide` takes `expectedRevision`. The routine revision is a per-profile counter that increases with every routine write. If it differs, `decide` rejects with `stale`, and `proposalFor` returns the recomputed proposal.
- **Idempotent:** deciding a row that already has the same decision changes nothing and writes no event. Saving the same prescription lines twice returns the same proposal and creates no events.
- **Reopen:** a dismissed or partly decided proposal is reopened from the document page with `proposalFor`. Nothing about a skipped or dismissed proposal reaches the home screen.
- **Undo:** `routine.undo(eventId)` restores the `before` state of that event and records an `undone` event. Undo is refused with `stale` if a later event changed the same entry; the UI then shows the history instead.

### 9.4 Routine, allergies and history

- `routine.add` without a document needs no verification (the user typed it) and gets source `patient_reported` or `caregiver_reported`.
- From a scanned pack: `routine.add` with source `from_pack` and the pack's `documentId`, behind the verification gate.
- `routine.setStatus` records the matching event. Setting the status an entry already has does nothing.
- Allergies: "not recorded" is the absence of allergy entries. "No known allergies" is one explicit entry with `noneKnown: true`. Adding a real allergy removes the `noneKnown` entry.
- The routine is never changed by importing, reading or filing a document.

### 9.5 Possible duplicate ingredients and totals

- Unchanged from v1 in method; it now applies to routine entries with status `taking` or `uncertain`. For every normalized ingredient in two or more of them, one `possible_duplicate_ingredient` attention item is listed.
- Totals: strength × doses per day, mass converted to one unit (g, mg, mcg); ml and IU are never added to mass. If any part has unknown doses per day, `complete` is false and no total is given. Totals are rounded to at most 3 decimals and never compared with any limit.
- Wording: "These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber."

### 9.6 Passport and snapshots

- `passport.live` builds from the routine, health entries, the next visit and its selected documents:
  - **current medicines:** `taking` entries only, ordered: the next visit's prescriber first, then other prescribers by name, then entries with no prescriber; alphabetical by product name within each group;
  - **unconfirmed:** `uncertain` entries and legacy entries still pending review;
  - **recent changes:** routine events of the last 90 days, by the date the user recorded them, not the prescription date.
- `passport.snapshot` freezes a copy. It is never regenerated. If the live passport is identical to the latest snapshot, that snapshot is returned instead of a new one.
- **Print, PDF and share always use a snapshot.** Opening the live screen does not create one.
- A snapshot keeps each selected document's title, kind, date and hash. When the original is later deleted, the snapshot shows "Original removed on <date>" and never re-links.
- Revisions are numbered per profile. The UI lists them as a history; any snapshot can be opened, printed or shared again.
- The legacy batch review never blocks printing or sharing; pending entries simply appear under "unconfirmed".

### 9.7 Sharing

- `sharing.create(snapshotId, hours)` encrypts that snapshot on the device (AES-GCM, 256-bit key, key in the URL fragment), uploads only ciphertext, and stores the link with its profile and snapshot.
  - The lifetime is between 1 hour and 7 days; the server enforces the 7-day cap.
  - The encrypted payload is versioned (`{ v: 2, snapshot }`).
- The QR printed on a passport is always the QR of a link to that exact snapshot. When no such link exists, no QR is printed.
- `sharing.list(profileId)` returns only that profile's links. v1 links (owner unknown) are never returned for a profile and never shown as a QR. `sharing.listUnowned()` returns them for Settings, where they stay revocable until they expire.
- `sharing.open` returns the snapshot; it accepts v1 payloads (a bare v1 passport) by wrapping them.

### 9.8 Search and Ask

- `records.search` filters by every `RecordQuery` field. `text` matches, case-insensitively, the title, tags, test names, facility and the prescriber's name and specialty. Results say what matched.
- `records.ask` parses a question deterministically into a `RecordQuery`. It does not use a language model. It understands:
  - "latest", "last N", "first";
  - document kinds and test names from the dictionary;
  - a doctor by name or specialty ("my cardiologist");
  - a facility;
  - years, months and "last year";
  - "questions" for the next visit;
  - "medicines" or "routine".

  Anything else returns `understood: false` with a hint of what can be asked.
- `text` in an answer is factual and short: "Latest lab report with Lipid profile: 12 Nov 2026, Lakeside Diagnostics." It never interprets a value or gives advice. Answers say when a record is the earliest *in CareVault*, not the earliest ever.

### 9.9 Migration from v1

Existing data must never be lost. Dexie schema version 2 upgrades version 1 in place, and backup import maps v1 backups the same way.

| v1 medicine | Recognised by | v2 routine entry |
| --- | --- | --- |
| `confirmed_current`, confirmed by the user | a `confirmed` event with `documentId: null`, or `origin: 'manual'` | `taking`, source `caregiver_reported`, `legacyReviewPending: false` |
| `confirmed_current` made by the prescription rule only | `origin: 'prescription'` and no user `confirmed` event | `uncertain`, source `legacy`, `legacyReviewPending: true` |
| `needs_confirmation` | status | `uncertain`, source `legacy`, `legacyReviewPending: true` |
| `found_at_home` | status | `uncertain`, source `from_pack`, `legacyReviewPending: true` |
| `stopped` by the user | last stop event is `marked_stopped` with `documentId: null` | `stopped`, source `caregiver_reported` |
| `stopped` by the replacement rule | a `replaced` event | `stopped`, `replacedByMedicineId` kept |

Every migrated entry keeps `legacyStatus` and gets one `migrated` event. Other mappings:
- **Documents:** v1 `type` becomes `kind`, `documentDate` becomes `clinicalDate` with `dateSource: 'document'` (or `'email_received'` for v1 email imports), and `state: 'confirmed'` becomes `'filed'`.
- **Review items:** v1 review items are dropped after their effects are mapped.
- **Shares:** v1 shares keep their revoke token with `profileId: null` and `snapshotId: null`.

A `legacy_routine_review` attention item lists pending entries. `routine.resolveLegacy` settles them in one batch.

## 10. The sample case v2 (fixtures and golden test)

`src/contract/fixtures/sampleCase.ts` exports `SAMPLE_TODAY = '2026-11-14'`, `SAMPLE_PROFILE_IDS`, fixed ids, all rows, and `expected`. Everything is synthetic. Timestamps use +05:30.

**Profile 1: Ramesh Iyer.** Father, born 1955, cared for by Anjali Iyer (daughter). Emergency contact "Anjali Iyer, +91 90000 00000".

Prescribers: Dr. Kavita Rao (Cardiology) and Dr. Suresh Menon (Diabetology).

Documents (all `filed` unless stated):

| Document | Kind | Clinical date | Source |
| --- | --- | --- | --- |
| Cardiology prescription, Dr. Rao | prescription | 2026-08-05 | camera |
| Cardiology prescription, Dr. Rao | prescription | 2026-10-28 | camera |
| Diabetes prescription, Dr. Menon | prescription | 2026-07-14 | camera |
| Lipid profile, Lakeside Diagnostics | lab_report | 2026-11-12 | upload |
| ECG report | test | 2026-09-15 | upload |
| HbA1c report | lab_report | **null** (no date read) | email, `receivedAt` 2026-11-12T20:05+05:30, `pending_review`, patient match `match` |

Each sample document is backed by a PDF in `public/sample-docs/` (laptop A keeps these in step).

Routine, stated explicitly; this is what the user reported:

| Entry | Status | Source | Prescriber | Last confirmed | Doses per day |
| --- | --- | --- | --- | --- | --- |
| Amlodipine 10 mg, 1 tablet, morning | taking | caregiver_reported | Dr. Rao | 2026-10-30 | 1 |
| Telmisartan 40 mg, 1 tablet, morning | taking | caregiver_reported | Dr. Rao | 2026-10-30 | 1 |
| Rosuvastatin 10 mg, 1 tablet, night | taking | caregiver_reported | Dr. Rao | 2026-10-30 | 1 |
| Metformin 500 mg, 1 tablet, twice a day | taking | caregiver_reported | Dr. Menon | 2026-07-20 | 2 |
| Atorvastatin 10 mg, 1 tablet, night | uncertain | caregiver_reported | Dr. Rao | null | 1 |
| Dolo 650 (paracetamol 650 mg) | taking | from_pack | none | 2026-11-10 | 3 |
| Crocin Advance 500 (paracetamol 500 mg) | taking | from_pack | none | 2026-11-10 | 3 |
| Amlodipine 5 mg | stopped, replaced by Amlodipine 10 mg | caregiver_reported | Dr. Rao | — | — |
| Pantoprazole 40 mg | stopped | caregiver_reported | none | — | — |

Health entries: allergy "Sulfa drugs: rash" (caregiver_reported); condition "High blood pressure"; condition "Type 2 diabetes".

Next visit: 2026-11-18T10:30+05:30 with Dr. Rao. Questions:
- "Does Rosuvastatin replace Atorvastatin, or should he take both?"
- "Can he use Dolo 650 and Crocin Advance on the same day? Both contain paracetamol."

Shared documents: Lipid profile and ECG report.

**Demo prescription (not seeded; uploaded during the demo).** `public/sample-docs/rx-rao-2026-11-13.pdf`, Dr. Rao, dated 2026-11-13. Its lines:
- Amlodipine 10 mg 1-0-0;
- Telmisartan 80 mg 1-0-0;
- Rosuvastatin 10 mg 0-0-1;
- Aspirin, with the strength printed as a smudged "7? mg" (true value 75 mg), 0-1-0.

Laptop A produces this file. The smudge must make the parser flag the strength.

**Profile 2: Lakshmi Iyer.** Mother, born 1958, cared for by Anjali Iyer. One prescriber (Dr. Farah Khan, General medicine). One document: a thyroid profile lab report with a clinical date of 2026-10-02 (`public/sample-docs/thyroid-profile-lakshmi-2026-10-02.pdf`, made by laptop A). Routine: Levothyroxine 50 mcg, 1 tablet before breakfast, taking. Allergies: none known (explicit). No visit. This profile exists to prove that nothing crosses between profiles.

**Expected results** (the golden test on laptop A and the mock on laptop B both assert these):

- Ramesh, live passport on `SAMPLE_TODAY`:
  - current medicines: Amlodipine 10 mg, Telmisartan 40 mg, Rosuvastatin 10 mg, Metformin 500 mg, Dolo 650, Crocin Advance 500;
  - unconfirmed: Atorvastatin 10 mg;
  - allergies: listed, "Sulfa drugs: rash";
  - visit: Dr. Kavita Rao, 2026-11-18.
- Ingredient totals: paracetamol 3450 mg a day = 1950 + 1500, complete. One `possible_duplicate_ingredient` attention item.
- Attention for Ramesh: only `possible_duplicate_ingredient`. The seeded documents carry no field evidence, so nothing waits for verification. The HbA1c record is `pending_review` with an unknown date and appears in Records under "Undated".
- Search "latest lipid profile" → Lipid profile, 2026-11-12, first result. Search for test "HbA1c" sorted newest → the HbA1c report, listed after dated records because it is undated.
- Saving the demo prescription with Dr. Rao gives these proposal rows:
  - `changed` Telmisartan 40 → 80 mg, asked;
  - `new` Aspirin, asked, `blockedByVerification: true` until the strength is verified;
  - `same` Amlodipine 10 mg and Rosuvastatin 10 mg, not asked;
  - `not_mentioned` Atorvastatin 10 mg, asked (same prescriber);
  - `passiveNotMentionedCount: 3` (Metformin, Dolo 650, Crocin Advance 500).
- Deciding `started_new` for Telmisartan, `skip` for Atorvastatin, and (after the strength is corrected to 75 mg) `started` for Aspirin:
  - current medicines gain Telmisartan 80 mg and Aspirin 75 mg; Telmisartan 40 mg becomes stopped and replaced;
  - Atorvastatin is unchanged (`uncertain`);
  - Metformin, Dolo and Crocin are untouched.
- Lakshmi: her live passport, searches, shares and attention list contain nothing of Ramesh's, and the reverse.

## 11. UI summary (detail in `02-ui.spec.md`)

Navigation: **Home**, **Records**, **Passport**, **Ask**, and **Settings** behind the profile menu. Phones get a bottom tab bar (Home, Records, Passport, Ask); desktop gets a top bar.

Routes:
- `/` (Home);
- `/records`, `/records/add`, `/records/:id`, `/records/:id/verify`, `/records/:id/review`;
- `/passport`, `/passport/medicines/:id`, `/passport/snapshots/:id`, `/passport/print/:snapshotId`;
- `/ask`;
- `/settings`;
- `/welcome`;
- `/share/:id` (public, no navigation).

## 12. Server API (detail in `01-core.spec.md`)

| Method and path | Body | Returns |
| --- | --- | --- |
| POST `/api/extract` | `{ imageBase64, mimeType, page? }` | candidate fields with `engine: 'cloud'`; 503 when not configured |
| POST `/api/share` | `{ ciphertext, iv, expiresAt }` | `{ id, revokeToken, expiresAt }`; 503 when not configured |
| GET `/api/share/:id` | — | `{ ciphertext, iv }`, 404, or 410 with `reason` |
| DELETE `/api/share/:id` | header `x-revoke-token` | 204 |
| GET `/api/health` | — | `{ ok, shareStore, cloudReading }` |

Environment variables are unchanged: `GEMINI_API_KEY`, `GEMINI_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_USE_MOCK`, `PORT`. Never commit real values.

## 13. Merge checkpoint and definition of done

When both sides have finished their last step:

1. Each side merges `main` into its branch, runs `npm run check`, pushes, and opens a pull request into `main`.
2. Laptop B's pull request merges first, then laptop A merges `main` into `feature/core` and its pull request merges. Ownership keeps the two pull requests apart.
3. Laptop A creates the branch `integration-v2` from `main`, removes the v1 side (section 6), sets `VITE_USE_MOCK=false`, and walks the first release story (section 1) and the acceptance tests below in a real browser against the real services. Mismatches are fixed on the owning side's files only.
4. Deploy from `main` (core spec), and walk the story once on the public URL from a phone.

Acceptance tests (automated where possible, all walked by hand at the checkpoint):

1. A strength read as "6?0 mg" (or the demo's "7? mg") and the answer "Yes, started": refused until verified; after correction the passport shows the corrected value.
2. A prescription omits a medicine and its question is skipped: the medicine is unchanged and the question is never raised again on its own.
3. The same prescription saved twice: the same proposal, no new events.
4. A populated v1 database and a v1 backup are both brought to v2: no document, file, medicine, event, question or share revocation token is lost; legacy medicines are in the states of section 9.9.
5. Two profiles each with a share: one profile's passport never shows the other's QR, and `sharing.list` never returns the other's links.
6. One email imported for one profile is still offered for the other profile. The same file arriving by upload and by email for one profile is reported as a duplicate. Both PDFs of a two-attachment email can be imported separately.
7. After a routine edit, and after an original is deleted, an earlier snapshot reads exactly as before (with "Original removed on …").
8. No cloud request is made without consent; a locked PDF is kept and reported as `locked_pdf`.
9. Every printed QR opens its own snapshot; wrong key, revoked and expired links show their states.
10. `npm run check` passes on `main` after the merge.

Done means: all ten pass, the app is deployed, and the first release story runs on a phone against the public URL.

## 14. Open decisions for the humans

- **OCR engine order.** Tesseract.js stays first until the benchmark in the core spec has been run on two phones. PaddleOCR.js reads stylised brand names that Tesseract misses, but needs a large first download.
- **Demo country.** Remains India (Indian brands in the drug reference).
- **Optional work** (encrypted original attachments in shares; an assistant service with evidence-graded medicine comparison). Start only if the merge checkpoint passes with time left.
