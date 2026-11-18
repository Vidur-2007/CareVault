import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import type { NavItem } from '../app/navItems';
import { cx } from '../lib/cx';
import { Logo } from './Logo';

/** Desktop top bar: mark, navigation pills, and a right-hand slot (profile switcher). */
export function TopNav({ items, right }: { items: NavItem[]; right?: ReactNode }) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex h-[86px] max-w-[1440px] items-center gap-4 px-5 lg:gap-8 lg:px-10">
        <Link to="/" className="shrink-0 rounded-button">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex-1">
          <ul className="flex items-center gap-1 lg:gap-2">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      'inline-flex min-h-12 items-center rounded-full px-3.5 text-[17px] font-medium transition-colors lg:px-5',
                      isActive ? 'bg-teal-tint font-semibold text-teal-ink' : 'text-ink-2 hover:bg-surface-muted hover:text-ink',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {right}
      </div>
    </div>
  );
}
