// Builders shared by the rules tests. Not part of the app.
import type {
  DocumentRecord,
  ID,
  Ingredient,
  ISODateTime,
  Medicine,
  PrescriptionLine,
  Prescriber,
  Profile,
  ReviewItem,
  Visit,
} from '../../contract/legacy/types';
import type { LineInput } from './prescriptions';
import { withReviewRefresh } from './review';
import { applyPlan, type RuleContext, type RulesState, type WritePlan } from './types';

export const PROFILE: Profile = {
  id: 'p1',
  name: 'Meera Nair',
  relation: 'Mother',
  birthYear: 1950,
  caregiverName: 'Arun Nair',
  caregiverRelation: 'son',
  createdAt: '2026-01-01T09:00:00+05:30',
};

export const DR_A: Prescriber = { id: 'dr-a', profileId: 'p1', name: 'Dr. Asha Pillai', specialty: 'Cardiology' };
export const DR_B: Prescriber = { id: 'dr-b', profileId: 'p1', name: 'Dr. Bala Krishnan', specialty: 'Diabetology' };

export function makeState(overrides: Partial<RulesState> = {}): RulesState {
  return {
    profile: PROFILE,
    prescribers: [DR_A, DR_B],
    medicines: [],
    events: [],
    documents: [],
    prescriptionLines: [],
    reviewItems: [],
    visits: [],
    ...overrides,
  };
}

/** A context whose ids count up: 'medicine-1', 'event-2', ... */
export function makeCtx(now: ISODateTime = '2026-03-01T10:00:00+05:30'): RuleContext {
  let n = 0;
  return {
    now,
    today: now.slice(0, 10),
    newId: (kind) => {
      n += 1;
      return `${kind}-${n}`;
    },
  };
}

export const ing = (name: string, strength: number, unit: Ingredient['unit'] = 'mg'): Ingredient => ({
  name,
  strength,
  unit,
});

let medCounter = 0;

export function med(overrides: Partial<Medicine> & { ingredients: Ingredient[] }): Medicine {
  medCounter += 1;
  const second = String(medCounter % 60).padStart(2, '0');
  const minute = String(Math.floor(medCounter / 60) % 60).padStart(2, '0');
  return {
    id: `med-${medCounter}`,
    profileId: 'p1',
    productName: overrides.ingredients.map((i) => `${i.name} ${i.strength} ${i.unit}`).join(' + '),
    form: 'tablet',
    dosesPerDay: 1,
    instruction: '1 tablet, morning',
    prescriberId: null,
    status: 'found_at_home',
    origin: 'home_scan',
    sourceDocumentId: null,
    fieldState: 'extracted',
    replacedByMedicineId: null,
    createdAt: `2026-02-01T10:${minute}:${second}+05:30`,
    updatedAt: `2026-02-01T10:${minute}:${second}+05:30`,
    ...overrides,
  };
}

export function rx(
  id: ID,
  documentDate: string,
  prescriberId: ID | null = DR_A.id,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    profileId: 'p1',
    type: 'prescription',
    title: 'Prescription',
    documentDate,
    source: 'scan',
    state: 'confirmed',
    starred: false,
    prescriberId,
    mimeType: 'application/pdf',
    sha256: id.padEnd(64, '0'),
    addedAt: `${documentDate}T12:00:00+05:30`,
    ...overrides,
  };
}

export function line(name: string, strength: number, overrides: Partial<LineInput> = {}): LineInput {
  return {
    productName: `${name} ${strength} mg`,
    ingredients: [ing(name.toLowerCase(), strength)],
    form: 'tablet',
    dosesPerDay: 1,
    instruction: '1 tablet, morning',
    ...overrides,
  };
}

let lineCounter = 0;

export function storedLine(documentId: ID, input: LineInput): PrescriptionLine {
  lineCounter += 1;
  return {
    id: input.id ?? `stored-line-${lineCounter}`,
    documentId,
    productName: input.productName,
    ingredients: input.ingredients,
    form: input.form,
    dosesPerDay: input.dosesPerDay,
    instruction: input.instruction,
    fieldState: 'confirmed',
  };
}

export function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 'visit-1',
    profileId: 'p1',
    prescriberId: DR_A.id,
    at: '2026-03-10T10:30:00+05:30',
    questions: [],
    sharedDocumentIds: [],
    ...overrides,
  };
}

export function item(overrides: Partial<ReviewItem> & Pick<ReviewItem, 'kind'>): ReviewItem {
  return {
    id: `item-${overrides.kind}`,
    profileId: 'p1',
    title: 'A question',
    body: '',
    medicineIds: [],
    documentId: null,
    createdAt: '2026-02-10T10:00:00+05:30',
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

/** Stores a plan and the inbox refresh that follows it, as the services do. */
export function commit(state: RulesState, plan: WritePlan, ctx: RuleContext): RulesState {
  return applyPlan(state, withReviewRefresh(state, plan, ctx));
}
