"use client";
import { allSections, defaultRules, ROLES, ORG_DEPTS } from "@/config/workspace.config.mjs";
import type * as DemoMod from "./demo";
import { l2, loadLearnLang } from "@/config/l2";
// The starter FAQ (part of the Learning Center texts) is loaded only when the FAQ is opened
let SEED: any[] | null = null;
const seedFaq = async () => (SEED ||= (await import("@/config/learn")).SEED_FAQ);
import { localizeRec, unlocalize, type Shown } from "./tr";
import { nextOccurrence } from "./recur";
import { milestoneReady } from "./milestones";
import { serviceDone } from "./service";
import { poStamps } from "./vendors";
import { changeOrderEffects } from "./margin";
import { ConflictError, enqueueSave, isConflict, isNetworkError, isTemp, remap, type OutItem } from "./outboxlogic";
import { merge3 } from "./merge";
import { PEOPLE_KEYS } from "./insights";
export { ConflictError, isConflict };
import { offline, readQ, writeQ } from "./outbox";
/** Lists loaded in this session (memory only, never stored on the device) — shown when the connection drops. */
const MEM = new Map<string, Rec[]>();
let FLUSHING = false;
import { SHIP_GUARD, shipMissing, shipMsg, type Missing } from "./shipgate";
import { DEFAULT_LIMITS, LIMITED, limitRoles, overLimit, withLimits, type Limits } from "@/config/approvals";
let LIM: Promise<Limits> | null = null;
/** Spending above the self-approval limit needs an approved request first (any way of saving: form, board, bulk, AI command). */
const SPEND_ERR = "The amount is above the self-approval limit — send the record for approval first.";
const CONFLICT_MSG = { en: "Someone changed this record after you opened it", ru: "Запись изменили после того, как вы её открыли", uk: "Запис змінили після того, як ви його відкрили", ar: "غيّر شخص هذا السجل بعد أن فتحته" };

export type Rec = {
  id: string; section: string; title: string; status: string | null; data: Record<string, any>;
  company: string | null; controlled: boolean; created_by?: string | null; created_at?: string; updated_at?: string; version?: number;
};
export type Profile = { id: string; email: string; full_name: string; role: string; company: string | null; us_person: boolean; lang: string; ai_monthly_tokens: number; title?: string | null; phone?: string | null; department?: string | null; manager_id?: string | null; notify_prefs?: Record<string, any>; disabled?: boolean; sessions_revoked_at?: string | null; created_at?: string; super?: boolean; timezone?: string | null; prefs?: Record<string, any> };
export type Rule = { section: string; role: string; can_write: boolean; external: boolean };
export type FileItem = { name: string; path: string; size: number; type: string; created_at?: string };
export const BUCKET = "files";
export type Faq = { id: string; question: string; answer: string; lang: string; section: string | null; verified: boolean; hits: number; source?: string; created_by?: string | null; created_at?: string; sim?: number };
export type Comment = { id: string; record_id: string; author: string | null; body: string; created_at: string;
  parent_id?: string | null; edited_at?: string | null; deleted_at?: string | null; kind?: "message" | "review" | "approval" | "system"; internal?: boolean; mentions?: string[];
  mention_names?: { id: string; name: string }[]; flag?: "important" | "decision" | "announcement" | null; flagged_by?: string | null; pinned_at?: string | null;
  file_path?: string | null; version_label?: string | null; refs?: string[]; files?: { path: string; name?: string; size?: number; type?: string }[] };
export type CommentDraft = { parent_id?: string | null; kind?: "message" | "review"; internal?: boolean; file_path?: string | null; version_label?: string | null; refs?: string[]; files?: { path: string; name?: string; size?: number; type?: string }[] };
const ORG_DEPTS_FALLBACK = (): Department[] => (ORG_DEPTS as any[]).map((d) => ({ id: d.key, code: d.key.slice(0, 3).toUpperCase(), key: d.key, name: d.label.en, label: d.label, manager_id: null, active: true, description: null }));
export type DocRow = { id: string; doc_number?: string; title: string; doc_type?: string; project_ref?: string; project?: string; department?: string; owner_id?: string; owner?: string; version?: string; approved_version?: string; status?: string; classification?: string; controlled?: boolean; updated_at: string; approval: string };
export type DocVersion = { id: string; record_id: string; label: string; major: number; minor: number; path: string; file_name: string; size: number; mime?: string; sha256: string; author?: string; created_at: string; change_note?: string; review_state: string; approval_state: string; approved_by?: string; approved_at?: string; effective_date?: string; superseded_at?: string; verified_at?: string; verified_ok?: boolean };
export type CorpHit = { kind: string; id: string; record_id: string | null; section: string | null; title: string; excerpt: string; project_ref: string | null; version: string | null; owner_id: string | null; updated_at: string | null; link: string; rank: number };
export type CalItem = { kind: string; record_id: string; title: string; day: string; at_time: string | null; tz: string | null; status: string | null; project_ref: string | null; link: string; meta: any };
export type Department = { id: string; code: string; key: string; name: string; label: Record<string, string>; manager_id: string | null; active: boolean; description: string | null };
export type Taxon = { kind: string; code: string; label: Record<string, string>; sort: number; active: boolean; meta: Record<string, any> };
export type MessageHit = { id: string; record_id: string; section: string; title: string; project_ref: string | null; author: string | null; created_at: string; excerpt: string; flag: string | null; kind: string };
export type Activity = { id: number; record_id: string | null; section: string; actor: string | null; action: string; detail: any; created_at: string };
export type Access = { read: Set<string>; write: Set<string> };
export type Notice = { id: number; kind: string; record_id: string | null; section: string | null; title: string | null; body: string | null; actor: string | null; link: string | null; created_at: string; read_at: string | null; critical?: boolean };

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
const DKEY = "agronws.demo.v2"; // v2: Phase 2 sample projects, tasks, documents and meetings
export type TrashItem = { id: string; section: string; title: string; controlled: boolean; deleted_by: string | null; deleted_at: string; comments: number };
type DemoDB = { trash?: (TrashItem & { record: Rec; cmts: Comment[] })[]; records: Rec[]; comments: Comment[]; activity: Activity[]; role: string; profiles: Profile[]; rules?: Rule[]; files?: (FileItem & { data: string })[]; faq?: Faq[] };
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
  if (!db.faq) { db.faq = (SEED || []).flatMap((f, i) => (["en", "ru", "uk", "ar"] as const).map((l) => ({ id: `faq-${i}-${l}`, question: l2(f.q, l), answer: l2(f.a, l), lang: l, section: f.section || null, verified: true, hits: 0, source: "seed" }))); demoSave(db); }
  return db.faq;
}
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
export function textSim(a: string, b: string) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((w) => { if ([...B].some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))) n++; }); return n / Math.max(A.size, B.size); }

/** Tells the automation rules about a new record or a status change (in the background; never blocks saving). */
function automate(ev: { id: string; kind: "created" | "status"; from?: string | null }) {
  try { fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "event", ...ev }), keepalive: true }).catch(() => {}); } catch {}
}

/* ---------------- Automatic translation ---------------- */
// Records are shown in the reader's language; what they did not change is saved back in its original wording.
let LANG = "en";
const SHOWN = new Map<string, { o: Shown; l: Shown }>();
function loc<T extends Rec>(r: T): T {
  if (!r?.data?._tr) return r;
  const x = localizeRec(r, LANG); if (!x) return r;
  SHOWN.set(r.id, { o: x._o, l: x._l }); return x as unknown as T;
}
/** Asks the server to translate a record's new texts (in the background; never blocks saving). */
function translateLater(body: Record<string, string>) {
  if (DEMO) return;
  try { fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch {}
}

/* ---------------- People named in records are linked to their accounts ---------------- */
let PEOPLE: Profile[] = [];
const EXTERNAL_ROLES = ["partner", "vendor", "investor", "pending"];
const findPerson = (v: string) => { const x = v.trim().toLowerCase(); return x ? PEOPLE.find((p) => !EXTERNAL_ROLES.includes(p.role) && !p.disabled && (p.email?.toLowerCase() === x || (p.full_name || "").trim().toLowerCase() === x)) : undefined; };
/** A name or email typed into a person field becomes a link to that account (<key>_id); several names → <key>_ids. */
export function linkPeople(data: Record<string, any>): Record<string, any> {
  if (!PEOPLE.length || !data) return data;
  const out = { ...data };
  for (const k of [...PEOPLE_KEYS, "approver"]) {
    if (typeof out[k] !== "string" || !out[k].trim() || out[`${k}_id`]) continue;
    const p = findPerson(out[k]); if (p) out[`${k}_id`] = p.id;
  }
  for (const k of ["members", "watchers"]) {
    if (typeof out[k] !== "string" || Array.isArray(out[`${k}_ids`])) continue;
    const ids = out[k].split(/[,;\n]/).map((x: string) => findPerson(x)?.id).filter(Boolean); if (ids.length) out[`${k}_ids`] = [...new Set(ids)];
  }
  return out;
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
  setLang(l: string) { LANG = l || "en"; },
  setPeople(p: Profile[]) { PEOPLE = p || []; },
  lang() { return LANG; },
  /** The record exactly as written (no translation). */
  original<T extends Rec>(r: T): T { const m = (r as any)._o || SHOWN.get(r.id)?.o; return m ? { ...r, title: m.title, data: m.data, _o: undefined, _l: undefined } : r; },
  demoRole(): string { return DEMO ? demoLoad().role : ""; },
  setDemoRole(role: string) { const db = demoLoad(); db.role = role; demoSave(db); },
  resetDemo() { try { localStorage.removeItem(DKEY); } catch {} },

  async list(section: string): Promise<Rec[]> {
    if (DEMO) { const db = demoLoad(); return db.records.filter((r) => r.section === section && demoVisible(db, r)).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).map(loc); }
    try {
      if (offline()) throw new TypeError("Failed to fetch");
      const { data, error } = await sb().from("records").select("*").eq("section", section).order("updated_at", { ascending: false }).limit(2000);
      if (error) throw error; const out = ((data || []) as Rec[]).map(loc); MEM.set(section, out); return out;
    } catch (e) { if (!isNetworkError(e)) throw e; return this.withPending([section], MEM.get(section) || []); }
  },
  async listMany(sections: string[]): Promise<Rec[]> {
    if (DEMO) { const db = demoLoad(); return db.records.filter((r) => sections.includes(r.section) && demoVisible(db, r)).map(loc); }
    try {
      if (offline()) throw new TypeError("Failed to fetch");
      // each section on its own, newest first, so a large section (10,000 documents) can never crowd a new project or
      // task out of one shared, unordered limit; six requests at a time
      const parts: Rec[][] = []; const todo = [...new Set(sections)];
      for (let i = 0; i < todo.length; i += 6) parts.push(...(await Promise.all(todo.slice(i, i + 6).map(async (s) => {
        const { data, error } = await sb().from("records").select("*").eq("section", s).order("updated_at", { ascending: false }).limit(2000); if (error) throw error;
        const rows = ((data || []) as Rec[]).map(loc); MEM.set(s, rows); return rows;
      }))));
      return parts.flat();
    } catch (e) { if (!isNetworkError(e)) throw e; return this.withPending(sections, sections.flatMap((s) => MEM.get(s) || [])); }
  },
  /** The record as it would be written: texts shown translated and left untouched go back to their original wording. */
  toOriginal<T extends Record<string, any>>(r0: T): T {
    const meta = (r0 as any)._o ? { o: (r0 as any)._o as Shown, l: (r0 as any)._l as Shown } : r0.id ? SHOWN.get(r0.id) : undefined;
    const { _o, _l, _src, _base, ...clean } = r0 as any;
    const back = meta ? unlocalize(clean.title, clean.data || {}, meta.o, meta.l) : null;
    return (back ? { ...clean, title: back.title, data: back.data } : clean) as T;
  },
  async save(r0: Partial<Rec> & { section: string; title: string }): Promise<Rec> {
    const now = new Date().toISOString();
    // Texts shown translated and left untouched keep their original wording
    const meta = (r0 as any)._o ? { o: (r0 as any)._o as Shown, l: (r0 as any)._l as Shown } : r0.id ? SHOWN.get(r0.id) : undefined;
    const { _o, _l, _src, ...clean } = r0 as any;
    const back = meta ? unlocalize(clean.title, clean.data || {}, meta.o, meta.l) : null;
    const r: Partial<Rec> & { section: string; title: string } = back ? { ...clean, title: back.title, data: back.data } : clean;
    if (r.data) r.data = linkPeople(r.data);
    if (DEMO) {
      const db = demoLoad(); const me = demoMe(db);
      if (r.id ? db.records.find((x) => x.id === r.id)?.status !== r.status : true) { const m = await this.shipCheck(r.section, r.status, r.data || {}); if (m.length) throw new Error(shipMsg(m, "en")); }
      if (r.id) {
        const i = db.records.findIndex((x) => x.id === r.id); const old = db.records[i];
        db.records[i] = { ...old, ...r, updated_at: now } as Rec;
        db.activity.unshift({ id: Date.now(), record_id: r.id, section: r.section, actor: me.id, action: old.status !== r.status ? "status" : "updated", detail: { title: r.title, from: old.status, to: r.status }, created_at: now });
        // Support SLA stamps (on the live site the server does this)
        if (r.section === "operations.support" && old.status !== r.status) { const d = db.records[i].data = { ...db.records[i].data }; if (!d.responded_at && old.status === "New") d.responded_at = now; if (!d.resolved_at && /^(resolved|closed)$/i.test(r.status || "")) d.resolved_at = now; }
        { const d = poStamps(old.status, db.records[i], now.slice(0, 10)); if (d) db.records[i].data = d; }
        // Change order signed → payments (on the live site the server does this)
        if (old.status !== r.status) { const e = changeOrderEffects(db.records[i], db.records, now.slice(0, 10)); if (e) { db.records[i].data = e.co; if (e.create) db.records.push({ id: uid(), company: null, controlled: old.controlled, created_by: me.id, created_at: now, updated_at: now, ...e.create } as Rec); if (e.update) { const k = db.records.findIndex((x) => x.id === e.update!.id); if (k >= 0) db.records[k] = { ...db.records[k], data: e.update.data, updated_at: now }; } } }
        // Planned service done → the unit's next service moves forward
        if (old.status !== r.status) { const u = db.records.find((x) => x.id === db.records[i].data?.unit_ref); const ch = serviceDone(db.records[i], u, now.slice(0, 10)); if (ch && u) Object.assign(u, { status: ch.status, data: ch.data, updated_at: now }); }
        // Acceptance closed → milestone invoices ready (on the live site the server does this)
        if (old.status !== r.status) for (const c of milestoneReady(db.records[i], db.records, now.slice(0, 10))) { const k = db.records.findIndex((x) => x.id === c.id); if (k >= 0) db.records[k] = { ...db.records[k], data: c.data, updated_at: now }; }
        // Repeating record completed → the next one (on the live site the server does this)
        const sec: any = (allSections() as any[]).find((x) => x.id === r.section);
        if (old.status !== r.status && sec && !db.records.some((x) => x.data?._prev === r.id)) { const n = nextOccurrence(db.records[i], sec.fields, sec.statuses[0]); if (n) db.records.push({ id: uid(), company: old.company, controlled: old.controlled, ...n, section: r.section, created_by: me.id, created_at: now, updated_at: now } as Rec); }
        demoSave(db); return db.records[i];
      }
      const rec = { id: uid(), data: {}, company: null, controlled: false, status: null, ...r, created_by: me.id, created_at: now, updated_at: now } as Rec;
      db.records.push(rec); db.activity.unshift({ id: Date.now(), record_id: rec.id, section: rec.section, actor: me.id, action: "created", detail: { title: rec.title, status: rec.status }, created_at: now });
      demoSave(db); return rec;
    }
    const body: any = { section: r.section, title: r.title, status: r.status ?? null, data: r.data || {}, company: r.company || null, controlled: !!r.controlled };
    const ver = typeof r.version === "number" ? r.version : undefined;
    // No connection: keep the change on the device and send it later (never export-controlled records)
    if ((offline() || isTemp(r.id)) && !FLUSHING) { if (r.controlled) throw new Error("No connection — US-persons-only records are not kept on the device; save again when online."); return this.queueSave({ ...body, id: r.id, version: ver }, (r0 as any)._base); }
    try { return await this.saveLive(r, body); }
    catch (e) { if (!FLUSHING && isNetworkError(e) && !r.controlled) return this.queueSave({ ...body, id: r.id, version: ver }, (r0 as any)._base); throw e; }
  },
  async saveLive(r: Partial<Rec> & { section: string; title: string }, body: any): Promise<Rec> {
    if (r.id) {
      const { data: before } = await sb().from("records").select("status").eq("id", r.id).maybeSingle();
      if ((before?.status || "") !== (body.status || "") && (await this.spendCheck(r.section, r.id, body.status, body.data))) throw new Error(SPEND_ERR);
      if ((before?.status || "") !== (body.status || "")) { const m = await this.shipCheck(r.section, body.status, body.data); if (m.length) throw new Error(shipMsg(m, "en")); }
      // Saved only if nobody saved it after it was opened (version check); otherwise the person sees both versions
      let q = sb().from("records").update(body).eq("id", r.id);
      if (typeof r.version === "number") q = q.eq("version", r.version);
      const { data, error } = await q.select().maybeSingle();
      if (error) throw error;
      if (!data) {
        const { data: cur } = await sb().from("records").select("*").eq("id", r.id).maybeSingle();
        if (cur && typeof r.version === "number" && cur.version !== r.version) throw new ConflictError(cur, CONFLICT_MSG[LANG as keyof typeof CONFLICT_MSG] || CONFLICT_MSG.en);
        throw new Error(cur ? "Not saved: you cannot change this record" : "Not saved: the record was deleted");
      }
      if ((before?.status || "") !== (data.status || "")) automate({ id: data.id, kind: "status", from: before?.status ?? null });
      SHOWN.delete(data.id); translateLater({ id: data.id });
      return loc(data as Rec);
    }
    if (await this.spendCheck(r.section, undefined, body.status, body.data)) throw new Error(SPEND_ERR);
    { const m = await this.shipCheck(r.section, body.status, body.data); if (m.length) throw new Error(shipMsg(m, "en")); }
    const { data: u } = await sb().auth.getUser();
    const { data, error } = await sb().from("records").insert({ ...body, created_by: u?.user?.id }).select().single();
    if (error) throw error; automate({ id: data.id, kind: "created" }); translateLater({ id: data.id }); return data as Rec;
  },
  async remove(id: string) {
    if (DEMO) { const db = demoLoad(); const r = db.records.find((x) => x.id === id); db.records = db.records.filter((x) => x.id !== id);
      if (r) { const cmts = db.comments.filter((c) => c.record_id === id); db.comments = db.comments.filter((c) => c.record_id !== id); db.trash = [{ id, section: r.section, title: r.title, controlled: r.controlled, deleted_by: demoMe(db).id, deleted_at: new Date().toISOString(), comments: cmts.length, record: r, cmts }, ...(db.trash || [])]; } if (r) db.activity.unshift({ id: Date.now(), record_id: id, section: r.section, actor: demoMe(db).id, action: "deleted", detail: { title: r.title }, created_at: new Date().toISOString() }); demoSave(db); return; }
    const { error } = await sb().from("records").delete().eq("id", id); if (error) throw error;
  },
  /* ----- Offline outbox: changes wait on the device and go out in order when the connection is back ----- */
  async me0() { try { const { data } = await sb().auth.getSession(); return data.session?.user?.id || ""; } catch { return ""; } },
  async queue(x: any) { const q = await readQ(); await writeQ([...q, { ...x, id: `q-${uid()}`, at: new Date().toISOString(), user: await this.me0() } as OutItem]); },
  async queueSave(rec: Record<string, any>, base?: Record<string, any> | null): Promise<Rec> {
    const now = new Date().toISOString(); const { q, id } = enqueueSave(await readQ(), rec, now, await this.me0(), uid, base); await writeQ(q);
    return { company: null, controlled: false, ...rec, id, data: rec.data || {}, status: rec.status ?? null, updated_at: now, created_at: now, _offline: true } as any;
  },
  /** Lists shown offline: what was loaded in this session plus what waits in the outbox. */
  async withPending(sections: string[], base: Rec[]): Promise<Rec[]> {
    const q = await readQ(); const out = [...base];
    for (const x of q) if (x.kind === "save" && sections.includes(x.rec.section)) { const i = out.findIndex((r) => r.id === x.rec.id); const r = { ...(i >= 0 ? out[i] : {}), ...x.rec, _offline: true } as any; if (i >= 0) out[i] = r; else out.unshift(r); }
    return out;
  },
  async outboxCount() { return (await readQ()).filter((x) => !x.error).length; },
  async outboxFailed() { return (await readQ()).filter((x) => x.error); },
  async dropOutboxItem(id: string) { await writeQ((await readQ()).filter((x) => x.id !== id)); },
  /** A waiting change that met a newer server copy: the person keeps their version on purpose (it is saved over the newer one). */
  async keepMine(id: string) { const q = await readQ(); await writeQ(q.map((x) => (x.id === id && x.kind === "save" && x.conflict ? { ...x, error: undefined, conflict: undefined, base: null, rec: { ...x.rec, version: x.conflict.theirs.version } } as OutItem : x))); window.dispatchEvent(new Event("agron-outbox")); },
  /** Sends the waiting changes in order; stops at the first connection error. Returns how many were sent. */
  async flushOutbox(): Promise<number> {
    if (DEMO || FLUSHING || offline()) return 0;
    const me = await this.me0(); if (!me) return 0;
    FLUSHING = true; let sent = 0;
    try {
      let q = await readQ();
      for (const x0 of [...q]) {
        const x = q.find((y) => y.id === x0.id); if (!x || x.error || x.user !== me) continue;
        try {
          if (x.kind === "save") {
            const { id, ...rest } = x.rec as any;
            let saved: Rec;
            try { saved = await this.save(isTemp(id) ? rest : { ...rest, id }); }
            catch (e: any) {
              if (!isConflict(e) || !x.base) throw e;
              // someone saved the record while this change waited: fields only one side changed merge by themselves
              const m = merge3(x.base, x.rec, e.theirs);
              if (m.conflicts.length) { q = q.map((y) => (y.id === x.id ? { ...y, error: CONFLICT_MSG[LANG as keyof typeof CONFLICT_MSG] || CONFLICT_MSG.en, conflict: { theirs: e.theirs, fields: m.conflicts.map((c) => c.field) } } as OutItem : y)); await writeQ(q); continue; }
              saved = await this.save({ ...rest, ...m.merged, id, section: x.rec.section, version: e.theirs.version } as any);
            }
            if (isTemp(id)) q = remap(q, id, saved.id);
          }
          else if (x.kind === "comment") await this.addComment(x.record_id, x.body, { internal: (x as any).internal });
          else await this.upload(x.prefix, new File([x.file], x.name, { type: x.type }));
          q = q.filter((y) => y.id !== x.id); sent++; await writeQ(q);
        } catch (e: any) {
          if (isNetworkError(e)) break;
          q = q.map((y) => (y.id === x.id ? { ...y, error: String(e?.message || e).slice(0, 300) } : y)); await writeQ(q);
        }
      }
    } finally { FLUSHING = false; }
    return sent;
  },
  /* ----- Spending limits: above the self-approval amount a record needs an approved request ----- */
  async limits(): Promise<Limits> {
    if (DEMO) return DEFAULT_LIMITS;
    if (!LIM) LIM = fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "limits" }) }).then((r) => (r.ok ? r.json() : DEFAULT_LIMITS)).then(withLimits).catch(() => DEFAULT_LIMITS);
    return LIM;
  },
  /** null when the change is allowed; otherwise the reason (English key for the caller to show). */
  async spendCheck(section: string, id: string | undefined, status: string | null | undefined, data: Record<string, any>): Promise<null | { roles: string[] }> {
    const l = LIMITED[section]; if (!l || !status || !l.guard.includes(status)) return null;
    const lim = await this.limits(); if (!overLimit(section, data, lim)) return null;
    if (id && !DEMO) { const { data: a } = await sb().from("approvals").select("status").eq("record_id", id).eq("status", "approved").limit(1); if (a?.length) return null; }
    return { roles: limitRoles(section, data, lim) || [] };
  },
  /** Shipping needs export check, screening of the deal and the end-user certificate ([] = allowed). */
  async shipCheck(section: string, status: string | null | undefined, data: Record<string, any>): Promise<Missing[]> {
    if (!status || !SHIP_GUARD[section]?.includes(status)) return [];
    const get = async (ids: string[]) => !ids.length ? [] : DEMO ? demoLoad().records.filter((x) => ids.includes(x.id)) : ((await sb().from("records").select("id,section,status,data").in("id", ids)).data || []) as Rec[];
    const build = section === "operations.builds" ? null : (await get([data?.build_ref].filter(Boolean)))[0] || null;
    const b = section === "operations.builds" ? data : build?.data;
    const deal = b?.deal_ref, scr = b?.screening_ref;
    const screenings = DEMO ? demoLoad().records.filter((x) => x.section === "security.screening" && ((deal && x.data?.deal_ref === deal) || x.id === scr))
      : deal || scr ? (((await sb().from("records").select("id,section,status,data").eq("section", "security.screening").or([deal ? `data->>deal_ref.eq.${deal}` : "", scr ? `id.eq.${scr}` : ""].filter(Boolean).join(","))).data || []) as Rec[]) : [];
    return shipMissing(section, status, data, build, screenings);
  },
  /* ----- Recycle bin: deleted records stay 30 days ----- */
  async trashList(): Promise<TrashItem[]> {
    if (DEMO) return (demoLoad().trash || []).map(({ record, cmts, ...x }) => x);
    const r = await fetch("/api/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) });
    if (!r.ok) throw new Error(await r.text()); return r.json();
  },
  async trashAct(action: "restore" | "purge", id: string) {
    if (DEMO) { const db = demoLoad(); const x = (db.trash || []).find((t) => t.id === id); if (!x) return; db.trash = db.trash!.filter((t) => t.id !== id); if (action === "restore") { db.records.push(x.record); db.comments.push(...x.cmts); } demoSave(db); return; }
    const r = await fetch("/api/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
    if (!r.ok) throw new Error(await r.text());
  },
  async comments(recordId: string): Promise<Comment[]> {
    if (DEMO) return demoLoad().comments.filter((c) => c.record_id === recordId);
    const { data } = await sb().from("comments").select("*").eq("record_id", recordId).order("created_at"); return (data || []) as Comment[];
  },
  async addComment(recordId: string, body: string, o: CommentDraft = {}) {
    const internal = !!o.internal;
    const extra = Object.fromEntries(Object.entries({ parent_id: o.parent_id, kind: o.kind, file_path: o.file_path, version_label: o.version_label, refs: o.refs?.length ? o.refs : undefined, files: o.files?.length ? o.files : undefined }).filter(([, v]) => v != null));
    if (DEMO) { const db = demoLoad(); const mentions = [...body.matchAll(/@\[[^\]]{1,120}\]\(([0-9a-fA-F-]{36})\)/g)].map((m) => m[1]); const par = db.comments.find((c) => c.id === o.parent_id) as any; db.comments.push({ id: uid(), record_id: recordId, author: demoMe(db).id, body, created_at: new Date().toISOString(), internal, mentions, kind: "message", ...extra, ...(par?.parent_id ? { parent_id: par.parent_id } : {}) } as any); demoSave(db); return; }
    if ((offline() || isTemp(recordId)) && !FLUSHING) { await this.queue({ kind: "comment", record_id: recordId, body, internal }); return; }
    const { data: u } = await sb().auth.getUser();
    const { error } = await sb().from("comments").insert({ record_id: recordId, body, author: u?.user?.id, ...(internal ? { internal } : {}), ...extra }); if (error) { if (!FLUSHING && isNetworkError(error)) { await this.queue({ kind: "comment", record_id: recordId, body, internal }); return; } throw error; }
    translateLater({ id: recordId });
    if (/@\p{L}/u.test(body)) try { fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mention", record_id: recordId }), keepalive: true }).catch(() => {}); } catch {}
  },
  /** Edit my own message (the earlier text is kept as evidence by the database). */
  async editComment(id: string, body: string) {
    if (DEMO) { const db = demoLoad(); const c: any = db.comments.find((x) => x.id === id); if (c) { c.body = body; c.edited_at = new Date().toISOString(); demoSave(db); } return; }
    const { error } = await sb().from("comments").update({ body }).eq("id", id); if (error) throw error;
  },
  /** Withdraw my own message: the text leaves the discussion, the history keeps it. */
  async withdrawComment(id: string) {
    if (DEMO) { const db = demoLoad(); const c: any = db.comments.find((x) => x.id === id); if (c) { c.body = ""; c.deleted_at = new Date().toISOString(); demoSave(db); } return; }
    const { error } = await sb().from("comments").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error;
  },
  /** Important / Decision / Announcement mark (project manager or management; a Decision goes into the decision log). */
  async flagComment(id: string, flag: "important" | "decision" | "announcement" | null): Promise<{ flag: string | null; decision: string | null }> {
    if (DEMO) { const db = demoLoad(); const c: any = db.comments.find((x) => x.id === id); if (c) { c.flag = flag; demoSave(db); } return { flag, decision: null }; }
    const { data, error } = await sb().rpc("comment_flag", { p_comment: id, p_flag: flag }); if (error) throw error; return data as any;
  },
  async pinComment(id: string, on: boolean) {
    if (DEMO) { const db = demoLoad(); const c: any = db.comments.find((x) => x.id === id); if (c) { c.pinned_at = on ? new Date().toISOString() : null; demoSave(db); } return; }
    const { error } = await sb().rpc("comment_pin", { p_comment: id, p_on: on }); if (error) throw error;
  },
  /** People I may mention on this record — the database decides (partners see only the people working on it). */
  async mentionCandidates(recordId: string, q = "", internal = false): Promise<{ id: string; name: string; department: string | null; role: string }[]> {
    if (DEMO || isTemp(recordId)) { const db = demoLoad(); return db.profiles.filter((p) => p.id !== demoMe(db).id && (p.full_name || p.email).toLowerCase().includes(q.toLowerCase())).slice(0, 8).map((p) => ({ id: p.id, name: p.full_name || p.email, department: (p as any).department || null, role: p.role })); }
    const { data, error } = await sb().rpc("mention_candidates", { p_record: recordId, p_q: q, p_internal: internal }); if (error) return []; return (data || []) as any;
  },
  /** Search in the discussions I may read (same rules as opening them). */
  async searchMessages(q: string, f: { project?: string; author?: string; from?: string; to?: string; kind?: string; mentions?: boolean; decisions?: boolean } = {}, n = 30): Promise<MessageHit[]> {
    if (DEMO) { const db = demoLoad(); const s = q.toLowerCase(); return db.comments.filter((c: any) => !c.deleted_at && c.body.toLowerCase().includes(s) && (!f.decisions || c.flag === "decision")).slice(0, n).map((c: any) => { const r = db.records.find((x) => x.id === c.record_id); return r && demoVisible(db, r) ? { id: c.id, record_id: c.record_id, section: r.section, title: r.title, project_ref: r.section === "company.projects" ? r.id : r.data?.project_ref || null, author: c.author, created_at: c.created_at, excerpt: c.body.slice(0, 220), flag: c.flag || null, kind: c.kind || "message" } : null; }).filter(Boolean) as MessageHit[]; }
    const { data, error } = await sb().rpc("search_messages", { p_q: q, p_project: f.project || null, p_author: f.author || null, p_from: f.from || null, p_to: f.to || null, p_kind: f.kind || null, p_mentions_me: !!f.mentions, p_decisions: !!f.decisions, p_limit: n });
    if (error) throw error; return (data || []) as MessageHit[];
  },
  /** A new version of a document is stored: tell its owner, the project manager and pending approvers. */
  async documentVersion(recordId: string, path: string, label?: string) {
    if (DEMO || isTemp(recordId)) return 0;
    const { data, error } = await sb().rpc("document_version_uploaded", { p_record: recordId, p_path: path, p_label: label || null }); if (error) throw error; return data as number;
  },
  /** An action item of a meeting becomes a task — once, however often it is clicked. */
  async meetingActionToTask(meetingId: string, itemId: string): Promise<string> {
    if (DEMO) { const db = demoLoad(); const m = db.records.find((r) => r.id === meetingId)!; const it = (m.data?.action_items || []).find((x: any) => x.id === itemId); if (it?.task_id) return it.task_id; const id = uid(); db.records.push({ id, section: "company.tasks", title: it?.title || "Action item", status: "New", data: { assignee_id: it?.assignee_id, due: it?.due, description: it?.description, project_ref: m.data?.project_ref, meeting_ref: m.id, meeting_ref_title: m.title }, controlled: m.controlled, company: null, created_by: demoMe(db).id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any); it.task_id = id; demoSave(db); return id; }
    const { data, error } = await sb().rpc("meeting_action_to_task", { p_meeting: meetingId, p_item: itemId }); if (error) throw error; return data as string;
  },
  /** Write a decision into the decision log from a meeting or another record (the same text is recorded once). */
  async recordDecision(sourceId: string, text: string): Promise<string | null> {
    if (DEMO) return null;
    const { data, error } = await sb().rpc("record_decision", { p_source: sourceId, p_text: text }); if (error) throw error; return data as string;
  },
  async announcementAck(id: string): Promise<number> {
    if (DEMO) { const db = demoLoad(); (db as any).acks = { ...((db as any).acks || {}), [id]: 1 }; demoSave(db); return 1; }
    const { data, error } = await sb().rpc("announcement_ack", { p_id: id }); if (error) throw error; return data as number;
  },
  /** My acknowledgements: announcement → versions acknowledged. */
  async myAcks(): Promise<Record<string, number[]>> {
    if (DEMO) { const a = (demoLoad() as any).acks || {}; return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, [v as number]])); }
    const { data } = await sb().from("announcement_acks").select("announcement_id,version").limit(5000);
    const out: Record<string, number[]> = {}; for (const x of (data || []) as any[]) (out[x.announcement_id] ||= []).push(x.version); return out;
  },
  async announcementStats(id: string): Promise<{ version: number; audience: number; read: number; acknowledged: number; outstanding: { id: string; name: string }[] } | null> {
    if (DEMO) return null;
    const { data, error } = await sb().rpc("announcement_stats", { p_id: id }); if (error) return null; return data as any;
  },
  /** Delivery problems for administrators (no message content). */
  async communicationIssues(days = 14): Promise<any> {
    if (DEMO) return { notifications: [], outbound: [], jobs: [], calendar: [], announcements: [], totals: {} };
    const { data, error } = await sb().rpc("communication_issues", { p_days: days }); if (error) throw error; return data;
  },
  /** Mark a discussion unread again (from a message on). */
  async markUnread(recordId: string, before: string) {
    if (DEMO || isTemp(recordId)) return;
    const { data: u } = await sb().auth.getUser(); if (!u?.user) return;
    await sb().from("record_reads").upsert({ user_id: u.user.id, record_id: recordId, read_at: new Date(Date.parse(before) - 1000).toISOString() });
  },
  async readAt(recordId: string): Promise<string | null> {
    if (DEMO || isTemp(recordId)) return null;
    const { data } = await sb().from("record_reads").select("read_at").eq("record_id", recordId).maybeSingle(); return (data as any)?.read_at || null;
  },
  /* ----- Phase 4: documents, versions, knowledge, departments, calendar, decisions ----- */
  async documentCenter(f: { view?: string; q?: string; project?: string; department?: string; owner?: string; type?: string; status?: string; approval?: string; classification?: string; from?: string; to?: string; version?: string; sort?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; rows: DocRow[] }> {
    if (DEMO) { const db = demoLoad(); const rows = db.records.filter((r) => r.section === "company.documents" && demoVisible(db, r) && (!f.q || r.title.toLowerCase().includes(f.q.toLowerCase()))).map((r) => ({ id: r.id, doc_number: r.data?.doc_number, title: r.title, doc_type: r.data?.doc_type, project_ref: r.data?.project_ref, project: r.data?.project_ref_title, department: r.data?.department, owner_id: r.data?.owner_id, owner: r.data?.owner, version: r.data?.version, approved_version: r.data?.approved_version, status: r.status, classification: r.data?.classification || "Internal", controlled: r.controlled, updated_at: r.updated_at, approval: "none" } as DocRow)); return { total: rows.length, rows }; }
    const { data, error } = await sb().rpc("document_center", { p_view: f.view || "all", p_q: f.q || null, p_project: f.project || null, p_department: f.department || null, p_owner: f.owner || null, p_type: f.type || null, p_status: f.status || null,
      p_approval: f.approval || null, p_classification: f.classification || null, p_from: f.from || null, p_to: f.to || null, p_version: f.version || null, p_sort: f.sort || "updated", p_limit: f.limit || 50, p_offset: f.offset || 0 });
    if (error) throw error; return (data || { total: 0, rows: [] }) as any;
  },
  async versions(recordId: string): Promise<DocVersion[]> {
    if (DEMO || isTemp(recordId)) return [];
    const { data } = await sb().from("document_versions").select("*").eq("record_id", recordId).order("major", { ascending: false }).order("minor", { ascending: false }); return (data || []) as DocVersion[];
  },
  /** Upload a file as the next version (the server stores it, hashes it and registers it). */
  async uploadVersion(recordId: string, file: File, o: { label?: string; major?: boolean; note?: string } = {}): Promise<DocVersion> {
    const fd = new FormData(); fd.set("record_id", recordId); fd.set("file", file); if (o.label) fd.set("label", o.label); if (o.major) fd.set("major", "true"); if (o.note) fd.set("note", o.note);
    const r = await fetch("/api/documents", { method: "POST", body: fd }); if (!r.ok) throw new Error(await r.text()); return (await r.json()).version;
  },
  /** A 2-minute link to a version (access checked and logged on the server). */
  async openVersion(a: { version_id?: string; path?: string }, mode: "download" | "preview" = "download"): Promise<{ url: string; name: string }> {
    const r = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", mode, ...a }) }); if (!r.ok) throw new Error(await r.text()); return r.json();
  },
  async verifyVersion(versionId: string): Promise<{ ok: boolean; expected: string; found: string; label: string }> {
    const r = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", version_id: versionId }) }); if (!r.ok) throw new Error(await r.text()); return r.json();
  },
  async reviewDocument(recordId: string, decision: "reviewed" | "changes_requested", note?: string) {
    const { error } = await sb().rpc("document_review", { p_record: recordId, p_decision: decision, p_note: note || null }); if (error) throw error;
  },
  async docAccessLog(recordId: string): Promise<any[]> {
    if (DEMO) return [];
    const { data } = await sb().from("document_access_log").select("*").eq("record_id", recordId).order("at", { ascending: false }).limit(100); return data || [];
  },
  async corpSearch(q: string, f: { types?: string[]; project?: string; department?: string; person?: string; doc_type?: string; from?: string; to?: string; classification?: string; status?: string } = {}, n = 40): Promise<CorpHit[]> {
    if (DEMO) { const db = demoLoad(); const s = q.toLowerCase(); return db.records.filter((r) => demoVisible(db, r) && r.title.toLowerCase().includes(s)).slice(0, n).map((r) => ({ kind: r.section === "company.documents" ? "document" : r.section === "company.wiki" ? "knowledge" : "record", id: r.id, record_id: r.id, section: r.section, title: r.title, excerpt: String(r.data?.description || r.data?.summary || ""), project_ref: r.data?.project_ref || null, version: r.data?.version || null, owner_id: r.data?.owner_id || null, updated_at: r.updated_at, link: r.section === "company.documents" ? `/documents?d=${r.id}` : `/${r.section.replace(".", "/")}?r=${r.id}`, rank: 1 })); }
    const { data, error } = await sb().rpc("corp_search", { p_q: q, p_types: f.types?.length ? f.types : null, p_project: f.project || null, p_department: f.department || null, p_person: f.person || null, p_doc_type: f.doc_type || null,
      p_from: f.from || null, p_to: f.to || null, p_classification: f.classification || null, p_status: f.status || null, p_limit: n });
    if (error) throw error; return (data || []) as CorpHit[];
  },
  async calendarItems(from: string, to: string, scope: "mine" | "all" = "mine"): Promise<CalItem[]> {
    if (DEMO) return [];
    const { data, error } = await sb().rpc("calendar_items", { p_from: from, p_to: to, p_scope: scope }); if (error) throw error; return (data || []) as CalItem[];
  },
  async decisionLog(f: { q?: string; project?: string; status?: string } = {}): Promise<any[]> {
    if (DEMO) return demoLoad().records.filter((r) => r.section === "company.decisions").map((r) => ({ id: r.id, title: r.title, decision: r.data?.decision, date: r.data?.date, status: r.status, number: r.data?.doc_number }));
    const { data, error } = await sb().rpc("decision_log", { p_q: f.q || null, p_project: f.project || null, p_status: f.status || null, p_limit: 300 }); if (error) throw error; return (data || []) as any[];
  },
  async approveMinutes(meetingId: string) { const { error } = await sb().rpc("meeting_minutes_approve", { p_meeting: meetingId }); if (error) throw error; },
  async departments(): Promise<Department[]> {
    if (DEMO) return ORG_DEPTS_FALLBACK();
    const { data } = await sb().from("departments").select("*").order("name"); return (data || []) as Department[];
  },
  async saveDepartment(d: Partial<Department>) {
    const row = { name: d.name, code: d.code, label: d.label || {}, manager_id: d.manager_id || null, active: d.active ?? true, description: d.description || null };
    const q = d.id ? sb().from("departments").update(row).eq("id", d.id) : sb().from("departments").insert(row);
    const { error } = await q; if (error) throw error;
  },
  async taxonomy(kind?: string): Promise<Taxon[]> {
    if (DEMO) return [];
    let q = sb().from("taxonomy").select("*").order("sort"); if (kind) q = q.eq("kind", kind); const { data } = await q; return (data || []) as Taxon[];
  },
  async saveTaxon(t: Taxon) { const { error } = await sb().from("taxonomy").upsert({ kind: t.kind, code: t.code, label: t.label, sort: t.sort, active: t.active, meta: t.meta, updated_at: new Date().toISOString() }); if (error) throw error; },
  async numberFormats(): Promise<any[]> { if (DEMO) return []; const { data } = await sb().from("doc_number_formats").select("*").order("scope"); return data || []; },
  async saveNumberFormat(f: any) {
    const row = { scope: f.scope || "document", doc_type: f.doc_type || null, department_key: f.department_key || null, project_id: f.project_id || null, company: f.company || "AGR", pattern: f.pattern, active: f.active ?? true, updated_at: new Date().toISOString() };
    const { error } = f.id ? await sb().from("doc_number_formats").update(row).eq("id", f.id) : await sb().from("doc_number_formats").insert(row); if (error) throw error;
  },
  /** Recent discussions I can see (comments on records I may read), newest first. */
  async discussions(n = 400): Promise<(Comment & { section?: string; title?: string; internal?: boolean; mentions?: string[] })[]> {
    if (DEMO) { const db = demoLoad(); return db.comments.slice(-n).reverse().map((c) => { const r = db.records.find((x) => x.id === c.record_id); return { ...c, section: r?.section, title: r?.title }; }).filter((c) => c.section && demoVisible(db, db.records.find((x) => x.id === c.record_id)!)); }
    const { data } = await sb().from("comments").select("*, records(section,title)").is("deleted_at", null).order("created_at", { ascending: false }).limit(n);
    return (data || []).filter((c: any) => c.records).map((c: any) => ({ ...c, section: c.records?.section, title: c.records?.title }));
  },
  /** Marks a record's discussion as read by me (Messages shows what is new since). */
  async markRead(recordId: string) {
    if (DEMO || isTemp(recordId) || offline()) return;
    const { data: u } = await sb().auth.getUser(); if (!u?.user) return;
    await sb().from("record_reads").upsert({ user_id: u.user.id, record_id: recordId, read_at: new Date().toISOString() });
  },
  async reads(): Promise<Record<string, string>> {
    if (DEMO) return {};
    const { data } = await sb().from("record_reads").select("record_id,read_at").limit(5000);
    return Object.fromEntries((data || []).map((x: any) => [x.record_id, x.read_at]));
  },
  /** My notifications, newest first (the database only returns mine, and only for records I can still open). */
  async notifications(n = 100): Promise<Notice[]> {
    if (DEMO) return [];
    const { data, error } = await sb().from("notifications").select("id,kind,record_id,section,title,body,actor,link,created_at,read_at,critical").order("created_at", { ascending: false }).limit(n);
    if (error) return []; return (data || []) as Notice[];
  },
  async markNotices(ids: number[] | "all") {
    if (DEMO) return;
    let q = sb().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (ids !== "all") { if (!ids.length) return; q = q.in("id", ids); }
    const { error } = await q; if (error) throw error;
  },
  async activity(opts: { recordId?: string; limit?: number; log?: boolean; since?: string } = {}): Promise<Activity[]> {
    if (DEMO) { const db = demoLoad(); const acc = accessFor(demoMe(db).role, db.rules); return db.activity.filter((a) => (!opts.recordId || a.record_id === opts.recordId) && (!opts.since || a.created_at > opts.since) && acc.read.has(a.section)).slice(0, opts.limit || 20); }
    let q = sb().from("activity").select("*").order("created_at", { ascending: false }).limit(opts.limit || 20);
    if (opts.since) q = q.gt("created_at", opts.since);
    if (opts.recordId) q = q.eq("record_id", opts.recordId);
    q = opts.log ? q.eq("section", "security.log") : q.neq("section", "security.log"); // the access log is shown only on the Security overview
    const { data } = await q; return (data || []) as Activity[];
  },
  /** History of several records at once (a project with its tasks, milestones and documents). */
  async activityFor(ids: string[], limit = 80): Promise<Activity[]> {
    const u = [...new Set(ids)].filter((x) => !isTemp(x)).slice(0, 300); if (!u.length) return [];
    if (DEMO) return demoLoad().activity.filter((a) => a.record_id && u.includes(a.record_id)).slice(0, limit);
    const { data } = await sb().from("activity").select("*").in("record_id", u).order("created_at", { ascending: false }).limit(limit); return (data || []) as Activity[];
  },
  /** Status changes of deals (for sales analytics). */
  async dealHistory(): Promise<{ record_id: string | null; action: string; detail: any; created_at: string }[]> {
    if (DEMO) return demoLoad().activity.filter((a) => a.section === "sales.pipeline" && a.action === "status");
    const { data } = await sb().from("activity").select("record_id,action,detail,created_at").eq("section", "sales.pipeline").eq("action", "status").order("created_at").limit(5000);
    return (data || []) as any;
  },
  /** Which of these records the person may open now (US-persons-only and deleted ones drop out). */
  async visibleIds(ids: string[]): Promise<Set<string>> {
    const u = [...new Set(ids)].slice(0, 300); if (!u.length) return new Set();
    if (DEMO) { const db = demoLoad(); return new Set(db.records.filter((r) => u.includes(r.id) && demoVisible(db, r)).map((r) => r.id)); }
    const { data } = await sb().from("records").select("id").in("id", u); return new Set((data || []).map((r: any) => r.id));
  },
  /** New comments by other people since a moment (for "What changed since your last visit"). */
  async commentsSince(since: string, notBy: string): Promise<(Comment & { section?: string; title?: string })[]> {
    if (DEMO) { const db = demoLoad(); return db.comments.filter((c) => c.created_at > since && c.author !== notBy).map((c) => { const r = db.records.find((x) => x.id === c.record_id); return { ...c, section: r?.section, title: r?.title }; }).filter((c) => c.section); }
    const { data } = await sb().from("comments").select("*, records(section,title)").gt("created_at", since).neq("author", notBy).order("created_at", { ascending: false }).limit(40);
    return (data || []).map((c: any) => ({ ...c, section: c.records?.section, title: c.records?.title }));
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
    if (DEMO) { const db = demoLoad(); const s = q.toLowerCase(); return db.records.filter((r) => demoVisible(db, r) && (r.title + " " + JSON.stringify(r.data)).toLowerCase().includes(s)).slice(0, n).map(loc); }
    const { data, error } = await sb().rpc("search_records", { q, n });
    if (!error) return ((data || []) as Rec[]).map(loc);
    const { data: d2 } = await sb().from("records").select("*").ilike("title", `%${q}%`).limit(n); return ((d2 || []) as Rec[]).map(loc);
  },
  /** Comments containing the words (only discussions I may read). */
  async searchComments(q: string, n = 15): Promise<(Comment & { section?: string; title?: string })[]> {
    const s = q.trim(); if (s.length < 2) return [];
    if (DEMO) { const db = demoLoad(); return db.comments.filter((c) => c.body.toLowerCase().includes(s.toLowerCase())).slice(0, n).map((c) => { const r = db.records.find((x) => x.id === c.record_id); return { ...c, section: r?.section, title: r?.title }; }).filter((c) => c.section); }
    const { data } = await sb().from("comments").select("*, records(section,title)").ilike("body", `%${s.replace(/[%_\\]/g, (m) => "\\" + m)}%`).order("created_at", { ascending: false }).limit(n);
    return (data || []).filter((c: any) => c.records).map((c: any) => ({ ...c, section: c.records?.section, title: c.records?.title }));
  },
  async profiles(): Promise<Profile[]> {
    if (DEMO) return demoLoad().profiles;
    const { data } = await sb().from("profiles").select("*").order("created_at"); return (data || []) as Profile[];
  },
  async updateProfile(id: string, patch: Partial<Profile>) {
    if (DEMO) { const db = demoLoad(); db.profiles = db.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)); demoSave(db); return; }
    const { error } = await sb().from("profiles").update(patch).eq("id", id); if (error) throw error;
  },
  /* ----- Sign-in protection: second factor (authenticator app), session state ----- */
  async security(): Promise<{ mfaRequired: boolean; aal: string; next: string; factors: { id: string; status: string; friendly_name?: string; created_at?: string }[]; iat: number }> {
    if (DEMO) return { mfaRequired: false, aal: "aal1", next: "aal1", factors: [], iat: 0 };
    const [{ data: sec }, { data: aal }, { data: f }, { data: s }] = await Promise.all([
      sb().from("security_settings").select("mfa_required").maybeSingle(), sb().auth.mfa.getAuthenticatorAssuranceLevel(), sb().auth.mfa.listFactors(), sb().auth.getSession()]);
    let iat = 0; try { iat = JSON.parse(atob((s.session?.access_token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).iat || 0; } catch {}
    return { mfaRequired: !!sec?.mfa_required, aal: aal?.currentLevel || "aal1", next: aal?.nextLevel || "aal1", factors: ((f as any)?.all || f?.totp || []).filter((x: any) => x.factor_type === "totp" || !x.factor_type), iat };
  },
  async mfaEnroll(name: string) {
    // a half-finished set-up from before is removed first, so the new QR code is the only one
    const { data: f } = await sb().auth.mfa.listFactors();
    for (const x of ((f as any)?.all || []).filter((x: any) => x.status === "unverified")) await sb().auth.mfa.unenroll({ factorId: x.id }).catch(() => null);
    const { data, error } = await sb().auth.mfa.enroll({ factorType: "totp", friendlyName: `${name} ${new Date().toISOString().slice(0, 10)}` });
    if (error) throw error; return { id: data.id, qr: (data as any).totp?.qr_code as string, secret: (data as any).totp?.secret as string };
  },
  async mfaVerify(factorId: string, code: string) { const { error } = await sb().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s+/g, "") }); if (error) throw error; await sb().auth.refreshSession().catch(() => null); },
  async mfaRemove(factorId: string) { const { error } = await sb().auth.mfa.unenroll({ factorId }); if (error) throw error; },
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
    if ((offline() || prefix.split("/").some(isTemp)) && !FLUSHING) { await this.queue({ kind: "upload", prefix, name: file.name, type: file.type, file }); return { name: file.name, path: `${prefix}/(waiting)_${safe}`, size: file.size, type: file.type }; }
    const { error } = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) { if (!FLUSHING && isNetworkError(error)) { await this.queue({ kind: "upload", prefix, name: file.name, type: file.type, file }); return { name: file.name, path: `${prefix}/(waiting)_${safe}`, size: file.size, type: file.type }; } throw error; }
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
    if (DEMO) { await loadLearnLang("uk"); await seedFaq(); }
    if (!q.trim()) return [];
    if (DEMO) return demoFaq(demoLoad()).filter((f) => !lang || f.lang === lang).map((f) => ({ ...f, sim: textSim(q, f.question) })).filter((f) => f.sim! > 0.3).sort((a, b) => b.sim! - a.sim!).slice(0, n);
    const { data, error } = await sb().rpc("faq_search", { q, lng: lang || null, n });
    if (error) return []; return (data || []) as Faq[];
  },
  async faqList(): Promise<Faq[]> {
    await loadLearnLang("uk"); await seedFaq(); // the starter answers are written in all four languages
    if (DEMO) return demoFaq(demoLoad());
    const get = async () => (await sb().from("faq").select("*").order("verified", { ascending: false }).order("hits", { ascending: false }).limit(500)).data || [];
    let rows = await get();
    // Starter answers: loaded on first run and topped up when new ones ship (insert is allowed for owner, admin, management, legal)
    const have = new Set(rows.map((r: any) => `${r.lang}|${r.question}`));
    const seed = (await seedFaq()).flatMap((f) => (["en", "ru", "uk", "ar"] as const).map((l) => ({ question: l2(f.q, l), answer: l2(f.a, l), lang: l, section: f.section || null, verified: true, source: "seed" })))
      .filter((x) => !have.has(`${x.lang}|${x.question}`));
    if (seed.length) { const { error } = await sb().from("faq").insert(seed); if (!error) rows = await get(); }
    return rows as Faq[];
  },
  async faqSave(f: Partial<Faq> & { question: string; answer: string; lang: string }, opts: { translate?: boolean } = {}) {
    if (DEMO) { await loadLearnLang("uk"); await seedFaq(); }
    if (DEMO) { const db = demoLoad(); const list = demoFaq(db); if (f.id) db.faq = list.map((x) => (x.id === f.id ? { ...x, ...f } as Faq : x)); else db.faq = [{ id: uid(), section: null, verified: false, hits: 0, source: "manual", ...f } as Faq, ...list]; demoSave(db); return; }
    const body: any = { question: f.question, answer: f.answer, lang: f.lang, section: f.section ?? null, source: f.source || "manual" };
    if (f.verified !== undefined) body.verified = f.verified;
    const { data, error } = f.id ? await sb().from("faq").update({ ...body, updated_at: new Date().toISOString() }).eq("id", f.id).select("id").single() : await sb().from("faq").insert(body).select("id").single();
    if (error) throw error;
    // Only the question or the answer changed → the other three languages follow
    if (data?.id && opts.translate !== false && f.source !== "seed") translateLater({ faq: data.id });
  },
  async faqDelete(id: string) {
    if (DEMO) { await loadLearnLang("uk"); await seedFaq(); }
    if (DEMO) { const db = demoLoad(); db.faq = demoFaq(db).filter((x) => x.id !== id); demoSave(db); return; }
    const { error } = await sb().from("faq").delete().eq("id", id); if (error) throw error;
  },
  async faqHit(id: string) {
    if (DEMO) { await loadLearnLang("uk"); await seedFaq(); }
    if (DEMO) { const db = demoLoad(); db.faq = demoFaq(db).map((x) => (x.id === id ? { ...x, hits: x.hits + 1 } : x)); demoSave(db); return; }
    await sb().rpc("faq_hit", { fid: id });
  },
  async firstImage(prefix: string): Promise<string> {
    try { const fs = await this.files(prefix); const img = fs.find((f) => f.type.startsWith("image/")); return img ? await this.fileUrl(img.path) : ""; } catch { return ""; }
  },
};
