// @ts-check
// The only server module that imports @supabase/supabase-js. The URL and key are passed in, so this
// module never reads the environment. Nothing here reaches the browser bundle.
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client for server routes. Sessions are not persisted, because the server holds no user's session.
 * @param {{ url: string, serviceKey: string }} config
 */
export function serviceClient({ url, serviceKey }) {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
