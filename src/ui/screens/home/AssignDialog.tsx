// "Choose whose record this is" (UI spec 4.2): an email import whose patient name did not match is
// assigned to a profile, or removed when it is nobody's here.
import { useState } from 'react';
import type { AttentionItem } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useProfile } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';

export function AssignDialog({ item, onClose }: { item: AttentionItem | null; onClose: () => void }) {
  const { profiles, profile } = useProfile();
  const [chosen, setChosen] = useState<string>(profile!.id);
  const assign = useServiceAction((s, docId: string, profileId: string) => s.documents.assignProfile(docId, profileId), {
    errorPrefix: 'The record could not be moved',
  });
  const remove = useServiceAction((s, docId: string) => s.documents.remove(docId), {
    success: 'The record was removed',
    errorPrefix: 'The record could not be removed',
  });
  const docId = item?.documentId ?? null;
  const name = profiles.find((p) => p.id === chosen)?.name ?? '';

  return (
    <Dialog open={item !== null} onClose={onClose} title="Whose record is this?" description={item?.body} size="md">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold text-ink">It belongs to</legend>
        {profiles.map((p) => (
          <label key={p.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-button border border-line px-4 has-[:checked]:border-teal has-[:checked]:bg-teal-tint">
            <input type="radio" name="assign-profile" value={p.id} checked={chosen === p.id} onChange={() => setChosen(p.id)} className="size-5 accent-teal" />
            <span className="font-semibold text-ink">{p.name}</span>
            <span className="text-secondary text-ink-3">{p.relation}</span>
          </label>
        ))}
      </fieldset>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="secondary"
          className="!border-red-line !text-red-ink hover:!bg-red-tint"
          loading={remove.pending}
          disabled={!docId || assign.pending}
          onClick={async () => {
            if (docId && (await remove.run(docId))) onClose();
          }}
        >
          Not ours: remove it
        </Button>
        <Button
          loading={assign.pending}
          disabled={!docId || remove.pending}
          onClick={async () => {
            if (docId && (await assign.run(docId, chosen))) onClose();
          }}
        >
          {`It is ${name.split(' ')[0]}'s record`}
        </Button>
      </div>
    </Dialog>
  );
}
