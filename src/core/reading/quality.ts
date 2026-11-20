// Decides whether on-device reading was good enough to use.
import type { ExtractionCandidate } from '../../contract/legacy/types';
import { recognisedSomething } from './parse';

export const MIN_CONFIDENCE = 0.6;
export const MIN_TEXT_LENGTH = 20;

/**
 * True when the cloud reader should be offered: the text is very short, OCR confidence
 * is low, or the document should name medicines and none was recognised from the drug
 * reference. Reports are not expected to name medicines.
 */
export function needsCloud(candidate: ExtractionCandidate, confidence: number): boolean {
  if (candidate.rawText.replace(/\s/g, '').length < MIN_TEXT_LENGTH) return true;
  if (confidence < MIN_CONFIDENCE) return true;
  const namesMedicines = candidate.documentType === 'prescription' || candidate.documentType === 'other';
  return namesMedicines && !recognisedSomething(candidate.lines);
}
