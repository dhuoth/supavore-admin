'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type ProfileRole = 'user' | 'admin' | 'super_admin';

export function RoleSelect({
  userId,
  value,
}: {
  userId: string;
  value: ProfileRole;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleChange = async (nextRole: ProfileRole) => {
    setErrorMessage(null);

    const response = await fetch('/api/admin/users/role', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        role: nextRole,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setErrorMessage(payload?.error ?? 'Unable to update role.');
      router.refresh();
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="space-y-1">
      <select
        aria-label="User role"
        defaultValue={value}
        disabled={isPending}
        onChange={(event) => {
          void handleChange(event.target.value as ProfileRole);
        }}
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-500"
      >
        <option value="user">User</option>
        <option value="admin">Admin</option>
        <option value="super_admin">Super Admin</option>
      </select>
      {errorMessage ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
    </div>
  );
}
