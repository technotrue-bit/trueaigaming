import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireUser } from '../server/auth.mjs';
import { rebuildForClient, triggerRebuild } from '../server/deploy.mjs';
import { InvalidJson, PayloadTooLarge, readJson, send } from '../server/http.mjs';
import { deleteAccount, ensureProfile, setHandle } from '../server/profiles.mjs';
import { createStore } from '../server/store.mjs';
import { serviceClient } from '../server/supabase.mjs';

/* Thin wrapper. The rules live in server/profiles.mjs. This file is the only place that reads the environment. */

const MAX_BODY_BYTES = 1024;
const METHODS = ['GET', 'POST', 'DELETE'];

function handleFrom(body: unknown): unknown {
  return typeof body === 'object' && body !== null ? (body as { handle?: unknown }).handle : undefined;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? '';
  if (!METHODS.includes(method)) return send(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: METHODS.join(', ') });
  if (process.env.SUBMISSIONS_ENABLED !== 'true') return send(res, 503, { ok: false, error: 'Submissions are not open yet' });

  const url = process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !anonKey || !serviceKey) return send(res, 500, { ok: false, error: 'Server is not set up' });

  try {
    const auth = await requireUser(req, { url, anonKey });
    if (!('user' in auth)) return send(res, auth.status, { ok: false, error: auth.error });
    const store = createStore(serviceClient({ url, serviceKey }));

    if (method === 'GET') {
      const result = await ensureProfile(store, auth.user);
      if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
      return send(res, 200, { ok: true, profile: result.value });
    }

    if (method === 'POST') {
      let body: unknown;
      try {
        body = await readJson(req, MAX_BODY_BYTES);
      } catch (err) {
        if (err instanceof PayloadTooLarge) return send(res, 413, { ok: false, error: 'Too large' });
        if (err instanceof InvalidJson) return send(res, 400, { ok: false, error: 'Invalid JSON' });
        throw err;
      }
      const result = await setHandle(store, auth.user, handleFrom(body));
      if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
      return send(res, 200, { ok: true, profile: result.value });
    }

    const result = await deleteAccount({
      store,
      user: auth.user,
      // The hook URL is read here only. rebuildForClient keeps the config name and hook details out of the reply.
      rebuild: () => rebuildForClient({ trigger: () => triggerRebuild({ hookUrl: process.env.DEPLOY_HOOK_URL }) }),
    });
    return send(res, 200, { ok: true, rebuild: result.rebuild });
  } catch (err) {
    console.error('profile: request failed', err);
    return send(res, 500, { ok: false, error: 'Something went wrong, try again' });
  }
}
