import { Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { DocumentRecord } from '../../contract/types';
import { cx } from '../lib/cx';
import { formatDate } from '../lib/format';
import { KIND_LABEL, sourceLabel } from '../lib/labels';
import { Pill } from './Pill';

export interface DocumentCardProps {
  document: DocumentRecord;
  /** First-page thumbnail (image or rendered PDF page). */
  thumbnail?: ReactNode;
  /** Added to the end of the meta line, e.g. "2 medicine changes found". */
  extra?: string;
  /** A line under the meta line, e.g. "Matched: test name". */
  note?: ReactNode;
  onToggleStar?: (starred: boolean) => void;
  starPending?: boolean;
  /** Link target. Default /records/:id. */
  to?: string;
  className?: string;
}

/** A record in the grid: kind, state, title, date and source (UI spec 4.3). */
export function DocumentCard({ document: doc, thumbnail, extra, note, onToggleStar, starPending, to, className }: DocumentCardProps) {
  const pending = doc.state === 'pending_review';
  const date = doc.clinicalDate ? formatDate(doc.clinicalDate) : `Added ${formatDate(doc.addedAt)}`;
  const meta = [date, sourceLabel(doc), extra].filter(Boolean).join(' · ');

  return (
    <article className={cx('relative flex flex-col rounded-card-sm border border-line bg-surface shadow-card md:rounded-card', className)}>
      {thumbnail && <div className="aspect-[4/3] overflow-hidden rounded-t-card-sm border-b border-line bg-surface-muted md:rounded-t-card">{thumbnail}</div>}
      <div className="flex flex-1 flex-col p-[18px] md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Pill tone="grey">{KIND_LABEL[doc.kind]}</Pill>
            {pending && <Pill tone="amber">Not yet filed</Pill>}
            {!doc.clinicalDate && <Pill tone="grey">Date not known</Pill>}
          </div>
          {onToggleStar && (
            <button
              type="button"
              aria-label={doc.starred ? `Unstar ${doc.title}` : `Star ${doc.title}`}
              aria-pressed={doc.starred}
              disabled={starPending}
              onClick={() => onToggleStar(!doc.starred)}
              className="relative z-10 -m-2 flex size-11 shrink-0 items-center justify-center rounded-button text-ink-3 hover:bg-grey-tint disabled:opacity-60"
            >
              <Star aria-hidden className={cx('size-5', doc.starred && 'fill-amber-ink text-amber-ink')} />
            </button>
          )}
        </div>
        <h3 className="mt-3 text-card-sm font-semibold">
          {/* The whole card is clickable through the stretched link. */}
          <Link to={to ?? `/records/${doc.id}`} className="after:absolute after:inset-0 after:rounded-card-sm hover:underline md:after:rounded-card">
            {doc.title}
          </Link>
        </h3>
        <p className="mt-2 text-secondary text-ink-3 md:text-body-sm">{meta}</p>
        {note && <p className="mt-1 text-secondary text-ink-2">{note}</p>}
      </div>
    </article>
  );
}
