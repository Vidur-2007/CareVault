// Wording for Ask (UI spec 4.12). Pure. Answers come from records.ask, which parses the question
// with fixed rules: there is no model and no chat history.
import type { DocumentRecord, Prescriber, Profile } from '../../../contract/types';
import { formatDate } from '../../lib/format';
import { KIND_LABEL, sourceLabel } from '../../lib/labels';
import { pronounsFor } from '../../lib/pronouns';

export const ASK_FOOTER = 'Answers come from the records on this device. CareVault does not give medical advice.';
export const NOT_UNDERSTOOD = 'CareVault can search your records by test, doctor, place and date. Try:';

/** The example chips, with the medicines question in the profile's words. */
export function examples(profile: Pick<Profile, 'relation'>): string[] {
  let medicines: string;
  if (profile.relation === 'Myself') medicines = 'What medicines do I take?';
  else {
    const p = pronounsFor(profile.relation);
    medicines = p.subject === 'they' ? 'What medicines do they take?' : `What medicines does ${p.subject} take?`;
  }
  return [
    'Latest lipid profile',
    'Prescriptions from the cardiologist',
    'Last three HbA1c reports',
    'What questions did I save?',
    medicines,
  ];
}

/** "Looking for: latest report with Lipid profile". */
export function lookingFor(interpretedAs: string): string {
  const s = interpretedAs.trim();
  return s ? `Looking for: ${s[0].toLowerCase()}${s.slice(1)}` : '';
}

/** Date, facility (or doctor) and source of a result: "12 Nov 2026 · Lakeside Diagnostics · uploaded PDF". */
export function resultMeta(doc: DocumentRecord, prescribers: Pick<Prescriber, 'id' | 'name'>[]): string {
  const when = doc.clinicalDate ? formatDate(doc.clinicalDate) : 'Date not known';
  const where = doc.facility ?? prescribers.find((p) => p.id === doc.prescriberId)?.name ?? null;
  return [when, where, sourceLabel(doc)].filter(Boolean).join(' · ');
}

export const kindLabel = (doc: Pick<DocumentRecord, 'kind'>) => KIND_LABEL[doc.kind];
