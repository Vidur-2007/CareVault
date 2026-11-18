// Records vault, UI spec 7.6: search, category chips, starred, Grid and Timeline, upload sheet.
import { FolderOpen, Grid2x2, List, Search, Star, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { DocumentRecord, PrescriptionDiff } from '../../contract/types';
import { Button } from '../components/Button';
import { DocumentCard } from '../components/DocumentCard';
import { DocumentThumbnail } from '../components/DocumentThumbnail';
import { EmptyState } from '../components/EmptyState';
import { ErrorPanel } from '../components/ErrorPanel';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { TimelineItem } from '../components/TimelineItem';
import { useProfile } from '../hooks/useContexts';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { cx } from '../lib/cx';
import { formatDate } from '../lib/format';
import { DOCUMENT_TYPE_LABEL, sourceLabel } from '../lib/labels';
import { AddRecordSheet } from './records/AddRecordSheet';
import { CATEGORIES, countByCategory, groupByMonth } from './records/recordsText';
import type { Category } from './records/recordsText';
import { plural } from './review/copy';

type View = 'grid' | 'timeline';
const VIEW_KEY = 'cv.recordsView';

function readView(): View {
  try {
    return globalThis.localStorage?.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'grid';
  } catch {
    return 'grid';
  }
}

function storeView(view: View) {
  try {
    globalThis.localStorage?.setItem(VIEW_KEY, view);
  } catch {
    // remembered for this visit only
  }
}

/** "2 medicine changes found" for a prescription that is the latest from its doctor. */
function changesFor(doc: DocumentRecord, diffs: PrescriptionDiff[]): string | undefined {
  const diff = diffs.find((d) => d.latestDocumentId === doc.id);
  if (!diff || diff.previousDocumentId === null) return undefined;
  const n = diff.rows.filter((r) => r.kind === 'added' || r.kind === 'changed').length;
  return n > 0 ? `${n} medicine ${plural(n, 'change', 'changes')} found` : 'No medicine changes';
}

export function RecordsScreen() {
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [starredOnly, setStarredOnly] = useState(false);
  const [view, setView] = useState<View>(readView);
  const [adding, setAdding] = useState(false);

  // Search runs 250 ms after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const all = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const found = useServiceQuery((s) => s.documents.search(pid, query), [pid, query], { enabled: query !== '' });
  const prescriberIds = prescribers.map((p) => p.id).join();
  const diffs = useServiceQuery(
    async (s) => (await Promise.all(prescribers.map((p) => s.prescriptions.latestDiff(pid, p.id)))).filter((d): d is PrescriptionDiff => d !== null),
    [pid, prescriberIds],
    { enabled: prescribers.length > 0 },
  );
  const star = useServiceAction((s, id: string, on: boolean) => s.documents.star(id, on));
  const [starring, setStarring] = useState<string | null>(null);

  const counts = useMemo(() => countByCategory(all.data ?? []), [all.data]);
  const source = query ? found.data : all.data;
  const visible = useMemo(
    () =>
      (source ?? [])
        .filter((d) => category === 'all' || d.type === category)
        .filter((d) => !starredOnly || d.starred),
    [source, category, starredOnly],
  );
  const filtering = query !== '' || category !== 'all' || starredOnly;
  const loading = all.loading || (query !== '' && found.loading);
  const error = all.error ?? (query ? found.error : null);

  const toggleStar = async (doc: DocumentRecord, on: boolean) => {
    setStarring(doc.id);
    await star.run(doc.id, on);
    setStarring(null);
  };

  const header = (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10">
      <div className="md:max-w-[640px]">
        <h1 className="text-page-sm md:text-page">Records</h1>
        <p className="mt-3 text-ink-2 md:text-[20px] md:leading-[1.5]">Prescriptions, reports and tests, kept on this device.</p>
      </div>
      <div className="shrink-0">
        <Button cta icon={<Upload aria-hidden className="size-5" />} onClick={() => setAdding(true)} fullWidth className="md:w-auto">
          Add a record
        </Button>
      </div>
    </header>
  );

  let content;
  if (all.loading) {
    content = <SkeletonList count={3} label="Loading records" />;
  } else if (all.error) {
    content = <ErrorPanel title="Records could not be loaded" message={all.error.message} onRetry={all.reload} />;
  } else if ((all.data ?? []).length === 0) {
    content = (
      <EmptyState
        icon={<FolderOpen />}
        title="No records yet"
        action={
          <Button icon={<Upload aria-hidden className="size-5" />} onClick={() => setAdding(true)}>
            Add the first record
          </Button>
        }
      >
        Add a prescription, lab report or test as a PDF or a photo. Report PDFs from email can be imported in{' '}
        <Link to="/settings" className="font-semibold text-teal underline underline-offset-4">
          Settings
        </Link>
        .
      </EmptyState>
    );
  } else {
    content = (
      <>
        <div className="flex flex-col gap-4">
          <div className="relative">
            <label htmlFor="records-search" className="mb-2 block font-semibold text-ink">
              Search records
            </label>
            <Search aria-hidden className="pointer-events-none absolute bottom-3.5 left-4 size-5 text-ink-3" />
            <input
              id="records-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Title or type, for example “lipid”"
              autoComplete="off"
              className="min-h-12 w-full rounded-button border border-line-strong bg-surface py-2 pl-12 pr-4 text-ink placeholder:text-ink-3 focus-visible:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal/40"
            />
          </div>

          <div role="group" aria-label="Type" className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={category === c.key}
                onClick={() => setCategory(c.key)}
                className={cx(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-secondary font-semibold transition-colors',
                  category === c.key ? 'border-teal bg-teal-tint text-teal-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                )}
              >
                {c.label}{' '}
                <span className={cx('rounded-full px-2 text-min', category === c.key ? 'bg-teal text-white' : 'bg-grey-tint text-ink-3')}>
                  {counts[c.key]}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              aria-pressed={starredOnly}
              onClick={() => setStarredOnly((v) => !v)}
              className={cx(
                'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-secondary font-semibold transition-colors',
                starredOnly ? 'border-amber-ink/50 bg-amber-tint text-amber-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
              )}
            >
              <Star aria-hidden className={cx('size-4', starredOnly && 'fill-amber-ink')} />
              Starred only
            </button>
            <SegmentedControl
              label="View"
              value={view}
              onChange={(v) => {
                setView(v);
                storeView(v);
              }}
              options={[
                { value: 'grid', label: 'Grid', icon: <Grid2x2 aria-hidden className="size-4" /> },
                { value: 'timeline', label: 'Timeline', icon: <List aria-hidden className="size-4" /> },
              ]}
            />
          </div>
        </div>

        <p aria-live="polite" className="sr-only">
          {loading ? 'Searching' : `${visible.length} ${plural(visible.length, 'record', 'records')} shown`}
        </p>

        <div className="mt-6">
          {loading ? (
            <Skeleton className="h-40 w-full rounded-card" />
          ) : error ? (
            <ErrorPanel title="The search could not be run" message={error.message} onRetry={found.reload} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="No records match"
              action={
                filtering ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setText('');
                      setQuery('');
                      setCategory('all');
                      setStarredOnly(false);
                    }}
                  >
                    Show all records
                  </Button>
                ) : undefined
              }
            >
              Try another word, or another type.
            </EmptyState>
          ) : view === 'grid' ? (
            <ul aria-label="Records" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-5">
              {visible.map((doc) => (
                <li key={doc.id} className="flex">
                  <DocumentCard
                    className="w-full"
                    document={doc}
                    thumbnail={<DocumentThumbnail document={doc} />}
                    onToggleStar={(on) => void toggleStar(doc, on)}
                    starPending={starring === doc.id}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div aria-label="Records by month" role="region" className="flex flex-col gap-8">
              {groupByMonth(visible).map((group) => (
                <section key={group.key} aria-labelledby={`month-${group.key}`}>
                  <h2 id={`month-${group.key}`} className="mb-4 text-card-sm md:text-card">
                    {group.label}
                  </h2>
                  <ol>
                    {group.docs.map((doc, i) => {
                      const changes = doc.type === 'prescription' ? changesFor(doc, diffs.data ?? []) : undefined;
                      return (
                        <TimelineItem
                          key={doc.id}
                          date={formatDate(doc.documentDate)}
                          title={doc.title}
                          type={doc.type}
                          to={`/records/${doc.id}`}
                          detail={[
                            DOCUMENT_TYPE_LABEL[doc.type],
                            sourceLabel(doc),
                            doc.state === 'pending_confirmation' ? 'not yet confirmed' : null,
                            changes ?? null,
                            doc.starred ? 'starred' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          last={i === group.docs.length - 1}
                        />
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="page-gutter py-6 md:py-12">
      {header}
      <div className="mt-8 md:mt-10">{content}</div>
      <AddRecordSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
