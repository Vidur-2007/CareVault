// Scan a medicine, UI spec 7.4: capture -> reading -> confirm -> done, with the cloud-consent branch.
import { ArrowLeft, CircleCheck, CloudUpload, Lightbulb, LoaderCircle, PencilLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ExtractedLine, ExtractionCandidate } from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CloudNotice } from '../components/CloudNotice';
import { ErrorPanel } from '../components/ErrorPanel';
import { FileDrop } from '../components/FileDrop';
import { LineConfirmForm } from '../components/lineForm/LineConfirmForm';
import { EMPTY_LINE } from '../components/lineForm/lineDraft';
import { Pill } from '../components/Pill';
import { POSSIBLE_DUPLICATE } from '../components/pills';
import { toServiceError } from '../hooks/toServiceError';
import { useCloudNotice, useProfile, useServices } from '../hooks/useContexts';
import { formatNumber } from '../lib/format';
import { pronounsFor, verb } from '../lib/pronouns';
import { today } from '../lib/today';
import { StepIndicator } from './scan/StepIndicator';
import { saveScannedMedicine } from './scan/saveScannedMedicine';
import type { SavedScan } from './scan/saveScannedMedicine';

export const CLOUD_SENDING_MESSAGE = 'Sending this photo to the cloud reader';

type Step =
  | { name: 'capture' }
  | { name: 'reading'; file: File }
  | { name: 'consent'; file: File; sending: boolean }
  | { name: 'read-error'; file: File; message: string }
  | { name: 'confirm'; file: File | null; line: ExtractedLine; fromExtraction: boolean; engine: ExtractionCandidate['engine'] | null }
  | { name: 'done'; saved: SavedScan };

const STEP_INDEX: Record<Step['name'], number> = { capture: 0, reading: 1, consent: 1, 'read-error': 1, confirm: 2, done: 3 };

export function ScanScreen() {
  const services = useServices();
  const cloud = useCloudNotice();
  const { profile } = useProfile();
  const pid = profile!.id;
  const pronouns = pronounsFor(profile!.relation);
  const [step, setStep] = useState<Step>({ name: 'capture' });
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Each read gets a token; results for an abandoned read (Cancel, a new photo) are ignored.
  const readToken = useRef(0);

  const toConfirm = (file: File | null, candidate: ExtractionCandidate | null) => {
    const line = candidate?.lines[0];
    setStep({
      name: 'confirm',
      file,
      line: line ?? EMPTY_LINE,
      fromExtraction: !!line,
      engine: candidate?.engine ?? null,
    });
  };

  const readOnDevice = async (file: File) => {
    const token = ++readToken.current;
    setStep({ name: 'reading', file });
    try {
      const candidate = await services.reading.read(file, { allowCloud: false });
      if (token === readToken.current) toConfirm(file, candidate);
    } catch (err) {
      if (token !== readToken.current) return;
      const e = toServiceError(err);
      if (e.code === 'cloud_consent_required') setStep({ name: 'consent', file, sending: false });
      else setStep({ name: 'read-error', file, message: e.message });
    }
  };

  const sendToCloud = async (file: File) => {
    const token = ++readToken.current;
    setStep({ name: 'consent', file, sending: true });
    try {
      const candidate = await cloud.run(CLOUD_SENDING_MESSAGE, () => services.reading.read(file, { allowCloud: true }));
      if (token === readToken.current) toConfirm(file, candidate);
    } catch (err) {
      if (token === readToken.current) setStep({ name: 'read-error', file, message: toServiceError(err).message });
    }
  };

  const save = async (line: ExtractedLine, actionId: string) => {
    if (step.name !== 'confirm') return;
    setSaving(actionId);
    setSaveError(null);
    try {
      const saved = await saveScannedMedicine(services, pid, step.file, line, { confirm: actionId === 'confirm', today: today() });
      setStep({ name: 'done', saved });
    } catch (err) {
      setSaveError(toServiceError(err).message);
    } finally {
      setSaving(null);
    }
  };

  const restart = () => {
    readToken.current += 1;
    setSaveError(null);
    setStep({ name: 'capture' });
  };

  return (
    <div className="page-gutter py-6 md:py-12">
      <Link to="/medicines" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
        <ArrowLeft aria-hidden className="size-5" />
        Medicines
      </Link>
      <h1 className="mt-2 text-page-sm md:text-page">Scan a medicine</h1>
      <div className="mt-4">
        <StepIndicator current={STEP_INDEX[step.name]} />
      </div>

      <div className="mt-6 md:mt-8">
        {step.name === 'capture' && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:gap-8">
            <FileDrop
              accept="image/*"
              allowCamera
              title="Photograph the medicine pack"
              hint="Or drop a photo here. A PDF of a prescription goes in Records."
              onFiles={(files) => files[0] && void readOnDevice(files[0])}
            />
            <Card as="section" aria-labelledby="tips-title">
              <h2 id="tips-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold">
                <Lightbulb aria-hidden className="size-5 text-amber-ink" />
                For a clear photo
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-2">
                <li>Lay the pack on a flat surface.</li>
                <li>Use good light and avoid glare on the foil.</li>
                <li>Make sure the composition text (“Each tablet contains…”) is visible.</li>
              </ul>
              <Button variant="quiet" className="mt-4 -ml-1" icon={<PencilLine aria-hidden className="size-5" />} onClick={() => toConfirm(null, null)}>
                Enter by hand instead
              </Button>
            </Card>
          </div>
        )}

        {step.name === 'reading' && (
          <Card className="mx-auto max-w-xl text-center">
            <div role="status" className="flex flex-col items-center gap-4 py-4">
              <LoaderCircle aria-hidden className="size-10 animate-spin text-teal" />
              <p className="text-card-sm font-semibold text-ink">Reading on this device</p>
              <p className="text-ink-3">The first scan can take a few seconds while the reader loads.</p>
            </div>
            <CloudNotice message={null} showOnDevice className="mt-2 justify-center rounded-panel" />
            <Button variant="secondary" className="mt-5" onClick={restart}>
              Cancel
            </Button>
          </Card>
        )}

        {step.name === 'consent' && (
          <Card as="section" aria-labelledby="consent-title" className="mx-auto max-w-xl">
            <CloudUpload aria-hidden className="size-8 text-blue-ink" />
            <h2 id="consent-title" className="mt-3 font-sans text-card-sm font-semibold md:text-card">
              This photo is hard to read on the device. Send it to the cloud reader?
            </h2>
            <p className="mt-3 text-ink-2">
              Only this photo is sent, to read the printed text. Nothing else from this device goes with it. You will check every field
              before anything is saved.
            </p>
            {step.sending && <CloudNotice message={CLOUD_SENDING_MESSAGE} className="mt-4 rounded-panel" />}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => void sendToCloud(step.file)} loading={step.sending}>
                Send this photo
              </Button>
              <Button variant="secondary" onClick={() => toConfirm(step.file, null)} disabled={step.sending}>
                Enter by hand
              </Button>
            </div>
          </Card>
        )}

        {step.name === 'read-error' && (
          <div className="mx-auto flex max-w-xl flex-col gap-4">
            <ErrorPanel title="The photo could not be read" message={step.message} onRetry={() => void readOnDevice(step.file)} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="secondary" onClick={() => toConfirm(step.file, null)}>
                Enter by hand
              </Button>
              <Button variant="quiet" onClick={restart}>
                Take another photo
              </Button>
            </div>
          </div>
        )}

        {step.name === 'confirm' && (
          <>
            {saveError && <ErrorPanel className="mb-6" title="The medicine could not be saved" message={saveError} />}
            <LineConfirmForm
              source={step.file ?? undefined}
              sourceLabel="Photo of the medicine pack"
              line={step.line}
              fromExtraction={step.fromExtraction}
              pendingAction={saving}
              title={
                <div>
                  <h2 className="font-sans text-card-sm font-semibold md:text-card">
                    {step.fromExtraction ? 'Check what was read' : 'Enter the medicine'}
                  </h2>
                  <p className="mt-1 text-secondary text-ink-3">
                    {step.engine === 'cloud'
                      ? 'Read by the cloud reader. Compare it with the photo.'
                      : step.engine === 'on_device'
                        ? 'Read on this device. Compare it with the photo.'
                        : step.file
                          ? 'Nothing could be read automatically. Type what is printed on the pack.'
                          : 'Type what is printed on the pack.'}
                  </p>
                </div>
              }
              actions={[
                { id: 'home', label: 'Save as found at home', variant: 'secondary' },
                { id: 'confirm', label: `Save and confirm ${pronouns.subject} ${verb(pronouns, 'take')} it` },
              ]}
              onSubmit={(line, actionId) => void save(line, actionId)}
            />
          </>
        )}

        {step.name === 'done' && <DonePanel saved={step.saved} onScanAnother={restart} />}
      </div>
    </div>
  );
}

function DonePanel({ saved, onScanAnother }: { saved: SavedScan; onScanAnother: () => void }) {
  const { medicine, duplicate } = saved;
  const others = duplicate?.parts.filter((p) => p.medicineId !== medicine.id).map((p) => p.productName) ?? [];
  return (
    <Card as="section" aria-labelledby="done-title" className="mx-auto max-w-xl">
      <div role="status">
        <CircleCheck aria-hidden className="size-10 text-teal" />
        <h2 id="done-title" className="mt-3 font-sans text-card-sm font-semibold md:text-card">
          {medicine.productName} is saved
        </h2>
        <p className="mt-2 text-ink-2">
          {medicine.status === 'confirmed_current'
            ? 'It is listed as a confirmed current medicine.'
            : 'It is listed under Found at home until you confirm it is taken.'}
        </p>
      </div>
      {duplicate && (
        <div className="mt-5 rounded-panel border border-red-line bg-red-tint/50 p-4">
          <Pill spec={POSSIBLE_DUPLICATE} />
          <p className="mt-2 text-ink">
            {others.join(' and ')} also {others.length === 1 ? 'contains' : 'contain'} {duplicate.ingredient}.
            {duplicate.complete && ` If all are taken as entered, that is ${formatNumber(duplicate.perDay)} ${duplicate.unit} a day.`}
          </p>
          <Button to="/medicines#possible-duplicates" variant="quiet" className="mt-1 -ml-1">
            Review both products
          </Button>
        </div>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button onClick={onScanAnother}>Scan another</Button>
        <Button to="/medicines" variant="secondary">
          Go to Medicines
        </Button>
      </div>
    </Card>
  );
}
