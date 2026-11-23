// Possible duplicate ingredient (UI spec 4.8, overview 9.5): the products side by side, the daily
// total only when it is complete, and the fixed sentence. Never compared with any limit.
import type { IngredientTotal, RoutineMedicine } from '../../../contract/types';
import { Card, Panel } from '../../components/Card';
import { capitalize } from '../../components/lineText';
import { Pill } from '../../components/Pill';
import { POSSIBLE_DUPLICATE } from '../../components/pills';
import { formatNumber } from '../../lib/format';
import { DUPLICATE_SENTENCE, howTaken, ingredientsText, statusPill } from './passportText';

export function DuplicateCard({ total, medicines }: { total: IngredientTotal; medicines: RoutineMedicine[] }) {
  const headingId = `duplicate-${total.ingredient.replace(/\W+/g, '-')}`;
  const n = total.parts.length;
  const medicine = (id: string) => medicines.find((m) => m.id === id);
  const unit = total.unit;

  return (
    <Card as="article" tone="action" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Pill spec={POSSIBLE_DUPLICATE} />
        <h3 id={headingId} className="text-card-sm md:text-[22px]">
          {capitalize(total.ingredient)} in {n === 2 ? 'two' : n} medicines
        </h3>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {total.parts.map((part) => {
          const m = medicine(part.medicineId);
          return (
            <Panel key={part.medicineId} className="border border-line">
              <p className="font-semibold text-ink md:text-[18px]">{part.productName}</p>
              {m && (
                <>
                  <p className="mt-1 text-ink-2">{ingredientsText(m)}</p>
                  <p className="mt-3 text-secondary text-ink-3">
                    {howTaken(m)} · {statusPill(m).label.toLowerCase()}
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
              <p className="mt-2 font-semibold">No total: how often each is taken is not known for all of them</p>
              <ul className="mt-2 text-secondary">
                {total.parts.map((p) => {
                  const known = (medicine(p.medicineId)?.dosesPerDay ?? null) !== null;
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

      <p className="mt-5 text-ink-2">{DUPLICATE_SENTENCE}</p>
    </Card>
  );
}
