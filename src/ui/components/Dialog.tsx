import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMotionPresets } from '../app/motion';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { cx } from '../lib/cx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the close (X) button, e.g. while a request is pending. */
  hideClose?: boolean;
}

const WIDTH = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

/** Modal dialog: labelled, traps focus, closes on Escape and on backdrop click, restores focus. */
export function Dialog(props: DialogProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>{props.open && <DialogPanel key="dialog" {...props} />}</AnimatePresence>,
    document.body,
  );
}

function DialogPanel({ onClose, title, description, children, footer, size = 'md', hideClose }: DialogProps) {
  const presets = useMotionPresets();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref, true, onClose);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <motion.div {...presets.backdrop} className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        {...presets.dialog}
        className={cx(
          'relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-card-sm bg-surface shadow-overlay sm:rounded-card',
          WIDTH[size],
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-5 md:px-7 md:pt-7">
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
          {!hideClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              data-focus-skip
              className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-button text-ink-3 hover:bg-grey-tint"
            >
              <X aria-hidden className="size-5" />
            </button>
          )}
        </div>
        {children && <div className="min-h-0 overflow-y-auto px-5 pt-4 md:px-7">{children}</div>}
        {footer && <div className="flex flex-col-reverse gap-3 px-5 pb-5 pt-6 sm:flex-row sm:justify-end md:px-7 md:pb-7">{footer}</div>}
        {!footer && <div className="pb-5 md:pb-7" />}
      </motion.div>
    </div>
  );
}
