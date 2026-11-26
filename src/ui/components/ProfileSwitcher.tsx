import { Check, ChevronDown, Plus, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Profile } from '../../contract/types';
import { cx } from '../lib/cx';
import { ageFrom, initials } from '../lib/format';
import { todayForProfile } from '../lib/today';

export interface ProfileSwitcherProps {
  profiles: Profile[];
  current: Profile | null;
  onSelect: (id: string) => void;
  /** Phone: avatar and relation only. */
  compact?: boolean;
}

/** The age uses each profile's own "today" (todayFor): the sample profiles keep their calendar. */
function subtitle(p: Profile) {
  const age = ageFrom(p.birthYear, todayForProfile(p.id));
  return age === null ? p.relation : `${p.relation}, ${age}`;
}

/** The profile menu (UI spec section 3): whose records are open, switch profile, add a profile, Settings. */
export function ProfileSwitcher({ profiles, current, onSelect, compact = false }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!current) return null;

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Profile: ${current.name}, ${subtitle(current)}. Profile menu`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 items-center gap-3 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 text-left hover:bg-surface-muted"
      >
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-tint text-[13px] font-bold text-blue-ink">
          {initials(current.name)}
        </span>
        {compact ? (
          <span aria-hidden className="font-semibold text-ink">
            {current.relation}
          </span>
        ) : (
          <span aria-hidden className="flex items-baseline gap-2">
            <span className="font-semibold text-ink">{current.name}</span>
            <span className="text-secondary text-ink-3">{subtitle(current)}</span>
          </span>
        )}
        {!compact && <ChevronDown aria-hidden className={cx('size-4 text-ink-3 transition-transform', open && 'rotate-180')} />}
      </button>

      {open && (
        <div id={menuId} className="absolute right-0 top-full z-40 mt-2 w-72 rounded-panel border border-line bg-surface p-2 shadow-overlay">
          <p className="px-3 pb-1 pt-2 text-secondary font-semibold text-ink-3">Switch profile</p>
          <ul>
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={p.id === current.id ? 'true' : undefined}
                  onClick={() => {
                    onSelect(p.id);
                    setOpen(false);
                    button.current?.focus();
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-button px-3 text-left hover:bg-surface-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{p.name}</span>
                    <span className="block text-secondary text-ink-3">{subtitle(p)}</span>
                  </span>
                  {p.id === current.id && <Check aria-label="Current profile" className="size-5 text-teal" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-line pt-1">
            <Link
              to="/welcome?new=profile"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center gap-2 rounded-button px-3 font-semibold text-teal hover:bg-surface-muted"
            >
              <Plus aria-hidden className="size-5" />
              Add a profile
            </Link>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center gap-2 rounded-button px-3 font-semibold text-ink-2 hover:bg-surface-muted"
            >
              <Settings aria-hidden className="size-5" />
              Settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
