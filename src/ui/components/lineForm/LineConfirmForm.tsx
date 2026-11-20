import { CheckCheck } from 'lucide-react';
import { useId } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ExtractedLine } from '../../../contract/legacy/types';
import { Button } from '../Button';
import { SourceViewer } from '../SourceViewer';
import { focusFirstLineError } from './lineDraft';
import { LineFields } from './LineFields';
import { useLineDraft } from './useLineDraft';

export interface LineFormAction {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary';
}

export interface LineConfirmFormProps {
  /** The original photo or PDF; null while loading; undefined when the line is typed by hand. */
  source?: Blob | null;
  sourceLabel?: string;
  line: ExtractedLine;
  /** The values came from reading the document, so every field starts as "Check this". */
  fromExtraction: boolean;
  title?: ReactNode;
  /** The last action is the default (Enter submits it). */
  actions: LineFormAction[];
  pendingAction?: string | null;
  onSubmit: (line: ExtractedLine, actionId: string) => void;
}

/**
 * Confirm step used by the scan flow (7.4) and, in phase 4, by prescription lines:
 * the original beside editable fields, "Check this" on extracted fields, warnings under fields.
 */
export function LineConfirmForm({
  source,
  sourceLabel = 'Original document',
  line,
  fromExtraction,
  title,
  actions,
  pendingAction = null,
  onSubmit,
}: LineConfirmFormProps) {
  const state = useLineDraft(line, fromExtraction);
  const idPrefix = `line${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const busy = pendingAction !== null;
  const defaultAction = actions[actions.length - 1]?.id ?? 'save';

  const run = (actionId: string) => {
    const result = state.submit();
    if (!result) {
      focusFirstLineError(state.draft, idPrefix);
      return;
    }
    state.confirmAll();
    onSubmit(result, actionId);
  };

  const fields = (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        run(defaultAction);
      }}
      className="flex flex-col gap-6"
    >
      {title}
      {state.unchecked.size > 0 && (
        <div className="flex flex-col gap-2 rounded-panel bg-amber-tint/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-secondary text-amber-ink">
            Fields marked “Check this” were read automatically. Compare each one with the original before saving.
          </p>
          <Button variant="quiet" size="sm" icon={<CheckCheck aria-hidden className="size-4" />} onClick={state.confirmAll} disabled={busy} className="shrink-0">
            Everything matches the original
          </Button>
        </div>
      )}
      <LineFields state={state} idPrefix={idPrefix} disabled={busy} />
      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:flex-wrap sm:justify-end">
        {actions.map((a) => (
          <Button
            key={a.id}
            variant={a.variant ?? 'primary'}
            loading={pendingAction === a.id}
            disabled={busy && pendingAction !== a.id}
            onClick={() => run(a.id)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </form>
  );

  if (source === undefined) return fields;
  return (
    <SourceViewer file={source} label={sourceLabel}>
      {fields}
    </SourceViewer>
  );
}
