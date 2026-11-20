import type { DocumentRecord, DocumentType } from '../../contract/legacy/types';

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  prescription: 'Prescription',
  lab_report: 'Lab report',
  test: 'Test',
  discharge_summary: 'Discharge summary',
  other: 'Other',
};

export function sourceLabel(doc: Pick<DocumentRecord, 'source' | 'mimeType'>): string {
  const kind = doc.mimeType === 'application/pdf' ? 'PDF' : doc.mimeType.startsWith('image/') ? 'photo' : 'file';
  if (doc.source === 'scan') return 'scanned';
  if (doc.source === 'email') return `${kind} from email`;
  return `uploaded ${kind}`;
}

export function stateLabel(doc: Pick<DocumentRecord, 'state'>): string {
  return doc.state === 'confirmed' ? 'confirmed' : 'not yet confirmed';
}
