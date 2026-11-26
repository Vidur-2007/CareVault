import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ProfileContext } from '../contexts';
import type { ProfileContextValue } from '../contexts';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { todayForProfile } from '../../lib/today';

const STORAGE_KEY = 'cv.profileId';

function readStoredId(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeId(id: string) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable (private window): the choice lasts for this session only
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(readStoredId);
  const profilesQuery = useServiceQuery((s) => s.profiles.list(), []);
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const profile = profiles.find((p) => p.id === selectedId) ?? profiles[0] ?? null;

  const prescribersQuery = useServiceQuery((s) => s.profiles.prescribers(profile?.id ?? ''), [profile?.id], {
    enabled: profile !== null,
  });

  const setProfileId = useCallback((id: string) => {
    setSelectedId(id);
    storeId(id);
  }, []);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      profiles,
      // Keyed on the profile id, so another profile's prescribers are never returned.
      prescribers: prescribersQuery.data ?? [],
      today: todayForProfile(profile?.id ?? null),
      loading: profilesQuery.loading,
      error: profilesQuery.error,
      setProfileId,
      reload: profilesQuery.reload,
    }),
    [profile, profiles, prescribersQuery.data, profilesQuery.loading, profilesQuery.error, profilesQuery.reload, setProfileId],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
