// Match tickets: the key comes from the server secret, and tickets check out with WebCrypto the way the game checks
// them (ECDSA P-256, SHA-256, over the ticket's body text). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TICKET_MS, makeTicket, ticketKey } from './match-ticket.mjs';

const SECRET = 'service-role-key-for-tests-0123456789';

/** The game's check (Flag Catch src/net/ticket.ts), in short. */
async function check(ticket, jwk, now = Date.now()) {
  const [body, sig] = ticket.split('.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(body));
  if (!ok) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  return data.e > now ? data : null;
}

test('the ticket key is the same for the same secret, and another for another', () => {
  const a = ticketKey(SECRET);
  const b = ticketKey(SECRET);
  const c = ticketKey(`${SECRET}-other`);
  assert.deepEqual(a.publicJwk, b.publicJwk);
  assert.notDeepEqual(a.publicJwk, c.publicJwk);
  assert.equal(a.publicJwk.kty, 'EC');
  assert.equal(a.publicJwk.crv, 'P-256');
  assert.equal('d' in a.publicJwk, false);
  assert.throws(() => ticketKey(''), /secret/);
});

test('a ticket names the player, checks out with the site key and runs out', async () => {
  const key = ticketKey(SECRET);
  const now = Date.now();
  const { ticket, exp } = makeTicket(key, { handle: 'SkyRacer', userId: 'user-1' }, now);
  assert.equal(exp, now + TICKET_MS);
  const data = await check(ticket, key.publicJwk, now);
  assert.equal(data.v, 1);
  assert.equal(data.h, 'SkyRacer');
  assert.equal(await check(ticket, key.publicJwk, exp + 1), null);
  // Another site key, or a changed name, doesn't check out.
  assert.equal(await check(ticket, ticketKey(`${SECRET}-other`).publicJwk, now), null);
  const forged = Buffer.from(JSON.stringify({ ...data, h: 'Someone' })).toString('base64url');
  assert.equal(await check(`${forged}.${ticket.split('.')[1]}`, key.publicJwk, now), null);
  assert.ok(ticket.length < 600);
});

test('the account tag is the same for one player, differs between players and is not the account id', () => {
  const key = ticketKey(SECRET);
  const tag = (userId) => JSON.parse(Buffer.from(makeTicket(key, { handle: 'x', userId }).ticket.split('.')[0], 'base64url').toString()).u;
  assert.equal(tag('user-1'), tag('user-1'));
  assert.notEqual(tag('user-1'), tag('user-2'));
  assert.equal(tag('user-1').includes('user'), false);
  assert.throws(() => makeTicket(key, { handle: '', userId: 'user-1' }), /username/);
});
