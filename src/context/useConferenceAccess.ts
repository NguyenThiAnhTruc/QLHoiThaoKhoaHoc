import { useEffect, useState } from 'react';
import { useAuth } from '@/context/useAuth';
import { supabase } from '@/lib/supabase';
import type { Conference } from '@/types';

// Use the same per-conference authorization as the database, including staff.
export function useConferenceAccess() {
  const { profile } = useAuth();
  const [access, setAccess] = useState<{ userId: string; conferences: Conference[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (profile) {
      void supabase.rpc('managed_conferences').then(({ data, error }) => {
        if (!cancelled) {
          setAccess({ userId: profile.id, conferences: error ? [] : (data ?? []) as Conference[] });
        }
      });
    }
    return () => { cancelled = true; };
  }, [profile]);

  const conferences = access?.userId === profile?.id ? access?.conferences ?? [] : [];
  return { conferences, canManage: (id: string) => conferences.some((conference) => conference.id === id) };
}
