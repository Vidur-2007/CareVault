// /records/:id/verify (UI spec 4.6). A `return` query parameter brings the user back where they
// came from, for example the review gate: "Check this strength, then come back to the review".
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorPanel } from '../components/ErrorPanel';
import { SkeletonList } from '../components/Skeleton';
import { useProfile, useToast } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { CheckValues } from './records/CheckValues';

/** Only paths inside the app, so the parameter cannot send the user elsewhere. */
const safeReturn = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : null);

export function VerifyScreen() {
  useDocumentTitle('Check the values');
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const toast = useToast();
  const doc = useServiceQuery((s) => s.documents.get(id), [id]);
  const back = safeReturn(params.get('return')) ?? `/records/${id}`;
  const mine = doc.data && doc.data.profileId === profile!.id ? doc.data : null;

  return (
    <div className="page-gutter py-6 md:py-12">
      <Link to={back} className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal hover:text-teal-ink">
        <ArrowLeft aria-hidden className="size-5" />
        {back === `/records/${id}` ? 'Back to the record' : 'Back'}
      </Link>
      <h1 className="mt-2 text-page-sm md:text-page">Check the values</h1>
      {doc.loading ? (
        <div className="mt-8"><SkeletonList count={2} label="Loading the record" /></div>
      ) : !mine ? (
        <ErrorPanel className="mt-6" title="This record is not in these records" message="It may have been deleted, or the link is for another profile." />
      ) : (
        <>
          <p className="mt-3 max-w-2xl text-ink-2">
            {mine.title}. Compare each value with the original. Nothing read automatically reaches the routine or the passport until it is checked.
          </p>
          <div className="mt-8">
            <CheckValues
              documentId={id}
              onSaved={() => {
                toast.show({ message: 'Checks saved', tone: 'success' });
                navigate(back);
              }}
              onRetake={() => navigate(`/records/add?retake=${encodeURIComponent(id)}`)}
            />
          </div>
        </>
      )}
    </div>
  );
}
