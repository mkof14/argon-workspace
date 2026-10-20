// Personal delivery rules, applied by the server when it sends (never by the browser):
// quiet hours in the person's own time zone, the e-mail mode (immediately / one daily summary / never) and the
// events that cannot be switched off. In-app notifications are never held back — only e-mail and phone wait.
export type NotifyPrefs = { email?: string[]; push?: string[]; muted?: string[]; email_mode?: "immediate" | "daily" | "off"; quiet?: { from?: string; to?: string } | null; tz?: string };

/** Events everyone receives whatever their settings say (critical announcements, security notices). */
export const MANDATORY = new Set(["announcement_critical", "security"]);
export const DIGEST_HOUR = 8;

/** Hour and minute in a time zone ("UTC" when the zone is unknown). */
export function localTime(tz: string | undefined, now: Date) {
  let zone = tz || "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { zone = "UTC"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (+parts.hour % 24) * 60 + +parts.minute, zone };
}
const mins = (s?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ""); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };

/** Inside the person's quiet hours right now? (A window may cross midnight: 22:00–07:00.) */
export function inQuietHours(p: NotifyPrefs | null | undefined, now: Date) {
  const a = mins(p?.quiet?.from), b = mins(p?.quiet?.to); if (a == null || b == null || a === b) return false;
  const t = localTime(p?.tz, now).minutes;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** What to do with one e-mail now: send it, hold it for later, or not send it at all. */
export function emailDecision(p: NotifyPrefs | null | undefined, kind: string, now: Date, digestSentToday: boolean): "send" | "hold" | "skip" | "digest" {
  if (MANDATORY.has(kind)) return "send";
  const mode = p?.email_mode || "immediate";
  if (mode === "off") return "skip";
  if (inQuietHours(p, now)) return "hold";
  if (mode === "daily") return !digestSentToday && localTime(p?.tz, now).minutes >= DIGEST_HOUR * 60 ? "digest" : "hold";
  return "send";
}
export const pushDecision = (p: NotifyPrefs | null | undefined, kind: string, now: Date): "send" | "hold" => (MANDATORY.has(kind) || !inQuietHours(p, now) ? "send" : "hold");
