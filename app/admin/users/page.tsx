import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticateAdminSession,
  isManageableProfileRole,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
  type ProfileRole,
} from '@/lib/adminAuth';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { formatAdminTimestamp as formatTimestamp } from '@/lib/adminTimestamp';
import { RoleSelect } from './role-select';

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

type AuthAdminUser = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  user_metadata?: {
    full_name?: string | null;
  } | null;
};

type UserRow = {
  id: string;
  displayName: string;
  email: string;
  role: ProfileRole;
  createdAt: string | null;
};

function getSearchParamValue(searchParams: SearchParams, key: string) {
  const value = searchParams[key];

  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

function formatCellValue(value: string | null | undefined) {
  if (!value || value.trim().length === 0) {
    return '—';
  }

  return value;
}

async function listAllAuthUsers() {
  const supabaseAdmin = createSupabaseAdminClient();
  const users: AuthAdminUser[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    const nextUsers = (data?.users ?? []) as AuthAdminUser[];
    users.push(...nextUsers);

    if (!data?.nextPage || nextUsers.length === 0) {
      break;
    }

    page = data.nextPage;
  }

  return users;
}

export default async function UsersAdminPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    redirect('/login');
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedRoleFilter = getSearchParamValue(resolvedSearchParams, 'role');
  const roleFilter =
    requestedRoleFilter === 'admin' || requestedRoleFilter === 'super_admin'
      ? requestedRoleFilter
      : 'all';

  let rows: UserRow[] = [];
  let loadError: string | null = null;

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const authUsers = await listAllAuthUsers();
    const userIds = authUsers.map((user) => user.id);
    let profiles:
      | Array<{
          id: string;
          email: string | null;
          first_name: string | null;
          role: string | null;
        }>
      | null = [];

    if (userIds.length > 0) {
      const { data: profileRows, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('id, email, first_name, role')
        .in('id', userIds);

      if (profilesError) {
        throw profilesError;
      }

      profiles = profileRows;
    }

    const profilesById = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        {
          email: profile.email,
          first_name: profile.first_name,
          role: profile.role,
        },
      ])
    );

    rows = authUsers
      .map((user) => {
        const profile = profilesById.get(user.id);
        const displayName =
          formatCellValue(profile?.first_name) !== '—'
            ? formatCellValue(profile?.first_name)
            : formatCellValue(user.user_metadata?.full_name);
        const role = isManageableProfileRole(profile?.role) ? profile.role : 'user';

        return {
          id: user.id,
          displayName,
          email: user.email?.trim() || profile?.email?.trim() || '—',
          role,
          createdAt: user.created_at ?? null,
        };
      })
      .filter((row) => {
        if (roleFilter === 'admin' || roleFilter === 'super_admin') {
          return row.role === roleFilter;
        }

        return true;
      })
      .sort((left, right) => {
        const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0;
        const rightCreatedAt = right.createdAt ? new Date(right.createdAt).getTime() : 0;

        return rightCreatedAt - leftCreatedAt || left.email.localeCompare(right.email);
      });
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unable to load users right now.';
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="space-y-3">
          <span className="w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium tracking-wide text-zinc-600">
            Access management
          </span>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Users</h1>
            <p className="max-w-2xl text-sm text-zinc-600 sm:text-base">
              View Supavore users and manage admin roles.
            </p>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Visible users</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">{rows.length}</p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Your access</p>
            <p className="mt-2 text-3xl font-semibold capitalize text-zinc-950">
              {authResult.role.replace('_', ' ')}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Role editing</p>
            <p className="mt-2 text-sm text-zinc-700">
              {authResult.role === 'super_admin'
                ? 'You can update roles from this page.'
                : 'Super admins can update roles. You have view-only access.'}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <form className="grid gap-4 md:grid-cols-[240px_auto]">
            <div className="space-y-2">
              <label htmlFor="role-filter" className="text-sm font-medium text-zinc-700">
                Role filter
              </label>
              <select
                id="role-filter"
                name="role"
                defaultValue={roleFilter}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="all">All users</option>
                <option value="admin">Admins</option>
                <option value="super_admin">Super admins</option>
              </select>
            </div>

            <div className="flex items-end gap-3">
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
              >
                Apply filter
              </button>
              <a
                href="/admin/users"
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Reset
              </a>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {loadError ? (
            <div className="px-6 py-10 text-sm text-red-600">{loadError}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">
                      Created At
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">User ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.length > 0 ? (
                    rows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-3 text-zinc-700">{row.displayName}</td>
                        <td className="px-4 py-3 text-zinc-700">{row.email}</td>
                        <td className="px-4 py-3 text-zinc-700">
                          {authResult.role === 'super_admin' ? (
                            <RoleSelect userId={row.id} value={row.role} />
                          ) : (
                            <span className="capitalize">{row.role.replace('_', ' ')}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                          {row.createdAt ? formatTimestamp(row.createdAt) : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-600">{row.id}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-500">
                        No users match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
