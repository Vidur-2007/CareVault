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
