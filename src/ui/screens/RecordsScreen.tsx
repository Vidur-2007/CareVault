// Records, UI spec 4.3: one search field with filters, "Matched:" labels, Grid and Timeline views
// (undated records in a final "Date not known" group), and the way to add a record.
import { FolderOpen, Grid2x2, List, MessageCircleQuestion, Plus, Search, SlidersHorizontal, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { RecordHit } from '../../contract/types';
import { Button } from '../components/Button';
import { DocumentCard } from '../components/DocumentCard';
import { DocumentThumbnail } from '../components/DocumentThumbnail';
import { EmptyState } from '../components/EmptyState';
import { ErrorPanel } from '../components/ErrorPanel';
import { Field } from '../components/Field';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { TimelineItem } from '../components/TimelineItem';
import { useProfile } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceAction } from '../hooks/useServiceAction';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { cx } from '../lib/cx';
import { formatDate, formatShortDate } from '../lib/format';
import { KIND_LABEL, KIND_PLURAL, sourceLabel, sourceShort } from '../lib/labels';
import {
  facilitiesOf, filtersActive, groupByMonth, isQuestionLike, kindCounts, matchedText, NO_FILTERS, toQuery, UNDATED_KEY,
} from './records/recordsText';
import type { Filters } from './records/recordsText';

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

function Chip({ pressed, onClick, children, tone = 'teal' }: { pressed: boolean; onClick: () => void; children: ReactNode; tone?: 'teal' | 'amber' }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-secondary font-semibold transition-colors',
        pressed
          ? tone === 'amber' ? 'border-amber-ink/50 bg-amber-tint text-amber-ink' : 'border-teal bg-teal-tint text-teal-ink'
          : 'border-line-strong bg-surface text-ink-2 hover:border-ink-3',
      )}
    >
      {children}
    </button>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function RecordsScreen() {
  useDocumentTitle('Records');
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [text, setText] = useState('');
  const [view, setView] = useState<View>(readView);
  const [moreOpen, setMoreOpen] = useState(false);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  // The search runs 250 ms after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.text === text ? f : { ...f, text })), 250);
    return () => clearTimeout(t);
  }, [text]);

  const query = useMemo(() => toQuery(filters), [filters]);
  const all = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const found = useServiceQuery((s) => s.records.search(pid, query), [pid, query]);
  const star = useServiceAction((s, id: string, on: boolean) => s.documents.update(id, { starred: on }));
  const [starring, setStarring] = useState<string | null>(null);

  const docs = useMemo(() => all.data ?? [], [all.data]);
  const counts = useMemo(() => kindCounts(docs), [docs]);
  const facilities = useMemo(() => facilitiesOf(docs), [docs]);
  const hits = found.data ?? [];
  const active = filtersActive({ ...filters, text });
  const askable = isQuestionLike(text);
  const moreCount = [filters.prescriberId, filters.facility, filters.from, filters.to].filter(Boolean).length;

  const toggleStar = async (hit: RecordHit, on: boolean) => {
    setStarring(hit.document.id);
    await star.run(hit.document.id, on);
    setStarring(null);
  };

  const clear = () => {
    setText('');
    setFilters(NO_FILTERS);
  };

  const header = (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10">
      <div className="md:max-w-[640px]">
        <h1 className="text-page-sm md:text-page">Records</h1>
        <p className="mt-3 text-ink-2 md:text-[20px] md:leading-[1.5]">Prescriptions, reports and tests, kept on this device.</p>
      </div>
      <Button to="/records/add" cta icon={<Plus aria-hidden className="size-5" />} className="w-full md:w-auto">
        Add a record
      </Button>
    </header>
  );

  if (all.loading) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <div className="mt-8">
          <SkeletonList count={3} label="Loading records" />
        </div>
      </div>
    );
  }

  if (all.error) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <ErrorPanel className="mt-8" title="Records could not be loaded" message={all.error.message} onRetry={all.reload} />
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="page-gutter py-6 md:py-12">
        {header}
        <EmptyState
          className="mt-8"
          icon={<FolderOpen />}
          title="No records yet"
          action={
            <Button to="/records/add" icon={<Plus aria-hidden className="size-5" />}>
              Add the first record
            </Button>
          }
        >
          Add a prescription, lab report or test as a photo or a PDF, or import report PDFs from Gmail.
        </EmptyState>
      </div>
    );
  }

  const timeline = groupByMonth(hits, (h) => h.document);

  return (
    <div className="page-gutter py-6 md:py-12">
      {header}

      <div role="search" className="mt-8 flex flex-col gap-4 md:mt-10" aria-label="Search and filters">
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
            placeholder="A test, doctor, place or title, for example “lipid”"
            autoComplete="off"
            className="min-h-12 w-full rounded-button border border-line-strong bg-surface py-2 pl-12 pr-4 text-ink placeholder:text-ink-3 focus-visible:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal/40"
          />
        </div>
        {askable && (
          <Link
            to={`/ask?q=${encodeURIComponent(text.trim())}`}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-blue-tint px-4 font-semibold text-blue-ink hover:underline"
          >
            <MessageCircleQuestion aria-hidden className="size-5" />
            Ask CareVault: “{text.trim()}”
          </Link>
        )}

        <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
          <Chip pressed={filters.kind === null} onClick={() => set('kind', null)}>
            All <span className="rounded-full bg-grey-tint px-2 text-min text-ink-2">{docs.length}</span>
          </Chip>
          {counts.map(({ kind, count }) => (
            <Chip key={kind} pressed={filters.kind === kind} onClick={() => set('kind', filters.kind === kind ? null : kind)}>
              {KIND_PLURAL[kind]} <span className="rounded-full bg-grey-tint px-2 text-min text-ink-2">{count}</span>
            </Chip>
          ))}
          <Chip tone="amber" pressed={filters.starredOnly} onClick={() => set('starredOnly', !filters.starredOnly)}>
            <Star aria-hidden className={cx('size-4', filters.starredOnly && 'fill-amber-ink')} />
            Starred
          </Chip>
        </div>

        {/* Phones: these four sit behind "More filters" so the results stay near the top. */}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="records-more-filters"
          onClick={() => setMoreOpen((o) => !o)}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-line-strong bg-surface px-4 text-secondary font-semibold text-ink-2 md:hidden"
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          {moreOpen ? 'Fewer filters' : 'More filters'}
          {moreCount > 0 && <span className="rounded-full bg-teal px-2 text-min text-white">{moreCount}</span>}
        </button>
        <div id="records-more-filters" className={cx(moreOpen ? 'grid' : 'hidden', 'gap-4 sm:grid-cols-2 md:grid lg:grid-cols-4')}>
          <Field
            as="select"
            label="Doctor"
            value={filters.prescriberId}
            onChange={(e) => set('prescriberId', e.target.value)}
            options={[{ value: '', label: 'Any doctor' }, ...prescribers.map((p) => ({ value: p.id, label: p.specialty ? `${p.name}, ${p.specialty}` : p.name }))]}
          />
          <Field
            as="select"
            label="Facility"
            value={filters.facility}
            onChange={(e) => set('facility', e.target.value)}
            options={[{ value: '', label: 'Any facility' }, ...facilities.map((f) => ({ value: f, label: f }))]}
          />
          <Field type="date" label="From" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} />
          <Field type="date" label="To" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="Sort"
            value={filters.sort}
            onChange={(v) => set('sort', v)}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
          />
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
        {(filters.from || filters.to) && <p className="text-secondary text-ink-3">Records with no known date are left out while a date range is set.</p>}
      </div>

      <p aria-live="polite" className="sr-only">
        {found.loading ? 'Searching' : `${plural(hits.length, 'record', 'records')} shown`}
      </p>

      <div className="mt-6">
        {found.loading ? (
          <Skeleton className="h-40 w-full rounded-card" />
        ) : found.error ? (
          <ErrorPanel title="The search could not be run" message={found.error.message} onRetry={found.reload} />
        ) : hits.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No records match"
            action={active ? <Button variant="secondary" onClick={clear}>Clear the search and filters</Button> : undefined}
          >
            Try another word, or fewer filters.
          </EmptyState>
        ) : view === 'grid' ? (
          <ul aria-label="Records" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-5">
            {hits.map((hit) => (
              <li key={hit.document.id} className="flex">
                <DocumentCard
                  className="w-full"
                  document={hit.document}
                  thumbnail={<DocumentThumbnail document={hit.document} />}
                  note={active ? matchedText(hit.matchedOn) : null}
                  onToggleStar={(on) => void toggleStar(hit, on)}
                  starPending={starring === hit.document.id}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div aria-label="Records by month" role="region" className="flex flex-col gap-8">
            {timeline.map((group) => (
              <section key={group.key} aria-labelledby={`month-${group.key}`}>
                <h2 id={`month-${group.key}`} className="mb-4 text-card-sm md:text-card">
                  {group.label}
                </h2>
                <ol>
                  {group.items.map((hit, i) => {
                    const d = hit.document;
                    return (
                      <TimelineItem
                        key={d.id}
                        date={group.key === UNDATED_KEY ? `Added ${formatShortDate(d.addedAt)} ${sourceShort(d)}` : formatDate(d.clinicalDate!)}
                        title={d.title}
                        type={d.kind}
                        to={`/records/${d.id}`}
                        detail={[
                          KIND_LABEL[d.kind],
                          sourceLabel(d),
                          d.state === 'pending_review' ? 'not yet filed' : null,
                          d.starred ? 'starred' : null,
                          active ? matchedText(hit.matchedOn) : null,
                        ].filter(Boolean).join(' · ')}
                        last={i === group.items.length - 1}
                      />
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
