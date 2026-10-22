// Phase 6 — extraction proposals from a document's text. Pure and deterministic (the pattern method), plus the
// check every model answer must pass: a value is kept only when the text quoted as its evidence really is in the
// document. Nothing here creates a record: the result is a proposal that a person confirms (ops_proposal_decide).

export type Kind = "quotation" | "obligation" | "invoice";
export type Proposal = { kind: Kind; target: string; values: Record<string, any>; evidence: Record<string, string> };

const CUR: Record<string, string> = { "$": "USD", usd: "USD", "us$": "USD", aed: "AED", dhs: "AED", "€": "EUR", eur: "EUR" };
const num = (s: string) => Number(s.replace(/[,\s](?=\d{3}\b)/g, "").replace(/,/g, ""));

/** ISO date from 2026-10-01, 01/10/2026 (day first, as in the UAE) or 1 October 2026. */
export function isoDate(s: string): string | null {
  let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  m = s.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/i);
  if (m) return `${m[3]}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** The total of a quotation or invoice: the amount on a line that says total / grand total / amount due. */
export function totalOf(text: string): { amount: number; currency: string; quote: string } | null {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const re = /(grand\s+total|total\s+amount|total|amount\s+due|итого|всего)[^\d$€]{0,30}?(usd|us\$|aed|dhs|eur|\$|€)?\s*([\d][\d,\s]*(?:\.\d{1,2})?)\s*(usd|aed|eur)?/i;
  for (const l of [...lines].reverse()) {
    const m = l.match(re); if (!m) continue;
    const amount = num(m[3]); if (!isFinite(amount) || amount <= 0) continue;
    const c = (m[2] || m[4] || "").toLowerCase(); return { amount, currency: CUR[c] || "USD", quote: l.slice(0, 200) };
  }
  return null;
}

/** Deterministic proposals. A field is proposed only with the line it was read from. */
export function patternExtract(kind: Kind, text: string): Proposal[] {
  const t = String(text || "").slice(0, 200_000);
  if (kind === "quotation" || kind === "invoice") {
    const tot = totalOf(t); if (!tot) return [];
    const values: Record<string, any> = { amount: tot.amount, currency: tot.currency }; const evidence: Record<string, string> = { amount: tot.quote };
    const valid = t.match(/valid\s+(?:until|till|through)[:\s]+([^\n]{6,40})/i); const vd = valid && isoDate(valid[1]); if (vd) { values.valid_until = vd; evidence.valid_until = valid![0].slice(0, 200); }
    const lead = t.match(/(?:lead\s*time|delivery)[^\n\d]{0,20}(\d{1,3})\s*(?:working\s+|business\s+|calendar\s+)?(days|weeks)/i);
    if (lead && kind === "quotation") { values.lead_time_days = Number(lead[1]) * (/week/i.test(lead[2]) ? 7 : 1); evidence.lead_time_days = lead[0].slice(0, 200); }
    const due = t.match(/(?:due\s+date|payment\s+due)[:\s]+([^\n]{6,40})/i); const dd = due && isoDate(due[1]); if (dd && kind === "invoice") { values.due = dd; evidence.due = due![0].slice(0, 200); }
    return [{ kind, target: kind === "quotation" ? "operations.quotations" : "finance.payments", values: { title: kind === "quotation" ? "Quotation (from document)" : "Invoice (from document)", ...values }, evidence }];
  }
  // obligations: a sentence with shall / must / undertakes to, and a date or a period in it
  const out: Proposal[] = [];
  const sentences = t.replace(/\s+/g, " ").split(/(?<=[.;])\s+/);
  for (const s of sentences) {
    if (!/\b(shall|must|undertakes? to|is obliged to|agrees? to)\b/i.test(s)) continue;
    const d = isoDate(s); const per = s.match(/\b(monthly|quarterly|annually|each month|every month|each quarter|within \d{1,3} days)\b/i);
    if (!d && !per) continue;
    out.push({ kind: "obligation", target: "legal.contract_obligations", values: { title: s.slice(0, 120), ...(d ? { due: d } : {}), ...(per ? { frequency: /quarter/i.test(per[1]) ? "Quarterly" : /annual/i.test(per[1]) ? "Annual" : /month/i.test(per[1]) ? "Monthly" : "One-time" } : {}) },
      evidence: { title: s.slice(0, 300) } });
    if (out.length >= 20) break;
  }
  return out;
}

/** A model answer is kept only where its quoted evidence is found in the text (no invented values). */
export function keepEvidenced(p: Proposal, text: string): Proposal | null {
  const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase(); const hay = norm(text);
  const values: Record<string, any> = {}; const evidence: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.values || {})) {
    if (k === "title") { values.title = String(v).slice(0, 200); continue; }
    const ev = p.evidence?.[k]; if (!ev || norm(ev).length < 4 || !hay.includes(norm(ev))) continue;
    values[k] = v; evidence[k] = ev.slice(0, 300);
  }
  return Object.keys(values).some((k) => k !== "title") ? { ...p, values, evidence } : null;
}
