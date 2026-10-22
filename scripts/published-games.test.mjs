// Published games: approved submission rows become Game entries for the build. Nothing here makes a network call.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPublishedGames, submissionToGame } from './published-games.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/published-games.json', import.meta.url));
const PLACEHOLDER = '/thumbs/placeholder.png';
const PLACEHOLDER_FILE = fileURLToPath(new URL('../public/thumbs/placeholder.png', import.meta.url));

/** A row as Supabase returns it: snake_case columns plus the owner's profile. */
const row = {
  slug: 'pie-flick',
  name: 'Pie Flick',
  description: 'Flick pies into the oven.',
  how_it_was_made: 'Made with an AI assistant.',
  play_url: 'https://play.example.com/pie',
  source_url: 'https://github.com/example/pie',
  thumbnail_url: 'https://abc.public.blob.vercel-storage.com/pie.png',
  min_players: 1,
  max_players: 4,
  profiles: { handle: 'pie-dev', display_name: 'Pie Dev' },
};
const withFields = (/** @type {Record<string, unknown>} */ changes) => ({ ...row, ...changes });

const enabled = {
  SUBMISSIONS_ENABLED: 'true',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-test',
};

/** A fetchRows fake that returns the rows and records each call's config. */
function fakeFetch(/** @type {unknown[]} */ rows) {
  /** @type {unknown[]} */
  const calls = [];
  const fetchRows = async (/** @type {unknown} */ config) => {
    calls.push(config);
    return rows;
  };
  return { fetchRows, calls };
}

/** A fetchRows fake that fails the test if the loader calls it. */
const neverFetch = async () => {
  throw new Error('fetchRows must not run');
};

// ---------- Loader ----------

test('disabled flag returns no games and reads nothing', async () => {
  // The file path does not exist, so any read would throw.
  const env = { SUBMISSIONS_ENABLED: 'false', PUBLISHED_GAMES_JSON: '/no/such/published-games.json' };
  assert.deepEqual(await loadPublishedGames({ env, fetchRows: neverFetch, existingIds: [] }), []);
  assert.deepEqual(await loadPublishedGames({ env: {}, fetchRows: neverFetch, existingIds: [] }), []);
});

test('enabled: a valid row maps to a Game with external true', async () => {
  const { fetchRows } = fakeFetch([row]);
  const games = await loadPublishedGames({ env: enabled, fetchRows, existingIds: ['super-star-party'] });
  assert.deepEqual(games, [
    {
      id: 'pie-flick',
      name: 'Pie Flick',
      description: 'Flick pies into the oven.',
      playUrl: 'https://play.example.com/pie',
      thumbnail: 'https://abc.public.blob.vercel-storage.com/pie.png',
      thumbSize: { width: 1280, height: 720 },
      status: 'live',
      repo: 'https://github.com/example/pie',
      howItWasMade: 'Made with an AI assistant.',
      minPlayers: 1,
      maxPlayers: 4,
      author: 'Pie Dev',
      external: true,
    },
  ]);
});

test('a missing thumbnail uses the placeholder, and the placeholder is 1280x720', async () => {
  // PNG width and height are the big-endian 32-bit fields at bytes 16 to 23 of the IHDR chunk.
  const png = readFileSync(PLACEHOLDER_FILE);
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 720);
  for (const thumbnail_url of [null, undefined, '', '   ']) {
    const { fetchRows } = fakeFetch([withFields({ thumbnail_url })]);
    const [game] = await loadPublishedGames({ env: enabled, fetchRows, existingIds: [] });
    assert.equal(game.thumbnail, PLACEHOLDER, String(thumbnail_url));
  }
  assert.equal(existsSync(PLACEHOLDER_FILE), true);
});

test('a slug that matches a games.json id throws', async () => {
  const { fetchRows } = fakeFetch([withFields({ slug: 'super-star-party' })]);
  await assert.rejects(
    loadPublishedGames({ env: enabled, fetchRows, existingIds: ['super-star-party'] }),
    { message: 'Submission slug "super-star-party" collides with a games.json id' },
  );
});

test('a row failing validation throws instead of being dropped', async () => {
  const { fetchRows } = fakeFetch([row, withFields({ slug: 'bad-one', play_url: 'http://play.example.com/x' })]);
  await assert.rejects(
    loadPublishedGames({ env: enabled, fetchRows, existingIds: [] }),
    /Published submission "bad-one" is invalid: Play link must use https/,
  );
});

test('every invalid row shape throws from submissionToGame', () => {
  const invalid = [
    { name: '' },
    { slug: 'Bad Slug' },
    { description: 'x'.repeat(141) },
    { how_it_was_made: '' },
    { play_url: 'http://play.example.com/x' },
    { thumbnail_url: 'https://example.com/pie.png' },
    { min_players: 3, max_players: 2 },
    { min_players: '1', max_players: '4' },
  ];
  for (const changes of invalid) {
    assert.throws(() => submissionToGame(withFields(changes)), /is invalid: /, JSON.stringify(changes));
  }
  assert.throws(() => submissionToGame(null), /is invalid: /);
});

test('enabled without Supabase env throws the documented message', async () => {
  const message = 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when SUBMISSIONS_ENABLED=true';
  const missing = [
    { SUBMISSIONS_ENABLED: 'true' },
    { SUBMISSIONS_ENABLED: 'true', SUPABASE_URL: 'https://project.supabase.co' },
    { SUBMISSIONS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'service-key-test' },
  ];
  for (const env of missing) {
    await assert.rejects(loadPublishedGames({ env, fetchRows: neverFetch, existingIds: [] }), { message });
  }
});

test('PUBLISHED_GAMES_JSON reads the fixture rows instead of Supabase', async () => {
  const env = { SUBMISSIONS_ENABLED: 'true', PUBLISHED_GAMES_JSON: FIXTURE };
  const games = await loadPublishedGames({ env, fetchRows: neverFetch, existingIds: [] });
  assert.deepEqual(games.map((g) => g.id), ['fixture-game']);
  assert.equal(games[0].external, true);
  assert.equal(games[0].thumbnail, PLACEHOLDER);
});

test('Supabase URL and service key come from the env argument and go to fetchRows', async () => {
  const { fetchRows, calls } = fakeFetch([]);
  assert.deepEqual(await loadPublishedGames({ env: enabled, fetchRows, existingIds: [] }), []);
  assert.deepEqual(calls, [{ url: 'https://project.supabase.co', serviceKey: 'service-key-test' }]);
});

test('two rows with the same slug throw', async () => {
  const { fetchRows } = fakeFetch([row, withFields({ name: 'Pie Flick Two' })]);
  await assert.rejects(
    loadPublishedGames({ env: enabled, fetchRows, existingIds: [] }),
    { message: 'Submission slug "pie-flick" appears more than once' },
  );
});

test('rows that are not an array throw', async () => {
  await assert.rejects(
    loadPublishedGames({ env: enabled, fetchRows: async () => ({ rows: [] }), existingIds: [] }),
    { message: 'Published submissions must be an array of rows' },
  );
});

// ---------- Row mapping ----------

test('author is the display name, or the handle when the name is blank', () => {
  assert.equal(submissionToGame(row).author, 'Pie Dev');
  assert.equal(submissionToGame(withFields({ profiles: { handle: 'pie-dev', display_name: null } })).author, 'pie-dev');
  assert.equal(submissionToGame(withFields({ profiles: { handle: 'pie-dev', display_name: '   ' } })).author, 'pie-dev');
});

test('a row without a profile throws', () => {
  assert.throws(() => submissionToGame(withFields({ profiles: null })), /Published submission "pie-flick" has no author/);
});

test('a blank source link gives no repo', () => {
  assert.equal(submissionToGame(withFields({ source_url: null })).repo, undefined);
  assert.equal(submissionToGame(withFields({ source_url: '  ' })).repo, undefined);
});

test('the fixture row is valid and has slug fixture-game', () => {
  const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(rows.length, 1);
  assert.equal(submissionToGame(rows[0]).id, 'fixture-game');
});
