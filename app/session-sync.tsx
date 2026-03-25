'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

async function syncSessionCookie(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
} | null) {
  if (!session?.access_token || !session.refresh_token) {
    await fetch('/api/auth/session', {
      method: 'DELETE',
    });
    return;
  }

  await fetch('/api/auth/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ?? null,
    }),
  });
}

export function SessionSync() {
  useEffect(() => {
    let cancelled = false;

    const syncCurrentSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!cancelled) {
        await syncSessionCookie(session);
      }
    };

    void syncCurrentSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSessionCookie(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
