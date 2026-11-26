// After saving (UI spec 4.7): one sentence per answered medicine and an Undo for each change,
// which calls routine.undo on the events that change created.
import { CircleCheck, Undo2 } from 'lucide-react';
import { forwardRef } from 'react';
import { Link } from 'react-router';
import type { Question, RoutineEvent } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Pill } from '../../components/Pill';

export interface SummaryItem {
  id: string;
  text: string;
  events: RoutineEvent[];
  questions: Question[];
  /** For the history link when an Undo is refused. */
  medicineId: string | null;
  state: 'done' | 'undoing' | 'undone' | 'refused';
  message?: string;
}

export const ReviewSummary = forwardRef<HTMLHeadingElement, { items: SummaryItem[]; onUndo: (item: SummaryItem) => void }>(
  function ReviewSummary({ items, onUndo }, ref) {
    return (
      <Card as="section" aria-labelledby="review-summary-title">
        <h2 id="review-summary-title" ref={ref} tabIndex={-1} className="flex items-center gap-2 font-sans text-card-sm font-semibold outline-none">
          <CircleCheck aria-hidden className="size-6 text-teal" />
          Your choices are saved
        </h2>
        <ul className="mt-4 flex flex-col gap-2" aria-label="What changed">
          {items.map((item) => {
            const undoable = item.events.length > 0 || item.questions.length > 0;
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-panel bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-ink">
                  {item.state === 'undone' && <Pill tone="grey">Undone</Pill>}
                  <span className={item.state === 'undone' ? 'text-ink-2 line-through decoration-ink-3' : undefined}>{item.text}</span>
                </span>
                {item.state === 'refused' ? (
                  <span role="alert" className="text-secondary text-red-ink">
                    {item.message}{' '}
                    {item.medicineId && (
                      <Link to={`/passport/medicines/${item.medicineId}`} className="font-semibold text-teal-ink underline">See the history</Link>
                    )}
                  </span>
                ) : undoable && item.state !== 'undone' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0 self-start sm:self-auto"
                    icon={<Undo2 aria-hidden className="size-4" />}
                    aria-label={`Undo: ${item.text}`}
                    loading={item.state === 'undoing'}
                    onClick={() => onUndo(item)}
                  >
                    Undo
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    );
  },
);
