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
  depts: { key: string; icon?: string; label: L4; read: string[]; write: string[] }[];
  secs: { id: string; dept: string; icon?: string; label: L4; statuses?: string[]; fields?: { key: string; type?: string; label: L4 }[]; read?: string[]; write?: string[]; external?: string[]; gate?: { msg: L4 }; controlled?: boolean }[];
  roles: Record<string, { label: L4; internal?: boolean }>;
  approvals: Record<string, { wait: string[]; ok: string; no?: string; approvers: string[] }>;
  configs: string[];
  /** inline SVG for an icon name (lib/icons svgIcon); department colours */
  icon?: (n: string, cls?: string) => string; colors?: Record<string, string>;
};
export type GuideTextIn = { ABOUT: string; HOWTO: string; UI: string; RHYTHM: string; RULES: string; LAUNCH: string; ROLES_START: [string, string][]; FLOW: [string, string][]; S: Record<string, string>; ROLE_DESC: Record<string, string> };
export type Block = { id: string; kind: "part" | "chapter"; num?: number; title: string; html: string; lead?: string; items?: string[]; icon?: string; color?: string };

const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fill = (s: string, v: Record<string, any>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

// Icons for the guide's own visuals (fallback "check" when a list grows)
const PART_ICONS = ["map", "rocket", "stardome", "gear", "grid", "key", "book"];
const BOX_ICONS = ["funnel", "handshake", "file", "calendar", "factory", "shield", "truck", "check", "receipt", "headset"];
const LAYER_ICONS = ["stamp", "radar", "spark", "globe", "bell", "pie"];
const FLOW_ICONS = ["funnel", "handshake", "shield", "file", "stamp", "scale", "calendar", "box", "cart", "flask", "lock", "truck", "check", "coins", "headset", "pdf"];
const PHASES = [[0, 5], [6, 9], [10, 12], [13, 15]]; const PHASE_ICONS = ["handshake", "factory", "truck", "coins"];
const ROLE_ICONS = ["building", "d_sales", "d_ops", "d_fin", "d_tech", "d_mkt", "d_legal", "d_hr"];
const RHYTHM_ICONS = ["refresh", "radar", "sun", "calendar", "pie", "bell"];
const RULE_ICONS = ["pen", "mail", "lock", "stamp", "refresh", "globe"];
const UI_BAR = ["search", "plus", "bell", "spark", "globe", "user"]; const UI_NAV = ["sun", "send", "layers", "file", "calendar", "spark"];
const HB_ICONS: Record<string, string> = { dailywork: "sun", management: "target", reliability: "pulse", overview: "home", start: "rocket", records: "file", everyday: "sun", deals: "handshake", control: "target", projectmoney: "coins", portfolio: "layers", speed: "pulse",
  languages: "globe", access: "key", approvals: "stamp", intake: "upload", ai: "spark", automation: "gear", agents: "radar", emails: "mail", reports: "pie", marketing: "megaphone", safety: "shield", owner: "building", phone: "bell", trouble: "lifebuoy" };

export function guideBlocks(lang: string, src: GuideSources, T: GuideTextIn, md: (s: string) => string, img: (name: string) => string | null = () => null) {
  const S = T.S;
  const t4 = (o: any) => (o && (o[lang] || o.en)) || "";
  const t2 = (o: any) => !o ? "" : lang === "en" ? o.en : lang === "ru" ? o.ru || o.en : src.dict[lang]?.[o.en] || o.en;
  const HB = Object.fromEntries(src.hb.map((h) => [h.id, h]));
  const roleLabel = (r: string) => t4(src.roles[r]?.label) || r;
  const ic = (n: string | undefined, cls = "i") => (src.icon && n ? src.icon(n, cls) : "");
  const im = (x: string) => esc(x).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  const arrow = ic("chev", "i arr");
  const chips = (xs: string[], cls = "st") => `<div class="chain">${xs.map((x) => `<span class="${cls}">${esc(x)}</span>`).join(arrow)}</div>`;
  const tile = (n: string | undefined, c?: string) => `<span class="tile"${c ? ` style="--c:${c}"` : ""}>${ic(n)}</span>`;
  const color = (k: string) => src.colors?.[k] || "";
  const blocks: Block[] = []; let n = 0;
  const shot = (f: string, cap: string) => { const u = img(f); return u ? `<figure class="shot"><img src="${u}" alt=""><figcaption>${esc(cap)}</figcaption></figure>` : ""; };
  const part = (num: number, title: string, lead: string, items: string[]) => blocks.push({ id: `p${num}`, kind: "part", num, title, lead, items, html: "", icon: PART_ICONS[num - 1] });
  const chapter = (title: string, html: string, cls = "", icon?: string, c?: string) => { n++; blocks.push({ id: `c${n}`, kind: "chapter", num: n, title, icon, color: c, html: cls ? `<div class="${cls}">${html}</div>` : html }); };

  // Part 1
  const roleCount = Object.keys(src.roles).filter((r) => r !== "pending").length;
  const facts: [any, string, string][] = [[src.depts.length, S.f_depts, "grid"], [src.secs.length, S.f_secs, "layers"], ["4", S.f_langs, "globe"], [roleCount, S.f_roles, "users"], ["14", S.f_agents, "radar"], [src.configs.length, S.f_models, "stardome"]];
  const howLines = T.HOWTO.split("\n"); const howItems = howLines.map((x) => x.match(/^- \*\*([^*]+)\*\* — (.*)$/)).filter(Boolean) as RegExpMatchArray[];
  const howHtml = howItems.length >= 3 ? `<div class="parts">${howItems.map((m, i) => `<div class="pc">${tile(PART_ICONS[i] || "check")}<div><b>${esc(m[1])}</b><p>${im(m[2])}</p></div></div>`).join("")}</div>` + md(howLines.filter((x) => !/^- \*\*/.test(x)).join("\n")) : md(T.HOWTO);
  part(1, S.p1_t, S.p1_lead, [S.c_about, S.c_map, t4(HB.overview.title), S.c_ui]);
  chapter(S.c_about, md(T.ABOUT) + `<div class="facts">${facts.map(([v, l, i]) => `<div>${tile(i)}<b>${v}</b><small>${esc(l)}</small></div>`).join("")}</div><h3>${esc(S.c_how_read)}</h3>` + howHtml, "", "info");
  const boxes = S.flow_boxes.split("|"), layers = S.layers.split("|").map((x) => x.split("~"));
  const map = `<div class="map"><div class="map-row">${boxes.map((x, i) => `<div class="mb"><span>${ic(BOX_ICONS[i] || "check")}<em>${i + 1}</em></span>${esc(x)}</div>`).join("")}</div>
    <div class="map-layers">${layers.map(([b, s], i) => `<div>${tile(LAYER_ICONS[i] || "check")}<span><b>${esc(b)}</b><small>${esc(s)}</small></span></div>`).join("")}</div><div class="map-base">${ic("server")}${esc(S.map_base)}</div></div>`;
  const dgrid = `<h3>${esc(S.depts_label)}</h3><div class="dgrid">${src.depts.map((d) => { const ss = src.secs.filter((x) => x.dept === d.key); return `<div class="dc">${tile(d.icon, color(d.key))}<div><b>${esc(t4(d.label))}</b><small>${esc(fill(S.secs_n, { n: ss.length }))}</small><p>${ss.map((x) => esc(t4(x.label))).join(" · ")}</p></div></div>`; }).join("")}</div>`;
  chapter(S.c_map, `<p>${esc(S.map_intro)}</p>${map}` + dgrid + shot("overview", S.cap_overview) + md(`**${S.models_label}:** ${src.configs.map((c) => (c === "Sprinter" ? S.sprinter_desc : c)).join(", ")}; ${S.custom_note}.`), "", "map");
  chapter(t4(HB.overview.title), md(t4(HB.overview.body)), "", "home");
  const [zTop, zMenu, zList, zRec] = S.ui_zones.split("|"); const bar = S.ui_bar.split("|"), nav = S.ui_nav.split("|"), rec = S.ui_rec.split("|");
  const ui = `<div class="ui"><div class="ui-top"><small>${esc(zTop)}</small><div>${bar.map((x, i) => `<span>${ic(UI_BAR[i])}${esc(x)}</span>`).join("")}</div></div>
    <div class="ui-nav"><small>${esc(zMenu)}</small>${nav.map((x, i) => `<span>${ic(UI_NAV[i])}${esc(x)}</span>`).join("")}</div>
    <div class="ui-list"><small>${esc(zList)}</small>${[86, 70, 78, 60, 74].map((w) => `<i style="width:${w}%"></i>`).join("")}</div>
    <div class="ui-rec"><small>${esc(zRec)}</small>${rec.map((x, i) => `<span><em>${i + 1}</em>${esc(x)}</span>`).join("")}</div></div><p class="cap">${esc(S.ui_intro)}</p>`;
  chapter(S.c_ui, ui + md(T.UI) + shot("deal", S.cap_deal), "", "laptop");

  // Part 2
  part(2, S.p2_t, S.p2_lead, [t4(HB.start.title), S.c_roles_day, S.c_rhythm_long]);
  chapter(t4(HB.start.title), md(t4(HB.start.body)) + shot("today", S.cap_today), "", "rocket");
  chapter(S.c_roles_day, `<div class="roles">${T.ROLES_START.map(([r, x], i) => `<div class="role"><div class="role-h">${tile(ROLE_ICONS[i] || "user")}<h3>${esc(r)}</h3></div>${md(x.replace(/\n/g, "\n\n"))}</div>`).join("")}</div>` + shot("decisions", S.cap_decisions), "", "users");
  const rrows = T.RHYTHM.split("\n").filter((x) => x.trim().startsWith("|")).slice(2).map((x) => x.split("|").slice(1, -1).map((c) => c.trim()));
  const rhythm = rrows.length ? `<div class="rhythm">${rrows.map(([w, what, where], i) => `<div class="rh">${tile(RHYTHM_ICONS[i] || "clock")}<div><b>${im(w)}</b><p>${im(what)}</p></div><span class="tag">${im(where || "")}</span></div>`).join("")}</div>` : md(T.RHYTHM);
  const rules = T.RULES.split("\n").map((x) => x.match(/^- \*\*([^*]+)\*\*\s*(.*)$/)).filter(Boolean) as RegExpMatchArray[];
  const rulesHtml = rules.length ? `<div class="rules">${rules.map((m, i) => `<div>${tile(RULE_ICONS[i] || "shield")}<span><b>${esc(m[1])}</b> ${im(m[2])}</span></div>`).join("")}</div>` : md(T.RULES);
  chapter(S.c_rhythm, rhythm + `<h3>${esc(S.main_rules)}</h3>` + rulesHtml, "", "clock");

  // Part 3
  part(3, S.p3_t, S.p3_lead, [S.c_flow_short, S.c_screens]);
  const ph = S.ph.split("|");
  const phases = PHASES.filter(([a]) => a < T.FLOW.length).map(([a, b], k) => [a, k === PHASES.length - 1 ? T.FLOW.length - 1 : Math.min(b, T.FLOW.length - 1), k]);
  const step = (i: number) => { const [h, x] = T.FLOW[i]; return `<div class="fl"><div class="fl-n">${ic(FLOW_ICONS[i] || "check")}<em>${i + 1}</em></div><div><b>${esc(h)}</b><p>${im(x)}</p></div></div>`; };
  const flow = `<div class="phases">${phases.map(([a, b, k]) => `<div>${tile(PHASE_ICONS[k])}<b>${esc(ph[k] || "")}</b><small>${esc(fill(S.steps_n, { a: a + 1, b: b + 1 }))}</small></div>`).join(arrow)}</div>`
    + phases.map(([a, b, k]) => `<div class="phase"><h3><span>${k + 1}</span>${esc(ph[k] || "")}</h3><div class="flow">${Array.from({ length: b - a + 1 }, (_, j) => step(a + j)).join("")}</div></div>`).join("");
  chapter(S.c_flow, flow, "", "stardome");
  const screens = shot("pipeline", S.cap_pipeline) + shot("portfolio", S.cap_portfolio) + shot("whatif", S.cap_whatif) + shot("finance", S.cap_finance) + shot("sales", S.cap_sales);
  if (screens) chapter(S.c_screens, screens, "", "image");

  // Part 4: the handbook
  const groups: [string, string[]][] = [[S.g_found, ["dailywork", "records", "everyday", "languages", "access"]], [S.g_sales, ["deals", "control", "projectmoney", "portfolio", "speed"]],
    [S.g_appr, ["approvals", "intake", "ai", "automation", "agents", "emails"]], [S.g_reports, ["management", "reports", "marketing"]], [S.g_sec, ["safety", "reliability", "owner", "phone", "trouble"]]];
  const used = new Set(["overview", "start", ...groups.flatMap(([, ids]) => ids)]);
  const extra = src.hb.map((h) => h.id).filter((id) => !used.has(id)); // new handbook chapters appear automatically
  if (extra.length) groups[0][1].push(...extra);
  part(4, S.p4_t, S.p4_lead, groups.flatMap(([, ids]) => ids.filter((i) => HB[i]).map((i) => t4(HB[i].title))));
  for (const [, ids] of groups) for (const i of ids) if (HB[i]) chapter(t4(HB[i].title), md(t4(HB[i].body)) + (i === "automation" ? shot("automation", S.cap_automation) : ""), "hb", HB_ICONS[i] || "book");

  // Part 5: departments and sections
  part(5, S.p5_t, S.p5_lead, src.depts.map((x) => t4(x.label)));
  chapter(S.c_configs, shot("stardome", S.cap_stardome) + md(fill(S.configs_md, { models: src.configs.join(", ") })), "", "stardome");
  for (const dp of src.depts) {
    const secs = src.secs.filter((s) => s.dept === dp.key); const c = color(dp.key);
    let h = `<div class="dh" style="--c:${c}">${tile(dp.icon, c)}<p>${esc(fill(S.ref_lead, { dept: t4(dp.label), n: secs.length, read: dp.read.map(roleLabel).join(", "), write: dp.write.map(roleLabel).join(", ") }))}</p></div>`;
    for (const s of secs) {
      const lines = t2(src.help[s.id]).split("\n").filter(Boolean); const a = src.approvals[s.id];
      const fields = (s.fields || []).filter((f) => !["html", "checklist"].includes(f.type || "")).map((f) => t4(f.label));
      const rows: [string, string][] = [
        [S.k_see, esc((s.read || dp.read).map(roleLabel).join(", ") + (s.external?.length ? `; ${S.k_external}: ${s.external.map(roleLabel).join(", ")}` : ""))],
        [S.k_change, esc((s.write || dp.write).map(roleLabel).join(", "))],
      ];
      if (a) rows.push([S.k_approval, esc(fill(S.k_approval_v, { wait: a.wait.join(" / "), ok: a.ok, ret: a.no ? fill(S.k_return, { no: a.no }) : "", who: a.approvers.map(roleLabel).join(", ") }))]);
      if (s.gate) rows.push([S.k_gate, esc(t4(s.gate.msg))]);
      if (s.controlled) rows.push([S.k_export, esc(S.k_export_v)]);
      h += `<div class="sec"><div class="sec-h">${tile(s.icon || dp.icon, c)}<h4>${esc(t4(s.label))}</h4>${s.controlled ? `<span class="tag warn">${ic("lock")}US</span>` : ""}</div>${lines[0] ? `<p>${esc(lines[0])}</p>` : ""}${lines.length > 1 ? `<ul>${lines.slice(1).map((b) => `<li>${esc(b.replace(/^-\s*/, ""))}</li>`).join("")}</ul>` : ""}
        ${s.statuses?.length ? `<div class="kvl"><small>${esc(S.k_statuses)}</small>${chips(s.statuses)}</div>` : ""}${fields.length ? `<div class="kvl"><small>${esc(S.k_fields)}</small><div class="tags">${fields.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}</div></div>` : ""}
        <table class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table></div>`;
    }
    chapter(t4(dp.label), h, "ref", dp.icon || "grid", c);
  }

  // Part 6: roles, access, approvals
  part(6, S.p6_t, S.p6_lead, [S.c_roles, S.c_access, S.c_appr_short]);
  const roles = Object.entries(src.roles).filter(([k]) => k !== "pending");
  chapter(S.c_roles, `<div class="rcards">${roles.map(([k, v]) => `<div class="rc">${tile(v.internal ? "user" : "ext")}<div><b>${esc(t4(v.label))}</b><span class="tag ${v.internal ? "ok" : "info"}">${esc(v.internal ? S.internal : S.external)}</span><p>${im(T.ROLE_DESC[k] || "")}</p></div></div>`).join("")}</div>` + md(S.pending_note), "", "users");
  const internal = roles.filter(([, v]) => v.internal).map(([k]) => k);
  chapter(S.c_access, `<p>${esc(S.access_note)}</p><div class="mx"><table class="matrix"><tr><th></th>${internal.map((r) => `<th>${esc(roleLabel(r))}</th>`).join("")}</tr>${src.depts.map((dp) => `<tr><th>${esc(t4(dp.label))}</th>${internal.map((r) => { const w = dp.write.includes(r) || ["owner", "admin"].includes(r), rd = dp.read.includes(r) || w; return `<td class="${w ? "w" : rd ? "r" : ""}">${w ? S.W : rd ? S.R : ""}</td>`; }).join("")}</tr>`).join("")}</table></div>`, "", "key");
  const [lWait, lOk, lNo, lWho] = S.appr_lbl.split("|");
  const sdept = (id: string) => src.secs.find((x) => x.id === id);
  chapter(S.c_appr, md(S.appr_intro) + `<div class="apgrid">${Object.entries(src.approvals).map(([id, a]) => { const s = sdept(id); const dl = s ? src.depts.find((x) => x.key === s.dept) : undefined;
    return `<div class="ap">${tile(s?.icon || dl?.icon || "stamp", dl ? color(dl.key) : "")}<div><small>${esc(t4(dl?.label))}</small><b>${esc(s ? t4(s.label) : id)}</b>
    <div class="chain"><span class="st">${esc(lWait)}: ${esc(a.wait.join(", "))}</span>${arrow}<span class="st ok">${esc(a.ok)}</span>${a.no ? `<span class="st no">${esc(lNo)}: ${esc(a.no)}</span>` : ""}</div><p>${esc(lWho)}: ${esc(a.approvers.map(roleLabel).join(", "))}</p></div></div>`; }).join("")}</div>` + md(S.appr_rest), "", "stamp");

  // Part 7: glossary and FAQ
  part(7, S.p7_t, S.p7_lead, [S.c_gloss, S.c_faq]);
  chapter(S.c_gloss, Object.entries(src.glossary).map(([k, items]) => { const d = src.depts.find((x) => x.key === k); return `<h3 class="gh">${d ? tile(d.icon, color(d.key)) : ""}${esc(t4(d?.label) || k)}</h3><dl class="gl">${items.map(([term, v]) => `<dt>${esc(term)}</dt><dd>${esc(t2(v))}</dd>`).join("")}</dl>`; }).join(""), "two", "book");
  chapter(S.c_faq, `<div class="faq">${src.faq.map((f) => [t2(f.q), t2(f.a)]).filter(([q, a]) => q && a).map(([q, a]) => `<div class="qa"><b>${ic("info")}${esc(q)}</b>${md(a)}</div>`).join("")}</div>`, "two", "lifebuoy");

  // Appendix
  const ll = T.LAUNCH.split("\n"); const lsteps = ll.map((x) => x.match(/^\d+\.\s+(.*)$/)).filter(Boolean) as RegExpMatchArray[];
  const launch = lsteps.length ? md(ll.filter((x) => !/^\d+\.\s/.test(x)).join("\n")) + `<div class="lsteps">${lsteps.map((m, i) => `<div><em>${i + 1}</em><span>${im(m[1])}</span></div>`).join("")}</div>` : md(T.LAUNCH);
  blocks.push({ id: "app", kind: "chapter", title: S.launch_t, icon: "check", html: launch + `<h3>${esc(S.trouble_t)}</h3><p>${esc(fill(S.trouble_p, { chapter: t4(HB.trouble?.title) }))}</p>` });
  return blocks;
}
