"use client";
import { allSections, defaultRules, ROLES } from "@/config/workspace.config.mjs";
import type * as DemoMod from "./demo";
import { SEED_FAQ, l2, loadLearnLang } from "@/config/learn";

export type Rec = {
  id: string; section: string; title: string; status: string | null; data: Record<string, any>;
  company: string | null; controlled: boolean; created_by?: string | null; created_at?: string; updated_at?: string;
};
export type Profile = { id: string; email: string; full_name: string; role: string; company: string | null; us_person: boolean; lang: string; ai_monthly_tokens: number; title?: string | null; phone?: string | null; created_at?: string; super?: boolean };
export type Rule = { section: string; role: string; can_write: boolean; external: boolean };
export type FileItem = { name: string; path: string; size: number; type: string; created_at?: string };
export const BUCKET = "files";
export type Faq = { id: string; question: string; answer: string; lang: string; section: string | null; verified: boolean; hits: number; source?: string; created_by?: string | null; created_at?: string; sim?: number };
export type Comment = { id: string; record_id: string; author: string | null; body: string; created_at: string };
export type Activity = { id: number; record_id: string | null; section: string; actor: string | null; action: string; detail: any; created_at: string };
export type Access = { read: Set<string>; write: Set<string> };

import { DEMO, SUPA_KEY, SUPA_URL, sb } from "./sb";
export { DEMO, SUPA_KEY, SUPA_URL, sb };

const INTERNAL_ROLES = Object.entries(ROLES).filter(([, r]: any) => r.internal).map(([k]) => k);
export const isExternal = (role: string) => !INTERNAL_ROLES.includes(role);

/** Access computed from the rules table (the same rules the database enforces). */
export function accessFor(role: string, rules?: Rule[] | null): Access {
  const read = new Set<string>(), write = new Set<string>();
  if (role === "owner" || role === "admin") { for (const s of allSections() as any[]) { read.add(s.id); write.add(s.id); } return { read, write }; }
  for (const r of rules || (defaultRules() as Rule[])) {
    if (r.role !== role) continue;
    read.add(r.section);
    if (r.can_write && !isExternal(role)) write.add(r.section);
  }
  return { read, write };
}

/* ---------------- Demo store (browser only; its data loads only in demo mode) ---------------- */
let demo: typeof DemoMod | null = null;
export async function ensureDemo() { if (DEMO && !demo) demo = await import("./demo"); }
const DKEY = "agronws.demo.v1";
type DemoDB = { records: Rec[]; comments: Comment[]; activity: Activity[]; role: string; profiles: Profile[]; rules?: Rule[]; files?: (FileItem & { data: string })[]; faq?: Faq[] };
function demoLoad(): DemoDB {
  try { const s = localStorage.getItem(DKEY); if (s) return JSON.parse(s); } catch {}
  if (!demo) throw new Error("Demo data not loaded");
  const db: DemoDB = { records: demo.demoSeed(), comments: [], activity: [], role: "owner", profiles: demo.DEMO_PEOPLE };
  demoSave(db); return db;
}
function demoSave(db: DemoDB) { try { localStorage.setItem(DKEY, JSON.stringify(db)); } catch {} }
const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
function demoMe(db: DemoDB): Profile {
  const p = db.profiles.find((x) => x.role === db.role) || db.profiles[0];
  return { ...p, role: db.role };
}
function demoVisible(db: DemoDB, r: Rec) {
  const me = demoMe(db); const acc = accessFor(me.role, db.rules);
  if (!acc.read.has(r.section)) return false;
  if (r.controlled && !me.us_person) return false;
  if (isExternal(me.role) && !(r.company === "*" || (r.company && r.company === me.company))) return false;
  return true;
}

function demoFaq(db: DemoDB): Faq[] {
  if (!db.faq) { db.faq = SEED_FAQ.flatMap((f, i) => (["en", "ru", "uk", "ar"] as const).map((l) => ({ id: `faq-${i}-${l}`, question: l2(f.q, l), answer: l2(f.a, l), lang: l, section: f.section || null, verified: true, hits: 0, source: "seed" }))); demoSave(db); }
  return db.faq;
}
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
export function textSim(a: string, b: string) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((w) => { if ([...B].some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))) n++; }); return n / Math.max(A.size, B.size); }

/** Tells the automation rules about a new record or a status change (in the background; never blocks saving). */
function automate(ev: { id: string; kind: "created" | "status"; from?: string | null }) {
  try { fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "event", ...ev }), keepalive: true }).catch(() => {}); } catch {}
}

/* ---------------- Public API ---------------- */
export const store = {
  async me(): Promise<Profile | null> {
    if (DEMO) { await ensureDemo(); return demoMe(demoLoad()); }
    const { data: u } = await sb().auth.getUser();
    if (!u?.user) return null;
    const { data } = await sb().from("profiles").select("*").eq("id", u.user.id).single();
    return data as Profile;
  },
  demoRole(): string { return DEMO ? demoLoad().role : ""; },
  setDemoRole(role: string) { const db = demoLoad(); db.role = role; demoSave(db); },
  resetDemo() { try { localStorage.removeItem(DKEY); } catch {} },

  async list(section: string): Promise<Rec[]> {
    if (DEMO) { const db = demoLoad(); return db.records.filter((r) => r.section === section && demoVisible(db, r)).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")); }
    const { data, error } = await sb().from("records").select("*").eq("section", section).order("updated_at", { ascending: false }).limit(2000);
    if (error) throw error; return (data || []) as Rec[];
  },
  async listMany(sections: string[]): Promise<Rec[]> {
    if (DEMO) { const db = demoLoad(); return db.records.filter((r) => sections.includes(r.section) && demoVisible(db, r)); }
    const { data } = await sb().from("records").select("*").in("section", sections).limit(3000);
    return (data || []) as Rec[];
  },
  async save(r: Partial<Rec> & { section: string; title: string }): Promise<Rec> {
    const now = new Date().toISOString();
    if (DEMO) {
      const db = demoLoad(); const me = demoMe(db);
      if (r.id) {
        const i = db.records.findIndex((x) => x.id === r.id); const old = db.records[i];
        db.records[i] = { ...old, ...r, updated_at: now } as Rec;
        db.activity.unshift({ id: Date.now(), record_id: r.id, section: r.section, actor: me.id, action: old.status !== r.status ? "status" : "updated", detail: { title: r.title, from: old.status, to: r.status }, created_at: now });
        demoSave(db); return db.records[i];
      }
      const rec = { id: uid(), data: {}, company: null, controlled: false, status: null, ...r, created_by: me.id, created_at: now, updated_at: now } as Rec;
      db.records.push(rec); db.activity.unshift({ id: Date.now(), record_id: rec.id, section: rec.section, actor: me.id, action: "created", detail: { title: rec.title, status: rec.status }, created_at: now });
      demoSave(db); return rec;
    }
    const body: any = { section: r.section, title: r.title, status: r.status ?? null, data: r.data || {}, company: r.company || null, controlled: !!r.controlled };
    if (r.id) {
      const { data: before } = await sb().from("records").select("status").eq("id", r.id).maybeSingle();
      const { data, error } = await sb().from("records").update(body).eq("id", r.id).select().single();
      if (error) throw error;
      if ((before?.status || "") !== (data.status || "")) automate({ id: data.id, kind: "status", from: before?.status ?? null });
      return data as Rec;
    }
    const { data: u } = await sb().auth.getUser();
    const { data, error } = await sb().from("records").insert({ ...body, created_by: u?.user?.id }).select().single();
    if (error) throw error; automate({ id: data.id, kind: "created" }); return data as Rec;
  },
  async remove(id: string) {
    if (DEMO) { const db = demoLoad(); const r = db.records.find((x) => x.id === id); db.records = db.records.filter((x) => x.id !== id); if (r) db.activity.unshift({ id: Date.now(), record_id: id, section: r.section, actor: demoMe(db).id, action: "deleted", detail: { title: r.title }, created_at: new Date().toISOString() }); demoSave(db); return; }
    const { error } = await sb().from("records").delete().eq("id", id); if (error) throw error;
  },
  async comments(recordId: string): Promise<Comment[]> {
    if (DEMO) return demoLoad().comments.filter((c) => c.record_id === recordId);
    const { data } = await sb().from("comments").select("*").eq("record_id", recordId).order("created_at"); return (data || []) as Comment[];
  },
  async addComment(recordId: string, body: string) {
    if (DEMO) { const db = demoLoad(); db.comments.push({ id: uid(), record_id: recordId, author: demoMe(db).id, body, created_at: new Date().toISOString() }); demoSave(db); return; }
    const { data: u } = await sb().auth.getUser();
    const { error } = await sb().from("comments").insert({ record_id: recordId, body, author: u?.user?.id }); if (error) throw error;
  },
  async activity(opts: { recordId?: string; limit?: number; log?: boolean } = {}): Promise<Activity[]> {
    if (DEMO) { const db = demoLoad(); const acc = accessFor(demoMe(db).role, db.rules); return db.activity.filter((a) => (!opts.recordId || a.record_id === opts.recordId) && acc.read.has(a.section)).slice(0, opts.limit || 20); }
    let q = sb().from("activity").select("*").order("created_at", { ascending: false }).limit(opts.limit || 20);
    if (opts.recordId) q = q.eq("record_id", opts.recordId);
    q = opts.log ? q.eq("section", "security.log") : q.neq("section", "security.log"); // the access log is shown only on the Security overview
    const { data } = await q; return (data || []) as Activity[];
  },
  /** Comments that mention a person with @Name (last 30 days). */
  async mentions(name: string): Promise<(Comment & { section?: string; title?: string })[]> {
    const first = (name || "").trim().split(/\s+/)[0]; if (first.length < 2) return [];
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    if (DEMO) { const db = demoLoad(); return db.comments.filter((c) => c.body.toLowerCase().includes("@" + first.toLowerCase()) && c.created_at >= since).map((c) => { const r = db.records.find((x) => x.id === c.record_id); return { ...c, section: r?.section, title: r?.title }; }); }
    const { data } = await sb().from("comments").select("*, records(section,title)").ilike("body", `%@${first}%`).gte("created_at", since).order("created_at", { ascending: false }).limit(30);
    return (data || []).map((c: any) => ({ ...c, section: c.records?.section, title: c.records?.title }));
  },
  /** Server-side search across every record the user may see (titles and field values). */
  async searchRecords(q: string, n = 25): Promise<Rec[]> {
    if (!q.trim()) return [];
    if (DEMO) { const db = demoLoad(); const s = q.toLowerCase(); return db.records.filter((r) => demoVisible(db, r) && (r.title + " " + JSON.stringify(r.data)).toLowerCase().includes(s)).slice(0, n); }
    const { data, error } = await sb().rpc("search_records", { q, n });
    if (!error) return (data || []) as Rec[];
    const { data: d2 } = await sb().from("records").select("*").ilike("title", `%${q}%`).limit(n); return (d2 || []) as Rec[];
  },
  async profiles(): Promise<Profile[]> {
    if (DEMO) return demoLoad().profiles;
    const { data } = await sb().from("profiles").select("*").order("created_at"); return (data || []) as Profile[];
  },
  async updateProfile(id: string, patch: Partial<Profile>) {
    if (DEMO) { const db = demoLoad(); db.profiles = db.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)); demoSave(db); return; }
    const { error } = await sb().from("profiles").update(patch).eq("id", id); if (error) throw error;
  },
  async signOut() { if (!DEMO) await sb().auth.signOut(); },

  /* ----- Access rules (editable by owner/admin in Users & roles) ----- */
  async rules(): Promise<Rule[]> {
    if (DEMO) return demoLoad().rules || (defaultRules() as Rule[]);
    const { data, error } = await sb().from("section_access").select("section,role,can_write,external");
    if (error || !data?.length) return defaultRules() as Rule[];
    return data as Rule[];
  },
  async setRule(section: string, role: string, level: "none" | "read" | "write") {
    const external = isExternal(role);
    if (DEMO) {
      const db = demoLoad(); const rules = (db.rules || (defaultRules() as Rule[])).filter((r) => !(r.section === section && r.role === role));
      if (level !== "none") rules.push({ section, role, can_write: level === "write" && !external, external });
      db.rules = rules; demoSave(db); return;
    }
    if (level === "none") { const { error } = await sb().from("section_access").delete().eq("section", section).eq("role", role); if (error) throw error; return; }
    const { error } = await sb().from("section_access").upsert({ section, role, can_write: level === "write" && !external, external });
    if (error) throw error;
  },
  async resetRules() {
    const rows = defaultRules() as Rule[];
    if (DEMO) { const db = demoLoad(); db.rules = rows; demoSave(db); return; }
    const { error: e1 } = await sb().from("section_access").delete().neq("section", ""); if (e1) throw e1;
    const { error } = await sb().from("section_access").insert(rows); if (error) throw error;
  },

  /* ----- Files (Supabase Storage, private bucket; path = section/recordId/file) ----- */
  async files(prefix: string): Promise<FileItem[]> {
    if (DEMO) return (demoLoad().files || []).filter((f) => f.path.startsWith(prefix + "/")).map(({ data, ...f }) => f);
    const { data, error } = await sb().storage.from(BUCKET).list(prefix, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw error;
    return (data || []).filter((o: any) => o.id).map((o: any) => ({ name: o.name.replace(/^\d+_/, ""), path: `${prefix}/${o.name}`, size: o.metadata?.size || 0, type: o.metadata?.mimetype || "", created_at: o.created_at }));
  },
  async upload(prefix: string, file: File): Promise<FileItem> {
    const safe = file.name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${prefix}/${Date.now()}_${safe}`;
    if (DEMO) {
      if (file.size > 2_000_000) throw new Error("Demo mode keeps files up to 2 MB in this browser.");
      const data: string = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file); });
      const db = demoLoad(); const item = { name: file.name, path, size: file.size, type: file.type, created_at: new Date().toISOString(), data };
      db.files = [item, ...(db.files || [])]; demoSave(db); const { data: _, ...f } = item; return f;
    }
    const { error } = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw error;
    return { name: file.name, path, size: file.size, type: file.type };
  },
  /** Temporary link. Default 1 hour; share links last up to 7 days. */
  async fileUrl(path: string, seconds = 3600, download?: string): Promise<string> {
    if (DEMO) return (demoLoad().files || []).find((f) => f.path === path)?.data || "";
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, seconds, download ? { download } : undefined);
    if (error) throw error; return data.signedUrl;
  },
  async removeFile(path: string) {
    if (DEMO) { const db = demoLoad(); db.files = (db.files || []).filter((f) => f.path !== path); demoSave(db); return; }
    const { error } = await sb().storage.from(BUCKET).remove([path]); if (error) throw error;
  },
  /* ----- FAQ knowledge base ----- */
  async faqSearch(q: string, lang?: string, n = 5): Promise<Faq[]> {
    if (DEMO) await loadLearnLang("uk");
    if (!q.trim()) return [];
    if (DEMO) return demoFaq(demoLoad()).filter((f) => !lang || f.lang === lang).map((f) => ({ ...f, sim: textSim(q, f.question) })).filter((f) => f.sim! > 0.3).sort((a, b) => b.sim! - a.sim!).slice(0, n);
    const { data, error } = await sb().rpc("faq_search", { q, lng: lang || null, n });
    if (error) return []; return (data || []) as Faq[];
  },
  async faqList(): Promise<Faq[]> {
    await loadLearnLang("uk"); // the starter answers are written in all four languages
    if (DEMO) return demoFaq(demoLoad());
    const get = async () => (await sb().from("faq").select("*").order("verified", { ascending: false }).order("hits", { ascending: false }).limit(500)).data || [];
    let rows = await get();
    // Starter answers: loaded on first run and topped up when new ones ship (insert is allowed for owner, admin, management, legal)
    const have = new Set(rows.map((r: any) => `${r.lang}|${r.question}`));
    const seed = SEED_FAQ.flatMap((f) => (["en", "ru", "uk", "ar"] as const).map((l) => ({ question: l2(f.q, l), answer: l2(f.a, l), lang: l, section: f.section || null, verified: true, source: "seed" })))
      .filter((x) => !have.has(`${x.lang}|${x.question}`));
    if (seed.length) { const { error } = await sb().from("faq").insert(seed); if (!error) rows = await get(); }
    return rows as Faq[];
  },
  async faqSave(f: Partial<Faq> & { question: string; answer: string; lang: string }) {
    if (DEMO) await loadLearnLang("uk");
    if (DEMO) { const db = demoLoad(); const list = demoFaq(db); if (f.id) db.faq = list.map((x) => (x.id === f.id ? { ...x, ...f } as Faq : x)); else db.faq = [{ id: uid(), section: null, verified: false, hits: 0, source: "manual", ...f } as Faq, ...list]; demoSave(db); return; }
    const body: any = { question: f.question, answer: f.answer, lang: f.lang, section: f.section ?? null, source: f.source || "manual" };
    if (f.verified !== undefined) body.verified = f.verified;
    const { error } = f.id ? await sb().from("faq").update({ ...body, updated_at: new Date().toISOString() }).eq("id", f.id) : await sb().from("faq").insert(body);
    if (error) throw error;
  },
  async faqDelete(id: string) {
    if (DEMO) await loadLearnLang("uk");
    if (DEMO) { const db = demoLoad(); db.faq = demoFaq(db).filter((x) => x.id !== id); demoSave(db); return; }
    const { error } = await sb().from("faq").delete().eq("id", id); if (error) throw error;
  },
  async faqHit(id: string) {
    if (DEMO) await loadLearnLang("uk");
    if (DEMO) { const db = demoLoad(); db.faq = demoFaq(db).map((x) => (x.id === id ? { ...x, hits: x.hits + 1 } : x)); demoSave(db); return; }
    await sb().rpc("faq_hit", { fid: id });
  },
  async firstImage(prefix: string): Promise<string> {
    try { const fs = await this.files(prefix); const img = fs.find((f) => f.type.startsWith("image/")); return img ? await this.fileUrl(img.path) : ""; } catch { return ""; }
  },
};
