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
const FRAME_SRC = 'https://super-star-party.vercel.app https://*.vercel.app';
const EXPECTED_CSP = [
  "default-src 'self'",
  `connect-src 'self' ${SUPABASE_ORIGIN}`,
  `img-src 'self' data: ${BLOB_HOST}`,
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
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

test('CSP frame-src is unchanged (still no user origins)', () => {
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
