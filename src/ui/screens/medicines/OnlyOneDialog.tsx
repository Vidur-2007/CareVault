import { useState } from 'react';
import type { IngredientTotal } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import type { Pronouns } from '../../lib/pronouns';
import { verb } from '../../lib/pronouns';

export interface OnlyOneDialogProps {
  total: IngredientTotal | null;
  pronouns: Pronouns;
  pending: boolean;
  onCancel: () => void;
  /** The product that is taken; the others are marked stopped. */
  onConfirm: (keepMedicineId: string) => void;
}

/** "He only takes one of these": choose which product is taken. */
export function OnlyOneDialog({ total, pronouns, pending, onCancel, onConfirm }: OnlyOneDialogProps) {
  const [choice, setChoice] = useState<string | null>(null);
  const keep = choice ?? total?.parts[0]?.medicineId ?? null;

  return (
    <Dialog
      open={total !== null}
      onClose={pending ? () => {} : onCancel}
      title={`Which one ${pronouns.subject === 'they' ? 'do' : 'does'} ${pronouns.subject} take?`}
      description="The others will be marked as stopped. You can change this later."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => keep && onConfirm(keep)} loading={pending} disabled={!keep}>
            Save
          </Button>
        </>
      }
    >
      {total && (
        <fieldset>
          <legend className="sr-only">Product that {pronouns.subject} {verb(pronouns, 'take')}</legend>
          <div className="flex flex-col gap-2">
            {total.parts.map((p) => (
              <label
                key={p.medicineId}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-button border border-line px-4 has-[:checked]:border-teal has-[:checked]:bg-teal-tint"
              >
                <input
                  type="radio"
                  name="only-one"
                  value={p.medicineId}
                  checked={keep === p.medicineId}
                  onChange={() => setChoice(p.medicineId)}
                  className="size-5 accent-teal"
                />
                <span className="font-semibold text-ink">{p.productName}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </Dialog>
  );
}
