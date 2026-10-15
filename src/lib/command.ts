// Commands in plain words ("create a task for Ivan on Friday"): checks the plan the AI proposes before a person confirms it.
// Pure, so it is tested directly. Only sections the person may write, only real statuses, fields and options, only records found for them.
type Sec = { id: string; statuses: string[]; fields: { key: string; type: string; options?: string[]; ref?: string }[] };
type Cand = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };
export type Op =
  | { op: "create"; section: string; title: string; status: string; data: Record<string, any> }
  | { op: "update"; id: string; section: string; title: string; status?: string; data: Record<string, any> }
  | { op: "comment"; id: string; section: string; title: string; body: string };

function cleanData(sec: Sec, raw: any, cands: Map<string, Cand>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const f = sec.fields.find((x) => x.key === k); if (!f || v === null || v === undefined || v === "") continue;
    if (f.type === "ref") { const t = cands.get(String(v)); if (t && (!f.ref || t.section === f.ref)) { out[k] = t.id; out[`${k}_title`] = t.title; } continue; }
    if (f.options && !f.options.includes(String(v))) continue;
    if (f.type === "date") { if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[k] = String(v); continue; }
    if (f.type === "number" || f.type === "money") { const n = Number(String(v).replace(/[^\d.\-]/g, "")); if (Number.isFinite(n)) out[k] = n; continue; }
    if (f.type === "check") { out[k] = !!v; continue; }
    out[k] = String(v).slice(0, 4000);
  }
  return out;
}

export function validatePlan(raw: any, ctx: { sections: Sec[]; writable: Set<string>; candidates: Cand[] }): { ops: Op[]; dropped: string[] } {
  const cands = new Map(ctx.candidates.map((c) => [c.id, c])); const ops: Op[] = []; const dropped: string[] = [];
  for (const o of (Array.isArray(raw?.ops) ? raw.ops : []).slice(0, 10)) {
    if (o?.op === "create") {
      const sec = ctx.sections.find((s) => s.id === o.section);
      if (!sec || !ctx.writable.has(sec.id)) { dropped.push(`create in ${o.section}: no access`); continue; }
      const title = String(o.title || "").trim().slice(0, 200); if (!title) { dropped.push(`create in ${sec.id}: no title`); continue; }
      ops.push({ op: "create", section: sec.id, title, status: sec.statuses.includes(o.status) ? o.status : sec.statuses[0], data: cleanData(sec, o.data, cands) });
    } else if (o?.op === "update" || o?.op === "comment") {
      const c = cands.get(String(o.id)); if (!c) { dropped.push(`${o.op}: record not found`); continue; }
      const sec = ctx.sections.find((s) => s.id === c.section);
      if (!sec || (o.op === "update" && !ctx.writable.has(sec.id))) { dropped.push(`${o.op} ${c.title}: no access`); continue; }
      if (o.op === "comment") { const body = String(o.body || "").trim().slice(0, 4000); if (body) ops.push({ op: "comment", id: c.id, section: c.section, title: c.title, body }); continue; }
      const status = o.status && sec.statuses.includes(o.status) && o.status !== c.status ? o.status : undefined;
      const data = cleanData(sec, o.data, cands);
      if (status || Object.keys(data).length) ops.push({ op: "update", id: c.id, section: c.section, title: c.title, status, data });
      else dropped.push(`update ${c.title}: nothing to change`);
    }
  }
  return { ops, dropped };
}
/** Words worth searching records for (names, numbers), longest first. */
export function searchWords(text: string) {
  const stop = new Set("create update change move make add new task deal invoice record for the and with from into status set put please создай создать добавь добавить переведи перевести поставь задачу задача сделку сделка счёт счет для на по в из и с к до это".split(" "));
  return [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.\-]{2,}/gu) || [])].filter((w) => !stop.has(w) && !/^\d{1,2}$/.test(w)).sort((a, b) => b.length - a.length).slice(0, 5);
}
