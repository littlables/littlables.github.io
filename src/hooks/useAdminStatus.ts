import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

const DEFAULT_ADMIN_EMAILS = ['katie.lyn.counts@gmail.com'];

function getConfiguredAdminEmails(): Set<string> {
  const rawEnv = (import.meta as any).env?.VITE_ADMIN_EMAILS || '';
  const extra = String(rawEnv)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ADMIN_EMAILS, ...extra]);
}

const ADMIN_EMAIL_SET = getConfiguredAdminEmails();

/**
 * Checks whether the currently signed-in site account has admin privileges.
 * Uses the active Supabase Auth session and Profile row — never exposes or pings
 * any external /admin URL for visitors.
 */
export function useAdminStatus() {
  const { user, profile, loading, profileLoading } = useAuth();

  return useMemo(() => {
    if (!user) {
      return { isAdmin: false, adminLogin: null, checking: loading || profileLoading };
    }

    const email = (user.email || '').trim().toLowerCase();
    const hasAdminRole =
      profile?.is_admin === true ||
      profile?.role === 'admin' ||
      profile?.membership === 'admin' ||
      user.app_metadata?.role === 'admin' ||
      user.user_metadata?.is_admin === true ||
      (email.length > 0 && ADMIN_EMAIL_SET.has(email));

    const adminLogin = hasAdminRole
      ? profile?.username || user.email || user.id
      : null;

    return {
      isAdmin: hasAdminRole,
      adminLogin,
      checking: loading || profileLoading,
    };
  }, [user, profile, loading, profileLoading]);
}
