import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
  authenticateAdminSession,
  getAdminProfileByUserId,
  isManageableProfileRole,
} from '@/lib/adminAuth';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: authResult.status }
    );
  }

  if (authResult.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only super admins can update roles.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        userId?: string;
        role?: string;
      }
    | null;

  const userId = body?.userId?.trim();
  const role = body?.role?.trim();

  if (!userId || !role || !isManageableProfileRole(role)) {
    return NextResponse.json({ error: 'Invalid user or role.' }, { status: 400 });
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const targetProfile = await getAdminProfileByUserId(userId);

  if (!targetProfile) {
    return NextResponse.json(
      { error: 'User profile not found. Refresh the page and try again.' },
      { status: 404 }
    );
  }

  const targetCurrentRole = isManageableProfileRole(targetProfile?.role) ? targetProfile.role : 'user';

  if (targetCurrentRole === 'super_admin' && role !== 'super_admin') {
    const { count, error: superAdminCountError } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'super_admin');

    if (superAdminCountError) {
      return NextResponse.json({ error: superAdminCountError.message }, { status: 500 });
    }

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'At least one super admin must remain assigned.' },
        { status: 400 }
      );
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ role })
    .eq('id', userId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
