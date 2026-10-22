// Phase 7 — the browser's calls to the commercial layer (v24). Every function works out the signed-in person on the
// server (auth.uid()) and returns only what that person may open. Stages, values, proposals and conversions are
// checked by the database (a direct edit that breaks a rule is refused there), never only here.
import { DEMO, sb } from "./sb";

const rpc = async <T = any>(fn: string, args: Record<string, any> = {}): Promise<T> => {
  if (DEMO) return (fn === "crm_list" || fn === "crm_waiting" || fn === "crm_timeline" || fn === "crm_leads" || fn === "crm_imports_list" || fn === "crm_caps_list" || fn === "crm_dupes" ? [] : null) as any;
  const { data, error } = await sb().rpc(fn, args); if (error) throw new Error(error.message); return data as T;
};
export type Filter = { product?: string; geography?: string; owner_id?: string; source?: string; stage?: string; event_ref?: string; currency?: string; min_value?: number };
const clean = (f?: Filter) => Object.fromEntries(Object.entries(f || {}).filter(([, v]) => v !== "" && v != null));

export const crm = {
  caps: () => rpc<Record<string, boolean>>("crm_my_caps"),
  catalogs: () => rpc<any>("crm_catalogs"),
  overview: (f?: Filter) => rpc<any>("crm_overview", { p_filter: clean(f) }),
  list: (kind: string, q?: string | null, n = 200, f?: Filter) => rpc<any[]>("crm_list", { p_kind: kind, p_q: q || null, p_limit: n, p_filter: clean(f) }),
  value: (f?: Filter) => rpc<any>("crm_pipeline_value", { p_filter: clean(f) }),
  forecast: (from?: string | null, to?: string | null, bucket = "month", f?: Filter) => rpc<any>("crm_forecast", { p_from: from || null, p_to: to || null, p_bucket: bucket, p_filter: clean(f) }),
  waiting: () => rpc<any[]>("crm_waiting"),
  followups: (scope = "mine") => rpc<any>("crm_followups", { p_scope: scope }),
  weekly: (from?: string | null, to?: string | null) => rpc<any>("crm_weekly", { p_from: from || null, p_to: to || null }),
  opp: (id: string) => rpc<any>("crm_opp", { p_id: id }),
  timeline: (id: string, n = 200) => rpc<any[]>("crm_timeline", { p_id: id, p_limit: n }),
  relations: (id: string) => rpc<any>("crm_relations", { p_id: id }),
  leads: (f: Record<string, any> = {}, n = 300) => rpc<any[]>("crm_leads", { p_filter: f, p_limit: n }),
  dupes: (kind: "organization" | "contact", p: Record<string, any>) => rpc<any[]>("crm_dupes", { p_kind: kind, p }),
  capture: (p: Record<string, any>) => rpc<any>("crm_lead_capture", { p }),
  convert: (lead: string, p: Record<string, any> = {}) => rpc<any>("crm_lead_convert", { p_lead: lead, p }),
  bulkAssign: (leads: string[], owner: string, followUp?: string | null) => rpc<any>("crm_bulk_assign", { p_leads: leads, p_owner: owner, p_follow_up: followUp || null }),
  submitProposal: (id: string) => rpc<any>("crm_proposal_submit", { p_id: id }),
  newVersion: (id: string, reason?: string | null) => rpc<any>("crm_proposal_new_version", { p_id: id, p_reason: reason || null }),
  handoff: (opp: string) => rpc<any>("crm_handoff", { p_opp: opp }),
  handoffProject: (opp: string, mode: "create" | "link", project?: string | null, p: Record<string, any> = {}) => rpc<any>("crm_handoff_project", { p_opp: opp, p_mode: mode, p_project: project || null, p }),
  merge: (kind: "organization" | "contact", keep: string, merge: string, reason: string) => rpc<any>("crm_merge", { p_kind: kind, p_keep: keep, p_merge: merge, p_reason: reason }),
  eventDay: (event?: string | null, day?: string | null) => rpc<any>("crm_event_day", { p_event: event || null, p_day: day || null }),
  eventFollowup: (event?: string | null) => rpc<any>("crm_event_followup", { p_event: event || null }),
  assistant: (intent: string, arg?: string | null) => rpc<any>("crm_assistant", { p_intent: intent, p_arg: arg || null }),
  importPreview: (kind: string, rows: any[]) => rpc<any>("crm_import_preview", { p_kind: kind, p_rows: rows }),
  importCommit: (kind: string, rows: any[], decisions: Record<string, string>, file?: string | null) => rpc<any>("crm_import_commit", { p_kind: kind, p_rows: rows, p_decisions: decisions, p_file: file || null }),
  importRollback: (batch: string) => rpc<any>("crm_import_rollback", { p_batch: batch }),
  imports: () => rpc<any[]>("crm_imports_list"),
  exportRows: (kind: string, f: Record<string, any> = {}) => rpc<any>("crm_export", { p_kind: kind, p_filter: f }),
  emailSuggest: (from: string, subject: string, kind?: string | null, id?: string | null) => rpc<any>("crm_email_suggest", { p_from: from, p_subject: subject, p_source_kind: kind || null, p_source_id: id || null }),
  emailLink: (kind: string, id: string, target: string, accept: boolean, subject?: string | null, from?: string | null) => rpc<any>("crm_email_link", { p_source_kind: kind, p_source_id: id, p_target: target, p_accept: accept, p_subject: subject || null, p_from: from || null }),
  settings: () => rpc<any>("crm_settings_get"),
  saveSettings: (value: any, version: number) => rpc<any>("crm_settings_save", { p_value: value, p_version: version }),
  capsList: () => rpc<any[]>("crm_caps_list"),
  setCap: (user: string, cap: string, on: boolean) => rpc<any>("crm_cap_set", { p_user: user, p_cap: cap, p_on: on }),
  /** Follow-up help for an opportunity: proposed, done only with the person's explicit yes (Safe Actions). A draft is text only. */
  propose: async (body: { kind: "task" | "reminder" | "note" | "followup" | "draft"; opp: string; title?: string; date?: string; to?: string; confirm?: boolean; lang?: string }) => {
    const r = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "crm_propose", ...body }) });
    if (!r.ok) throw new Error(await r.text()); return r.json();
  },
};

/** A value with its currency — never a default currency, never converted. */
export const amount = (v: any, cur?: string | null) => (v == null || v === "" || !isFinite(Number(v)) ? "—" : `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${cur || "(no currency)"}`);
export const amounts = (m?: Record<string, number> | null) => Object.entries(m || {}).map(([c, v]) => amount(v, c)).join(" · ");

/** CSV → rows (header row gives the field names). Quotes and commas inside quotes are handled. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = []; let f = ""; let q = false; const t = text.replace(/^\uFEFF/, "");
  const first = t.split(/\r?\n/, 1)[0] || ""; const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { cur.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; cur.push(f); f = ""; if (cur.some((x) => x.trim())) rows.push(cur); cur = []; }
    else f += ch;
  }
  cur.push(f); if (cur.some((x) => x.trim())) rows.push(cur);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()]).filter(([h, v]) => h && v)));
}
export function toCsv(rows: Record<string, any>[]): string {
  if (!rows.length) return "";
  const set = new Set<string>(); rows.forEach((r) => Object.keys(r).forEach((k) => set.add(k))); const cols = Array.from(set);
  const esc = (v: any) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
