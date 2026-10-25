/**
 * Cloudflare Turnstile bot check for the sign-up, sign-in, reset and resend actions. Supabase checks the token
 * when its CAPTCHA protection is on. The check is on only when the build sets VITE_TURNSTILE_SITE_KEY (a public key).
 * Without it, every slot gives no token and the forms work as before, which is how local builds and tests run.
 */
const SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const CAPTCHA_ENABLED = typeof SITE_KEY === 'string' && SITE_KEY !== '';

/** The part of the Turnstile browser API this page uses. */
interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  getResponse(widgetId: string): string | undefined;
  reset(widgetId: string): void;
}

/** A failure written for people to read, so the account page shows it as it is. */
export class CaptchaError extends Error {}

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', () => {
      const api = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (api) resolve(api);
      else reject(new CaptchaError('The bot check did not load. Reload the page and try again.'));
    });
    script.addEventListener('error', () => {
      loading = null;
      reject(new CaptchaError('The bot check did not load. Check your connection and try again.'));
    });
    document.head.append(script);
  });
  return loading;
}

/** One Turnstile widget in one container. A token works once, so each use resets the widget. */
export class CaptchaSlot {
  private widget: Promise<{ api: Turnstile; id: string }> | null = null;

  constructor(private readonly el: HTMLElement) {}

  /** Renders the widget. Safe to call more than once. A load failure is kept for token() to report. */
  start(): void {
    if (!CAPTCHA_ENABLED || this.widget) return;
    this.widget = loadTurnstile().then((api) => ({
      api,
      // Interaction-only keeps it invisible unless Cloudflare needs the person to tick a box.
      id: api.render(this.el, { sitekey: SITE_KEY, appearance: 'interaction-only', theme: 'dark' }),
    }));
    this.widget.catch(() => {
      this.widget = null;
    });
  }

  /** The token to send with one Supabase call, or undefined when the check is off. */
  async token(): Promise<string | undefined> {
    if (!CAPTCHA_ENABLED) return undefined;
    this.start();
    const widget = this.widget;
    if (!widget) throw new CaptchaError('The bot check did not load. Reload the page and try again.');
    const { api, id } = await widget;
    const value = api.getResponse(id);
    if (!value) throw new CaptchaError('Finish the bot check above, then try again.');
    return value;
  }

  /** Gets a fresh token ready for the next try. */
  reset(): void {
    void this.widget?.then(({ api, id }) => api.reset(id)).catch(() => undefined);
  }
}
