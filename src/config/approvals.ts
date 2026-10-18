// One-click approvals: which sections can be sent for approval, from which statuses, and who may approve.
// ok/no = the status set on Approve / Reject (no `no` → the status stays and the decision is recorded).
// need = a field value required before the request can be sent (marketing: the compliance check).
export type ApprovalRule = { wait: string[]; ok: string; no?: string; approvers: string[]; key: string[]; need?: { field: string; in: string[] } };
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
  "marketing.brand": { wait: ["Draft"], ok: "Approved", approvers: LEAD, key: ["kind", "language", "text"] },
};
export const canSendForApproval = (section: string, status: string | null) => !!APPROVALS[section]?.wait.includes(status || "");
/** Missing precondition (e.g. the compliance check) → the field key, otherwise null. */
export const approvalNeeds = (section: string, data: Record<string, any> | null | undefined) => { const n = APPROVALS[section]?.need; return n && !n.in.includes(data?.[n.field]) ? n.field : null; };
