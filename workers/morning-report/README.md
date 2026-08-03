# Morning Report Worker

This Worker builds one cached daily anime report from Bangumi and Hitokoto.
It serves the Hugo homepage from its `workers.dev` URL and refreshes at 07:00
Asia/Shanghai time (`0 23 * * *` in Cloudflare's UTC cron format).

## One-time Cloudflare setup

1. In **Workers & Pages**, create a KV namespace named `morning-reports`.
2. Copy `wrangler.example.toml` to `wrangler.toml` and replace the KV namespace ID.
3. Log in with Wrangler, then deploy from this directory:

   ```powershell
   npx wrangler login
   npx wrangler deploy
   ```

4. Trigger the Worker once from the dashboard or visit its `workers.dev` URL. The first
   response will populate KV; later visits use the daily cache.

## Optional Bangumi token

The calendar endpoint is public. If Bangumi later requires authentication, add
`BANGUMI_ACCESS_TOKEN` as a Worker secret instead of putting it in this repo:

```powershell
npx wrangler secret put BANGUMI_ACCESS_TOKEN
```

## Behaviour

- Keeps a date-specific report and `morning-report:latest` fallback in KV.
- Shows three high-ranked titles from the current Bangumi weekday.
- Caches five Hitokoto entries for each report; the homepage adds one local fallback entry as the sixth quote.
- Links users to `https://bgm.tv/calendar` for the complete daily schedule.
- If both cache and upstream data are unavailable, the homepage hides the card.
