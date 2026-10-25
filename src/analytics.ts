import { inject, track } from '@vercel/analytics';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Vercel Web Analytics (free on Hobby: pageviews, visitors, referrers,
 * countries, devices). Production builds load the same-origin
 * /_vercel/insights/script.js and post to /_vercel/insights/*, both covered
 * by the CSP's 'self'. Cookieless. Custom events are only recorded on Pro.
 */
inject();

/**
 * Sends a custom event to Vercel Web Analytics and to Google Analytics 4 (the gtag.js snippet in the page <head>).
 * Properties must be flat and never personal: no emails, contact details or free text.
 */
export function trackEvent(name: string, params?: Record<string, string | number | boolean>): void {
  track(name, params);
  if (typeof window.gtag === 'function') window.gtag('event', name, params ?? {});
}

/**
 * share_clicked for the current game: a copy outside the form fields (channel "copy"), or a click on any
 * [data-share-game] element (channel from its data-share-channel, default "link").
 */
export function trackShares(gameId: () => string | undefined): void {
  document.addEventListener('copy', (event) => {
    const target = event.target as Element | null;
    const game_id = gameId();
    if (!game_id || target?.closest?.('input, textarea')) return;
    trackEvent('share_clicked', { game_id, channel: 'copy' });
  });
  document.addEventListener('click', (event) => {
    const share = (event.target as Element).closest?.<HTMLElement>('[data-share-game]');
    const game_id = share?.dataset.shareGame || gameId();
    if (!share || !game_id) return;
    trackEvent('share_clicked', { game_id, channel: share.dataset.shareChannel || 'link' });
  });
}
