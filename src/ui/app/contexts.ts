// React contexts shared by the UI. Providers live in src/ui/app/providers, hooks in src/ui/hooks.
import { createContext } from 'react';
import type { CareVaultServices } from '../../contract/services';
import type { ISODate, Prescriber, Profile } from '../../contract/types';

export const ServicesContext = createContext<CareVaultServices | null>(null);

export interface ProfileContextValue {
  profile: Profile | null;
  profiles: Profile[];
  prescribers: Prescriber[];
  /** todayFor(profile, device date): the date every screen uses (UI spec section 3). */
  today: ISODate;
  loading: boolean;
  error: Error | null;
  setProfileId: (id: string) => void;
  reload: () => void;
}
export const ProfileContext = createContext<ProfileContextValue | null>(null);

export type ToastTone = 'success' | 'error' | 'info';
export interface ToastInput {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** Default 5000 ms. */
  durationMs?: number;
  /** Called when the toast closes without its action being used. */
  onExpire?: () => void;
}
export interface ToastContextValue {
  show: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}
export const ToastContext = createContext<ToastContextValue | null>(null);

export interface CloudNoticeContextValue {
  message: string | null;
  /** Shows the notice before fn starts and hides it when fn settles. */
  run: <R>(message: string, fn: () => Promise<R>) => Promise<R>;
}
export const CloudNoticeContext = createContext<CloudNoticeContextValue | null>(null);
