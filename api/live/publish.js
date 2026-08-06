// api/live/publish.js
// Write side. Authenticated with a shared secret; the bot machine is the only caller.
import { kv } from '@vercel/kv';
import { timingSafeEqual } from 'node:crypto';

const KEY = 'live:latest';
const TTL = 60 * 60 * 24;
const ALLOWED_TOP = new Set(['ts', 'session', 'indices']);
const ALLOWED_INDEX = new Set([
  'spot', 'synthetic', 'basis', 'basis_pct', 'basis_annualised_pct',
  'expiry', 'atm', 'strikes_used', 'quality',
]);

function secretOk(given) {
  const want = process.env.QN_LIVE_PUBLISH_KEY || '';
  if (!want || !given || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!secretOk(req.headers['x-qn-key'])) return res.status(401).end();

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).end();
  if (JSON.stringify(body).length > 4096) return res.status(413).end();

  // Reject anything not in the agreed shape rather than storing it. This
  // endpoint is public-facing; it should never become a way to park data.
  for (const k of Object.keys(body)) {
    if (!ALLOWED_TOP.has(k)) return res.status(400).end();
  }
  if (typeof body.ts !== 'string' || !['open', 'closed'].includes(body.session)) {
    return res.status(400).end();
  }
  if (!body.indices || typeof body.indices !== 'object') return res.status(400).end();
  for (const block of Object.values(body.indices)) {
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
