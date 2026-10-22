import type { IncomingMessage, ServerResponse } from 'node:http';
import { republish } from '../../server/admin.mjs';
import { requireUser } from '../../server/auth.mjs';
import { triggerRebuild } from '../../server/deploy.mjs';
import { send } from '../../server/http.mjs';
import { createStore } from '../../server/store.mjs';
import { serviceClient } from '../../server/supabase.mjs';

/* Thin wrapper. The rules live in server/admin.mjs. This file is the only place that reads the environment. */

const METHODS = ['POST'];

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

    // The hook URL is read here and never returned or logged. The logic runs every rebuild through rebuildForClient.
    const result = await republish({
      store,
      adminId: auth.user.id,
      rebuild: () => triggerRebuild({ hookUrl: process.env.DEPLOY_HOOK_URL }),
    });
    if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
    return send(res, 200, { ok: true, rebuild: result.value.rebuild });
  } catch (err) {
    console.error('admin: request failed', err);
    return send(res, 500, { ok: false, error: 'Something went wrong, try again' });
  }
}
