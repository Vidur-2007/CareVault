import type { DocumentKind, DocumentRecord } from '../../contract/types';
import { formatDate } from './format';

export const KIND_LABEL: Record<DocumentKind, string> = {
  prescription: 'Prescription',
  lab_report: 'Lab report',
  imaging: 'Imaging',
  test: 'Test',
  discharge_summary: 'Discharge summary',
  consultation: 'Consultation',
  certificate: 'Certificate',
  other: 'Other',
};

/** Chip labels, in the order the chips are shown. */
export const KIND_PLURAL: Record<DocumentKind, string> = {
  prescription: 'Prescriptions',
  lab_report: 'Lab reports',
  imaging: 'Imaging',
  test: 'Tests',
  discharge_summary: 'Discharge summaries',
  consultation: 'Consultations',
  certificate: 'Certificates',
  other: 'Other',
};

export const KIND_ORDER = Object.keys(KIND_PLURAL) as DocumentKind[];

/** "photo from the camera", "uploaded PDF", "PDF from email". */
export function sourceLabel(doc: Pick<DocumentRecord, 'source' | 'mimeType'>): string {
  const kind = doc.mimeType === 'application/pdf' ? 'PDF' : doc.mimeType.startsWith('image/') ? 'photo' : 'file';
  if (doc.source === 'camera') return kind === 'photo' ? 'photo from the camera' : 'scanned with the camera';
  if (doc.source === 'email') return `${kind} from email`;
  return `uploaded ${kind}`;
}

/** "from email", "from the camera", "uploaded": for "Added 12 Nov from email". */
export function sourceShort(doc: Pick<DocumentRecord, 'source'>): string {
  return doc.source === 'email' ? 'from email' : doc.source === 'camera' ? 'from the camera' : 'uploaded';
}

/** Where the clinical date came from (UI spec 4.5). */
export function dateSourceText(doc: Pick<DocumentRecord, 'clinicalDate' | 'dateSource' | 'receivedAt' | 'source' | 'addedAt'>): string {
  if (doc.clinicalDate === null) {
    if (doc.receivedAt) return `Date not known · received by email on ${formatDate(doc.receivedAt)}`;
    return `Date not known · added on ${formatDate(doc.addedAt)}`;
  }
  switch (doc.dateSource) {
    case 'user': return 'Date set by you';
    case 'email_received': return 'Date the email was received';
    default: return 'Date from the document';
  }
}

/** "Read 2 of 5 pages", or null when nothing is known about the pages. */
export function pagesText(doc: Pick<DocumentRecord, 'pageCount' | 'pagesRead'>): string | null {
  if (doc.pageCount === null) return null;
  const read = doc.pagesRead ?? 0;
  if (read >= doc.pageCount) return doc.pageCount === 1 ? 'Read 1 of 1 page' : `Read all ${doc.pageCount} pages`;
  return `Read ${read} of ${doc.pageCount} pages`;
}
