// CareVault contract v2: shared types.
// FROZEN after Phase 0. Copied from docs/specs/00-overview.spec.md, section 8; change only
// through docs/contract-requests-<side>.md. The v1 contract is in ./legacy until the merge checkpoint.

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
  value: string | null;             // the current value: proposed, corrected or confirmed. Formats:
                                    //   medicine_name, instruction, patient_name: text; ingredient: the normalized
                                    //   lowercase name; strength: a decimal number, no unit ('75', '0.5'); unit: a
                                    //   DoseUnit; frequency: doses per day as a number ('1'); document_date: YYYY-MM-DD
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
  matchedOn: string[];              // from: 'title' | 'tag' | 'test name' | 'facility' | 'doctor' | 'specialty'
                                    //   | 'kind' | 'date' | 'starred' | 'medicine' (Ask only)
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
