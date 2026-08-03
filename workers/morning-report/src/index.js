const BANGUMI_CALENDAR_URL = 'https://api.bgm.tv/calendar';
const HITOKOTO_URL = 'https://v1.hitokoto.cn/?c=a&c=b&c=c&encode=json';
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const BANGUMI_CALENDAR_URL_FOR_VISITORS = 'https://bgm.tv/calendar';
const ALLOWED_ORIGIN = 'https://blog.xingyexiaohua.xyz';
const QUOTE_COUNT = 5;
const QUOTE_REQUEST_COUNT = 7;

const weekdayIds = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const weekdayCn = {
  Mon: '一',
  Tue: '二',
  Wed: '三',
  Thu: '四',
  Fri: '五',
  Sat: '六',
  Sun: '日',
};

function shanghaiNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekdayId: weekdayIds[parts.weekday],
    weekday: `星期${weekdayCn[parts.weekday]}`,
  };
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Upstream request failed: ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function formatAiringItems(calendar, weekdayId) {
  const today = calendar.find((entry) => entry.weekday?.id === weekdayId);
  const items = Array.isArray(today?.items) ? today.items : [];

  const selected = items
    .filter((subject) => subject?.id && (subject.name_cn || subject.name))
    .sort((left, right) => {
      const leftRank = left.rating?.rank || Number.MAX_SAFE_INTEGER;
      const rightRank = right.rating?.rank || Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (right.collection?.total || 0) - (left.collection?.total || 0);
    })
    .slice(0, 3)
    .map((subject) => ({
      title: subject.name_cn || subject.name,
      subtitle: subject.name_cn && subject.name_cn !== subject.name ? subject.name : '',
      cover: String(subject.images?.large || subject.images?.common || '').replace(/^http:/, 'https:'),
      url: `https://bgm.tv/subject/${subject.id}`,
    }));

  return { total: items.length, selected };
}

async function fetchQuotes() {
  const results = await Promise.all(
    Array.from({ length: QUOTE_REQUEST_COUNT }, (_, index) => {
      const requestUrl = `${HITOKOTO_URL}&request=${Date.now()}-${index}`;
      return fetchJson(requestUrl).catch(() => null);
    }),
  );
  const seen = new Set();

  return results
    .map((result) => result?.hitokoto ? {
      text: result.hitokoto,
      from: result.from_who || result.from || '',
    } : null)
    .filter((quote) => quote?.text && !seen.has(quote.text) && seen.add(quote.text))
    .slice(0, QUOTE_COUNT);
}

async function buildReport(env) {
  const now = shanghaiNow();
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'xingyexiaohua-blog-morning-report/1.0',
  };
  if (env.BANGUMI_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.BANGUMI_ACCESS_TOKEN}`;

  const [calendar, quotes] = await Promise.all([
    fetchJson(BANGUMI_CALENDAR_URL, { headers }),
    fetchQuotes(),
  ]);
  const airing = formatAiringItems(calendar, now.weekdayId);

  return {
    date: now.date,
    weekday: now.weekday,
    total: airing.total,
    airing: airing.selected,
    quotes,
    quote: quotes[0] || null,
    calendarUrl: BANGUMI_CALENDAR_URL_FOR_VISITORS,
    generatedAt: new Date().toISOString(),
  };
}

async function refreshReport(env) {
  const report = await buildReport(env);
  const body = JSON.stringify(report);
  await Promise.all([
    env.MORNING_REPORTS.put(`morning-report:${report.date}`, body),
    env.MORNING_REPORTS.put('morning-report:latest', body),
  ]);
  return report;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': ALLOWED_ORIGIN,
    },
  });
}

function hasQuoteSet(report) {
  return Array.isArray(report?.quotes) && report.quotes.length >= QUOTE_COUNT;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshReport(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/morning-report') {
      return new Response('Not found', { status: 404 });
    }

    const { date } = shanghaiNow();
    const today = await env.MORNING_REPORTS.get(`morning-report:${date}`);
    const cachedToday = today ? JSON.parse(today) : null;
    if (hasQuoteSet(cachedToday)) return jsonResponse(cachedToday);

    const latest = await env.MORNING_REPORTS.get('morning-report:latest');
    const cachedLatest = latest ? JSON.parse(latest) : null;
    if (hasQuoteSet(cachedLatest)) return jsonResponse(cachedLatest);

    try {
      return jsonResponse(await refreshReport(env));
    } catch (error) {
      console.error('Morning report is unavailable', error);
      if (cachedToday || cachedLatest) return jsonResponse(cachedToday || cachedLatest);
      return jsonResponse({ error: 'Morning report is not ready yet.' }, 503);
    }
  },
};
