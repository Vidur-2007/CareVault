import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Medicine } from '../../contract/types';
import { cx } from '../lib/cx';
import { ingredientLine } from './lineText';
import { Pill } from './Pill';
import { medicineStatusPill } from './pills';

export interface MedicineRowProps {
  medicine: Medicine;
  prescriberName?: string | null;
  /** Extra detail after the instruction, e.g. "not on Dr. Rao's prescription of 28 Oct". */
  detail?: ReactNode;
  actions?: ReactNode;
  /** Link the name to the medicine detail page. Default true. */
  linked?: boolean;
  showPill?: boolean;
  className?: string;
}

export function MedicineRow({ medicine, prescriberName, detail, actions, linked = true, showPill = true, className }: MedicineRowProps) {
  const name = (
    <span className="font-semibold text-ink md:text-[18px]">{medicine.productName}</span>
  );
  const meta = [medicine.instruction || null, prescriberName ?? null].filter(Boolean).join(' · ');
  const ingredients = ingredientLine(medicine.ingredients);
  const showIngredients = ingredients.toLowerCase() !== medicine.productName.toLowerCase();

  return (
    <div className={cx('flex flex-col gap-4 rounded-card-sm border border-line bg-surface p-[18px] shadow-card wide:flex-row wide:items-center md:rounded-card md:px-7 md:py-6', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {linked ? (
            <Link to={`/medicines/${medicine.id}`} className="hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          {showPill && <Pill spec={medicineStatusPill(medicine)} />}
          {medicine.fieldState === 'extracted' && <Pill tone="check">Check this</Pill>}
        </div>
        {showIngredients && <p className="mt-1 text-secondary text-ink-3 md:text-body-sm">{ingredients}</p>}
        {(meta || detail) && (
          <p className="mt-1 text-ink-2">
            {meta}
            {meta && detail ? ' · ' : null}
            {detail}
          </p>
        )}
      </div>
      {actions && <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap wide:shrink-0 wide:justify-end">{actions}</div>}
    </div>
  );
}
