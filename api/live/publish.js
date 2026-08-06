// api/live/publish.js
// Write side. Authenticated with a shared secret; the bot machine is the only caller.
import { kv } from '@vercel/kv';
import { timingSafeEqual } from 'node:crypto';

const KEY = 'live:latest';
const TTL = 60 * 60 * 24;
const MAX_BYTES = 4096;
const ALLOWED_TOP = new Set(['ts', 'session', 'indices']);
const ALLOWED_INDEX_NAMES = new Set(['NIFTY', 'SENSEX']);
const ALLOWED_INDEX = new Set([
  'spot', 'synthetic', 'basis', 'basis_pct', 'basis_annualised_pct',
  'expiry', 'atm', 'strikes_used', 'quality',
]);

function isPlainObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// Must never throw, for any header value: absent, empty, an array, a
// number, or a string. Byte length is compared, not JS string length,
// because a UTF-16 code-unit count can match while the UTF-8 buffers
// differ in size, which would otherwise make timingSafeEqual throw and
// turn an anonymous caller's 401 into an unhandled exception.
function secretOk(given) {
  const want = process.env.QN_LIVE_PUBLISH_KEY || '';
  if (typeof given !== 'string' || !given || !want) return false;
  const givenBuf = Buffer.from(given, 'utf8');
  const wantBuf = Buffer.from(want, 'utf8');
  if (givenBuf.length !== wantBuf.length) return false;
  return timingSafeEqual(givenBuf, wantBuf);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!secretOk(req.headers['x-qn-key'])) return res.status(401).end();

  // Reject an oversized body by its declared length before doing anything
  // with the already-parsed req.body. The serialized-length check below
  // stays as a backstop for a missing or lying content-length header.
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return res.status(413).end();
  }

  const body = req.body;
  if (!isPlainObject(body)) return res.status(400).end();
  if (JSON.stringify(body).length > MAX_BYTES) return res.status(413).end();

  // Reject anything not in the agreed shape rather than storing it. This
  // endpoint is public-facing; it should never become a way to park data.
  for (const k of Object.keys(body)) {
    if (!ALLOWED_TOP.has(k)) return res.status(400).end();
  }
  if (typeof body.ts !== 'string' || !['open', 'closed'].includes(body.session)) {
    return res.status(400).end();
  }
  if (!isPlainObject(body.indices)) return res.status(400).end();
  for (const k of Object.keys(body.indices)) {
    if (!ALLOWED_INDEX_NAMES.has(k)) return res.status(400).end();
  }
  for (const block of Object.values(body.indices)) {
    if (!isPlainObject(block)) return res.status(400).end();
    for (const k of Object.keys(block)) {
      if (!ALLOWED_INDEX.has(k)) return res.status(400).end();
    }
    if (!Number.isFinite(block.synthetic) || !Number.isFinite(block.spot)) {
      return res.status(400).end();
    }
  }

  await kv.set(KEY, body, { ex: TTL });
  return res.status(204).end();
}
