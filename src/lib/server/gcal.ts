import crypto from "node:crypto";
import { SITE } from "@/lib/mail";
import { calendarRecords, dropFromCalendar, eventDate, matchClient, openDeal, toEvent, type GEvent } from "@/lib/gcalmatch";

// Google Calendar two-way sync for each person who connects their calendar.
// Workspace → Google: planned client meetings and company meetings appear as all-day events.
// Google → Workspace: meetings with a client's people become "Meetings & calls" records linked to the client's open deal.
// Keys: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Vercel); the person's refresh token is stored encrypted.

export const gcalConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
const REDIRECT = () => `${SITE}/api/gcal/callback`;
const key = () => crypto.createHash("sha256").update("agron-gcal:" + (process.env.SUPABASE_SERVICE_ROLE_KEY || "")).digest();

export function seal(s: string) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", key(), iv); const b = Buffer.concat([c.update(s, "utf8"), c.final()]); return [iv, c.getAuthTag(), b].map((x) => x.toString("base64url")).join("."); }
export function unseal(s: string) { const [iv, tag, b] = s.split(".").map((x) => Buffer.from(x, "base64url")); const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(b), d.final()]).toString("utf8"); }
/** Signed state for the sign-in round trip: who started it and when (valid 15 minutes). */
export function stateFor(userId: string) { const p = `${userId}.${Date.now()}`; return `${p}.${crypto.createHmac("sha256", key()).update(p).digest("base64url")}`; }
export function stateUser(st: string) { try { const [u, t, sig] = st.split("."); const want = Buffer.from(crypto.createHmac("sha256", key()).update(`${u}.${t}`).digest("base64url")); const got = Buffer.from(sig || ""); const ok = got.length === want.length && crypto.timingSafeEqual(got, want); return ok && Date.now() - Number(t) < 15 * 60e3 ? u : null; } catch { return null; } }

export function authUrl(userId: string) {
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: REDIRECT(), response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true",
    scope: "openid email https://www.googleapis.com/auth/calendar.events", state: stateFor(userId) });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(body: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }) });
  const j: any = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error_description || j.error || `Google ${r.status}`); return j;
}
/** After the person agrees in Google: keep their refresh token (encrypted). */
export async function connect(db: any, userId: string, code: string) {
  const j = await token({ code, grant_type: "authorization_code", redirect_uri: REDIRECT() });
  if (!j.refresh_token) throw new Error("Google did not return a refresh token — remove AGRON from your Google account permissions and connect again");
  let email = ""; try { email = JSON.parse(Buffer.from(String(j.id_token).split(".")[1], "base64url").toString()).email || ""; } catch {}
  await db.from("gcal_links").upsert({ user_id: userId, google_email: email, refresh_enc: seal(j.refresh_token), calendar_id: "primary", sync_token: null, last_error: null, connected_at: new Date().toISOString() });
  return email;
}
export async function disconnect(db: any, userId: string) {
  const { data } = await db.from("gcal_links").select("refresh_enc").eq("user_id", userId).maybeSingle();
  if (data?.refresh_enc) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(data.refresh_enc))}`, { method: "POST" }).catch(() => {});
  await db.from("gcal_links").delete().eq("user_id", userId); await db.from("gcal_map").delete().eq("user_id", userId);
}

async function api(access: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { ...init, headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (r.status === 204 || r.status === 410) return null;
  const j: any = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error?.message || `Calendar ${r.status}`); return j;
}

/** One person's sync, both ways. */
export async function syncUser(db: any, userId: string) {
  const [{ data: link }, { data: me }] = await Promise.all([db.from("gcal_links").select("*").eq("user_id", userId).maybeSingle(), db.from("profiles").select("id,full_name,email,role,us_person").eq("id", userId).maybeSingle()]);
  if (!link || !me) return { ok: false, reason: "not connected" };
  try {
    const access = (await token({ refresh_token: unseal(link.refresh_enc), grant_type: "refresh_token" })).access_token as string;
    const cal = encodeURIComponent(link.calendar_id || "primary");
    // Records this person may see (the same rules as the database: section access and US-persons-only)
    const full = ["owner", "admin"].includes(me.role);
    const { data: rules } = full ? { data: [] as any[] } : await db.from("section_access").select("section").eq("role", me.role);
    const can = (s: string) => full || (rules || []).some((r: any) => r.section === s);
    const { data: recs } = await db.from("records").select("id,section,title,status,data,controlled,created_by").in("section", ["sales.activities", "company.meetings", "sales.clients", "sales.pipeline"]).limit(5000);
    const visible = (recs || []).filter((r: any) => can(r.section) && (!r.controlled || me.us_person));
    const { data: maps } = await db.from("gcal_map").select("record_id,event_id,origin").eq("user_id", userId);
    const byRec = new Map((maps || []).map((m: any) => [m.record_id, m])); const byEvent = new Map((maps || []).map((m: any) => [m.event_id, m]));
    let pushed = 0, pulled = 0, removed = 0;

    // 1) Workspace → Google
    for (const r of calendarRecords(visible, me)) {
      const m: any = byRec.get(r.id);
      if (dropFromCalendar(r)) { if (m) { await api(access, `calendars/${cal}/events/${encodeURIComponent(m.event_id)}`, { method: "DELETE" }).catch(() => {}); await db.from("gcal_map").delete().eq("user_id", userId).eq("record_id", r.id); removed++; } continue; }
      const ev = toEvent(r, SITE);
      if (m) { await api(access, `calendars/${cal}/events/${encodeURIComponent(m.event_id)}`, { method: "PATCH", body: JSON.stringify(ev) }).catch(() => null); }
      else { const created = await api(access, `calendars/${cal}/events`, { method: "POST", body: JSON.stringify(ev) }); if (created?.id) { await db.from("gcal_map").upsert({ user_id: userId, record_id: r.id, event_id: created.id, origin: "workspace" }); byEvent.set(created.id, { record_id: r.id, event_id: created.id, origin: "workspace" }); pushed++; } }
    }

    // 2) Google → Workspace: meetings with clients in the last 7 and next 60 days
    const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: "250", timeMin: new Date(Date.now() - 7 * 864e5).toISOString(), timeMax: new Date(Date.now() + 60 * 864e5).toISOString() });
    const list = await api(access, `calendars/${cal}/events?${q}`);
    const clients = visible.filter((r: any) => r.section === "sales.clients"); const deals = visible.filter((r: any) => r.section === "sales.pipeline");
    const canWrite = full || (await db.from("section_access").select("can_write").eq("role", me.role).eq("section", "sales.activities").maybeSingle()).data?.can_write;
    for (const e of (list?.items || []) as GEvent[]) {
      if (e.status === "cancelled") continue;
      const m: any = byEvent.get(e.id); const day = eventDate(e);
      if (m) { // a known meeting moved in Google → move the record too
        const rec: any = visible.find((r: any) => r.id === m.record_id);
        if (rec && day && String(rec.data?.date || "").slice(0, 10) !== day) await db.from("records").update({ data: { ...rec.data, date: day } }).eq("id", rec.id);
        continue;
      }
      if (!canWrite || !day) continue;
      const client = matchClient(e, clients as any); if (!client) continue;
      const deal: any = openDeal(deals as any, client as any);
      const { data: created } = await db.from("records").insert({ section: "sales.activities", title: (e.summary || client.title).slice(0, 200), status: day < new Date().toISOString().slice(0, 10) ? "Done" : "Planned",
        data: { client: client.title, deal_ref: deal?.id, type: e.hangoutLink || e.conferenceData ? "Video call" : "Meeting", date: day, owner: me.full_name || me.email, next_step: "" }, controlled: !!(client as any).controlled, created_by: userId }).select("id").single();
      if (created?.id) { await db.from("gcal_map").upsert({ user_id: userId, record_id: created.id, event_id: e.id, origin: "google" }); pulled++; }
    }
    await db.from("gcal_links").update({ last_sync: new Date().toISOString(), last_error: null }).eq("user_id", userId);
    return { ok: true, pushed, pulled, removed };
  } catch (e: any) {
    await db.from("gcal_links").update({ last_error: String(e?.message || e).slice(0, 300), last_sync: new Date().toISOString() }).eq("user_id", userId);
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** Scheduled: everyone who connected a calendar, within the time a request may run. */
export async function syncAll(db: any, ms = 45000) {
  if (!gcalConfigured()) return { skipped: "Google keys are not set" };
  const t0 = Date.now(); const { data } = await db.from("gcal_links").select("user_id").order("last_sync", { ascending: true, nullsFirst: true });
  const out: any[] = [];
  for (const l of data || []) { if (Date.now() - t0 > ms) break; out.push(await syncUser(db, l.user_id)); }
  return { users: out.length, pushed: out.reduce((a, x) => a + (x.pushed || 0), 0), pulled: out.reduce((a, x) => a + (x.pulled || 0), 0) };
}
