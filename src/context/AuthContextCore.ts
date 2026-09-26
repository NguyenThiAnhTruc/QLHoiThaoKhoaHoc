import { createContext } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { Profile, UserRole } from "@/types";

export interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  authEvent: AuthChangeEvent | null;
  signIn: (email: string, password: string, remember?: boolean) => Promise<{ error: string | null }>;
  signInWithGoogle: (remember?: boolean) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: UserRole,
  ) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);
