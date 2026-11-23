// The passport page (UI spec 4.11): a frozen snapshot, shown in the app, printed, and on the public
// /share/:id page. Presentational and read-only. Safety information (allergies, flags, entries whose
// use is not confirmed) is always shown, and in print it continues on further pages rather than
// being cut: nothing here has a fixed height or hides overflow.
import type { ReactNode } from 'react';
import type { Passport, RoutineSource } from '../../contract/types';
import { cx } from '../lib/cx';
import { formatDate, formatLongDate, formatShortDate, formatTime, formatWeekday } from '../lib/format';
import { changeText } from '../lib/changes';
import { KIND_LABEL } from '../lib/labels';
import { Logo } from './Logo';
import { Pill } from './Pill';
import type { PillTone } from './pills';

export const PASSPORT_DISCLAIMER =
  'Prepared by the patient or a family caregiver from what they entered and confirmed. It is not a clinical record and gives no medical advice. Please verify medicines with a pharmacist or the prescriber.';

export const LINK_FILES_NOTE = 'Original files are not included in the link.';

const SOURCE: Record<RoutineSource, string> = {
  caregiver_reported: 'Reported by the caregiver',
  patient_reported: 'Reported by the patient',
  from_prescription: 'From a prescription',
  from_pack: 'From the pack',
  legacy: 'From the earlier version',
};

const CHANGE: Record<Passport['recentChanges'][number]['kind'], { tone: PillTone; label: string }> = {
  started: { tone: 'blue', label: 'Started' },
  changed: { tone: 'amber', label: 'Changed' },
  stopped: { tone: 'grey', label: 'Stopped' },
  not_started: { tone: 'grey', label: 'Not started' },
};

/** The ingredients line, only when it says more than the product name ("Dolo 650": paracetamol 650 mg). */
const addsToName = (m: Passport['currentMedicines'][number]) =>
  m.ingredientsText.trim() !== '' && m.ingredientsText.trim().toLowerCase() !== m.productName.trim().toLowerCase();

function visitLine(v: NonNullable<Passport['visit']>): string {
  const specialty = v.specialty ? `, ${v.specialty.toLowerCase()}` : '';
  return `For the visit with ${v.prescriberName}${specialty}, ${formatWeekday(v.at)}, ${formatLongDate(v.at)} at ${formatTime(v.at)}`;
}

function Section({ id, title, children, tone = 'plain', className }: { id: string; title: string; children: ReactNode; tone?: 'plain' | 'alert' | 'muted'; className?: string }) {
  return (
    <section
      aria-labelledby={id}
      className={cx(
        'mt-7 print:mt-3',
        tone === 'alert' && 'rounded-panel border-[1.5px] border-red-line p-5 print:p-3',
        tone === 'muted' && 'rounded-panel bg-ground p-5 print:p-3',
        className,
      )}
    >
      <h2 id={id} className="font-sans text-[20px] font-semibold text-ink print:text-[12.5pt]">{title}</h2>
      <div className="mt-3 print:mt-1.5">{children}</div>
    </section>
  );
}

export interface PassportViewProps {
  passport: Passport;
  /** "Passport 3 · prepared 14 Nov 2026"; revision 0 is a v1 passport without a number. */
  revision?: number;
  /** Top-right slot: only ever the QR of a link to this exact snapshot. */
  qr?: ReactNode;
  /** The page's h1 is outside (in the app), or this is the page heading (print and public page). */
  headingLevel?: 1 | 2;
  className?: string;
}

export function PassportView({ passport: p, revision, qr, headingLevel = 1, className }: PassportViewProps) {
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const meta = [revision ? `Passport ${revision}` : 'Passport', `prepared ${formatDate(p.preparedOn)}`].join(' · ');
  return (
    <article
      aria-labelledby="passport-title"
      className={cx(
        'passport mx-auto flex w-full max-w-[900px] flex-col bg-surface px-5 py-8 text-ink-2 shadow-card md:rounded-card md:px-12 md:py-10',
        'print:max-w-none print:rounded-none print:p-0 print:text-[10pt] print:shadow-none',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <Logo small />
          <Title id="passport-title" className="mt-4 text-page-sm md:text-[36px] md:leading-tight print:mt-2 print:text-[20pt]">
            Health passport
          </Title>
          <p className="mt-1 font-semibold text-ink-3">{meta}</p>
          {p.visit && <p className="mt-1 text-ink-3">{visitLine(p.visit)}</p>}
        </div>
        {qr && <div className="shrink-0">{qr}</div>}
      </header>

      <dl className="mt-6 grid gap-4 rounded-panel bg-ground p-5 sm:grid-cols-2 print:mt-3 print:grid-cols-4 print:gap-2 print:p-3">
        {[
          ['Patient', `${p.patientName}${p.patientAge !== null ? `, ${p.patientAge}` : ''}`],
          ['Emergency contact', p.emergencyContact ?? 'Not added'],
          ['Prepared by', p.preparedBy],
          ['Prepared on', formatLongDate(p.preparedOn)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-secondary font-semibold text-ink-3 print:text-[8.5pt]">{label}</dt>
            <dd className="mt-1 text-[17px] font-semibold text-ink print:text-[11pt]">{value}</dd>
          </div>
        ))}
      </dl>

      <Section id="pp-allergies" title="Allergies" tone={p.allergies.state === 'listed' ? 'alert' : 'plain'} className="break-inside-avoid">
        {p.allergies.state === 'listed' ? (
          <ul className="flex flex-col gap-1 font-semibold text-ink">
            {p.allergies.items.map((a) => <li key={a}>{a}</li>)}
          </ul>
        ) : p.allergies.state === 'none_known' ? (
          <p className="font-semibold text-ink">No known allergies</p>
        ) : (
          <p className="text-ink">
            <span className="font-semibold">Not recorded.</span> Allergies have not been entered; this is not the same as no allergies.
          </p>
        )}
      </Section>

      {p.flags.length > 0 && (
        <Section id="pp-flags" title="Flag for review" tone="alert" className="break-inside-avoid">
          <ul className="flex flex-col gap-1 text-ink">
            {p.flags.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </Section>
      )}

      <Section id="pp-current" title="Current medicines">
        {p.currentMedicines.length === 0 ? (
          <p className="text-ink-3">No medicine is recorded as being taken.</p>
        ) : (
          <table className="w-full text-left">
            <thead className="max-sm:sr-only">
              <tr className="border-b-2 border-ink text-secondary text-ink-3 print:text-[8.5pt]">
                <th scope="col" className="py-2 pr-3 font-semibold">Medicine</th>
                <th scope="col" className="py-2 pr-3 font-semibold">How it is taken</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Prescribed by</th>
                <th scope="col" className="py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {p.currentMedicines.map((m) => (
                <tr key={`${m.productName}-${m.instruction}`} className="border-b border-line align-top max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:py-2">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal max-sm:col-span-2 max-sm:py-0.5 print:py-1">
                    <span className="block font-semibold text-ink">{m.productName}</span>
                    {addsToName(m) && <span className="block text-secondary text-ink-3 print:text-[8.5pt]">{m.ingredientsText}</span>}
                  </th>
                  <td className="py-2.5 pr-3 max-sm:py-0.5 print:py-1">{m.instruction || 'Not entered'}</td>
                  <td className="py-2.5 pr-3 max-sm:py-0.5 print:py-1">{m.prescriberName ?? 'No prescriber'}</td>
                  <td className="py-2.5 max-sm:py-0.5 print:py-1">
                    {SOURCE[m.source]}
                    <span className="block text-secondary text-ink-3 print:text-[8.5pt]">
                      {m.lastConfirmedOn ? `Confirmed ${formatShortDate(m.lastConfirmedOn)}` : 'Not confirmed yet'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {p.unconfirmed.length > 0 && (
        <Section id="pp-unconfirmed" title="Current use not confirmed" tone="alert">
          <ul className="flex flex-col gap-1">
            {p.unconfirmed.map((u) => (
              <li key={u.productName}>
                <span className="font-semibold text-ink">{u.productName}</span>
                {u.reason && u.reason.toLowerCase() !== 'current use not confirmed' && <span>: {u.reason}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(p.conditions.length > 0 || p.procedures.length > 0) && (
        <div className="grid gap-x-8 sm:grid-cols-2 print:grid-cols-2">
          <Section id="pp-conditions" title="Conditions">
            {p.conditions.length ? <ul className="list-disc pl-5">{p.conditions.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="text-ink-3">None recorded.</p>}
          </Section>
          <Section id="pp-procedures" title="Procedures">
            {p.procedures.length ? <ul className="list-disc pl-5">{p.procedures.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="text-ink-3">None recorded.</p>}
          </Section>
        </div>
      )}

      {p.recentChanges.length > 0 && (
        <Section id="pp-changes" title="Recent changes">
          <ul className="flex flex-col gap-2 print:gap-1">
            {p.recentChanges.map((c, i) => (
              <li key={`${c.on}-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] print:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
                <span><Pill tone={CHANGE[c.kind].tone} className="print:px-2 print:py-0.5 print:text-[8.5pt]">{CHANGE[c.kind].label}</Pill></span>
                <span className="pt-0.5">{changeText(c)}</span>
                <span className="col-start-2 text-secondary text-ink-3 sm:col-start-auto sm:pt-0.5 print:col-start-auto print:text-[8.5pt]">{formatDate(c.on)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.questions.length > 0 && (
        <Section id="pp-questions" title="Questions for the doctor" tone="muted">
          <ol className="list-decimal pl-6">
            {p.questions.map((q) => <li key={q} className="py-0.5">{q}</li>)}
          </ol>
        </Section>
      )}

      <Section id="pp-docs" title="Reports included">
        {p.documents.length === 0 ? (
          <p className="text-ink-3">No reports were selected.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {p.documents.map((d) => (
              <li key={d.documentId}>
                <span className="font-semibold text-ink">{d.title}</span>
                <span>, {KIND_LABEL[d.kind]}, {d.clinicalDate ? formatDate(d.clinicalDate) : 'date not known'}</span>
                {d.removedAt && <span className="text-ink-3"> · Original removed on {formatDate(d.removedAt)}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-secondary text-ink-3 print:mt-1 print:text-[8.5pt]">{LINK_FILES_NOTE}</p>
      </Section>

      <footer className="mt-10 border-t border-line pt-4 text-secondary text-ink-3 print:mt-5 print:pt-2 print:text-[8pt]">{PASSPORT_DISCLAIMER}</footer>
    </article>
  );
}
