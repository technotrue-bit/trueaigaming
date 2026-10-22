// Shared submission rules: handles, display names, passwords, slugs, links, players and whole submissions. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_HANDLES,
  isBlobThumbnailUrl,
  slugFromName,
  validateDisplayName,
  validateHandle,
  validateHttpsUrl,
  validatePassword,
  validatePlayers,
  validateSlug,
  validateSubmission,
} from '../src/shared/submission-rules.mjs';

const submission = {
  name: 'Pie Flick',
  slug: 'pie-flick',
  description: 'Flick pies into the oven.',
  howItWasMade: 'Made with an AI assistant.',
  playUrl: 'https://play.example.com/pie',
  sourceUrl: 'https://github.com/example/pie',
  thumbnailUrl: 'https://abc.public.blob.vercel-storage.com/pie.png',
  minPlayers: 1,
  maxPlayers: 4,
};
const withFields = (/** @type {Record<string, unknown>} */ changes) => ({ ...submission, ...changes });

// ---------- Handles ----------

test('handle is trimmed and lowercased', () => assert.deepEqual(validateHandle(' Dev-1 '), { ok: true, value: 'dev-1' }));

test('handle accepts 3 and 24 characters', () => {
  assert.equal(validateHandle('abc').ok, true);
  assert.equal(validateHandle('a'.repeat(24)).ok, true);
});

test('handle rejects 2 and 25 characters', () => {
  assert.equal(validateHandle('ab').ok, false);
  assert.equal(validateHandle('a'.repeat(25)).ok, false);
});

test('handle rejects reserved names, after lowercasing', () => {
  for (const h of RESERVED_HANDLES) assert.equal(validateHandle(h).ok, false, h);
  assert.equal(validateHandle('ADMIN').ok, false);
});

test('handle rejects characters outside a-z, 0-9 and hyphen, and bad ends', () => {
  for (const h of ['dev_1', 'dév', 'dev.', '-dev', 'dev-', 'dev 1']) assert.equal(validateHandle(h).ok, false, h);
});

test('handle rejects non-text', () => {
  for (const h of [42, null, undefined, {}]) assert.equal(validateHandle(h).ok, false, String(h));
});

test('reserved list is exactly the brief list', () => {
  const expected = ['admin', 'api', 'u', 'submit', 'account', 'submissions', 'profile', 'privacy', 'games', 'play', 'support', 'help', 'login', 'signup', 'logout', 'null', 'undefined'];
  assert.deepEqual([...RESERVED_HANDLES].sort(), [...expected].sort());
});

// ---------- Display name and password ----------

test('display name is trimmed', () => assert.deepEqual(validateDisplayName('  Ada  '), { ok: true, value: 'Ada' }));

test('display name is optional', () => {
  assert.deepEqual(validateDisplayName(''), { ok: true, value: '' });
  assert.deepEqual(validateDisplayName(undefined), { ok: true, value: '' });
});

test('display name allows 40 characters and rejects 41', () => {
  assert.equal(validateDisplayName('a'.repeat(40)).ok, true);
  assert.equal(validateDisplayName('a'.repeat(41)).ok, false);
});

test('display name counts code points, not UTF-16 units', () => {
  assert.equal(validateDisplayName('😀'.repeat(40)).ok, true);
  assert.equal(validateDisplayName('😀'.repeat(41)).ok, false);
});

test('password allows 12 characters and rejects 11', () => {
  assert.equal(validatePassword('a'.repeat(12)).ok, true);
  assert.equal(validatePassword('a'.repeat(11)).ok, false);
});

test('password counts code points', () => {
  assert.equal(validatePassword('😀'.repeat(12)).ok, true);
  assert.equal(validatePassword('😀'.repeat(11)).ok, false);
});

test('password is returned exactly as entered', () => {
  const pw = '  correct horse  ';
  assert.deepEqual(validatePassword(pw), { ok: true, value: pw });
});

test('password rejects non-text', () => assert.equal(validatePassword(123456789012).ok, false));

// ---------- Slugs ----------

test('slug accepts 3 and 60 characters of a-z, 0-9, hyphen', () => {
  assert.equal(validateSlug('abc').ok, true);
  assert.equal(validateSlug('a'.repeat(60)).ok, true);
  assert.equal(validateSlug('pie-flick-2').ok, true);
});

test('slug rejects 2 and 61 characters', () => {
  assert.equal(validateSlug('ab').ok, false);
  assert.equal(validateSlug('a'.repeat(61)).ok, false);
});

test('slug rejects anything outside ^[a-z0-9-]+$', () => {
  for (const s of ['Pie', 'pie_flick', 'pie flick', 'pie.flick', 'pié', ' pie ']) assert.equal(validateSlug(s).ok, false, s);
});

test('slug rejects non-text', () => assert.equal(validateSlug(null).ok, false));

test('slugFromName lowercases, collapses separators and trims hyphens', () => {
  assert.equal(slugFromName('  Pie Flick!! 2  '), 'pie-flick-2');
  assert.equal(slugFromName('--Hello--'), 'hello');
});

test('slugFromName caps at 60 characters', () => assert.equal(slugFromName('a'.repeat(70)), 'a'.repeat(60)));

test('slugFromName leaves no trailing hyphen after truncation', () => assert.equal(slugFromName('a'.repeat(59) + ' b'), 'a'.repeat(59)));

test('slugFromName turns non-ASCII letters into hyphens', () => assert.equal(slugFromName('Café Night'), 'caf-night'));

test('slugFromName returns empty when nothing is left', () => assert.equal(slugFromName('!!!'), ''));

// ---------- HTTPS links ----------

test('https link is accepted and returned in canonical form', () => {
  assert.deepEqual(validateHttpsUrl('https://ok.example.com/play'), { ok: true, value: 'https://ok.example.com/play' });
  assert.deepEqual(validateHttpsUrl('https://EXAMPLE.com'), { ok: true, value: 'https://example.com/' });
});

test('link rejects http', () => assert.equal(validateHttpsUrl('http://x.com').ok, false));

test('link rejects javascript: and data: URLs', () => {
  assert.equal(validateHttpsUrl('javascript:alert(1)').ok, false);
  assert.equal(validateHttpsUrl('data:text/html,x').ok, false);
});

test('link rejects credentials', () => {
  assert.equal(validateHttpsUrl('https://user:pw@x.com/').ok, false);
  assert.equal(validateHttpsUrl('https://user@x.com/').ok, false);
});

test('link rejects localhost and its subdomains', () => {
  for (const u of ['https://localhost:3000', 'https://LOCALHOST/', 'https://app.localhost/', 'https://localhost./', 'https://localhost../']) {
    assert.equal(validateHttpsUrl(u).ok, false, u);
  }
});

test('link rejects IPv4 literals, including forms the URL parser normalises', () => {
  for (const u of ['https://127.0.0.1/', 'https://8.8.8.8/', 'https://2130706433/']) assert.equal(validateHttpsUrl(u).ok, false, u);
});

test('link rejects IPv6 literals', () => {
  for (const u of ['https://[::1]/', 'https://[2001:db8::1]/']) assert.equal(validateHttpsUrl(u).ok, false, u);
});

test('link allows exactly 2048 characters and rejects 2049', () => {
  const base = 'https://x.com/';
  assert.equal(validateHttpsUrl(base + 'a'.repeat(2048 - base.length)).ok, true);
  assert.equal(validateHttpsUrl(base + 'a'.repeat(2049 - base.length)).ok, false);
});

test('link rejects over 2048 characters', () => assert.equal(validateHttpsUrl('https://' + 'a'.repeat(2050)).ok, false));

test('link rejects empty and non-text', () => {
  assert.equal(validateHttpsUrl('').ok, false);
  assert.equal(validateHttpsUrl(5).ok, false);
});

// ---------- Players ----------

test('players accept 1 to 16 with min <= max', () => {
  assert.deepEqual(validatePlayers(1, 16), { ok: true, value: { minPlayers: 1, maxPlayers: 16 } });
  assert.equal(validatePlayers(4, 4).ok, true);
});

test('players reject 0, 17, min > max, fractions and strings', () => {
  assert.equal(validatePlayers(0, 4).ok, false);
  assert.equal(validatePlayers(1, 17).ok, false);
  assert.equal(validatePlayers(4, 2).ok, false);
  assert.equal(validatePlayers(1.5, 2).ok, false);
  assert.equal(validatePlayers('2', 4).ok, false);
});

// ---------- Blob thumbnails ----------

test('blob thumbnail: https on the Vercel Blob public host is accepted', () => {
  assert.equal(isBlobThumbnailUrl('https://abc.public.blob.vercel-storage.com/x.png'), true);
});

test('blob thumbnail: a host that only contains the suffix is refused', () => {
  assert.equal(isBlobThumbnailUrl('https://x.public.blob.vercel-storage.com.evil.com/x.png'), false);
  assert.equal(isBlobThumbnailUrl('https://public.blob.vercel-storage.com/x.png'), false);
});

test('blob thumbnail: with a store host set, only that exact host is accepted', () => {
  const host = 'abc123.public.blob.vercel-storage.com';
  assert.equal(isBlobThumbnailUrl('https://abc123.public.blob.vercel-storage.com/x.png', host), true);
  assert.equal(isBlobThumbnailUrl('https://abc123.public.blob.vercel-storage.com/x.png', 'ABC123.public.blob.vercel-storage.com'), true);
  assert.equal(isBlobThumbnailUrl('https://other.public.blob.vercel-storage.com/x.png', host), false);
  assert.equal(isBlobThumbnailUrl('https://evil.com/x.png', host), false);
  // An empty or missing host leaves the generic rule.
  assert.equal(isBlobThumbnailUrl('https://other.public.blob.vercel-storage.com/x.png', ''), true);
  assert.equal(isBlobThumbnailUrl('https://other.public.blob.vercel-storage.com/x.png', undefined), true);
});

test('blob thumbnail: http and other hosts are refused', () => {
  assert.equal(isBlobThumbnailUrl('http://abc.public.blob.vercel-storage.com/x.png'), false);
  assert.equal(isBlobThumbnailUrl('https://evil.com/x.png'), false);
  assert.equal(isBlobThumbnailUrl(null), false);
});

// ---------- Whole submission ----------

test('submission returns trimmed fields with null for blank optional links', () => {
  assert.deepEqual(validateSubmission(submission), { ok: true, value: submission });
  assert.deepEqual(validateSubmission(withFields({ name: '  Pie Flick  ' })).value?.name, 'Pie Flick');
  const r = validateSubmission(withFields({ sourceUrl: '', thumbnailUrl: '   ' }));
  assert.deepEqual(r, { ok: true, value: { ...submission, sourceUrl: null, thumbnailUrl: null } });
});

test('submission with no optional links gets null for both', () => {
  const { sourceUrl: _s, thumbnailUrl: _t, ...rest } = submission;
  assert.deepEqual(validateSubmission(rest), { ok: true, value: { ...submission, sourceUrl: null, thumbnailUrl: null } });
});

test('submission name allows 60 emoji and rejects 61', () => {
  assert.equal(validateSubmission(withFields({ name: '😀'.repeat(60) })).ok, true);
  assert.equal(validateSubmission(withFields({ name: '😀'.repeat(61) })).ok, false);
});

test('submission description allows 140 and rejects 141', () => {
  assert.equal(validateSubmission(withFields({ description: 'a'.repeat(140) })).ok, true);
  assert.equal(validateSubmission(withFields({ description: 'a'.repeat(141) })).ok, false);
});

test('submission how it was made allows 600 and rejects 601', () => {
  assert.equal(validateSubmission(withFields({ howItWasMade: 'a'.repeat(600) })).ok, true);
  assert.equal(validateSubmission(withFields({ howItWasMade: 'a'.repeat(601) })).ok, false);
});

test('submission requires name, description and how it was made', () => {
  assert.equal(validateSubmission(withFields({ name: '   ' })).ok, false);
  assert.equal(validateSubmission(withFields({ description: '' })).ok, false);
  assert.equal(validateSubmission(withFields({ howItWasMade: '' })).ok, false);
});

test('submission rejects a thumbnail from another host', () => {
  assert.equal(validateSubmission(withFields({ thumbnailUrl: 'https://evil.com/x.png' })).ok, false);
});

test('submission rejects an http thumbnail, even on the blob host', () => {
  assert.equal(validateSubmission(withFields({ thumbnailUrl: 'http://abc.public.blob.vercel-storage.com/x.png' })).ok, false);
});

test('submission rejects a non-https play link', () => {
  assert.equal(validateSubmission(withFields({ playUrl: 'http://x.com' })).ok, false);
});

test('submission rejects a localhost source link', () => {
  assert.equal(validateSubmission(withFields({ sourceUrl: 'https://localhost/' })).ok, false);
});

test('submission rejects a bad slug', () => {
  assert.equal(validateSubmission(withFields({ slug: 'Pie Flick' })).ok, false);
});

test('submission rejects min > max and out-of-range players', () => {
  assert.equal(validateSubmission(withFields({ minPlayers: 5, maxPlayers: 2 })).ok, false);
  assert.equal(validateSubmission(withFields({ maxPlayers: 17 })).ok, false);
});

test('submission rejects non-objects', () => {
  assert.equal(validateSubmission(null).ok, false);
  assert.equal(validateSubmission('pie').ok, false);
});

test('failed results have the { ok: false, error: string } shape', () => {
  const r = validateSubmission(withFields({ name: '' }));
  assert.deepEqual(Object.keys(r).sort(), ['error', 'ok']);
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});

// ---------- Blob thumbnails: the same rule as the database constraint ----------

test('blob thumbnail: hosts the database constraint rejects are refused', () => {
  assert.equal(isBlobThumbnailUrl('https://a.b.public.blob.vercel-storage.com/x.png'), false);
  assert.equal(isBlobThumbnailUrl('https://a_b.public.blob.vercel-storage.com/x.png'), false);
  assert.equal(isBlobThumbnailUrl('https://abc.public.blob.vercel-storage.com:8443/x.png'), false);
  assert.equal(isBlobThumbnailUrl('https://user:pw@abc.public.blob.vercel-storage.com/x.png'), false);
});

test('blob thumbnail: a single-label alphanumeric store id is accepted, and the length cap is 2048', () => {
  assert.equal(isBlobThumbnailUrl('https://abc123.public.blob.vercel-storage.com/x.png'), true);
  const prefix = 'https://abc.public.blob.vercel-storage.com/';
  assert.equal(isBlobThumbnailUrl(prefix + 'a'.repeat(2048 - prefix.length)), true);
  assert.equal(isBlobThumbnailUrl(prefix + 'a'.repeat(2049 - prefix.length)), false);
});

test('submission returns the canonical thumbnail href', () => {
  const r = validateSubmission(withFields({ thumbnailUrl: '  HTTPS://ABC.Public.Blob.Vercel-Storage.com/a b.png  ' }));
  assert.equal(r.ok, true);
  assert.equal(r.value.thumbnailUrl, 'https://abc.public.blob.vercel-storage.com/a%20b.png');
});

test('validateSubmission takes the store host and refuses a thumbnail from another Blob store', () => {
  const host = 'abc123.public.blob.vercel-storage.com';
  const mine = withFields({ thumbnailUrl: 'https://abc123.public.blob.vercel-storage.com/x.png' });
  const other = withFields({ thumbnailUrl: 'https://other.public.blob.vercel-storage.com/x.png' });
  assert.equal(validateSubmission(mine, { blobHost: host }).ok, true);
  assert.deepEqual(validateSubmission(other, { blobHost: host }), { ok: false, error: 'Thumbnail must be hosted on Vercel Blob' });
  assert.equal(validateSubmission(other).ok, true);
  assert.equal(validateSubmission(withFields({ thumbnailUrl: null }), { blobHost: host }).ok, true);
});
