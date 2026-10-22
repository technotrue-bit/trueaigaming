// Request and response helpers: JSON replies, size-limited body reads and JSON parsing. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { InvalidJson, PayloadTooLarge, readBody, readJson, send } from './http.mjs';

/** A request-like object: a stream of the given chunks, with a headers object. */
function fakeRequest(chunks, headers = {}) {
  return Object.assign(Readable.from(chunks), { headers });
}

/** A response-like object that records what send() wrote. */
function fakeResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

test('send writes JSON with the same headers as api/feedback.ts', () => {
  const res = fakeResponse();
  send(res, 200, { ok: true });
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers, JSON_HEADERS);
  assert.equal(res.body, '{"ok":true}');
});

test('send adds extra headers such as Retry-After to the defaults', () => {
  const res = fakeResponse();
  send(res, 429, { ok: false, error: 'Too many submissions, try again later' }, { 'Retry-After': '600' });
  assert.equal(res.status, 429);
  assert.deepEqual(res.headers, { ...JSON_HEADERS, 'Retry-After': '600' });
  assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'Too many submissions, try again later' });
});

test('readBody returns the whole body as one buffer', async () => {
  const body = await readBody(fakeRequest([Buffer.from('ab'), Buffer.from('cd')]), 10);
  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.toString('utf8'), 'abcd');
});

test('readBody accepts string chunks as well as buffers', async () => {
  const body = await readBody(fakeRequest(['ab', Buffer.from('cd')]), 10);
  assert.equal(body.toString('utf8'), 'abcd');
});

test('readBody accepts a body of exactly maxBytes', async () => {
  const body = await readBody(fakeRequest([Buffer.alloc(5, 'x')]), 5);
  assert.equal(body.length, 5);
});

test('readBody throws PayloadTooLarge when the streamed body exceeds maxBytes', async () => {
  await assert.rejects(readBody(fakeRequest([Buffer.alloc(3), Buffer.alloc(3)]), 5), PayloadTooLarge);
});

test('readBody throws PayloadTooLarge when the declared Content-Length exceeds maxBytes', async () => {
  await assert.rejects(readBody(fakeRequest([], { 'content-length': '999' }), 5), PayloadTooLarge);
});

test('readJson parses a JSON body', async () => {
  assert.deepEqual(await readJson(fakeRequest(['{"type":"bug"}']), 100), { type: 'bug' });
});

test('readJson throws PayloadTooLarge when the body exceeds maxBytes', async () => {
  await assert.rejects(readJson(fakeRequest(['{"message":"far too long for the limit"}']), 5), PayloadTooLarge);
});

test('readJson throws InvalidJson on malformed JSON', async () => {
  await assert.rejects(readJson(fakeRequest(['{"type":']), 100), InvalidJson);
});

test('readJson throws InvalidJson on an empty body', async () => {
  await assert.rejects(readJson(fakeRequest([]), 100), InvalidJson);
});
