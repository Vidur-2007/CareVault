import { NavLink } from 'react-router';
import type { NavItem } from '../app/navItems';
import { cx } from '../lib/cx';

/** Phone tab bar: icon above label, fixed to the bottom, respects the home-indicator inset. */
export function BottomTabs({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid grid-cols-4 gap-1 px-2 py-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[12px] text-min font-medium transition-colors',
                  isActive ? 'bg-teal-tint font-semibold text-teal-ink' : 'text-ink-2 hover:text-ink',
                )
              }
            >
              <Icon aria-hidden className="size-[22px]" strokeWidth={1.8} />
              <span className="text-[14px] leading-tight">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
