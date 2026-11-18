// Gmail import (UI spec 7.11): connect, list candidate report PDFs, import into records.
import { Mail, Paperclip } from 'lucide-react';
import { useState } from 'react';
import type { GmailCandidate } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CloudNotice } from '../../components/CloudNotice';
import { toServiceError } from '../../hooks/toServiceError';
import { useCloudNotice, useServices, useToast } from '../../hooks/useContexts';
import { formatDate } from '../../lib/format';

export const GMAIL_MESSAGE = 'Reading your inbox for report attachments';

export function GmailSection({ profileId, profileName }: { profileId: string; profileName: string }) {
  const services = useServices();
  const cloud = useCloudNotice();
  const toast = useToast();
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<'connect' | 'search' | string | null>(null);
  const [candidates, setCandidates] = useState<GmailCandidate[] | null>(null);
  const [imported, setImported] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy('search');
    setError(null);
    try {
      setCandidates(await cloud.run(GMAIL_MESSAGE, () => services.gmail.findCandidates()));
    } catch (err) {
      setError(toServiceError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      await services.gmail.connect();
      setConnected(true);
      setBusy(null);
      await search();
    } catch (err) {
      setError(toServiceError(err).message);
      setBusy(null);
    }
  };

  const importOne = async (c: GmailCandidate) => {
    setBusy(c.messageId);
    try {
      const record = await cloud.run(GMAIL_MESSAGE, () => services.gmail.importAttachment(profileId, c.messageId));
      setImported((list) => [...list, c.messageId]);
      toast.show({ message: `${record.title} added. Confirm it in Review.`, tone: 'success' });
    } catch (err) {
      toast.show({ message: `The attachment could not be imported. ${toServiceError(err).message}`, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card as="section" aria-labelledby="gmail-title">
      <h2 id="gmail-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold md:text-card">
        <Mail aria-hidden className="size-6 text-teal" />
        Import reports from Gmail
      </h2>
      <p className="mt-3 text-ink-2">
        CareVault looks for recent emails with a PDF report attached and lets you choose which to add to {profileName}’s records. Access lasts for
        this session only: the permission is kept in this browser’s memory and is gone when you close the tab. Nothing from your inbox is sent to
        CareVault’s server.
      </p>
      {busy === 'search' && <CloudNotice message={GMAIL_MESSAGE} className="mt-4 rounded-panel" />}
      {error && (
        <p role="alert" className="mt-4 rounded-panel bg-red-tint px-4 py-3 text-red-ink">
          {error}
        </p>
      )}
      {!connected ? (
        <Button className="mt-5" onClick={() => void connect()} loading={busy === 'connect'}>
          Connect Gmail
        </Button>
      ) : (
        <div className="mt-5">
          {candidates === null ? null : candidates.length === 0 ? (
            <p className="text-ink-3">No new report attachments were found in the last 60 days.</p>
          ) : (
            <ul aria-label="Report attachments found" className="flex flex-col gap-3">
              {candidates.map((c) => {
                const done = imported.includes(c.messageId);
                return (
                  <li key={c.messageId} className="flex flex-col gap-3 rounded-panel border border-line p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{c.subject}</p>
                      <p className="text-secondary text-ink-3">
                        {c.from} · {formatDate(c.date)}
                      </p>
                      <p className="mt-1 flex items-center gap-1 break-all text-secondary text-ink-2">
                        <Paperclip aria-hidden className="size-4 shrink-0" />
                        {c.attachmentName}
                      </p>
                    </div>
                    {done ? (
                      <span className="text-secondary font-semibold text-teal-ink">Added, waiting in Review</span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void importOne(c)}
                        loading={busy === c.messageId}
                        disabled={busy !== null && busy !== c.messageId}
                        aria-label={`Import ${c.attachmentName}`}
                      >
                        Import
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Button variant="quiet" className="mt-3 -ml-1" onClick={() => void search()} disabled={busy !== null}>
            Look again
          </Button>
        </div>
      )}
    </Card>
  );
}
