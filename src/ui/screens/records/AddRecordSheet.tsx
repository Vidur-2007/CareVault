// "Add a record" (UI spec 7.6): selecting -> reading (cloud consent if needed) -> review details ->
// saving -> duplicate found? -> saved, or for a prescription: line-confirm -> prescriptions.apply -> /visit.
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { DocumentRecord, ExtractedLine, ExtractionCandidate } from '../../../contract/types';
import { Button } from '../../components/Button';
import { CloudConsentPanel } from '../../components/CloudConsentPanel';
import { ErrorPanel } from '../../components/ErrorPanel';
import { FileDrop } from '../../components/FileDrop';
import { ReadingProgress } from '../../components/ReadingProgress';
import { Sheet } from '../../components/Sheet';
import { toServiceError } from '../../hooks/toServiceError';
import { useCloudNotice, useProfile, useServices, useToast } from '../../hooks/useContexts';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate } from '../../lib/format';
import { today as getToday } from '../../lib/today';
import { PrescriptionLinesStep } from './PrescriptionLinesStep';
import { RecordDetailsForm } from './RecordDetailsForm';
import type { DetailsValues } from './recordsText';

export const CLOUD_DOCUMENT_MESSAGE = 'Sending this document to the cloud reader';

type Step =
  | { name: 'select' }
  | { name: 'reading'; file: File }
  | { name: 'consent'; file: File; sending: boolean }
  | { name: 'details'; file: File; candidate: ExtractionCandidate | null; readNote: string | null }
  | { name: 'saving'; label: string }
  | { name: 'duplicate'; file: File; candidate: ExtractionCandidate | null; values: DetailsValues; record: DocumentRecord; existing: DocumentRecord | null }
  | { name: 'lines'; file: File; candidate: ExtractionCandidate | null; record: DocumentRecord; prescriberId: string; pending: boolean }
  | { name: 'saved'; record: DocumentRecord }
  | { name: 'failed'; message: string; retry: (() => void) | null };

const TITLES: Record<Step['name'], string> = {
  select: 'Add a record',
  reading: 'Reading the document',
  consent: 'Reading the document',
  details: 'Check the details',
  saving: 'Saving',
  duplicate: 'Already in the records?',
  lines: 'Check the medicines on this prescription',
  saved: 'Saved to records',
  failed: 'Something went wrong',
};

export interface AddRecordSheetProps {
  open: boolean;
  onClose: () => void;
}

export function AddRecordSheet({ open, onClose }: AddRecordSheetProps) {
  const services = useServices();
  const cloud = useCloudNotice();
  const toast = useToast();
  const navigate = useNavigate();
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const today = getToday();
  const [step, setStep] = useState<Step>({ name: 'select' });
  // Settings > Cloud reading: when on, a hard-to-read document is sent without asking (the notice still shows).
  const cloudSetting = useServiceQuery((s) => s.settings.get(), [], { enabled: open });
  const sendWithoutAsking = cloudSetting.data?.cloudReadingAllowed ?? false;
  // Results of an abandoned run (sheet closed, new file chosen) are ignored.
  const run = useRef(0);

  const close = () => {
    run.current += 1;
    setStep({ name: 'select' });
    onClose();
  };

  const read = async (file: File, allowCloud: boolean) => {
    const token = ++run.current;
    setStep(allowCloud ? { name: 'consent', file, sending: true } : { name: 'reading', file });
    try {
      const candidate = allowCloud
        ? await cloud.run(CLOUD_DOCUMENT_MESSAGE, () => services.reading.read(file, { allowCloud: true }))
        : await services.reading.read(file, { allowCloud: false });
      if (token === run.current) setStep({ name: 'details', file, candidate, readNote: null });
    } catch (err) {
      if (token !== run.current) return;
      const e = toServiceError(err);
      if (e.code === 'cloud_consent_required') {
        if (sendWithoutAsking && !allowCloud) void read(file, true);
        else setStep({ name: 'consent', file, sending: false });
      }
      else if (e.code === 'unsupported_file') setStep({ name: 'failed', message: 'Please choose a photo or a PDF.', retry: () => setStep({ name: 'select' }) });
      else setStep({ name: 'details', file, candidate: null, readNote: `The document could not be read (${e.message}).` });
    }
  };

  /** After the record exists (and the caregiver chose to keep it). */
  const afterSave = async (token: number, file: File, candidate: ExtractionCandidate | null, values: DetailsValues, record: DocumentRecord) => {
    await services.documents.confirm(record.id);
    if (token !== run.current) return;
    if (values.type === 'prescription') {
      setStep({ name: 'lines', file, candidate, record, prescriberId: values.prescriberId, pending: false });
    } else {
      setStep({ name: 'saved', record });
    }
  };

  const save = async (file: File, candidate: ExtractionCandidate | null, values: DetailsValues) => {
    const token = ++run.current;
    setStep({ name: 'saving', label: 'Saving the record' });
    try {
      const { record, duplicateOf } = await services.documents.add(pid, file, {
        type: values.type,
        title: values.title,
        documentDate: values.documentDate,
        source: file.type.startsWith('image/') ? 'scan' : 'upload',
        prescriberId: values.prescriberId || null,
      });
      if (token !== run.current) return;
      if (duplicateOf) {
        const existing = await services.documents.get(duplicateOf).catch(() => null);
        if (token === run.current) setStep({ name: 'duplicate', file, candidate, values, record, existing });
        return;
      }
      await afterSave(token, file, candidate, values, record);
    } catch (err) {
      if (token === run.current) {
        setStep({ name: 'failed', message: toServiceError(err).message, retry: () => void save(file, candidate, values) });
      }
    }
  };

  const keepBoth = async (s: Extract<Step, { name: 'duplicate' }>) => {
    const token = ++run.current;
    setStep({ name: 'saving', label: 'Saving the record' });
    try {
      await afterSave(token, s.file, s.candidate, s.values, s.record);
    } catch (err) {
      if (token === run.current) setStep({ name: 'failed', message: toServiceError(err).message, retry: () => void keepBoth(s) });
    }
  };

  const discard = async (s: Extract<Step, { name: 'duplicate' }>) => {
    const token = ++run.current;
    setStep({ name: 'saving', label: 'Removing the copy' });
    try {
      await services.documents.remove(s.record.id);
      if (token !== run.current) return;
      toast.show({ message: 'The copy was not kept.', tone: 'success' });
      close();
    } catch (err) {
      if (token === run.current) setStep({ name: 'failed', message: toServiceError(err).message, retry: () => void discard(s) });
    }
  };

  const apply = async (s: Extract<Step, { name: 'lines' }>, lines: ExtractedLine[]) => {
    const token = ++run.current;
    setStep({ ...s, pending: true });
    try {
      await services.prescriptions.apply(pid, s.record.id, s.prescriberId, lines);
      if (token !== run.current) return;
      const doctor = prescribers.find((p) => p.id === s.prescriberId)?.name ?? 'the doctor';
      toast.show({ message: `Compared with the previous prescription from ${doctor}`, tone: 'success' });
      close();
      navigate('/visit', { state: { prescriberId: s.prescriberId, documentId: s.record.id } });
    } catch (err) {
      if (token === run.current) {
        setStep({ ...s, pending: false });
        toast.show({ message: `The prescription could not be compared. ${toServiceError(err).message}`, tone: 'error' });
      }
    }
  };

  let body: ReactNode = null;
  switch (step.name) {
    case 'select':
      body = (
        <FileDrop
          accept="image/*,application/pdf"
          title="Choose a prescription, report or test"
          hint="A PDF or a photo. It is read on this device first."
          onFiles={(files) => files[0] && void read(files[0], false)}
        />
      );
      break;
    case 'reading':
      body = (
        <ReadingProgress
          what="document"
          fileName={step.file.name}
          onManual={() => {
            const file = step.file;
            run.current += 1; // ignore the read still running
            setStep({ name: 'details', file, candidate: null, readNote: 'You chose to enter the details by hand.' });
          }}
        />
      );
      break;
    case 'consent':
      body = (
        <CloudConsentPanel
          what="document"
          sending={step.sending}
          sendingMessage={CLOUD_DOCUMENT_MESSAGE}
          onSend={() => void read(step.file, true)}
          onManual={() => setStep({ name: 'details', file: step.file, candidate: null, readNote: 'The document was not sent to the cloud reader.' })}
          manualLabel="Enter the details by hand"
        />
      );
      break;
    case 'details':
      body = (
        <RecordDetailsForm
          fileName={step.file.name}
          candidate={step.candidate}
          readNote={step.readNote}
          prescribers={prescribers}
          today={today}
          onSubmit={(values) => void save(step.file, step.candidate, values)}
        />
      );
      break;
    case 'saving':
      body = (
        <div role="status" className="flex flex-col items-center gap-4 py-8 text-center">
          <LoaderCircle aria-hidden className="size-10 animate-spin text-teal" />
          <p className="font-semibold text-ink">{step.label}</p>
        </div>
      );
      break;
    case 'duplicate':
      body = (
        <div role="alertdialog" aria-labelledby="duplicate-title" aria-describedby="duplicate-desc" className="flex flex-col gap-4">
          <h3 id="duplicate-title" className="text-card-sm">
            This looks like a file you already added{step.existing ? ` on ${formatDate(step.existing.addedAt)}` : ''}
          </h3>
          <p id="duplicate-desc" className="text-ink-2">
            {step.existing
              ? `It is exactly the same file as “${step.existing.title}” (${formatDate(step.existing.documentDate)}).`
              : 'It is exactly the same file as one already in the records.'}{' '}
            Keep both only if you need a second copy.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => void discard(step)}>Discard</Button>
            <Button variant="secondary" onClick={() => void keepBoth(step)}>
              Keep both
            </Button>
          </div>
        </div>
      );
      break;
    case 'lines': {
      const doctor = prescribers.find((p) => p.id === step.prescriberId)?.name ?? 'the same doctor';
      body = (
        <PrescriptionLinesStep
          file={step.file}
          sourceLabel={step.record.title}
          lines={step.candidate?.documentType === 'prescription' ? step.candidate.lines : []}
          fromExtraction={!!step.candidate}
          doctorName={doctor}
          pending={step.pending}
          onSubmit={(lines) => void apply(step, lines)}
        />
      );
      break;
    }
    case 'saved':
      body = (
        <div role="status" className="flex flex-col gap-3">
          <CircleCheck aria-hidden className="size-10 text-teal" />
          <p className="text-card-sm font-semibold text-ink">{step.record.title}</p>
          <p className="text-ink-2">Saved to records, dated {formatDate(step.record.documentDate)}.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={() => {
                const id = step.record.id;
                close();
                navigate(`/records/${id}`);
              }}
            >
              Open it
            </Button>
            <Button variant="secondary" onClick={() => setStep({ name: 'select' })}>
              Add another
            </Button>
          </div>
        </div>
      );
      break;
    case 'failed':
      body = (
        <div className="flex flex-col gap-4">
          <ErrorPanel title="The record could not be saved" message={step.message} onRetry={step.retry ?? undefined} />
          <Button variant="secondary" className="self-start" onClick={() => setStep({ name: 'select' })}>
            Start again
          </Button>
        </div>
      );
      break;
  }

  return (
    <Sheet open={open} onClose={close} title={TITLES[step.name]} size={step.name === 'lines' ? 'wide' : 'md'}>
      {body}
    </Sheet>
  );
}
