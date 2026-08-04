const QUOTE_ARCHIVE_URL = 'https://morning-report.1961335016.workers.dev/api/quote-archive';
const UPSTREAM_TIMEOUT_MS = 8000;

export async function onRequestGet({ request }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamUrl = new URL(QUOTE_ARCHIVE_URL);
    upstreamUrl.search = new URL(request.url).search;
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Quote archive proxy failed', error);
    return Response.json({ error: 'Quote archive is temporarily unavailable.' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  } finally {
    clearTimeout(timeout);
  }
}
