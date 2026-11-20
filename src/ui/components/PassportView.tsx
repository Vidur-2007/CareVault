// The Doctor Visit Passport page (UI spec 7.9, CareVault-Passport.png). Presentational: used by
// /visit/passport and by the public /share/:id view. Sized to print on one A4 page.
import type { ReactNode } from 'react';
import type { Passport } from '../../contract/legacy/types';
import { cx } from '../lib/cx';
import { formatDate, formatDayMonth, formatLongDate, formatWeekday } from '../lib/format';
import { Logo } from './Logo';
import { Pill } from './Pill';
import type { PillTone } from './pills';

export const PASSPORT_DISCLAIMER =
  'Prepared by a family caregiver from records they confirmed. This page lists what was entered; it is not a clinical record and gives no medical advice.';

const CHANGE_PILL: Record<Passport['changes'][number]['kind'], { tone: PillTone; label: string }> = {
  added: { tone: 'blue', label: '+ Added' },
  changed: { tone: 'amber', label: 'Changed' },
  unconfirmed: { tone: 'red', label: 'Unconfirmed' },
};

function visitLine(p: Passport): string | null {
  if (!p.visitAt) return null;
  const who = p.prescriberName ? ` with ${p.prescriberName}${p.prescriberSpecialty ? `, ${p.prescriberSpecialty.toLowerCase()}` : ''}` : '';
  return `For the visit${who}, on ${formatWeekday(p.visitAt)}, ${formatLongDate(p.visitAt)}`;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-sans text-[20px] font-semibold text-ink print:text-[13pt]">{children}</h2>;
}

export interface PassportViewProps {
  passport: Passport;
  /** Top-right slot, e.g. the QR code of an active share link. */
  qr?: ReactNode;
  className?: string;
}

export function PassportView({ passport: p, qr, className }: PassportViewProps) {
  const line = visitLine(p);
  return (
    <article
      aria-labelledby="passport-title"
      className={cx(
        'passport mx-auto flex w-full max-w-[900px] flex-col bg-surface px-5 py-8 text-ink-2 shadow-card md:rounded-card md:px-14 md:py-12',
        'print:max-w-none print:rounded-none print:p-0 print:shadow-none print:text-[10pt]',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="[&_span:first-child]:size-8 [&_span:first-child]:text-[13px] [&_span:last-child]:text-[17px]">
            <Logo />
          </div>
          <h1 id="passport-title" className="mt-4 text-page-sm md:text-[38px] md:leading-tight print:mt-2 print:text-[22pt]">
            Doctor Visit Passport
          </h1>
          {line && <p className="mt-2 text-ink-3 print:mt-1">{line}</p>}
        </div>
        {qr && <div className="shrink-0">{qr}</div>}
      </header>

      <dl className="mt-6 grid gap-4 rounded-panel bg-ground p-5 sm:grid-cols-3 print:mt-4 print:gap-2 print:p-3">
        <div>
          <dt className="text-secondary font-semibold text-ink-3 print:text-[8.5pt]">Patient</dt>
          <dd className="mt-1 text-[18px] font-semibold text-ink print:text-[12pt]">
            {p.patientName}
            {p.patientAge !== null && `, ${p.patientAge}`}
          </dd>
        </div>
        <div>
          <dt className="text-secondary font-semibold text-ink-3 print:text-[8.5pt]">Prepared by</dt>
          <dd className="mt-1 text-[18px] font-semibold text-ink print:text-[12pt]">{p.preparedBy}</dd>
        </div>
        <div>
          <dt className="text-secondary font-semibold text-ink-3 print:text-[8.5pt]">Prepared on</dt>
          <dd className="mt-1 text-[18px] font-semibold text-ink print:text-[12pt]">{formatLongDate(p.preparedOn)}</dd>
        </div>
      </dl>

      <section className="mt-8 break-inside-avoid print:mt-5" aria-labelledby="pp-current">
        <SectionTitle>
          <span id="pp-current">Current medicines, confirmed by the caregiver</span>
        </SectionTitle>
        {p.currentMedicines.length === 0 ? (
          <p className="mt-3 text-ink-3">No medicine has been confirmed yet.</p>
        ) : (
          <table className="mt-3 w-full text-left print:mt-2">
            <thead>
              <tr className="border-b-2 border-ink text-secondary text-ink-3 print:text-[8.5pt]">
                <th scope="col" className="py-2 pr-3 font-semibold">Medicine and strength</th>
                <th scope="col" className="py-2 pr-3 font-semibold">How it is taken</th>
                <th scope="col" className="py-2 font-semibold">Prescribed by</th>
              </tr>
            </thead>
            <tbody>
              {p.currentMedicines.map((m) => (
                <tr key={`${m.productName}-${m.instruction}`} className="border-b border-line">
                  <th scope="row" className="py-2.5 pr-3 text-left font-semibold text-ink print:py-1.5">{m.productName}</th>
                  <td className="py-2.5 pr-3 print:py-1.5">{m.instruction || '—'}</td>
                  <td className="py-2.5 print:py-1.5">{m.prescriberName ?? 'Not from a prescription'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {p.changes.length > 0 && (
        <section className="mt-8 break-inside-avoid print:mt-5" aria-labelledby="pp-changes">
          <SectionTitle>
            <span id="pp-changes">{p.changesSince ? `Changes since the previous prescription of ${formatDayMonth(p.changesSince)}` : 'Changes on the latest prescription'}</span>
          </SectionTitle>
          <ul className="mt-3 flex flex-col gap-2 print:mt-2 print:gap-1">
            {p.changes.map((c) => (
              <li key={`${c.kind}-${c.text}`} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-3 print:grid-cols-[7rem_minmax(0,1fr)]">
                <span>
                  <Pill tone={CHANGE_PILL[c.kind].tone} className="print:px-2 print:py-0.5 print:text-[8.5pt]">
                    {CHANGE_PILL[c.kind].label}
                  </Pill>
                </span>
                <span className="pt-0.5">{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(p.flags.length > 0 || p.documents.length > 0) && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 print:mt-5 print:grid-cols-2">
          {p.flags.length > 0 && (
            <section className="break-inside-avoid rounded-panel border-[1.5px] border-red-line p-5 print:p-3" aria-labelledby="pp-flags">
              <h2 id="pp-flags" className="font-sans text-[18px] font-semibold text-ink print:text-[11pt]">
                Flag for review
              </h2>
              <ul className="mt-2 flex flex-col gap-1">
                {p.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          )}
          {p.documents.length > 0 && (
            <section className="break-inside-avoid rounded-panel border border-line p-5 print:p-3" aria-labelledby="pp-docs">
              <h2 id="pp-docs" className="font-sans text-[18px] font-semibold text-ink print:text-[11pt]">
                Reports shared
              </h2>
              <ul className="mt-2 list-disc pl-5">
                {p.documents.map((d) => (
                  <li key={`${d.title}-${d.documentDate}`}>
                    {d.title}, {formatDate(d.documentDate)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {p.questions.length > 0 && (
        <section className="mt-8 break-inside-avoid rounded-panel bg-ground p-5 print:mt-5 print:p-3" aria-labelledby="pp-questions">
          <h2 id="pp-questions" className="font-sans text-[20px] font-semibold text-ink print:text-[12pt]">
            Questions from the family
          </h2>
          <ol className="mt-3 list-decimal pl-6 print:mt-1.5">
            {p.questions.map((q) => (
              <li key={q} className="py-0.5">
                {q}
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="mt-10 border-t border-line pt-4 text-secondary text-ink-3 print:mt-6 print:pt-2 print:text-[8pt]">{PASSPORT_DISCLAIMER}</footer>
    </article>
  );
}
