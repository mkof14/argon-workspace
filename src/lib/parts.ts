import { buildEarly } from "./builds";
// Parts for a build: what the configuration's bill of materials needs, what is already reserved for this build,
// what is free in stock, what is on order — and the shortage.

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };
const norm = (s: any) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
/** An inventory item or a purchase matches a BOM line by part number, or by model/item name. */
export const matches = (line: R, x: { part_no?: any; model?: any; item?: any }) => {
  const pn = norm(line.data?.part_no), it = norm(line.data?.item);
  return (!!pn && (norm(x.part_no) === pn || norm(x.model) === pn || norm(x.item) === pn)) || (!!it && (norm(x.model) === it || norm(x.item) === it));
};

export type PartLine = { line: R; need: number; reserved: number; free: number; onOrder: number; short: number; freeIds: string[] };

export function buildParts(build: R, all: R[]): PartLine[] {
  const cfg = build.data?.config; if (!cfg) return [];
  const bom = all.filter((r) => r.section === "technical.bom" && r.data?.config === cfg && r.status === "Approved");
  const inv = all.filter((r) => r.section === "operations.inventory");
  const po = all.filter((r) => r.section === "operations.procurement" && ["Draft", "Approved", "Ordered"].includes(r.status || ""));
  return bom.map((line) => {
    const need = Math.max(0, Math.round(Number(line.data?.qty) || 0));
    const mine = inv.filter((i) => i.data?.build_ref === build.id && ["Reserved", "Installed"].includes(i.status || "") && matches(line, i.data));
    const free = inv.filter((i) => i.status === "In stock" && !i.data?.build_ref && matches(line, i.data));
    const onOrder = po.filter((p) => p.data?.build_ref === build.id && matches(line, p.data)).reduce((a, p) => a + (Number(p.data?.qty) || 0), 0);
    const reserved = mine.length;
    const short = Math.max(0, need - reserved - onOrder);
    return { line, need, reserved, free: free.length, onOrder, short, freeIds: free.slice(0, Math.max(0, need - reserved)).map((f) => f.id) };
  });
}
/** Builds that will soon need parts that are neither reserved, free in stock nor ordered. */
export function shortages(all: R[], today: string, days = 45) {
  const t = Date.parse(today);
  return all.filter((b) => b.section === "operations.builds" && buildEarly(b.status))
    .map((b) => ({ b, lines: buildParts(b, all).filter((l) => l.short - l.free > 0) }))
    .filter((x) => x.lines.length && (!x.b.data?.due || Date.parse(x.b.data.due) - t <= days * 864e5));
}
