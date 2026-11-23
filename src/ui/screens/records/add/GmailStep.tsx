// Gmail import inside "Add a record" (UI spec 4.10): connect from the tap, one row per PDF
// attachment, import the chosen ones; each then joins the add flow at step 2.
import { Mail } from 'lucide-react';
import { useState } from 'react';
import type { DocumentRecord, DuplicateInfo, GmailCandidate } from '../../../../contract/types';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { ErrorPanel } from '../../../components/ErrorPanel';
import { toServiceError } from '../../../hooks/toServiceError';
import { useCloudNotice, useProfile, useServices } from '../../../hooks/useContexts';
import { formatDate } from '../../../lib/format';
import { markGmailConnected } from '../../../lib/gmailSession';
import { Pill } from '../../../components/Pill';

const INBOX_MESSAGE = 'Reading your inbox for report attachments';

const rowKey = (c: Pick<GmailCandidate, 'messageId' | 'attachmentId'>) => `${c.messageId}/${c.attachmentId}`;

export interface GmailStepProps {
  onImported: (results: { record: DocumentRecord; duplicate: DuplicateInfo | null }[]) => void;
  onCancel: () => void;
}

export function GmailStep({ onImported, onCancel }: GmailStepProps) {
  const services = useServices();
  const cloud = useCloudNotice();
  const { profile } = useProfile();
  const pid = profile!.id;
  const [rows, setRows] = useState<GmailCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'connect' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const found = await cloud.run(INBOX_MESSAGE, async () => {
        await services.gmail.connect();
        markGmailConnected();
        return services.gmail.findCandidates(pid);
      });
      setRows(found);
      setSelected(new Set(found.filter((c) => !c.alreadyImported).map(rowKey)));
    } catch (err) {
      setError(toServiceError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const importSelected = async () => {
    if (!rows) return;
    setBusy('import');
    setError(null);
    const results: { record: DocumentRecord; duplicate: DuplicateInfo | null }[] = [];
    try {
      await cloud.run(INBOX_MESSAGE, async () => {
        for (const c of rows.filter((r) => selected.has(rowKey(r)))) {
          results.push(await services.gmail.importAttachment(pid, c.messageId, c.attachmentId));
        }
      });
      onImported(results);
    } catch (err) {
      setError(toServiceError(err).message);
      if (results.length) onImported(results);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card as="section" aria-labelledby="gmail-title">
      <Mail aria-hidden className="size-8 text-blue-ink" />
      <h2 id="gmail-title" className="mt-3 font-sans text-card-sm font-semibold md:text-card">Import report PDFs from Gmail</h2>
      <p className="mt-2 text-ink-2">
        CareVault looks for emails with PDF attachments. Only the attachments you choose are copied to this device.
      </p>
      {error && <ErrorPanel className="mt-4" title="Gmail could not be read" message={error} />}

      {rows === null ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => void connect()} loading={busy === 'connect'}>Connect Gmail</Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy !== null}>Back</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <p className="text-ink-2">No emails with PDF attachments were found.</p>
          <Button variant="secondary" className="mt-4" onClick={onCancel}>Back</Button>
        </div>
      ) : (
        <>
          <ul aria-label="PDF attachments" className="mt-6 flex flex-col gap-2">
            {rows.map((c) => (
              <li key={rowKey(c)} className="rounded-panel border border-line px-4 py-1">
                <Checkbox
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{c.attachmentName}</span>
                      {c.alreadyImported && <Pill tone="teal">Already imported</Pill>}
                    </span>
                  }
                  description={`${c.subject} · ${c.from} · received ${formatDate(c.receivedAt)}`}
                  checked={selected.has(rowKey(c))}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(rowKey(c));
                      else next.delete(rowKey(c));
                      return next;
                    })
                  }
                />
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => void importSelected()} loading={busy === 'import'} disabled={selected.size === 0}>
              {selected.size === 1 ? 'Import 1 report' : `Import ${selected.size} reports`}
            </Button>
            <Button variant="secondary" onClick={onCancel} disabled={busy !== null}>Back</Button>
          </div>
        </>
      )}
    </Card>
  );
}
