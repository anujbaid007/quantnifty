# DNS setup — quantnifty.com and quantnifty.in

Both domains are registered at **GoDaddy** (nameservers `*.domaincontrol.com`) and are already
added to the Vercel project `quantnifty`. They will not serve the site until the DNS records below
are set at GoDaddy.

## Records to add (GoDaddy → Domain → DNS → Manage Zones)

For **each** domain — `quantnifty.com` and `quantnifty.in`:

| Type  | Name | Value                  | TTL    |
|-------|------|------------------------|--------|
| A     | `@`  | `76.76.21.21`          | 1 hour |
| CNAME | `www`| `cname.vercel-dns.com` | 1 hour |

Delete any existing parking records for `@` and `www` first — GoDaddy points new domains at its own
parking IPs, and those will conflict.

## What happens after propagation (5 minutes – 2 hours)

- `quantnifty.com` → serves the site. This is the canonical domain.
- `www.quantnifty.com` → 301 to `quantnifty.com`
- `quantnifty.in` → 301 to `quantnifty.com`
- `www.quantnifty.in` → 301 to `quantnifty.com`

The redirects are configured in `vercel.json`, so nothing else needs changing.

## Why one canonical domain

Two domains serving identical content splits search authority and can be treated as duplicate
content. Redirecting `.in` to `.com` consolidates all ranking signals on one hostname. The `.in`
domain still works for anyone who types it — they just land on `.com`.

**To flip it the other way** (make `.in` canonical, e.g. for a purely Indian audience):
1. In `vercel.json`, swap the hosts in the `redirects` block.
2. In `index.html`, change the canonical link and all `og:`/`twitter:` URLs from
   `https://quantnifty.com` to `https://quantnifty.in`.
3. In `robots.txt` and `sitemap.xml`, change the domain.

## Verify once DNS is live

```
curl -sI https://quantnifty.com | head -1              # expect 200
curl -sI https://quantnifty.in  | head -1              # expect 301
curl -sI https://quantnifty.in  | grep -i location     # expect https://quantnifty.com/
```

## Then submit to search engines

1. **Google Search Console** — add `quantnifty.com` as a Domain property, verify by TXT record,
   submit `https://quantnifty.com/sitemap.xml`.
2. **Bing Webmaster Tools** — import from Search Console, or add and submit the same sitemap.
   Bing powers ChatGPT search, so this one matters for AI visibility.
