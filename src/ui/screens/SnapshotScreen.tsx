// /passport/snapshots/:id (UI spec 4.11): a frozen snapshot, read-only, with Print and Share with QR.
// It never changes after a routine edit or a record delete; a removed record shows "Original removed
// on <date>". Another profile's snapshot is never shown.
import { ArrowLeft, Printer, QrCode as QrIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { PassportSnapshot, ShareLink } from '../../contract/types';
import { Button } from '../components/Button';
import { ErrorPanel } from '../components/ErrorPanel';
import { PassportView } from '../components/PassportView';
import { SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { formatDate } from '../lib/format';
import { ActiveLinks } from './passport/ActiveLinks';
import { linksOfSnapshot } from './passport/shareLinks';
import { usePassportOutputs } from './passport/usePassportOutputs';

const REASON = { manual: 'saved by hand', print: 'saved for printing', share: 'saved for sharing' } as const;

export function SnapshotScreen() {
  const { id = '' } = useParams();
  const { profile } = useProfile();
  const pid = profile!.id;
  const query = useServiceQuery((s) => s.passport.getSnapshot(id), [id]);
  const snapshot = query.data && query.data.profileId === pid ? query.data : null;
  const links = useServiceQuery((s) => s.sharing.list(pid), [pid], { enabled: snapshot !== null });
  useDocumentTitle(snapshot ? `Passport ${snapshot.revision}` : 'Passport snapshot');

  const back = (
    <Link to="/passport" className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
      <ArrowLeft aria-hidden className="size-5" />
      Passport
    </Link>
  );

  if (query.loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <h1 className="mt-2 text-page-sm md:text-page">Passport snapshot</h1>
        <div className="mt-8"><SkeletonList count={3} label="Loading the passport" /></div>
      </div>
    );
  }
  if (!snapshot) {
    const notFound = !query.error || query.error.code === 'not_found';
    return (
      <div className="page-gutter py-6 md:py-12">
        {back}
        <h1 className="mt-2 text-page-sm md:text-page">{notFound ? 'Passport not found' : 'Passport snapshot'}</h1>
        <ErrorPanel
          className="mt-6"
          title={notFound ? 'This passport is not in these records' : 'This passport could not be loaded'}
          message={notFound ? 'It may be from another profile, or the link is wrong.' : query.error?.message}
          onRetry={notFound ? undefined : query.reload}
        />
      </div>
    );
  }

  return <Saved key={snapshot.id} snapshot={snapshot} links={linksOfSnapshot(links.data ?? [], snapshot.id)} reloadLinks={links.reload} back={back} />;
}

function Saved({ snapshot, links, reloadLinks, back }: {
  snapshot: PassportSnapshot;
  links: ShareLink[];
  reloadLinks: () => void;
  back: ReactNode;
}) {
  const outputs = usePassportOutputs({ snapshot });
  return (
    <div className="page-gutter py-6 md:py-12">
      {back}
      <header className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-page-sm md:text-page">Passport {snapshot.revision}</h1>
          <p className="mt-2 text-[18px] text-ink-2">
            Passport {snapshot.revision} · prepared {formatDate(snapshot.passport.preparedOn)} · {REASON[snapshot.reason]}
          </p>
          <p className="mt-1 text-ink-3">A saved copy. It does not change when the routine or the records change.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button icon={<Printer aria-hidden className="size-5" />} onClick={() => void outputs.print()} loading={outputs.pending}>Print</Button>
          <Button variant="secondary" icon={<QrIcon aria-hidden className="size-5" />} onClick={() => void outputs.share()}>Share with QR</Button>
        </div>
      </header>
      <div className="mt-8 grid gap-6 wide:grid-cols-[minmax(0,1fr)_20rem]">
        <PassportView passport={snapshot.passport} revision={snapshot.revision} headingLevel={2} />
        <aside aria-label="Links to this passport" className="flex flex-col gap-6">
          <ActiveLinks links={links} title="Active links to this passport" onChanged={reloadLinks} />
        </aside>
      </div>
      {outputs.dialog}
    </div>
  );
}
