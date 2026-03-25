'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAccess = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (error || !profile || !['admin', 'super_admin'].includes(profile.role)) {
        router.push('/login');
        return;
      }

      setLoading(false);
    };

    checkAccess();
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

 const sections = [
  { label: 'Menu Database', href: '/admin/menu' },
  { label: 'CSV Uploads', href: '/admin/csv' },
  { label: 'Dietary Signals', href: '/admin/dietary-signals' },
  { label: 'Users' },
  { label: 'Map View' },
];

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <span className="w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium tracking-wide text-zinc-600">
          Web admin only
        </span>

        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
            Supavore Admin
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600 sm:text-base">
            Menu database, uploads, users, and map tools
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => (
            section.href ? (
              <Link
                key={section.label}
                href={section.href}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-200"
              >
                <h2 className="text-base font-medium text-zinc-900">{section.label}</h2>
              </Link>
            ) : (
              <div
                key={section.label}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <h2 className="text-base font-medium text-zinc-900">{section.label}</h2>
              </div>
            )
          ))}
        </section>
      </div>
    </main>
  );
}
