import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';

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
