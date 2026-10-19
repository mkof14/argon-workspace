// Automation core shared by the server and the browser: company settings, "when → then" rules, data-quality checks.
// Pure functions only (no imports of other local modules), so the Node test runner can load this file directly.

export type Mode = "off" | "suggest" | "auto";
export type AgentId = "rules" | "deadlines" | "compliance" | "quality" | "brief" | "finance" | "sales" | "operations" | "hr" | "legal" | "marketing" | "technical" | "security" | "intake";
export const AGENTS: AgentId[] = ["rules", "deadlines", "compliance", "quality", "brief", "finance", "sales", "operations", "hr", "legal", "marketing", "technical", "security", "intake"];
/** Department agents (their checks live in deptAgents.ts). */
export const DEPT_AGENTS: AgentId[] = ["finance", "sales", "operations", "hr", "legal", "marketing", "technical", "security"];

export type Settings = {
  company: { name: string; timezone: string; currency: string; workdays: number[]; holidays: string[] };
  thresholds: { escalate_after: number; remind_before: number; stalled_deal: number; stale_record: number; screening_wait: number };
  notify: { digest: boolean; monitor_roles: string[]; report_roles: string[]; brief_roles: string[]; escalate_roles: string[] };
  agents: Record<AgentId, Mode>;
  ai: { monthly_usd: number; price_in: number; price_out: number };
  /** Everything people write is translated into EN, RU, UK and AR; system e-mails go out in each person's language. */
  translate: { auto: boolean; emails: boolean };
  /** Who may approve spending, by amount — read through withLimits() in config/approvals. */
  limits: any;
  /** Sales target per quarter, USD (0 = not set) */
  sales_target: number;
};

/** Every agent starts in "suggest": it prepares the change and a person approves it with one click. */
export const DEFAULT_SETTINGS: Settings = {
  company: { name: "AGRON Inc.", timezone: "America/New_York", currency: "USD", workdays: [1, 2, 3, 4, 5], holidays: [] },
  thresholds: { escalate_after: 3, remind_before: 3, stalled_deal: 14, stale_record: 60, screening_wait: 3 },
  notify: { digest: true, monitor_roles: ["owner", "admin", "security"], report_roles: ["owner", "admin", "management"], brief_roles: ["owner"], escalate_roles: ["owner", "admin", "management"] },
  agents: { rules: "suggest", deadlines: "auto", compliance: "suggest", quality: "suggest", brief: "auto", finance: "suggest", sales: "suggest", operations: "suggest", hr: "suggest", legal: "suggest", marketing: "suggest", technical: "suggest", security: "suggest", intake: "suggest" },
  ai: { monthly_usd: 50, price_in: 3, price_out: 15 },
  translate: { auto: true, emails: true },
  limits: null,
  sales_target: 0,
};

/** Merges saved settings over the defaults, so new options get sensible values. */
export function withDefaults(s: any): Settings {
  const d = DEFAULT_SETTINGS; s = s && typeof s === "object" ? s : {};
  const num = (v: any, def: number, min = 0, max = 100000) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
  const arr = (v: any, def: string[]) => (Array.isArray(v) ? v.map(String) : def);
  const mode = (v: any, def: Mode): Mode => (["off", "suggest", "auto"].includes(v) ? v : def);
  return {
    company: { name: String(s.company?.name ?? d.company.name), timezone: String(s.company?.timezone || d.company.timezone), currency: String(s.company?.currency || d.company.currency),
      workdays: Array.isArray(s.company?.workdays) ? s.company.workdays.map(Number).filter((x: number) => x >= 0 && x <= 6) : d.company.workdays,
      holidays: arr(s.company?.holidays, d.company.holidays).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) },
    thresholds: { escalate_after: num(s.thresholds?.escalate_after, d.thresholds.escalate_after, 0, 60), remind_before: num(s.thresholds?.remind_before, d.thresholds.remind_before, 0, 60),
      stalled_deal: num(s.thresholds?.stalled_deal, d.thresholds.stalled_deal, 1, 365), stale_record: num(s.thresholds?.stale_record, d.thresholds.stale_record, 7, 730), screening_wait: num(s.thresholds?.screening_wait, d.thresholds.screening_wait, 0, 60) },
    notify: { digest: s.notify?.digest ?? d.notify.digest, monitor_roles: arr(s.notify?.monitor_roles, d.notify.monitor_roles), report_roles: arr(s.notify?.report_roles, d.notify.report_roles),
      brief_roles: arr(s.notify?.brief_roles, d.notify.brief_roles), escalate_roles: arr(s.notify?.escalate_roles, d.notify.escalate_roles) },
    agents: Object.fromEntries(AGENTS.map((a) => [a, mode(s.agents?.[a], d.agents[a])])) as Record<AgentId, Mode>,
    translate: { auto: s.translate?.auto !== false, emails: s.translate?.emails !== false },
    limits: s.limits ?? null,
    sales_target: num(s.sales_target, 0, 0, 1e10),
    ai: { monthly_usd: num(s.ai?.monthly_usd, d.ai.monthly_usd, 0, 100000), price_in: num(s.ai?.price_in, d.ai.price_in, 0, 1000), price_out: num(s.ai?.price_out, d.ai.price_out, 0, 1000) },
  };
}

/** Working day per the company calendar (date as YYYY-MM-DD). */
export function isWorkday(day: string, s: Settings) {
  const wd = new Date(day + "T12:00:00Z").getUTCDay();
  return s.company.workdays.includes(wd) && !s.company.holidays.includes(day);
}
export const aiCost = (tin: number, tout: number, s: Settings) => (tin * s.ai.price_in + tout * s.ai.price_out) / 1e6;

/* ---------------- Rules ---------------- */
export type Cond = { field: string; op: "eq" | "neq" | "in" | "nin" | "empty" | "filled" | "gt" | "lt"; value?: string };
export type Action =
  | { type: "notify"; to: string; message: string }                                   // to: "owner" (the person in the record) | "role:<role>" | "leads"
  | { type: "create"; section: string; title: string; status?: string; link?: string; fields?: Record<string, string> } // link: ref field in the new record pointing back
  | { type: "set"; field: string; value: string }                                     // field "status" changes the status
  | { type: "email"; to_field: string; to?: string; subject: string; body: string }   // email to an outside address (field or fixed address): always waits for approval
  | { type: "file"; section: string; title: string; status: string; data: Record<string, any>; controlled: boolean; files: string[]; from: string; subject: string; summary?: string }; // an incoming email filed as a record
export type Rule = {
  id: string; name: string; enabled: boolean; mode: "auto" | "suggest";
  on: "created" | "status" | "date"; section: string; status?: string; date_key?: string; offset?: number;
  when?: Cond[]; actions: Action[];
};
export type Ev = { kind: "created" | "status"; from?: string | null; to?: string | null };
type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any>; controlled?: boolean; created_at?: string; updated_at?: string };

const val = (rec: R, field: string) => (field === "status" ? rec.status : field === "title" ? rec.title : rec.data?.[field]);
export function condOk(rec: R, c: Cond): boolean {
  const v = val(rec, c.field); const s = v === undefined || v === null ? "" : String(v);
  const list = String(c.value ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  switch (c.op) {
    case "eq": return s.toLowerCase() === String(c.value ?? "").toLowerCase();
    case "neq": return s.toLowerCase() !== String(c.value ?? "").toLowerCase();
    case "in": return list.includes(s.toLowerCase());
    case "nin": return !list.includes(s.toLowerCase());
    case "empty": return !s.trim() || s === "false";
    case "filled": return !!s.trim() && s !== "false";
    case "gt": return Number(s) > Number(c.value);
    case "lt": return Number(s) < Number(c.value);
  }
  return false;
}
export const condsOk = (rec: R, w?: Cond[]) => (w || []).every((c) => condOk(rec, c));

/** Fills {title}, {status}, {section}, {today} and {any_field} from the record. Unknown keys become empty. */
export function render(tpl: string, rec: R, today = new Date().toISOString().slice(0, 10)) {
  return String(tpl || "").replace(/\{([\w.]+)\}/g, (_, k: string) => {
    const key = k.replace(/^data\./, "");
    if (key === "today") return today;
    const v = key === "title" ? rec.title : key === "status" ? rec.status : key === "section" ? rec.section : key === "id" ? rec.id : rec.data?.[key];
    return v === undefined || v === null ? "" : String(v);
  }).trim();
}

/** Does this rule react to this change of this record? */
export function matchEvent(rule: Rule, rec: R, ev: Ev) {
  if (!rule.enabled || rule.section !== rec.section || rule.on === "date") return false;
  if (rule.on === "created" && ev.kind !== "created") return false;
  if (rule.on === "status") {
    const to = ev.kind === "created" ? rec.status : ev.to;
    if (ev.kind === "status" && (ev.from || "") === (ev.to || "")) return false;
    if (!to || (rule.status && rule.status.toLowerCase() !== to.toLowerCase())) return false;
  }
  return condsOk(rec, rule.when);
}

const addDays = (d: string, n: number) => { const t = new Date(d.slice(0, 10) + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
/** Date rules: fire on (date + offset), with a 3-day catch-up window if the daily run was missed. Returns the fire day or null. */
export function dateDue(rule: Rule, rec: R, today: string): string | null {
  if (!rule.enabled || rule.on !== "date" || rule.section !== rec.section || !rule.date_key) return null;
  const d = String(rec.data?.[rule.date_key] || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const fire = addDays(d, Number(rule.offset || 0));
  if (fire > today || fire < addDays(today, -3)) return null;
  return condsOk(rec, rule.when) ? fire : null;
}

/** Plain-language description of a rule (English; the UI translates the fixed words). */
export function describe(rule: Rule, label: (sectionId: string) => string) {
  const trig = rule.on === "created" ? `a new record is added to ${label(rule.section)}` : rule.on === "status" ? `a record in ${label(rule.section)} moves to ${rule.status || "any status"}`
    : `${Math.abs(rule.offset || 0)} day(s) ${(rule.offset || 0) < 0 ? "before" : "after"} “${rule.date_key}” in ${label(rule.section)}`;
  const acts = rule.actions.map((a) => a.type === "notify" ? `notify ${a.to.replace("role:", "")}` : a.type === "create" ? `create a record in ${label(a.section)}` : a.type === "set" ? `set ${a.field} to “${a.value}”` : a.type === "file" ? `file the email into ${label(a.section)}` : `email the address in “${a.to_field}” (after approval)`);
  return `When ${trig}${rule.when?.length ? " (with conditions)" : ""}: ${acts.join(", ")}.`;
}

/** Ready-made rules for the StarDome chain. They start in "suggest" mode: changes wait in the approval queue. */
export const DEFAULT_RULES: Rule[] = [
  { id: "deal-won", name: "Deal won → build, invoice and team notice", enabled: true, mode: "suggest", on: "status", section: "sales.pipeline", status: "Won",
    actions: [
      { type: "create", section: "operations.builds", title: "{title}", status: "Design", link: "deal_ref", fields: { client: "{client}", config: "{config}" } },
      { type: "create", section: "finance.invoices", title: "Invoice — {title}", status: "Draft", link: "deal_ref", fields: { direction: "Receivable", counterparty: "{client}", amount: "{value}", currency: "{currency}" } },
      { type: "notify", to: "role:operations", message: "Deal “{title}” is won. A container build and a draft invoice were prepared." },
      { type: "notify", to: "role:finance", message: "Deal “{title}” is won ({value} {currency}). A draft invoice is ready to check." },
    ] },
  { id: "deal-screen", name: "Deal reaches Proposal → sanctions screening", enabled: true, mode: "suggest", on: "status", section: "sales.pipeline", status: "Proposal",
    actions: [
      { type: "create", section: "security.screening", title: "{client}", status: "Pending", link: "deal_ref", fields: { party: "{client}", party_type: "Client", country: "{country}", date: "{today}" } },
      { type: "notify", to: "role:security", message: "Screen the client of deal “{title}” before the proposal goes out." },
    ] },
  { id: "deal-contract", name: "Deal in Negotiation → contract draft", enabled: true, mode: "suggest", on: "status", section: "sales.pipeline", status: "Negotiation",
    actions: [
      { type: "create", section: "legal.contracts", title: "Contract — {title}", status: "Drafting", link: "deal_ref", fields: { counterparty: "{client}", type: "Sale" } },
      { type: "notify", to: "role:legal", message: "Deal “{title}” is in negotiation. A contract draft record was prepared." },
    ] },
  { id: "vendor-screen", name: "Vendor under review → screening", enabled: true, mode: "suggest", on: "status", section: "operations.vendors", status: "Under review",
    actions: [{ type: "create", section: "security.screening", title: "{title}", status: "Pending", fields: { party: "{title}", party_type: "Vendor", country: "{country}", date: "{today}" } }] },
  { id: "build-installed", name: "Build installed → acceptance task", enabled: true, mode: "suggest", on: "status", section: "operations.builds", status: "Installed",
    actions: [
      { type: "create", section: "company.tasks", title: "Client acceptance — {title}", status: "Open", fields: { assignee: "{owner}", priority: "High" } },
      { type: "notify", to: "role:finance", message: "Build “{title}” is installed. Check the final invoice." },
    ] },
  { id: "hire-onboard", name: "New team member → onboarding", enabled: true, mode: "suggest", on: "created", section: "hr.team",
    actions: [{ type: "create", section: "hr.onboarding", title: "Onboarding — {title}", status: "To do", fields: { person: "{title}", due: "{start}" } }] },
  // Daily work: a task reaches the person it is assigned to, a reminder the day before the deadline, leaders hear when it is late
  { id: "task-assigned", name: "New task → tell the person responsible", enabled: true, mode: "auto", on: "created", section: "company.tasks",
    actions: [{ type: "notify", to: "owner", message: "New task for you: {title} (due {due})." }] },
  { id: "task-due", name: "Task due tomorrow → remind the person", enabled: true, mode: "auto", on: "date", section: "company.tasks", date_key: "due", offset: -1, when: [{ field: "status", op: "nin", value: "Done" }],
    actions: [{ type: "notify", to: "owner", message: "Reminder: “{title}” is due tomorrow ({due})." }] },
  { id: "task-late", name: "Task overdue → tell the leaders", enabled: true, mode: "auto", on: "date", section: "company.tasks", date_key: "due", offset: 1, when: [{ field: "status", op: "nin", value: "Done" }],
    actions: [{ type: "notify", to: "leads", message: "Task overdue: “{title}” — responsible: {assignee}, due {due}." }] },
  { id: "invoice-soon", name: "Invoice due in 3 days → remind finance", enabled: true, mode: "auto", on: "date", section: "finance.invoices", date_key: "due", offset: -3,
    when: [{ field: "status", op: "nin", value: "Paid, Draft" }], actions: [{ type: "notify", to: "role:finance", message: "Invoice “{title}” ({amount} {currency}) is due on {due}." }] },
  { id: "invoice-overdue", name: "Invoice past due → mark Overdue", enabled: true, mode: "suggest", on: "date", section: "finance.invoices", date_key: "due", offset: 1,
    when: [{ field: "status", op: "in", value: "Sent, Due" }], actions: [{ type: "set", field: "status", value: "Overdue" }, { type: "notify", to: "role:finance", message: "Invoice “{title}” is overdue since {due}." }] },
  { id: "contract-end", name: "Contract date in 30 days → legal", enabled: true, mode: "auto", on: "date", section: "legal.contracts", date_key: "due", offset: -30,
    when: [{ field: "status", op: "nin", value: "Expired" }], actions: [{ type: "notify", to: "role:legal", message: "Contract “{title}” has a key date on {due}." }] },
];

/* ---------------- Data quality ---------------- */
export type Issue = { kind: "no_owner" | "no_date" | "broken_link" | "stale_link" | "duplicate" | "stale" | "bad_status"; id: string; section: string; title: string; detail: string; fix?: Record<string, any> };
type Sec = { id: string; statuses?: string[]; fields?: { key: string; type: string; ref?: string }[] };
const DONE = /^(done|paid|closed|resolved|installed|signed|filed|delivered|received|cancelled|passed|approved|granted|retired|won|lost|awarded|commissioned|taken|returned|settled|released|registered|revoked|former|answered|superseded|rejected|published|adopted|counsel approved|hired|implemented|accepted|declined|archived|reference|left|cleared|expired|actual)$/i;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Finds gaps that cause mistakes: open items with nobody responsible or no date, broken links, duplicates, forgotten records. */
export function qualityIssues(recs: R[], sections: Sec[], opts: { staleDays: number; now?: number }): Issue[] {
  const byId = new Map(recs.map((r) => [r.id, r])); const secs = new Map(sections.map((s) => [s.id, s])); const out: Issue[] = [];
  const now = opts.now ?? Date.now(); const seen = new Map<string, R>();
  const SKIP = /\.(metrics|matrix|outbox|templates|brand|wiki|pricelist|outlets|competitors|channels|systems|contacts|registers)$/;
  for (const r of recs) {
    const s = secs.get(r.section); if (!s || SKIP.test(r.section)) continue;
    const open = !DONE.test(r.status || "");
    const keys = new Set((s.fields || []).map((f) => f.key));
    if (s.statuses?.length && r.status && !s.statuses.includes(r.status)) out.push({ kind: "bad_status", id: r.id, section: r.section, title: r.title, detail: `“${r.status}” is not a status of this section` });
    if (open) {
      const who = ["owner", "assignee", "person", "engineer", "manager"].find((k) => keys.has(k));
      if (who && !String(r.data?.[who] || "").trim()) out.push({ kind: "no_owner", id: r.id, section: r.section, title: r.title, detail: `Nobody responsible (${who})` });
      const due = ["due", "deadline"].find((k) => keys.has(k));
      if (due && who && !r.data?.[due]) out.push({ kind: "no_date", id: r.id, section: r.section, title: r.title, detail: `No ${due} date` });
      const age = (now - Date.parse(r.updated_at || r.created_at || "")) / 864e5;
      if (age > opts.staleDays) out.push({ kind: "stale", id: r.id, section: r.section, title: r.title, detail: `Open and not updated for ${Math.floor(age)} days` });
    }
    for (const f of (s.fields || []).filter((x) => x.type === "ref")) {
      const id = r.data?.[f.key]; if (!id) continue;
      const t = byId.get(id);
      if (!t) out.push({ kind: "broken_link", id: r.id, section: r.section, title: r.title, detail: `Link “${f.key}” points to a record that no longer exists`, fix: { [f.key]: null, [`${f.key}_title`]: null } });
      else if (r.data?.[`${f.key}_title`] !== t.title) out.push({ kind: "stale_link", id: r.id, section: r.section, title: r.title, detail: `Link name is out of date: “${t.title}”`, fix: { [`${f.key}_title`]: t.title } });
    }
    const k = `${r.section}|${norm(r.title)}`;
    if (norm(r.title)) { const first = seen.get(k); if (first) out.push({ kind: "duplicate", id: r.id, section: r.section, title: r.title, detail: `Same title as another record in this section` }); else seen.set(k, r); }
  }
  return out;
}
