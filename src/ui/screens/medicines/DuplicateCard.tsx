import type { IngredientTotal, Medicine } from '../../../contract/legacy/types';
import { Button } from '../../components/Button';
import { Card, Panel } from '../../components/Card';
import { capitalize } from '../../components/lineText';
import { Pill } from '../../components/Pill';
import { POSSIBLE_DUPLICATE } from '../../components/pills';
import { formatNumber } from '../../lib/format';
import type { Pronouns } from '../../lib/pronouns';
import { pronounsFor, verb } from '../../lib/pronouns';
import { numberWord } from '../review/copy';
import { STATUS_PHRASE, dosesText, strengthPerUnit } from './medicineText';

/** Exact sentence required under every duplicate card (UI spec 7.3). */
export const DUPLICATE_SAFETY_SENTENCE =
  'CareVault adds up what was entered. It does not judge whether a dose is safe. Please verify with a pharmacist or the prescriber.';

export interface DuplicateCardProps {
  total: IngredientTotal;
  /** The medicines named in total.parts. */
  medicines: Medicine[];
  pronouns?: Pronouns;
  onAddQuestion?: () => void;
  addQuestionPending?: boolean;
  onOnlyOne?: () => void;
  headingLevel?: 2 | 3;
}

/**
 * One ingredient found in two or more active medicines: the products side by side and the
 * daily total "if all are taken as entered". The total is shown only when it is complete.
 */
export function DuplicateCard({
  total,
  medicines,
  pronouns = pronounsFor(null),
  onAddQuestion,
  addQuestionPending = false,
  onOnlyOne,
  headingLevel = 3,
}: DuplicateCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = `duplicate-${total.ingredient.replace(/\W+/g, '-')}`;
  const ingredient = capitalize(total.ingredient);
  const n = total.parts.length;
  const medicine = (id: string) => medicines.find((m) => m.id === id);
  const unit = total.unit;

  return (
    <Card as="article" tone="action" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Pill spec={POSSIBLE_DUPLICATE} />
        <Heading id={headingId} className="text-card-sm md:text-[22px]">
          {ingredient} appears in {numberWord(n, false)} products
        </Heading>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {total.parts.map((part) => {
          const m = medicine(part.medicineId);
          return (
            <Panel key={part.medicineId} className="border border-line">
              <p className="font-semibold text-ink md:text-[18px]">{part.productName}</p>
              {m && (
                <>
                  <p className="mt-1 text-ink-2">{strengthPerUnit(m)}</p>
                  <p className="mt-3 text-secondary text-ink-3">
                    {dosesText(m)} · {STATUS_PHRASE[m.status]}
                  </p>
                </>
              )}
            </Panel>
          );
        })}

        <div className="rounded-panel bg-red-tint p-4 text-red-ink md:p-5">
          <p className="text-secondary font-semibold">{n === 2 ? 'If both are taken as entered' : 'If all are taken as entered'}</p>
          {total.complete ? (
            <>
              <p data-testid="duplicate-total" className="mt-1 font-heading text-[28px] font-bold leading-tight md:text-[32px]">
                {formatNumber(total.perDay)} {unit} a day
              </p>
              <p className="mt-1 text-secondary">
                {total.parts.map((p) => `${formatNumber(p.perDay)} ${unit}`).join(' + ')} of {total.ingredient}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 font-semibold">Add how often each is taken to see a total</p>
              <ul className="mt-2 text-secondary">
                {total.parts.map((p) => {
                  const m = medicine(p.medicineId);
                  const known = m ? m.dosesPerDay !== null : p.perDay > 0;
                  return (
                    <li key={p.medicineId}>
                      {p.productName}: {known ? `${formatNumber(p.perDay)} ${unit} a day as entered` : 'how often not entered'}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      <p className="mt-5 text-ink-2">{DUPLICATE_SAFETY_SENTENCE}</p>

      {(onAddQuestion || onOnlyOne) && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {onAddQuestion && (
            <Button onClick={onAddQuestion} loading={addQuestionPending}>
              Add to questions for the doctor
            </Button>
          )}
          {onOnlyOne && (
            <Button variant="secondary" onClick={onOnlyOne} disabled={addQuestionPending}>
              {capitalize(pronouns.subject)} only {verb(pronouns, 'take')} one of these
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
