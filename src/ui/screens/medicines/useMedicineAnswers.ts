// "Still taking / Stopped / Ask the doctor" for one medicine, shared by Medicines and the detail page.
// When an open confirm_medicine review item exists, the answer resolves it (with Undo, like Review);
// otherwise the medicine status is set directly.
import type { Medicine } from '../../../contract/types';
import { useDeferredResolutions } from '../../hooks/useDeferredResolutions';
import { useToast } from '../../hooks/useContexts';
import { useServiceAction } from '../../hooks/useServiceAction';
import { useServiceQuery } from '../../hooks/useServiceQuery';

export type MedicineAnswer = 'still_taking' | 'stopped' | 'ask_doctor';

export function useMedicineAnswers(profileId: string) {
  const toast = useToast();
  const items = useServiceQuery((s) => s.review.listOpen(profileId), [profileId]);
  const visit = useServiceQuery((s) => s.visits.next(profileId), [profileId]);
  const deferred = useDeferredResolutions();
  const setStatus = useServiceAction((s, id: string, status: Medicine['status']) => s.medicines.setStatus(id, status));
  const addQuestion = useServiceAction((s, visitId: string, text: string) => s.visits.addQuestion(visitId, text), {
    success: 'Added to the questions for the doctor',
  });

  const itemFor = (m: Medicine) => items.data?.find((i) => i.kind === 'confirm_medicine' && i.medicineIds.includes(m.id));

  const answer = async (m: Medicine, resolution: MedicineAnswer) => {
    const message =
      resolution === 'still_taking'
        ? `Marked ${m.productName} as still taken`
        : resolution === 'stopped'
          ? `Marked ${m.productName} as stopped`
          : 'Added to the questions for the doctor';
    const item = itemFor(m);
    if (item) {
      deferred.answer(item.id, resolution, message);
      return;
    }
    if (resolution === 'ask_doctor') {
      if (!visit.data) {
        toast.show({ message: 'Plan the next visit first, then add questions for the doctor.', tone: 'error' });
        return;
      }
      await addQuestion.run(visit.data.id, `Is ${m.productName} still needed?`);
      return;
    }
    const updated = await setStatus.run(m.id, resolution === 'stopped' ? 'stopped' : 'confirmed_current');
    if (updated) toast.show({ message, tone: 'success' });
  };

  return {
    answer,
    /** True while an answer for this medicine waits out its Undo window. */
    isHidden: (m: Medicine) => {
      const item = itemFor(m);
      return item ? deferred.hidden.has(item.id) : false;
    },
    pending: setStatus.pending || addQuestion.pending,
    visit: visit.data ?? null,
    openItems: items.data ?? [],
  };
}
