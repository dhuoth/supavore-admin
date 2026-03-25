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

      if (!user) {
        router.push('/login');
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token && session.refresh_token) {
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

      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (!existingProfile) {
        // Create profile automatically
        await supabase.from('profiles').insert({
          id: user.id,
          email: user.email,
          first_name: user.user_metadata?.full_name || '',
          role: 'user',
        });
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
