// Incoming e-mail → which Workspace records it most likely belongs to: the supplier (sender address or company
// domain), a project (named in the subject or text), a procurement item (its PO number) and an earlier thread
// (In-Reply-To / References of a letter we sent, or "Re:" of the same subject to the same address).
// Pure and deterministic. These are SUGGESTIONS shown to a person — nothing is linked or decided automatically.
type R = { id: string; title: string; status?: string | null; data?: Record<string, any> | null };
export type MailIn = { from: string; subject: string; text?: string; inReplyTo?: string; references?: string };
export type Outbound = { id: string; provider_id?: string | null; to_addr: string; subject: string; idem_key?: string | null };
export type LinkHint = { kind: "supplier" | "project" | "procurement" | "thread"; id: string; title: string; why: string; strength: "strong" | "likely" };

const FREE = /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|me|live|proton|protonmail|mail|yandex|aol|gmx)\./i;
const emails = (s: string) => (String(s || "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).map((x) => x.toLowerCase());
const domainOf = (m: string) => (m.split("@")[1] || "").toLowerCase();
const hostOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const ids = (s?: string) => (String(s || "").match(/<[^>]+>/g) || []).map((x) => x.slice(1, -1).toLowerCase());
const norm = (s: string) => s.toLowerCase().replace(/^\s*((re|fw|fwd|aw|ответ|отв)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();
const words = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}#-]+/gu, " ")} `;

export function suggestLinks(m: MailIn, c: { vendors?: R[]; projects?: R[]; procurement?: R[]; outbound?: Outbound[] }): LinkHint[] {
  const out: LinkHint[] = []; const sender = (emails(m.from)[0] || "").toLowerCase(); const dom = domainOf(sender);
  const text = words(`${m.subject} ${m.text || ""}`); const subj = words(m.subject);
  // thread: one of our letters is quoted in the headers (exact), or the same subject to the same address (likely)
  const refs = [...ids(m.inReplyTo), ...ids(m.references)];
  const th = (c.outbound || []).find((o) => o.provider_id && refs.includes(String(o.provider_id).replace(/^<|>$/g, "").toLowerCase()));
  if (th) out.push({ kind: "thread", id: th.id, title: th.subject, why: "reply to a letter sent from Workspace (message id)", strength: "strong" });
  else { const o = (c.outbound || []).find((x) => x.to_addr.toLowerCase() === sender && norm(x.subject) === norm(m.subject) && norm(m.subject).length > 3); if (o) out.push({ kind: "thread", id: o.id, title: o.subject, why: "same subject, same address", strength: "likely" }); }
  // supplier: the exact address in the supplier card, or the company's own domain (not a free mailbox)
  for (const v of c.vendors || []) {
    const blob = JSON.stringify(v.data || {}); const known = emails(blob);
    const doms = [...known.map(domainOf), ...Object.values(v.data || {}).filter((x) => typeof x === "string" && /\.[a-z]{2,}/i.test(x as string) && !/@/.test(x as string) && !/\s/.test(x as string)).map((x) => hostOf(x as string))].filter((d) => d && !FREE.test(d));
    if (sender && known.includes(sender)) { out.push({ kind: "supplier", id: v.id, title: v.title, why: "sender address is in the supplier card", strength: "strong" }); break; }
    if (dom && !FREE.test(dom) && doms.includes(dom)) { out.push({ kind: "supplier", id: v.id, title: v.title, why: `sender domain ${dom}`, strength: "strong" }); break; }
  }
  if (!out.some((x) => x.kind === "supplier")) for (const v of c.vendors || []) { const n = v.title.toLowerCase().trim(); if (n.length >= 4 && subj.includes(` ${n} `)) { out.push({ kind: "supplier", id: v.id, title: v.title, why: "supplier named in the subject", strength: "likely" }); break; } }
  // procurement: an order number that appears in the letter and in the item
  for (const p of c.procurement || []) {
    const nums = [p.data?.po, p.data?.po_number, p.data?.order, ...(String(p.title).match(/\b(?:PO|ORD|ЗАК)[-\s#]?\d{3,}\b/gi) || [])].filter(Boolean).map((x) => String(x).toLowerCase().replace(/\s+/g, ""));
    const hit = nums.find((n) => n.length >= 4 && text.replace(/\s+/g, " ").includes(n.replace(/[-#]/g, (ch) => ch)));
    if (hit) { out.push({ kind: "procurement", id: p.id, title: p.title, why: `order ${hit.toUpperCase()}`, strength: "strong" }); break; }
  }
  // project: its name (at least two words or a code) in the subject or text; closed projects are not suggested
  const proj = (c.projects || []).filter((p) => !["Completed", "Cancelled", "Closed"].includes(p.status || ""))
    .map((p) => ({ p, n: p.title.toLowerCase().replace(/\(sample\)/, "").trim(), code: String(p.data?.code || "").toLowerCase() }))
    .filter((x) => (x.n.length >= 6 && x.n.includes(" ") && text.includes(` ${x.n} `)) || (x.code.length >= 3 && text.includes(` ${x.code} `)));
  if (proj.length === 1) out.push({ kind: "project", id: proj[0].p.id, title: proj[0].p.title, why: "project named in the letter", strength: subj.includes(` ${proj[0].n} `) || subj.includes(` ${proj[0].code} `) ? "strong" : "likely" });
  return out;
}
