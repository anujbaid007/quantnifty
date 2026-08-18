// test/publish.test.js
// Unit tests for the publish route's auth and shape validation. Only the
// success path touches kv.set, and @vercel/kv is mocked so the whole suite
// runs without a network call or KV credentials.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const kvSetCalls = [];
mock.module('@vercel/kv', {
  namedExports: {
    kv: {
      async set(key, value, options) {
        kvSetCalls.push({ key, value, options });
        return 'OK';
      },
    },
  },
});

const { default: handler } = await import('../api/live/publish.js');

const GOOD_KEY = 'a'.repeat(64);
process.env.QN_LIVE_PUBLISH_KEY = GOOD_KEY;

const VALID_BODY = {
  ts: '2026-08-02T12:00:00+05:30',
  session: 'open',
  indices: {
    NIFTY: {
      spot: 24380,
      synthetic: 24390,
      basis: 10,
      basis_pct: 0.041,
      basis_annualised_pct: 3.7,
      expiry: '2026-08-06',
      atm: 24400,
      strikes_used: 3,
      quality: 'ok',
    },
  },
};

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function makeRes() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

function makeReq({ method = 'POST', headers = {}, body } = {}) {
  return { method, headers, body };
}

// --- method ---

test('non-POST method returns 405', async () => {
  const req = makeReq({ method: 'GET', headers: { 'x-qn-key': GOOD_KEY }, body: VALID_BODY });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

// --- secretOk: must never throw, for any header shape ---

test('absent key header returns 401', async () => {
  const req = makeReq({ headers: {}, body: VALID_BODY });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('empty string key header returns 401', async () => {
  const req = makeReq({ headers: { 'x-qn-key': '' }, body: VALID_BODY });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('array-valued key header returns 401 without throwing', async () => {
  const req = makeReq({ headers: { 'x-qn-key': [GOOD_KEY, GOOD_KEY] }, body: VALID_BODY });
  const res = makeRes();
  await assert.doesNotReject(() => handler(req, res));
  assert.equal(res.statusCode, 401);
});

test('array header whose length happens to match the key length returns 401 without throwing', async () => {
  // Mirrors the old bug's length check: an array of exactly 64 elements
  // has the same `.length` as the 64-character key, so a length-only
  // comparison would have let this fall through to Buffer/timingSafeEqual.
  const req = makeReq({ headers: { 'x-qn-key': new Array(64).fill('x') }, body: VALID_BODY });
  const res = makeRes();
  await assert.doesNotReject(() => handler(req, res));
  assert.equal(res.statusCode, 401);
});

test('multi-byte key with matching JS string length but different byte length returns 401 without throwing', async () => {
  // 'é'.repeat(64) has .length === 64 (UTF-16 code units), same as
  // GOOD_KEY, but its UTF-8 byte length is 128 vs GOOD_KEY's 64. A byte
  // length mismatch must be caught before timingSafeEqual is called.
  const req = makeReq({ headers: { 'x-qn-key': 'é'.repeat(64) }, body: VALID_BODY });
  const res = makeRes();
  await assert.doesNotReject(() => handler(req, res));
  assert.equal(res.statusCode, 401);
});

test('wrong key of the correct length returns 401', async () => {
  const req = makeReq({ headers: { 'x-qn-key': 'b'.repeat(64) }, body: VALID_BODY });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('correct key with a valid payload is accepted and stored', async () => {
  const before = kvSetCalls.length;
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body: clone(VALID_BODY) });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 204);
  assert.equal(kvSetCalls.length, before + 1);
  assert.equal(kvSetCalls[before].key, 'live:latest');
});

// --- body size ---

test('oversized content-length header returns 413 before the body is inspected', async () => {
  const req = makeReq({
    headers: { 'x-qn-key': GOOD_KEY, 'content-length': '999999' },
    body: VALID_BODY, // small and otherwise valid; only the header should matter
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 413);
});

test('oversized body falls back to the serialized-length check when content-length is missing', async () => {
  const bigBody = clone(VALID_BODY);
  bigBody.indices.NIFTY.quality = 'x'.repeat(5000);
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body: bigBody });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 413);
});

// --- shape: top level ---

test('unknown top-level field returns 400', async () => {
  const body = clone(VALID_BODY);
  body.evil = 1;
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

// --- shape: indices container ---

test('indices as an array returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices = [VALID_BODY.indices.NIFTY];
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('indices as null returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices = null;
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('unknown index name returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.DOWJONES = body.indices.NIFTY;
  delete body.indices.NIFTY;
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('__proto__ as an indices key returns 400', async () => {
  const body = clone(VALID_BODY);
  const withProto = JSON.parse('{"__proto__": {"spot": 1, "synthetic": 1}}');
  body.indices = withProto;
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

// --- shape: per-index block ---

test('a block that is an array returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY = [1, 2, 3];
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('unknown field inside a block returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY.evil = 1;
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('string value in spot (numeric field) returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY.spot = 'not a number';
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('string value in atm (numeric field) returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY.atm = 'not a number';
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('string value in basis (numeric field) returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY.basis = 'not a number';
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('unknown quality value returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY.quality = 'unknown';
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('malformed expiry (missing leading zero) returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY.expiry = '2026-8-06';
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('malformed expiry (wrong format) returns 400', async () => {
  const body = clone(VALID_BODY);
  body.indices.NIFTY.expiry = '06/08/2026';
  const req = makeReq({ headers: { 'x-qn-key': GOOD_KEY }, body });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});
