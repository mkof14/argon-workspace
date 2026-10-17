// Time zones of the people: local hour and date for a moment, and a short clock label.
export const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Europe/Kyiv", "Asia/Dubai", "Asia/Riyadh", "Asia/Tbilisi", "Asia/Singapore", "UTC"];
const parts = (d: Date, tz: string) => { try { return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value])); } catch { return null; } };
export function localHour(d: Date, tz: string) { const p = parts(d, tz) || parts(d, "UTC")!; return Number(p.hour); }
export function localDate(d: Date, tz: string) { const p = parts(d, tz) || parts(d, "UTC")!; return `${p.year}-${p.month}-${p.day}`; }
export function localTime(d: Date, tz: string) { const p = parts(d, tz) || parts(d, "UTC")!; return `${p.hour}:${p.minute}`; }
/** City name for a time zone: "Asia/Dubai" → "Dubai". */
export const city = (tz: string) => (tz.split("/").pop() || tz).replace(/_/g, " ");
