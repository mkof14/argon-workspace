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
const fut = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

export const DEMO_PEOPLE: Profile[] = [
  { id: "p1", email: "owner@agron1.com", full_name: "AGRON Owner", role: "owner", department: "management", title: "Chief Executive Officer", company: null, us_person: true, lang: "ru", ai_monthly_tokens: 1000000 },
  { id: "p2", email: "engineer@agron1.com", full_name: "Sample Engineer", role: "engineering", department: "engineering", title: "Systems engineer", manager_id: "p1", company: null, us_person: true, lang: "en", ai_monthly_tokens: 300000 },
  { id: "p3", email: "ops.uae@agron1.com", full_name: "Sample UAE Operations", role: "operations", department: "operations", title: "Operations lead, UAE", manager_id: "p1", company: null, us_person: false, lang: "ar", ai_monthly_tokens: 300000 },
  { id: "p4", email: "finance@agron1.com", full_name: "Sample Finance", role: "finance", department: "finance", title: "Finance manager", manager_id: "p1", company: null, us_person: true, lang: "en", ai_monthly_tokens: 300000 },
  { id: "p5", email: "sales@agron1.com", full_name: "Sample Sales", role: "sales", department: "sales", title: "Business development", manager_id: "p1", company: null, us_person: false, lang: "en", ai_monthly_tokens: 300000 },
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
  for (const m of ["AGRON"]) out.push(r("legal.trademarks", m, "Planned", { mark: m, office: "USPTO" }, {}, 9));

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
    r("technical.software", "AGRON 1 · radar adapter v0.2", "In progress", S({ type: "Feature", component: "Device adapters", priority: "High", owner: "Sample Engineer" }), { controlled: true }),
    r("technical.testing", "Bench test · radar + EO/IR fusion", "Planned", S({ type: "Bench", config: "C20 Enhanced", equipment: "Radar + LWIR camera", date: "2026-11-20", owner: "Sample Engineer" }), { controlled: true }),
    r("technical.certification", "TDRA type approval · surveillance radar", "Not started", S({ scheme: "TDRA type approval", equipment: "Short-range surveillance radar" })),
    r("marketing.social", "Why one picture beats ten screens", "Approved", S({ channel: "LinkedIn", publish: fut(2), pillar: "Thought leadership", check: "Passed (AI check)", reach: 0 })),
    r("marketing.social", "Night watch on a superyacht", "Draft", S({ channel: "Instagram", publish: fut(6), pillar: "Use case", check: "Fix needed" })),
    r("marketing.social", "AGRON at the boat show", "Published", S({ channel: "LinkedIn", publish: fut(-5), pillar: "Events", check: "Passed (AI check)", reach: 4200 })),
    r("marketing.social", "Evidence you can trust", "Published", S({ channel: "X", publish: fut(-9), pillar: "Product", check: "Passed (AI check)", reach: 1300 })),
    r("marketing.press", "Port security in the Gulf: what changes in 2027", "Writing", S({ outlet: "Industry magazine (sample)", format: "Bylined article", deadline: fut(9), publish: fut(20), check: "Not checked" })),
    r("marketing.interviews", "Maritime security podcast (sample)", "Confirmed", S({ type: "Podcast", outlet: "Sample show", spokesperson: "Michael Kofman", session: fut(12), check: "Legal review needed" })),
    r("marketing.video", "StarDome presentation video", "Script", S({ type: "Product presentation", vendor: "Sample studio", length: 90, due: fut(25), check: "Not checked" })),
    r("marketing.campaigns", "Marinas outreach (sample)", "Running", S({ channel: "Email", goal: "Meetings", start_date: fut(-3), sent_count: 120, replies: 9, leads: 4, meetings: 2, spent: 0 })),
    r("marketing.plan", "Q4 2026 · Social media", "Approved", S({ kind: "Budget line", period: "2026-Q4", area: "Social media", planned: 6000, actual: 1500, currency: "USD" })),
    r("marketing.plan", "Q4 2026 · Video", "Approved", S({ kind: "Budget line", period: "2026-Q4", area: "Video", planned: 15000, actual: 4000, currency: "USD" })),
    r("marketing.channels", "AGRON on LinkedIn", "Active", S({ platform: "LinkedIn", handle: "AGRON Inc.", followers: 1240, connection: "CSV export" })),
    r("marketing.channels", "AGRON on YouTube", "Active", S({ platform: "YouTube", handle: "@agron", followers: 310, connection: "API" })),
    r("marketing.channels", "AGRON on Instagram", "Planned", S({ platform: "Instagram", connection: "Link only" })),
    r("marketing.channels", "agron1.com", "Active", S({ platform: "Website", url: "https://www.agron1.com", connection: "CSV export" })),
    r("marketing.metrics", "LinkedIn · prev", "Final", S({ channel: "LinkedIn", account: "AGRON on LinkedIn", period: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7), followers: 1100, impressions: 18400, engagements: 610, clicks: 220 })),
    r("marketing.metrics", "LinkedIn · now", "Draft", S({ channel: "LinkedIn", account: "AGRON on LinkedIn", period: new Date(new Date().getFullYear(), new Date().getMonth() - 0, 1).toISOString().slice(0, 7), followers: 1240, impressions: 9800, engagements: 402, clicks: 131 })),
    r("marketing.metrics", "YouTube · now", "Draft", S({ channel: "YouTube", account: "AGRON on YouTube", period: new Date(new Date().getFullYear(), new Date().getMonth() - 0, 1).toISOString().slice(0, 7), followers: 310, video_views: 5200 })),
    r("technical.systems", "AGRON Workspace", "Operational", S({ type: "Website / app", environment: "Production", url: "https://workspace.agron1.com", health_url: "https://workspace.agron1.com/api/health", provider: "Vercel", latency: 420, last_check: "sample" })),
    r("technical.systems", "Workspace code", "Operational", S({ type: "Code repository", environment: "Development", url: "https://github.com/mkof14/argon-workspace", provider: "GitHub" })),
    r("technical.systems", "Database", "Degraded", S({ type: "Database", environment: "Production", provider: "Supabase", tier: "Free", latency: 3400 })),
    r("technical.metrics", "prev", "Final", S({ period: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7), deploys: 18, incidents: 1, uptime: 99.9, open_bugs: 4, closed_tasks: 31 })),
    r("technical.metrics", "now", "Draft", S({ period: new Date(new Date().getFullYear(), new Date().getMonth() - 0, 1).toISOString().slice(0, 7), deploys: 9, incidents: 0, uptime: 100, open_bugs: 3, closed_tasks: 14 })),
    r("security.metrics", "prev", "Final", S({ period: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7), mfa_pct: 80, screenings: 6, flagged: 1, incidents: 1, patches_overdue: 3, access_reviews: 1 })),
    r("security.metrics", "now", "Draft", S({ period: new Date(new Date().getFullYear(), new Date().getMonth() - 0, 1).toISOString().slice(0, 7), mfa_pct: 100, screenings: 9, flagged: 0, incidents: 0, patches_overdue: 1, access_reviews: 1 })),
    r("finance.metrics", "prev", "Final", S({ period: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7), revenue: 0, expenses: 42000, cash: 610000, burn: 42000 })),
    r("finance.metrics", "now", "Draft", S({ period: new Date(new Date().getFullYear(), new Date().getMonth() - 0, 1).toISOString().slice(0, 7), revenue: 0, expenses: 38000, cash: 572000, burn: 38000 })),
    r("marketing.events", "Monaco Yacht Show 2026", "Done", S({ type: "Exhibition (visit)", city: "Monaco", starts: "2026-09-23", leads: 0 }), {}, 15),
    r("hr.team", "Chief Executive Officer", "Active", { position: "CEO & President", department: "Management", location: "United States", type: "Employee", us_person: true }, {}, 20),
    r("finance.costing", "C20 Enhanced · cost model (sample)", "Draft", S({ config: "C20 Enhanced" })),
    r("company.wiki", "How we work: where things live", "Published", S({ topic: "Onboarding", body: "Workspace = records, approvals, status. Teams = chat and calls. SharePoint = files. Xero = accounting." }), { company: "*" }),
  );
  // ---- SAMPLE daily work: projects with tasks, milestones, documents and meetings (marked) ----
  const P = (title: string, status: string, d: Record<string, any>, age = 6) => { const x = r("company.projects", title, status, S(d), {}, age); out.push(x); return x; };
  const a1 = P("AGRON 1 software — release 1.0 (sample)", "Active", { manager: "Sample Engineer", manager_id: "p2", department: "software", priority: "High", start: fut(-40), target: fut(45), members: "Sample Engineer, AGRON Owner", members_ids: ["p2", "p1"], description: "First release of **AGRON 1**: sensor fusion, alerts and the operator console.\n\n- radar + camera fusion\n- alert rules\n- operator training kit" });
  const c40 = P("StarDome C40 Advanced — first unit (sample)", "Active", { manager: "Sample UAE Operations", manager_id: "p3", department: "operations", priority: "Critical", start: fut(-20), target: fut(-2), members: "Sample UAE Operations, Sample Engineer", members_ids: ["p3", "p2"], description: "Build, test and deliver the first C40 Advanced container." });
  const uae = P("UAE Operations setup (sample)", "Planned", { manager: "AGRON Owner", manager_id: "p1", department: "management", priority: "Normal", start: fut(10), target: fut(120), members: "AGRON Owner, Sample Finance", members_ids: ["p1", "p4"] }, 3);
  const exh = P("Exhibitions 2026 (sample)", "Active", { manager: "Sample Sales", manager_id: "p5", department: "sales", priority: "Normal", start: fut(-10), target: fut(60), members_ids: ["p5"] }, 4);
  const T = (title: string, status: string, pr: Rec, who: string, name: string, due: number | null, pri = "Normal", age = 3) => out.push(r("company.tasks", title, status, S({ project_ref: pr.id, project_ref_title: pr.title, assignee: name, assignee_id: who, ...(due === null ? {} : { due: fut(due) }), priority: pri, ...(status === "Completed" ? { completed_at: fut(-1) } : {}) }), {}, age));
  T("Sensor fusion: radar + PTZ track handover", "In progress", a1, "p2", "Sample Engineer", 3, "High");
  T("Alert rules editor — review UI copy", "Review", a1, "p2", "Sample Engineer", 0, "Normal");
  T("Operator training kit outline", "New", a1, "p1", "AGRON Owner", 12, "Low");
  T("Release notes 1.0", "New", a1, "p1", "AGRON Owner", null, "Normal");
  T("Factory acceptance test plan", "In progress", c40, "p3", "Sample UAE Operations", -3, "Critical");
  T("Long-lead items: thermal camera", "Waiting", c40, "p3", "Sample UAE Operations", -1, "High");
  T("Container wiring diagram sign-off", "Completed", c40, "p2", "Sample Engineer", -6, "High");
  T("Shortlist UAE free zones", "New", uae, "p1", "AGRON Owner", 20, "Normal");
  T("Bank account options for the UAE entity", "New", uae, "p4", "Sample Finance", 30, "Normal");
  T("Book the stand for the Dubai exhibition", "In progress", exh, "p5", "Sample Sales", 1, "High");
  T("Prepare the demo video", "New", exh, "p5", "Sample Sales", 9, "Normal");
  const M = (title: string, status: string, pr: Rec, due: number) => out.push(r("company.milestones", title, status, S({ project_ref: pr.id, project_ref_title: pr.title, due: fut(due) }), {}, 5));
  M("Release candidate", "In progress", a1, 21); M("Release 1.0", "Planned", a1, 45); M("FAT passed", "Planned", c40, -2); M("Shipped to the client", "Planned", c40, 14); M("Entity licence", "Planned", uae, 90); M("Dubai exhibition", "Planned", exh, 25);
  const D = (title: string, type: string, status: string, pr: Rec | null, dept: string, owner: string, ownerId: string, ver: string) => out.push(r("company.documents", title, status, S({ doc_type: type, ...(pr ? { project_ref: pr.id, project_ref_title: pr.title } : {}), department: dept, owner, owner_id: ownerId, version: ver }), {}, 4));
  D("AGRON 1 — system specification (sample)", "Technical specification", "In review", a1, "software", "Sample Engineer", "p2", "0.9");
  D("C40 FAT procedure (sample)", "Engineering documentation", "Draft", c40, "operations", "Sample UAE Operations", "p3", "0.3");
  D("Mutual NDA template (sample)", "NDA", "Approved", null, "legal", "AGRON Owner", "p1", "2.0");
  D("Exhibition budget 2026 (sample)", "Budget", "Draft", exh, "sales", "Sample Sales", "p5", "1.0");
  out.push(r("company.meetings", "AGRON 1 weekly (sample)", "Scheduled", S({ date: fut(0), time: "10:00", duration: 30, place: "Teams", project_ref: a1.id, project_ref_title: a1.title, participants: "Sample Engineer, AGRON Owner", participants_ids: ["p2", "p1"], agenda: "Fusion status, review queue" }), {}, 2));
  out.push(r("company.meetings", "C40 FAT readiness (sample)", "Scheduled", S({ date: fut(2), time: "14:00", duration: 45, place: "Workshop", project_ref: c40.id, project_ref_title: c40.title, participants: "Sample UAE Operations, Sample Engineer, AGRON Owner", participants_ids: ["p3", "p2", "p1"] }), {}, 2));
  return out;
}
