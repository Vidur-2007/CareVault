import type { ChangeSummary } from '../../../contract/legacy/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatTile } from '../../components/StatTile';
import { formatDayMonth } from '../../lib/format';
import { plural } from './copy';

/** "Since the last visit on 28 October" with four count-up tiles. */
export function SinceLastVisit({ summary }: { summary: ChangeSummary }) {
  return (
    <Card as="section" aria-labelledby="since-title">
      <h2 id="since-title" className="font-sans text-card-sm font-semibold">
        Since the last visit on {formatDayMonth(summary.since)}
      </h2>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <StatTile tone="blue" value={summary.added} label={plural(summary.added, 'medicine added', 'medicines added')} />
        <StatTile tone="amber" value={summary.changed} label={plural(summary.changed, 'dose changed', 'doses changed')} />
        <StatTile tone="red" value={summary.toConfirm} label="to confirm" />
        <StatTile tone="grey" value={summary.newDocuments} label={plural(summary.newDocuments, 'new report', 'new reports')} />
      </div>
      <Button to="/visit" variant="quiet" className="mt-4 -ml-1">
        See what changed
      </Button>
    </Card>
  );
}
