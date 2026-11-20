import { motion } from 'motion/react';
import type { PrescriptionDiffRow, PrescriptionLine, ReviewResolution } from '../../contract/legacy/types';
import { useMotionPresets } from '../app/motion';
import { cx } from '../lib/cx';
import { Button } from './Button';
import { Card } from './Card';
import { splitName, strengthText } from './lineText';
import { Pill } from './Pill';
import { diffPill } from './pills';

export interface DiffRowProps {
  row: PrescriptionDiffRow;
  /** Extra sentence under the cells (e.g. home-inventory context for a changed row). */
  footnote?: string;
  pending?: ReviewResolution | null;
  onResolve?: (resolution: ReviewResolution) => void;
}

/** One row of the prescription comparison: previous on the left, latest on the right. */
export function DiffRow({ row, footnote, pending = null, onResolve }: DiffRowProps) {
  const presets = useMotionPresets();
  const strengthChanged = row.kind === 'changed' && !!row.previous && !!row.latest && strengthText(row.previous.ingredients) !== strengthText(row.latest.ingredients);
  const instructionChanged = row.kind === 'changed' && !!row.previous && !!row.latest && row.previous.instruction !== row.latest.instruction;
  const note = footnote ?? (row.kind === 'review' ? row.note : null);

  return (
    <motion.div {...presets.reveal}>
      <Card as="article" tone={row.kind === 'review' ? 'action' : 'default'} className="!p-[18px] md:!p-6">
        <Pill spec={diffPill(row.kind, row)} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <LineCell side="previous" line={row.previous} kind={row.kind} strengthChanged={strengthChanged} instructionChanged={instructionChanged} />
          <LineCell side="latest" line={row.latest} kind={row.kind} strengthChanged={strengthChanged} instructionChanged={instructionChanged} />
        </div>
        {note && <p className="mt-4 text-ink-2">{note}</p>}
        {row.kind === 'review' && onResolve && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            {(
              [
                ['still_taking', 'Still taking', 'secondary'],
                ['stopped', 'Stopped', 'secondary'],
                ['ask_doctor', 'Ask the doctor', 'primary'],
              ] as const
            ).map(([resolution, label, variant]) => (
              <Button
                key={resolution}
                variant={variant}
                onClick={() => onResolve(resolution)}
                loading={pending === resolution}
                disabled={pending !== null && pending !== resolution}
                className={resolution === 'ask_doctor' ? 'col-span-2' : undefined}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function LineCell({
  side,
  line,
  kind,
  strengthChanged,
  instructionChanged,
}: {
  side: 'previous' | 'latest';
  line: PrescriptionLine | null;
  kind: PrescriptionDiffRow['kind'];
  strengthChanged: boolean;
  instructionChanged: boolean;
}) {
  const sideLabel = side === 'previous' ? 'Previous prescription' : 'Latest prescription';
  if (!line) {
    const reviewMissing = kind === 'review' && side === 'latest';
    return (
      <div
        className={cx(
          'rounded-panel border border-dashed p-4',
          reviewMissing ? 'border-red-line text-red-ink' : 'border-line-strong/60 text-ink-3',
        )}
      >
        <span className="sr-only">{sideLabel}: </span>
        Not on this prescription
      </div>
    );
  }
  const { base, strength } = splitName(line.productName, line.ingredients);
  const tint =
    side === 'latest' && kind === 'added' ? 'bg-blue-tint/60' : side === 'latest' && kind === 'changed' ? 'bg-amber-tint/70' : 'bg-surface-muted';

  return (
    <div className={cx('rounded-panel p-4', tint)}>
      <span className="sr-only">{sideLabel}: </span>
      <p className="font-semibold text-ink md:text-[18px]">
        {base}{' '}
        {strength &&
          (strengthChanged ? (
            side === 'previous' ? (
              <s className="text-ink-3">
                <span className="sr-only">was </span>
                {strength}
              </s>
            ) : (
              <mark className="rounded-[6px] bg-amber-tint px-1.5 text-ink ring-1 ring-amber-ink/20">
                <span className="sr-only">now </span>
                {strength}
              </mark>
            )
          ) : (
            strength
          ))}
      </p>
      <p className="mt-1 text-ink-2">
        {instructionChanged ? (
          side === 'previous' ? (
            <s className="text-ink-3">{line.instruction}</s>
          ) : (
            <mark className="rounded-[6px] bg-amber-tint px-1.5 text-ink">{line.instruction}</mark>
          )
        ) : (
          line.instruction
        )}
      </p>
    </div>
  );
}
