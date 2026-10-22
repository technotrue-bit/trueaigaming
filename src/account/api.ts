import { supabase } from './client';

/** A failed API call. `message` is safe to show people. `status` is the HTTP status, or 0 when no reply came back. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
  }
}

const GENERIC_ERROR = 'Something went wrong, try again';
const NETWORK_ERROR = 'Could not reach the server, check your connection and try again';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a reply body. A body that is not JSON, such as an HTML error page, gives null. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Calls an API route as the signed-in user. The bearer token comes from the current session, so it is sent only when a
 * session exists. Resolves with the parsed body when it has `ok: true`. Otherwise throws ApiError with the route's `error`
 * text, or a generic message when the reply has none. Raw reply bodies are never shown.
 * @param path Route path on this site, such as /api/profile.
 * @param init Passed to fetch. An Authorization header here is dropped, because the token always comes from the session.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Same-site paths only. "//host" and "/\host" are read as another origin, so the token would go there. Browsers also
  // drop tabs and line breaks from URLs, so those are refused too. This runs before any token is read.
  if (typeof path !== 'string' || path[0] !== '/' || path[1] === '/' || path[1] === '\\' || /[\t\n\r]/.test(path)) {
    throw new ApiError(0, 'Invalid request path');
  }

  const headers = new Headers(init.headers);
  headers.delete('Authorization');

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new ApiError(0, 'Could not check your sign-in, try again');
  const token = data.session?.access_token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let res: Response;
  let text: string;
  try {
    res = await fetch(path, { ...init, headers });
    text = await res.text();
  } catch (err) {
    // A caller's abort is not a network failure, so it reaches the caller unchanged.
    if (init.signal?.aborted) throw err;
    throw new ApiError(0, NETWORK_ERROR, { cause: err });
  }

  const body = parseJson(text);
  if (res.ok && isRecord(body) && body.ok === true) return body as T;

  const error = isRecord(body) && typeof body.error === 'string' && body.error.trim() !== '' ? body.error : GENERIC_ERROR;
  throw new ApiError(res.status, error);
}
