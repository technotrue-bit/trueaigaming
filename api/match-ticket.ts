import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireUser } from '../server/auth.mjs';
import { send } from '../server/http.mjs';
import { makeTicket, ticketKey } from '../server/match-ticket.mjs';
import { ensureProfile } from '../server/profiles.mjs';
import { createStore } from '../server/store.mjs';
import { serviceClient } from '../server/supabase.mjs';

/* Thin wrapper. A signed-in player's match ticket for online games (server/match-ticket.mjs), with the key games check
   it with. This file is the only place that reads the environment. */

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET' });
  if (process.env.SUBMISSIONS_ENABLED !== 'true') return send(res, 503, { ok: false, error: 'Submissions are not open yet' });

  const url = process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !anonKey || !serviceKey) return send(res, 500, { ok: false, error: 'Server is not set up' });

  try {
    const auth = await requireUser(req, { url, anonKey });
    if (!('user' in auth)) return send(res, auth.status, { ok: false, error: auth.error });
    // The name on the ticket is the profile's username, which also carries the 13 and up check.
    const profile = await ensureProfile(createStore(serviceClient({ url, serviceKey })), auth.user);
    if (!profile.ok) return send(res, profile.status, { ok: false, error: profile.error });
    const key = ticketKey(serviceKey);
    const { ticket, exp } = makeTicket(key, { handle: profile.value.handle, userId: auth.user.id });
    return send(res, 200, { ok: true, ticket, exp, key: key.publicJwk });
  } catch (err) {
    console.error('match-ticket: request failed', err);
    return send(res, 500, { ok: false, error: 'Something went wrong, try again' });
  }
}
