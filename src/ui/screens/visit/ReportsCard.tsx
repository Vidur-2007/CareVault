import type { DocumentRecord, Visit } from '../../../contract/legacy/types';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { useServiceAction } from '../../hooks/useServiceAction';
import { formatShortDate } from '../../lib/format';

/** Starred first, then newest. Pending documents are listed but cannot be shared until confirmed. */
function ordered(documents: DocumentRecord[]): DocumentRecord[] {
  return [...documents].sort(
    (a, b) =>
      Number(a.state === 'pending_confirmation') - Number(b.state === 'pending_confirmation') ||
      Number(b.starred) - Number(a.starred) ||
      b.documentDate.localeCompare(a.documentDate),
  );
}

export function ReportsCard({ visit, documents }: { visit: Visit; documents: DocumentRecord[] }) {
  const save = useServiceAction((s, ids: string[]) => s.visits.setSharedDocuments(visit.id, ids));
  // Prescriptions are compared, not shared; pack photos kept from Scan (type other, source scan) are not reports.
  const shareable = ordered(documents.filter((d) => d.type !== 'prescription' && !(d.type === 'other' && d.source === 'scan')));

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...visit.sharedDocumentIds, id] : visit.sharedDocumentIds.filter((x) => x !== id);
    void save.run(next);
  };

  return (
    <Card as="section" aria-labelledby="reports-title">
      <h2 id="reports-title" className="font-sans text-card-sm font-semibold md:text-[22px]">
        Reports to share
      </h2>
      {shareable.length === 0 ? (
        <p className="mt-3 text-ink-3">No reports in the records yet.</p>
      ) : (
        <div className="mt-3 flex flex-col">
          {shareable.map((d) => {
            const pending = d.state === 'pending_confirmation';
            return (
              <Checkbox
                key={d.id}
                label={`${d.title}, ${formatShortDate(d.documentDate)}${pending ? ' (not yet confirmed)' : ''}`}
                checked={!pending && visit.sharedDocumentIds.includes(d.id)}
                disabled={pending || save.pending}
                onChange={(e) => toggle(d.id, e.target.checked)}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}
