const MORNING_REPORT_URL = 'https://morning-report.1961335016.workers.dev/api/morning-report';
const UPSTREAM_TIMEOUT_MS = 8000;

export async function onRequestGet() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(MORNING_REPORT_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!upstream.ok) throw new Error(`Morning report upstream returned ${upstream.status}`);

    return new Response(await upstream.text(), {
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Morning report proxy failed', error);
    return Response.json({ error: 'Morning report is temporarily unavailable.' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  } finally {
    clearTimeout(timeout);
  }
}
