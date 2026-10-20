"use client";
import { allSections, defaultRules, ROLES } from "@/config/workspace.config.mjs";
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
export type Comment = { id: string; record_id: string; author: string | null; body: string; created_at: string };
export type Activity = { id: number; record_id: string | null; section: string; actor: string | null; action: string; detail: any; created_at: string };
export type Access = { read: Set<string>; write: Set<string> };
export type Notice = { id: number; kind: string; record_id: string | null; section: string | null; title: string | null; body: string | null; actor: string | null; link: string | null; created_at: string; read_at: string | null };

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
      const { data, error } = await sb().from("records").select("*").in("section", sections).limit(3000); if (error) throw error;
      const out = ((data || []) as Rec[]).map(loc); for (const s of sections) MEM.set(s, out.filter((r) => r.section === s)); return out;
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
  async addComment(recordId: string, body: string, o: { internal?: boolean } = {}) {
    const internal = !!o.internal;
    if (DEMO) { const db = demoLoad(); const mentions = [...body.matchAll(/@\[[^\]]{1,120}\]\(([0-9a-fA-F-]{36})\)/g)].map((m) => m[1]); db.comments.push({ id: uid(), record_id: recordId, author: demoMe(db).id, body, created_at: new Date().toISOString(), internal, mentions } as any); demoSave(db); return; }
    if ((offline() || isTemp(recordId)) && !FLUSHING) { await this.queue({ kind: "comment", record_id: recordId, body, internal }); return; }
    const { data: u } = await sb().auth.getUser();
    const { error } = await sb().from("comments").insert({ record_id: recordId, body, author: u?.user?.id, ...(internal ? { internal } : {}) }); if (error) { if (!FLUSHING && isNetworkError(error)) { await this.queue({ kind: "comment", record_id: recordId, body, internal }); return; } throw error; }
    translateLater({ id: recordId });
    if (/@\p{L}/u.test(body)) try { fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mention", record_id: recordId }), keepalive: true }).catch(() => {}); } catch {}
  },
  /** Recent discussions I can see (comments on records I may read), newest first. */
  async discussions(n = 400): Promise<(Comment & { section?: string; title?: string; internal?: boolean; mentions?: string[] })[]> {
    if (DEMO) { const db = demoLoad(); return db.comments.slice(-n).reverse().map((c) => { const r = db.records.find((x) => x.id === c.record_id); return { ...c, section: r?.section, title: r?.title }; }).filter((c) => c.section && demoVisible(db, db.records.find((x) => x.id === c.record_id)!)); }
    const { data } = await sb().from("comments").select("*, records(section,title)").order("created_at", { ascending: false }).limit(n);
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
    const { data, error } = await sb().from("notifications").select("id,kind,record_id,section,title,body,actor,link,created_at,read_at").order("created_at", { ascending: false }).limit(n);
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
