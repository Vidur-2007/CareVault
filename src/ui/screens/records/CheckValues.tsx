// Check the values, UI spec 4.6: the original beside each value that still needs a look, with the
// literal text read, the reasons, its page, and Correct / It is right / Leave unknown / Retake the
// photo. All decisions are sent at once with documents.reviewFields.
import { Camera, Eye } from 'lucide-react';
import { useId, useState } from 'react';
import type { CriticalField, FieldDecision, FieldEvidence } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorPanel } from '../../components/ErrorPanel';
import { Field } from '../../components/Field';
import { Pill } from '../../components/Pill';
import { SkeletonList } from '../../components/Skeleton';
import { useProfile } from '../../hooks/useContexts';
import { useOriginal } from '../../hooks/useOriginal';
import { useServiceAction } from '../../hooks/useServiceAction';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate } from '../../lib/format';
import { DocumentPreview } from './DocumentPreview';
import { DOSE_UNITS, fieldTitle, groupFields, isOpen, lineTitle, parseCorrection, statusLabel } from './checkText';

type Decision = { action: FieldDecision['action']; value?: string; label: string };

export interface CheckValuesProps {
  documentId: string;
  /** Called after the decisions are saved, with the record's fields as they are now. */
  onSaved: (fields: FieldEvidence[]) => void;
  /** Offered on photos. Pending decisions are saved first, so the retake keeps them. */
  onRetake?: () => void;
  /** A way past this step without saving, e.g. "Check later". */
  onSkip?: { label: string; run: () => void };
  saveLabel?: string;
}

const unitOf = (e: FieldEvidence, all: FieldEvidence[]) =>
  all.find((x) => x.field === 'unit' && x.lineIndex === e.lineIndex && x.ingredientIndex === e.ingredientIndex);

function shown(field: CriticalField, value: string, unit?: string | null): string {
  if (field === 'strength') return unit ? `${value} ${unit}` : value;
  if (field === 'document_date') return formatDate(value);
  if (field === 'frequency') return `${value} a day`;
  return value;
}

export function CheckValues({ documentId, onSaved, onRetake, onSkip, saveLabel = 'Save the checks' }: CheckValuesProps) {
  const doc = useServiceQuery((s) => s.documents.get(documentId), [documentId]);
  const fields = useServiceQuery((s) => s.documents.fields(documentId), [documentId]);
  const original = useOriginal(documentId, true);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [jump, setJump] = useState<{ page: number } | null>(null);
  const save = useServiceAction((s, list: FieldDecision[]) => s.documents.reviewFields(documentId, list), {
    errorPrefix: 'The checks could not be saved',
  });

  if (doc.loading || fields.loading) return <SkeletonList count={2} label="Loading the values to check" />;
  if (doc.error || fields.error || !doc.data) {
    return <ErrorPanel title="The values could not be loaded" message={(doc.error ?? fields.error)?.message} onRetry={() => { doc.reload(); fields.reload(); }} />;
  }

  const all = fields.data ?? [];
  const open = all.filter(isOpen);
  const checked = all.filter((e) => !isOpen(e));
  const isPhoto = doc.data.mimeType.startsWith('image/');
  const decided = Object.keys(decisions).length;
  const flaggedLeft = open.filter((e) => e.status === 'needs_verification' && !decisions[e.id]).length;

  const decide = (id: string, d: Decision | null) =>
    setDecisions((all) => {
      const next = { ...all };
      if (d) next[id] = d;
      else delete next[id];
      return next;
    });

  const send = async () => {
    const list = Object.entries(decisions).map(([evidenceId, d]): FieldDecision => ({ evidenceId, action: d.action, ...(d.value !== undefined ? { value: d.value } : {}) }));
    if (list.length === 0) return all;
    const result = await save.run(list);
    if (result) setDecisions({});
    return result;
  };

  return (
    <div className="grid gap-6 wide:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] wide:gap-8">
      <div className="wide:sticky wide:top-28 wide:self-start">
        <DocumentPreview
          key={documentId}
          file={original.blob}
          title={doc.data.title}
          jumpTo={jump}
          compact
          error={original.error ? `The file could not be opened. ${original.error.message}` : null}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {open.length === 0 ? (
          <Card>
            <h2 className="font-sans text-card-sm font-semibold">Every value is checked</h2>
            <p className="mt-2 text-ink-2">Nothing on this record waits for a check.</p>
          </Card>
        ) : (
          groupFields(open).map((group) => {
            // Flagged values first; the values read cleanly can be confirmed together.
            const ordered = [...group.fields].sort((a, b) => Number(b.status === 'needs_verification') - Number(a.status === 'needs_verification'));
            const clean = group.fields.filter((e) => e.status === 'extracted' && !decisions[e.id]);
            const title = lineTitle(group.lineIndex, all);
            return (
            <section key={String(group.lineIndex)} aria-label={title} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-sans text-card-sm font-semibold md:text-card">{title}</h2>
                {clean.length > 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${title}: the ${clean.length} values read automatically look right`}
                    onClick={() => setDecisions((d) => ({ ...d, ...Object.fromEntries(clean.map((e) => [e.id, { action: 'confirm' as const, label: 'It is right' }])) }))}
                  >
                    These {clean.length} look right
                  </Button>
                )}
              </div>
              {ordered.map((e) => (
                <FieldCheck
                  key={e.id}
                  evidence={e}
                  all={all}
                  decision={decisions[e.id] ?? null}
                  onDecide={(d) => decide(e.id, d)}
                  onUnit={(unitEvidence, value) => {
                    // Choosing the unit with the strength answers the unit too.
                    if (!unitEvidence || !isOpen(unitEvidence)) return;
                    decide(unitEvidence.id, value === unitEvidence.value
                      ? { action: 'confirm', label: 'It is right' }
                      : { action: 'correct', value, label: `Corrected to ${value}` });
                  }}
                  onShow={() => setJump({ page: e.page ?? 1 })}
                  onRetake={isPhoto && onRetake ? async () => {
                    if (await send()) onRetake();
                  } : undefined}
                />
              ))}
            </section>
            );
          })
        )}

        {checked.length > 0 && (
          <details className="rounded-panel border border-line bg-surface px-4 py-3">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink">
              {checked.length === 1 ? 'One value already checked' : `${checked.length} values already checked`}
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {checked.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-ink-2">
                  <span>
                    {e.lineIndex !== null && <span className="text-ink-3">Medicine {e.lineIndex + 1} · </span>}
                    {fieldTitle({ field: e.field, status: 'extracted' }).replace(' read automatically', '')}:{' '}
                    <span className="font-semibold text-ink">{e.value === null ? 'unknown' : shown(e.field, e.value, unitOf(e, all)?.value)}</span>
                  </span>
                  <Pill tone={e.status === 'unknown' ? 'grey' : 'teal'}>{statusLabel(e.status)}</Pill>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="sticky bottom-24 z-10 flex flex-col gap-3 rounded-panel border border-line bg-surface p-4 shadow-card md:bottom-4">
          <p aria-live="polite" className="text-secondary text-ink-2">
            {decided === 0
              ? open.length ? 'Choose an answer for each value you can check.' : 'Nothing to save.'
              : `${decided === 1 ? 'One answer' : `${decided} answers`} ready to save.`}
            {flaggedLeft > 0 && ` ${flaggedLeft === 1 ? 'One flagged value still needs' : `${flaggedLeft} flagged values still need`} a look.`}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              loading={save.pending}
              disabled={decided === 0 && open.length > 0}
              onClick={async () => {
                const result = await send();
                if (result) onSaved(result);
              }}
            >
              {saveLabel}
            </Button>
            {onSkip && (
              <Button variant="secondary" onClick={onSkip.run} disabled={save.pending}>
                {onSkip.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface FieldCheckProps {
  evidence: FieldEvidence;
  all: FieldEvidence[];
  decision: Decision | null;
  onDecide: (d: Decision | null) => void;
  onUnit: (unitEvidence: FieldEvidence | undefined, value: string) => void;
  onShow: () => void;
  onRetake?: () => void;
}

function FieldCheck({ evidence: e, all, decision, onDecide, onUnit, onShow, onRetake }: FieldCheckProps) {
  const { today } = useProfile();
  const titleId = useId();
  const hintId = useId();
  const unitEvidence = e.field === 'strength' ? unitOf(e, all) : undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.value ?? '');
  const [unit, setUnit] = useState(unitEvidence?.value ?? 'mg');
  const [error, setError] = useState<string | null>(null);
  const flagged = e.status === 'needs_verification';

  const useValue = () => {
    const parsed = parseCorrection(e.field, draft, today);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setEditing(false);
    onDecide({ action: 'correct', value: parsed.value, label: `Corrected to ${shown(e.field, parsed.value, e.field === 'strength' ? unit : null)}` });
    if (e.field === 'strength') onUnit(unitEvidence, unit);
  };

  const inputLabel = `Correct ${fieldTitle({ field: e.field, status: 'extracted' }).replace(' read automatically', '').toLowerCase()}`;

  return (
    <article aria-labelledby={titleId} className={`rounded-card-sm border bg-surface p-[18px] md:p-6 ${flagged && !decision ? 'border-red-line' : 'border-line'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="font-sans text-card-sm font-semibold">{fieldTitle(e)}</h3>
        {decision ? <Pill tone="teal">{decision.label}</Pill> : flagged ? <Pill tone="check">Check this value</Pill> : <Pill tone="amber">Read automatically</Pill>}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-ink-2">
        Read on the document:
        <code className="rounded-[6px] border border-line bg-surface-muted px-2 py-0.5 font-mono text-[15px] text-ink">{e.raw ?? 'nothing readable'}</code>
      </p>
      {e.value !== null && e.value !== e.raw && (
        <p className="mt-1 text-secondary text-ink-2">
          Read as: <span className="font-semibold text-ink">{shown(e.field, e.value, unitEvidence?.value)}</span>
        </p>
      )}
      {e.reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-secondary text-ink-2">
          {e.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-secondary text-ink-3">
        Page {e.page ?? 1}
        <Button size="sm" variant="quiet" icon={<Eye aria-hidden className="size-4" />} onClick={onShow}>
          Show on the original
        </Button>
      </p>

      {decision && !editing ? (
        <Button size="sm" variant="secondary" className="mt-4" onClick={() => onDecide(null)}>
          Change the answer
        </Button>
      ) : editing ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field
              label={inputLabel}
              type={e.field === 'document_date' ? 'date' : 'text'}
              inputMode={e.field === 'strength' || e.field === 'frequency' ? 'decimal' : undefined}
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              error={error}
              autoComplete="off"
              className="flex-1"
              autoFocus
            />
            {e.field === 'strength' && (
              <Field as="select" label="Unit" value={unit} onChange={(ev) => setUnit(ev.target.value)} options={DOSE_UNITS.map((u) => ({ value: u, label: u }))} className="sm:w-32" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={useValue}>Use this value</Button>
            <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Correct</Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={e.value === null}
            aria-describedby={e.value === null ? hintId : undefined}
            onClick={() => onDecide({ action: 'confirm', label: 'It is right' })}
          >
            It is right
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onDecide({ action: 'leave_unknown', label: 'Left unknown' })}>Leave unknown</Button>
          {onRetake && (
            <Button size="sm" variant="quiet" icon={<Camera aria-hidden className="size-4" />} onClick={onRetake}>
              Retake the photo
            </Button>
          )}
          {e.value === null && <p id={hintId} className="w-full text-secondary text-ink-3">Nothing clear was read, so there is nothing to confirm. Correct it or leave it unknown.</p>}
        </div>
      )}
    </article>
  );
}
