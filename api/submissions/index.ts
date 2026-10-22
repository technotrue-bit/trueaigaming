import type { IncomingMessage, ServerResponse } from 'node:http';
import { firstPartyIds } from '../_first-party.js';
import { requireVerified } from '../../server/auth.mjs';
import { InvalidJson, PayloadTooLarge, readJson, send } from '../../server/http.mjs';
import { createSubmission, listOwnSubmissions, submissionInput } from '../../server/submissions.mjs';
import { createStore } from '../../server/store.mjs';
import { serviceClient } from '../../server/supabase.mjs';

/* Thin wrapper. The rules live in server/submissions.mjs. This file is the only place that reads the environment. */

const MAX_BODY_BYTES = 16 * 1024;
const METHODS = ['GET', 'POST'];

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

    if (method === 'GET') {
      const submissions = await listOwnSubmissions({ store, ownerId: auth.user.id });
      return send(res, 200, { ok: true, submissions });
    }

    let body: unknown;
    try {
      body = await readJson(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof PayloadTooLarge) return send(res, 413, { ok: false, error: 'Too large' });
      if (err instanceof InvalidJson) return send(res, 400, { ok: false, error: 'Invalid JSON' });
      throw err;
    }
    const result = await createSubmission({
      store,
      ownerId: auth.user.id,
      input: submissionInput(body),
      now: Date.now(),
      // Both are read here, so the logic never touches the file system or the environment.
      firstPartyIds: firstPartyIds(),
      blobHost: process.env.BLOB_PUBLIC_HOST,
    });
    if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
    return send(res, 201, { ok: true, submission: result.value });
  } catch (err) {
    console.error('submissions: request failed', err);
    return send(res, 500, { ok: false, error: 'Something went wrong, try again' });
  }
}
