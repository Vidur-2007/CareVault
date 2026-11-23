// Add a record, UI spec 4.4: one flow for camera, file and Gmail. The original is saved first
// (documents.add), so leaving at any later step keeps it as "Not yet filed".
//   capture → saved (duplicate?) → reading (consent? locked?) → details → check the values →
//   prescription: save prescription | pack photo: add to the routine? | other: file it → done
import { ArrowLeft, CircleCheck, FileWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type {
  DocumentRecord, DuplicateInfo, ExtractedLine, ExtractionCandidate, FieldEvidence, RoutineProposal,
} from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CloudConsentPanel } from '../components/CloudConsentPanel';
import { ErrorPanel } from '../components/ErrorPanel';
import { Field } from '../components/Field';
import { Pill } from '../components/Pill';
import { ReadingProgress } from '../components/ReadingProgress';
import { toServiceError } from '../hooks/toServiceError';
import { useCloudNotice, useProfile, useServices, useToast } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDate } from '../lib/format';
import { pronounsFor, verb } from '../lib/pronouns';
import { carryDecisions, isPack, linesWithChecks, needsCheck } from './records/checkText';
import { CheckValues } from './records/CheckValues';
import { CaptureStep } from './records/add/CaptureStep';
import { DetailsStep } from './records/add/DetailsStep';
import type { DetailsNotice } from './records/add/DetailsStep';
import { GmailStep } from './records/add/GmailStep';

type Added = { record: DocumentRecord; duplicate: DuplicateInfo | null };
type After = 'prescription' | 'pack' | 'file';

type Step =
  | { name: 'capture' }
  | { name: 'gmail' }
  | { name: 'saving' }
  | { name: 'duplicate'; added: Added }
  | { name: 'reading'; record: DocumentRecord; cloud: boolean }
  | { name: 'consent'; record: DocumentRecord }
  | { name: 'readError'; record: DocumentRecord; message: string }
  | { name: 'details'; record: DocumentRecord; notice: DetailsNotice }
  | { name: 'check'; record: DocumentRecord; after: After }
  | { name: 'prescription'; record: DocumentRecord; lines: ExtractedLine[] }
  | { name: 'pack'; record: DocumentRecord; line: ExtractedLine }
  | { name: 'file'; record: DocumentRecord }
  | { name: 'done'; record: DocumentRecord; message: string; proposal?: RoutineProposal | null };

const CLOUD_MESSAGE = 'Sending this one page to the cloud reader';

export function AddRecordScreen() {
  useDocumentTitle('Add a record');
  const services = useServices();
  const cloud = useCloudNotice();
  const toast = useToast();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const pid = profile!.id;
  const self = profile!.relation === 'Myself';
  const they = pronounsFor(profile!.relation);
  const [params] = useSearchParams();

  const [step, setStep] = useState<Step>({ name: 'capture' });
  const [candidate, setCandidate] = useState<ExtractionCandidate | null>(null);
  const [retake, setRetake] = useState<DocumentRecord | null>(null);
  const [queue, setQueue] = useState<Added[]>([]);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // "Retake the photo" from Check the values arrives with ?retake=<earlier record id>.
  const retakeId = params.get('retake');
  useEffect(() => {
    if (!retakeId) return;
    let cancelled = false;
    services.documents.get(retakeId).then((d) => !cancelled && d.profileId === pid && setRetake(d), () => {});
    return () => {
      cancelled = true;
    };
  }, [services, retakeId, pid]);

  // Each step change moves focus to the step's heading, for screen readers and keyboards.
  useEffect(() => {
    heading.current?.focus();
  }, [step.name]);

  const fail = (err: unknown) => toast.show({ message: toServiceError(err).message, tone: 'error' });

  /** "Not now" on the review offer (4.4): the review is put off and stays reopenable from the record (4.7). */
  async function putOff(recordId: string, proposalId: string) {
    try {
      await services.routine.dismiss(proposalId);
    } catch (err) {
      fail(err);
      return;
    }
    navigate(`/records/${recordId}`);
  }

  // ---------- steps 2 and 3: saved, then read ----------

  async function read(record: DocumentRecord, allowCloud = false) {
    setStep({ name: 'reading', record, cloud: allowCloud });
    try {
      const run = () => services.reading.read(record.id, { allowCloud });
      let found = allowCloud ? await cloud.run(CLOUD_MESSAGE, run) : await run();
      if (found.needsCloud && !allowCloud) {
        setStep({ name: 'consent', record });
        return;
      }
      if (retake) {
        // Keep every decision made on the earlier photo (UI spec 4.6).
        const decisions = carryDecisions(await services.documents.fields(retake.id), found.fields);
        if (decisions.length) found = { ...found, fields: await services.documents.reviewFields(record.id, decisions) };
      }
      setCandidate(found);
      setStep({ name: 'details', record: await services.documents.get(record.id), notice: null });
    } catch (err) {
      const e = toServiceError(err);
      if (e.code === 'cloud_consent_required') setStep({ name: 'consent', record });
      else if (e.code === 'locked_pdf') {
        setCandidate(null);
        setStep({ name: 'details', record, notice: 'locked' });
      } else setStep({ name: 'readError', record, message: e.message });
    }
  }

  function afterSaved(added: Added) {
    if (added.duplicate) setStep({ name: 'duplicate', added });
    else void read(added.record);
  }

  async function addFile(file: File, source: DocumentRecord['source']) {
    setStep({ name: 'saving' });
    try {
      afterSaved(await services.documents.add(pid, file, { source }));
    } catch (err) {
      fail(err);
      setStep({ name: 'capture' });
    }
  }

  function startNext(rest: Added[]) {
    setCandidate(null);
    setQueue(rest.slice(1));
    if (rest.length) afterSaved(rest[0]);
    else setStep({ name: 'capture' });
  }

  async function removeAnd(record: DocumentRecord, then: () => void) {
    setBusy(true);
    try {
      await services.documents.remove(record.id);
      then();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  // ---------- after the details: check, then the ending for the kind ----------

  function afterFor(record: DocumentRecord): After {
    const lines = candidate?.lines ?? [];
    if (record.kind === 'prescription' && lines.length > 0) return 'prescription';
    if (isPack(record.kind, lines)) return 'pack';
    return 'file';
  }

  function goAfter(record: DocumentRecord, after: After, fields: FieldEvidence[]) {
    const lines = linesWithChecks(candidate?.lines ?? [], fields);
    if (after === 'prescription') setStep({ name: 'prescription', record, lines });
    else if (after === 'pack') setStep({ name: 'pack', record, line: lines[0] });
    else setStep({ name: 'file', record });
  }

  async function detailsSaved(record: DocumentRecord) {
    try {
      const fields = await services.documents.fields(record.id);
      const after = afterFor(record);
      if (needsCheck(fields)) setStep({ name: 'check', record, after });
      else goAfter(record, after, fields);
    } catch (err) {
      fail(err);
    }
  }

  async function fileAndFinish(record: DocumentRecord, message: string, proposal?: RoutineProposal | null) {
    const filed = await services.documents.fileRecord(record.id);
    setStep({ name: 'done', record: filed, message, proposal });
  }

  const back = (
    <Link to="/records" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
      <ArrowLeft aria-hidden className="size-5" />
      Records
    </Link>
  );

  let title = 'Add a record';
  let body: ReactNode = null;

  switch (step.name) {
    case 'capture':
      body = <CaptureStep retakeTitle={retake?.title ?? null} onFile={(f, s) => void addFile(f, s)} onGmail={() => setStep({ name: 'gmail' })} />;
      break;
    case 'gmail':
      body = <GmailStep onCancel={() => setStep({ name: 'capture' })} onImported={(results) => startNext(results)} />;
      break;
    case 'saving':
      body = <p role="status" className="text-ink-2">Saving the original on this device…</p>;
      break;
    case 'duplicate': {
      const { record, duplicate } = step.added;
      title = 'Already in the records';
      body = (
        <Card as="section" aria-labelledby="duplicate-title">
          <h2 id="duplicate-title" className="font-sans text-card-sm font-semibold">
            This file is already in the records (added {formatDate(duplicate!.existingAddedAt)})
          </h2>
          <p className="mt-2 text-ink-2">It is the same file as &ldquo;{duplicate!.existingTitle}&rdquo;.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => void removeAnd(record, () => navigate(`/records/${duplicate!.existingId}`))} loading={busy}>
              Use the existing record
            </Button>
            <Button variant="secondary" onClick={() => void read(record)} disabled={busy}>
              Keep both
            </Button>
            <Button variant="secondary" onClick={() => void removeAnd(record, () => startNext(queue))} disabled={busy}>
              Cancel
            </Button>
          </div>
        </Card>
      );
      break;
    }
    case 'reading':
      body = (
        <div className="flex flex-col gap-4">
          <p className="font-semibold text-teal-ink">
            <CircleCheck aria-hidden className="mr-2 inline size-5" />
            Saved. {step.cloud ? 'Reading it with the cloud reader…' : 'Reading it on this device…'}
          </p>
          <ReadingProgress
            what={step.record.mimeType.startsWith('image/') ? 'photo' : 'document'}
            fileName={step.record.title}
            onManual={() => setStep({ name: 'details', record: step.record, notice: 'manual' })}
          />
        </div>
      );
      break;
    case 'consent':
      body = (
        <CloudConsentPanel
          sending={false}
          sendingMessage={CLOUD_MESSAGE}
          onSend={() => void read(step.record, true)}
          onRetake={step.record.mimeType.startsWith('image/') ? () => {
            setRetake(step.record);
            setStep({ name: 'capture' });
          } : undefined}
          onManual={() => {
            setCandidate(null);
            setStep({ name: 'details', record: step.record, notice: 'manual' });
          }}
        />
      );
      break;
    case 'readError':
      body = (
        <div className="flex flex-col gap-4">
          <ErrorPanel title="It is saved, but it could not be read" message={step.message} onRetry={() => void read(step.record)} />
          <Button variant="secondary" className="self-start" onClick={() => setStep({ name: 'details', record: step.record, notice: 'manual' })}>
            Enter by hand
          </Button>
        </div>
      );
      break;
    case 'details':
      title = 'The details';
      body = (
        <div className="flex flex-col gap-6">
          {retake && (
            <Card tone="muted">
              <p className="text-ink-2">
                The new photo is saved as its own record, with your earlier checks applied. The earlier photo is still in Records.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => void removeAnd(retake, () => {
                  toast.show({ message: 'The earlier photo was removed', tone: 'success' });
                  setRetake(null);
                })}
                loading={busy}
              >
                Remove the earlier photo
              </Button>
            </Card>
          )}
          <DetailsStep
            key={step.record.id}
            record={step.record}
            candidate={candidate}
            notice={step.notice}
            onSaved={(r) => void detailsSaved(r)}
            onGone={(message) => {
              toast.show({ message, tone: 'success' });
              navigate('/records');
            }}
          />
        </div>
      );
      break;
    case 'check':
      title = 'Check the values';
      body = (
        <div className="flex flex-col gap-4">
          <p className="max-w-2xl text-ink-2">Some values could not be read clearly. Compare each one with the original.</p>
          <CheckValues
            documentId={step.record.id}
            saveLabel="Save the checks and continue"
            onSaved={(fields) => goAfter(step.record, step.after, fields)}
            onSkip={{ label: 'Check later', run: () => navigate(`/records/${step.record.id}`) }}
            onRetake={() => {
              setRetake(step.record);
              setCandidate(null);
              setStep({ name: 'capture' });
            }}
          />
        </div>
      );
      break;
    case 'prescription':
      title = 'Save the prescription';
      body = (
        <PrescriptionEnding
          lines={step.lines}
          busy={busy}
          onSave={async () => {
            setBusy(true);
            try {
              const { proposal } = await services.prescriptions.save(step.record.id, step.record.prescriberId!, step.lines);
              await fileAndFinish(
                step.record,
                proposal
                  ? 'Prescription saved. Some medicines differ from the current routine. Review them now?'
                  : 'Prescription saved. No differences with the current routine.',
                proposal,
              );
            } catch (err) {
              fail(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      );
      break;
    case 'pack':
      title = 'Add it to the routine?';
      body = (
        <PackEnding
          line={step.line}
          busy={busy}
          takesLabel={self ? 'I take it' : `${they.subject[0].toUpperCase()}${they.subject.slice(1)} ${verb(they, 'take')} it`}
          onChoose={async (choice, input) => {
            setBusy(true);
            try {
              if (choice !== 'keep') {
                await services.routine.add(pid, input, { status: choice, source: 'from_pack', documentId: step.record.id });
              }
              await fileAndFinish(
                step.record,
                choice === 'taking' ? `${input.productName} is now in the routine.`
                  : choice === 'uncertain' ? `${input.productName} is in the routine as not confirmed.`
                    : 'The photo is kept in the records.',
              );
            } catch (err) {
              const e = toServiceError(err);
              // The gate: values from a photo must be checked before they reach the routine.
              if (e.code === 'verification_required') {
                toast.show({ message: e.message, tone: 'error' });
                setStep({ name: 'check', record: step.record, after: 'pack' });
              } else fail(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      );
      break;
    case 'file':
      title = 'File it?';
      body = (
        <Card>
          <h2 className="font-sans text-card-sm font-semibold">Everything is checked</h2>
          <p className="mt-2 text-ink-2">File it with the other records. You can still edit the details later.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await fileAndFinish(step.record, `${step.record.title} is filed.`);
                } catch (err) {
                  fail(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              File it
            </Button>
            <Button variant="secondary" to={`/records/${step.record.id}`}>Not now</Button>
          </div>
        </Card>
      );
      break;
    case 'done':
      title = 'Done';
      body = (
        <Card as="section" aria-labelledby="done-title">
          <h2 id="done-title" className="font-sans text-card-sm font-semibold">{step.message}</h2>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {step.proposal ? (
              <>
                <Button to={`/records/${step.record.id}/review`}>Review changes</Button>
                <Button variant="secondary" onClick={() => void putOff(step.record.id, step.proposal!.id)}>Not now</Button>
              </>
            ) : (
              <Button to={`/records/${step.record.id}`}>Open the record</Button>
            )}
            {queue.length > 0 ? (
              <Button variant="secondary" onClick={() => startNext(queue)}>
                Continue with the next report ({queue.length} left)
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => { setRetake(null); startNext([]); }}>Add another record</Button>
            )}
          </div>
        </Card>
      );
      break;
  }

  return (
    <div className="page-gutter py-6 md:py-12">
      {back}
      <h1 ref={heading} tabIndex={-1} className="mt-2 text-page-sm outline-none md:text-page">{title}</h1>
      <div className="mt-8">{body}</div>
    </div>
  );
}

function PrescriptionEnding({ lines, busy, onSave }: { lines: ExtractedLine[]; busy: boolean; onSave: () => void }) {
  return (
    <Card as="section" aria-labelledby="rx-title">
      <h2 id="rx-title" className="font-sans text-card-sm font-semibold">Medicines on this prescription</h2>
      <p className="mt-2 text-ink-2">Saving the prescription never changes the routine. Any differences are shown for you to decide.</p>
      <ul className="mt-4 flex flex-col gap-2">
        {lines.map((l) => (
          <li key={l.lineIndex} className="rounded-panel bg-surface-muted px-4 py-3">
            <span className="font-semibold text-ink">{l.productName}</span>
            <span className="block text-secondary text-ink-2">{l.instruction || 'No instruction read'}</span>
            {l.warnings.map((w) => <span key={w} className="mt-1 block text-secondary text-amber-ink">{w}</span>)}
          </li>
        ))}
      </ul>
      <Button className="mt-6" onClick={onSave} loading={busy}>Save prescription</Button>
    </Card>
  );
}

function PackEnding({ line, busy, takesLabel, onChoose }: {
  line: ExtractedLine;
  busy: boolean;
  takesLabel: string;
  onChoose: (choice: 'taking' | 'uncertain' | 'keep', input: Omit<ExtractedLine, 'lineIndex' | 'warnings'>) => void;
}) {
  const [doses, setDoses] = useState(line.dosesPerDay === null ? '' : String(line.dosesPerDay));
  const [instruction, setInstruction] = useState(line.instruction);
  const [error, setError] = useState<string | null>(null);
  const input = () => {
    const n = doses.trim() ? Number(doses.replace(',', '.')) : null;
    if (n !== null && (!Number.isFinite(n) || n <= 0)) {
      setError('Please enter how many doses a day, like 1 or 3, or leave it empty.');
      return null;
    }
    setError(null);
    return { productName: line.productName, ingredients: line.ingredients, form: line.form, dosesPerDay: n, instruction: instruction.trim() };
  };
  const choose = (choice: 'taking' | 'uncertain' | 'keep') => {
    const value = input();
    if (value) onChoose(choice, value);
  };
  return (
    <Card as="section" aria-labelledby="pack-title">
      <h2 id="pack-title" className="font-sans text-card-sm font-semibold">{line.productName}</h2>
      <p className="mt-1 text-ink-2">{line.ingredients.map((i) => `${i.name} ${i.strength} ${i.unit}`).join(' + ')}</p>
      <div className="mt-2 flex flex-wrap gap-2"><Pill tone="grey">From a photo of the pack</Pill></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Doses a day (optional)" hint="How often it is taken is rarely printed on a pack." inputMode="decimal" value={doses} onChange={(e) => setDoses(e.target.value)} error={error} />
        <Field label="How it is taken (optional)" hint="For example: 1 tablet, after dinner" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button onClick={() => choose('taking')} loading={busy}>{takesLabel}</Button>
        <Button variant="secondary" onClick={() => choose('uncertain')} disabled={busy}>Not sure</Button>
        <Button variant="secondary" onClick={() => choose('keep')} disabled={busy}>Just keep the photo</Button>
      </div>
      <p className="mt-4 flex items-start gap-2 text-secondary text-ink-3">
        <FileWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
        Adding it to the routine records what is taken. It is not advice to take it.
      </p>
    </Card>
  );
}
