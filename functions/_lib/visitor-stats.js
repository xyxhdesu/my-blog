const BOT_PATTERNS = [
  ['Googlebot', /googlebot|google-inspectiontool|googleother/i],
  ['Bingbot', /bingbot|bingpreview/i],
  ['Baidu', /baiduspider/i],
  ['Sogou', /sogou\s*web\s*spider|sogou\s*spider/i],
  ['360 Search', /360spider|haosouspider/i],
  ['DuckDuckGo', /duckduckbot/i],
  ['Yandex', /yandexbot/i],
  ['Facebook', /facebookexternalhit|facebot/i],
  ['Twitter', /twitterbot/i],
  ['Applebot', /applebot/i],
];

const GENERIC_BOT_PATTERN = /\b(bot|crawler|spider|slurp|scraper|preview)\b/i;
const MAX_PATH_LENGTH = 512;

export function normalizeTrackedPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > MAX_PATH_LENGTH) return null;
  if (value.startsWith('/api/') || value.startsWith('/cdn-cgi/') || value.includes('\\') || value.includes('..')) return null;
  return value === '/' ? value : value.replace(/\/+$/, '');
}

export function isDocumentRequest(request) {
  if (request.method !== 'GET') return false;
  const destination = request.headers.get('sec-fetch-dest');
  if (destination && destination !== 'document') return false;
  return request.headers.get('accept')?.includes('text/html') || destination === 'document';
}

export function classifyCrawler(userAgent) {
  if (!userAgent) return 'Unknown bot';
  for (const [name, pattern] of BOT_PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  return GENERIC_BOT_PATTERN.test(userAgent) ? 'Unknown bot' : null;
}

function shanghaiDate(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

async function hashVisitorId(visitorId, salt) {
  const data = new TextEncoder().encode(`${salt}:${visitorId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recordCrawler(database, crawler, path, date) {
  await database.prepare(
    `INSERT INTO crawler_visits (date, crawler, path, visits, last_seen)
     VALUES (?, ?, ?, 1, unixepoch())
     ON CONFLICT(date, crawler, path) DO UPDATE SET visits = visits + 1, last_seen = unixepoch()`,
  ).bind(date, crawler, path).run();
}

export async function recordVisit({ database, path, userAgent, visitorId, salt, now = new Date() }) {
  if (!database || !path) return;

  const date = shanghaiDate(now);
  const crawler = classifyCrawler(userAgent);
  if (crawler) {
    await recordCrawler(database, crawler, path, date);
    return { crawler };
  }

  if (!visitorId || !salt) return;
  const visitorHash = await hashVisitorId(visitorId, salt);
  const windowStart = Math.floor(now.getTime() / (30 * 60 * 1000));
  const pageWindow = await database.prepare(
    `INSERT INTO human_visit_windows (window_start, visitor_hash, path)
     VALUES (?, ?, ?)
     ON CONFLICT(window_start, visitor_hash, path) DO NOTHING`,
  ).bind(windowStart, visitorHash, path).run();

  if (!pageWindow.meta.changes) return;

  const uniqueVisitor = await database.prepare(
    `INSERT INTO daily_visitors (date, visitor_hash)
     VALUES (?, ?)
     ON CONFLICT(date, visitor_hash) DO NOTHING`,
  ).bind(date, visitorHash).run();

  const statements = [
    database.prepare('INSERT INTO visitor_counters (scope, value) VALUES (?, 1) ON CONFLICT(scope) DO UPDATE SET value = value + 1').bind('site:views'),
    database.prepare('INSERT INTO visitor_counters (scope, value) VALUES (?, 1) ON CONFLICT(scope) DO UPDATE SET value = value + 1').bind(`page:${path}`),
    database.prepare('INSERT INTO visitor_counters (scope, value) VALUES (?, 1) ON CONFLICT(scope) DO UPDATE SET value = value + 1').bind(`day:${date}:views`),
  ];
  if (uniqueVisitor.meta.changes) {
    statements.push(database.prepare(
      'INSERT INTO visitor_counters (scope, value) VALUES (?, 1) ON CONFLICT(scope) DO UPDATE SET value = value + 1',
    ).bind(`day:${date}:visitors`));
  }
  await database.batch(statements);
}

export async function getVisitStats(database, path) {
  if (!database) return null;
  const { results } = await database.prepare(
    'SELECT scope, value FROM visitor_counters WHERE scope IN (?, ?)',
  ).bind('site:views', `page:${path}`).all();
  const values = new Map(results.map((row) => [row.scope, Number(row.value)]));
  return {
    siteViews: values.get('site:views') || 0,
    pageViews: values.get(`page:${path}`) || 0,
  };
}
