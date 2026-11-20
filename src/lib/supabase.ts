import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

let rawUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || 
  'https://qoeapcxyupyugqrmjcnp.supabase.co'
).trim().replace(/^['"]+|['"]+$/g, '');

if (rawUrl.includes('.supabase.com')) {
  rawUrl = rawUrl.replace('.supabase.com', '.supabase.co');
}
if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
  rawUrl = 'https://' + rawUrl;
}

export const supabaseUrl = rawUrl;
export const supabaseAnonKey = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
  'sb_publishable_mLPEexIYJiYvLYUaBSf4Vw_eBJwya-d'
).trim().replace(/^['"]+|['"]+$/g, '');

export interface SupabaseQueryResult {
  data: any;
  error: any;
}

/**
 * Universal Supabase Client with SSR cookie integration on browser/client 
 * and universal JS fallback for Node/Electron environments.
 */
function initializeSupabaseClient(): any {
  if (typeof window !== 'undefined') {
    try {
      return createBrowserClient(supabaseUrl, supabaseAnonKey);
    } catch {
      return createClient(supabaseUrl, supabaseAnonKey);
    }
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase: any = initializeSupabaseClient();