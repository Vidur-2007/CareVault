// Pronouns for UI copy ("Is he still taking...", "Not his"). Derived only from the
// relation the caregiver typed; anything unrecognised uses they/them.
export interface Pronouns {
  subject: string; // he / she / they
  object: string; // him / her / them
  possessive: string; // his / her / their
  standalone: string; // his / hers / theirs
}

const HE = new Set(['father', 'dad', 'husband', 'son', 'brother', 'grandfather', 'grandpa', 'uncle', 'father-in-law']);
const SHE = new Set(['mother', 'mom', 'mum', 'wife', 'daughter', 'sister', 'grandmother', 'grandma', 'aunt', 'mother-in-law']);

export function pronounsFor(relation: string | null | undefined): Pronouns {
  const r = (relation ?? '').trim().toLowerCase();
  if (HE.has(r)) return { subject: 'he', object: 'him', possessive: 'his', standalone: 'his' };
  if (SHE.has(r)) return { subject: 'she', object: 'her', possessive: 'her', standalone: 'hers' };
  return { subject: 'they', object: 'them', possessive: 'their', standalone: 'theirs' };
}

/** 'he takes' / 'they take': adds the third-person s except for they. */
export function verb(p: Pronouns, base: string): string {
  return p.subject === 'they' ? base : `${base}s`;
}
