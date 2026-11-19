// Maps statuses to pill tone and words (UI spec section 3). Status never relies on colour alone.
import type { DiffKind, DocumentRecord, Medicine, MedicineStatus, PrescriptionDiffRow, ReviewKind } from '../../contract/types';

export type PillTone = 'teal' | 'blue' | 'amber' | 'red' | 'grey' | 'check';

export interface PillSpec {
  tone: PillTone;
  label: string;
}

export function medicineStatusPill(medicine: Pick<Medicine, 'status' | 'replacedByMedicineId'> | MedicineStatus): PillSpec {
  const status = typeof medicine === 'string' ? medicine : medicine.status;
  const replaced = typeof medicine !== 'string' && medicine.replacedByMedicineId !== null;
  switch (status) {
    case 'confirmed_current':
      return { tone: 'teal', label: 'Confirmed' };
    case 'found_at_home':
      return { tone: 'amber', label: 'Found at home' };
    case 'needs_confirmation':
      return { tone: 'amber', label: 'Needs confirmation' };
    case 'stopped':
      return { tone: 'grey', label: replaced ? 'Replaced' : 'Stopped' };
  }
}

export function diffPill(kind: DiffKind, row?: Pick<PrescriptionDiffRow, 'previous' | 'latest'>): PillSpec {
  switch (kind) {
    case 'added':
      return { tone: 'blue', label: '+ Added' };
    case 'unchanged':
      return { tone: 'grey', label: '= Unchanged' };
    case 'review':
      return { tone: 'red', label: 'Review required' };
    case 'changed': {
      const strength = (l: NonNullable<PrescriptionDiffRow['previous']>) =>
        l.ingredients.map((i) => `${i.name}:${i.strength}${i.unit}`).sort().join('|');
      const strengthChanged = row?.previous && row.latest ? strength(row.previous) !== strength(row.latest) : true;
      return { tone: 'amber', label: strengthChanged ? 'Changed strength' : 'Changed instructions' };
    }
  }
}

export function reviewKindPill(kind: ReviewKind, document?: Pick<DocumentRecord, 'source' | 'type'> | null): PillSpec {
  switch (kind) {
    case 'confirm_medicine':
      return { tone: 'amber', label: 'Needs confirmation' };
    case 'possible_duplicate':
      return { tone: 'red', label: 'Possible duplicate ingredient' };
    case 'new_document': {
      const what = document?.type === 'prescription' ? 'prescription' : 'report';
      return { tone: 'blue', label: document?.source === 'email' ? `New ${what} from email` : `New ${what}` };
    }
    case 'unclear_extraction':
      return { tone: 'amber', label: 'Unclear reading' };
  }
}

export const CHECK_THIS: PillSpec = { tone: 'check', label: 'Check this' };
export const POSSIBLE_DUPLICATE: PillSpec = { tone: 'red', label: 'Possible duplicate ingredient' };
