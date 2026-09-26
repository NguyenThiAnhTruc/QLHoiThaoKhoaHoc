import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const rememberLoginKey = 'confmanager:remember-login';

function shouldRememberLogin() {
  if (typeof window === 'undefined') return true;
  return window.sessionStorage.getItem(rememberLoginKey) !== 'false';
}

const authStorage = {
  getItem(key: string) {
    if (typeof window === 'undefined') return null;
    return (shouldRememberLogin() ? window.localStorage : window.sessionStorage).getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === 'undefined') return;
    const target = shouldRememberLogin() ? window.localStorage : window.sessionStorage;
    const other = shouldRememberLogin() ? window.sessionStorage : window.localStorage;
    other.removeItem(key);
    target.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function setRememberLogin(remember: boolean) {
  if (typeof window === 'undefined') return;
  if (remember) {
    window.sessionStorage.removeItem(rememberLoginKey);
    window.localStorage.setItem(rememberLoginKey, 'true');
  } else {
    window.localStorage.removeItem(rememberLoginKey);
    window.sessionStorage.setItem(rememberLoginKey, 'false');
  }
}

export function getRememberLoginPreference() {
  return shouldRememberLogin();
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: authStorage,
  },
});
