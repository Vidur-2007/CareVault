// /passport/print/:snapshotId (UI spec 4.11): the snapshot laid out for A4. Reached only after a
// snapshot was created or reused. The QR is printed only for an active link to this exact snapshot
// (by the `link` id when given, otherwise the newest link of this snapshot), never one picked from
// the profile's links by expiry. Long passports continue on further pages; nothing is cut.
import { ArrowLeft, Printer, QrCode as QrIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import type { PassportSnapshot, ShareLink } from '../../contract/types';
import { Button } from '../components/Button';
import { ErrorPanel } from '../components/ErrorPanel';
import { LINK_FILES_NOTE, PassportView } from '../components/PassportView';
import { QrCode } from '../components/QrCode';
import { SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { formatLocalDateTime } from '../lib/format';
import { qrLinkFor, snapshotTitle } from './passport/shareLinks';
import { usePassportOutputs } from './passport/usePassportOutputs';

/** History entries that already opened the print dialog. */
const PRINTED = new Set<string>();

export function PrintScreen() {
  useDocumentTitle('Print the passport');
  const { snapshotId = '' } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const { profile } = useProfile();
  const pid = profile!.id;
  const query = useServiceQuery((s) => s.passport.getSnapshot(snapshotId), [snapshotId]);
  const snapshot = query.data && query.data.profileId === pid ? query.data : null;
  const links = useServiceQuery((s) => s.sharing.list(pid), [pid], { enabled: snapshot !== null });
  const qrLink = snapshot && links.data ? qrLinkFor(links.data, snapshot.id, params.get('link')) : null;

  // Arriving from Print opens the print dialog once per history entry, when the page (and its QR)
  // is ready. Going back to the same entry does not print again. History is not rewritten here, so
  // leaving the page quickly is never interrupted.
  const autoPrint = (location.state as { autoPrint?: boolean } | null)?.autoPrint === true;
  const timer = useRef<number | undefined>(undefined);
  const ready = snapshot !== null && !links.loading;
  useEffect(() => {
    if (!autoPrint || !ready || PRINTED.has(location.key)) return;
    PRINTED.add(location.key);
    // A short wait lets the QR image render before the print dialog takes the page.
    timer.current = window.setTimeout(() => window.print(), 400);
  }, [autoPrint, ready, location.key]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (query.loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        <h1 className="text-page-sm md:text-page">Print the passport</h1>
        <div className="mt-8"><SkeletonList count={3} label="Preparing the page" /></div>
      </div>
    );
  }
  if (!snapshot) {
    const notFound = !query.error || query.error.code === 'not_found';
    return (
      <div className="page-gutter py-6 md:py-12">
        <Link to="/passport" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
          <ArrowLeft aria-hidden className="size-5" />
          Passport
        </Link>
        <h1 className="mt-2 text-page-sm md:text-page">{notFound ? 'Passport not found' : 'Print the passport'}</h1>
        <ErrorPanel
          className="mt-6"
          title={notFound ? 'This passport is not in these records' : 'This passport could not be loaded'}
          message={notFound ? 'It may be from another profile, or the link is wrong.' : query.error?.message}
          onRetry={notFound ? undefined : query.reload}
        />
      </div>
    );
  }

  return <PrintPage snapshotTitleText={snapshotTitle(snapshot)} snapshot={snapshot} qrLink={qrLink} linksLoading={links.loading} />;
}

function PrintPage({ snapshot, snapshotTitleText, qrLink, linksLoading }: {
  snapshot: PassportSnapshot;
  snapshotTitleText: string;
  qrLink: ShareLink | null;
  linksLoading: boolean;
}) {
  const outputs = usePassportOutputs({ snapshot });
  const titles = snapshot.passport.documents.map((d) => d.title);
  return (
    <div className="page-gutter py-6 md:py-10 print:p-0">
      <div data-print-hide className="mb-6 flex flex-col gap-4 print:hidden">
        <Link to={`/passport/snapshots/${snapshot.id}`} className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-teal hover:text-teal-ink">
          <ArrowLeft aria-hidden className="size-5" />
          Back to passport {snapshot.revision}
        </Link>
        <div className="flex flex-col gap-3 rounded-panel bg-surface p-4 md:flex-row md:items-center md:justify-between">
          <div className="text-ink-2">
            <p className="font-semibold text-ink">{snapshotTitleText}</p>
            <p className="mt-1">
              {linksLoading ? 'Checking for a link to this passport…'
                : qrLink ? `The QR code opens this passport until ${formatLocalDateTime(qrLink.expiresAt)}.`
                  : 'No QR code is printed: there is no active link to this passport. Use Share with QR to add one.'}
            </p>
            <p className="mt-1">
              {titles.length ? `Reports listed: ${titles.join(', ')}. ` : 'No reports are listed. '}{LINK_FILES_NOTE}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button icon={<Printer aria-hidden className="size-5" />} onClick={() => window.print()}>Print this page</Button>
            {!qrLink && !linksLoading && (
              <Button variant="secondary" icon={<QrIcon aria-hidden className="size-5" />} onClick={() => void outputs.share()}>Share with QR</Button>
            )}
          </div>
        </div>
      </div>
      <PassportView
        passport={snapshot.passport}
        revision={snapshot.revision}
        qr={qrLink ? (
          <div data-link-id={qrLink.id} className="flex w-28 flex-col items-center gap-1 text-center print:w-[30mm]">
            <QrCode value={qrLink.url} label={`QR code for the link to ${snapshotTitleText}`} className="size-28 print:size-[30mm]" />
            <span className="text-[11px] leading-tight text-ink-3 print:text-[7pt]">Scan to open. Until {formatLocalDateTime(qrLink.expiresAt)}</span>
          </div>
        ) : undefined}
      />
      {outputs.dialog}
    </div>
  );
}
