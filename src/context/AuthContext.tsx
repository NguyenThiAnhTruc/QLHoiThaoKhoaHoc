import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { setRememberLogin, supabase } from '@/lib/supabase';
import { AuthContext } from '@/context/AuthContextCore';
import { showToast } from '@/components/ui/toastStore';
import { withRequestTimeout } from '@/lib/requestTimeout';
import type { Profile, UserRole } from '@/types';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authEvent, setAuthEvent] = useState<AuthChangeEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileError, setProfileError] = useState('');
  const generation = useRef(0);
  const loadedUser = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string, version: number) => {
    try {
      const { data, error } = await withRequestTimeout(
        (signal) => supabase.from('profiles').select('*').eq('id', userId).abortSignal(signal).maybeSingle(),
        15000, 'Không thể tải hồ sơ. Vui lòng kiểm tra kết nối và thử lại.',
      );
      if (version !== generation.current) return;
      if (error || !data) throw new Error('Không thể tải hồ sơ tài khoản. Vui lòng thử lại hoặc liên hệ quản trị viên.');
      loadedUser.current = userId;
      setProfile(data as Profile);
      setProfileError('');
    } catch (error) {
      if (version !== generation.current) return;
      loadedUser.current = null;
      setProfile(null);
      setProfileError(error instanceof Error ? error.message : 'Không thể tải hồ sơ tài khoản.');
    }
  }, []);

  useEffect(() => {
    const counter = generation;
    let active = true;
    let receivedEvent = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const updateSession = (next: Session | null, event?: AuthChangeEvent) => {
      if (next?.user.id === loadedUser.current && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
        setSession(next);
        return;
      }
      loadedUser.current = null;
      const version = ++counter.current;
      setSession(next);
      setProfile(null);
      setProfileError('');
      if (!next?.user) { setLoading(false); return; }
      setLoading(true);
      // Leave the auth callback before querying Supabase: auth holds a session lock.
      const timer = setTimeout(() => {
        timers.delete(timer);
        void loadProfile(next.user.id, version).finally(() => {
          if (active && version === counter.current) setLoading(false);
        });
      }, 0);
      timers.add(timer);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      receivedEvent = true;
      setAuthEvent(event);
      updateSession(next, event);
    });
    void withRequestTimeout(() => supabase.auth.getSession(), 15000, 'Không thể khôi phục phiên đăng nhập.').then(({ data, error }) => {
      if (!active || receivedEvent) return;
      if (error) { setLoading(false); return; }
      updateSession(data.session);
    }).catch(() => { if (active && !receivedEvent) setLoading(false); });
    return () => {
      active = false;
      counter.current++;
      timers.forEach(clearTimeout);
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  async function signIn(email: string, password: string, remember = true) {
    setRememberLogin(remember);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signInWithGoogle(remember = true) {
    setRememberLogin(remember);
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    return { error: error?.message ?? null };
  }

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    role: UserRole = "author",
  ) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } },
    });
    return { error: error?.message ?? null };
  }

  async function resetPassword(email: string) {
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      loadedUser.current = null;
      generation.current++;
      setProfile(null);
      setSession(null);
    } catch {
      showToast('error', 'Đăng xuất chưa thành công. Vui lòng kiểm tra kết nối và thử lại.');
    }
  }

  async function refreshProfile() {
    if (session?.user) {
      const version = generation.current;
      setLoading(true);
      try { await loadProfile(session.user.id, version); }
      finally { if (version === generation.current) setLoading(false); }
    }
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileError, authEvent, signIn, signInWithGoogle, signUp, resetPassword, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
