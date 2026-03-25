import 'server-only';

import { createClient } from '@supabase/supabase-js';

function getSupabaseAdminConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL for admin backfill.');
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for admin backfill.');
  }

  return {
    supabaseUrl,
    serviceRoleKey,
  };
}

export function createSupabaseAdminClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
