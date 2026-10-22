import type { IncomingMessage, ServerResponse } from 'node:http';
import { put } from '@vercel/blob';
import { requireVerified } from '../../server/auth.mjs';
import { PayloadTooLarge, readBody, send } from '../../server/http.mjs';
import { checkThumbnail, MAX_THUMBNAIL_BYTES } from '../../server/submissions.mjs';

/* Thin wrapper. The file checks live in server/submissions.mjs. This file is the only place that reads the environment. */

const METHODS = ['POST'];
const CONTENT_TYPES: Record<'png' | 'jpg' | 'webp', string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? '';
  if (!METHODS.includes(method)) return send(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: METHODS.join(', ') });
  if (process.env.SUBMISSIONS_ENABLED !== 'true') return send(res, 503, { ok: false, error: 'Submissions are not open yet' });

  const url = process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) return send(res, 500, { ok: false, error: 'Server is not set up' });

  try {
    const auth = await requireVerified(req, { url, anonKey });
    if (!('user' in auth)) return send(res, auth.status, { ok: false, error: auth.error });

    let bytes: Buffer;
    try {
      bytes = await readBody(req, MAX_THUMBNAIL_BYTES);
    } catch (err) {
      if (err instanceof PayloadTooLarge) return send(res, 413, { ok: false, error: 'Image must be 1 MB or less' });
      throw err;
    }

    const checked = checkThumbnail(bytes, req.headers['content-type'] ?? '');
    if (!checked.ok) return send(res, checked.status, { ok: false, error: checked.error });

    // The owner's id stays out of the public path. addRandomSuffix keeps each upload's address unique.
    const blob = await put(`thumbnails/thumbnail.${checked.value.extension}`, bytes, {
      access: 'public',
      addRandomSuffix: true,
      contentType: CONTENT_TYPES[checked.value.extension],
    });
    return send(res, 200, { ok: true, url: blob.url });
  } catch (err) {
    console.error('submissions: thumbnail upload failed', err);
    return send(res, 500, { ok: false, error: 'Something went wrong, try again' });
  }
}
