import type { IncomingMessage, ServerResponse } from 'node:http';
import { reviewSubmission } from '../../../server/admin.mjs';
import { firstPartyIds } from '../../_first-party.js';
import { requireUser } from '../../../server/auth.mjs';
import { hookRebuild } from '../../../server/deploy.mjs';
import { InvalidJson, PayloadTooLarge, readJson, send } from '../../../server/http.mjs';
import { createStore } from '../../../server/store.mjs';
import { serviceClient } from '../../../server/supabase.mjs';

/* Thin wrapper. The rules live in server/admin.mjs. This file is the only place that reads the environment. */

const MAX_BODY_BYTES = 4 * 1024;
const METHODS = ['POST'];

/** The [id] segment, from the route's query. A missing id is an empty string, which the logic answers with 404. */
function idFrom(req: IncomingMessage): string {
  const query = (req as IncomingMessage & { query?: Record<string, unknown> }).query;
  return typeof query?.id === 'string' ? query.id : '';
}

/** The action, note and updated_at (the card's, as the admin loaded it) from the JSON body. Anything else is undefined, which the logic refuses. */
function fieldsFrom(body: unknown): { action: unknown; note: unknown; updatedAt: unknown } {
  const fields = typeof body === 'object' && body !== null ? (body as { action?: unknown; note?: unknown; updated_at?: unknown }) : {};
  return { action: fields.action, note: fields.note, updatedAt: fields.updated_at };
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

    let body: unknown;
    try {
      body = await readJson(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof PayloadTooLarge) return send(res, 413, { ok: false, error: 'Too large' });
      if (err instanceof InvalidJson) return send(res, 400, { ok: false, error: 'Invalid JSON' });
      throw err;
    }
    const { action, note, updatedAt } = fieldsFrom(body);

    // The hook URL is read here and never returned or logged. The logic runs every rebuild through rebuildForClient.
    const result = await reviewSubmission({
      store,
      adminId: auth.user.id,
      id: idFrom(req),
      updatedAt,
      action,
      note,
      rebuild: hookRebuild(process.env.DEPLOY_HOOK_URL),
      // Both are read here, so the logic never touches the file system or the environment.
      firstPartyIds: firstPartyIds(),
      blobHost: process.env.BLOB_PUBLIC_HOST,
    });
    if (!result.ok) return send(res, result.status, { ok: false, error: result.error });

    const { submission, rebuild } = result.value;
    // A reject has no rebuild, so its reply is { ok, submission } with no rebuild key.
    if (rebuild === null) return send(res, 200, { ok: true, submission });
    return send(res, 200, { ok: true, submission, rebuild });
  } catch (err) {
    console.error('admin: request failed', err);
    return send(res, 500, { ok: false, error: 'Something went wrong, try again' });
  }
}
