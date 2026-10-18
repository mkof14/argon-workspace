// Client portal: what one client may see about their own orders. Only listed fields leave the company;
// US-persons-only records and internal notes never do.

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any>; controlled?: boolean; updated_at?: string };
const same = (a: any, b: any) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export const BUILD_STEPS = ["Design", "Procurement", "Assembly", "Integration", "Testing", "Shipping", "Installed"];

export function portalView(client: R, all: R[]) {
  const ok = all.filter((r) => !r.controlled);
  const deals = ok.filter((r) => r.section === "sales.pipeline" && (r.data?.client_ref === client.id || (!r.data?.client_ref && same(r.data?.client, client.title))));
  const dealIds = new Set(deals.map((d) => d.id));
  const builds = ok.filter((r) => r.section === "operations.builds" && (dealIds.has(r.data?.deal_ref) || same(r.data?.client, client.title)));
  const buildIds = new Set(builds.map((b) => b.id));
  const ofBuild = (sec: string) => ok.filter((r) => r.section === sec && buildIds.has(r.data?.build_ref));
  const fleet = ok.filter((r) => r.section === "operations.fleet" && (buildIds.has(r.data?.build_ref) || same(r.data?.client, client.title)));
  const fleetIds = new Set(fleet.map((f) => f.id));
  return {
    client: { name: client.title },
    orders: builds.map((b) => {
      const ship = ofBuild("operations.logistics").filter((l) => l.data?.build_ref === b.id)[0];
      const inst = ofBuild("operations.installation").filter((l) => l.data?.build_ref === b.id)[0];
      const step = Math.max(0, BUILD_STEPS.indexOf(b.status || ""));
      return { id: b.id, title: b.title, config: b.data?.config || "", status: b.status, step, of: BUILD_STEPS.length - 1, due: b.data?.due || null,
        shipping: ship ? { status: ship.status, eta: ship.data?.due || null, carrier: ship.data?.carrier || null, tracking: ship.data?.tracking || null, from: ship.data?.from || null, to: ship.data?.to || null } : null,
        installation: inst ? { status: inst.status, date: inst.data?.due || null, site: inst.data?.site || null } : null };
    }),
    proposals: ok.filter((r) => r.section === "sales.proposals" && dealIds.has(r.data?.deal_ref) && ["Sent", "Accepted"].includes(r.status || ""))
      .map((p) => ({ id: p.id, number: p.data?.number || p.title, config: p.data?.config || "", value: Number(p.data?.value) || 0, currency: p.data?.currency || "USD", valid_until: p.data?.valid_until || null, status: p.status })),
    invoices: ok.filter((r) => r.section === "finance.invoices" && dealIds.has(r.data?.deal_ref) && r.data?.direction !== "Payable" && ["Sent", "Due", "Overdue", "Paid"].includes(r.status || ""))
      .map((i) => ({ id: i.id, title: i.title, amount: Number(i.data?.amount) || 0, currency: i.data?.currency || "USD", due: i.data?.due || null, status: i.status })),
    units: fleet.map((f) => ({ id: f.id, title: f.title, config: f.data?.config || "", serial: f.data?.serial || "", site: f.data?.site || "", warranty_end: f.data?.warranty_end || null, next_service: f.data?.next_service || null, sla: f.data?.sla || "", status: f.status })),
    requests: ok.filter((r) => r.section === "operations.support" && (same(r.data?.client, client.title) || fleetIds.has(r.data?.unit_ref)))
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 20)
      .map((s) => ({ id: s.id, title: s.title, severity: s.data?.severity || "", status: s.status, updated: (s.updated_at || "").slice(0, 10) })),
  };
}
