import { X } from 'lucide-react';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { Visit } from '../../../contract/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useServiceAction } from '../../hooks/useServiceAction';

/** Questions for the doctor: list, remove, and add with a labelled input. */
export function QuestionsCard({ visit }: { visit: Visit }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const add = useServiceAction((s, value: string) => s.visits.addQuestion(visit.id, value), { success: 'Question added' });
  const remove = useServiceAction((s, questionId: string) => s.visits.removeQuestion(visit.id, questionId), { success: 'Question removed' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) {
      setError('Please type a question first.');
      return;
    }
    setError(null);
    const saved = await add.run(value);
    if (saved) setText('');
  };

  return (
    <Card as="section" aria-labelledby="questions-title">
      <h2 id="questions-title" className="font-sans text-card-sm font-semibold md:text-[22px]">
        Questions for the doctor
      </h2>
      {visit.questions.length === 0 ? (
        <p className="mt-3 text-ink-3">No questions yet.</p>
      ) : (
        <ol className="mt-4 flex list-decimal flex-col gap-2 pl-6 text-ink-2 marker:text-ink-3">
          {visit.questions.map((q) => (
            <li key={q.id} className="pl-1">
              <div className="flex items-start gap-2">
                <span className="flex-1 pt-0.5">{q.text}</span>
                <button
                  type="button"
                  aria-label={`Remove question: ${q.text}`}
                  onClick={() => void remove.run(q.id)}
                  disabled={remove.pending}
                  className="-mr-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-button text-ink-3 hover:bg-grey-tint disabled:opacity-50"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form noValidate onSubmit={submit} className="mt-5">
        <label htmlFor={inputId} className="font-semibold text-ink">
          Add your own question
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a question"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className="min-h-12 min-w-0 flex-1 rounded-button border border-line-strong bg-surface px-4 text-ink placeholder:text-ink-3 focus-visible:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal/40"
          />
          <Button type="submit" variant="secondary" loading={add.pending}>
            Add
          </Button>
        </div>
        {error && (
          <p id={`${inputId}-error`} className="mt-2 text-secondary font-medium text-red-ink">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}
