import type { DocumentRecord, ReviewItem, ReviewResolution } from '../../contract/legacy/types';
import type { Pronouns } from '../lib/pronouns';
import { pronounsFor } from '../lib/pronouns';
import { Button } from './Button';
import { Card } from './Card';
import { Pill } from './Pill';
import { reviewKindPill } from './pills';

export interface ReviewCardProps {
  item: ReviewItem;
  /** The document the item refers to (new_document, unclear_extraction), for the pill wording. */
  document?: DocumentRecord | null;
  pronouns?: Pronouns;
  /** The resolution being saved, so that button shows a spinner. */
  pending?: ReviewResolution | null;
  onResolve: (resolution: ReviewResolution) => void;
  onViewPrescriptions?: () => void;
  onReviewProducts?: () => void;
  onOpenDocument?: () => void;
  onViewOriginal?: () => void;
  headingLevel?: 2 | 3;
}

/** One open review item with the actions for its kind (UI spec 7.2). Presentational only. */
export function ReviewCard({
  item,
  document,
  pronouns = pronounsFor(null),
  pending = null,
  onResolve,
  onViewPrescriptions,
  onReviewProducts,
  onOpenDocument,
  onViewOriginal,
  headingLevel = 3,
}: ReviewCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const busy = pending !== null;
  const resolveButton = (resolution: ReviewResolution, label: string, variant: 'primary' | 'secondary', className?: string) => (
    <Button
      variant={variant}
      onClick={() => onResolve(resolution)}
      loading={pending === resolution}
      disabled={busy && pending !== resolution}
      className={className}
    >
      {label}
    </Button>
  );

  let actions = null;
  switch (item.kind) {
    case 'confirm_medicine':
      actions = (
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center">
          {resolveButton('still_taking', 'Still taking', 'secondary')}
          {resolveButton('stopped', 'Stopped', 'secondary')}
          {resolveButton('ask_doctor', 'Ask the doctor', 'primary', 'col-span-2')}
          {onViewPrescriptions && (
            <Button variant="quiet" onClick={onViewPrescriptions} className="col-span-2 md:ml-2">
              View both prescriptions
            </Button>
          )}
        </div>
      );
      break;
    case 'possible_duplicate':
      actions = (
        <Button variant="primary" onClick={onReviewProducts} disabled={!onReviewProducts} className="w-full md:w-auto">
          Review both products
        </Button>
      );
      break;
    case 'new_document':
      actions = (
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap">
          {resolveButton('added', 'Add to records', 'primary', 'col-span-2 md:col-span-1')}
          {onOpenDocument && (
            <Button variant="secondary" onClick={onOpenDocument} disabled={busy}>
              Open the PDF
            </Button>
          )}
          {resolveButton('dismissed', `Not ${pronouns.standalone}`, 'secondary')}
        </div>
      );
      break;
    case 'unclear_extraction':
      actions = (
        <Button variant="secondary" onClick={onViewOriginal} disabled={!onViewOriginal}>
          View the original
        </Button>
      );
      break;
  }

  return (
    <Card as="article" aria-labelledby={`review-${item.id}-title`}>
      <Pill spec={reviewKindPill(item.kind, document)} />
      <Heading id={`review-${item.id}-title`} className="mt-4 text-card-sm md:text-card">
        {item.title}
      </Heading>
      {item.body && <p className="mt-3 text-ink-2">{item.body}</p>}
      <div className="mt-5">{actions}</div>
    </Card>
  );
}
