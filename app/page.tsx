import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
  authenticateAdminSession,
} from '@/lib/adminAuth';

export default async function Home() {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    redirect('/login');
  }

  const sections = [
    { label: 'Menu Database', href: '/admin/menu' },
    { label: 'CSV Upload', href: '/admin/csv' },
    { label: 'Dietary Signals', href: '/admin/dietary-signals' },
    { label: 'Map', href: '/admin/map' },
    { label: 'Users', href: '/admin/users' },
    { label: 'Coverage Requests', href: '/admin/coverage-requests' },
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
            Menu database, uploads, demand review, user access management, and coverage mapping.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => (
            <Link
              key={section.label}
              href={section.href}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-200"
            >
              <h2 className="text-base font-medium text-zinc-900">{section.label}</h2>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
