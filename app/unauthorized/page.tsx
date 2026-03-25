import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="mb-3 inline-flex rounded-full border border-neutral-200 px-3 py-1 text-sm text-neutral-600">
            Access denied
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-black">
            You do not have admin access
          </h1>
          <p className="mt-3 text-base text-neutral-600">
            Your account is signed in, but it is not authorized to use this admin app.
          </p>
        </div>

        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-2xl bg-black px-5 py-4 text-base font-medium text-white transition hover:bg-neutral-800"
        >
          Back to login
        </Link>
      </div>
    </main>
  );
}
