// What needs the user's attention (overview 8.1, 9.1, 9.5, 9.9). Pure. Each item's id is
// derived from what causes it, so it stays the same while the condition lasts.
// Reviews of prescriptions are never listed: a skipped or dismissed review stays on its document.
import type { AttentionItem, DocumentRecord, FieldEvidence, RoutineMedicine } from '../../../contract/types';
import type { Medicine as LegacyMedicine } from '../../../contract/legacy/types';
import { duplicateGroups } from '../../rules/totals';

export const DUPLICATE_WORDING = 'These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber.';

/** Entries that may be taken: the ones totals and duplicate checks look at. */
export const mayBeTaken = (m: RoutineMedicine) => m.status === 'taking' || m.status === 'uncertain';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The v1 duplicate groups, over v2 entries that may be taken. */
export function duplicateIngredientGroups(routine: readonly RoutineMedicine[]) {
  const asLegacy = routine.filter(mayBeTaken).map((m) => ({ ...m, status: 'confirmed_current' }) as unknown as LegacyMedicine);
  const byId = new Map(routine.map((m) => [m.id, m]));
  return duplicateGroups(asLegacy).map((g) => ({ ingredient: g.ingredient, medicines: g.medicines.map((m) => byId.get(m.id)!) }));
}

/** 'Paracetamol in Dolo 650 and Crocin Advance 500'. */
export function duplicateTitle(group: { ingredient: string; medicines: readonly RoutineMedicine[] }): string {
  return `${capitalize(group.ingredient)} in ${group.medicines.map((m) => m.productName).join(' and ')}`;
}

export function attentionItems(input: {
  documents: readonly DocumentRecord[];
  evidence: readonly FieldEvidence[];
  routine: readonly RoutineMedicine[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const documents = [...input.documents].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt) || a.id.localeCompare(b.id));

  for (const doc of documents) {
    if (doc.source === 'email' && doc.patientMatch === 'mismatch') {
      items.push({
        id: `unassigned_import:${doc.id}`,
        kind: 'unassigned_import',
        title: `Whose record is "${doc.title}"?`,
        body: doc.patientNameRead
          ? `The name on it is ${doc.patientNameRead}. Choose whose record it is, or remove it.`
          : 'Choose whose record it is, or remove it.',
        documentId: doc.id,
        medicineIds: [],
      });
    }
  }

  for (const doc of documents) {
    const flagged = input.evidence.filter((e) => e.documentId === doc.id && e.status === 'needs_verification');
    if (flagged.length === 0) continue;
    items.push({
      id: `unverified_fields:${doc.id}`,
      kind: 'unverified_fields',
      title: `Check the values in "${doc.title}"`,
      body: `${capitalize(plural(flagged.length, 'value needs', 'values need'))} a look before they are used.`,
      documentId: doc.id,
      medicineIds: [],
    });
  }

  const pending = input.routine.filter((m) => m.legacyReviewPending).sort((a, b) => a.productName.localeCompare(b.productName) || a.id.localeCompare(b.id));
  if (pending.length > 0) {
    items.push({
      id: `legacy_routine_review:${pending[0].profileId}`,
      kind: 'legacy_routine_review',
      title: 'Confirm the medicines kept from the earlier version',
      body: `${capitalize(plural(pending.length, 'medicine was', 'medicines were'))} kept from before the update. Say which are still taken.`,
      documentId: null,
      medicineIds: pending.map((m) => m.id),
    });
  }

  for (const group of duplicateIngredientGroups(input.routine)) {
    const ids = group.medicines.map((m) => m.id);
    items.push({
      id: `possible_duplicate_ingredient:${group.ingredient}:${[...ids].sort().join('+')}`,
      kind: 'possible_duplicate_ingredient',
      title: duplicateTitle(group),
      body: DUPLICATE_WORDING,
      documentId: null,
      medicineIds: ids,
    });
  }
  return items;
}
