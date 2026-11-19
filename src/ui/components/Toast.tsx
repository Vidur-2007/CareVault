import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastContext } from '../app/contexts';
import type { ToastInput, ToastTone } from '../app/contexts';
import { useMotionPresets } from '../app/motion';
import { cx } from '../lib/cx';

interface ToastItem extends Required<Pick<ToastInput, 'message' | 'tone' | 'durationMs'>> {
  id: string;
  action?: ToastInput['action'];
  onExpire?: () => void;
}

const ICON: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden className="size-5 shrink-0 text-teal-tint" />,
  error: <CircleAlert aria-hidden className="size-5 shrink-0 text-red-tint" />,
  info: <Info aria-hidden className="size-5 shrink-0 text-blue-tint" />,
};

/** Toasts sit in one polite live region, above the phone tab bar. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);

  const remove = useCallback((id: string, expired: boolean) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((list) => {
      const item = list.find((t) => t.id === id);
      if (item && expired) queueMicrotask(() => item.onExpire?.());
      return list.filter((t) => t.id !== id);
    });
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = `toast-${++nextId.current}`;
      const item: ToastItem = {
        id,
        message: input.message,
        tone: input.tone ?? 'info',
        durationMs: input.durationMs ?? 5000,
        action: input.action,
        onExpire: input.onExpire,
      };
      setItems((list) => [...list.slice(-2), item]);
      timers.current.set(id, setTimeout(() => remove(id, true), item.durationMs));
      return id;
    },
    [remove],
  );

  const dismiss = useCallback((id: string) => remove(id, true), [remove]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport
        items={items}
        onAction={(item) => {
          remove(item.id, false);
          item.action?.onClick();
        }}
        onClose={(item) => remove(item.id, true)}
      />
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onAction, onClose }: { items: ToastItem[]; onAction: (t: ToastItem) => void; onClose: (t: ToastItem) => void }) {
  const presets = useMotionPresets();
  return (
    <div
      aria-live="polite"
      role="status"
      data-print-hide
      className="pointer-events-none fixed inset-x-0 top-[80px] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:top-auto print:hidden"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout={!presets.reduced}
            {...presets.toast}
            className={cx(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-panel px-4 py-3 text-white shadow-overlay',
              item.tone === 'error' ? 'bg-red-ink' : 'bg-teal-dark',
            )}
          >
            {ICON[item.tone]}
            <p className="min-w-0 flex-1 text-secondary font-medium">{item.message}</p>
            {item.action && (
              <button
                type="button"
                onClick={() => onAction(item)}
                className="min-h-11 rounded-button px-3 font-semibold text-teal-tint underline underline-offset-4 hover:bg-white/10"
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Close message"
              onClick={() => onClose(item)}
              className="flex size-11 shrink-0 items-center justify-center rounded-button hover:bg-white/10"
            >
              <X aria-hidden className="size-5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
