# Visitor Statistics

The blog records document-page visits at the Cloudflare Pages edge. Human page views and crawlers are stored separately.

## What is stored

- Human page view: page path and a salted hash of a random first-party cookie.
- Daily unique visitor: a salted hash, scoped to one Shanghai calendar day.
- Crawler: recognised crawler name, page path, count, and last-seen time.

No IP address, raw cookie value, or raw user-agent is stored. Human views are counted at most once per page in each 30-minute window. Known and unknown bots never enter PV or UV totals.

## Cloudflare setup

1. Create a D1 database, for example `blog-visitor-stats`.
2. Apply the schema:

   ```powershell
   npx wrangler d1 execute blog-visitor-stats --remote --file=database/visitor-stats.sql
   ```

3. In the Cloudflare Pages project for this blog, add a D1 binding named `VISITOR_STATS` that points to that database.
4. Add a Pages environment secret named `VISITOR_STATS_SALT`. Generate it with a password manager and keep it private. Changing it resets visitor de-duplication, but does not expose existing hashes.
5. Deploy the site. The Pages middleware begins collecting page requests immediately after deployment.

The public endpoint is `GET /api/visitor-stats?path=/posts/example`. It returns only total site views and that page's view count. Crawler detail remains in D1 and is intentionally not publicly exposed.

## Viewing daily human traffic

```powershell
npx wrangler d1 execute blog-visitor-stats --remote --command "SELECT scope, value FROM visitor_counters WHERE scope IN ('day:2026-08-05:views', 'day:2026-08-05:visitors')"
```

## Viewing crawler aggregates

Run this in the project directory, replacing the date when needed:

```powershell
npx wrangler d1 execute blog-visitor-stats --remote --command "SELECT crawler, SUM(visits) AS visits, MAX(last_seen) AS last_seen FROM crawler_visits WHERE date = '2026-08-05' GROUP BY crawler ORDER BY visits DESC"
```
