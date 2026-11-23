// Home, UI spec 4.2. One column on phones, two on desktop: the passport card, the next visit,
// "Needs attention" (four kinds only, one action each, nothing when empty), Add a record, the Ask
// box, the three newest records, and the Gmail status when connected this session. No medicine
// status question and no prescription review ever appear here.
import { ArrowRight, CalendarDays, Camera, ChevronRight, IdCard, Mail, MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AttentionItem } from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DocumentCard } from '../components/DocumentCard';
import { ErrorPanel } from '../components/ErrorPanel';
import { Pill } from '../components/Pill';
import { SectionHeader } from '../components/SectionHeader';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { ageFrom, formatTime, formatWeekdayDate } from '../lib/format';
import { useGmailConnected } from '../lib/gmailSession';
import { AssignDialog } from './home/AssignDialog';
import { allergyLine, ATTENTION_PILL, attentionAction, homeItems, profileLine, takenLine } from './home/homeText';

export function HomeScreen() {
  useDocumentTitle('Home');
  const { profile, prescribers, today } = useProfile();
  const p = profile!;
  const pid = p.id;
  const live = useServiceQuery((s) => s.passport.live(pid), [pid]);
  const visit = useServiceQuery((s) => s.visits.next(pid), [pid]);
  const attention = useServiceQuery((s) => s.attention.list(pid), [pid]);
  const documents = useServiceQuery((s) => s.documents.list(pid), [pid]);
  const gmail = useGmailConnected();
  const [assigning, setAssigning] = useState<AttentionItem | null>(null);
  const age = ageFrom(p.birthYear, today);

  const items = homeItems(attention.data ?? []);
  const recent = [...(documents.data ?? [])].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 3);
  const v = visit.data ?? null;
  const doctor = v ? prescribers.find((x) => x.id === v.prescriberId) : undefined;

  return (
    <div className="page-gutter py-6 md:py-12">
      <header>
        <h1 className="text-page-sm md:text-page">{p.name}</h1>
        <p className="mt-2 text-[18px] text-ink-2">{profileLine(p, age)}</p>
      </header>

      {gmail && (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-panel bg-blue-tint px-4 py-3 text-blue-ink">
          <Mail aria-hidden className="size-5" />
          <span>Gmail connected for this session ·</span>
          <Link to="/records/add?from=gmail" className="font-semibold underline underline-offset-2">Check for new reports</Link>
        </p>
      )}

      <div className="mt-8 grid gap-8 wide:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          {attention.error ? (
            <ErrorPanel title="What needs attention could not be loaded" message={attention.error.message} onRetry={attention.reload} />
          ) : attention.loading ? (
            <SkeletonList count={1} label="Loading what needs attention" />
          ) : items.length > 0 ? (
            <section aria-labelledby="attention-title" className="flex flex-col gap-4">
              <SectionHeader id="attention-title" title="Needs attention" />
              <ul className="flex flex-col gap-3">
                {items.map((item) => {
                  const action = attentionAction(item, p);
                  return (
                    <li key={item.id}>
                      <Card as="article" aria-labelledby={`att-${item.id}`} tone={item.kind === 'possible_duplicate_ingredient' ? 'action' : 'default'}>
                        <Pill spec={ATTENTION_PILL[item.kind]} />
                        <h3 id={`att-${item.id}`} className="mt-3 font-sans text-card-sm font-semibold">{item.title}</h3>
                        <p className="mt-1 text-ink-2">{item.body}</p>
                        {'to' in action ? (
                          <Button className="mt-4" to={action.to}>{action.label}</Button>
                        ) : (
                          <Button className="mt-4" onClick={() => setAssigning(item)}>{action.label}</Button>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="add-title" className="grid gap-4 md:grid-cols-2">
            <Card as="div" className="flex flex-col">
              <h2 id="add-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold">
                <Camera aria-hidden className="size-6 text-teal" />
                Add a record
              </h2>
              <p className="mt-2 flex-1 text-ink-2">Take a photo of a prescription or report, or choose a photo or PDF.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button to="/records/add">Add a record</Button>
                <Button variant="secondary" to="/records/add?from=gmail" icon={<Mail aria-hidden className="size-5" />}>From Gmail</Button>
              </div>
            </Card>
            <AskBox />
          </section>

          <section aria-labelledby="recent-records-title" className="flex flex-col gap-4">
            <SectionHeader
              id="recent-records-title"
              title="Recently added"
              aside={<Link to="/records" className="font-semibold text-teal hover:text-teal-ink">All records</Link>}
            />
            {documents.loading ? (
              <SkeletonList count={2} lines={1} label="Loading recent records" />
            ) : documents.error ? (
              <ErrorPanel title="The records could not be loaded" message={documents.error.message} onRetry={documents.reload} />
            ) : recent.length === 0 ? (
              <p className="text-ink-2">No records yet. Add the first one above.</p>
            ) : (
              <ul aria-label="Recently added records" className="grid gap-4 md:grid-cols-3">
                {recent.map((d) => <li key={d.id}><DocumentCard document={d} className="h-full" /></li>)}
              </ul>
            )}
          </section>
        </div>

        {/* On phones the passport card and the next visit come first, as listed in UI spec 4.2. */}
        <aside aria-label="Passport and next visit" className="order-first flex min-w-0 flex-col gap-6 wide:order-none">
          <Card as="section" aria-labelledby="passport-card-title">
            <h2 id="passport-card-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold">
              <IdCard aria-hidden className="size-6 text-teal" />
              Passport
            </h2>
            {live.loading ? (
              <Skeleton className="mt-4 h-20 w-full" />
            ) : live.error ? (
              <ErrorPanel className="mt-4" title="The passport could not be loaded" message={live.error.message} onRetry={live.reload} />
            ) : live.data ? (
              <dl className="mt-4 flex flex-col gap-2 text-ink">
                <div>
                  <dt className="sr-only">Patient</dt>
                  <dd className="font-semibold">{live.data.patientName}{live.data.patientAge !== null ? `, ${live.data.patientAge}` : ''}</dd>
                </div>
                <div>
                  <dt className="sr-only">Medicines</dt>
                  <dd>{takenLine(live.data.currentMedicines.length)}</dd>
                </div>
                {live.data.unconfirmed.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <dt><Pill tone="amber">Current use not confirmed</Pill></dt>
                    <dd>{live.data.unconfirmed.map((u) => u.productName).join(', ')}</dd>
                  </div>
                )}
                <div>
                  <dt className="sr-only">Allergies</dt>
                  <dd>{allergyLine(live.data.allergies)}</dd>
                </div>
              </dl>
            ) : null}
            <Button className="mt-5" variant="secondary" to="/passport" icon={<ChevronRight aria-hidden className="size-5" />}>Open the passport</Button>
          </Card>

          {v && (
            <Card tone="dark" as="section" aria-labelledby="home-visit-title">
              <p className="flex items-center gap-2 text-secondary font-semibold uppercase tracking-wide text-white/70">
                <CalendarDays aria-hidden className="size-4" />
                Next visit
              </p>
              <h2 id="home-visit-title" className="mt-2 text-card">{formatWeekdayDate(v.at)}</h2>
              <p className="mt-1 text-white/85">{[doctor?.name, formatTime(v.at)].filter(Boolean).join(' · ')}</p>
              <Button className="mt-5" to="/passport" variant="secondary">Prepare for the visit</Button>
            </Card>
          )}
        </aside>
      </div>

      <AssignDialog key={assigning?.id ?? 'none'} item={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}

function AskBox() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(text.trim() ? `/ask?q=${encodeURIComponent(text.trim())}` : '/ask');
  };
  return (
    <Card as="div" className="flex flex-col">
      <form role="search" aria-labelledby="home-ask-title" onSubmit={submit} className="flex flex-1 flex-col">
        <h2 id="home-ask-title" className="flex items-center gap-2 font-sans text-card-sm font-semibold">
          <MessageCircleQuestion aria-hidden className="size-6 text-teal" />
          Ask CareVault
        </h2>
        <label className="mt-2 flex flex-1 flex-col gap-2">
          <span className="text-ink-2">Find a record by test, doctor, place or date.</span>
          <input
            type="search"
            aria-label="Your question"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Latest lipid profile"
            autoComplete="off"
            className="min-h-12 w-full rounded-button border border-line-strong bg-surface px-4 text-[17px] text-ink placeholder:text-ink-3 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
          />
        </label>
        <Button type="submit" className="mt-3 self-start" icon={<ArrowRight aria-hidden className="size-5" />}>Ask</Button>
      </form>
    </Card>
  );
}
