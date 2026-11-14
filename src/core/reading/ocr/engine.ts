// The one interface both OCR engines implement.
export interface OcrResult {
  text: string;
  /** 0 to 1. */
  confidence: number;
}

export interface OcrEngine {
  readonly name: 'tesseract' | 'paddle';
  recognize(image: Blob): Promise<OcrResult>;
  /** Frees the worker and model memory. */
  dispose(): Promise<void>;
}
