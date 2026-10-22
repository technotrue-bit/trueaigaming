// @ts-check
// Rebuild trigger: POSTs the Vercel deploy hook so approved games reach the prerendered pages and sitemap.
// The hook URL is an argument, so this module never reads the environment. Its errors never include the
// URL, because the URL carries the hook's secret token.

const TIMEOUT_MS = 10_000;

/** @typedef {{ ok: true } | { ok: false, error: string }} RebuildResult */

/**
 * Asks the host to rebuild the site. Only a 2xx reply counts as ok.
 * @param {{ hookUrl?: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<RebuildResult>}
 */
export async function triggerRebuild({ hookUrl, fetchImpl = fetch }) {
  if (typeof hookUrl !== 'string' || hookUrl.trim() === '') {
    return { ok: false, error: 'DEPLOY_HOOK_URL is not set' };
  }
  try {
    const res = await fetchImpl(hookUrl, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: `Rebuild hook returned ${res.status}` };
  } catch (err) {
    const timedOut = /** @type {{ name?: unknown } | null | undefined} */ (err)?.name === 'TimeoutError';
    return { ok: false, error: timedOut ? 'Rebuild hook timed out' : 'Rebuild hook request failed' };
  }
}

/**
 * The rebuild a route passes to the logic. The route reads the hook URL from the environment and passes it here, so
 * no route calls triggerRebuild itself. The logic runs the result through rebuildForClient.
 * @param {string | undefined} hookUrl
 * @returns {() => Promise<RebuildResult>}
 */
export function hookRebuild(hookUrl) {
  return () => triggerRebuild({ hookUrl });
}

/** The only rebuild text a client sees. The reason goes to the log. */
const REBUILD_NOT_STARTED = 'Rebuild did not start';

/**
 * @param {string} message
 * @param {unknown} detail
 */
function defaultLog(message, detail) {
  console.error(`deploy: ${message}`, detail);
}

/**
 * Runs a rebuild for a client response. A thrown error, a missing result and a result that is not ok all give the
 * same fixed text, so no config name or hook detail reaches the client. The reason goes to `log` as (message, detail).
 * @param {{ trigger: () => Promise<RebuildResult>, log?: (message: string, detail: unknown) => void }} options
 * @returns {Promise<RebuildResult>}
 */
export async function rebuildForClient({ trigger, log = defaultLog }) {
  /** @type {unknown} */
  let result;
  try {
    result = await trigger();
  } catch (err) {
    log('rebuild threw', err);
    return { ok: false, error: REBUILD_NOT_STARTED };
  }
  if (typeof result !== 'object' || result === null) {
    log('rebuild returned no result', result);
    return { ok: false, error: REBUILD_NOT_STARTED };
  }
  const reply = /** @type {{ ok?: unknown, error?: unknown }} */ (result);
  if (reply.ok !== true) {
    log('rebuild did not start', reply.error);
    return { ok: false, error: REBUILD_NOT_STARTED };
  }
  return { ok: true };
}
