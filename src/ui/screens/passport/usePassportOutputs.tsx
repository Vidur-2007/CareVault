// Print and Share with QR (UI spec 4.11, overview 9.6). Both always use a snapshot: from the live
// passport, `passport.snapshot(profileId, reason)` creates one or reuses the latest identical one
// first; from a saved snapshot, that snapshot is used as it is.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { PassportSnapshot } from '../../../contract/types';
import { useServiceAction } from '../../hooks/useServiceAction';
import { ShareDialog } from './ShareDialog';

export const printPath = (snapshotId: string, linkId?: string | null) =>
  `/passport/print/${snapshotId}${linkId ? `?link=${encodeURIComponent(linkId)}` : ''}`;

export function usePassportOutputs(source: { profileId: string } | { snapshot: PassportSnapshot }) {
  const navigate = useNavigate();
  const [sharing, setSharing] = useState<{ open: boolean; snapshot: PassportSnapshot | null }>({ open: false, snapshot: null });
  const take = useServiceAction(
    (s, reason: 'print' | 'share') => ('snapshot' in source ? Promise.resolve(source.snapshot) : s.passport.snapshot(source.profileId, reason)),
    { errorPrefix: 'The passport could not be prepared' },
  );

  const print = async (linkId?: string) => {
    const snapshot = await take.run('print');
    if (snapshot) navigate(printPath(snapshot.id, linkId), { state: { autoPrint: true } });
  };

  const share = async () => {
    setSharing({ open: true, snapshot: null });
    const snapshot = await take.run('share');
    if (snapshot) setSharing({ open: true, snapshot });
    else setSharing({ open: false, snapshot: null });
  };

  const dialog = (
    <ShareDialog
      open={sharing.open}
      snapshot={sharing.snapshot}
      onClose={() => setSharing({ open: false, snapshot: null })}
      onPrint={(linkId) => {
        const id = sharing.snapshot?.id;
        setSharing({ open: false, snapshot: null });
        if (id) navigate(printPath(id, linkId), { state: { autoPrint: true } });
      }}
    />
  );

  return { print, share, pending: take.pending, dialog };
}
