// Demo data: AGRON's real reference data (legal catalog, issues, regulators) plus clearly marked SAMPLE
// records so every department shows how it works. Sample records carry data.sample = true.
import catalog from "@/config/legal-catalog.json";
import type { Rec, Profile } from "./store";

const iso = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
let n = 0;
const r = (section: string, title: string, status: string, data: Record<string, any>, extra: Partial<Rec> = {}, age = 1): Rec => ({
  id: `demo-${++n}`, section, title, status, data, company: null, controlled: false, created_by: "p1", created_at: iso(age), updated_at: iso(age), ...extra,
});
const S = (o: Record<string, any>) => ({ ...o, sample: true });

export const DEMO_PEOPLE: Profile[] = [
  { id: "p1", email: "owner@agron1.com", full_name: "AGRON Owner", role: "owner", company: null, us_person: true, lang: "ru", ai_monthly_tokens: 1000000 },
  { id: "p2", email: "engineer@agron1.com", full_name: "Sample Engineer", role: "engineering", company: null, us_person: true, lang: "en", ai_monthly_tokens: 300000 },
  { id: "p3", email: "ops.uae@agron1.com", full_name: "Sample UAE Operations", role: "operations", company: null, us_person: false, lang: "ar", ai_monthly_tokens: 300000 },
  { id: "p4", email: "finance@agron1.com", full_name: "Sample Finance", role: "finance", company: null, us_person: true, lang: "en", ai_monthly_tokens: 300000 },
  { id: "p5", email: "sales@agron1.com", full_name: "Sample Sales", role: "sales", company: null, us_person: false, lang: "en", ai_monthly_tokens: 300000 },
  { id: "p6", email: "partner@example.com", full_name: "Sample Partner", role: "partner", company: "Gulf Marine Partners (sample)", us_person: false, lang: "ar", ai_monthly_tokens: 50000 },
  { id: "p7", email: "vendor@example.com", full_name: "Sample Vendor", role: "vendor", company: "Radar Vendor (sample)", us_person: false, lang: "en", ai_monthly_tokens: 50000 },
];

export function demoSeed(): Rec[] {
  n = 0;
  const cats = Object.fromEntries((catalog as any).categories.map((c: any) => [c.code, c]));
  const out: Rec[] = [];
  for (const i of (catalog as any).items) {
    const c = cats[i.cat];
    out.push(r("legal.matrix", `${i.id} · ${i.sub}`, i.risk === "Restricted" ? "Restricted" : "Pending review",
      { matrix_id: i.id, category: `${c.code} ${c.name}`, risk: i.risk, eccn: "Pending", itar: "Pending", us_license: "Pending", uae_type_approval: "Pending", uae_operation: "Pending", review_areas: c.areas, notes: i.note || "" }, {}, 3));
  }
  const issues: [string, string, string, string, string][] = [
    ["Ukrainian co-owners are foreign persons under US export law", "Critical", "Releasing controlled technical data or source code to foreign persons, even inside AGRON, can be an export (deemed export).", "Keep controlled technical data US-person-only until classified; Technology Control Plan with US export counsel.", "CEO + US counsel"],
    ["UAE entity: security is a strategic-impact activity", "Critical", "Cabinet Resolution No. 55 of 2021: security, defence and military activities need prior approval and minimum Emirati ownership.", "UAE counsel scopes each licence activity before opening an Abu Dhabi entity.", "CEO + UAE counsel"],
    ["No counsel engaged yet", "Critical", "Binding conclusions need licensed counsel in the US and the UAE.", "Engage two firms on limited scope.", "CEO"],
    ["Strait of Hormuz and Gulf tanker work", "High", "OFAC Iran sanctions, flag-state law, ISPS and war-risk insurance apply.", "Screen every vessel, owner, manager and charterer before any deal.", "Sales"],
    ["AGRON 1 export self-classification", "High", "Own software with encryption and sensor fusion needs classification.", "Prepare technical description; counsel or BIS request.", "CEO + CTO"],
  ];
  for (const [t, p, s, a, o] of issues) out.push(r("legal.issues", t, "Open", { priority: p, summary: s, action: a, owner: o }, {}, 2));
  for (const [j, name, role, w] of [["US", "BIS — Bureau of Industry and Security", "EAR / CCL, ECCN, export licences", "https://www.bis.gov"], ["US", "DDTC", "ITAR / USML, registration", "https://www.pmddtc.state.gov"], ["US", "OFAC", "Sanctions, restricted parties", "https://ofac.treasury.gov"], ["UAE", "TDRA", "Type approval, spectrum", "https://tdra.gov.ae"], ["UAE", "GCAA", "Civil aviation, UAV", "https://www.gcaa.gov.ae"], ["International", "IMO", "SOLAS, ISPS Code", "https://www.imo.org"]])
    out.push(r("legal.regulators", name, "Reference", { jurisdiction: j, role, website: w }, {}, 5));
  out.push(r("legal.corporate", "AGRON Inc.", "Active", { entity: "AGRON Inc.", jurisdiction: "Delaware, USA", filing: "Incorporated 2026" }, {}, 9));
  out.push(r("legal.corporate", "AGRON UAE entity", "Planned", { entity: "AGRON (UAE)", jurisdiction: "Abu Dhabi or other — under review" }, {}, 9));
  for (const m of ["AGRON", "StarDome", "StarWall", "AGRON 1"]) out.push(r("legal.trademarks", m, "Planned", { mark: m, office: "USPTO" }, {}, 9));

  // ---- SAMPLE operational data (marked) ----
  out.push(
    r("operations.builds", "SD-001 · Pilot container", "Integration", S({ config: "C20 Enhanced", client: "Pilot marina (sample)", site: "Abu Dhabi marina (sample)", assembly: "United States", export_check: "In progress", owner: "Sample Engineer", due: "2026-12-15" })),
    r("operations.builds", "SD-002 · Superyacht deck unit", "Procurement", S({ config: "C20 Base", client: "Superyacht owner (sample)", site: "M/Y Example (sample)", assembly: "United States", export_check: "Not started", owner: "Sample UAE Operations", due: "2027-02-01" }), {}, 2),
    r("operations.builds", "SD-003 · Port HQ", "Design", S({ config: "C40 HQ", client: "Port operator (sample)", site: "Gulf port (sample)", assembly: "UAE", export_check: "Not started", owner: "Sample UAE Operations", due: "2027-04-30" }), {}, 4),
    r("operations.procurement", "PO-0001 · Surveillance radar ×2", "Approved", S({ vendor: "Radar Vendor (sample)", item: "Short-range surveillance radar", qty: 2, amount: 0, currency: "USD", build: "SD-001" }), { company: "Radar Vendor (sample)" }),
    r("operations.procurement", "PO-0002 · Thermal PTZ camera", "Draft", S({ vendor: "Camera vendor (sample)", item: "LWIR PTZ camera", qty: 1, currency: "USD", build: "SD-001" }), {}, 2),
    r("operations.vendors", "Radar Vendor (sample)", "Under review", S({ category: "Radar", country: "USA", nda: "Sent", screening: "Cleared" }), { company: "Radar Vendor (sample)" }),
    r("operations.comms", "Welcome to AGRON Workspace", "Published", S({ audience: "Everyone", body: "All departments, documents and approvals now live here. Chat and calls stay in Microsoft Teams." }), { company: "*" }),
    r("sales.pipeline", "Marina security package (sample)", "Proposal", S({ client: "Pilot marina (sample)", segment: "Marina", config: "C20 Enhanced", currency: "USD", country: "UAE", screening: "In progress", owner: "Sample Sales" })),
    r("sales.pipeline", "Tanker fleet pilot (sample)", "Qualified", S({ client: "Tanker operator (sample)", segment: "Tanker / commercial vessel", config: "C20 Base", currency: "USD", country: "UAE", screening: "Not started", owner: "Sample Sales" }), {}, 3),
    r("sales.pipeline", "Private island (sample)", "Lead", S({ client: "Family office (sample)", segment: "Private island", config: "C40 Advanced", currency: "USD", screening: "Not started" }), {}, 6),
    r("sales.partners", "Gulf Marine Partners (sample)", "Onboarding", S({ region: "UAE / GCC", agreement: "Referral", screening: "Cleared" }), { company: "Gulf Marine Partners (sample)" }),
    r("technical.software", "AGRON 1 · radar adapter v0.2", "In progress", S({ type: "Feature", component: "StarWall adapters", priority: "High", owner: "Sample Engineer" }), { controlled: true }),
    r("technical.testing", "Bench test · radar + EO/IR fusion", "Planned", S({ type: "Bench", config: "C20 Enhanced", equipment: "Radar + LWIR camera", date: "2026-11-20", owner: "Sample Engineer" }), { controlled: true }),
    r("technical.certification", "TDRA type approval · surveillance radar", "Not started", S({ scheme: "TDRA type approval", equipment: "Short-range surveillance radar" })),
    r("marketing.events", "Monaco Yacht Show 2026", "Done", S({ city: "Monaco", date: "2026-09-23", leads: 0 }), {}, 15),
    r("hr.team", "Chief Executive Officer", "Active", { position: "CEO & President", department: "Management", location: "United States", type: "Employee", us_person: true }, {}, 20),
    r("finance.costing", "C20 Enhanced · cost model (sample)", "Draft", S({ config: "C20 Enhanced" })),
    r("company.wiki", "How we work: where things live", "Published", S({ topic: "Onboarding", body: "Workspace = records, approvals, status. Teams = chat and calls. SharePoint = files. Xero = accounting." }), { company: "*" }),
  );
  return out;
}
