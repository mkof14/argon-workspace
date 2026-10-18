// Department agents: what each department's agent notices and what it proposes.
// Pure functions over records (no I/O, no local imports), so the rules are tested directly; the server executes the result.
import type { Action } from "./automation";

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any>; controlled?: boolean; created_at?: string; updated_at?: string };
export type Th = { remind_before: number; escalate_after: number; stalled_deal: number; /** 90-day forecast, computed by the caller (lib/cashforecast) */ cash?: { opening: number | null; gap: { week: number; start: string; balance: number } | null; lines: { id: string; title: string; usd: number; date: string; kind: string }[] } };
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
  // 90-day cash forecast: a gap ahead (certain money only — probable deals do not count)
  const cf = th.cash;
  if (cf?.gap && cf.opening != null) {
    const big = cf.lines.filter((l) => l.kind === "out" && l.date >= cf.gap!.start).sort((a, b) => b.usd - a.usd)[0];
    const base: any = of(all, "finance.metrics").find((r) => Number(r.data?.cash)) || all.find((r) => r.id === big?.id);
    if (base) out.push({ rec: { ...base, data: { ...base.data, gap_from: cf.gap.start, gap_balance: money(cf.gap.balance), gap_payment: big ? `${big.title} (${money(big.usd)})` : "" } }, level: cf.gap.week <= 4 ? "bad" : "warn", who: ["leads", "role:finance"], key: `fin-gap|${cf.gap.start}`, repeat: 7,
      text: `Cash gap ahead: from the week of ${cf.gap.start} the balance falls to ${money(cf.gap.balance)}${big ? `; the largest payment is ${big.title} (${money(big.usd)})` : ""}. Collect receivables or move payments now.` });
  }
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

/* ---------------- HR ---------------- */
// Never puts pay, documents or personal details into notices: names and dates only.
export function hrFindings(all: R[], today: string, _th: Th): Finding[] {
  const out: Finding[] = [];
  const has = (sec: string, title: string) => all.some((r) => r.section === sec && r.title.trim().toLowerCase() === title.trim().toLowerCase());
  const person = (r: R, name: string) => String(r.data?.person || "").trim().toLowerCase() === name.trim().toLowerCase();
  for (const p of of(all, "hr.team")) {
    const n = p.title; const live = ["Active", "Onboarding", "On leave"].includes(p.status || "");
    if (p.status === "Onboarding" && !has("hr.onboarding", `Onboarding — ${n}`) && !of(all, "hr.onboarding").some((o) => person(o, n)))
      out.push({ rec: p, level: "info", who: ["role:hr"], key: `hr-onb|${p.id}`, text: `${n} is onboarding without a checklist — one is prepared.`, action: { type: "create", section: "hr.onboarding", title: "Onboarding — {title}", status: "To do", fields: { person: "{title}", due: isDate(p.data?.start) ? addDays(p.data.start, 5) : addDays(today, 5) } }, why: "Status Onboarding" });
    if (live && isDate(p.data?.probation)) {
      const d = days(today, p.data.probation); const title = `Probation review — ${n}`;
      if (d >= 0 && d <= 14 && !has("company.tasks", title)) out.push({ rec: p, level: "info", who: ["role:hr"], key: `hr-prob|${p.id}`, text: `Probation of ${n} ends on ${p.data.probation} — a review task for ${p.data?.manager || "the manager"} is prepared.`, action: { type: "create", section: "company.tasks", title, status: "Open", fields: { assignee: "{manager}", due: p.data.probation, priority: "High", notes: "Decide: confirm, extend or end. Record the result in the team card." } }, why: "Probation ends soon" });
    }
    if (live && isDate(p.data?.expires)) {
      const st = stepFor(days(today, p.data.expires), [90, 30, 7]);
      if (st) out.push({ rec: p, level: st === "late" || st === "d7" ? "bad" : "warn", who: st === "d90" ? ["role:hr"] : ["role:hr", "leads"], key: `hr-auth|${p.id}|${st}`, repeat: st === "late" ? 3 : 365, text: st === "late" ? `Work authorization of ${n} expired on ${p.data.expires}.` : `Work authorization of ${n} expires on ${p.data.expires} — start the renewal.` });
    }
    if (live && p.data?.location === "United States" && p.data?.type === "Employee") {
      if (!p.data?.i9 && isDate(p.data?.start) && days(p.data.start, today) >= 3) out.push({ rec: p, level: "bad", who: ["role:hr"], key: `hr-i9|${p.id}`, text: `Form I-9 for ${n} is not marked done — it is due within 3 business days of the start date (${p.data.start}).` });
      if (!p.data?.ciiaa) out.push({ rec: p, level: "warn", who: ["role:hr"], key: `hr-ciiaa|${p.id}`, repeat: 14, text: `${n} has no signed confidentiality and invention assignment agreement on record.` });
    }
    if (p.status === "Left") {
      if (!has("hr.offboarding", `Offboarding — ${n}`) && !of(all, "hr.offboarding").some((o) => person(o, n)))
        out.push({ rec: p, level: "warn", who: ["role:hr"], key: `hr-off|${p.id}`, text: `${n} has left — an offboarding checklist is prepared.`, action: { type: "create", section: "hr.offboarding", title: "Offboarding — {title}", status: "Planned", fields: { person: "{title}", due: addDays(today, 3) } }, why: "Status Left" });
      if (!has("security.access", `Revoke access — ${n}`))
        out.push({ rec: p, level: "bad", who: ["role:security", "role:hr"], key: `hr-revoke|${p.id}`, text: `${n} has left — remove access to Workspace, email, drives and company systems today.`, action: { type: "create", section: "security.access", title: "Revoke access — {title}", status: "Scheduled", fields: { system: "Workspace, Google Workspace, drives, GitHub, Vercel, Supabase, bank and government portals", due: today, notes: "Person left the company. Remove or transfer every access; record what was removed." } }, why: "Status Left" });
      const kept = of(all, "hr.assets").filter((a) => a.status === "Issued" && person(a, n));
      if (kept.length) out.push({ rec: p, level: "warn", who: ["role:hr"], key: `hr-assets|${p.id}`, text: `${n} has left but still holds ${kept.length} company item(s): ${kept.map((a) => a.data?.item || a.title).join(", ")}.` });
    }
  }
  for (const o of of(all, "hr.onboarding")) {
    if (o.status !== "Done" && isDate(o.data?.due) && days(o.data.due, today) >= 1) out.push({ rec: o, level: "warn", who: ["role:hr", "owner"], key: `hr-onblate|${o.id}`, text: `Onboarding “${o.title}” was due on ${o.data.due} and is not done.` });
    if (o.status === "Done" && (!o.data?.nda || !o.data?.export_briefing)) out.push({ rec: o, level: "bad", who: ["role:hr", "role:security"], key: `hr-onbgap|${o.id}`, repeat: 14, text: `Onboarding “${o.title}” is closed without ${[!o.data?.nda && "a signed NDA", !o.data?.export_briefing && "the export-control briefing"].filter(Boolean).join(" and ")}.` });
  }
  for (const t of of(all, "hr.training")) {
    if (!isDate(t.data?.expires) || t.status === "Expired") continue;
    const d = days(today, t.data.expires);
    if (d < 0 && t.status === "Certified") out.push({ rec: t, level: "warn", who: ["role:hr"], key: `hr-trexp|${t.id}`, text: `Training “${t.title}” of ${t.data?.person || ""} expired on ${t.data.expires}.`, action: { type: "set", field: "status", value: "Expired" }, why: "Certificate expired" });
    else if (d >= 0 && d <= 30) out.push({ rec: t, level: "info", who: ["role:hr", "owner"], key: `hr-tr|${t.id}`, repeat: 30, text: `Training “${t.title}” of ${t.data?.person || ""} expires on ${t.data.expires} — book the refresher.` });
  }
  for (const l of of(all, "hr.leave")) if (l.status === "Requested" && created(l, today) >= 2) out.push({ rec: l, level: "warn", who: ["role:hr"], key: `hr-leave|${l.id}`, repeat: 2, text: `Leave request of ${l.data?.person || l.title} (${l.data?.from || ""} – ${l.data?.to || ""}) waits for a decision ${created(l, today)} days.` });
  for (const c of of(all, "hr.candidates")) {
    if (c.status === "Offer" && age(c, today) >= 7) out.push({ rec: c, level: "warn", who: ["role:hr"], key: `hr-offer|${c.id}`, text: `Offer to ${c.title} (${c.data?.position || ""}) has no answer for ${age(c, today)} days.` });
    if (["Applied", "Screening", "Interview"].includes(c.status || "") && age(c, today) >= 10) out.push({ rec: c, level: "info", who: ["role:hr"], key: `hr-cand|${c.id}`, text: `Candidate ${c.title} (${c.data?.position || ""}) has waited ${age(c, today)} days at ${c.status} — reply or move on.` });
  }
  for (const h of of(all, "hr.hiring")) if (h.status === "Open" && !Number(h.data?.candidates) && created(h, today) >= 21) out.push({ rec: h, level: "info", who: ["role:hr", "owner"], key: `hr-hire|${h.id}`, repeat: 14, text: `Position “${h.title}” is open ${created(h, today)} days with no candidates — widen the search.` });
  for (const v of of(all, "hr.reviews")) if (["Planned", "Self-review", "Manager review"].includes(v.status || "") && age(v, today) >= 30) out.push({ rec: v, level: "info", who: ["owner", "role:hr"], key: `hr-rev|${v.id}`, text: `Review of ${v.data?.person || v.title} is stuck at ${v.status} for ${age(v, today)} days.` });
  for (const c of of(all, "hr.compensation")) if (c.status === "Proposed" && age(c, today) >= 7) out.push({ rec: c, level: "info", who: ["leads"], key: `hr-comp|${c.id}`, text: `A compensation proposal (${c.data?.person || c.title}) waits for approval ${age(c, today)} days.` });
  return out;
}

/* ---------------- Legal ---------------- */
export const addMonths = (d: string, n: number) => { const [y, m, day] = String(d).slice(0, 10).split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(day, last)); return t.toISOString().slice(0, 10); };
const EVERY: Record<string, number> = { Monthly: 1, Quarterly: 3, Annual: 12 };
/** Dated legal items: section → date field, statuses that close it, and the status to set when renewal is near. */
const LEGAL_DATES: [string, string, string[], string, string?][] = [
  ["legal.licences", "expires", ["Expired", "Denied", "Not started"], "Licence or permit", "Renewal due"],
  ["legal.hse", "expires", ["Expired", "Identify"], "HSE permit", "Renewal due"],
  ["legal.authority", "expires", ["Revoked", "Draft"], "Signing authority / POA", "Expiring"],
  ["legal.corporate", "due", [], "Corporate filing", "Renewal due"],
  ["legal.trademarks", "due", ["Refused"], "Trademark deadline"],
  ["legal.obligations", "due", ["Done", "Not applicable"], "Obligation"],
  ["legal.programs", "next_review", ["To draft"], "Compliance program review"],
  ["legal.board", "due", ["Minutes signed", "Held", "Minutes drafted"], "Board / stockholder meeting"],
  ["legal.ip", "due", ["Closed"], "IP item"],
];
const FROM: Record<string, string[]> = { "Renewal due": ["Granted", "Active"], Expiring: ["Active"] };

export function legalFindings(all: R[], today: string, _th: Th): Finding[] {
  const out: Finding[] = [];
  for (const [sec, key, closed, what, renew] of LEGAL_DATES) for (const r of of(all, sec)) {
    if (closed.includes(r.status || "") || !isDate(r.data?.[key])) continue;
    const d = days(today, r.data[key]); const st = stepFor(d, [60, 30, 7]); if (!st) continue;
    out.push({ rec: r, level: st === "late" || st === "d7" ? "bad" : st === "d30" ? "warn" : "info", who: st === "late" || st === "d7" ? ["role:legal", "owner", "leads"] : ["role:legal", "owner"], key: `leg-date|${r.id}|${st}`, repeat: st === "late" ? 3 : 365,
      text: st === "late" ? `${what} “${r.title}” — date ${r.data[key]} has passed.` : `${what} “${r.title}” — ${r.data[key]} (in ${d} days).`,
      action: renew && d <= 60 && FROM[renew]?.includes(r.status || "") ? { type: "set", field: "status", value: renew } : undefined, why: "Renewal window" });
  }
  // Recurring obligations: when one is done, the next one is created
  for (const o of of(all, "legal.obligations")) {
    const n = EVERY[o.data?.frequency]; if (o.status !== "Done" || !n || !isDate(o.data?.due)) continue;
    const next = addMonths(o.data.due, n);
    if (all.some((x) => x.section === "legal.obligations" && x.title === o.title && String(x.data?.due || "") >= next)) continue;
    out.push({ rec: o, level: "info", who: ["role:legal"], key: `leg-next|${o.id}|${next}`, repeat: 365, text: `${o.data.frequency} obligation “${o.title}” is done — the next one (due ${next}) is prepared.`,
      action: { type: "create", section: "legal.obligations", title: "{title}", status: "Upcoming", fields: { jurisdiction: "{jurisdiction}", area: "{area}", frequency: "{frequency}", due: next, owner: "{owner}", basis: "{basis}" } }, why: "Recurring obligation" });
  }
  // Requests and issues
  for (const q of of(all, "legal.requests")) {
    if (["Answered", "Closed"].includes(q.status || "")) continue;
    if (q.status === "New" && created(q, today) >= 2) out.push({ rec: q, level: "warn", who: ["role:legal"], key: `leg-new|${q.id}`, repeat: 2, text: `Legal request “${q.title}” from ${q.data?.requester || "a colleague"} is not triaged for ${created(q, today)} days.` });
    if (isDate(q.data?.due) && days(q.data.due, today) >= 1) out.push({ rec: q, level: q.data?.priority === "Critical" ? "bad" : "warn", who: ["role:legal", "owner"], key: `leg-reqlate|${q.id}`, repeat: 3, text: `Legal request “${q.title}” was due on ${q.data.due}.` });
    else if (q.data?.priority === "Critical" && created(q, today) >= 1) out.push({ rec: q, level: "bad", who: ["role:legal", "leads"], key: `leg-crit|${q.id}`, repeat: 2, text: `Critical legal request “${q.title}” is open for ${created(q, today)} day(s).` });
  }
  for (const i of of(all, "legal.issues")) if (i.status !== "Resolved" && ["High", "Critical"].includes(i.data?.priority) && age(i, today) >= 7) out.push({ rec: i, level: "bad", who: ["leads", "role:legal"], key: `leg-issue|${i.id}`, text: `${i.data.priority} legal issue “${i.title}” has not moved for ${age(i, today)} days.` });
  // Contracts behind the deals
  const contracts = of(all, "legal.contracts");
  for (const d of of(all, "sales.pipeline").filter((x) => x.status === "Won")) {
    const cs = contracts.filter((c) => c.data?.deal_ref === d.id);
    if (!cs.some((c) => c.status === "Signed")) out.push({ rec: d, level: "warn", who: ["role:legal", "owner"], key: `leg-nocontract|${d.id}`, text: `Deal “${d.title}” is won but has ${cs.length ? "no signed contract yet" : "no contract record"}.` });
  }
  for (const c of contracts) {
    if (["Sale", "Lease", "Distribution", "Supply"].includes(c.data?.type) && ["Counsel review", "Negotiation"].includes(c.status || "") && !c.data?.end_user_clause)
      out.push({ rec: c, level: "warn", who: ["role:legal"], key: `leg-euc|${c.id}`, repeat: 14, text: `Contract “${c.title}” (${c.data.type}) has no end-user / export clause marked.` });
  }
  for (const b of of(all, "legal.board")) if (b.status === "Held" && age(b, today) >= 14) out.push({ rec: b, level: "warn", who: ["owner", "role:legal"], key: `leg-minutes|${b.id}`, text: `Minutes of “${b.title}” are not drafted ${age(b, today)} days after the meeting.` });
  return out;
}

/* ---------------- Marketing ---------------- */
const CONTENT = ["marketing.social", "marketing.press", "marketing.interviews", "marketing.video", "marketing.media", "marketing.campaigns"];
const LIVE = /^(published|done|archived|declined|completed|analyzed)$/i;
export function marketingFindings(all: R[], today: string, _th: Th): Finding[] {
  const out: Finding[] = [];
  // Public-release check: nothing goes out without it
  for (const r of all.filter((x) => CONTENT.includes(x.section) && !LIVE.test(x.status || ""))) {
    const ck = r.data?.check || "Not checked";
    if (ck === "Legal review needed") out.push({ rec: r, level: "warn", who: ["role:legal", "owner"], key: `mkt-legal|${r.id}`, repeat: 3, text: `“${r.title}” waits for legal review before it can be published.` });
    else if (ck === "Fix needed") out.push({ rec: r, level: "warn", who: ["owner"], key: `mkt-fix|${r.id}`, repeat: 3, text: `“${r.title}” failed the release check: ${String(r.data?.check_note || "see the record").slice(0, 160)}` });
    else if (ck === "Not checked" && ["Review", "Approved", "Scheduled"].includes(r.status || "")) out.push({ rec: r, level: "warn", who: ["owner"], key: `mkt-nock|${r.id}`, text: `“${r.title}” is at ${r.status} but has not passed the release check — open it and press Check.` });
  }
  // Publishing calendar
  for (const s of of(all, "marketing.social")) {
    const p = s.data?.publish; if (!isDate(p)) continue; const d = days(today, p);
    if (["Approved", "Scheduled"].includes(s.status || "") && d < 0) out.push({ rec: s, level: "warn", who: ["owner"], key: `mkt-late|${s.id}`, repeat: 2, text: `Post “${s.title}” was planned for ${p} and is not marked Published.` });
    if (["Idea", "Draft"].includes(s.status || "") && d >= 0 && d <= 2) out.push({ rec: s, level: "warn", who: ["owner", "role:marketing"], key: `mkt-notready|${s.id}`, text: `Post “${s.title}” goes out on ${p} but is still ${s.status}.` });
  }
  for (const r of all.filter((x) => ["marketing.social", "marketing.press", "marketing.interviews", "marketing.video"].includes(x.section) && x.status === "Published" && !x.data?.post_url && age(x, today) >= 2))
    out.push({ rec: r, level: "info", who: ["owner"], key: `mkt-url|${r.id}`, repeat: 14, text: `“${r.title}” is published — add the link so reach and reports count it.` });
  const soon = of(all, "marketing.social").filter((s) => isDate(s.data?.publish) && days(today, s.data.publish) >= 0 && days(today, s.data.publish) <= 7 && !["Idea"].includes(s.status || ""));
  const anchor = of(all, "marketing.channels").find((c) => c.status === "Active") || of(all, "marketing.channels")[0];
  if (anchor && !soon.length) out.push({ rec: anchor, level: "warn", who: ["role:marketing"], key: `mkt-empty|${addDays(today, -new Date(today).getUTCDay())}`, repeat: 7, text: `No posts are planned for the next 7 days. Use “AI plan for 4 weeks” on the Marketing overview.` });
  // Press, interviews, video, events
  for (const p of of(all, "marketing.press")) if (["Accepted", "Writing", "Review"].includes(p.status || "") && isDate(p.data?.deadline)) {
    const st = stepFor(days(today, p.data.deadline), [7, 2]); if (st) out.push({ rec: p, level: st === "late" ? "bad" : "warn", who: ["owner"], key: `mkt-press|${p.id}|${st}`, repeat: st === "late" ? 2 : 365, text: st === "late" ? `Article “${p.title}” for ${p.data?.outlet || "the outlet"} missed its deadline ${p.data.deadline}.` : `Article “${p.title}” for ${p.data?.outlet || "the outlet"} is due on ${p.data.deadline}.` });
  }
  for (const i of of(all, "marketing.interviews")) if (["Confirmed", "Preparing"].includes(i.status || "") && isDate(i.data?.session)) {
    const d = days(today, i.data.session);
    if (d >= 0 && d <= 3 && (!String(i.data?.prep || "").trim() || i.data?.check === "Not checked" || !i.data?.check)) out.push({ rec: i, level: "warn", who: ["owner", "role:marketing"], key: `mkt-prep|${i.id}`, text: `${i.data?.type || "Interview"} “${i.title}” is on ${i.data.session} — the briefing is not ready${i.data?.spokesperson ? ` for ${i.data.spokesperson}` : ""}. Use “Prepare the speaker”.` });
  }
  for (const v of of(all, "marketing.video")) if (!LIVE.test(v.status || "") && !["Approved"].includes(v.status || "") && isDate(v.data?.due) && days(v.data.due, today) >= 1) out.push({ rec: v, level: "warn", who: ["owner"], key: `mkt-video|${v.id}`, repeat: 7, text: `Video “${v.title}” was due on ${v.data.due} and is at ${v.status}.` });
  for (const e of of(all, "marketing.events")) {
    if (["Considering", "Applied"].includes(e.status || "") && isDate(e.data?.book_by)) { const st = stepFor(days(today, e.data.book_by), [14, 3]); if (st && st !== "late") out.push({ rec: e, level: "warn", who: ["owner", "role:marketing"], key: `mkt-book|${e.id}|${st}`, repeat: 365, text: `Decide on “${e.title}” — booking closes on ${e.data.book_by}.` }); }
    if (e.status === "Booked" && isDate(e.data?.starts) && days(today, e.data.starts) <= 21 && days(today, e.data.starts) >= 0) out.push({ rec: e, level: "info", who: ["owner"], key: `mkt-evprep|${e.id}`, text: `“${e.title}” starts on ${e.data.starts} — preparation begins now.`, action: { type: "set", field: "status", value: "Preparing" }, why: "Event in 3 weeks" });
    if (e.status === "Done" && age(e, today) >= 7 && !Number(e.data?.leads) && !Number(e.data?.meetings)) out.push({ rec: e, level: "info", who: ["owner"], key: `mkt-evres|${e.id}`, repeat: 30, text: `“${e.title}” is over — record the leads and meetings it brought.` });
  }
  // Campaigns and budget
  for (const c of of(all, "marketing.campaigns")) {
    if (c.status === "Running" && isDate(c.data?.end_date) && days(c.data.end_date, today) >= 1) out.push({ rec: c, level: "info", who: ["owner"], key: `mkt-camp|${c.id}`, text: `Campaign “${c.title}” ended on ${c.data.end_date}.`, action: { type: "set", field: "status", value: "Completed" }, why: "End date passed" });
    if (Number(c.data?.budget) > 0 && Number(c.data?.spent) > Number(c.data.budget)) out.push({ rec: c, level: "warn", who: ["owner", "role:marketing"], key: `mkt-over|${c.id}`, repeat: 14, text: `Campaign “${c.title}” spent ${money(c.data.spent, c.data?.currency)} of ${money(c.data.budget, c.data?.currency)}.` });
    if (c.status === "Completed" && age(c, today) >= 7) out.push({ rec: c, level: "info", who: ["owner"], key: `mkt-analyze|${c.id}`, repeat: 30, text: `Campaign “${c.title}” is completed — record results and mark it Analyzed.` });
  }
  for (const p of of(all, "marketing.plan")) if (Number(p.data?.planned) > 0 && Number(p.data?.actual) > Number(p.data.planned)) out.push({ rec: p, level: "warn", who: ["role:marketing", "role:finance"], key: `mkt-plan|${p.id}`, repeat: 30, text: `Marketing budget “${p.title}” is over plan (${money(p.data.actual, p.data?.currency)} of ${money(p.data.planned, p.data?.currency)}).` });
  // Accounts and vendors
  for (const ch of of(all, "marketing.channels").filter((x) => x.status === "Active")) {
    if (ch.data?.two_fa !== "Yes") out.push({ rec: ch, level: ch.data?.two_fa === "No" ? "bad" : "warn", who: ["role:marketing", "role:security"], key: `mkt-2fa|${ch.id}`, repeat: 14, text: `Account “${ch.title}” (${ch.data?.platform || ""}) has two-step verification “${ch.data?.two_fa || "Unknown"}” — turn it on.` });
    if (!isDate(ch.data?.as_of) || days(ch.data.as_of, today) > 35) out.push({ rec: ch, level: "info", who: ["owner"], key: `mkt-num|${ch.id}`, repeat: 30, text: `Followers of “${ch.title}” were last updated ${ch.data?.as_of || "never"} — refresh the numbers.` });
  }
  for (const a of of(all, "marketing.agencies").filter((x) => x.status === "Active")) {
    if (a.data?.screening !== "Cleared") out.push({ rec: a, level: "warn", who: ["role:security", "owner"], key: `mkt-agscr|${a.id}`, repeat: 14, text: `Agency “${a.title}” works for us without a cleared screening.` });
    if (!a.data?.agreement || a.data.agreement === "None") out.push({ rec: a, level: "warn", who: ["owner", "role:legal"], key: `mkt-agnda|${a.id}`, repeat: 14, text: `Agency “${a.title}” works for us without an NDA or contract.` });
  }
  for (const o of of(all, "marketing.outlets").filter((x) => x.status === "In contact" && isDate(x.data?.last_contact) && days(x.data.last_contact, today) > 60)) out.push({ rec: o, level: "info", who: ["owner"], key: `mkt-outlet|${o.id}`, repeat: 30, text: `No contact with ${o.title} for ${days(o.data.last_contact, today)} days — send news or a story idea.` });
  return out;
}

/* ---------------- Technical ---------------- */
export function technicalFindings(all: R[], today: string, _th: Th): Finding[] {
  const out: Finding[] = [];
  const sw = of(all, "technical.software");
  for (const s of sw) {
    if (s.status === "Done") continue; const a = created(s, today); const bug = s.data?.type === "Bug"; const pr = s.data?.priority;
    if (bug && pr === "Critical" && a >= 1) out.push({ rec: s, level: "bad", who: ["leads", "role:engineering", "owner"], key: `tec-crit|${s.id}`, repeat: 1, text: `Critical bug “${s.title}” (${s.data?.component || ""}) is open for ${a} day(s).` });
    else if (bug && pr === "High" && a >= 7) out.push({ rec: s, level: "warn", who: ["role:engineering", "owner"], key: `tec-high|${s.id}`, repeat: 3, text: `High-priority bug “${s.title}” is open for ${a} days.` });
    if (s.status === "Review" && age(s, today) >= 5) out.push({ rec: s, level: "info", who: ["role:engineering"], key: `tec-review|${s.id}`, text: `“${s.title}” waits in Review for ${age(s, today)} days.` });
    if (s.status === "In progress" && age(s, today) >= 21) out.push({ rec: s, level: "info", who: ["owner"], key: `tec-stuck|${s.id}`, repeat: 14, text: `“${s.title}” has been In progress for ${age(s, today)} days without an update — split it or record progress.` });
  }
  // A failed test becomes a bug to fix
  for (const t of of(all, "technical.testing")) {
    const title = `Fix failed test — ${t.title}`;
    if (t.status === "Failed" && !sw.some((s) => s.title === title)) out.push({ rec: t, level: "warn", who: ["role:engineering", "owner"], key: `tec-fail|${t.id}`, text: `Test “${t.title}” (${t.data?.type || ""}${t.data?.config ? `, ${t.data.config}` : ""}) failed — a bug to fix is prepared.`, action: { type: "create", section: "technical.software", title, status: "Backlog", fields: { type: "Bug", priority: "High", owner: "{owner}", notes: "Failed test: {title}. Result: {result}" } }, why: "Test failed" });
    if (t.status === "Blocked" && age(t, today) >= 5) out.push({ rec: t, level: "warn", who: ["owner", "role:engineering"], key: `tec-blocked|${t.id}`, text: `Test “${t.title}” is blocked for ${age(t, today)} days.` });
    if (t.status === "Planned" && isDate(t.data?.date) && days(t.data.date, today) >= 2) out.push({ rec: t, level: "info", who: ["owner"], key: `tec-result|${t.id}`, repeat: 7, text: `Test “${t.title}” was planned for ${t.data.date} — record the result.` });
  }
  for (const c of of(all, "technical.certification")) {
    if (c.status === "Rejected") { out.push({ rec: c, level: "bad", who: ["leads", "role:engineering", "role:legal"], key: `tec-certrej|${c.id}`, repeat: 30, text: `Certification “${c.title}” (${c.data?.scheme || ""}) was rejected — affected equipment cannot be sold where it is required.` }); continue; }
    if (["Approved"].includes(c.status || "") || !isDate(c.data?.due)) continue;
    const st = stepFor(days(today, c.data.due), [30, 7]); if (st) out.push({ rec: c, level: st === "late" ? "bad" : "warn", who: ["role:engineering", "role:legal"], key: `tec-cert|${c.id}|${st}`, repeat: st === "late" ? 7 : 365, text: st === "late" ? `Certification “${c.title}” was due on ${c.data.due} and is ${c.status}.` : `Certification “${c.title}” (${c.data?.scheme || ""}) is due on ${c.data.due}.` });
  }
  for (const ch of of(all, "technical.changes")) {
    if (ch.status === "Requested" && created(ch, today) >= 5) out.push({ rec: ch, level: "warn", who: ["owner", "role:engineering"], key: `tec-chg|${ch.id}`, text: `Change request “${ch.title}” (${ch.data?.impact || ""}) is not assessed for ${created(ch, today)} days.` });
    if (ch.status === "Approved" && ["Compliance", "Safety"].includes(ch.data?.impact)) out.push({ rec: ch, level: "warn", who: ["role:legal", "role:security"], key: `tec-chgcomp|${ch.id}`, repeat: 365, text: `Approved change “${ch.title}” affects ${ch.data.impact.toLowerCase()} — check classification, certificates and documents.` });
    if (ch.status === "Approved" && isDate(ch.data?.due) && days(ch.data.due, today) >= 1) out.push({ rec: ch, level: "warn", who: ["owner"], key: `tec-chglate|${ch.id}`, repeat: 7, text: `Change “${ch.title}” was due on ${ch.data.due} and is not implemented.` });
  }
  for (const it of of(all, "technical.it")) {
    if (it.status === "Retired" || !isDate(it.data?.renewal)) continue;
    const st = stepFor(days(today, it.data.renewal), [30, 7]); if (!st) continue;
    out.push({ rec: it, level: st === "late" ? "bad" : st === "d7" ? "warn" : "info", who: ["owner", "role:engineering", "role:finance"], key: `tec-it|${it.id}|${st}`, repeat: st === "late" ? 3 : 365, text: st === "late" ? `“${it.title}” (${it.data?.vendor || ""}) renewal date ${it.data.renewal} has passed — check that the service still works.` : `“${it.title}” (${it.data?.type || ""}, ${it.data?.vendor || ""}) renews on ${it.data.renewal}${it.data?.monthly_cost ? ` — ${money(it.data.monthly_cost)}/month` : ""}.`,
      action: it.status === "Active" && st !== "late" ? { type: "set", field: "status", value: "Renewal due" } : undefined, why: "Renewal within 30 days" });
  }
  for (const d of of(all, "technical.docs")) if (d.status === "In review" && age(d, today) >= 7) out.push({ rec: d, level: "info", who: ["owner"], key: `tec-doc|${d.id}`, text: `Document “${d.title}” ${d.data?.version || ""} waits in review for ${age(d, today)} days.` });
  for (const r of of(all, "technical.rnd")) if (r.status !== "Done" && isDate(r.data?.due) && days(r.data.due, today) >= 1) out.push({ rec: r, level: "info", who: ["owner"], key: `tec-rnd|${r.id}`, repeat: 14, text: `R&D “${r.title}” was due on ${r.data.due} (${r.status}).` });
  for (const e of of(all, "technical.equipment")) if (e.status === "Selected" && !String(e.data?.matrix_id || "").trim()) out.push({ rec: e, level: "warn", who: ["role:legal", "role:engineering"], key: `tec-matrix|${e.id}`, repeat: 14, text: `Selected equipment “${e.title}” (${e.data?.manufacturer || ""} ${e.data?.model || ""}) is not linked to the compliance matrix — export and licence status unknown.` });
  for (const s of of(all, "technical.systems")) if (s.status !== "Retired" && !String(s.data?.owner || "").trim()) out.push({ rec: s, level: "info", who: ["role:engineering"], key: `tec-sysown|${s.id}`, repeat: 30, text: `System “${s.title}” has no owner — who answers when it is down?` });
  return out;
}

/* ---------------- Security ---------------- */
export const quarter = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
export function securityFindings(all: R[], today: string, _th: Th): Finding[] {
  const out: Finding[] = [];
  for (const i of of(all, "security.incidents")) {
    if (i.status === "Resolved") continue; const a = created(i, today); const sev = i.data?.severity;
    if (i.status === "Reported" && ["Critical", "High"].includes(sev) && a >= 1) out.push({ rec: i, level: "bad", who: ["leads", "role:security"], key: `sec-inc|${i.id}`, repeat: 1, text: `${sev} incident “${i.title}” is reported ${a} day(s) ago and nobody is investigating.` });
    else if (i.status === "Reported" && a >= 3) out.push({ rec: i, level: "warn", who: ["role:security"], key: `sec-inc|${i.id}`, repeat: 3, text: `Incident “${i.title}” waits ${a} days for investigation.` });
    if (i.status === "Investigating" && age(i, today) >= 7) out.push({ rec: i, level: "warn", who: ["owner", "role:security"], key: `sec-inv|${i.id}`, text: `Investigation of “${i.title}” has no update for ${age(i, today)} days.` });
  }
  // Access: a review every quarter, and every scheduled review or removal done on time
  const acc = of(all, "security.access"); const q = quarter(today); const title = `Quarterly access review — ${q}`;
  const anchor = [...acc].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || of(all, "security.cyber")[0] || of(all, "security.screening")[0];
  if (anchor && !acc.some((a) => a.title === title)) out.push({ rec: anchor, level: "info", who: ["role:security"], key: `sec-qar|${q}`, repeat: 90, text: `${q}: time for the quarterly access review — a review record is prepared.`, action: { type: "create", section: "security.access", title, status: "Scheduled", fields: { system: "Workspace roles, Google Workspace, GitHub, Vercel, Supabase, social accounts, bank and government portals", due: addDays(today, 7), notes: "Use Security → Overview → Access review. Remove anyone who no longer needs access; record what changed." } }, why: "New quarter" });
  for (const a of acc) if (a.status !== "Done" && isDate(a.data?.due) && days(a.data.due, today) >= 1) {
    const revoke = /^revoke access/i.test(a.title);
    out.push({ rec: a, level: revoke ? "bad" : "warn", who: revoke ? ["leads", "role:security"] : ["owner", "role:security"], key: `sec-acc|${a.id}`, repeat: revoke ? 1 : 3, text: revoke ? `“${a.title}” is overdue — a former team member may still have access.` : `Access review “${a.title}” was due on ${a.data.due}.` });
  }
  for (const c of of(all, "security.cyber")) {
    if (c.status === "Open" && ["High", "Restricted"].includes(c.data?.risk) && age(c, today) >= 14) out.push({ rec: c, level: "bad", who: ["leads", "role:security"], key: `sec-cyber|${c.id}`, repeat: 7, text: `${c.data.risk} cyber risk “${c.title}” (${c.data?.asset || ""}) is open ${age(c, today)} days without mitigation.` });
    if (c.status === "Mitigating" && age(c, today) >= 30) out.push({ rec: c, level: "warn", who: ["owner", "role:security"], key: `sec-mit|${c.id}`, text: `Mitigation of “${c.title}” has no update for ${age(c, today)} days.` });
    if (c.status === "Accepted" && age(c, today) >= 365) out.push({ rec: c, level: "info", who: ["role:security"], key: `sec-acc-risk|${c.id}`, repeat: 90, text: `Accepted risk “${c.title}” has not been reviewed for a year.` });
  }
  for (const t of of(all, "security.tcp")) {
    if (["Unclassified", "Under review"].includes(t.status || "") && created(t, today) >= 14) out.push({ rec: t, level: "warn", who: ["role:security", "role:legal"], key: `sec-tcp|${t.id}`, repeat: 7, text: `Technical data “${t.title}” is ${t.status} for ${created(t, today)} days — classify it (EAR, ITAR or not controlled).` });
    if (["EAR controlled", "ITAR controlled"].includes(t.status || "") && !String(t.data?.access || "").trim()) out.push({ rec: t, level: "bad", who: ["role:security"], key: `sec-tcpacc|${t.id}`, repeat: 14, text: `${t.status} data “${t.title}” has no list of who may access it.` });
  }
  for (const a of of(all, "security.audits")) {
    if (a.status === "Findings open" && age(a, today) >= 30) out.push({ rec: a, level: "warn", who: ["owner", "role:security", "leads"], key: `sec-audit|${a.id}`, repeat: 14, text: `Audit “${a.title}” (${a.data?.standard || ""}) has open findings for ${age(a, today)} days.` });
    if (a.status === "Planned" && isDate(a.data?.date) && days(a.data.date, today) >= 1) out.push({ rec: a, level: "info", who: ["owner"], key: `sec-auditdate|${a.id}`, repeat: 14, text: `Audit “${a.title}” was planned for ${a.data.date} — start it or move the date.` });
  }
  for (const s of of(all, "security.screening")) if (["Flagged", "Escalated"].includes(s.status || "") && age(s, today) >= 7) out.push({ rec: s, level: "bad", who: ["leads", "role:security"], key: `sec-flag|${s.id}`, repeat: 7, text: `Screening “${s.title}” is ${s.status} for ${age(s, today)} days without a decision — work with this party stays on hold.` });
  return out;
}

/** Client email for a deal: client card → lead → any address in the deal notes. */
export function dealEmail(d: R, all: R[]) {
  const client = all.find((r) => r.id === d.data?.client_ref) || all.find((r) => r.section === "sales.clients" && d.data?.client && r.title.trim().toLowerCase() === String(d.data.client).trim().toLowerCase());
  const lead = all.find((r) => r.id === d.data?.lead_ref);
  return emailIn(client?.data?.contact) || emailIn(lead?.data?.email) || emailIn(d.data?.notes) || "";
}
