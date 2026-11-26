// Whether Gmail was connected in this session (UI spec 4.2 and 4.13). The Gmail permission lasts for
// the session only, so this is kept in memory: a reload forgets it, as the services do.
import { useSyncExternalStore } from 'react';

let connected = false;
const listeners = new Set<() => void>();

export function markGmailConnected(value = true) {
  if (connected === value) return;
  connected = value;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useGmailConnected = () => useSyncExternalStore(subscribe, () => connected, () => connected);
