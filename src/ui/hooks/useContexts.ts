import { useContext } from 'react';
import type { CareVaultServices } from '../../contract/legacy/services';
import {
  CloudNoticeContext,
  ProfileContext,
  ServicesContext,
  ToastContext,
} from '../app/contexts';
import type { CloudNoticeContextValue, ProfileContextValue, ToastContextValue } from '../app/contexts';

function required<V>(value: V | null, name: string): V {
  if (value === null) throw new Error(`${name} is missing. Wrap the tree in its provider.`);
  return value;
}

export function useServices(): CareVaultServices {
  return required(useContext(ServicesContext), 'ServicesProvider');
}

export function useProfile(): ProfileContextValue {
  return required(useContext(ProfileContext), 'ProfileProvider');
}

export function useToast(): ToastContextValue {
  return required(useContext(ToastContext), 'ToastProvider');
}

export function useCloudNotice(): CloudNoticeContextValue {
  return required(useContext(CloudNoticeContext), 'CloudNoticeProvider');
}
