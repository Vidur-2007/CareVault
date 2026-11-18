// Doctor Visit Passport (UI spec 7.9). Matches docs/design/CareVault-Passport.png; prints on one A4 page.
import { ArrowLeft, Printer, QrCode as QrIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/Button';
import { ErrorPanel } from '../components/ErrorPanel';
import { PassportView } from '../components/PassportView';
import { QrCode } from '../components/QrCode';
import { SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { formatLocalShort } from '../lib/format';
import { ShareDialog } from './passport/ShareDialog';
import { isActive } from './passport/shareLinks';

export function PassportScreen() {
  const { profile } = useProfile();
  const pid = profile!.id;
  const passport = useServiceQuery((s) => s.visits.buildPassport(pid), [pid]);
  const links = useServiceQuery((s) => s.sharing.list(), []);
  const [sharing, setSharing] = useState(false);

  // The newest active link is printed in the corner, like the mockup's QR box.
  const active = (links.data ?? []).filter((l) => isActive(l)).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0] ?? null;
  const qr = active ? (
    <figure className="flex w-36 flex-col items-center rounded-panel border border-dashed border-line-strong p-2 text-center print:w-28">
      <QrCode value={active.url} label="QR code that opens this passport" className="size-28 print:size-24" />
      <figcaption className="mt-1 text-min leading-tight text-ink-3">QR code · expires {formatLocalShort(active.expiresAt)}</figcaption>
    </figure>
  ) : null;

  return (
    <div className="page-gutter py-6 md:py-10 print:p-0">
      <div data-print-hide className="mb-6 flex flex-col gap-4 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <Link to="/visit" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
          <ArrowLeft aria-hidden className="size-5" />
          Visit
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" icon={<Printer aria-hidden className="size-5" />} onClick={() => window.print()} disabled={!passport.data}>
            Print or save as PDF
          </Button>
          <Button icon={<QrIcon aria-hidden className="size-5" />} onClick={() => setSharing(true)} disabled={!passport.data}>
            Share with QR
          </Button>
        </div>
      </div>

      {passport.loading ? (
        <SkeletonList count={3} label="Preparing the passport" />
      ) : passport.error ? (
        <>
          <h1 className="text-page-sm md:text-page">Doctor Visit Passport</h1>
          <ErrorPanel className="mt-6" title="The passport could not be prepared" message={passport.error.message} onRetry={passport.reload} />
        </>
      ) : passport.data ? (
        <PassportView passport={passport.data} qr={qr} />
      ) : null}

      <ShareDialog open={sharing} onClose={() => setSharing(false)} passport={passport.data ?? null} />
    </div>
  );
}
