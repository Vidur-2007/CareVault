// Step after a prescription upload: one card per extracted line (reusing the phase 3 form fields),
// with add and remove, beside the original. Calls onSubmit with every line once all are valid.
import { CheckCheck, Plus, Trash2 } from 'lucide-react';
import { useId, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { ExtractedLine } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LineFields } from '../../components/lineForm/LineFields';
import { EMPTY_LINE, focusFirstLineError } from '../../components/lineForm/lineDraft';
import { useLineDraft } from '../../components/lineForm/useLineDraft';
import { SourceViewer } from '../../components/SourceViewer';

interface LineCardHandle {
  /** Validates the line; focuses its first error and returns null when something is wrong. */
  submit: () => ExtractedLine | null;
}

function LineCard({
  index,
  initial,
  fromExtraction,
  canRemove,
  disabled,
  onRemove,
  ref,
}: {
  index: number;
  initial: ExtractedLine;
  fromExtraction: boolean;
  canRemove: boolean;
  disabled: boolean;
  onRemove: () => void;
  ref: Ref<LineCardHandle>;
}) {
  const state = useLineDraft(initial, fromExtraction);
  const idPrefix = `rxline${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const titleId = `${idPrefix}-title`;
  useImperativeHandle(ref, () => ({
    submit: () => {
      const line = state.submit();
      if (!line) focusFirstLineError(state.draft, idPrefix);
      return line;
    },
  }));

  return (
    <Card as="article" aria-labelledby={titleId} className="!p-[18px] md:!p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-card-sm">
          Line {index + 1}
          {state.draft.productName.trim() && <span className="font-normal text-ink-3"> · {state.draft.productName.trim()}</span>}
        </h3>
        <div className="flex flex-wrap gap-1">
          {state.unchecked.size > 0 && (
            <Button variant="quiet" size="sm" icon={<CheckCheck aria-hidden className="size-4" />} onClick={state.confirmAll} disabled={disabled}>
              This line matches
            </Button>
          )}
          {canRemove && (
            <Button
              variant="quiet"
              size="sm"
              icon={<Trash2 aria-hidden className="size-4" />}
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Remove line ${index + 1}`}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <LineFields state={state} idPrefix={idPrefix} disabled={disabled} nameHint="As written on the prescription" />
    </Card>
  );
}

export interface PrescriptionLinesStepProps {
  file: Blob;
  sourceLabel: string;
  lines: ExtractedLine[];
  fromExtraction: boolean;
  doctorName: string;
  pending: boolean;
  onSubmit: (lines: ExtractedLine[]) => void;
}

let rowSeq = 0;

export function PrescriptionLinesStep({ file, sourceLabel, lines, fromExtraction, doctorName, pending, onSubmit }: PrescriptionLinesStepProps) {
  const [rows, setRows] = useState(() =>
    (lines.length ? lines : [EMPTY_LINE]).map((line) => ({ key: `row${++rowSeq}`, line, fromExtraction: fromExtraction && lines.length > 0 })),
  );
  const handles = useRef(new Map<string, LineCardHandle>());

  const submit = () => {
    const out: ExtractedLine[] = [];
    for (const row of rows) {
      const line = handles.current.get(row.key)?.submit() ?? null;
      if (!line) return;
      out.push(line);
    }
    onSubmit(out);
  };

  return (
    <SourceViewer file={file} label={sourceLabel}>
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-ink-2">
            Check each medicine against the original. When you save, this prescription is compared with the previous one from{' '}
            {doctorName}. Nothing is marked stopped automatically.
          </p>
          {fromExtraction && lines.length > 0 && (
            <p className="mt-2 text-secondary text-amber-ink">Fields marked “Check this” were read automatically.</p>
          )}
        </div>
        {rows.map((row, i) => (
          <LineCard
            key={row.key}
            ref={(h) => {
              if (h) handles.current.set(row.key, h);
              else handles.current.delete(row.key);
            }}
            index={i}
            initial={row.line}
            fromExtraction={row.fromExtraction}
            canRemove={rows.length > 1}
            disabled={pending}
            onRemove={() => setRows((r) => r.filter((x) => x.key !== row.key))}
          />
        ))}
        <Button
          variant="secondary"
          className="self-start"
          icon={<Plus aria-hidden className="size-5" />}
          disabled={pending}
          onClick={() => setRows((r) => [...r, { key: `row${++rowSeq}`, line: EMPTY_LINE, fromExtraction: false }])}
        >
          Add a line
        </Button>
        <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
          <Button onClick={submit} loading={pending}>
            Save and compare
          </Button>
        </div>
      </div>
    </SourceViewer>
  );
}
