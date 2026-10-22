// @ts-check
// Request and response helpers for the API routes: JSON replies, size-limited body reads and JSON
// parsing. Replies use the same headers as api/feedback.ts. Plain Node, no dependencies.

/** Thrown when a request body is larger than the route allows. */
export class PayloadTooLarge extends Error {
  constructor() {
    super('Request body is too large');
    this.name = 'PayloadTooLarge';
  }
}

/** Thrown when a request body is not valid JSON, including an empty body. */
export class InvalidJson extends Error {
  constructor() {
    super('Request body is not valid JSON');
    this.name = 'InvalidJson';
  }
}

/**
 * Writes a JSON reply. `headers` is added to the defaults, for example `Retry-After`.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} body
 * @param {Record<string, string>} [headers]
 * @returns {void}
 */
export function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Reads the whole request body. Fails as soon as the body passes maxBytes. A declared Content-Length
 * over maxBytes fails before any of the body is read.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export async function readBody(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLarge();

  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > maxBytes) throw new PayloadTooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Reads and parses a JSON request body. Throws PayloadTooLarge or InvalidJson.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
export async function readJson(req, maxBytes) {
  const raw = await readBody(req, maxBytes);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new InvalidJson();
  }
}
