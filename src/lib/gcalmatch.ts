// Google Calendar ⇄ Workspace: pure rules (which records go to the calendar, which calendar meetings
// belong to which client), kept apart from the network code so they can be tested.

export type GEvent = { id: string; status?: string; summary?: string; description?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; attendees?: { email?: string; self?: boolean; organizer?: boolean }[]; hangoutLink?: string; conferenceData?: any; updated?: string; location?: string };
type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };

/** Records that belong in a person's calendar: their planned client meetings and company meetings
 *  (organizer or participant by account; older meetings by the name typed in). */
export function calendarRecords(recs: R[], me: { id?: string; full_name?: string | null; email: string }) {
  const name = (me.full_name || "").toLowerCase().trim(); const first = name.split(/\s+/)[0]; const mail = me.email.toLowerCase();
  const mine = (v: any) => { const s = String(v || "").toLowerCase(); return !!s && ((!!name && s.includes(name)) || (!!first && first.length > 2 && s.split(/[\s,;]+/).includes(first)) || s.includes(mail)); };
  const byId = (r: R) => !!me.id && (r.data?.organizer_id === me.id || (Array.isArray(r.data?.participants_ids) && r.data.participants_ids.includes(me.id)));
  return recs.filter((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r.data?.date || "")) && (
    (r.section === "sales.activities" && mine(r.data?.owner)) ||
    (r.section === "company.meetings" && (byId(r) || mine(r.data?.owner) || mine(r.data?.organizer) || mine(r.data?.participants)))));
}

const validZone = (z: any) => { try { if (!z) return false; new Intl.DateTimeFormat("en-US", { timeZone: String(z) }); return true; } catch { return false; } };
const addMinutes = (date: string, time: string, min: number) => { const [h, m] = time.split(":").map(Number); const t = h * 60 + m + min; const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + Math.floor(t / 1440)); const r = ((t % 1440) + 1440) % 1440; return `${d.toISOString().slice(0, 10)}T${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}:00`; };

/** The calendar event for a record: a timed event in the meeting's own time zone when a time is set, otherwise all-day. */
export function toEvent(r: R, site: string) {
  const d = String(r.data.date).slice(0, 10); const next = new Date(d + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const url = `${site}/${r.section.replace(".", "/")}?r=${r.id}`;
  const lines = [r.section === "sales.activities" ? [r.data.type, r.data.client].filter(Boolean).join(" · ") : r.data.participants ? `Participants: ${r.data.participants}` : "",
    r.data.meet_url ? `Call: ${r.data.meet_url}` : "", r.data.agenda ? `Agenda: ${String(r.data.agenda).slice(0, 1500)}` : "", r.data.next_step ? `Next step: ${r.data.next_step}` : "", `AGRON Workspace: ${url}`].filter(Boolean);
  const time = String(r.data.time || ""); const timed = /^\d{1,2}:\d{2}$/.test(time);
  const tz = validZone(r.data.timezone) ? String(r.data.timezone) : "UTC";
  const dur = Math.max(5, Math.min(24 * 60, Number(r.data.duration) || 60));
  const hhmm = timed ? time.padStart(5, "0") : "";
  return { summary: r.title, description: lines.join("\n"), ...(r.data.place || r.data.meet_url ? { location: String(r.data.place || r.data.meet_url) } : {}),
    start: timed ? { dateTime: `${d}T${hhmm}:00`, timeZone: tz } : { date: d }, end: timed ? { dateTime: addMinutes(d, hhmm, dur), timeZone: tz } : { date: next.toISOString().slice(0, 10) },
    source: { title: "AGRON Workspace", url } };
}
/** Cancelled or finished-and-dropped records leave the calendar. */
export const dropFromCalendar = (r: R) => /^(cancelled)$/i.test(r.status || "");

export const eventDate = (e: GEvent) => (e.start?.date || e.start?.dateTime || "").slice(0, 10);
const emails = (s: string) => (s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map((x) => x.toLowerCase());
const domainOf = (m: string) => m.split("@")[1] || "";
const FREE = /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|me|live|proton|protonmail|mail|yandex|aol)\./;

/** Which client a calendar meeting is with: by attendee e-mail, by company e-mail domain, or by the client's name in the title. */
export function matchClient(e: GEvent, clients: R[], ownDomain = "agron1.com") {
  const att = (e.attendees || []).filter((a) => a.email && !a.self).map((a) => a.email!.toLowerCase()).filter((m) => domainOf(m) !== ownDomain);
  const text = `${e.summary || ""} ${e.description || ""}`.toLowerCase();
  for (const c of clients) {
    const known = emails(JSON.stringify(c.data || {}));
    if (att.some((m) => known.includes(m))) return c;
    const doms = known.map(domainOf).filter((d) => d && !FREE.test(d) && d !== ownDomain);
    if (att.some((m) => doms.includes(domainOf(m)))) return c;
  }
  if (!att.length) return null; // only meetings with outside people become client meetings
  for (const c of clients) { const n = c.title.toLowerCase().replace(/\(sample\)/, "").trim(); if (n.length >= 4 && text.includes(n)) return c; }
  return null;
}

/** The open deal of a client (most recent first). */
export function openDeal(deals: R[], client: R) {
  const n = client.title.toLowerCase();
  return deals.filter((d) => !["Won", "Lost"].includes(d.status || "") && (d.data?.client_ref === client.id || String(d.data?.client || "").toLowerCase() === n))[0] || null;
}
