'use client';

import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="mb-3 inline-flex rounded-full border border-neutral-200 px-3 py-1 text-sm text-neutral-600">
            Web admin only
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-black">
            Supavore Admin
          </h1>
          <p className="mt-3 text-base text-neutral-600">
            Sign in to manage menu database, uploads, users, and map tools.
          </p>
        </div>

        {error === 'access_denied' ? (
          <p className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            You do not have access to this admin app.
          </p>
        ) : null}

        <button
          onClick={handleGoogleLogin}
          className="w-full rounded-2xl bg-black px-5 py-4 text-base font-medium text-white transition hover:bg-neutral-800"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}
