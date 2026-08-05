import { getVisitStats, normalizeTrackedPath } from '../_lib/visitor-stats.js';

export async function onRequestGet({ request, env }) {
  const path = normalizeTrackedPath(new URL(request.url).searchParams.get('path') || '/');
  if (!path) return Response.json({ error: 'Invalid path.' }, { status: 400 });
  if (!env.VISITOR_STATS) return Response.json({ error: 'Visitor statistics are not configured.' }, { status: 503 });

  try {
    const stats = await getVisitStats(env.VISITOR_STATS, path);
    return Response.json(stats, {
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Visitor statistics read failed', error);
    return Response.json({ error: 'Visitor statistics are temporarily unavailable.' }, { status: 503 });
  }
}
