import 'server-only';

import { isAdminAllowlistedUser, type SupabaseUser } from '@/lib/adminAuth';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

type ExistingProfileRow = {
  id: string;
  first_name: string | null;
  dietary_needs: string[] | null;
};

export async function syncAllowlistedAdminProfile(user: SupabaseUser) {
  if (!user.email || !isAdminAllowlistedUser(user)) {
    throw new Error('Cannot sync a profile for a non-allowlisted user.');
  }

  console.info('[admin-profile-sync] start', {
    userId: user.id,
    email: user.email,
  });

  const supabaseAdmin = createSupabaseAdminClient();
  const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, dietary_needs')
    .eq('id', user.id)
    .maybeSingle();

  if (existingProfileError) {
    throw existingProfileError;
  }

  const resolvedFirstName =
    existingProfile?.first_name && existingProfile.first_name.trim().length > 0
      ? existingProfile.first_name
      : user.user_metadata?.full_name?.trim() || '';

  const profilePayload: {
    id: string;
    email: string;
    role: 'admin';
    first_name: string;
    dietary_needs?: string[] | null;
  } = {
    id: user.id,
    email: user.email,
    role: 'admin',
    first_name: resolvedFirstName,
  };

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
