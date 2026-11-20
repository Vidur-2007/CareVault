import type { CareVaultServices } from '../../../contract/legacy/services';
import type { ExtractedLine, IngredientTotal, Medicine } from '../../../contract/legacy/types';

export interface SavedScan {
  medicine: Medicine;
  /** A possible duplicate the new medicine is part of, if saving created one. */
  duplicate: IngredientTotal | null;
}

/**
 * Saves a confirmed scan. The photo is kept as a record (the original is always kept),
 * then the medicine is added as found at home, and confirmed when the caregiver says it is taken.
 */
export async function saveScannedMedicine(
  services: CareVaultServices,
  profileId: string,
  photo: Blob | null,
  line: ExtractedLine,
  opts: { confirm: boolean; today: string },
): Promise<SavedScan> {
  let documentId: string | null = null;
  if (photo) {
    const { record } = await services.documents.add(profileId, photo, {
      type: 'other',
      title: `Photo of ${line.productName}`,
      documentDate: opts.today,
      source: 'scan',
      prescriberId: null,
    });
    await services.documents.confirm(record.id);
    documentId = record.id;
  }
  let medicine = await services.medicines.addFromLine(profileId, line, { origin: photo ? 'home_scan' : 'manual', documentId });
  if (opts.confirm) medicine = await services.medicines.confirm(medicine.id);
  const totals = await services.medicines.ingredientTotals(profileId);
  const duplicate = totals.find((t) => t.parts.some((p) => p.medicineId === medicine.id)) ?? null;
  return { medicine, duplicate };
}
