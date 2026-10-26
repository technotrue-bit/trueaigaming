// Site copy, CSP and privacy page for accounts. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gamePageHtml, loadGames } from './seo.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), 'utf8');
const footer = (/** @type {string} */ html) => html.match(/<footer class="footer wrap">[\s\S]*?<\/footer>/)?.[0] ?? '';

const SUPABASE_ORIGIN = 'https://ycajnupfbiushygycclf.supabase.co';
const BLOB_HOST = 'https://*.public.blob.vercel-storage.com';
const TURNSTILE = 'https://challenges.cloudflare.com';
const FRAME_SRC = `https://super-star-party.vercel.app https://*.vercel.app ${TURNSTILE}`;
// Google Analytics 4 (gtag.js): the loader, its inline config snippet, and where it sends hits.
const GTM = 'https://www.googletagmanager.com';
const GA_CONNECT = `https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com ${GTM}`;
const GA_IMG = `https://www.google-analytics.com ${GTM}`;
const EXPECTED_CSP = [
  "default-src 'self'",
  `connect-src 'self' ${SUPABASE_ORIGIN} ${GA_CONNECT}`,
  `img-src 'self' data: ${BLOB_HOST} ${GA_IMG}`,
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline' ${GTM} ${TURNSTILE}`,
  `frame-src ${FRAME_SRC}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

/** The CSP header value. */
function csp() {
  const config = JSON.parse(read('vercel.json'));
  const all = config.headers.flatMap((/** @type {{ headers: { key: string, value: string }[] }} */ h) => h.headers);
  const found = all.filter((h) => h.key === 'Content-Security-Policy');
  assert.equal(found.length, 1);
  return found[0].value;
}
const directive = (/** @type {string} */ name) => csp().split('; ').find((d) => d.startsWith(`${name} `))?.slice(name.length + 1);

const COPY = 'Free to play. No account needed.';

test('home footer no longer says "No accounts"', () => {
  assert.ok(!read('index.html').includes('No accounts. Just games.'));
});

test('no footer promises a sign-up that may be switched off', () => {
  for (const f of ['index.html', 'privacy.html', 'public/404.html']) {
    assert.ok(!read(f).includes('Sign up to share'), f);
    assert.ok(!read(f).includes('No accounts. Just games.'), f);
  }
});

test('closed account pages keep their way back', () => {
  for (const f of ['src/account/account.ts', 'src/account/submit.ts', 'src/account/submissions.ts']) {
    assert.match(read(f), /if \(!SUBMISSIONS_ENABLED\) \{\n  pageHead\.hidden = false;/, f);
  }
});

test('home footer has the new copy and the account and privacy links', () => {
  const f = footer(read('index.html'));
  assert.ok(f.includes(COPY));
  assert.match(f, /<a [^>]*href="\/account"[^>]*>Sign in or share your game<\/a>/);
  assert.match(f, /<a [^>]*href="\/privacy\.html"[^>]*>Privacy<\/a>/);
});

test('every game page footer has the new copy and the account and privacy links', () => {
  const games = loadGames();
  assert.ok(games.length > 0);
  for (const g of games) {
    const f = footer(gamePageHtml(g));
    assert.ok(!f.includes('No accounts'), g.id);
    assert.ok(f.includes(COPY), g.id);
    assert.match(f, /<a [^>]*href="\/account"[^>]*>Sign in or share your game<\/a>/, g.id);
    assert.match(f, /<a [^>]*href="\/privacy\.html"[^>]*>Privacy<\/a>/, g.id);
  }
});

test('CSP connect-src includes the Supabase project origin', () => {
  assert.ok(directive('connect-src')?.split(' ').includes(SUPABASE_ORIGIN));
});

test('CSP img-src includes the Vercel Blob host', () => {
  assert.ok(directive('img-src')?.split(' ').includes(BLOB_HOST));
});

test('CSP frame-src adds only the bot check (still no user origins)', () => {
  assert.equal(directive('frame-src'), FRAME_SRC);
});

test('the whole CSP is exactly the expected string', () => {
  assert.equal(csp(), EXPECTED_CSP);
});

test('privacy.html exists and mentions "Delete account"', () => {
  assert.ok(existsSync(join(ROOT, 'privacy.html')));
  assert.ok(read('privacy.html').includes('Delete account'));
});

test('privacy.html names the owner contact and has no script of its own', () => {
  const html = read('privacy.html');
  assert.ok(html.includes('https://x.com/itsmetrueg'));
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'no inline script');
});

test('privacy.html is a build input', () => {
  assert.match(read('vite.config.ts'), /privacy: resolve\(import\.meta\.dirname, 'privacy\.html'\)/);
});

const RIGHTS = '&copy; 2026 TrueAIGaming. All rights reserved.';

test('every footer carries the copyright line and a Terms link', () => {
  const pages = [
    ['index.html', footer(read('index.html'))],
    ['privacy.html', footer(read('privacy.html'))],
    ['terms.html', footer(read('terms.html'))],
    ...loadGames().map((g) => [g.id, footer(gamePageHtml(g))]),
  ];
  for (const [name, f] of pages) {
    assert.ok(f.includes(RIGHTS), name);
    assert.match(f, /<a [^>]*href="\/terms\.html"[^>]*>Terms<\/a>/, name);
  }
  assert.ok(read('public/404.html').includes(RIGHTS));
});

test('terms.html is a build input, names the owner and has no script of its own', () => {
  const html = read('terms.html');
  assert.match(read('vite.config.ts'), /terms: resolve\(import\.meta\.dirname, 'terms\.html'\)/);
  assert.ok(html.includes('owned by TrueAIGaming. All rights reserved.'));
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'no inline script');
});

test('the repo has an all-rights-reserved LICENSE', () => {
  assert.match(read('LICENSE'), /^Copyright \(c\) 2026 TrueAIGaming\. All rights reserved\./);
});

test('sign-up asks for a birth month and year before anything else, and says the date is not kept', () => {
  const html = read('account.html');
  const form = html.match(/<form id="signup-form"[\s\S]*?<\/form>/)?.[0] ?? '';
  assert.ok(form.indexOf('name="birth_month"') > -1 && form.indexOf('name="birth_month"') < form.indexOf('name="email"'));
  assert.ok(form.includes('name="birth_year"'));
  assert.ok(form.includes("We don't keep your date of birth."));
  // A neutral question: the form must not hint at the age that passes.
  assert.ok(!form.includes('13'));
  assert.match(html, /<p id="signup-closed" hidden>/);
});

test('privacy and terms say accounts are for 13 and up', () => {
  assert.ok(read('privacy.html').includes('Accounts are for people 13 and up.'));
  assert.ok(read('terms.html').includes('accounts are for people 13 and up'));
  assert.match(read('terms.html'), /<h2>Games you share<\/h2>/);
});

test('the home page has a hidden Sign in pill that links to the account page', () => {
  const html = read('index.html');
  assert.match(html, /<a id="account-pill" class="account-pill" href="\/account" hidden>/);
  assert.match(html, /<span id="account-pill-label">Sign in<\/span>/);
  assert.ok(read('src/home.ts').includes("import './account-pill';"));
});

test('sign in and create account share one card with two tabs', () => {
  const html = read('account.html');
  const card = html.match(/<section id="signed-out"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(card, /role="tablist"/);
  assert.match(card, /id="tab-signin"[^>]*aria-selected="true"/);
  assert.match(card, /id="tab-signup"[^>]*aria-selected="false"/);
  assert.match(card, /<div id="signin-pane"[^>]*role="tabpanel"/);
  assert.match(card, /<div id="signup-pane"[^>]*role="tabpanel"[^>]*hidden>/);
  assert.ok(card.includes('id="signin-form"') && card.includes('id="signup-form"') && card.includes('id="forgot"'));
});
