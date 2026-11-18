// Types for the browser build of the `qrcode` library. The UI imports this build instead of the
// package root because @types/qrcode references Node's types, which would leak into the whole app
// typecheck (and break core tests that rely on their absence).
declare module 'qrcode/lib/browser.js' {
  export interface QrSvgOptions {
    type?: 'svg';
    margin?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
  }
  /** Renders the QR code as an SVG string. */
  export function toString(text: string, options?: QrSvgOptions): Promise<string>;
}
