import { Calendar, Folder, Inbox, Pill } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly (for '/'). */
  end?: boolean;
}

/** The four sections (overview spec section 11). /dev/components is deliberately not listed. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Review', icon: Inbox, end: true },
  { to: '/medicines', label: 'Medicines', icon: Pill },
  { to: '/records', label: 'Records', icon: Folder },
  { to: '/visit', label: 'Visit', icon: Calendar },
];
