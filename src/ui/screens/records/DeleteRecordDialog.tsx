// Delete a record (UI spec 4.5): lists the saved passports that mention it and offers to turn off
// their active share links. The links revoked are the ones documents.remove returns.
import { useState } from 'react';
import type { DocumentRecord, ShareLink } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { snapshotLabel } from './recordsText';

const isActive = (l: ShareLink, now = Date.now()) => !l.revoked && Date.parse(l.expiresAt) > now;

export interface DeleteRecordDialogProps {
  doc: DocumentRecord;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteRecordDialog({ doc, open, onClose, onDeleted }: DeleteRecordDialogProps) {
  const toast = useToast();
  const [revoke, setRevoke] = useState(true);
  const snapshots = useServiceQuery((s) => s.passport.snapshots(doc.profileId), [doc.profileId, open], { enabled: open });
  const links = useServiceQuery((s) => s.sharing.list(doc.profileId), [doc.profileId, open], { enabled: open });

  const mentioning = (snapshots.data ?? []).filter((s) => s.passport.documents.some((d) => d.documentId === doc.id));
  const ids = new Set(mentioning.map((s) => s.id));
  const activeLinks = (links.data ?? []).filter((l) => l.snapshotId !== null && ids.has(l.snapshotId) && isActive(l));
  const loading = snapshots.loading || links.loading;

  const remove = useServiceAction(
    async (s, alsoRevoke: boolean) => {
      const result = await s.documents.remove(doc.id);
      let revoked = 0;
      if (alsoRevoke) {
        for (const link of result.activeShares) {
          await s.sharing.revoke(link.id);
          revoked += 1;
        }
      }
      return { ...result, revoked };
    },
    { errorPrefix: 'The record could not be deleted' },
  );

  const onDelete = async () => {
    const result = await remove.run(revoke && activeLinks.length > 0);
    if (!result) return; // the error toast is shown; the dialog stays open to try again
    const turnedOff = result.revoked ? ` and turned off ${result.revoked === 1 ? 'one link' : `${result.revoked} links`}` : '';
    toast.show({ message: `Deleted ${doc.title}${turnedOff}`, tone: 'success' });
    onDeleted();
  };

  return (
    <Dialog
      open={open}
      onClose={remove.pending ? () => {} : onClose}
      title={`Delete ${doc.title}?`}
      description="The original file, its details and its checked values are removed from this device. This cannot be undone."
      size="md"
      hideClose
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={remove.pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void onDelete()} loading={remove.pending} disabled={loading}>
            Delete
          </Button>
        </>
      }
    >
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : snapshots.error || links.error ? (
        <p className="text-ink-2">The saved passports could not be checked. Deleting still keeps their copy of the title and date.</p>
      ) : mentioning.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-ink-2">
            {mentioning.length === 1 ? 'One saved passport lists it' : `${mentioning.length} saved passports list it`}. They keep its title and date,
            and will say the original was removed.
          </p>
          <ul aria-label="Saved passports that list this record" className="flex flex-col gap-1">
            {mentioning.map((s) => (
              <li key={s.id} className="rounded-panel bg-surface-muted px-4 py-2 text-ink">
                {snapshotLabel(s)}
              </li>
            ))}
          </ul>
          {activeLinks.length > 0 && (
            <Checkbox
              label={activeLinks.length === 1 ? 'Also turn off the active link to this passport' : `Also turn off the ${activeLinks.length} active links to these passports`}
              description="People who have the link will no longer be able to open it."
              checked={revoke}
              onChange={(e) => setRevoke(e.target.checked)}
            />
          )}
        </div>
      ) : (
        <p className="text-ink-2">No saved passport lists this record.</p>
      )}
    </Dialog>
  );
}
