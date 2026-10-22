import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireVerified } from '../../server/auth.mjs';
import { triggerRebuild } from '../../server/deploy.mjs';
import { InvalidJson, PayloadTooLarge, readJson, send } from '../../server/http.mjs';
import { deleteSubmission, getOwnSubmission, submissionInput, updateSubmission } from '../../server/submissions.mjs';
import { createStore } from '../../server/store.mjs';
import { serviceClient } from '../../server/supabase.mjs';

/* Thin wrapper. The rules live in server/submissions.mjs. This file is the only place that reads the environment. */

const MAX_BODY_BYTES = 16 * 1024;
const METHODS = ['GET', 'PATCH', 'DELETE'];

/** The [id] segment, from the route's query. A missing id is an empty string, which the logic answers with 404. */
function idFrom(req: IncomingMessage): string {
  const query = (req as IncomingMessage & { query?: Record<string, unknown> }).query;
  return typeof query?.id === 'string' ? query.id : '';
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
    const auth = await requireVerified(req, { url, anonKey });
    if (!('user' in auth)) return send(res, auth.status, { ok: false, error: auth.error });
    const store = createStore(serviceClient({ url, serviceKey }));
    const id = idFrom(req);
    // The hook URL is read here and never returned or logged. triggerRebuild's errors do not include it.
    const rebuild = () => triggerRebuild({ hookUrl: process.env.DEPLOY_HOOK_URL });

    if (method === 'GET') {
      const result = await getOwnSubmission({ store, ownerId: auth.user.id, id });
      if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
      return send(res, 200, { ok: true, submission: result.value });
    }

    if (method === 'DELETE') {
      const result = await deleteSubmission({ store, ownerId: auth.user.id, id, rebuild });
      if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
      return send(res, 200, { ok: true, wasApproved: result.value.wasApproved, rebuild: result.value.rebuild });
    }

    let body: unknown;
    try {
      body = await readJson(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof PayloadTooLarge) return send(res, 413, { ok: false, error: 'Too large' });
      if (err instanceof InvalidJson) return send(res, 400, { ok: false, error: 'Invalid JSON' });
      throw err;
    }
    const result = await updateSubmission({
      store,
      ownerId: auth.user.id,
      id,
      input: submissionInput(body),
      now: Date.now(),
      rebuild,
    });
    if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
    return send(res, 200, {
      ok: true,
      submission: result.value.submission,
      wasApproved: result.value.wasApproved,
      rebuild: result.value.rebuild,
    });
  } catch (err) {
    console.error('submissions: request failed', err);
    return send(res, 500, { ok: false, error: 'Something went wrong, try again' });
  }
}
