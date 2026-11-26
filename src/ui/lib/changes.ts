// Recent changes on the passport (overview 9.6). The kind is shown as a pill, so a text that starts
// with the same word ("Started Dolo 650") drops it: the pill reads "Started", the text "Dolo 650".
import type { Passport } from '../../contract/types';

type Change = Passport['recentChanges'][number];

export const CHANGE_LABEL: Record<Change['kind'], string> = {
  started: 'Started', changed: 'Changed', stopped: 'Stopped', not_started: 'Not started',
};

export function changeText(c: Pick<Change, 'kind' | 'text'>): string {
  const label = CHANGE_LABEL[c.kind];
  const rest = c.text.startsWith(`${label} `) ? c.text.slice(label.length + 1).trim() : c.text;
  return rest || c.text;
}
