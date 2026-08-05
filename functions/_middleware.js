import { classifyCrawler, isDocumentRequest, normalizeTrackedPath, recordVisit } from './_lib/visitor-stats.js';

const VISITOR_COOKIE = 'blog_visitor_id';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function newVisitorId() {
  return crypto.randomUUID().replaceAll('-', '');
}

function readCookie(request, name) {
  const match = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] || null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const path = normalizeTrackedPath(new URL(request.url).pathname);
  const shouldTrack = path && isDocumentRequest(request);
  const userAgent = request.headers.get('user-agent') || '';
  const existingVisitorId = readCookie(request, VISITOR_COOKIE);
  const visitorId = existingVisitorId || (shouldTrack && !classifyCrawler(userAgent) ? newVisitorId() : null);

  if (shouldTrack && env.VISITOR_STATS && env.VISITOR_STATS_SALT) {
    context.waitUntil(recordVisit({
      database: env.VISITOR_STATS,
      path,
      userAgent,
      visitorId,
      salt: env.VISITOR_STATS_SALT,
    }).catch((error) => console.error('Visitor statistics write failed', error)));
  }

  const response = await context.next();
  if (!shouldTrack || existingVisitorId || !visitorId) return response;

  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `${VISITOR_COOKIE}=${visitorId}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; Secure; SameSite=Lax`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
