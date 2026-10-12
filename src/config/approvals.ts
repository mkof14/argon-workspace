// One-click approvals: which sections can be sent for approval, from which statuses, and who may approve.
// ok/no = the status set on Approve / Reject (no `no` → the status stays and the decision is recorded).
export type ApprovalRule = { wait: string[]; ok: string; no?: string; approvers: string[]; key: string[] };
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
  "marketing.media": { wait: ["Draft"], ok: "Approved", approvers: ["owner", "admin", "management"], key: ["kind", "audience", "languages"] },
};
export const canSendForApproval = (section: string, status: string | null) => !!APPROVALS[section]?.wait.includes(status || "");
