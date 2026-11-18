import { Link } from 'react-router';
import type { Medicine, MedicationEvent, Prescriber } from '../../../contract/types';
import { capitalize } from '../../components/lineText';
import { Pill } from '../../components/Pill';
import { lastChange } from './medicineText';
import type { LastChange } from './medicineText';

export interface ConfirmedTableProps {
  medicines: Medicine[];
  prescribers: Prescriber[];
  /** Events per medicine id; missing while loading. */
  history: Record<string, MedicationEvent[]> | undefined;
  since: string | null;
}

function ChangeCell({ change }: { change: LastChange | null }) {
  if (!change) return <span className="text-ink-3">…</span>;
  if (change.kind === 'changed') return <Pill tone="amber">{change.text}</Pill>;
  if (change.kind === 'added') return <Pill tone="blue">{change.text}</Pill>;
  return <span className="text-ink-3">{change.text}</span>;
}

function SourceLink({ m }: { m: Medicine }) {
  return m.sourceDocumentId ? (
    <Link to={`/records/${m.sourceDocumentId}`} className="font-semibold text-teal underline decoration-2 underline-offset-4 hover:text-teal-ink">
      View source<span className="sr-only"> for {m.productName}</span>
    </Link>
  ) : (
    <span className="text-ink-3">Entered by hand</span>
  );
}

/** Confirmed current medicines: a table from 900 px, stacked cards below (two columns on tablets). */
export function ConfirmedTable({ medicines, prescribers, history, since }: ConfirmedTableProps) {
  const prescriber = (id: string | null) => prescribers.find((p) => p.id === id)?.name ?? '—';
  const change = (m: Medicine) => (history?.[m.id] ? lastChange(history[m.id], since) : null);
  const ingredientNames = (m: Medicine) => m.ingredients.map((i) => capitalize(i.name)).join(' + ');

  return (
    <>
      <div className="hidden overflow-hidden rounded-card border border-line bg-surface shadow-card wide:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line text-secondary font-semibold text-ink-3">
              <th scope="col" className="px-7 py-4 font-semibold">Medicine</th>
              <th scope="col" className="px-4 py-4 font-semibold">How it is taken</th>
              <th scope="col" className="px-4 py-4 font-semibold">Prescribed by</th>
              <th scope="col" className="px-4 py-4 font-semibold">Last change</th>
              <th scope="col" className="px-7 py-4 font-semibold">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {medicines.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-7 py-5 text-left font-normal">
                  <Link to={`/medicines/${m.id}`} className="font-semibold text-ink hover:underline">
                    {m.productName}
                  </Link>
                  <span className="block text-secondary text-ink-3">{ingredientNames(m)}</span>
                </th>
                <td className="px-4 py-5 text-ink-2">{m.instruction || '—'}</td>
                <td className="px-4 py-5 text-ink-2">{prescriber(m.prescriberId)}</td>
                <td className="px-4 py-5">
                  <ChangeCell change={change(m)} />
                </td>
                <td className="px-7 py-5">
                  <SourceLink m={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-3 md:grid-cols-2 wide:hidden">
        {medicines.map((m) => (
          <li key={m.id} className="rounded-card-sm border border-line bg-surface p-[18px] shadow-card">
            <Link to={`/medicines/${m.id}`} className="font-semibold text-ink hover:underline">
              {m.productName}
            </Link>
            <p className="text-secondary text-ink-3">{ingredientNames(m)}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-secondary">
              <dt className="text-ink-3">How it is taken</dt>
              <dd className="text-ink-2">{m.instruction || '—'}</dd>
              <dt className="text-ink-3">Prescribed by</dt>
              <dd className="text-ink-2">{prescriber(m.prescriberId)}</dd>
              <dt className="text-ink-3">Last change</dt>
              <dd>
                <ChangeCell change={change(m)} />
              </dd>
            </dl>
            <div className="mt-3">
              <SourceLink m={m} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
