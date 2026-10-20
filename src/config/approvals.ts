// One-click approvals: which sections can be sent for approval, from which statuses, and who may approve.
// ok/no = the status set on Approve / Reject (no `no` → the status stays and the decision is recorded).
// need = a field value required before the request can be sent (marketing: the compliance check).
export type ApprovalRule = { wait: string[]; ok: string; no?: string; changes?: string; approvers: string[]; key: string[]; need?: { field: string; in: string[] } };
const LEAD = ["owner", "admin", "management"];
const CHECKED = { field: "check", in: ["Passed (AI check)", "Cleared by legal"] };
export const APPROVALS: Record<string, ApprovalRule> = {
  "finance.expenses": { wait: ["Submitted"], ok: "Approved", no: "Rejected", approvers: ["owner", "admin", "management", "finance"], key: ["requester", "amount", "currency", "category", "notes"] },
  "hr.leave": { wait: ["Requested"], ok: "Approved", no: "Rejected", approvers: ["owner", "admin", "management", "hr"], key: ["person", "type", "from", "to", "notes"] },
  "operations.procurement": { wait: ["Draft"], ok: "Approved", no: "Cancelled", approvers: ["owner", "admin", "management"], key: ["vendor", "item", "qty", "amount", "currency", "eta", "build"] },
  "technical.changes": { wait: ["Requested", "Assessing"], ok: "Approved", no: "Rejected", approvers: ["owner", "admin", "management"], key: ["config", "impact", "priority", "reason", "due"] },
  "company.decisions": { wait: ["Proposed"], ok: "Approved", no: "Rejected", approvers: ["owner", "admin"], key: ["area", "decision", "rationale"] },
  "hr.compensation": { wait: ["Proposed"], ok: "Approved", approvers: ["owner", "admin"], key: ["person", "salary", "currency", "effective", "bonus", "equity", "reason"] },
  "finance.budget": { wait: ["Planned"], ok: "Approved", approvers: ["owner", "admin", "management"], key: ["department", "period", "planned", "currency"] },
  "finance.costing": { wait: ["Draft", "Reviewed"], ok: "Approved", approvers: ["owner", "admin", "management"], key: ["config", "price", "bom", "labor"] },
  "hr.policies": { wait: ["Draft"], ok: "Approved", approvers: ["owner", "admin", "management"], key: ["version"] },
  "marketing.media": { wait: ["Draft", "Review"], ok: "Approved", no: "Draft", approvers: LEAD, key: ["kind", "product", "audience", "version", "check"], need: CHECKED },
  "marketing.social": { wait: ["Draft", "Review"], ok: "Approved", no: "Draft", approvers: LEAD, key: ["channel", "account", "publish", "text", "check"], need: CHECKED },
  "marketing.press": { wait: ["Writing", "Review"], ok: "Approved", no: "Writing", approvers: LEAD, key: ["outlet", "format", "publish", "topic", "text", "check"], need: CHECKED },
  "marketing.interviews": { wait: ["Confirmed", "Preparing"], ok: "Approved", approvers: LEAD, key: ["type", "outlet", "spokesperson", "session", "topics", "check"], need: CHECKED },
  "marketing.video": { wait: ["Editing", "Review"], ok: "Approved", no: "Editing", approvers: LEAD, key: ["type", "product", "length", "platform", "post_url", "check"], need: CHECKED },
  "marketing.campaigns": { wait: ["Draft"], ok: "Approved", approvers: LEAD, key: ["channel", "goal", "audience", "start_date", "budget", "currency", "check"], need: CHECKED },
  "marketing.plan": { wait: ["Planned"], ok: "Approved", approvers: LEAD, key: ["kind", "period", "area", "planned", "currency", "kpi"] },
  "sales.proposals": { wait: ["Draft"], ok: "Approved", no: "Draft", approvers: LEAD, key: ["number", "client", "config", "qty", "unit_price", "discount", "value", "currency", "payment_terms", "valid_until"] },
  "legal.contracts": { wait: ["Drafting", "Counsel review"], ok: "Negotiation", approvers: LEAD, key: ["type", "counterparty", "amount", "currency", "schedule_days", "scope", "jurisdiction", "due"] },
  "marketing.brand": { wait: ["Draft"], ok: "Approved", approvers: LEAD, key: ["kind", "language", "text"] },
  // Phase 2: documents in the register; "request changes" sends the document back to Draft
  // Phase 4: an exact version is approved; the chain per document type is set in Administration → Departments & documents
  "company.documents": { wait: ["Draft", "In review", "Changes requested"], ok: "Approved", no: "Draft", changes: "Changes requested", approvers: LEAD, key: ["doc_number", "doc_type", "project_ref", "owner", "version", "classification", "description"] },
};
export const canSendForApproval = (section: string, status: string | null) => !!APPROVALS[section]?.wait.includes(status || "");
/** Missing precondition (e.g. the compliance check) → the field key, otherwise null. */
export const approvalNeeds = (section: string, data: Record<string, any> | null | undefined) => { const n = APPROVALS[section]?.need; return n && !n.in.includes(data?.[n.field]) ? n.field : null; };

/* ---------------- Approval limits by amount ---------------- */
// Spending above the self-approval amount must be approved, and only by people whose role covers that amount.
export type LimitTier = { up_to: number | null; roles: string[] };
export type Limits = { self_usd: number; tiers: LimitTier[] };
export const DEFAULT_LIMITS: Limits = { self_usd: 500, tiers: [
  { up_to: 5000, roles: ["finance", "management", "admin", "owner"] },
  { up_to: 50000, roles: ["management", "admin", "owner"] },
  { up_to: null, roles: ["owner"] },
] };
/** Sections with money limits: the amount field and the statuses that mean "approved to spend". */
export const LIMITED: Record<string, { amount: string; currency: string; guard: string[] }> = {
  "finance.expenses": { amount: "amount", currency: "currency", guard: ["Approved", "Paid"] },
  "operations.procurement": { amount: "amount", currency: "currency", guard: ["Approved", "Ordered", "Received"] },
};
const RATE: Record<string, number> = { USD: 1, AED: 3.6725, EUR: 0.92, GBP: 0.79 };
export const amountUsd = (section: string, data: Record<string, any>) => { const l = LIMITED[section]; if (!l) return 0; return (Number(data?.[l.amount]) || 0) / (RATE[String(data?.[l.currency] || "USD").toUpperCase()] || 1); };
/** Does this amount need an approval? */
export const overLimit = (section: string, data: Record<string, any>, lim: Limits = DEFAULT_LIMITS) => !!LIMITED[section] && amountUsd(section, data) > lim.self_usd;
/** Roles that may approve this amount (the first tier that covers it). */
export function limitRoles(section: string, data: Record<string, any>, lim: Limits = DEFAULT_LIMITS): string[] | null {
  if (!LIMITED[section]) return null; const a = amountUsd(section, data);
  return (lim.tiers.find((t) => t.up_to == null || a <= t.up_to) || lim.tiers[lim.tiers.length - 1]).roles;
}
export function withLimits(x: any): Limits {
  const d = DEFAULT_LIMITS; if (!x || typeof x !== "object") return d;
  const tiers = Array.isArray(x.tiers) && x.tiers.length ? x.tiers.map((t: any) => ({ up_to: t.up_to == null || t.up_to === "" ? null : Math.max(0, Number(t.up_to) || 0), roles: Array.isArray(t.roles) && t.roles.length ? t.roles.map(String) : ["owner"] })) : d.tiers;
  if (tiers[tiers.length - 1].up_to != null) tiers.push({ up_to: null, roles: ["owner"] }); // the top always has someone
  return { self_usd: Math.max(0, Number(x.self_usd ?? d.self_usd) || 0), tiers };
}
