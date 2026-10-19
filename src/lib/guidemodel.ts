// The AGRON Workspace user guide as HTML blocks, in one language. Built from the live sources — the handbook,
// section help, glossary, FAQ, the section/role/approval configuration — plus the guide texts (config/guide).
// Used by the Guide page in the app and by scripts/guide to render the PDFs, so both always match the system.
// Pure: every source and the Markdown renderer are passed in.

type L4 = Partial<Record<string, string>> & { en: string };
export type GuideSources = {
  hb: { id: string; title: L4; body: L4 }[];
  help: Record<string, L4>; glossary: Record<string, [string, L4][]>; faq: { q: L4; a: L4 }[];
  /** UK and AR texts of help, glossary and FAQ, keyed by the English text */
  dict: Record<string, Record<string, string>>;
  depts: { key: string; label: L4; read: string[]; write: string[] }[];
  secs: { id: string; dept: string; label: L4; statuses?: string[]; fields?: { key: string; type?: string; label: L4 }[]; read?: string[]; write?: string[]; external?: string[]; gate?: { msg: L4 }; controlled?: boolean }[];
  roles: Record<string, { label: L4; internal?: boolean }>;
  approvals: Record<string, { wait: string[]; ok: string; no?: string; approvers: string[] }>;
  configs: string[];
};
export type GuideTextIn = { ABOUT: string; HOWTO: string; UI: string; RHYTHM: string; RULES: string; LAUNCH: string; ROLES_START: [string, string][]; FLOW: [string, string][]; S: Record<string, string>; ROLE_DESC: Record<string, string> };
export type Block = { id: string; kind: "part" | "chapter"; num?: number; title: string; html: string; lead?: string; items?: string[] };

const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fill = (s: string, v: Record<string, any>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

export function guideBlocks(lang: string, src: GuideSources, T: GuideTextIn, md: (s: string) => string, img: (name: string) => string | null = () => null) {
  const S = T.S;
  const t4 = (o: any) => (o && (o[lang] || o.en)) || "";
  const t2 = (o: any) => !o ? "" : lang === "en" ? o.en : lang === "ru" ? o.ru || o.en : src.dict[lang]?.[o.en] || o.en;
  const HB = Object.fromEntries(src.hb.map((h) => [h.id, h]));
  const roleLabel = (r: string) => t4(src.roles[r]?.label) || r;
  const blocks: Block[] = []; let n = 0;
  const shot = (f: string, cap: string) => { const u = img(f); return u ? `<figure class="shot"><img src="${u}" alt=""><figcaption>${esc(cap)}</figcaption></figure>` : ""; };
  const part = (num: number, title: string, lead: string, items: string[]) => blocks.push({ id: `p${num}`, kind: "part", num, title, lead, items, html: "" });
  const chapter = (title: string, html: string, cls = "") => { n++; blocks.push({ id: `c${n}`, kind: "chapter", num: n, title, html: cls ? `<div class="${cls}">${html}</div>` : html }); };

  // Part 1
  const roleCount = Object.keys(src.roles).filter((r) => r !== "pending").length;
  const facts = [[src.depts.length, S.f_depts], [src.secs.length, S.f_secs], ["4", S.f_langs], [roleCount, S.f_roles], ["14", S.f_agents], [src.configs.length, S.f_models]];
  const boxes = S.flow_boxes.split("|"), layers = S.layers.split("|").map((x) => x.split("~"));
  const map = `<div class="map"><div class="map-row">${boxes.map((x, i) => `<div class="mb"><span>${i + 1}</span>${esc(x)}</div>`).join("")}</div>
    <div class="map-layers">${layers.map(([b, s]) => `<div><b>${esc(b)}</b><small>${esc(s)}</small></div>`).join("")}</div><div class="map-base">${esc(S.map_base)}</div></div>`;
  part(1, S.p1_t, S.p1_lead, [S.c_about, S.c_map, t4(HB.overview.title), S.c_ui]);
  chapter(S.c_about, md(T.ABOUT) + `<div class="facts">${facts.map(([v, l]) => `<div><b>${v}</b><small>${esc(l)}</small></div>`).join("")}</div><h3>${esc(S.c_how_read)}</h3>` + md(T.HOWTO));
  chapter(S.c_map, `<p>${esc(S.map_intro)}</p>${map}` + shot("overview", S.cap_overview) + md(`**${S.depts_label}:** ${src.depts.map((x) => t4(x.label)).join(" · ")}.\n\n**${S.models_label}:** ${src.configs.map((c) => (c === "Sprinter" ? S.sprinter_desc : c)).join(", ")}; ${S.custom_note}.`));
  chapter(t4(HB.overview.title), md(t4(HB.overview.body)));
  chapter(S.c_ui, md(T.UI) + shot("deal", S.cap_deal));

  // Part 2
  part(2, S.p2_t, S.p2_lead, [t4(HB.start.title), S.c_roles_day, S.c_rhythm_long]);
  chapter(t4(HB.start.title), md(t4(HB.start.body)) + shot("today", S.cap_today));
  chapter(S.c_roles_day, T.ROLES_START.map(([r, x]) => `<div class="role"><h3>${esc(r)}</h3>${md(x.replace(/\n/g, "\n\n"))}</div>`).join("") + shot("decisions", S.cap_decisions));
  chapter(S.c_rhythm, md(T.RHYTHM) + `<div class="callout"><b>${esc(S.main_rules)}</b>${md(T.RULES)}</div>`);

  // Part 3
  part(3, S.p3_t, S.p3_lead, [S.c_flow_short, S.c_screens]);
  chapter(S.c_flow, `<div class="flow">${T.FLOW.map(([h, x], i) => `<div class="fl"><div class="fl-n">${i + 1}</div><div><b>${esc(h)}</b><p>${esc(x).replace(/\*([^*]+)\*/g, "<i>$1</i>")}</p></div></div>`).join("")}</div>`);
  const screens = shot("pipeline", S.cap_pipeline) + shot("portfolio", S.cap_portfolio) + shot("whatif", S.cap_whatif) + shot("finance", S.cap_finance) + shot("sales", S.cap_sales);
  if (screens) chapter(S.c_screens, screens);

  // Part 4: the handbook
  const groups: [string, string[]][] = [[S.g_found, ["records", "everyday", "languages", "access"]], [S.g_sales, ["deals", "control", "projectmoney", "portfolio", "speed"]],
    [S.g_appr, ["approvals", "intake", "ai", "automation", "agents", "emails"]], [S.g_reports, ["reports", "marketing"]], [S.g_sec, ["safety", "owner", "phone", "trouble"]]];
  const used = new Set(["overview", "start", ...groups.flatMap(([, ids]) => ids)]);
  const extra = src.hb.map((h) => h.id).filter((id) => !used.has(id)); // new handbook chapters appear automatically
  if (extra.length) groups[0][1].push(...extra);
  part(4, S.p4_t, S.p4_lead, groups.flatMap(([, ids]) => ids.filter((i) => HB[i]).map((i) => t4(HB[i].title))));
  for (const [, ids] of groups) for (const i of ids) if (HB[i]) chapter(t4(HB[i].title), md(t4(HB[i].body)) + (i === "automation" ? shot("automation", S.cap_automation) : ""), "hb");

  // Part 5: departments and sections
  part(5, S.p5_t, S.p5_lead, src.depts.map((x) => t4(x.label)));
  chapter(S.c_configs, shot("stardome", S.cap_stardome) + md(fill(S.configs_md, { models: src.configs.join(", ") })));
  for (const dp of src.depts) {
    const secs = src.secs.filter((s) => s.dept === dp.key);
    let h = `<p class="lead">${esc(fill(S.ref_lead, { dept: t4(dp.label), n: secs.length, read: dp.read.map(roleLabel).join(", "), write: dp.write.map(roleLabel).join(", ") }))}</p>`;
    for (const s of secs) {
      const lines = t2(src.help[s.id]).split("\n").filter(Boolean); const a = src.approvals[s.id];
      const rows: [string, string][] = [
        [S.k_statuses, (s.statuses || []).join(" → ")],
        [S.k_fields, (s.fields || []).filter((f) => !["html", "checklist"].includes(f.type || "")).map((f) => t4(f.label)).join(", ")],
        [S.k_see, (s.read || dp.read).map(roleLabel).join(", ") + (s.external?.length ? `; ${S.k_external}: ${s.external.map(roleLabel).join(", ")}` : "")],
        [S.k_change, (s.write || dp.write).map(roleLabel).join(", ")],
      ];
      if (a) rows.push([S.k_approval, fill(S.k_approval_v, { wait: a.wait.join(" / "), ok: a.ok, ret: a.no ? fill(S.k_return, { no: a.no }) : "", who: a.approvers.map(roleLabel).join(", ") })]);
      if (s.gate) rows.push([S.k_gate, t4(s.gate.msg)]);
      if (s.controlled) rows.push([S.k_export, S.k_export_v]);
      h += `<div class="sec"><h4>${esc(t4(s.label))}</h4>${lines[0] ? `<p>${esc(lines[0])}</p>` : ""}${lines.length > 1 ? `<ul>${lines.slice(1).map((b) => `<li>${esc(b.replace(/^-\s*/, ""))}</li>`).join("")}</ul>` : ""}
        <table class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></div>`;
    }
    chapter(t4(dp.label), h, "ref");
  }

  // Part 6: roles, access, approvals
  part(6, S.p6_t, S.p6_lead, [S.c_roles, S.c_access, S.c_appr_short]);
  const roles = Object.entries(src.roles).filter(([k]) => k !== "pending");
  chapter(S.c_roles, md(`${S.roles_head}\n|---|---|---|\n${roles.map(([k, v]) => `| ${t4(v.label)} | ${v.internal ? S.internal : S.external} | ${T.ROLE_DESC[k] || ""} |`).join("\n")}\n\n${S.pending_note}`));
  const internal = roles.filter(([, v]) => v.internal).map(([k]) => k);
  chapter(S.c_access, `<p>${esc(S.access_note)}</p><div class="mx"><table class="matrix"><tr><th></th>${internal.map((r) => `<th>${esc(roleLabel(r))}</th>`).join("")}</tr>${src.depts.map((dp) => `<tr><th>${esc(t4(dp.label))}</th>${internal.map((r) => { const w = dp.write.includes(r) || ["owner", "admin"].includes(r), rd = dp.read.includes(r) || w; return `<td class="${w ? "w" : rd ? "r" : ""}">${w ? S.W : rd ? S.R : ""}</td>`; }).join("")}</tr>`).join("")}</table></div>`);
  const sname = (id: string) => { const s = src.secs.find((x) => x.id === id); return s ? `${t4(src.depts.find((x) => x.key === s.dept)?.label)} → ${t4(s.label)}` : id; };
  chapter(S.c_appr, md(`${S.appr_intro}\n\n${S.appr_head}\n|---|---|---|---|\n${Object.entries(src.approvals).map(([id, a]) => `| ${sname(id)} | ${a.wait.join(", ")} | ${a.ok}${a.no ? ` (${S.appr_return}: ${a.no})` : ""} | ${a.approvers.map(roleLabel).join(", ")} |`).join("\n")}\n\n${S.appr_rest}`));

  // Part 7: glossary and FAQ
  part(7, S.p7_t, S.p7_lead, [S.c_gloss, S.c_faq]);
  chapter(S.c_gloss, Object.entries(src.glossary).map(([k, items]) => `<h3>${esc(t4(src.depts.find((x) => x.key === k)?.label) || k)}</h3><dl class="gl">${items.map(([term, v]) => `<dt>${esc(term)}</dt><dd>${esc(t2(v))}</dd>`).join("")}</dl>`).join(""), "two");
  chapter(S.c_faq, `<div class="faq">${src.faq.map((f) => [t2(f.q), t2(f.a)]).filter(([q, a]) => q && a).map(([q, a]) => `<div class="qa"><b>${esc(q)}</b>${md(a)}</div>`).join("")}</div>`, "two");

  // Appendix
  blocks.push({ id: "app", kind: "chapter", title: S.launch_t, html: md(T.LAUNCH) + `<h3>${esc(S.trouble_t)}</h3><p>${esc(fill(S.trouble_p, { chapter: t4(HB.trouble?.title) }))}</p>` });
  return blocks;
}
