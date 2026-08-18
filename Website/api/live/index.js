// api/live/index.js
// Read side. Public, cached at the edge so the store is not hit per visitor.
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const payload = await kv.get('live:latest');
  if (!payload) return res.status(204).end();
  res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=30');
  return res.status(200).json(payload);
}
