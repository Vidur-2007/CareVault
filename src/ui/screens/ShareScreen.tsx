// Public shared passport, /share/:id (UI spec 4.11). No app shell, no navigation, no analytics or
// external requests. The key is read from location.hash and never sent to the server. States:
// loading, missing key, expired, revoked, not found, and any other error with Try again.
import { Clock, FileQuestion, Link2Off, Lock, Printer, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation, useParams } from 'react-router';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { PassportView } from '../components/PassportView';
import { SkeletonList } from '../components/Skeleton';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceQuery } from '../hooks/useServiceQuery';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-ground print:bg-white">
      <div className="mx-auto w-full max-w-[940px] px-4 py-6 md:px-5 md:py-10 print:p-0">{children}</div>
    </div>
  );
}

function StateMessage({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Frame>
      <Logo />
      <main className="mt-10 rounded-card border border-line bg-surface p-7 shadow-card md:p-10">
        <div className="flex size-14 items-center justify-center rounded-full bg-grey-tint text-ink-2 [&_svg]:size-7">{icon}</div>
        <h1 className="mt-5 text-page-sm md:text-[36px]">{title}</h1>
        <div className="mt-3 max-w-xl text-ink-2">{children}</div>
      </main>
    </Frame>
  );
}

export function ShareScreen() {
  useDocumentTitle('Shared passport');
  const { id = '' } = useParams();
  const { hash } = useLocation();
  const key = hash.startsWith('#') ? hash.slice(1) : hash;
  const shared = useServiceQuery((s) => s.sharing.open(id, key), [id, key], { enabled: key !== '' });

  if (!key) {
    return (
      <StateMessage icon={<Lock />} title="This link is incomplete">
        The part of the link after the # sign is missing. It holds the key that unlocks the passport. Ask for the full link again, or scan
        the QR code.
      </StateMessage>
    );
  }

  if (shared.loading) {
    return (
      <Frame>
        <Logo />
        <h1 className="mt-8 text-page-sm">Shared passport</h1>
        <div className="mt-4" role="status" aria-label="Opening the passport">
          <p className="mb-4 text-ink-2">Opening and decrypting the passport…</p>
          <SkeletonList count={3} />
        </div>
      </Frame>
    );
  }

  if (shared.error) {
    switch (shared.error.code) {
      case 'expired':
        return (
          <StateMessage icon={<Clock />} title="This passport link has expired">
            Shared passports can be opened for a limited time only. Ask for a new link.
          </StateMessage>
        );
      case 'revoked':
        return (
          <StateMessage icon={<Link2Off />} title="This link was turned off">
            The person who shared it revoked this link, so the passport can no longer be opened with it.
          </StateMessage>
        );
      case 'not_found':
        return (
          <StateMessage icon={<FileQuestion />} title="This passport could not be found">
            The link may be mistyped or incomplete, or the passport was removed. Check the link, or ask for a new one.
          </StateMessage>
        );
      default:
        return (
          <StateMessage icon={<TriangleAlert />} title="The passport could not be opened">
            <p>{shared.error.message}</p>
            <Button variant="secondary" className="mt-5" onClick={shared.reload}>Try again</Button>
          </StateMessage>
        );
    }
  }

  if (!shared.data) return null;
  const s = shared.data;

  return (
    <Frame>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="flex items-center gap-2 text-secondary text-ink-3">
          <Lock aria-hidden className="size-4" />
          Shared passport · read-only{s.revision ? ` · passport ${s.revision}` : ''}
        </p>
        <Button variant="secondary" size="sm" icon={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>Print</Button>
      </div>
      <main>
        <PassportView passport={s.passport} revision={s.revision} />
      </main>
    </Frame>
  );
}
