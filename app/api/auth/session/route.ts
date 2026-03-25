import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
  getSupabaseUser,
  isAdminAllowlistedUser,
} from '@/lib/adminAuth';
import { syncAllowlistedAdminProfile } from '@/lib/adminProfileSync';

function buildCookieOptions(expiresAt?: number | null) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: typeof expiresAt === 'number' ? new Date(expiresAt * 1000) : undefined,
  };
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const body = (await request.json().catch(() => null)) as
    | {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number | null;
      }
    | null;

  const accessToken = body?.accessToken?.trim();
  const refreshToken = body?.refreshToken?.trim();

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'Missing session tokens.' }, { status: 400 });
  }

  const user = await getSupabaseUser(accessToken);

  if (!user?.id) {
    console.warn('[admin-session] invalid session tokens');
    return NextResponse.json({ error: 'Invalid session tokens.' }, { status: 401 });
  }

  const isAllowlisted = isAdminAllowlistedUser(user);
  console.info('[admin-session] resolved user', {
    userId: user.id,
    email: user.email ?? null,
    isAllowlisted,
  });

  if (!isAllowlisted) {
    console.warn('[admin-session] allowlist rejected user', {
      userId: user.id,
      email: user.email ?? null,
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    console.info('[admin-session] before syncAllowlistedAdminProfile', {
      userId: user.id,
      email: user.email ?? null,
    });
    await syncAllowlistedAdminProfile(user);
    console.info('[admin-session] after syncAllowlistedAdminProfile', {
      userId: user.id,
      email: user.email ?? null,
    });
  } catch {
    console.error('[admin-session] syncAllowlistedAdminProfile failed', {
      userId: user.id,
      email: user.email ?? null,
    });
    return NextResponse.json({ error: 'Unable to sync admin profile.' }, { status: 500 });
  }

  const options = buildCookieOptions(body?.expiresAt ?? null);

  cookieStore.set(SUPAVORE_ACCESS_TOKEN_COOKIE, accessToken, options);
  cookieStore.set(SUPAVORE_REFRESH_TOKEN_COOKIE, refreshToken, options);

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();

  cookieStore.delete(SUPAVORE_ACCESS_TOKEN_COOKIE);
  cookieStore.delete(SUPAVORE_REFRESH_TOKEN_COOKIE);

  return NextResponse.json({ ok: true });
}
