export const ADMIN_ROLES = new Set(['admin', 'super_admin']);
export const SUPAVORE_ACCESS_TOKEN_COOKIE = 'supavore-access-token';
export const SUPAVORE_REFRESH_TOKEN_COOKIE = 'supavore-refresh-token';

type SupabaseUser = {
  id: string;
  email?: string | null;
};

type AdminAuthResult =
  | {
      ok: true;
      user: SupabaseUser;
      role: string;
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

function isAdminRole(role: string | null | undefined) {
  return Boolean(role && ADMIN_ROLES.has(role));
}

async function getSupabaseUser(accessToken: string): Promise<SupabaseUser | null> {
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

async function getProfileRole(accessToken: string, userId: string): Promise<string | null> {
  const { supabaseUrl, supabaseAnonKey } = getSupabasePublicConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as Array<{ role?: string | null }>;
  return payload[0]?.role ?? null;
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

  const role = await getProfileRole(accessToken, user.id);

  if (!isAdminRole(role)) {
    return {
      user,
      role,
      authorized: false as const,
    };
  }

  return {
    user,
    role,
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
        role: resolvedAdmin.role ?? 'admin',
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
    role: refreshedAdmin.role ?? 'admin',
    refreshedSession: {
      accessToken: refreshedSession.accessToken,
      refreshToken: refreshedSession.refreshToken,
      expiresAt: refreshedSession.expiresAt,
    },
  };
}
