// Department agents: what each department's agent notices and what it proposes.
// Pure functions over records (no I/O, no local imports), so the rules are tested directly; the server executes the result.
import type { Action } from "./automation";

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any>; controlled?: boolean; created_at?: string; updated_at?: string };
export type Th = { remind_before: number; escalate_after: number; stalled_deal: number };
/**
 * One thing an agent noticed.
 * who: "owner" (the person named in the record), "role:<role>" or "leads"; key: raised once, then again every `repeat` days while still true.
 * action: an optional change (created / set / email) that runs or waits for approval according to the agent's mode.
 */
export type Finding = { rec: R; level: "info" | "warn" | "bad"; text: string; who: string[]; key: string; repeat?: number; action?: Action; why?: string };

export const addDays = (d: string, n: number) => { const t = new Date(String(d).slice(0, 10) + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const days = (from: string, to: string) => Math.round((Date.parse(String(to).slice(0, 10) + "T12:00:00Z") - Date.parse(String(from).slice(0, 10) + "T12:00:00Z")) / 864e5);
const isDate = (v: any) => /^\d{4}-\d{2}-\d{2}/.test(String(v || ""));
const age = (r: R, today: string) => days(String(r.updated_at || r.created_at || today), today);
const created = (r: R, today: string) => days(String(r.created_at || today), today);
export const emailIn = (s: any) => (String(s || "").match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [""])[0];
const money = (n: any, cur?: string) => `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${cur || "USD"}`;
const of = (all: R[], s: string) => all.filter((r) => r.section === s);
/** Warning steps for a coming date: one notice at each step (e.g. 30, 7, 0 days before) and when it passes. */
export function stepFor(d: number, steps: number[]): string | null {
  if (d < 0) return "late";
  const s = [...steps].sort((a, b) => a - b).find((x) => d <= x);
  return s === undefined ? null : `d${s}`;
}

/* ---------------- Finance ---------------- */
/** Finds the client's email for an invoice: invoice → deal → client card, or a client card with the counterparty's name. */
export function clientEmail(inv: R, all: R[]) {
  const deal = all.find((r) => r.id === inv.data?.deal_ref);
  const client = all.find((r) => r.section === "sales.clients" && (r.id === deal?.data?.client_ref || (inv.data?.counterparty && r.title.trim().toLowerCase() === String(inv.data.counterparty).trim().toLowerCase())));
  const lead = all.find((r) => r.id === deal?.data?.lead_ref);
  return emailIn(client?.data?.contact) || emailIn(lead?.data?.email) || "";
}

export function financeFindings(all: R[], today: string, th: Th): Finding[] {
  const out: Finding[] = [];
  // Invoices: mark overdue, remind the client (after approval), warn about payables
  for (const r of of(all, "finance.invoices")) {
    const due = r.data?.due; if (!isDate(due) || ["Paid", "Draft"].includes(r.status || "")) continue;
    const late = days(due, today); const sum = money(r.data?.amount, r.data?.currency); const recv = r.data?.direction !== "Payable";
    if (late > 0 && r.status !== "Overdue") out.push({ rec: r, level: "warn", who: ["role:finance"], key: `fin-over|${r.id}`, text: `Invoice “${r.title}” (${sum}) is overdue since ${due}.`, action: { type: "set", field: "status", value: "Overdue" }, why: "Due date passed" });
    if (recv && late >= 7) {
      const to = clientEmail(r, all);
      out.push({ rec: r, level: late >= 30 ? "bad" : "warn", who: late >= 30 ? ["role:finance", "leads"] : ["role:finance"], key: `fin-remind|${r.id}`, repeat: 14,
        text: `Client has not paid “${r.title}” (${sum}) for ${late} days.${to ? " A polite reminder email is prepared for approval." : " No client email found — add it to the client card."}`,
        action: to ? { type: "email", to_field: "", to, subject: `Payment reminder — ${r.title}`, body: `Dear client,\n\nOur records show that invoice **${r.title}** for **${sum}**, due on ${due}, is still open.\n\nIf the payment has already been sent, please ignore this message and share the payment reference. Otherwise, we would be grateful for payment at your earliest convenience.\n\nThank you.` } : undefined, why: `Receivable ${late} days overdue` });
    }
    if (!recv && late <= 0 && late >= -th.remind_before) out.push({ rec: r, level: "info", who: ["role:finance"], key: `fin-pay|${r.id}`, repeat: 30, text: `We must pay “${r.title}” (${sum}) by ${due}.` });
  }
  // Expenses waiting for a decision or for payment
  for (const r of of(all, "finance.expenses")) {
    if (r.status === "Submitted" && created(r, today) >= 3) out.push({ rec: r, level: "warn", who: ["role:finance"], key: `fin-exp|${r.id}`, text: `Expense “${r.title}” (${money(r.data?.amount, r.data?.currency)}) waits for approval ${created(r, today)} days.` });
    if (r.status === "Approved" && age(r, today) >= 14) out.push({ rec: r, level: "warn", who: ["role:finance"], key: `fin-exppay|${r.id}`, text: `Approved expense “${r.title}” is not paid for ${age(r, today)} days${r.data?.requester ? ` (${r.data.requester})` : ""}.` });
  }
  // Budget lines over plan
  for (const r of of(all, "finance.budget")) {
    const plan = Number(r.data?.planned) || 0, act = Number(r.data?.actual) || 0;
    if (plan > 0 && act > plan && !["Over budget", "Closed"].includes(r.status || "")) out.push({ rec: r, level: "bad", who: ["role:finance", "leads"], key: `fin-budget|${r.id}`, text: `Budget “${r.title}” is over plan by ${Math.round(((act - plan) / plan) * 100)}% (${money(act - plan, r.data?.currency)}).`, action: { type: "set", field: "status", value: "Over budget" }, why: "Actual above planned" });
  }
  // Tax filings and insurance renewals
  for (const r of of(all, "finance.tax")) {
    if (r.status === "Filed" || !isDate(r.data?.due)) continue;
    const st = stepFor(days(today, r.data.due), [30, 14, 3]); if (!st) continue;
    out.push({ rec: r, level: st === "late" || st === "d3" ? "bad" : "warn", who: st === "late" ? ["role:finance", "leads"] : ["role:finance", "owner"], key: `fin-tax|${r.id}|${st}`, repeat: st === "late" ? 3 : 365, text: st === "late" ? `Tax filing “${r.title}” was due on ${r.data.due} and is not filed.` : `Tax filing “${r.title}” (${r.data?.jurisdiction || ""}) is due on ${r.data.due}.` });
  }
  for (const r of of(all, "finance.insurance")) {
    if (!isDate(r.data?.renewal) || ["Expired"].includes(r.status || "")) continue;
    const d = days(today, r.data.renewal); const st = stepFor(d, [60, 30, 7]); if (!st) continue;
    out.push({ rec: r, level: d <= 7 ? "bad" : "warn", who: d <= 7 ? ["role:finance", "leads"] : ["role:finance"], key: `fin-ins|${r.id}|${st}`, repeat: 365, text: d < 0 ? `Insurance “${r.title}” renewal date ${r.data.renewal} has passed — check cover.` : `Insurance “${r.title}” (${r.data?.type || ""}) renews on ${r.data.renewal}.`,
      action: r.status === "Active" && d <= 60 ? { type: "set", field: "status", value: "Renewal due" } : undefined, why: "Renewal within 60 days" });
  }
  // Cash runway from the latest monthly KPIs (cash ÷ net burn)
  const kpi = of(all, "finance.metrics").filter((r) => Number(r.data?.cash) > 0 && Number(r.data?.burn) > 0).sort((a, b) => String(b.data?.period || b.title).localeCompare(String(a.data?.period || a.title)))[0];
  if (kpi) {
    const months = Number(kpi.data.cash) / Number(kpi.data.burn);
    if (months < 6) out.push({ rec: kpi, level: months < 3 ? "bad" : "warn", who: ["leads", "role:finance"], key: `fin-runway|${kpi.id}`, repeat: 30, text: `Cash runway is about ${months.toFixed(1)} months (cash ${money(kpi.data.cash)}, net burn ${money(kpi.data.burn)} a month, ${kpi.title}).` });
  }
  return out;
}

/* ---------------- Sales ---------------- */
const SITE = "https://workspace.agron1.com";
const link = (r: R) => `${SITE}/${r.section.replace(".", "/")}?r=${r.id}`;
const openTask = (all: R[], title: string) => all.some((t) => t.section === "company.tasks" && t.status !== "Done" && t.title.trim().toLowerCase() === title.trim().toLowerCase());

export function salesFindings(all: R[], today: string, th: Th): Finding[] {
  const out: Finding[] = [];
  const deals = of(all, "sales.pipeline"); const open = deals.filter((d) => !["Won", "Lost"].includes(d.status || ""));
  // Deals without movement get a follow-up task for their owner
  for (const d of open) {
    const idle = age(d, today); if (idle < th.stalled_deal) continue;
    const title = `Follow up — ${d.title}`;
    out.push({ rec: d, level: idle >= th.stalled_deal * 2 ? "bad" : "warn", who: ["owner"], key: `sal-stall|${d.id}`, text: `Deal “${d.title}” (${d.status}) has had no movement for ${idle} days.`,
      action: openTask(all, title) ? undefined : { type: "create", section: "company.tasks", title, status: "Open", fields: { assignee: "{owner}", due: addDays(today, 2), priority: "High", related: link(d), notes: "Call or write to the client and record the next step in the deal." } }, why: `${idle} days without movement` });
  }
  // Qualified leads become deals; new leads must be contacted within two days
  for (const l of of(all, "marketing.leads")) {
    if (l.status === "New" && created(l, today) >= 2) out.push({ rec: l, level: "warn", who: ["owner", "role:sales"], key: `sal-lead|${l.id}`, repeat: 3, text: `New lead “${l.title}” (${l.data?.source || "unknown source"}) has not been contacted for ${created(l, today)} days.` });
    if (["Qualified", "To pipeline"].includes(l.status || "") && !deals.some((d) => d.data?.lead_ref === l.id))
      out.push({ rec: l, level: "info", who: ["role:sales"], key: `sal-todeal|${l.id}`, text: `Qualified lead “${l.title}” has no deal yet — a deal is prepared.`,
        action: { type: "create", section: "sales.pipeline", title: "{title}", status: "Qualified", link: "lead_ref", fields: { client: "{title}", country: "{country}", owner: "{owner}", notes: "Created from the qualified lead. Contact: {contact} {email}" } }, why: "Lead qualified" });
  }
  // Proposals: expiring, expired, accepted
  for (const p of of(all, "sales.proposals")) {
    if (p.status === "Sent" && isDate(p.data?.valid_until)) {
      const d = days(today, p.data.valid_until);
      if (d >= 0 && d <= 5) out.push({ rec: p, level: "warn", who: ["owner", "role:sales"], key: `sal-valid|${p.id}`, repeat: 30, text: `Proposal “${p.title}” is valid until ${p.data.valid_until} — ask the client for a decision.` });
      if (d < 0) out.push({ rec: p, level: "warn", who: ["owner", "role:sales"], key: `sal-expired|${p.id}`, repeat: 30, text: `Proposal “${p.title}” expired on ${p.data.valid_until} without an answer — extend or close it.` });
    }
    const deal = deals.find((d) => d.id === p.data?.deal_ref);
    if (p.status === "Accepted" && deal && ["Lead", "Qualified", "Proposal"].includes(deal.status || ""))
      out.push({ rec: deal, level: "info", who: ["owner", "role:sales"], key: `sal-acc|${p.id}`, text: `Proposal “${p.title}” was accepted — deal “${deal.title}” moves to Negotiation.`, action: { type: "set", field: "status", value: "Negotiation" }, why: "Proposal accepted" });
  }
  // Data the next steps need
  for (const d of deals) {
    if (d.status === "Won" && !Number(d.data?.value)) out.push({ rec: d, level: "warn", who: ["owner", "role:finance"], key: `sal-noval|${d.id}`, text: `Won deal “${d.title}” has no value — the invoice cannot be prepared.` });
    if (["Negotiation", "Won"].includes(d.status || "") && !d.data?.client_ref) out.push({ rec: d, level: "info", who: ["owner"], key: `sal-noclient|${d.id}`, repeat: 14, text: `Deal “${d.title}” is not linked to a client card — link or create it so contracts, invoices and service find the client.` });
  }
  // Tenders and meetings
  for (const t of of(all, "sales.tenders")) {
    if (!["Identified", "Preparing"].includes(t.status || "") || !isDate(t.data?.deadline)) continue;
    const st = stepFor(days(today, t.data.deadline), [14, 7, 2]); if (!st || st === "late") continue;
    out.push({ rec: t, level: st === "d2" ? "bad" : "warn", who: ["owner", "role:sales"], key: `sal-tender|${t.id}|${st}`, repeat: 365, text: `Tender “${t.title}” (${t.data?.buyer || ""}) closes on ${t.data.deadline}.` });
  }
  for (const a of of(all, "sales.activities")) {
    if (a.status === "Planned" && isDate(a.data?.date) && days(a.data.date, today) >= 1) out.push({ rec: a, level: "info", who: ["owner"], key: `sal-outcome|${a.id}`, repeat: 3, text: `${a.data?.type || "Activity"} “${a.title}” on ${a.data.date} — record the outcome and the next step.` });
    const next = String(a.data?.next_step || "").trim();
    if (a.status === "Done" && next && days(String(a.updated_at || today), today) <= 14) {
      const title = `Next step: ${next.slice(0, 80)} — ${a.data?.client || a.title}`;
      if (!openTask(all, title) && !all.some((t) => t.section === "company.tasks" && t.title === title))
        out.push({ rec: a, level: "info", who: ["owner"], key: `sal-next|${a.id}`, repeat: 365, text: `Next step after “${a.title}”: ${next}. A task is prepared.`, action: { type: "create", section: "company.tasks", title, status: "Open", fields: { assignee: "{owner}", due: addDays(today, 3), priority: "Medium", related: link(a) } }, why: "Next step recorded" });
    }
  }
  return out;
}

/* ---------------- Operations ---------------- */
export function operationsFindings(all: R[], today: string, _th: Th): Finding[] {
  const out: Finding[] = [];
  const builds = of(all, "operations.builds"); const byId = new Map(all.map((r) => [r.id, r]));
  const linked = (sec: string, key: string, id: string) => all.filter((r) => r.section === sec && r.data?.[key] === id);
  // Export control before anything ships
  for (const b of builds) if (["Shipping", "Testing"].includes(b.status || "") && b.data?.export_check !== "Cleared")
    out.push({ rec: b, level: b.status === "Shipping" ? "bad" : "warn", who: b.status === "Shipping" ? ["leads", "role:security", "role:operations"] : ["role:operations", "role:security"], key: `ops-export|${b.id}|${b.status}`, repeat: 3, text: `Build “${b.title}” is at ${b.status} but the export check is “${b.data?.export_check || "Not started"}”. It must not ship until cleared.` });
  for (const l of of(all, "operations.logistics")) {
    const b = byId.get(l.data?.build_ref);
    if (["In transit", "Customs"].includes(l.status || "") && b && b.data?.export_check !== "Cleared") out.push({ rec: l, level: "bad", who: ["leads", "role:security"], key: `ops-ship-exp|${l.id}`, repeat: 3, text: `Shipment “${l.title}” is ${l.status} while build “${b.title}” has no export clearance.` });
    if (["In transit", "Customs"].includes(l.status || "") && isDate(l.data?.due) && days(l.data.due, today) >= 1) out.push({ rec: l, level: "warn", who: ["role:operations"], key: `ops-late|${l.id}`, repeat: 3, text: `Shipment “${l.title}” (${l.data?.carrier || ""} ${l.data?.tracking || ""}) was due on ${l.data.due} and is still ${l.status}.` });
    // Delivered → installation is planned for the build
    if (l.status === "Delivered" && b && b.status !== "Installed" && !linked("operations.installation", "build_ref", b.id).length)
      out.push({ rec: b, level: "info", who: ["role:operations"], key: `ops-inst|${b.id}`, text: `Build “${b.title}” is delivered — an installation record is prepared.`, action: { type: "create", section: "operations.installation", title: "Installation — {title}", status: "Planned", link: "build_ref", fields: { site: "{site}", owner: "{owner}", due: addDays(today, 14) } }, why: "Shipment delivered" });
  }
  // Commissioned → build installed, unit added to the fleet with warranty and first service
  for (const i of of(all, "operations.installation")) {
    const b = byId.get(i.data?.build_ref); if (i.status !== "Commissioned" || !b) continue;
    if (b.status !== "Installed") out.push({ rec: b, level: "info", who: ["role:operations"], key: `ops-done|${b.id}`, text: `Installation “${i.title}” is commissioned — build “${b.title}” moves to Installed.`, action: { type: "set", field: "status", value: "Installed" }, why: "Installation commissioned" });
    if (!linked("operations.fleet", "build_ref", b.id).length) out.push({ rec: b, level: "info", who: ["role:operations"], key: `ops-fleet|${b.id}`, text: `“${b.title}” is commissioned — the unit is added to the fleet with a 12-month warranty and a service in 6 months.`,
      action: { type: "create", section: "operations.fleet", title: "{title}", status: "Active", link: "build_ref", fields: { client: "{client}", site: "{site}", config: "{config}", commissioned: today, warranty_end: addDays(today, 365), next_service: addDays(today, 182) } }, why: "Installation commissioned" });
  }
  // Fleet: service and warranty
  for (const u of of(all, "operations.fleet")) {
    if (u.status === "Decommissioned") continue;
    if (isDate(u.data?.next_service)) {
      const d = days(today, u.data.next_service);
      if (d <= 14) {
        const title = `Scheduled service — ${u.title}`;
        const has = all.some((t) => t.section === "operations.support" && t.data?.unit_ref === u.id && t.title === title && t.status !== "Resolved");
        out.push({ rec: u, level: d < 0 ? "warn" : "info", who: ["role:operations"], key: `ops-svc|${u.id}|${u.data.next_service}`, repeat: d < 0 ? 7 : 365, text: d < 0 ? `Service of “${u.title}” was due on ${u.data.next_service}.` : `Service of “${u.title}” (${u.data?.site || u.data?.client || ""}) is due on ${u.data.next_service} — a service ticket is prepared.`,
          action: has ? (u.status === "Active" ? { type: "set", field: "status", value: "Maintenance due" } : undefined) : { type: "create", section: "operations.support", title, status: "New", link: "unit_ref", fields: { client: "{client}", severity: "Medium", notes: "Planned maintenance. Site: {site}. SLA: {sla}." } }, why: "Service date close" });
      }
    }
    if (isDate(u.data?.warranty_end)) {
      const st = stepFor(days(today, u.data.warranty_end), [60, 14]);
      if (st) out.push({ rec: u, level: "info", who: ["role:sales", "role:operations"], key: `ops-warr|${u.id}|${st}`, repeat: 365, text: st === "late" ? `Warranty of “${u.title}” ended on ${u.data.warranty_end} — offer a service contract.` : `Warranty of “${u.title}” ends on ${u.data.warranty_end} — a good moment to offer a service contract (${u.data?.sla || "no SLA"}).` });
    }
  }
  // Purchasing, support, quality, repairs
  for (const p of of(all, "operations.procurement")) {
    if (p.status === "Approved" && age(p, today) >= 5) out.push({ rec: p, level: "warn", who: ["role:operations"], key: `ops-po|${p.id}`, text: `Purchase “${p.title}” was approved ${age(p, today)} days ago and is not ordered yet.` });
    if (p.status === "Ordered" && isDate(p.data?.eta) && days(p.data.eta, today) >= 1) out.push({ rec: p, level: "warn", who: ["role:operations"], key: `ops-eta|${p.id}`, repeat: 3, text: `“${p.title}” from ${p.data?.vendor || "the vendor"} was expected on ${p.data.eta} and is not received.` });
  }
  for (const s of of(all, "operations.support")) {
    if (s.status === "Resolved") continue; const a = created(s, today); const sev = s.data?.severity;
    if (sev === "Critical" && a >= 1) out.push({ rec: s, level: "bad", who: ["leads", "role:operations"], key: `ops-crit|${s.id}`, repeat: 1, text: `Critical ticket “${s.title}” (${s.data?.client || ""}) is open for ${a} day(s).` });
    else if (sev === "High" && a >= 3) out.push({ rec: s, level: "warn", who: ["role:operations", "owner"], key: `ops-high|${s.id}`, repeat: 3, text: `High-severity ticket “${s.title}” is open for ${a} days.` });
    else if (a >= 14) out.push({ rec: s, level: "warn", who: ["owner", "role:operations"], key: `ops-old|${s.id}`, text: `Ticket “${s.title}” is open for ${a} days.` });
  }
  for (const q of of(all, "operations.quality")) if (["Non-conformance", "Corrective action"].includes(q.status || "") && age(q, today) >= 7) out.push({ rec: q, level: "warn", who: ["owner", "role:operations"], key: `ops-ncr|${q.id}`, text: `${q.status} “${q.title}” (${q.data?.build || ""}) has not moved for ${age(q, today)} days.` });
  for (const v of of(all, "operations.inventory")) if (v.status === "In repair" && age(v, today) >= 14) out.push({ rec: v, level: "info", who: ["role:operations"], key: `ops-rep|${v.id}`, text: `“${v.title}” (${v.data?.serial || ""}) is in repair for ${age(v, today)} days.` });
  return out;
}
