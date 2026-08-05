-- Cloudflare D1 schema for the blog visitor statistics feature.
CREATE TABLE IF NOT EXISTS visitor_counters (
  scope TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_visitors (
  date TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (date, visitor_hash)
);

CREATE TABLE IF NOT EXISTS human_visit_windows (
  window_start INTEGER NOT NULL,
  visitor_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (window_start, visitor_hash, path)
);

CREATE TABLE IF NOT EXISTS crawler_visits (
  date TEXT NOT NULL,
  crawler TEXT NOT NULL,
  path TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (date, crawler, path)
);

CREATE INDEX IF NOT EXISTS crawler_visits_by_date ON crawler_visits (date DESC, visits DESC);
