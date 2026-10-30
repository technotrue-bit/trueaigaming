// @ts-check
// Match tickets for online games (Flag Catch). A ticket is the signed-in player's username, signed by the site, good
// for a few hours: the play page hands it to the game, and every other phone in a room checks it with the site's
// public key before showing the name. So the only names players see are real TrueAIGaming usernames, and the game
// never sees a sign-in. Plain Node crypto, no dependencies.
//
// The signing key (ECDSA P-256) is worked out from an existing server secret, the Supabase service role key, so
// there is no new secret to keep. It changes only if that key is changed, and then every ticket is simply renewed.
import { createECDH, createPrivateKey, hkdfSync, sign } from 'node:crypto';

/** How long a ticket works. The play page asks for a new one well before. */
export const TICKET_MS = 6 * 3600 * 1000;

/** The order of the P-256 curve; a private key is a number from 1 to N - 1. */
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

/**
 * @typedef {object} TicketKey
 * @property {import('node:crypto').KeyObject} privateKey
 * @property {{ kty: 'EC', crv: 'P-256', x: string, y: string }} publicJwk What the game checks tickets with.
 * @property {Buffer} tagKey Turns an account id into a short tag that isn't the id.
 */

/** @param {Buffer} b */
const b64u = (b) => b.toString('base64url');

/** @type {{ secret: string, key: TicketKey } | null} */
let memo = null;

/**
 * The site's ticket key, from the server secret.
 * @param {string} secret
 * @returns {TicketKey}
 */
export function ticketKey(secret) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('A server secret is needed to sign match tickets');
  if (memo?.secret === secret) return memo.key;
  // 48 bytes taken down to the curve's range: as good as uniform.
  const raw = Buffer.from(hkdfSync('sha256', secret, 'trueaigaming', 'match-ticket-v1', 48));
  const d = (BigInt(`0x${raw.toString('hex')}`) % (N - 1n)) + 1n;
  const dBuf = Buffer.from(d.toString(16).padStart(64, '0'), 'hex');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(dBuf);
  const pub = ecdh.getPublicKey();
  const x = b64u(pub.subarray(1, 33));
  const y = b64u(pub.subarray(33, 65));
  const privateKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x, y, d: b64u(dBuf) }, format: 'jwk' });
  const tagKey = Buffer.from(hkdfSync('sha256', secret, 'trueaigaming', 'match-player-tag-v1', 32));
  const key = { privateKey, publicJwk: /** @type {const} */ ({ kty: 'EC', crv: 'P-256', x, y }), tagKey };
  memo = { secret, key };
  return key;
}

/**
 * A ticket for one player: `body.signature`, both base64url. The body holds the username (h), a short tag for the
 * account (u, so a room can spot the same player twice without learning the account id) and when it runs out (e).
 * @param {TicketKey} key
 * @param {{ handle: string, userId: string }} who
 * @param {number} [now]
 * @returns {{ ticket: string, exp: number }}
 */
export function makeTicket(key, { handle, userId }, now = Date.now()) {
  if (typeof handle !== 'string' || !handle) throw new Error('A username is needed for a match ticket');
  const exp = now + TICKET_MS;
  const u = b64u(Buffer.from(hkdfSync('sha256', key.tagKey, '', userId, 9)));
  const body = b64u(Buffer.from(JSON.stringify({ v: 1, h: handle, u, e: exp })));
  const signature = sign('sha256', Buffer.from(body), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return { ticket: `${body}.${b64u(signature)}`, exp };
}
