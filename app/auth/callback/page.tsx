'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const handleAuth = async () => {
      const code = new URL(window.location.href).searchParams.get('code');

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          router.push('/login');
          return;
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.email) {
        await supabase.auth.signOut();
        await fetch('/api/auth/session', {
          method: 'DELETE',
        });
        router.push('/login');
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token && session.refresh_token) {
        const response = await fetch('/api/auth/session', {
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

        if (!response.ok) {
          await supabase.auth.signOut();
          await fetch('/api/auth/session', {
            method: 'DELETE',
          });
          router.push(response.status === 403 ? '/login?error=access_denied' : '/login');
          return;
        }
      } else {
        await supabase.auth.signOut();
        await fetch('/api/auth/session', {
          method: 'DELETE',
        });
        router.push('/login');
        return;
      }

      router.push('/');
    };

    handleAuth();
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <p>Signing you in...</p>
    </div>
  );
}
