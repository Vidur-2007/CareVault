// "What changed since the last visit" and the Doctor Visit Passport. Both only restate
// what was entered and confirmed. Neither gives advice.
import type {
  ChangeSummary,
  DocumentRecord,
  ISODate,
  Medicine,
  Passport,
  PrescriptionDiff,
} from '../../contract/types';
import { describeChange, strengthDiffers } from './diff';
import { describeStrength, sameMedicine } from './normalize';
import { buildDiff } from './prescriptions';
import { isActive } from './status';
import { capitalize, joinNames, shortDate } from './text';
import type { RulesState } from './types';
import { nextVisit } from './visits';

/** Review rows of a diff whose medicine is still waiting for the caregiver's answer. */
function unconfirmedRows(state: RulesState, diff: PrescriptionDiff) {
  return diff.rows.filter((row) => {
    if (row.kind !== 'review' || !row.previous) return false;
    const missing = row.previous.ingredients;
    return state.medicines.some(
      (m) =>
        m.prescriberId === diff.prescriberId &&
        m.status === 'needs_confirmation' &&
        sameMedicine(m.ingredients, missing),
    );
  });
}

/**
 * Counts for the "Since the last visit" tiles. `since` is the date of the latest
 * prescription from the next visit's prescriber. Null when there is no upcoming visit or
 * that prescriber has no stored prescription.
 */
export function buildChangeSummary(state: RulesState, today: ISODate): ChangeSummary | null {
  const visit = nextVisit(state, today);
  if (!visit) return null;
  const diff = buildDiff(state, visit.prescriberId);
  if (!diff) return null;
  const latest = state.documents.find((d) => d.id === diff.latestDocumentId)!;
  const since = latest.documentDate;
  return {
    since,
    added: diff.rows.filter((row) => row.kind === 'added').length,
    changed: diff.rows.filter((row) => row.kind === 'changed').length,
    toConfirm: unconfirmedRows(state, diff).length,
    newDocuments: state.documents.filter((d) => d.id !== latest.id && d.documentDate >= since).length,
  };
}

function ageOn(today: ISODate, birthYear: number | null): number | null {
  return birthYear === null ? null : Number(today.slice(0, 4)) - birthYear;
}

/** The whole passport for the next visit, or a general one when no visit is booked. */
export function buildPassport(state: RulesState, today: ISODate): Passport {
  const { profile } = state;
  const visit = nextVisit(state, today);
  const prescriber = visit ? (state.prescribers.find((p) => p.id === visit.prescriberId) ?? null) : null;
  const prescriberName = (id: string | null) => state.prescribers.find((p) => p.id === id)?.name ?? null;

  const diff = visit ? buildDiff(state, visit.prescriberId) : null;
  const latestDoc = diff ? state.documents.find((d) => d.id === diff.latestDocumentId) : undefined;
  const previousDoc = diff?.previousDocumentId
    ? state.documents.find((d) => d.id === diff.previousDocumentId)
    : undefined;
  const when = latestDoc ? ` (${shortDate(latestDoc.documentDate)})` : '';

  const changes: Passport['changes'] = [];
  const reported = new Set<Medicine>();
  if (diff && latestDoc) {
    // Changes are relative to a previous prescription. A first prescription has none.
    for (const row of previousDoc ? diff.rows : []) {
      if (row.kind === 'added' && row.latest) {
        changes.push({ kind: 'added', text: `${row.latest.productName}, ${row.latest.instruction}${when}` });
      } else if (row.kind === 'changed' && row.previous && row.latest) {
        const text = strengthDiffers(row.previous, row.latest)
          ? `${row.latest.ingredients.map((i) => capitalize(i.name)).join(' + ')} from ${describeStrength(row.previous.ingredients)} to ${describeStrength(row.latest.ingredients)}, ${row.latest.instruction}`
          : `${row.latest.productName}, ${describeChange(row.previous, row.latest)}`;
        changes.push({ kind: 'changed', text: `${text}${when}` });
      }
    }
    for (const row of unconfirmedRows(state, diff)) {
      const missing = row.previous!;
      changes.push({
        kind: 'unconfirmed',
        text: `${missing.productName} is not on the ${shortDate(latestDoc.documentDate)} prescription`,
      });
      for (const m of state.medicines) {
        if (m.prescriberId === diff.prescriberId && sameMedicine(m.ingredients, missing.ingredients)) reported.add(m);
      }
    }
  }
  // Anything else still waiting for an answer is shown as unconfirmed, never left out.
  for (const m of state.medicines) {
    if (m.status === 'needs_confirmation' && !reported.has(m)) {
      changes.push({ kind: 'unconfirmed', text: `${m.productName} is not confirmed as currently taken` });
    }
  }

  const flags: string[] = [];
  for (const item of state.reviewItems) {
    if (item.kind !== 'possible_duplicate') continue;
    if (item.resolvedAt !== null && item.resolution !== 'ask_doctor') continue;
    const medicines = item.medicineIds
      .map((id) => state.medicines.find((m) => m.id === id))
      .filter((m): m is Medicine => m !== undefined && isActive(m));
    if (medicines.length < 2) continue;
    const unprescribed = medicines.every((m) => m.prescriberId === null && m.origin !== 'prescription');
    const tail = unprescribed
      ? ` ${medicines.length === 2 ? 'Neither is' : 'None of them is'} on a prescription in these records.`
      : '';
    flags.push(`${item.title}: ${joinNames(medicines.map((m) => m.productName))}.${tail}`);
  }

  const currentMedicines = state.medicines
    .filter((m) => m.status === 'confirmed_current')
    .map((m) => ({ medicine: m, by: prescriberName(m.prescriberId) }))
    .sort((a, b) => {
      // The visit's prescriber first, then other prescribers by name, then the rest.
      const rank = (x: typeof a) =>
        visit && x.medicine.prescriberId === visit.prescriberId ? 0 : x.by !== null ? 1 : 2;
      return (
        rank(a) - rank(b) ||
        (a.by ?? '').localeCompare(b.by ?? '') ||
        a.medicine.productName.localeCompare(b.medicine.productName)
      );
    })
    .map(({ medicine, by }) => ({
      productName: medicine.productName,
      instruction: medicine.instruction,
      prescriberName: by,
    }));

  return {
    patientName: profile.name,
    patientAge: ageOn(today, profile.birthYear),
    preparedBy: `${profile.caregiverName}, ${profile.caregiverRelation}`,
    preparedOn: today,
    visitAt: visit?.at ?? null,
    prescriberName: prescriber?.name ?? null,
    prescriberSpecialty: prescriber?.specialty ?? null,
    currentMedicines,
    changesSince: previousDoc?.documentDate ?? null,
    changes,
    flags,
    documents: (visit?.sharedDocumentIds ?? [])
      .map((id) => state.documents.find((d) => d.id === id))
      .filter((d): d is DocumentRecord => d !== undefined)
      .map((d) => ({ title: d.title, documentDate: d.documentDate })),
    questions: visit?.questions.map((q) => q.text) ?? [],
  };
}
