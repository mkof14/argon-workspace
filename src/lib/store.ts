"use client";
import { createBrowserClient } from "@supabase/ssr";
import { allSections, ROLES } from "@/config/workspace.config.mjs";
import { demoSeed, DEMO_PEOPLE } from "./demo";

export type Rec = {
  id: string; section: string; title: string; status: string | null; data: Record<string, any>;
  company: string | null; controlled: boolean; created_by?: string | null; created_at?: string; updated_at?: string;
};
export type Profile = { id: string; email: string; full_name: string; role: string; company: string | null; us_person: boolean; lang: string; ai_monthly_tokens: number };
export type Comment = { id: string; record_id: string; author: string | null; body: string; created_at: string };
export type Activity = { id: number; record_id: string | null; section: string; actor: string | null; action: string; detail: any; created_at: string };
export type Access = { read: Set<string>; write: Set<string> };

export const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const DEMO = !SUPA_URL || !SUPA_KEY;

let _sb: ReturnType<typeof createBrowserClient> | null = null;
export const sb = () => (_sb ||= createBrowserClient(SUPA_URL, SUPA_KEY));

const INTERNAL_ROLES = Object.entries(ROLES).filter(([, r]: any) => r.internal).map(([k]) => k);
export const isExternal = (role: string) => !INTERNAL_ROLES.includes(role);

/** Access computed from the same config that generates the database rules. */
export function accessFor(role: string): Access {
  const read = new Set<string>(), write = new Set<string>();
  for (const s of allSections() as any[]) {
    if (role === "owner" || role === "admin") { read.add(s.id); write.add(s.id); continue; }
    if (s.read.includes(role) || s.write.includes(role) || s.external.includes(role)) read.add(s.id);
    if (s.write.includes(role)) write.add(s.id);
  }
  return { read, write };
}

/* ---------------- Demo store (browser only) ---------------- */
const DKEY = "agronws.demo.v1";
type DemoDB = { records: Rec[]; comments: Comment[]; activity: Activity[]; role: string; profiles: Profile[] };
function demoLoad(): DemoDB {
  try { const s = localStorage.getItem(DKEY); if (s) return JSON.parse(s); } catch {}
  const db: DemoDB = { records: demoSeed(), comments: [], activity: [], role: "owner", profiles: DEMO_PEOPLE };
  demoSave(db); return db;
}
function demoSave(db: DemoDB) { try { localStorage.setItem(DKEY, JSON.stringify(db)); } catch {} }
const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
function demoMe(db: DemoDB): Profile {
  const p = db.profiles.find((x) => x.role === db.role) || db.profiles[0];
  return { ...p, role: db.role };
}
function demoVisible(db: DemoDB, r: Rec) {
  const me = demoMe(db); const acc = accessFor(me.role);
  if (!acc.read.has(r.section)) return false;
  if (r.controlled && !me.us_person) return false;
  if (isExternal(me.role) && !(r.company === "*" || (r.company && r.company === me.company))) return false;
  return true;
}

/* ---------------- Public API ---------------- */
export const store = {
  async me(): Promise<Profile | null> {
    if (DEMO) return demoMe(demoLoad());
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
      const { data, error } = await sb().from("records").update(body).eq("id", r.id).select().single();
      if (error) throw error; return data as Rec;
    }
    const { data: u } = await sb().auth.getUser();
    const { data, error } = await sb().from("records").insert({ ...body, created_by: u?.user?.id }).select().single();
    if (error) throw error; return data as Rec;
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
  async activity(opts: { recordId?: string; limit?: number } = {}): Promise<Activity[]> {
    if (DEMO) { const db = demoLoad(); const acc = accessFor(demoMe(db).role); return db.activity.filter((a) => (!opts.recordId || a.record_id === opts.recordId) && acc.read.has(a.section)).slice(0, opts.limit || 20); }
    let q = sb().from("activity").select("*").order("created_at", { ascending: false }).limit(opts.limit || 20);
    if (opts.recordId) q = q.eq("record_id", opts.recordId);
    const { data } = await q; return (data || []) as Activity[];
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
};
