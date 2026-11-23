// One card per asked row (UI spec 4.7): the pill, the routine value beside the prescription value,
// the question and its choices. A blocked row sends the user to Check the values and back.
import { TriangleAlert } from 'lucide-react';
import type { FieldEvidence, PrescriptionLine, ProposalChoice, ProposalRow, RoutineMedicine } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card, Panel } from '../../components/Card';
import { Pill } from '../../components/Pill';
import { cx } from '../../lib/cx';
import { howTaken } from '../passport/passportText';
import { blockedText, choiceLabel, kindPill, questionFor, rowName, shownChoices, type Voice } from './reviewText';

function Side({ label, medicine, empty }: { label: string; medicine: Pick<RoutineMedicine, 'productName' | 'instruction' | 'dosesPerDay' | 'form'> | PrescriptionLine | null; empty: string }) {
  return (
    <Panel>
      <p className="text-secondary font-semibold text-ink-3">{label}</p>
      {medicine ? (
        <>
          <p className="mt-1 font-semibold text-ink">{medicine.productName}</p>
          <p className="text-secondary text-ink-2">{howTaken(medicine)}</p>
        </>
      ) : (
        <p className="mt-1 text-ink-2">{empty}</p>
      )}
    </Panel>
  );
}

export interface ReviewRowCardProps {
  row: ProposalRow;
  voice: Voice;
  chosen: ProposalChoice | null;
  onChoose: (choice: ProposalChoice) => void;
  /** The flagged values of the row's line, when it is blocked. */
  flagged: FieldEvidence[];
  verifyHref: string;
}

export function ReviewRowCard({ row, voice, chosen, onChoose, flagged, verifyHref }: ReviewRowCardProps) {
  const titleId = `review-row-${row.id}`;
  const blocked = row.blockedByVerification ? blockedText(flagged) : null;
  return (
    <Card as="article" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="font-sans text-card-sm font-semibold">{rowName(row)}</h2>
        <Pill spec={kindPill(row)} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Side label="In the routine now" medicine={row.medicine} empty={row.kind === 'uncertain_match' ? 'No matching medicine found' : 'Not in the routine'} />
        <Side label="On this prescription" medicine={row.line} empty="Not listed on it" />
      </div>

      {blocked && (
        <div className="mt-4 flex flex-col gap-3 rounded-panel border border-amber-ink/50 bg-amber-tint p-4">
          <p className="flex items-start gap-2 text-ink">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-ink" />
            <span>{blocked.detail}</span>
          </p>
          <Button size="sm" className="self-start" to={verifyHref}>{blocked.action}</Button>
        </div>
      )}

      <fieldset className="mt-5">
        <legend className="text-[17px] font-semibold text-ink">{questionFor(row, voice)}</legend>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {shownChoices(row).map((c) => {
            const checked = chosen === c;
            return (
              <label
                key={c}
                className={cx(
                  'flex min-h-12 cursor-pointer items-center gap-3 rounded-button border px-4 py-2 font-semibold transition-colors',
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal',
                  checked ? 'border-teal bg-teal-tint text-teal-ink' : 'border-line bg-surface text-ink hover:bg-surface-muted',
                )}
              >
                <input
                  type="radio"
                  name={`choice-${row.id}`}
                  value={c}
                  checked={checked}
                  onChange={() => onChoose(c)}
                  className="size-5 shrink-0 accent-teal"
                />
                {choiceLabel(row, c, voice)}
              </label>
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
}
