import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Submissions are on only when the build sets VITE_SUBMISSIONS_ENABLED to 'true'. Only VITE_* values reach the browser. */
export const SUBMISSIONS_ENABLED = import.meta.env.VITE_SUBMISSIONS_ENABLED === 'true';

let client: SupabaseClient | null = null;

/** Creates the client on first use. A missing setting throws here, so the static pages still render without it. */
function getClient(): SupabaseClient {
  if (client) return client;
  const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
  const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url) throw new Error('VITE_SUPABASE_URL is not set, so accounts cannot load. Set it at build time.');
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set, so accounts cannot load. Set it at build time.');
  client = createClient(url, anonKey);
  return client;
}

/**
 * The browser Supabase client, used like any SupabaseClient (`supabase.auth`, `supabase.from(...)`). The first property
 * access builds it, so a missing setting throws there and not when this module loads.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getClient();
    const value: unknown = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
