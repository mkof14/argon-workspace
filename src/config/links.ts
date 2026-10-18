// Links between records: which field points to which section, and the order of the StarDome chain from lead to service.
export const REFS: Record<string, Record<string, string>> = {
  "sales.pipeline": { client_ref: "sales.clients", lead_ref: "marketing.leads" },
  "sales.proposals": { deal_ref: "sales.pipeline" },
  "security.screening": { deal_ref: "sales.pipeline" },
  "legal.contracts": { deal_ref: "sales.pipeline" },
  "finance.invoices": { deal_ref: "sales.pipeline" },
  "operations.builds": { deal_ref: "sales.pipeline", screening_ref: "security.screening" },
  "operations.logistics": { build_ref: "operations.builds" },
  "operations.installation": { build_ref: "operations.builds" },
  "operations.fleet": { build_ref: "operations.builds" },
  "operations.support": { unit_ref: "operations.fleet" },
  "operations.inventory": { build_ref: "operations.builds" },
  "operations.procurement": { build_ref: "operations.builds" },
};
/** Chain order shown in a record: from the first contact to service after installation. */
export const CHAIN = ["marketing.leads", "sales.clients", "sales.pipeline", "security.screening", "sales.proposals", "legal.contracts", "finance.invoices", "operations.builds", "operations.procurement", "operations.inventory", "operations.logistics", "operations.installation", "operations.fleet", "operations.support"];
export const REF_KEYS = [...new Set(Object.values(REFS).flatMap((m) => Object.keys(m)))];

type Node = { id: string; section: string; title: string; status: string | null; data?: any };
/** Every record connected to `start` through links in either direction (up to 40), ordered along the chain. */
export function chainOf(start: Node, all: Node[]): Node[] {
  const byId = new Map(all.map((r) => [r.id, r])); byId.set(start.id, start);
  const seen = new Set([start.id]); const queue = [start];
  while (queue.length && seen.size < 40) {
    const r = queue.shift()!;
    const out = Object.keys(REFS[r.section] || {}).map((k) => r.data?.[k]).filter(Boolean) as string[];
    const inc = all.filter((x) => Object.keys(REFS[x.section] || {}).some((k) => x.data?.[k] === r.id)).map((x) => x.id);
    for (const id of [...out, ...inc]) { const n = byId.get(id); if (n && !seen.has(id)) { seen.add(id); queue.push(n); } }
  }
  return [...seen].map((id) => byId.get(id)!).filter(Boolean).sort((a, b) => CHAIN.indexOf(a.section) - CHAIN.indexOf(b.section));
}
