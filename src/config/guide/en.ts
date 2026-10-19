// User guide texts — EN. Keep in step with the other languages (see types.ts).
import type { GuideText } from "./types.ts";
const T: GuideText = {
 "ABOUT": "AGRON Workspace is the internal system of AGRON Inc. where the company runs all of its work: StarDome sales and projects, builds and procurement, compliance and export control, finance, service of installed units, marketing, legal matters and people. Everything is connected in one chain of records: a lead becomes a deal, a deal becomes a proposal and a project, and a project becomes a build, purchases, shipping, installation, acceptance, invoices and service.\n\nHelpers work on top of the records: **agents** check deadlines, money and risks every working day and prepare actions; **AI** answers questions about documents and carries out commands written in plain words; the **translator** keeps every record in four languages; **notifications** arrive by email and on the phone. Nothing important happens on its own: a signature, a payment, a publication or a letter to an outside address always waits for a person's decision.\n\nThis document describes the whole system — from the first sign-in to the owner's settings. It is built from the same handbook that lives inside Workspace (FAQ & Learning Center → \"How it works\") and adds a map of the system, the end-to-end process, a reference for every section and checklists.",
 "HOWTO": "- **Part 1** — what the system is and how it is organised; the map and the interface.\n- **Part 2** — quick start: the first day and the working rhythm of each role.\n- **Part 3** — the StarDome end-to-end process: from the first contact to service, step by step.\n- **Part 4** — how it works: detailed chapters on every mechanism of the system.\n- **Part 5** — reference: all departments and sections, statuses, fields and access.\n- **Part 6** — roles, access, approvals and status gates.\n- **Part 7** — terms and answers to frequent questions.\n- **Appendix** — the launch checklist and the everyday rules.\n\nButton and section names are given exactly as they appear in the English interface. Record statuses are written in English in every language (for example *Won*, *Approved*, *Shipping*) so the whole international team reads them the same way.",
 "UI": "**Top bar** (on every page):\n- **Search** (⌘K / Ctrl+K) — records, sections, pages and commands; the microphone next to it searches by voice.\n- **Camera** — \"Photo → record\": a receipt becomes an expense, a business card a lead, a delivery note marks the purchase order received.\n- **Upload** — smart upload of any document: AI proposes the section and fills the fields, you check and save.\n- **Bell** — approvals, my deadlines, mentions and company-wide overdue items.\n- **Ask AI** — questions about the data and commands (\"create a task…\", \"move the deal to Proposal…\").\n- **Language** (EN, RU, UK, AR) and **theme** (light / dark).\n\n**Left menu**:\n- **Company overview** — the key numbers, upcoming deadlines, announcements, quick actions.\n- **My day** — what needs me today: approvals, my deadlines, tasks, mentions.\n- **Decisions** — everything that waits for my yes or no, with checks and a one-tap answer.\n- **StarDome configurations** — the five containers and the mobile Sprinter: readiness, blockers and documents for each model.\n- **Projects** — the portfolio with a traffic light, team workload, \"What if\" scenarios.\n- **Ask documents** — AI answers from uploaded files with links to the source.\n- **Reports**, **Templates**, **Tasks & reminders**, **FAQ & Learning Center**, **Recycle bin** (30 days).\n- **Departments** — each has an **Overview** (KPIs, charts, what its agent noticed, report) and sections.\n- **Administration** (owner and administrator) — users, roles and access, system.\n\n**A record** opens on the right, over the list:\n- header — title and status; action bar: *Copy, Print, PDF, Share, Download, Email, Duplicate, Ask AI*;\n- the section's fields; links (deal, build, client…) — each opens the linked record, and below them the whole chain from lead to service;\n- working blocks that depend on the section: approval and checks, proposal, project plan and timeline, project money, build parts, request SLA, service and warranty, vendor performance, collection;\n- files, comments with @mentions and the history of every change;\n- at the bottom — *Save*, *Cancel*, *Delete* (the record goes to the recycle bin for 30 days).",
 "RHYTHM": "| When | What happens | Where to look |\n|---|---|---|\n| Every 15 minutes | Mail intake, translations, SLA reminders, calendar | Automatic |\n| Every working day, 10:00 UTC | Agents check deadlines, money and risks and prepare actions | \"System\" → \"Automation\", \"Decisions\" |\n| Every morning, 8:00 your time | Digest email: approvals, deadlines, tasks, mentions | Email, \"My day\" |\n| Monday | Brief for leaders: pipeline, cash, overdue items, risks | Email |\n| Start of the month | Department reports and monthly KPIs | \"Reports\", department overviews |\n| All the time | Phone notifications: approvals, mentions, SLA, invoices | Phone (once notifications are on) |",
 "RULES": "- **Signatures, payments and publications are never automatic.** Workspace prepares, reminds and records; a person signs and pays.\n- **Letters to outside addresses always wait for approval** — even when an agent works in \"Auto\" mode.\n- **\"US persons only\" data** (export control) is seen only by confirmed US persons; it never goes to the client portal, into letters to other people or onto a device without a connection.\n- **Status gates cannot be bypassed**: *Won* without sanctions screening, *Shipping* without compliance, spending above the limit without approval, publishing without the check.\n- **Nothing deleted disappears at once**: the recycle bin keeps records for 30 days.\n- **Originals never change in translation**: the translation is stored next to them; editing in your own language keeps the original.",
 "LAUNCH": "What the owner does once at launch (technical details are with the administrator):\n\n1. **Keys of outside services** are entered in the hosting settings by the owner himself: backup encryption, sanctions lists, YouTube, GitHub, Google Calendar. Secrets are never sent in chat or by email.\n2. **The secret for the 15-minute jobs** — in the code repository settings. After that mail intake, translations, the local morning digest, the calendar and SLA alerts work.\n3. **Database update** (the next SQL script) — run in the database console.\n4. **Social links** — in \"Marketing\" → \"Channels\".\n5. **Live checks**: phone notifications, translation, proposal, project, client portal, photo → record, working without a connection.\n6. **\"Translate now\"** in \"System\" → \"Settings\" — translation of existing records into four languages.\n7. **Quarterly sales target**, **approval limits**, **working days and holidays** — in \"System\" → \"Settings\".\n8. **Make the code repository private** and delete temporary branches.",
 "ROLES_START": [
  [
   "Owner and management",
   "**Morning.** \"Decisions\": approvals with checks, agent proposals, invoices ready to send, projects at risk — a one-tap answer. Then \"My day\" and the digest email at 8:00 your time.\n**Week.** \"Projects\" → \"Portfolio\" (traffic light and reasons), \"Team workload\" (who is overloaded), \"Finance\" → \"Overview\" (cash for 90 days, receivables, DSO), \"Sales\" → \"Overview\" → \"Sales analytics\" (the quarter forecast against the target). The Monday brief arrives by email.\n**Before a decision.** \"Projects\" → \"What if\": how a project slip or a late client payment changes cash and dates.\n**Settings.** \"System\" → \"Settings\": working days, thresholds, approval limits, sales target, AI budget, languages; \"Automation\" — agent modes."
  ],
  [
   "Sales",
   "**Every day.** \"Deals pipeline\" (board): move deals through the stages and set the *expected close date* — without it a deal is not in the forecast. New leads come from \"Marketing\" → \"Leads\" and from business cards via the camera.\n**Deal.** \"Make a proposal\" → a branded PDF with a number; a discount above 15% and a price below costing are highlighted at approval. *Won* is only possible after sanctions screening is *Cleared*.\n**After the win.** \"Unfold the project\" → a plan with dates and owners, invoices by milestone; in the client card — \"Client portal\": a personal link where the client sees the status of their units and leaves service requests.\n**Loss.** Fill in \"Why lost\" — the analytics need it."
  ],
  [
   "Operations",
   "**Projects.** The timeline in the deal: moving a step moves every later one. A build shows \"Parts for this build\": reserve from stock and draft orders for the shortage.\n**Purchasing.** An order above the limit goes for approval; on receipt — status *Received*, quantity and rejects (or a photo of the delivery note). Vendor performance is shown in every order.\n**Shipping.** A build cannot go to *Shipping* and a shipment cannot be in transit without the export check, the deal screening and the end-user certificate.\n**Service.** Requests with SLA deadlines, planned service by service plan, warranty and a service-contract offer. On site without a connection the work is kept on the phone."
  ],
  [
   "Finance",
   "**Overview.** Cash for 90 days, the cash gap, receivables and payables by age, DSO, top overdue clients, margin by configuration.\n**Milestone invoices** are created from the project and become ready after FAT and SAT — check them and send to the client, then set *Sent*. Client reminders (7, 21, 45 days) are prepared in the client's language and wait for approval.\n**Expenses and purchases** above the limit — only after approval; \"Decisions\" shows duplicates and department budget overruns.\n**Project money** in every won deal: costs against costing and the expected margin."
  ],
  [
   "Engineering",
   "**StarDome configurations** — readiness of each model by area: equipment, bill of materials (BOM), documentation, integration, testing, certification, changes.\n**The BOM** per configuration is the basis for stock reservation and costing. Engineering changes (ECR) with impact and priority; FAT and SAT in \"Quality\".\n**Technical data** about sensors, radars, RF, EO/IR, UAVs and AGRON 1 internals is marked \"US persons only\"."
  ],
  [
   "Marketing",
   "**Channels and the publishing calendar**, media, press, interviews, video, campaigns, the brand centre with approved texts.\nPublishing is possible only after the check (AI or counsel) and approval. Leads from campaigns and business cards go to sales."
  ],
  [
   "Legal and security",
   "**Legal:** contracts (including contract changes — *Change order*), the equipment compliance matrix, licences, regulators, obligations with recurring deadlines, requests from departments.\n**Security:** sanctions and end-user screening of parties, export classification of technical data, incidents, audits, the access log. Export-controlled records are visible only to confirmed US persons."
  ],
  [
   "HR",
   "People, hiring, onboarding with checklists, leave with approval, training, policies. The HR agent reminds about document and onboarding deadlines — with no personal details in notifications."
  ]
 ],
 "FLOW": [
  [
   "Lead",
   "\"Marketing\" → \"Leads\" or a photo of a business card. Source, contact, segment, country, owner."
  ],
  [
   "Deal",
   "The lead moves to the \"Deals pipeline\": client, segment, StarDome configuration, value, expected close date. The client card holds the letter language."
  ],
  [
   "Sanctions screening",
   "As the deal moves, the compliance agent prepares a party screening in \"Security\" → \"Restricted-party screening\". Without *Cleared* the deal cannot become *Won*."
  ],
  [
   "Proposal",
   "\"Make a proposal\": price from the price list, quantity, discount, payment terms (30/40/30, 40/50/10, 50/50, 100%), delivery time, lease, language. The PDF with number P-2026-001 is saved in \"Proposals & quotes\"."
  ],
  [
   "Proposal approval",
   "The proposal goes for approval. \"Decisions\" shows the checks: discount above 15%, price below the approved costing. After approval — sending to the client from the record."
  ],
  [
   "Win and contract",
   "The deal is *Won* (after the screening). The contract — in \"Legal\" → \"Contracts\". Changes of scope and price are then made as a *Change order*."
  ],
  [
   "Project plan",
   "\"Unfold the project\": template (USA, UAE or Sprinter), start, owners, payment terms. All steps with dates and the milestone invoices are created; the timeline shows everything at once."
  ],
  [
   "Build and parts",
   "The build shows the bill of materials: needed, reserved, free, on order and short. \"Reserve from stock\" and \"Draft orders for the shortage\"."
  ],
  [
   "Purchasing",
   "Orders above the limit go through approval with checks (duplicate, budget, vendor). Order and promised delivery dates are remembered — they make up the vendor's performance."
  ],
  [
   "Factory acceptance (FAT)",
   "The \"Quality\" → FAT step. When it is closed, the \"before shipping\" invoice becomes ready to send and finance is notified."
  ],
  [
   "Compliance before shipping",
   "Export check of the build *Cleared*, deal screening *Cleared*, end-user certificate *Signed*. Without them the *Shipping* status and the dispatch of goods are blocked."
  ],
  [
   "Shipping and installation",
   "\"Logistics & customs\": carrier, tracking number, HS code, licence. After *Delivered* the installation is prepared; after *Commissioned* the build becomes *Installed* and the unit goes to \"Installed base & SLA\"."
  ],
  [
   "Site acceptance (SAT)",
   "When site acceptance is closed, the \"on acceptance\" invoice is ready. Training of the client's operators."
  ],
  [
   "Money",
   "Invoices are sent to the client and payments recorded. Overdue amounts follow the reminder ladder in the client's language. \"Project money\" shows the margin against costing."
  ],
  [
   "Service",
   "Client requests (also from the portal) with SLA deadlines; planned service by service plan; 60 days before the warranty ends — a deal for a service contract."
  ],
  [
   "Project pack",
   "At any moment — \"Project pack (PDF)\": proposal, contracts, checks, plan, payments, acceptance, files and photos in one document."
  ]
 ],
 "S": {
  "doc_title": "User guide",
  "cover_k": "User guide",
  "cover_p": "The complete description of the system: structure, sections, processes, roles, approvals, agents and AI — step by step, with examples.",
  "version": "Version",
  "internal_doc": "Internal document of AGRON Inc.",
  "contents": "Contents",
  "part": "Part",
  "chapter": "Chapter",
  "appendix": "Appendix",
  "ph": "Sale|Project and build|Delivery|Money and service",
  "ui_bar": "Search|Photo|Upload|Notifications|Ask AI|Language",
  "ui_nav": "Company overview|My day|Decisions|StarDome|Projects|Departments",
  "ui_rec": "Title and status|Actions|Fields|Links and chain|Working blocks|Files and comments",
  "ui_zones": "Top bar|Left menu|List, board or overview|Record",
  "ui_intro": "The screen has four zones; a record opens on the side, over the list.",
  "steps_n": "steps {a}–{b}",
  "secs_n": "Sections: {n}",
  "appr_lbl": "Waiting|Approved|Returned|Approvers",
  "footer": "AGRON Workspace · User guide",
  "f_depts": "departments",
  "f_secs": "sections",
  "f_langs": "languages: EN, RU, UK, AR",
  "f_roles": "roles",
  "f_agents": "agents",
  "f_models": "StarDome models",
  "flow_boxes": "Lead|Deal|Proposal|Project|Build and purchasing|Compliance|Shipping|Installation and acceptance|Invoices and payment|Service",
  "layers": "Decisions~approvals, checks, one-tap answers|Agents~check deadlines, money and risks every day|AI~questions, commands, reading documents and photos|Languages~every record in EN, RU, UK, AR|Notifications~email, phone, digests|Reports~KPIs, dashboards, PDF packs",
  "map_base": "One database of records · role-based access · \"US persons only\" data · change history · backups",
  "p1_t": "Getting to know the system",
  "p1_lead": "What AGRON Workspace is, what it is made of and where everything is.",
  "c_about": "About the system and this document",
  "c_how_read": "How to read this document",
  "c_map": "Map of the system",
  "c_ui": "The interface: where everything is",
  "map_intro": "The StarDome end-to-end process runs left to right; below it are the layers that work for every step.",
  "cap_overview": "Company overview — the first page after signing in",
  "depts_label": "Departments",
  "models_label": "StarDome models",
  "sprinter_desc": "Sprinter (the mobile version on a Mercedes-Benz Sprinter van)",
  "custom_note": "plus *Custom* for non-standard solutions",
  "cap_deal": "A deal: links, proposal, project plan and timeline",
  "p2_t": "Quick start",
  "p2_lead": "The first day and the working rhythm of each role.",
  "c_roles_day": "A working day by role",
  "c_rhythm": "The system rhythm",
  "c_rhythm_long": "The system rhythm: what happens and when",
  "main_rules": "The main rules",
  "cap_today": "\"My day\" — everything that needs you today",
  "cap_decisions": "\"Decisions\": approvals with checks and a one-tap answer",
  "p3_t": "End-to-end: from lead to service",
  "p3_lead": "Sixteen steps of a StarDome project — what a person does and what the system does.",
  "c_flow": "Sixteen steps of a project",
  "c_flow_short": "Sixteen steps",
  "c_screens": "Projects, money and decisions on screen",
  "cap_pipeline": "Deals pipeline: the board by stage with sums",
  "cap_portfolio": "\"Projects\" → \"Portfolio\": traffic light, next step, margin, collected",
  "cap_whatif": "\"Projects\" → \"What if\": cash for 13 weeks now and with the changes",
  "cap_finance": "\"Finance\" → \"Overview\": monthly KPIs and the agent's notices",
  "cap_sales": "\"Sales\" → \"Overview\" → \"Sales analytics\"",
  "p4_t": "How it works",
  "p4_lead": "Every mechanism of the system in detail — the same as \"How it works\" inside Workspace.",
  "g_found": "Foundations",
  "g_sales": "Sales, projects and money",
  "g_appr": "Approvals, AI and automation",
  "g_reports": "Reports and marketing",
  "g_sec": "Security and administration",
  "cap_automation": "\"System\" → \"Automation\": agents and modes",
  "p5_t": "Departments and sections",
  "p5_lead": "Reference: every section — purpose, statuses, fields, access and approval.",
  "c_configs": "StarDome configurations",
  "cap_stardome": "\"StarDome configurations\": readiness of a model by area",
  "configs_md": "The page gathers everything about one model: equipment, bill of materials (BOM), documentation, integration, testing, certification, engineering changes, costing, builds and installed units. Records are linked by the \"StarDome configuration\" field; records marked *Custom* or without a configuration count as shared by all models. Models: {models}.",
  "ref_lead": "{dept}: {n} sections. Can see: {read}. Can change: {write}.",
  "k_statuses": "Statuses",
  "k_fields": "Fields",
  "k_see": "Can see",
  "k_change": "Can change",
  "k_external": "external",
  "k_approval": "Approval",
  "k_approval_v": "from {wait} → {ok}{ret}; decide: {who}",
  "k_return": " (return → {no})",
  "k_gate": "Status gate",
  "k_export": "Export control",
  "k_export_v": "records of this section are US persons only by default",
  "p6_t": "Roles, access and approvals",
  "p6_lead": "Who sees and changes what, what needs approval and which statuses are locked until a check.",
  "c_roles": "Roles",
  "c_access": "Access by department",
  "c_appr": "Approvals and status gates",
  "c_appr_short": "Approvals and gates",
  "roles_head": "| Role | Type | What it means |",
  "internal": "internal",
  "external": "external",
  "pending_note": "New users have the role \"Pending access\" until an administrator assigns a role. Each person can be marked as a **US person** — only such people see export-controlled records.",
  "access_note": "R — can see, W — can see and change (default rules; the administrator can change them in \"Roles & access\").",
  "R": "R",
  "W": "W",
  "appr_intro": "**Sections with approval** — the \"Send for approval\" button in the record; the decision in \"Decisions\", in \"My day\" and by email:",
  "appr_head": "| Section | Waits in status | After approval | Who decides |",
  "appr_return": "return",
  "appr_rest": "**Spending limits.** Expenses and purchase orders above the self-approval amount (500 USD by default) cannot become *Approved*, *Ordered* or *Paid* without an approved request: up to 5,000 USD — finance, management, administrator or owner; up to 50,000 USD — management, administrator or owner; above that — the owner. The owner changes the amounts and roles.\n\n**Status gates:**\n- a deal becomes *Won* only after sanctions and end-user screening is *Cleared*;\n- a build goes to *Shipping* / *Installed* and a shipment to *In transit* / *Customs* / *Delivered* only with the export check *Cleared*, the deal screening *Cleared* and the end-user certificate *Signed* (or *Not required*);\n- marketing publications — only after the check (AI or counsel) and approval.\n\n**Checks before approving** (shown in the card): possible duplicate, above the department budget, vendor not screened or blocked, unusually large amount, discount above 15%, price below the approved costing. With a red check the button reads \"Approve anyway\".",
  "p7_t": "Terms and questions",
  "p7_lead": "The departments' glossary and answers to frequent questions.",
  "c_gloss": "Glossary",
  "c_faq": "Frequently asked questions",
  "launch_t": "Launch checklist",
  "trouble_t": "If something is wrong",
  "trouble_p": "Start with the chapter \"{chapter}\". Page errors are recorded for administrators automatically; \"System\" → \"Health\" shows whether the database, sign-in, email and AI work.",
  "end_note": "Internal document. Do not share outside the company.",
  "month": "October 2026"
 },
 "ROLE_DESC": {
  "owner": "Everything, including system settings, approval limits, the sales target and the AI budget.",
  "admin": "Users, roles and access, the system, backups.",
  "management": "Sees all departments, approves large amounts, receives escalations.",
  "engineering": "Technical department: equipment, BOM, testing, changes.",
  "operations": "Builds, purchasing, inventory, logistics, installation, service.",
  "finance": "Invoices, expenses, budget, costing, cash forecast.",
  "sales": "Leads, deals, clients, proposals, tenders, partners.",
  "marketing": "Channels, publications, campaigns, brand centre.",
  "hr": "People, hiring, leave, training, policies.",
  "legal": "Contracts, compliance, licences, obligations.",
  "security": "Party screening, export control, incidents, audits.",
  "partner": "Outside partner: only proposals, media and requests shared with them.",
  "vendor": "Outside vendor: only their own orders and shared records.",
  "investor": "Outside investor: only reports and materials shared with them."
 }
};
export default T;
