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
