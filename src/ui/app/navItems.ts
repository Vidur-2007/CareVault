import { Folder, House, IdCard, MessageCircleQuestion } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly (for '/'). */
  end?: boolean;
}

/** The four sections (overview section 11). Settings is in the profile menu; /dev/components is not listed. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/records', label: 'Records', icon: Folder },
  { to: '/passport', label: 'Passport', icon: IdCard },
  { to: '/ask', label: 'Ask', icon: MessageCircleQuestion },
];

/** A record, medicine or snapshot belongs to one profile: after a switch, show its section instead. */
export function sectionAfterSwitch(pathname: string): string {
  const section = ['/records', '/passport'].find((s) => pathname.startsWith(`${s}/`));
  return section ?? pathname;
}
