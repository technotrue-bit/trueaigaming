import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';

const MAX_BODY_BYTES = 8 * 1024;
const MAX_MESSAGE = 2000;
const MAX_CONTACT = 200;
const MAX_GAME = 80;
const MAX_UA = 300;
const GAME_ID = /^[a-z0-9-]*$/;
const TYPES = new Set(['bug', 'suggestion']);

/* Best-effort per-instance limit: serverless instances don't share memory, so this only blunts bursts. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

function rateLimited(key: string, now: number): boolean {
  if (hits.size > 5000) {
    for (const [k, times] of hits) if (times[times.length - 1] <= now - RATE_WINDOW_MS) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => t > now - RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

class TooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'POST' });

  const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return send(res, 415, { ok: false, error: 'Expected application/json' });
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return send(res, 413, { ok: false, error: 'Too large' });

  let data: unknown;
  try {
    data = JSON.parse(await readBody(req));
  } catch (err) {
    if (err instanceof TooLarge) return send(res, 413, { ok: false, error: 'Too large' });
    return send(res, 400, { ok: false, error: 'Invalid JSON' });
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return send(res, 400, { ok: false, error: 'Invalid body' });
  const body = data as Record<string, unknown>;

  // Honeypot: bots fill every field. Pretend success, store nothing.
  if (body.website !== undefined && body.website !== '') return send(res, 200, { ok: true });

  const type = body.type;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const contact = optionalString(body.contact);
  const game = optionalString(body.game);
  if (typeof type !== 'string' || !TYPES.has(type)) return send(res, 400, { ok: false, error: 'Invalid type' });
  if (message.length < 1 || message.length > MAX_MESSAGE) return send(res, 400, { ok: false, error: 'Message must be 1-2000 characters' });
  if (contact === null || contact.length > MAX_CONTACT) return send(res, 400, { ok: false, error: 'Invalid contact' });
  if (game === null || game.length > MAX_GAME || !GAME_ID.test(game)) return send(res, 400, { ok: false, error: 'Invalid game' });

  const ipHash = createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
  const now = Date.now();
  if (rateLimited(ipHash, now)) return send(res, 429, { ok: false, error: 'Too many submissions, try again later' }, { 'Retry-After': '600' });

  const receivedAt = new Date(now).toISOString();
  const ua = String(req.headers['user-agent'] ?? '').slice(0, MAX_UA);
  const record = { type, game, message, contact, ua, ipHash, receivedAt };

  const pathname = `feedback/${receivedAt.slice(0, 10)}/${now}-${randomBytes(6).toString('hex')}.json`;
  try {
    const blob = await put(pathname, JSON.stringify(record, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    console.log('feedback: saved', blob.pathname || pathname);
  } catch (err) {
    console.error('feedback: blob put failed', err);
    return send(res, 500, { ok: false, error: 'Could not save feedback' });
  }

  send(res, 200, { ok: true });
}
