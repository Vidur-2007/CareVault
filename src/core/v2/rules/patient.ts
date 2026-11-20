// The patient name printed on a document, and whether it is this profile's patient.
// Pure and deterministic. A mismatch never files a record on its own (overview 9.1).

const LABEL = /^\s*(?:(?:patient(?:'s)?\s*name|patient|pt\.?|name)\s*[:\-–]|pt\.)\s*(.+)$/i;
// Labels that often follow the name on the same line.
const STOP = /\s+(?:age|sex|gender|dob|d\.o\.b|uhid|mrn|id|ref|date|reg)\b.*$/i;
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'master', 'smt', 'shri', 'sri', 'kum', 'dr', 'baby']);

/** The patient name read from the text, or null. */
export function readPatientName(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LABEL);
    if (!m) continue;
    const name = m[1].replace(STOP, '').replace(/[,;|]+.*$/, '').trim().replace(/\s+/g, ' ');
    if (/[A-Za-z]{2}/.test(name)) return name.slice(0, 60);
  }
  return null;
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s.]/g, ' ')
    .split(/[\s.]+/)
    .filter((t) => t && !TITLES.has(t));
}

/**
 * Same person, ignoring case, titles ("Mr", "Smt"), punctuation, word order and initials:
 * "R. Iyer" and "Iyer Ramesh" both match "Ramesh Iyer"; "Lakshmi Iyer" does not. An extra
 * word on one side is allowed ("Ramesh Venkat Iyer"), as Indian names often add a given or
 * family name.
 * Every word of the shorter name must match a different word of the longer one, either
 * exactly or as an initial, and at least one word must match in full.
 */
export function sameName(a: string, b: string): boolean {
  const [short, long] = [tokens(a), tokens(b)].sort((x, y) => x.length - y.length);
  if (short.length === 0) return false;
  const free = [...long];
  let fullMatch = false;
  for (const word of short) {
    const exact = free.indexOf(word);
    if (exact >= 0) {
      free.splice(exact, 1);
      fullMatch = true;
      continue;
    }
    const initial = free.findIndex((other) => (word.length === 1 ? other[0] === word : other.length === 1 && word[0] === other));
    if (initial < 0) return false;
    free.splice(initial, 1);
  }
  return fullMatch;
}

export function matchPatient(nameRead: string | null, profileName: string): 'match' | 'mismatch' | 'not_found' {
  if (!nameRead) return 'not_found';
  return sameName(nameRead, profileName) ? 'match' : 'mismatch';
}
