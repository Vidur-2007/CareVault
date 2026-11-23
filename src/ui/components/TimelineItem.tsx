import { Activity, Award, ClipboardList, FileText, FlaskConical, Hospital, ScanLine, Stethoscope } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { DocumentKind } from '../../contract/types';
import { cx } from '../lib/cx';

const TYPE_ICON: Record<DocumentKind, ReactNode> = {
  prescription: <ClipboardList aria-hidden className="size-5" />,
  lab_report: <FlaskConical aria-hidden className="size-5" />,
  imaging: <ScanLine aria-hidden className="size-5" />,
  test: <Activity aria-hidden className="size-5" />,
  discharge_summary: <Hospital aria-hidden className="size-5" />,
  consultation: <Stethoscope aria-hidden className="size-5" />,
  certificate: <Award aria-hidden className="size-5" />,
  other: <FileText aria-hidden className="size-5" />,
};

export interface TimelineItemProps {
  /** Date text, e.g. '12 Nov 2026'. */
  date: string;
  title: ReactNode;
  detail?: ReactNode;
  /** Icon by document type, or pass a custom icon. */
  type?: DocumentKind;
  icon?: ReactNode;
  to?: string;
  last?: boolean;
}

/** One line in a vertical timeline: icon on the rail, date, title and detail. */
export function TimelineItem({ date, title, detail, type, icon, to, last = false }: TimelineItemProps) {
  return (
    <li className="relative flex gap-4 pb-6">
      {!last && <span aria-hidden className="absolute left-[21px] top-11 bottom-0 w-px bg-line" />}
      <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-teal-tint text-teal-ink">
        {icon ?? (type ? TYPE_ICON[type] : TYPE_ICON.other)}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-secondary text-ink-3">{date}</p>
        <p className={cx('font-semibold text-ink')}>{to ? <Link to={to} className="hover:underline">{title}</Link> : title}</p>
        {detail && <p className="mt-0.5 text-secondary text-ink-2">{detail}</p>}
      </div>
    </li>
  );
}
