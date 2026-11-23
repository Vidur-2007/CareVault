// Ask, UI spec 4.12: one question box with example chips. The answer comes from records.ask, which
// reads the question with fixed rules (no model) and searches the records on this device. One
// question at a time, kept in the address (?q=) so Back returns to it; there is no chat history.
import { ArrowRight, ChevronRight, FileText, MessageCircleQuestion, Pill as PillIcon, Search } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AskAnswer, Prescriber } from '../../contract/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorPanel } from '../components/ErrorPanel';
import { Pill } from '../components/Pill';
import { SkeletonList } from '../components/Skeleton';
import { useProfile } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { howTaken } from './passport/passportText';
import { ASK_FOOTER, examples, kindLabel, lookingFor, NOT_UNDERSTOOD, resultMeta } from './ask/askText';

export function AskScreen() {
  useDocumentTitle('Ask');
  const { profile, prescribers } = useProfile();
  const pid = profile!.id;
  const [params, setParams] = useSearchParams();
  const question = (params.get('q') ?? '').trim();
  const answer = useServiceQuery((s) => s.records.ask(pid, question), [pid, question], { enabled: question !== '' });
  const chips = examples(profile!);
  const ask = (text: string) => setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });

  return (
    <div className="page-gutter py-6 md:py-12">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header>
          <h1 className="text-page-sm md:text-page">Ask CareVault</h1>
          <p className="mt-3 text-[18px] text-ink-2">Ask about {profile!.name.split(' ')[0]}&rsquo;s records: a test, a doctor, a place or a date.</p>
        </header>

        <QuestionForm key={question} initial={question} onAsk={ask} />

        <section aria-labelledby="examples-title">
          <h2 id="examples-title" className="text-secondary font-semibold text-ink-3">Examples</h2>
          <Chips chips={chips} onAsk={ask} className="mt-2" />
        </section>

        <section aria-label="Answer" aria-live="polite" aria-busy={answer.loading}>
          {question === '' ? null : answer.loading ? (
            <SkeletonList count={2} label="Looking through the records" />
          ) : answer.error ? (
            <ErrorPanel title="The question could not be answered" message={answer.error.message} onRetry={answer.reload} />
          ) : answer.data ? (
            <Answer answer={answer.data} prescribers={prescribers} chips={chips} onAsk={ask} />
          ) : null}
        </section>

        <footer className="border-t border-line pt-5 text-secondary text-ink-3">{ASK_FOOTER}</footer>
      </div>
    </div>
  );
}

function QuestionForm({ initial, onAsk }: { initial: string; onAsk: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAsk(text);
  };
  return (
    <form role="search" aria-label="Ask a question" onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-semibold text-ink">Your question</span>
        <span className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="For example: latest lipid profile"
            autoComplete="off"
            className="min-h-12 w-full rounded-button border border-line-strong bg-surface pl-12 pr-4 text-[17px] text-ink placeholder:text-ink-3 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
          />
        </span>
      </label>
      <Button type="submit" icon={<ArrowRight aria-hidden className="size-5" />}>Ask</Button>
    </form>
  );
}

function Chips({ chips, onAsk, className }: { chips: string[]; onAsk: (text: string) => void; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      {chips.map((c) => (
        <li key={c}>
          <button
            type="button"
            onClick={() => onAsk(c)}
            className="min-h-11 rounded-full border border-line bg-surface px-4 text-left font-semibold text-teal-ink transition-colors hover:bg-teal-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            {c}
          </button>
        </li>
      ))}
    </ul>
  );
}

const resultLink = 'flex min-h-11 items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3 transition-colors hover:border-teal hover:bg-teal-tint/40';

function Answer({ answer: a, prescribers, chips, onAsk }: { answer: AskAnswer; prescribers: Prescriber[]; chips: string[]; onAsk: (text: string) => void }) {
  if (!a.understood) {
    return (
      <Card tone="muted">
        <p className="flex items-start gap-2 text-ink">
          <MessageCircleQuestion aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />
          <span>
            {NOT_UNDERSTOOD}{' '}
            {/* Two of the examples, inline: the full set is just above. */}
            {chips.slice(0, 2).map((c, i) => (
              <span key={c}>
                {i > 0 && ' or '}
                <button type="button" onClick={() => onAsk(c)} className="font-semibold text-teal-ink underline underline-offset-2 hover:text-teal">
                  {c.toLowerCase()}
                </button>
              </span>
            ))}
            .
          </span>
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-secondary font-semibold text-ink-3">{lookingFor(a.interpretedAs)}</p>
        <p className="mt-1 text-[18px] text-ink">{a.text}</p>
      </div>

      {a.kind === 'documents' && a.documents.length > 0 && (
        <ul aria-label="Records found" className="flex flex-col gap-2">
          {a.documents.map(({ document: d, matchedOn }) => (
            <li key={d.id}>
              <Link to={`/records/${d.id}`} className={resultLink}>
                <span className="flex min-w-0 items-start gap-3">
                  <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{d.title}</span>
                      <Pill tone="grey">{kindLabel(d)}</Pill>
                    </span>
                    <span className="block text-secondary text-ink-2">{resultMeta(d, prescribers)}</span>
                    {matchedOn.length > 0 && <span className="block text-secondary text-ink-3">Matched: {matchedOn.join(', ')}</span>}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {a.kind === 'questions' && (
        <>
          {a.questions.length > 0 && (
            <ol className="list-decimal rounded-panel bg-surface px-4 py-3 pl-9 text-ink">
              {a.questions.map((q) => <li key={q.id} className="py-0.5">{q.text}</li>)}
            </ol>
          )}
          <Link to="/passport#questions" className={resultLink}>
            <span className="font-semibold text-teal-ink">Open the questions in the passport</span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-3" />
          </Link>
        </>
      )}

      {a.kind === 'routine' && (
        <>
          {a.medicines.length > 0 && (
            <ul aria-label="Medicines taken" className="flex flex-col gap-2">
              {a.medicines.map((m) => (
                <li key={m.id}>
                  <Link to={`/passport/medicines/${m.id}`} className={resultLink}>
                    <span className="flex min-w-0 items-start gap-3">
                      <PillIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">{m.productName}</span>
                        <span className="block text-secondary text-ink-2">{howTaken(m)}</span>
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/passport#medicines" className={resultLink}>
            <span className="font-semibold text-teal-ink">Open the current medicines in the passport</span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-3" />
          </Link>
        </>
      )}
    </div>
  );
}
