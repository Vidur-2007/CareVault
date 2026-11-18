import { useEffect, useState } from 'react';
import { toString as qrToString } from 'qrcode';
import { cx } from '../lib/cx';

/** A QR code drawn as SVG with the qrcode library (sharp on screen and in print). */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [svg, setSvg] = useState<{ value: string; data: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    qrToString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#12302f', light: '#ffffff' } })
      .then((data) => !cancelled && setSvg({ value, data }))
      .catch(() => !cancelled && setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!svg || svg.value !== value) return <div aria-hidden className={cx('animate-skeleton rounded-[8px] bg-grey-tint', className)} />;
  return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg.data)}`} alt={label} className={cx('bg-white', className)} />;
}
