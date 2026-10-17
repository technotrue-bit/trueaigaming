import { inject } from '@vercel/analytics';

/**
 * Vercel Web Analytics (free on Hobby: pageviews, visitors, referrers,
 * countries, devices). Production builds load the same-origin
 * /_vercel/insights/script.js and post to /_vercel/insights/*, both covered
 * by the CSP's 'self'. Cookieless; no custom events (those need Pro).
 */
inject();
