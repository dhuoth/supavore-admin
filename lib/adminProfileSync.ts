import 'server-only';

import {
  isAdminAllowlistedUser,
  isManageableProfileRole,
  type ProfileRole,
  type SupabaseUser,
} from '@/lib/adminAuth';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

type ExistingProfileRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  role: string | null;
  dietary_needs: string[] | null;
};

export async function syncAdminProfile(
  user: SupabaseUser,
  options?: {
    bootstrapRole?: ProfileRole | null;
  }
) {
  if (!user.email) {
    throw new Error('Cannot sync a profile without an email address.');
  }

  console.info('[admin-profile-sync] start', {
    userId: user.id,
    email: user.email,
  });

  const supabaseAdmin = createSupabaseAdminClient();
  const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, first_name, role, dietary_needs')
    .eq('id', user.id)
    .maybeSingle();

  if (existingProfileError) {
    throw existingProfileError;
  }

  const resolvedFirstName =
    existingProfile?.first_name && existingProfile.first_name.trim().length > 0
      ? existingProfile.first_name
      : user.user_metadata?.full_name?.trim() || '';

  const fallbackBootstrapRole =
    options?.bootstrapRole ??
    (isAdminAllowlistedUser(user) ? ('admin' as const) : null);
  const resolvedRole = isManageableProfileRole(existingProfile?.role)
    ? existingProfile.role
    : fallbackBootstrapRole;

  const profilePayload: {
    id: string;
    email: string;
    first_name: string;
    role?: ProfileRole;
    dietary_needs?: string[] | null;
  } = {
    id: user.id,
    email: user.email,
    first_name: resolvedFirstName,
  };

  if (resolvedRole) {
    profilePayload.role = resolvedRole;
  }

  if (existingProfile) {
    profilePayload.dietary_needs = existingProfile.dietary_needs;
  }

  const { error: upsertError } = await supabaseAdmin.from('profiles').upsert(profilePayload, {
    onConflict: 'id',
  });

  if (upsertError) {
    throw upsertError;
  }

  console.info('[admin-profile-sync] complete', {
    userId: user.id,
    email: user.email,
    hadExistingProfile: Boolean(existingProfile),
  });

  return existingProfile as ExistingProfileRow | null;
}
