// iCalendar (.ics) output for the deadline subscription. Pure functions, unit-tested.
export type IcsEvent = { uid: string; date: string; summary: string; description?: string; url?: string };

const esc = (s: string) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines longer than 75 octets are folded with CRLF + space (RFC 5545 3.1). */
export function fold(line: string): string {
  const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
  const out: string[] = []; let cur = "";
  for (const ch of line) { if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; } cur += ch; }
  out.push(cur); return out.join("\r\n ");
}
const ymd = (d: string) => d.slice(0, 10).replace(/-/g, "");
const next = (d: string) => { const x = new Date(`${d.slice(0, 10)}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ""); };

export function ics(name: string, events: IcsEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AGRON Inc.//AGRON Workspace//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`, "X-WR-TIMEZONE:UTC", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${next(e.date)}`,
      `SUMMARY:${esc(e.summary)}`, ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []), ...(e.url ? [`URL:${e.url}`] : []), "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.summary)}`, "TRIGGER:-PT15H", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
