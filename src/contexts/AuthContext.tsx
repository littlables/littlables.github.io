import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../services/supabaseService';

export interface SocialLinks {
  twitter?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  website?: string;
}

export interface PillConfig {
  id: string;
  type: 'category' | 'custom' | 'keyword' | 'space' | 'board';
  label?: string;      // for custom pills
  keywords?: string;   // for custom pills (search keywords)
  icon?: string;       // matched or user-overridden emoji icon
}

export type MembershipTier = 'free' | 'member' | 'plus' | 'premium';

export interface MembershipLimits {
  maxSpaces: number;
  maxPlayrooms: number;
  maxPlayroomSpaces: number;
}

export function getMembershipLimits(membership?: string | null): MembershipLimits {
  if (membership && ['member', 'plus', 'premium', 'admin'].includes(membership)) {
    return {
      maxSpaces: 25,
      maxPlayrooms: 10,
      maxPlayroomSpaces: 15,
    };
  }
  return {
    maxSpaces: 5,
    maxPlayrooms: 1,
    maxPlayroomSpaces: 5,
  };
}

export interface Profile {
  id: string;
  display_name: string | null;
  username: string | null;
  bio: string | null;
  social_links: SocialLinks;
  avatar_url: string | null;
  avatar_type: 'initial' | 'character' | 'upload';
  avatar_character: string | null;
  theme: string | null;
  background_color: string | null;
  pills: PillConfig[] | null;
  use_viewer_theme_for_boards: boolean;
  membership?: MembershipTier | string;
  is_admin?: boolean;
  role?: string;
  created_at: string;
  updated_at: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Omit<Profile, 'id' | 'membership' | 'created_at' | 'updated_at'>>) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
  uploadAvatarFile: (file: File) => Promise<string>;
  checkUsernameAvailable: (username: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// After a magic-link (or OAuth) redirect, Supabase leaves its token
// fragment — or a bare "#" — in the address bar. Once the session is
// known, the fragment has served its purpose, so drop it, keeping any
// query params (e.g. ?topic=animals) intact. Real topic hashes
// (#topic/...) are left alone.
function cleanAuthFragmentFromUrl() {
  if (typeof window === 'undefined') return;
  if (!window.location.href.includes('#')) return;
  const rawHash = window.location.hash.replace(/^#\/?/, '');
  const isAuthFragment = /(^|&)(access_token|refresh_token)=/.test(rawHash);
  if (rawHash !== '' && !isAuthFragment) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

// Sign-in return path: Google OAuth and magic links both redirect to
// window.location.origin (the Supabase-allowlisted root), so a user who
// signs in from /taste-reader — or any deep page — lands on the homepage
// and never comes back. Instead of changing redirectTo (a deep path may
// not be in Supabase's Redirect URLs allowlist, and a rejected redirect
// falls back to the project Site URL, which is worse), save the page the
// sign-in started from and restore it once the session is known. The
// restore uses the same pushState + popstate pattern App already uses
// for in-app navigation, so the route state follows the URL.
const SIGN_IN_RETURN_PATH_KEY = 'littlables-return-path';

function saveSignInReturnPath() {
  if (typeof window === 'undefined') return;
  try {
    const path = window.location.pathname + window.location.search;
    if (path) window.localStorage.setItem(SIGN_IN_RETURN_PATH_KEY, path);
  } catch {
    // Private mode or blocked storage: sign-in still works, just without
    // the return trip.
  }
}

function restoreSignInReturnPath() {
  if (typeof window === 'undefined') return;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(SIGN_IN_RETURN_PATH_KEY);
    window.localStorage.removeItem(SIGN_IN_RETURN_PATH_KEY);
  } catch {
    return;
  }
  if (!stored || !stored.startsWith('/')) return;
  const current = window.location.pathname + window.location.search;
  if (stored === current) return;
  window.history.pushState({}, '', stored);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoadedForUserId, setProfileLoadedForUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setLoading(false);
      return;
    }

    // Get initial session
    client.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session) {
        cleanAuthFragmentFromUrl();
        restoreSignInReturnPath();
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        cleanAuthFragmentFromUrl();
        restoreSignInReturnPath();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile when user changes (create one if the signup trigger missed it)
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || !session?.user) {
      setProfile(null);
      setProfileLoadedForUserId(null);
      return;
    }

    let cancelled = false;
    const userId = session.user.id;
    Promise.resolve(
      client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
    )
      .then(async ({ data }) => {
        if (cancelled) return;
        const meta = session.user.user_metadata || {};
        const oauthAvatar = meta.avatar_url || meta.picture || null;
        if (data) {
          setProfile(data as Profile);
          return;
        }
        // No row (e.g. signed up before the trigger existed) — create it
        const displayName =
          meta.full_name || meta.name || (session.user.email || '').split('@')[0] || null;
        const { data: created } = await client
          .from('profiles')
          .upsert(
            {
              id: userId,
              display_name: displayName,
              avatar_url: oauthAvatar,
            },
            { onConflict: 'id' }
          )
          .select()
          .single();
        if (!cancelled && created) setProfile(created as Profile);
      })
      .catch((error: unknown) => {
        console.warn('Profile lookup failed:', error);
      })
      .finally(() => {
        if (!cancelled) setProfileLoadedForUserId(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signInWithGoogle = async () => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');
    saveSignInReturnPath();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  };

  const signInWithEmail = async (email: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');
    saveSignInReturnPath();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        // Use code instead of magic link (better for mobile)
        shouldCreateUser: true,
        // Return the link to the site the user started from (dev stays on
        // dev); without this, Supabase falls back to the project Site URL.
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  };

  const verifyEmailOtp = async (email: string, token: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');
    const { error } = await client.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const client = getSupabaseClient();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    setProfile(null);
  };

  const updateProfile = async (updates: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>) => {
    const client = getSupabaseClient();
    if (!client || !session?.user) throw new Error('Not signed in');
    // Upsert so saving works even if the profile row is missing
    const { data, error } = await client
      .from('profiles')
      .upsert({ id: session.user.id, ...updates }, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    if (data) setProfile(data as Profile);
  };

  // Uploads the file to storage and returns the public URL (does NOT save to profile)
  const uploadAvatarFile = async (file: File): Promise<string> => {
    const client = getSupabaseClient();
    if (!client || !session?.user) throw new Error('Not signed in');

    // Validate file type and size (max 2MB)
    if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
    if (file.size > 2 * 1024 * 1024) throw new Error('Image must be under 2MB');

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${session.user.id}/avatar.${ext}`;

    const { error: uploadError } = await client.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw uploadError;

    const { data } = client.storage.from('avatars').getPublicUrl(path);
    // Cache-bust with timestamp
    return `${data.publicUrl}?t=${Date.now()}`;
  };

  const uploadAvatar = async (file: File): Promise<string> => {
    const url = await uploadAvatarFile(file);
    await updateProfile({ avatar_url: url, avatar_type: 'upload' });
    return url;
  };

  const checkUsernameAvailable = async (username: string): Promise<boolean> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');
    const normalized = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,30}$/.test(normalized)) return false;

    const { data, error } = await client
      .from('profiles')
      .select('id')
      .eq('username', normalized)
      .neq('id', session?.user?.id || '')
      .limit(1);
    if (error) throw error;
    return !data || data.length === 0;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile: session?.user && profileLoadedForUserId === session.user.id ? profile : null,
        loading,
        profileLoading: Boolean(session?.user && profileLoadedForUserId !== session.user.id),
        signInWithGoogle,
        signInWithEmail,
        verifyEmailOtp,
        signOut,
        updateProfile,
        uploadAvatar,
        uploadAvatarFile,
        checkUsernameAvailable,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
