// Social channels and statistics: platform details, and turning a platform's CSV export into monthly numbers.

export type Platform = { short: string; c: string; analytics: string; open: string; csv: string; api?: "youtube" };
/** Monogram, colour, where analytics live, and how to get statistics out of each platform. */
export const PLATFORM: Record<string, Platform> = {
  LinkedIn: { short: "in", c: "#0A66C2", open: "https://www.linkedin.com/", analytics: "https://www.linkedin.com/", csv: "Page admin → Analytics → Content, Followers or Visitors → Export (choose the period)" },
  X: { short: "X", c: "#14171A", open: "https://x.com/", analytics: "https://x.com/i/account_analytics", csv: "Analytics → Export data (CSV) for the period" },
  YouTube: { short: "YT", c: "#E62117", open: "https://www.youtube.com/", analytics: "https://studio.youtube.com/", csv: "YouTube Studio → Analytics → Advanced mode → Export (CSV)", api: "youtube" },
  Instagram: { short: "IG", c: "#C13584", open: "https://www.instagram.com/", analytics: "https://business.facebook.com/latest/insights", csv: "Meta Business Suite → Insights → Export data (CSV)" },
  Facebook: { short: "f", c: "#1877F2", open: "https://www.facebook.com/", analytics: "https://business.facebook.com/latest/insights", csv: "Meta Business Suite → Insights → Export data (CSV)" },
  TikTok: { short: "TT", c: "#111111", open: "https://www.tiktok.com/", analytics: "https://www.tiktok.com/tiktokstudio", csv: "TikTok Studio → Analytics → Download data" },
  Telegram: { short: "TG", c: "#229ED9", open: "https://web.telegram.org/", analytics: "https://web.telegram.org/", csv: "Channel → Statistics (enter numbers manually)" },
  Website: { short: "WWW", c: "#FF6A2B", open: "https://www.agron1.com/", analytics: "https://analytics.google.com/", csv: "Google Analytics → Reports → Share this report → Download file (CSV)" },
  "Google Analytics": { short: "GA", c: "#E37400", open: "https://analytics.google.com/", analytics: "https://analytics.google.com/", csv: "Reports → Share this report → Download file (CSV)" },
  "Google Search Console": { short: "SC", c: "#4285F4", open: "https://search.google.com/search-console", analytics: "https://search.google.com/search-console", csv: "Performance → Export → Download CSV" },
  "Google Business Profile": { short: "GB", c: "#34A853", open: "https://business.google.com/", analytics: "https://business.google.com/", csv: "Performance → Download (CSV)" },
  "Meta Business Suite": { short: "M", c: "#0866FF", open: "https://business.facebook.com/", analytics: "https://business.facebook.com/latest/insights", csv: "Insights → Export data (CSV)" },
  Newsletter: { short: "@", c: "#0FA3A3", open: "", analytics: "", csv: "Email tool → Campaign report → Export (CSV)" },
};
export const platform = (p?: string): Platform => PLATFORM[p || ""] || { short: (p || "?").slice(0, 2), c: "#7A8796", open: "", analytics: "", csv: "Export a CSV with a date column" };

/** Metric columns we recognise in platform exports (English and Russian headers), lower-case, punctuation removed. */
const COLS: Record<string, string[]> = {
  impressions: ["impressions", "impressions total", "total impressions", "post impressions", "показы", "впечатления"],
  reach: ["reach", "unique impressions", "accounts reached", "охват", "уникальные показы"],
  engagements: ["engagements", "engagement", "total engagements", "interactions", "content interactions", "вовлеченность", "взаимодействия"],
  likes: ["likes", "reactions", "реакции", "лайки"], comments: ["comments", "комментарии"], shares: ["shares", "reposts", "retweets", "репосты"],
  clicks: ["clicks", "link clicks", "url clicks", "клики"],
  video_views: ["views", "video views", "просмотры"],
  // Daily exports (LinkedIn "Total followers", Meta "Follows", YouTube "Subscribers") report followers gained per day,
  // so they are summed as new followers; the follower total comes from the account card or the API.
  new_followers: ["new followers", "followers gained", "subscribers gained", "subscribers", "follows", "total followers", "followers", "новые подписчики", "подписчики"],
  sessions: ["sessions", "сеансы", "сессии"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const num = (v: string) => { const x = Number(String(v || "").replace(/[\s,]/g, "").replace(/%$/, "")); return Number.isFinite(x) ? x : 0; };

/** YYYY-MM from the common date shapes in exports (2026-10-03, 10/03/2026, 03.10.2026, Oct 3, 2026). */
export function monthOf(v: string): string {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})/); if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}`; // US exports
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}`;
  const t = Date.parse(s); if (!isNaN(t) && /\d{4}/.test(s)) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  return "";
}

export type MonthStats = { period: string; impressions: number; reach: number; engagements: number; clicks: number; video_views: number; new_followers: number; followers: number; sessions: number; days: number };
/** Reads a platform CSV export (rows from parseCsv; one row per day or per post) and sums it by month. */
export function aggregateExport(parsed: string[][]): { months: MonthStats[]; found: string[] } {
  const rows = parsed.filter((r) => r.some((c) => String(c).trim()));
  // Some exports start with a title line: use the first row that contains a date-like header
  let h = rows.findIndex((r) => r.some((c) => /^(date|day|дата|день|content date|created|published|time|period)/i.test(String(c).trim())));
  if (h < 0) h = 0;
  const head = rows[h].map((c) => norm(String(c)));
  const dateCol = head.findIndex((c) => /^(date|day|дата|день|content date|created|published|time|period)/.test(c));
  if (dateCol < 0) return { months: [], found: [] };
  const colOf: Record<string, number> = {};
  const bare = (c: string) => c.replace(/\b(total|sum|всего)\b/g, " ").replace(/\s+/g, " ").trim(); // "Clicks (total)" = clicks
  for (const [k, names] of Object.entries(COLS)) { let i = head.findIndex((c) => names.includes(c)); if (i < 0) i = head.findIndex((c) => names.includes(bare(c))); if (i >= 0) colOf[k] = i; }
  const by: Record<string, MonthStats> = {};
  for (const r of rows.slice(h + 1)) {
    const p = monthOf(r[dateCol]); if (!p) continue;
    const o = (by[p] ||= { period: p, impressions: 0, reach: 0, engagements: 0, clicks: 0, video_views: 0, new_followers: 0, followers: 0, sessions: 0, days: 0 });
    o.days++;
    for (const k of ["impressions", "reach", "clicks", "video_views", "new_followers", "sessions"] as const) if (colOf[k] !== undefined) o[k] += num(r[colOf[k]]);
    if (colOf.engagements !== undefined) o.engagements += num(r[colOf.engagements]);
    else o.engagements += ["likes", "comments", "shares"].reduce((a, k) => a + (colOf[k] !== undefined ? num(r[colOf[k]]) : 0), 0);
  }
  const found = Object.keys(colOf).filter((k) => !["likes", "comments", "shares"].includes(k) || colOf.engagements === undefined);
  return { months: Object.values(by).sort((a, b) => a.period.localeCompare(b.period)), found };
}

/** Change between two numbers as text: +12% / −3% / new. */
export const delta = (now: number, before: number) => (!before ? (now ? "new" : "") : `${now >= before ? "+" : "−"}${Math.abs(Math.round(((now - before) / before) * 100))}%`);
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const prevMonth = (p: string) => { const [y, m] = p.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
