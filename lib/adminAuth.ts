export const ADMIN_ALLOWLIST = ['joeperez2k@gmail.com', 'derek.huoth@gmail.com'];
export const SUPAVORE_ACCESS_TOKEN_COOKIE = 'supavore-access-token';
export const SUPAVORE_REFRESH_TOKEN_COOKIE = 'supavore-refresh-token';

export type SupabaseUser = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string | null;
  } | null;
};

type AdminAuthResult =
  | {
      ok: true;
      user: SupabaseUser;
      refreshedSession: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number | null;
      } | null;
    }
  | {
      ok: false;
      status: 401 | 403;
      refreshedSession: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number | null;
      } | null;
    };

function getSupabasePublicConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL.');
  }

  if (!supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
  };
}

export function normalizeAdminEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? '';
}

export function isAdminAllowlistedEmail(email: string | null | undefined) {
  const normalizedEmail = normalizeAdminEmail(email);

  return (
    normalizedEmail.length > 0 &&
    ADMIN_ALLOWLIST.some((allowedEmail) => normalizeAdminEmail(allowedEmail) === normalizedEmail)
  );
}

export function isAdminAllowlistedUser(user: SupabaseUser | null | undefined) {
  return isAdminAllowlistedEmail(user?.email);
}

export async function getSupabaseUser(accessToken: string): Promise<SupabaseUser | null> {
  const { supabaseUrl, supabaseAnonKey } = getSupabasePublicConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as SupabaseUser;
}

async function refreshSupabaseSession(refreshToken: string) {
  const { supabaseUrl, supabaseAnonKey } = getSupabasePublicConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number | null;
    user?: SupabaseUser;
  };

  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) {
    return null;
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_at ?? null,
    user: payload.user,
  };
}

async function resolveAdminUser(accessToken: string) {
  const user = await getSupabaseUser(accessToken);

  if (!user?.id) {
    return null;
  }

  if (!isAdminAllowlistedUser(user)) {
    return {
      user,
      authorized: false as const,
    };
  }

  return {
    user,
    authorized: true as const,
  };
}

export async function authenticateAdminSession(params: {
  accessToken?: string | null;
  refreshToken?: string | null;
}): Promise<AdminAuthResult> {
  const accessToken = params.accessToken?.trim() || null;
  const refreshToken = params.refreshToken?.trim() || null;

  if (accessToken) {
    const resolvedAdmin = await resolveAdminUser(accessToken);

    if (resolvedAdmin?.authorized) {
      return {
        ok: true,
        user: resolvedAdmin.user,
        refreshedSession: null,
      };
    }

    if (resolvedAdmin && !resolvedAdmin.authorized) {
      return {
        ok: false,
        status: 403,
        refreshedSession: null,
      };
    }
  }

  if (!refreshToken) {
    return {
      ok: false,
      status: 401,
      refreshedSession: null,
    };
  }

  const refreshedSession = await refreshSupabaseSession(refreshToken);

  if (!refreshedSession) {
    return {
      ok: false,
      status: 401,
      refreshedSession: null,
    };
  }

  const refreshedAdmin = await resolveAdminUser(refreshedSession.accessToken);

  if (!refreshedAdmin?.authorized) {
    return {
      ok: false,
      status: refreshedAdmin ? 403 : 401,
      refreshedSession: {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        expiresAt: refreshedSession.expiresAt,
      },
    };
  }

  return {
    ok: true,
    user: refreshedAdmin.user,
    refreshedSession: {
      accessToken: refreshedSession.accessToken,
      refreshToken: refreshedSession.refreshToken,
      expiresAt: refreshedSession.expiresAt,
    },
  };
}
