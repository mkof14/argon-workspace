// Phase 6 — the browser's calls to the operations engine (v23). Every function works out the signed-in person on the
// server (auth.uid()) and returns only what that person may open; process steps, approvals, receiving and payments
// are changed only by these functions (direct edits of the protected values are refused by the database).
import { DEMO, sb } from "./sb";

const rpc = async <T = any>(fn: string, args: Record<string, any> = {}): Promise<T> => {
  if (DEMO) return (fn.endsWith("list") || fn === "ops_attention" || fn === "ops_deadlines" || fn === "ops_request_types" || fn === "wf_definitions_list" ? [] : null) as any;
  const { data, error } = await sb().rpc(fn, args); if (error) throw new Error(error.message); return data as T;
};

export type Outcome = "done" | "received" | "submit" | "approved" | "changes_requested" | "rejected" | "accept_partial" | "recheck" | "retry" | "cancelled" | string;

export const ops = {
  types: () => rpc<any[]>("ops_request_types"),
  create: (type: string, title: string, data: Record<string, any>, priority?: string | null) => rpc<{ record: string; instance: string; number: string; section: string }>("ops_request_create", { p_type: type, p_title: title, p_data: data, p_priority: priority || null }),
  mine: () => rpc<any>("ops_my_processes"),
  overview: () => rpc<any>("ops_overview"),
  list: (kind: string, n = 200, q?: string | null) => rpc<any[]>("ops_list", { p_kind: kind, p_limit: n, p_q: q || null }),
  attention: () => rpc<any[]>("ops_attention"),
  deadlines: (days = 30, q?: string | null) => rpc<any[]>("ops_deadlines", { p_days: days, p_q: q || null }),
  weekly: (from?: string | null, to?: string | null) => rpc<any>("ops_weekly", { p_from: from || null, p_to: to || null }),
  instance: (id: string) => rpc<any>("ops_instance", { p_id: id }),
  recordProcesses: (record: string) => rpc<any[]>("ops_record_processes", { p_record: record }),
  start: (code: string, record: string, priority?: string | null) => rpc<string>("wf_start", { p_code: code, p_record: record, p_priority: priority || null }),
  act: (run: string, outcome: Outcome, note?: string | null) => rpc<any>("wf_act", { p_run: run, p_outcome: outcome, p_note: note || null }),
  decide: (approval: string, decision: "approved" | "rejected" | "changes_requested", comment?: string | null) => rpc<any>("wf_approval_decide", { p_id: approval, p_decision: decision, p_comment: comment || null }),
  reassign: (run: string, user: string, note?: string | null) => rpc<any>("wf_reassign", { p_run: run, p_user: user, p_note: note || null }),
  cancel: (instance: string, note: string) => rpc<any>("wf_cancel", { p_inst: instance, p_note: note }),
  quotes: (request: string) => rpc<any>("ops_compare_quotes", { p_request: request }),
  selectQuote: (request: string, quote: string, reason: string) => rpc<any>("ops_select_quote", { p_request: request, p_quote: quote, p_reason: reason }),
  receive: (purchase: string, qty: number, rejected: number, condition: string, note?: string | null, date?: string | null) =>
    rpc<any>("ops_receive", { p_purchase: purchase, p_qty: qty, p_rejected: rejected, p_condition: condition, p_note: note || null, p_date: date || null }),
  recordPayment: (payment: string, paidOn: string, amount: number, reference: string, note?: string | null) =>
    rpc<any>("ops_record_payment", { p_payment: payment, p_paid_on: paidOn, p_amount: amount, p_reference: reference, p_note: note || null }),
  confirmImpact: (ecr: string, note?: string | null) => rpc<any>("ops_ecr_confirm_impact", { p_ecr: ecr, p_note: note || null }),
  impactCandidates: (ecr: string) => rpc<any[]>("ops_ecr_candidates", { p_ecr: ecr }),
  budget: (project?: string | null) => rpc<any>("ops_budget", { p_project: project || null }),
  party: (id: string) => rpc<any>("ops_party", { p_id: id }),
  proposals: (source: string) => rpc<any[]>("ops_proposals", { p_source: source }),
  decideProposal: (id: string, accept: boolean, values?: Record<string, any> | null, note?: string | null) => rpc<any>("ops_proposal_decide", { p_id: id, p_accept: accept, p_values: values || null, p_note: note || null }),
  async extract(source: string, kind: "quotation" | "obligation" | "invoice") {
    const r = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "extract", source, kind }) });
    if (!r.ok) throw new Error(await r.text()); return r.json();
  },
  assistant: (intent: string, arg?: string | null) => rpc<any>("ops_assistant", { p_intent: intent, p_arg: arg || null }),
  // the process builder (owners, administrators, management)
  definitions: () => rpc<any[]>("wf_definitions_list"),
  validate: (d: any) => rpc<any[]>("wf_validate", { d }),
  saveDefinition: (d: any) => rpc<any>("wf_definition_save", { p: d }),
  publish: (id: string) => rpc<any>("wf_definition_publish", { p_id: id }),
  newVersion: (code: string) => rpc<any>("wf_definition_new_version", { p_code: code }),
  enable: (code: string, on: boolean) => rpc<any>("wf_definition_disable", { p_code: code, p_on: on }),
  settings: () => rpc<any>("ops_settings_get"),
  saveSettings: (value: any, version: number) => rpc<any>("ops_settings_save", { p_value: value, p_version: version }),
  savePolicy: (code: string, name: string, tiers: any[], active = true) => rpc<any>("ops_policy_save", { p_code: code, p_name: name, p_tiers: tiers, p_active: active }),
};
