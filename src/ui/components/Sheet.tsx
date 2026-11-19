import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMotionPresets } from '../app/motion';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { cx } from '../lib/cx';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** 'wide' gives the desktop side panel room for a document beside a form. */
  size?: 'md' | 'wide';
}

/** Bottom sheet on phones, side panel on desktop. Same focus rules as Dialog. */
export function Sheet(props: SheetProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(<AnimatePresence>{props.open && <SheetPanel key="sheet" {...props} />}</AnimatePresence>, document.body);
}

function SheetPanel({ onClose, title, description, children, footer, size = 'md' }: SheetProps) {
  const presets = useMotionPresets();
  const desktop = useIsDesktop();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref, true, onClose);

  return (
    <div className="fixed inset-0 z-40">
      <motion.div {...presets.backdrop} className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        {...(desktop ? presets.sheetDesktop : presets.sheetPhone)}
        className={cx(
          'absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-card-sm bg-surface shadow-overlay md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:rounded-none md:rounded-l-card',
          size === 'wide' ? 'md:w-[min(1120px,94vw)]' : 'md:w-[480px]',
        )}
      >
        <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-line md:hidden" />
        <div className="flex items-start gap-3 px-5 pt-4 md:px-7 md:pt-7">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-card-sm md:text-card">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-2 text-ink-2">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            data-focus-skip
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-button text-ink-3 hover:bg-grey-tint"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-7">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-3 border-t border-line px-5 py-4 sm:flex-row sm:justify-end md:px-7">{footer}</div>}
      </motion.div>
    </div>
  );
}
