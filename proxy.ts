import { NextResponse, type NextRequest } from 'next/server';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';

function isProtectedPath(pathname: string) {
  return pathname === '/' || pathname.startsWith('/admin/');
}

function isProtectedApiPath(pathname: string) {
  return (
    pathname === '/api/geocode' ||
    pathname === '/api/restaurants/backfill-locations' ||
    pathname === '/api/restaurants/enrich-hours' ||
    pathname === '/api/restaurants/backfill-hours' ||
    pathname === '/api/restaurants/hours' ||
    pathname === '/api/admin/reviews' ||
    pathname.startsWith('/api/admin/reviews/')
  );
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.delete(SUPAVORE_ACCESS_TOKEN_COOKIE);
  response.cookies.delete(SUPAVORE_REFRESH_TOKEN_COOKIE);
}

function persistRefreshedSession(
  response: NextResponse,
  session: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number | null;
  } | null
) {
  if (!session) {
    return;
  }

  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: typeof session.expiresAt === 'number' ? new Date(session.expiresAt * 1000) : undefined,
  };

  response.cookies.set(SUPAVORE_ACCESS_TOKEN_COOKIE, session.accessToken, options);
  response.cookies.set(SUPAVORE_REFRESH_TOKEN_COOKIE, session.refreshToken, options);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname) && !isProtectedApiPath(pathname)) {
    return NextResponse.next();
  }

  const result = await authenticateAdminSession({
    accessToken: request.cookies.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: request.cookies.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!result.ok) {
    if (isProtectedApiPath(pathname)) {
      const response = NextResponse.json(
        {
          error: result.status === 403 ? 'Forbidden' : 'Unauthorized',
        },
        { status: result.status }
      );

      if (result.status === 401 || result.status === 403) {
        clearSessionCookies(response);
      }
      return response;
    }

    const redirectUrl = new URL(
      result.status === 403 ? '/login?error=access_denied' : '/login',
      request.url
    );
    const response = NextResponse.redirect(redirectUrl);

    if (result.status === 401 || result.status === 403) {
      clearSessionCookies(response);
    }

    return response;
  }

  const response = NextResponse.next();
  persistRefreshedSession(response, result.refreshedSession);
  return response;
}

export const config = {
  matcher: [
    '/',
    '/admin/:path*',
    '/api/geocode',
    '/api/restaurants/backfill-locations',
    '/api/restaurants/enrich-hours',
    '/api/restaurants/backfill-hours',
    '/api/restaurants/hours',
    '/api/admin/reviews',
    '/api/admin/reviews/:path*',
  ],
};
