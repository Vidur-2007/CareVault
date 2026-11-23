// Home (UI spec 4.2). Only four attention kinds may appear, each with one primary action. Nothing
// about a medicine's status or a prescription review is ever shown here. Pure, unit-tested.
import type { AttentionItem, AttentionKind, Passport, Profile } from '../../../contract/types';
import type { PillSpec } from '../../components/pills';
import { stillTakes } from '../passport/passportText';

export const HOME_KINDS: readonly AttentionKind[] = ['unverified_fields', 'unassigned_import', 'possible_duplicate_ingredient', 'legacy_routine_review'];

/** The attention items Home shows: the four kinds only, whatever else the list holds. */
export const homeItems = (items: AttentionItem[]) => items.filter((i) => HOME_KINDS.includes(i.kind));

export type HomeAction = { label: string; to: string } | { label: string; assign: true };

export function attentionAction(item: AttentionItem, profile: Pick<Profile, 'relation'>): HomeAction {
  switch (item.kind) {
    case 'unverified_fields':
      return { label: 'Check the values', to: item.documentId ? `/records/${item.documentId}/verify` : '/records' };
    case 'unassigned_import':
      return { label: 'Choose whose record this is', assign: true };
    case 'possible_duplicate_ingredient':
      return { label: 'Review the products', to: '/passport#duplicates' };
    default:
      return { label: `Choose the medicines ${stillTakes(profile)}`, to: '/passport#legacy-review' };
  }
}

export const ATTENTION_PILL: Record<AttentionKind, PillSpec> = {
  unverified_fields: { tone: 'check', label: 'Check this value' },
  unassigned_import: { tone: 'amber', label: 'Whose record?' },
  possible_duplicate_ingredient: { tone: 'red', label: 'Possible duplicate ingredient' },
  legacy_routine_review: { tone: 'amber', label: 'Previously listed' },
};

/** "6 medicines being taken". */
export const takenLine = (n: number) => (n === 0 ? 'No medicines recorded as taken' : n === 1 ? '1 medicine being taken' : `${n} medicines being taken`);

/** The allergy line of the passport card, in its three states. */
export function allergyLine(a: Passport['allergies']): string {
  if (a.state === 'listed') return `Allergies: ${a.items.join(', ')}`;
  if (a.state === 'none_known') return 'No known allergies';
  return 'Allergies not recorded';
}

/** "Father · 71 years · cared for by Anjali Iyer", or "Your own records". */
export function profileLine(p: Pick<Profile, 'relation' | 'caregiverName'>, age: number | null): string {
  if (p.relation === 'Myself') return ['Your own records', age !== null ? `${age} years` : null].filter(Boolean).join(' · ');
  return [p.relation, age !== null ? `${age} years` : null, p.caregiverName ? `cared for by ${p.caregiverName}` : null].filter(Boolean).join(' · ');
}
