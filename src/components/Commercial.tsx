"use client";
// COMMERCIAL (Phase 7): organisations, contacts, leads, opportunities, proposals and events in one place — on the same
// records as the rest of Workspace (no second CRM). Every list and number comes from a v24 database function for the
// signed-in person only; every rule (stages, values, proposals, conversion) is checked by the database.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, MANAGERS } from "./App";
import { sb, DEMO } from "@/lib/sb";
import { store } from "@/lib/store";
import { crm, amount, amounts, parseCsv, toCsv, type Filter } from "@/lib/crmApi";
import { CRM_KIND, HEALTH, L, parseCardText, parseContactCode, type T4 } from "@/lib/crmText";
import { say } from "@/lib/opsText";

type Tab = "dashboard" | "pipeline" | "forecast" | "organizations" | "contacts" | "leads" | "event" | "review" | "io" | "settings";
const day = (s?: string | null) => (s ? String(s).slice(0, 10) : "—");
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const recHref = (section: string, id: string) => `/${section.replace(".", "/")}?r=${id}`;
const useT = () => { const { lang } = useApp(); return (x: T4, v?: any) => say(x, lang, v); };
const Err = ({ e }: { e: string }) => (e ? <div className="card" role="alert" data-err style={{ padding: 12, borderColor: "var(--bad, #c33)" }}><small className="neg">{e}</small></div> : null);
const Health = ({ h }: { h?: string }) => { const T = useT(); const x = HEALTH[h || "Healthy"] || HEALTH.Healthy; return <span className={`chip ${x.cls}`} data-health={h}>{T(x.t)}</span>; };

export default function Commercial() {
  const T = useT(); const { me } = useApp();
  const q = typeof window !== "undefined" ? new URLSearchParams(location.search) : null;
  const [tab, setTab] = useState<Tab>(((q?.get("tab") as Tab) || "dashboard"));
  const [opp, setOpp] = useState<string | null>(q?.get("opp") || null);
  const [rel, setRel] = useState<string | null>(q?.get("rel") || null);
  const [caps, setCaps] = useState<Record<string, boolean>>({});
  const [cat, setCat] = useState<any>(null);
  useEffect(() => { crm.caps().then((c) => setCaps(c || {})).catch(() => {}); crm.catalogs().then(setCat).catch(() => {}); }, []);
  const go = (t: Tab) => { setTab(t); try { history.replaceState(null, "", `/crm?tab=${t}`); } catch {} };
  const lead = MANAGERS.includes(me.role) || me.role === "owner";
  const tabs: [Tab, string, T4][] = [
    ["dashboard", "grid", L("Dashboard", "Обзор", "Огляд", "لوحة")], ["pipeline", "funnel", L("Pipeline", "Воронка", "Воронка", "المسار")],
    ["forecast", "trend", L("Forecast", "Прогноз", "Прогноз", "التوقع")], ["organizations", "building", L("Organizations", "Организации", "Організації", "الجهات")],
    ["contacts", "contact", L("Contacts", "Контакты", "Контакти", "جهات الاتصال")], ["leads", "target", L("Leads", "Лиды", "Ліди", "العملاء المحتملون")],
    ["event", "flag", L("Event mode", "Режим выставки", "Режим виставки", "وضع المعرض")], ["review", "clipboard", L("Commercial review", "Коммерческий обзор", "Комерційний огляд", "المراجعة التجارية")],
    ["io", "upload", L("Import / export", "Импорт / экспорт", "Імпорт / експорт", "استيراد / تصدير")],
    ...((caps.commercial_admin || caps.workflow_admin || lead) ? [["settings", "gear", L("Settings", "Настройки", "Налаштування", "الإعدادات")] as [Tab, string, T4]] : []),
  ];
  const openOpp = (id: string) => { setOpp(id); try { history.replaceState(null, "", `/crm?tab=${tab}&opp=${id}`); } catch {} };
  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }} className="crm">
      <nav className="dtabs" style={{ ["--dc" as any]: "#1D7AF2", overflowX: "auto" }} aria-label={T(L("Commercial", "Коммерция", "Комерція", "التجاري"))}>
        {tabs.map(([k, ic, l]) => <button key={k} className={tab === k ? "on" : ""} data-tab={k} onClick={() => go(k)}><Icon n={ic} />{T(l)}</button>)}
      </nav>
      {tab === "dashboard" && <Dash onOpen={openOpp} />}
      {tab === "pipeline" && <Pipeline cat={cat} onOpen={openOpp} />}
      {tab === "forecast" && <Forecast cat={cat} onOpen={openOpp} />}
      {tab === "organizations" && <Directory kind="organizations" onRel={setRel} />}
      {tab === "contacts" && <Directory kind="contacts" onRel={setRel} />}
      {tab === "leads" && <Leads cat={cat} onOpen={openOpp} />}
      {tab === "event" && <EventMode cat={cat} onOpen={openOpp} />}
      {tab === "review" && <Review onOpen={openOpp} />}
      {tab === "io" && <ImportExport caps={caps} />}
      {tab === "settings" && <Settings caps={caps} />}
      {opp && <OppView id={opp} cat={cat} onRel={setRel} onClose={() => { setOpp(null); try { history.replaceState(null, "", `/crm?tab=${tab}`); } catch {} }} />}
      {rel && <RelView id={rel} onOpen={(id) => { setRel(null); openOpp(id); }} onClose={() => setRel(null)} />}
    </div>
  );
}

/* ------------------------------------------------ rows ------------------------------------------------ */
function OppRow({ r, onOpen }: { r: any; onOpen: (id: string) => void }) {
  const T = useT();
  return <button className="row" data-opp={r.id} onClick={() => onOpen(r.id)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, textAlign: "start", width: "100%", padding: "8px 12px", borderBottom: "1px solid var(--line, #eee)" }}>
    <span style={{ minWidth: 0 }}><b style={{ overflowWrap: "anywhere" }}>{r.number ? <span className="mono faint">{r.number} · </span> : null}{r.title}</b><br />
      <small className="muted">{[r.party, r.stage, r.owner, r.product, r.geography].filter(Boolean).join(" · ")}</small>
      {r.next_action ? <><br /><small>{T(L("Next", "Далее", "Далі", "التالي"))}: {r.next_action} · {day(r.next_action_due)}</small></> : null}
      {(r.reasons || []).length ? <><br /><small className="faint" data-reasons>{(r.reasons || []).map((x: any) => x.text || x.code).join(" · ")}</small></> : null}</span>
    <span style={{ textAlign: "end" }}><Health h={r.health} /><br /><small className="mono">{amount(r.final ?? r.negotiated ?? r.quoted ?? r.value, r.currency)}</small>{r.probability != null ? <><br /><small className="faint" title={r.probability_source || ""}>{r.probability}%{r.probability_source === "manual" ? " ✎" : ""}</small></> : null}</span>
  </button>;
}

/* ------------------------------------------------ Dashboard (B27) ------------------------------------------------ */
const BLOCKS: [string, T4][] = [["needs_action", CRM_KIND.needs_action], ["active", CRM_KIND.active], ["proposals_waiting", CRM_KIND.proposals_waiting], ["responses", CRM_KIND.responses],
  ["upcoming_decisions", CRM_KIND.upcoming_decisions], ["stalled", CRM_KIND.stalled], ["risk", L("At risk", "Под риском", "Під ризиком", "معرضة للخطر")], ["no_next_action", L("No next action", "Без следующего шага", "Без наступного кроку", "بلا خطوة تالية")],
  ["overdue", L("Overdue follow-up", "Просрочен контакт", "Прострочений контакт", "متابعة متأخرة")], ["nda_unsigned", L("NDA not signed", "NDA не подписан", "NDA не підписано", "NDA غير موقعة")],
  ["hold_review", L("On hold — review due", "Пауза — пора пересмотреть", "Пауза — час переглянути", "معلّق — حان المراجعة")], ["wins", CRM_KIND.wins], ["losses", CRM_KIND.losses]];
function Dash({ onOpen }: { onOpen: (id: string) => void }) {
  const T = useT();
  const [ov, setOv] = useState<any>(null); const [err, setErr] = useState(""); const [drill, setDrill] = useState<[string, T4] | null>(null); const [rows, setRows] = useState<any[] | null>(null); const [q, setQ] = useState("");
  useEffect(() => { crm.overview().then(setOv).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (!drill) return; setRows(null); const t = setTimeout(() => crm.list(drill[0], q, 300).then(setRows).catch((e) => { setErr(e.message); setRows([]); }), q ? 250 : 0); return () => clearTimeout(t); }, [drill, q]);
  if (err && !ov) return <Err e={err} />;
  if (!ov) return <div className="card empty">…</div>;
  return <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
      {BLOCKS.map(([k, l]) => { const b = ov.blocks?.[k] || { count: 0, value: {} };
        return <button key={k} className="card stat" data-block={k} style={{ textAlign: "start", padding: 12 }} onClick={() => setDrill([k, l])}>
          <small>{T(l)}</small><div><b className={`mono ${["stalled", "risk", "overdue"].includes(k) && b.count ? "neg" : ""}`} style={{ fontSize: 22 }}>{b.count}</b></div>
          {Object.keys(b.value || {}).length ? <small className="faint mono" style={{ overflowWrap: "anywhere" }}>{amounts(b.value)}</small> : null}</button>; })}
    </div>
    {ov.leads_due != null && <small className="muted" data-leads-due>{T(L("Leads due for follow-up: {n}", "Лидов к контакту: {n}", "Лідів до контакту: {n}", "عملاء محتملون للمتابعة: {n}"), { n: typeof ov.leads_due === "object" ? ov.leads_due.count : ov.leads_due })}</small>}
    {drill && <section className="card" data-drill><div className="card-h" style={{ flexWrap: "wrap" }}><h2><Icon n="funnel" />{T(drill[1])}</h2>
      <input style={{ marginInlineStart: "auto", maxWidth: 220 }} data-drill-q placeholder={T(L("Find", "Найти", "Знайти", "بحث"))} value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn ghost sm" onClick={() => { setDrill(null); setQ(""); }}><Icon n="x" /></button></div>
      <div className="feed">{!rows ? <div className="empty">…</div> : rows.length ? rows.map((r) => <OppRow key={r.id} r={r} onOpen={onOpen} />) : <div className="empty" style={{ padding: 16 }}>—</div>}</div></section>}
    <small className="faint">{ov.note || T(L("Every number opens the opportunities behind it. Values are per currency and never added across currencies.", "Каждое число открывает возможности за ним. Суммы — по валютам, валюты не складываются.", "Кожне число відкриває можливості за ним. Суми — за валютами, валюти не додаються.", "كل رقم يفتح الفرص التي وراءه. القيم لكل عملة ولا تُجمع العملات."))}</small>
  </>;
}

/* ------------------------------------------------ Filters ------------------------------------------------ */
function Filters({ cat, f, setF }: { cat: any; f: Filter; setF: (f: Filter) => void }) {
  const T = useT(); const { people } = useApp() as any;
  const sel = (k: keyof Filter, list: string[], label: T4) => <label className="fld" style={{ minWidth: 130 }}><span>{T(label)}</span>
    <select data-filter={k} value={(f as any)[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">—</option>{list.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>;
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
    {sel("product", cat?.products || [], L("Product", "Продукт", "Продукт", "المنتج"))}
    {sel("geography", cat?.geographies || [], L("Geography", "География", "Географія", "المنطقة"))}
    {sel("source", cat?.lead_sources || [], L("Source", "Источник", "Джерело", "المصدر"))}
    {sel("currency", ["USD", "AED", "EUR"], L("Currency", "Валюта", "Валюта", "العملة"))}
    <label className="fld" style={{ minWidth: 150 }}><span>{T(L("Owner", "Ответственный", "Відповідальний", "المسؤول"))}</span>
      <select data-filter="owner_id" value={f.owner_id || ""} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">—</option>{(people || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></label>
  </div>;
}

/* ------------------------------------------------ Pipeline + value (B11, B28) ------------------------------------------------ */
function Pipeline({ cat, onOpen }: { cat: any; onOpen: (id: string) => void }) {
  const T = useT(); const [f, setF] = useState<Filter>({}); const [rows, setRows] = useState<any[] | null>(null); const [val, setVal] = useState<any>(null); const [err, setErr] = useState(""); const [q, setQ] = useState("");
  useEffect(() => { setRows(null); const t = setTimeout(() => { crm.list("active", q, 1000, f).then(setRows).catch((e) => setErr(e.message)); crm.value(f).then(setVal).catch((e) => setErr(e.message)); }, q ? 250 : 0); return () => clearTimeout(t); }, [f, q]);
  const stages = (cat?.pipeline || []).filter((s: any) => s.kind === "open");
  const by = useMemo(() => { const m: Record<string, any[]> = {}; (rows || []).forEach((r) => (m[r.stage] ||= []).push(r)); return m; }, [rows]);
  return <>
    <Err e={err} />
    <div className="card" style={{ padding: 12 }}><Filters cat={cat} f={f} setF={setF} />
      <input style={{ marginTop: 8, maxWidth: 320 }} data-pipe-q placeholder={T(L("Find by title, number, organization or owner", "Найти по названию, номеру, организации или ответственному", "Знайти за назвою, номером, організацією чи відповідальним", "ابحث"))} value={q} onChange={(e) => setQ(e.target.value)} /></div>
    {val && <section className="card" data-pipeline-value><div className="card-h"><h2><Icon n="coins" />{T(L("Pipeline value", "Стоимость воронки", "Вартість воронки", "قيمة المسار"))}</h2></div>
      <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>{T(L("Currency", "Валюта", "Валюта", "العملة"))}</th><th>{T(L("Open", "Открыто", "Відкрито", "مفتوحة"))}</th><th>{T(L("Estimated", "Оценка", "Оцінка", "تقديري"))}</th><th>{T(L("Quoted", "В КП", "У КП", "معروض"))}</th><th>{T(L("Negotiated", "Согласовано", "Погоджено", "متفاوض"))}</th><th>{T(L("Weighted (estimate)", "Взвешенная (оценка)", "Зважена (оцінка)", "مرجّح (تقدير)"))}</th><th>{T(L("Won (final)", "Выиграно (итог)", "Виграно (підсумок)", "مكسوب (نهائي)"))}</th></tr></thead>
        <tbody>{(val.currencies || []).map((c: any) => <tr key={c.currency} data-cur={c.currency}><td className="mono">{c.currency}</td><td className="mono">{c.open_count}</td><td className="mono">{amount(c.estimated, null).replace(" (no currency)", "")}</td><td className="mono">{amount(c.quoted, null).replace(" (no currency)", "")}</td><td className="mono">{amount(c.negotiated, null).replace(" (no currency)", "")}</td>
          <td className="mono">{amount((c.negotiated_weighted ?? 0) + (c.quoted_weighted ?? 0) + (c.estimated_weighted ?? 0) || null, null).replace(" (no currency)", "")}</td><td className="mono">{amount(c.won_final, null).replace(" (no currency)", "")}{c.won_without_final ? <small className="faint"> +{c.won_without_final}?</small> : null}</td></tr>)}</tbody></table></div>
      <ul className="faint" style={{ margin: "4px 16px 12px", fontSize: 12 }}>{Object.values(val.labels || {}).map((x: any, i) => <li key={i}>{x}</li>)}</ul></section>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }} data-board>
      {stages.map((s: any) => <section key={s.stage} className="card" data-stage={s.stage}><div className="card-h"><h2 style={{ fontSize: 14 }}>{s.stage} <span className="chip mono">{(by[s.stage] || []).length}</span> <small className="faint">{s.probability}%</small></h2></div>
        <div className="feed" style={{ maxHeight: 420, overflowY: "auto" }}>{!rows ? <div className="empty">…</div> : (by[s.stage] || []).map((r) => <OppRow key={r.id} r={r} onOpen={onOpen} />)}</div></section>)}
    </div>
    <Link className="btn" href="/sales/pipeline?new=1"><Icon n="plus" />{T(L("New opportunity", "Новая возможность", "Нова можливість", "فرصة جديدة"))}</Link>
  </>;
}

/* ------------------------------------------------ Forecast (B29) ------------------------------------------------ */
function Forecast({ cat, onOpen }: { cat: any; onOpen: (id: string) => void }) {
  const T = useT(); const [f, setF] = useState<Filter>({}); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [bucket, setBucket] = useState("month"); const [fc, setFc] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => { crm.forecast(from || null, to || null, bucket, f).then(setFc).catch((e) => setErr(e.message)); }, [from, to, bucket, f]);
  const groups = useMemo(() => { const m: Record<string, any[]> = {}; (fc?.rows || []).forEach((r: any) => (m[r.bucket] ||= []).push(r)); return m; }, [fc]);
  const sum = (rs: any[], k: string) => { const m: Record<string, number> = {}; rs.forEach((r) => { if (r[k] != null) m[r.currency || "(no currency)"] = (m[r.currency || "(no currency)"] || 0) + Number(r[k]); }); return m; };
  return <>
    <Err e={err} />
    <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}><Filters cat={cat} f={f} setF={setF} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <label className="fld"><span>{T(L("From", "С", "З", "من"))}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="fld"><span>{T(L("To", "По", "По", "إلى"))}</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="fld"><span>{T(L("Group by", "Группировать", "Групувати", "التجميع"))}</span><select data-bucket value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="month">{T(L("Month", "Месяц", "Місяць", "شهر"))}</option><option value="quarter">{T(L("Quarter", "Квартал", "Квартал", "ربع"))}</option></select></label></div></div>
    {fc && <div className="card" style={{ padding: 12 }}><small className="muted" data-forecast-note>{fc.note}</small></div>}
    {Object.entries(groups).map(([b, rs]) => <section key={b} className="card" data-forecast-bucket={b}><div className="card-h" style={{ flexWrap: "wrap" }}><h2>{b} <span className="chip mono">{rs.length}</span></h2>
      <small className="mono" style={{ marginInlineStart: "auto" }}>{T(L("Value", "Сумма", "Сума", "القيمة"))}: {amounts(sum(rs, "value"))} · {T(L("weighted", "взвеш.", "зваж.", "مرجّح"))}: {amounts(sum(rs, "weighted"))}</small></div>
      <div className="feed">{rs.map((r: any) => <OppRow key={r.id} r={{ ...r, health: undefined }} onOpen={onOpen} />)}</div></section>)}
    {fc && !fc.rows?.length && <div className="card empty">{T(L("No open opportunity expects a decision in this period.", "Нет открытых возможностей с решением в этот период.", "Немає відкритих можливостей із рішенням у цей період.", "لا فرص مفتوحة بقرار في هذه الفترة."))}</div>}
  </>;
}

/* ------------------------------------------------ Organizations / contacts (B4, B5) ------------------------------------------------ */
function Directory({ kind, onRel }: { kind: "organizations" | "contacts"; onRel: (id: string) => void }) {
  const T = useT(); const sec = kind === "organizations" ? "company.parties" : "company.contacts";
  const [q, setQ] = useState(""); const [rows, setRows] = useState<any[] | null>(null); const [rt, setRt] = useState("");
  useEffect(() => { if (DEMO) { setRows([]); return; } let off = false; const t = setTimeout(async () => {
    let r = sb().from("records").select("id,title,status,data,updated_at").eq("section", sec).order("title").limit(200);
    const s = q.trim().replace(/[%,()]/g, " ");
    if (s) r = r.or(`title.ilike.%${s}%,data->>email.ilike.%${s}%,data->>phone.ilike.%${s}%,data->>country.ilike.%${s}%`);
    if (rt && kind === "organizations") r = r.contains("data", { relationship_types: [rt] });
    const { data } = await r; if (!off) setRows((data || []).filter((x: any) => !x.data?.merged_into)); }, q ? 250 : 0); return () => { off = true; clearTimeout(t); }; }, [q, rt, sec, kind]);
  const RT = ["Prospect", "Customer", "Partner", "Agent", "Distributor", "Integrator", "Vendor", "Investor", "Advisor", "Government", "Other"];
  return <section className="card"><div className="card-h" style={{ flexWrap: "wrap", gap: 8 }}><h2><Icon n={kind === "organizations" ? "building" : "contact"} />{kind === "organizations" ? T(L("Organizations", "Организации", "Організації", "الجهات")) : T(L("Contacts", "Контакты", "Контакти", "جهات الاتصال"))}</h2>
    <input data-dir-q style={{ marginInlineStart: "auto", maxWidth: 260 }} placeholder={T(L("Name, e-mail, phone, country", "Имя, e-mail, телефон, страна", "Ім'я, e-mail, телефон, країна", "الاسم أو البريد أو الهاتف"))} value={q} onChange={(e) => setQ(e.target.value)} />
    {kind === "organizations" && <select data-rt value={rt} onChange={(e) => setRt(e.target.value)}><option value="">{T(L("All relationships", "Все типы отношений", "Усі типи стосунків", "كل العلاقات"))}</option>{RT.map((x) => <option key={x}>{x}</option>)}</select>}
    <Link className="btn sm" href={`/${sec.replace(".", "/")}?new=1`} data-new={kind}><Icon n="plus" />{T(L("Add", "Добавить", "Додати", "إضافة"))}</Link></div>
    <div className="feed">{!rows ? <div className="empty">…</div> : rows.length ? rows.map((r) => <button key={r.id} className="row" data-dir-row={r.id} onClick={() => onRel(r.id)} style={{ display: "block", width: "100%", textAlign: "start", padding: "8px 12px", borderBottom: "1px solid var(--line, #eee)" }}>
      <b style={{ overflowWrap: "anywhere" }}>{r.title}</b> <small className="chip">{r.status}</small><br />
      <small className="muted">{kind === "organizations" ? [(r.data?.relationship_types || []).join(", "), r.data?.country, r.data?.domain || r.data?.website].filter(Boolean).join(" · ") : [r.data?.title, r.data?.party_ref_title || r.data?.organization, r.data?.email, r.data?.phone].filter(Boolean).join(" · ")}</small></button>)
      : <div className="empty" style={{ padding: 16 }}>—</div>}</div>
    {kind === "organizations" && <small className="faint" style={{ display: "block", padding: "0 12px 12px" }}>{T(L("One organisation is one record; customer, partner, agent and vendor are relationship types on it. A relationship type says nothing about legal or regulatory status.", "Одна организация — одна запись; клиент, партнёр, агент и поставщик — типы отношений в ней. Тип отношений ничего не говорит о правовом или регуляторном статусе.", "Одна організація — один запис; клієнт, партнер, агент і постачальник — типи стосунків у ньому. Тип стосунків нічого не каже про правовий чи регуляторний статус.", "الجهة سجل واحد؛ العميل والشريك والوكيل والمورد أنواع علاقة عليه. نوع العلاقة لا يعني وضعًا قانونيًا."))}</small>}
  </section>;
}

/* ------------------------------------------------ Relationship view (B6, B7, B13) ------------------------------------------------ */
function RelView({ id, onOpen, onClose }: { id: string; onOpen: (id: string) => void; onClose: () => void }) {
  const T = useT(); const [r, setR] = useState<any>(null); const [tl, setTl] = useState<any[] | null>(null); const [err, setErr] = useState("");
  useEffect(() => { crm.relations(id).then(setR).catch((e) => setErr(e.message)); crm.timeline(id, 200).then(setTl).catch(() => setTl([])); }, [id]);
  const o = r?.organization || r?.contact;
  return <><div className="scrim" onClick={onClose} /><aside className="drawer" role="dialog" aria-modal="true" data-rel={id} style={{ maxWidth: 720, width: "100%" }}>
    <div className="card-h"><h2 style={{ overflowWrap: "anywhere" }}><Icon n="building" />{o?.title || "…"}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={onClose} aria-label="close"><Icon n="x" /></button></div>
    <Err e={err} />
    {r && <div style={{ display: "grid", gap: 12, padding: 12 }}>
      {o && <div><small className="muted">{[(o.data?.relationship_types || []).join(", "), o.data?.country, o.data?.email, o.data?.phone, o.data?.owner].filter(Boolean).join(" · ")}</small><br />
        <Link className="btn ghost sm" href={recHref(r.organization ? "company.parties" : "company.contacts", o.id)}><Icon n="edit" />{T(L("Open record", "Открыть запись", "Відкрити запис", "فتح السجل"))}</Link></div>}
      {r.note && <small className="faint">{r.note}</small>}
      {[["opportunities", L("Opportunities", "Возможности", "Можливості", "الفرص")], ["contacts", L("Contacts", "Контакты", "Контакти", "جهات الاتصال")], ["introduced_to_us_by", L("Introduced to us by", "Нас представил", "Нас представив", "عرّفنا بهم")],
        ["introduced_by_them", L("Introduced by them", "Представили они", "Представили вони", "عرّفوا")], ["contracts", L("Contracts", "Договоры", "Договори", "العقود")], ["projects", L("Projects", "Проекты", "Проєкти", "المشاريع")], ["supports", L("Support", "Поддержка", "Підтримка", "الدعم")]]
        .map(([k, l]: any) => (r[k] || []).length ? <div key={k} data-rel-block={k}><b>{T(l)}</b><ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{(r[k] || []).map((x: any) => <li key={x.id}>
          {k === "opportunities" ? <button className="link" data-rel-opp={x.id} onClick={() => onOpen(x.id)}>{x.number ? `${x.number} · ` : ""}{x.title}</button> : <span>{x.title}</span>}
          <small className="faint"> {[x.stage || x.status, x.job, x.email, x.introducer || x.context, x.value != null ? amount(x.value, x.currency) : null].filter(Boolean).join(" · ")}</small></li>)}</ul></div> : null)}
      <div data-timeline><b>{T(L("History", "История", "Історія", "السجل"))}</b>
        {!tl ? <div className="empty">…</div> : tl.length ? <ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{tl.map((x: any, i: number) => <li key={i}><small className="mono faint">{day(x.at)}</small> <a href={x.link}>{x.title}</a> <small className="faint">{x.excerpt}</small></li>)}</ul> : <div className="faint">—</div>}</div>
    </div>}
  </aside></>;
}

/* ------------------------------------------------ Opportunity (B10, B12–B21, B30) ------------------------------------------------ */
function OppView({ id, cat, onClose, onRel }: { id: string; cat: any; onClose: () => void; onRel: (id: string) => void }) {
  const T = useT(); const { toast, lang } = useApp();
  const [o, setO] = useState<any>(null); const [tl, setTl] = useState<any[] | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [tick, setTick] = useState(0);
  const [stage, setStage] = useState(""); const [extra, setExtra] = useState<Record<string, string>>({}); const [draft, setDraft] = useState(""); const [hand, setHand] = useState<any>(null);
  const [fu, setFu] = useState({ kind: "task", title: "", date: D(3) });
  useEffect(() => { setErr(""); crm.opp(id).then((x) => { setO(x); setStage(x?.row?.stage || ""); }).catch((e) => setErr(e.message)); crm.timeline(id, 100).then(setTl).catch(() => setTl([])); }, [id, tick]);
  const run = async (fn: () => Promise<any>, ok?: T4) => { setBusy(true); setErr(""); try { const r = await fn(); if (r && r.ok === false) throw new Error(r.error || "Refused"); if (ok) toast(T(ok)); setTick((t) => t + 1); return r; } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const save = (patch: Record<string, any>, status?: string) => run(async () => {
    const { data: cur, error } = await sb().from("records").select("*").eq("id", id).single(); if (error) throw error;
    return store.save({ ...cur, status: status ?? cur.status, data: { ...(cur.data || {}), ...patch } });
  }, L("Saved", "Сохранено", "Збережено", "حُفظ"));
  if (!o) return <><div className="scrim" onClick={onClose} /><aside className="drawer" role="dialog" aria-modal="true">{err ? <Err e={err} /> : <div className="empty">…</div>}</aside></>;
  const r = o.row || {}; const d = o.record?.data || {};
  const st = (o.stages || cat?.pipeline || []).find((s: any) => s.stage === stage);
  const need: string[] = (st?.required || []).filter((k: string) => d[k] == null || d[k] === "");
  const Q: [string, T4][] = [["q_requirement", L("Requirement", "Потребность", "Потреба", "المتطلب")], ["q_fit", L("Product fit", "Соответствие продукта", "Відповідність продукту", "ملاءمة المنتج")], ["q_budget", L("Budget", "Бюджет", "Бюджет", "الميزانية")],
    ["q_decision_maker", L("Decision maker", "ЛПР", "ОПР", "صاحب القرار")], ["q_timeline", L("Timeline", "Сроки", "Терміни", "الجدول")], ["q_procurement", L("Procurement path", "Порядок закупки", "Порядок закупівлі", "مسار الشراء")],
    ["q_technical", L("Technical feasibility", "Техническая реализуемость", "Технічна здійсненність", "الجدوى الفنية")], ["q_nda", L("NDA", "NDA", "NDA", "NDA")], ["q_next_step", L("Next step agreed", "Следующий шаг согласован", "Наступний крок погоджено", "الخطوة التالية")]];
  return <><div className="scrim" onClick={onClose} /><aside className="drawer" role="dialog" aria-modal="true" data-opp-view={id} style={{ maxWidth: 820, width: "100%" }}>
    <div className="card-h" style={{ flexWrap: "wrap" }}><h2 style={{ overflowWrap: "anywhere", minWidth: 0 }}><Icon n="target" /><span className="mono faint">{r.number} </span>{r.title}</h2>
      <Health h={r.health} /><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={onClose} aria-label="close"><Icon n="x" /></button></div>
    <Err e={err} />
    <div style={{ display: "grid", gap: 14, padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }} data-opp-facts>
        {[[L("Organization", "Организация", "Організація", "الجهة"), r.party_id ? <button className="link" data-open-party onClick={() => onRel(r.party_id)}>{r.party}</button> : "—"], [L("Stage", "Этап", "Етап", "المرحلة"), r.stage], [L("Owner", "Ответственный", "Відповідальний", "المسؤول"), r.owner || "—"],
          [L("Value", "Сумма", "Сума", "القيمة"), amount(r.value, r.currency)], [L("Quoted", "В КП", "У КП", "معروض"), amount(r.quoted, r.currency)], [L("Negotiated", "Согласовано", "Погоджено", "متفاوض"), amount(r.negotiated, r.currency)],
          [L("Final", "Итог", "Підсумок", "نهائي"), amount(r.final, r.currency)], [L("Probability", "Вероятность", "Ймовірність", "الاحتمال"), r.probability != null ? `${r.probability}% (${r.probability_source})` : "—"],
          [L("Expected decision", "Ожидаемое решение", "Очікуване рішення", "القرار المتوقع"), day(r.expected_decision)], [L("Product", "Продукт", "Продукт", "المنتج"), r.product || "—"], [L("Geography", "География", "Географія", "المنطقة"), r.geography || "—"], [L("Source", "Источник", "Джерело", "المصدر"), r.source || "—"]]
          .map(([l, v]: any, i) => <div key={i}><small className="faint">{T(l)}</small><div style={{ overflowWrap: "anywhere" }}>{v}</div></div>)}
      </div>
      {(r.reasons || []).length > 0 && <div className="card" style={{ padding: 10 }} data-opp-reasons><b>{T(L("Why it needs attention", "Почему требует внимания", "Чому потребує уваги", "لماذا يحتاج انتباهًا"))}</b><ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{r.reasons.map((x: any, i: number) => <li key={i}><small>{x.text || x.code}</small></li>)}</ul>
        <small className="faint">{T(L("Health shows what needs action; it is not the probability of winning.", "Состояние показывает, что требует действий; это не вероятность выигрыша.", "Стан показує, що потребує дій; це не ймовірність виграшу.", "الحالة تُظهر ما يحتاج إجراء؛ ليست احتمال الفوز."))}</small></div>}
      <Link className="btn ghost sm" href={recHref("sales.pipeline", id)} data-edit-opp><Icon n="edit" />{T(L("Edit all fields", "Изменить все поля", "Змінити всі поля", "تحرير كل الحقول"))}</Link>

      {o.can_edit && <section data-next-action><b>{T(L("Next action", "Следующий шаг", "Наступний крок", "الخطوة التالية"))}</b>
        <NextAction d={d} busy={busy} onSave={(p) => save(p)} /></section>}

      {o.can_edit && <section data-stage-change><b>{T(L("Move to stage", "Перевести на этап", "Перевести на етап", "النقل إلى مرحلة"))}</b>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
          <select data-stage-select value={stage} onChange={(e) => { setStage(e.target.value); setExtra({}); }}>{(o.stages || []).map((s: any) => <option key={s.stage} value={s.stage}>{s.stage}{s.probability != null ? ` (${s.probability}%)` : ""}</option>)}</select>
          {need.map((k) => <label key={k} className="fld"><span>{k}</span>{k === "lost_reason" ? <select data-need={k} value={extra[k] || ""} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })}><option value="">—</option>{(cat?.lost_reasons || []).map((x: string) => <option key={x}>{x}</option>)}</select>
            : <input data-need={k} value={extra[k] || ""} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} />}</label>)}
          <label className="fld"><span>{T(L("Exception reason (only if a rule is not met)", "Причина исключения (если правило не выполнено)", "Причина винятку (якщо правило не виконано)", "سبب الاستثناء"))}</span><input data-stage-exception value={extra.stage_exception || ""} onChange={(e) => setExtra({ ...extra, stage_exception: e.target.value })} /></label>
          <button className="btn sm" data-stage-save disabled={busy || stage === r.stage} onClick={() => save(Object.fromEntries(Object.entries(extra).filter(([, v]) => v)), stage)}>{T(L("Move", "Перевести", "Перевести", "نقل"))}</button></div>
        <small className="faint">{T(L("Required information is never invented to move a stage; an authorised exception needs a reason and is recorded.", "Обязательная информация не придумывается ради этапа; разрешённое исключение требует причины и записывается.", "Обов'язкова інформація не вигадується заради етапу; дозволений виняток потребує причини й записується.", "لا تُختلق المعلومات المطلوبة؛ الاستثناء المصرح يحتاج سببًا ويُسجّل."))}</small></section>}

      <section data-qualification><b>{T(L("Qualification", "Квалификация", "Кваліфікація", "التأهيل"))}</b>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6 }}>{Q.map(([k, l]) => <label key={k} className="fld"><span>{T(l)}</span>
          <select data-q={k} disabled={!o.can_edit || busy} value={o.qualification?.[k] || "Unknown"} onChange={(e) => save({ [k]: e.target.value })}>{["Unknown", "Yes", "Partly", "No"].map((x) => <option key={x}>{x}</option>)}</select></label>)}</div>
        <small className="faint">{T(L("Unknown is a valid answer — nothing is filled in for you.", "«Неизвестно» — допустимый ответ; ничего не заполняется за вас.", "«Невідомо» — допустима відповідь; нічого не заповнюється за вас.", "«غير معروف» إجابة صالحة؛ لا يُملأ شيء عنك."))}</small></section>

      <section data-nda><b>NDA</b> <span className="chip">{o.nda?.status || "—"}</span>{o.nda?.contract ? <> · <a href={recHref("legal.contracts", o.nda.contract.id)}>{o.nda.contract.title}</a></> : null}<br /><small className="faint">{o.nda?.note}</small></section>

      <section data-proposals><b>{T(L("Proposals", "Коммерческие предложения", "Комерційні пропозиції", "العروض"))}</b>
        {(o.proposals || []).length ? <ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{o.proposals.map((p: any) => <li key={p.id} data-proposal={p.id}>
          <a href={recHref("sales.proposals", p.id)}>{p.number ? `${p.number} ` : ""}v{p.version || 1} · {p.title}</a> <span className="chip">{p.status}</span> <small className="mono">{amount(p.amount ?? p.value, p.currency)}</small>
          {p.status === "Draft" && <button className="btn ghost sm" data-proposal-submit={p.id} disabled={busy} onClick={() => run(() => crm.submitProposal(p.id), L("Sent for approval", "Отправлено на согласование", "Надіслано на погодження", "أُرسل للموافقة"))}>{T(L("Submit for approval", "На согласование", "На погодження", "إرسال للموافقة"))}</button>}
          {["Sent", "Approved", "Rejected", "Under review", "Negotiation"].includes(p.status) && <button className="btn ghost sm" data-proposal-version={p.id} disabled={busy} onClick={() => { const why = prompt(T(L("Why a new version?", "Почему новая версия?", "Чому нова версія?", "لماذا نسخة جديدة؟"))) || ""; if (why) run(() => crm.newVersion(p.id, why), L("New version created", "Создана новая версия", "Створено нову версію", "أُنشئت نسخة جديدة")); }}>{T(L("New version", "Новая версия", "Нова версія", "نسخة جديدة"))}</button>}
        </li>)}</ul> : <div className="faint">—</div>}
        <Link className="btn ghost sm" href={`/sales/proposals?new=1&deal_ref=${id}&deal_ref_title=${encodeURIComponent(r.title || "")}`}><Icon n="plus" />{T(L("New proposal", "Новое КП", "Нова КП", "عرض جديد"))}</Link>
        <small className="faint" style={{ display: "block" }}>{T(L("A proposal becomes Approved only through its approval process — never because its author created it. A sent proposal is never replaced: a change is a new version.", "КП становится «Утверждено» только через согласование, а не потому что его создал автор. Отправленное КП не заменяется: изменение — это новая версия.", "КП стає «Затверджено» лише через погодження, а не тому що його створив автор. Надіслана КП не замінюється: зміна — це нова версія.", "يصبح العرض معتمدًا فقط عبر الموافقة. العرض المرسل لا يُستبدل: التغيير نسخة جديدة."))}</small></section>

      <section data-followup><b>{T(L("Follow-up help", "Помощь с контактом", "Допомога з контактом", "مساعدة المتابعة"))}</b>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
          <select data-fu-kind value={fu.kind} onChange={(e) => setFu({ ...fu, kind: e.target.value })}>{[["task", L("Task", "Задача", "Завдання", "مهمة")], ["reminder", L("Reminder", "Напоминание", "Нагадування", "تذكير")], ["followup", L("Follow-up", "Контроль", "Контроль", "متابعة")], ["note", L("Note", "Заметка", "Нотатка", "ملاحظة")], ["draft", L("Draft message (not sent)", "Черновик письма (не отправляется)", "Чернетка листа (не надсилається)", "مسودة رسالة (لا تُرسل)")]].map(([k, l]: any) => <option key={k} value={k}>{T(l)}</option>)}</select>
          <input data-fu-title style={{ minWidth: 200, flex: 1 }} placeholder={T(L("What", "Что", "Що", "ماذا"))} value={fu.title} onChange={(e) => setFu({ ...fu, title: e.target.value })} />
          {fu.kind !== "draft" && fu.kind !== "note" && <input type="date" data-fu-date value={fu.date} onChange={(e) => setFu({ ...fu, date: e.target.value })} />}
          <button className="btn sm" data-fu-go disabled={busy || (fu.kind !== "draft" && !fu.title.trim())} onClick={async () => {
            const res = await run(() => crm.propose({ kind: fu.kind as any, opp: id, title: fu.title, date: fu.date, confirm: fu.kind !== "draft", lang }), fu.kind === "draft" ? undefined : L("Done — linked to this opportunity", "Готово — связано с этой возможностью", "Готово — пов'язано з цією можливістю", "تم — مرتبط بهذه الفرصة"));
            if (res?.draft) setDraft(res.draft);
            if (res?.ops?.length) { for (const op of res.ops) if (op.op === "create") await store.save({ section: op.section, title: op.title, status: op.status, data: op.data }).catch((e: any) => setErr(e.message)); setTick((t) => t + 1); }
          }}>{fu.kind === "draft" ? T(L("Write draft", "Написать черновик", "Написати чернетку", "اكتب مسودة")) : T(L("Create", "Создать", "Створити", "إنشاء"))}</button></div>
        {draft && <div data-draft><textarea rows={7} style={{ width: "100%" }} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <small className="faint">{T(L("Nothing is sent from here. Copy the text into your own e-mail after checking it.", "Отсюда ничего не отправляется. Скопируйте текст в свою почту после проверки.", "Звідси нічого не надсилається. Скопіюйте текст у свою пошту після перевірки.", "لا يُرسل شيء من هنا. انسخ النص إلى بريدك بعد مراجعته."))}</small>
          <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(draft).then(() => toast(T(L("Copied", "Скопировано", "Скопійовано", "نُسخ"))))}><Icon n="copy" />{T(L("Copy", "Копировать", "Копіювати", "نسخ"))}</button></div>}</section>

      {o.can_handoff && <section data-handoff><b>{T(L("Handoff to delivery", "Передача в исполнение", "Передача у виконання", "التسليم للتنفيذ"))}</b>
        {!hand ? <div><button className="btn ghost sm" data-handoff-open onClick={() => run(async () => { setHand(await crm.handoff(id)); })}>{T(L("Prepare handoff package", "Подготовить пакет передачи", "Підготувати пакет передачі", "إعداد حزمة التسليم"))}</button></div>
          : <div className="card" style={{ padding: 10 }} data-handoff-package><pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 220, overflow: "auto" }}>{JSON.stringify(hand.package || hand, null, 1).slice(0, 4000)}</pre>
            {!d.project_ref ? <button className="btn sm" data-handoff-create disabled={busy} onClick={() => { if (confirm(T(L("Create the delivery project from this won opportunity?", "Создать проект исполнения по этой выигранной возможности?", "Створити проєкт виконання з цієї виграної можливості?", "إنشاء مشروع التنفيذ من هذه الفرصة المكسوبة؟")))) run(() => crm.handoffProject(id, "create", null, { title: r.title }), L("Project created", "Проект создан", "Проєкт створено", "أُنشئ المشروع")); }}>{T(L("Create project", "Создать проект", "Створити проєкт", "إنشاء مشروع"))}</button>
              : <a href={recHref("company.projects", d.project_ref)}>{d.project_ref_title || T(L("Linked project", "Связанный проект", "Пов'язаний проєкт", "المشروع المرتبط"))}</a>}
            <small className="faint" style={{ display: "block" }}>{T(L("A project is created only by this explicit step.", "Проект создаётся только этим явным шагом.", "Проєкт створюється лише цим явним кроком.", "يُنشأ المشروع بهذه الخطوة الصريحة فقط."))}</small></div>}</section>}

      <section data-values><b>{T(L("Value history", "История сумм", "Історія сум", "سجل القيم"))}</b>
        {(o.values || []).length ? <ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{o.values.map((v: any, i: number) => <li key={i}><small><span className="mono faint">{day(v.at)}</span> {v.kind}: <b className="mono">{amount(v.amount, v.currency)}</b> <span className="faint">({T(L("was", "было", "було", "كان"))} {amount(v.prev_amount, v.prev_currency)}) · {v.by}{v.reason ? ` · ${v.reason}` : ""}</span></small></li>)}</ul> : <div className="faint">—</div>}</section>
      <section data-stage-history><b>{T(L("Stage history", "История этапов", "Історія етапів", "سجل المراحل"))}</b>
        {(o.stage_history || []).length ? <ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{o.stage_history.map((v: any, i: number) => <li key={i}><small><span className="mono faint">{day(v.at)}</span> {v.from || "—"} → <b>{v.to}</b> · {v.by}{v.exception ? ` · ${T(L("exception", "исключение", "виняток", "استثناء"))}: ${v.reason}` : ""}</small></li>)}</ul> : <div className="faint">—</div>}</section>
      <section data-timeline><b>{T(L("Timeline", "Хронология", "Хронологія", "الخط الزمني"))}</b>
        {!tl ? <div className="empty">…</div> : tl.length ? <ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{tl.map((x: any, i: number) => <li key={i}><small className="mono faint">{day(x.at)}</small> <a href={x.link}>{x.title}</a> <small className="faint">{x.excerpt}</small></li>)}</ul> : <div className="faint">—</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <Link className="btn ghost sm" href={`/sales/activities?new=1&deal_ref=${id}&deal_ref_title=${encodeURIComponent(r.title || "")}`}><Icon n="plus" />{T(L("Record activity", "Записать активность", "Записати активність", "تسجيل نشاط"))}</Link>
          <Link className="btn ghost sm" href={`/company/meetings?new=1&deal_ref=${id}&deal_ref_title=${encodeURIComponent(r.title || "")}`}><Icon n="calendar" />{T(L("Record meeting", "Записать встречу", "Записати зустріч", "تسجيل اجتماع"))}</Link></div></section>
    </div>
  </aside></>;
}

function NextAction({ d, busy, onSave }: { d: any; busy: boolean; onSave: (p: Record<string, any>) => void }) {
  const T = useT(); const { people } = useApp() as any;
  const [a, setA] = useState(d.next_action || ""); const [due, setDue] = useState(d.next_action_due || ""); const [who, setWho] = useState(d.next_action_owner_id || d.owner_id || "");
  const [wf, setWf] = useState(d.waiting_for || "");
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
    <input data-na-text style={{ flex: 1, minWidth: 180 }} placeholder={T(L("What happens next", "Что дальше", "Що далі", "ماذا بعد"))} value={a} onChange={(e) => setA(e.target.value)} />
    <input type="date" data-na-due value={due} onChange={(e) => setDue(e.target.value)} />
    <select data-na-owner value={who} onChange={(e) => setWho(e.target.value)}><option value="">—</option>{(people || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
    <input data-na-waiting style={{ minWidth: 160 }} placeholder={T(L("Waiting for (optional)", "Ждём (необязательно)", "Чекаємо (необов'язково)", "بانتظار (اختياري)"))} value={wf} onChange={(e) => setWf(e.target.value)} />
    <button className="btn sm" data-na-save disabled={busy} onClick={() => { const p = (people || []).find((x: any) => x.id === who); onSave({ next_action: a || null, next_action_due: due || null, next_action_owner_id: who || null, next_action_owner: p ? p.full_name || p.email : null, waiting_for: wf || null }); }}>{T(L("Save", "Сохранить", "Зберегти", "حفظ"))}</button>
  </div>;
}

/* ------------------------------------------------ Leads, capture and conversion (B8, B9) ------------------------------------------------ */
function CaptureForm({ cat, event, compact, onDone }: { cat: any; event?: any; compact?: boolean; onDone: (r: any) => void }) {
  const T = useT(); const { me, people } = useApp() as any;
  const blank = { first_name: "", last_name: "", organization: "", title: "", email: "", phone: "", country: "", interest: "", importance: "Warm", follow_up: D(2), notes: "", owner_id: me.id, product: "", website: "" };
  const [f, setF] = useState<Record<string, string>>(blank); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [dup, setDup] = useState<any[]>([]); const [card, setCard] = useState(""); const [src, setSrc] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(async () => { const k = f.email || f.phone || f.organization ? true : false; if (!k) { setDup([]); return; }
    const a = f.email || f.phone ? await crm.dupes("contact", { email: f.email, phone: f.phone, first_name: f.first_name, last_name: f.last_name, name: [f.first_name, f.last_name].join(" ").trim() || undefined }).catch(() => []) : [];
    const b = f.organization ? await crm.dupes("organization", { name: f.organization, email: f.email, website: f.website }).catch(() => []) : [];
    setDup([...(a || []), ...(b || [])]); }, 400); return () => clearTimeout(t); }, [f.email, f.phone, f.organization, f.first_name, f.last_name, f.website]);
  const fill = (x: Record<string, string>, how: string) => { setF((o) => ({ ...o, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v)) })); setSrc(how); };
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const fld = (k: string, l: T4, type = "text", extra: any = {}) => <label className="fld"><span>{T(l)}</span><input data-cap={k} type={type} value={f[k] || ""} onChange={set(k)} {...extra} style={{ fontSize: compact ? 16 : undefined }} /></label>;
  return <div style={{ display: "grid", gap: 8 }} data-capture>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: 8 }}>
      {fld("first_name", L("First name", "Имя", "Ім'я", "الاسم"), "text", { autoComplete: "off" })}{fld("last_name", L("Last name", "Фамилия", "Прізвище", "اللقب"))}
      {fld("organization", L("Organization", "Организация", "Організація", "الجهة"))}{fld("phone", L("Phone", "Телефон", "Телефон", "الهاتف"), "tel", { inputMode: "tel" })}
      {fld("email", L("E-mail", "E-mail", "E-mail", "البريد"), "email", { inputMode: "email" })}
      <label className="fld"><span>{T(L("Interest", "Интерес", "Інтерес", "الاهتمام"))}</span><select data-cap="product" value={f.product} onChange={set("product")} style={{ fontSize: compact ? 16 : undefined }}><option value="">—</option>{(cat?.products || []).map((x: string) => <option key={x}>{x}</option>)}</select></label>
      <label className="fld"><span>{T(L("Importance", "Важность", "Важливість", "الأهمية"))}</span><select data-cap="importance" value={f.importance} onChange={set("importance")} style={{ fontSize: compact ? 16 : undefined }}>{["Hot", "Warm", "Cold"].map((x) => <option key={x}>{x}</option>)}</select></label>
      {fld("follow_up", L("Follow up on", "Связаться", "Зв'язатися", "المتابعة في"), "date")}
      {!compact && fld("title", L("Job title", "Должность", "Посада", "المسمى"))}{!compact && fld("country", L("Country", "Страна", "Країна", "البلد"))}
      <label className="fld"><span>{T(L("Owner", "Ответственный", "Відповідальний", "المسؤول"))}</span><select data-cap="owner_id" value={f.owner_id} onChange={set("owner_id")} style={{ fontSize: compact ? 16 : undefined }}>{(people || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></label>
    </div>
    <label className="fld"><span>{T(L("Notes", "Заметки", "Нотатки", "ملاحظات"))}</span><textarea data-cap="notes" rows={2} value={f.notes} onChange={set("notes")} style={{ fontSize: compact ? 16 : undefined }} /></label>
    <details data-card><summary>{T(L("From a business card or QR code", "С визитки или QR-кода", "З візитки або QR-коду", "من بطاقة عمل أو رمز QR"))}</summary>
      <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
        <textarea data-card-text rows={4} placeholder={T(L("Paste the card text or the QR content (vCard / MECARD)", "Вставьте текст визитки или содержимое QR (vCard / MECARD)", "Вставте текст візитки або вміст QR (vCard / MECARD)", "الصق نص البطاقة أو محتوى QR"))} value={card} onChange={(e) => setCard(e.target.value)} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost sm" data-card-read onClick={() => fill(/BEGIN:VCARD|^MECARD:/im.test(card) ? parseContactCode(card) : parseCardText(card), "text")}>{T(L("Propose fields", "Предложить поля", "Запропонувати поля", "اقترح الحقول"))}</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} data-card-photo onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setErr("");
            const b64 = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(file); });
            const r = await fetch("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "card", image: b64, type: file.type }) });
            if (!r.ok) { setErr(await r.text()); return; } const j = await r.json(); setCard(j.text || ""); fill(j.fields || {}, j.method); e.target.value = ""; }} />
          <button className="btn ghost sm" onClick={() => fileRef.current?.click()}><Icon n="image" />{T(L("Photo of the card", "Фото визитки", "Фото візитки", "صورة البطاقة"))}</button></div>
        {src && <small className="faint" data-card-note>{T(L("Proposed from the card — check every field. Nothing is saved until you press Save; missing fields stay empty.", "Предложено с визитки — проверьте каждое поле. Ничего не сохраняется до «Сохранить»; отсутствующие поля остаются пустыми.", "Запропоновано з візитки — перевірте кожне поле. Нічого не зберігається до «Зберегти»; відсутні поля лишаються порожніми.", "مقترح من البطاقة — راجع كل حقل. لا يُحفظ شيء قبل الحفظ."))}</small>}
      </div></details>
    {dup.length > 0 && <div className="card" style={{ padding: 8 }} data-dupes><b>{T(L("Possibly already in Workspace", "Возможно, уже есть в Workspace", "Можливо, вже є у Workspace", "قد يكون موجودًا بالفعل"))}</b>
      <ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{dup.slice(0, 6).map((x: any) => <li key={x.id} data-dupe={x.strength}><small><b>{x.title}</b> · {x.section === "company.parties" ? T(L("organization", "организация", "організація", "جهة")) : x.section === "company.contacts" ? T(L("contact", "контакт", "контакт", "جهة اتصال")) : x.section} · {(x.why || []).join(", ")} <span className={`chip ${x.strength === "strong" ? "c-warn" : ""}`}>{x.strength}</span></small></li>)}</ul>
      <small className="faint">{T(L("The lead is still saved; when it is converted you choose the existing record or confirm a new one.", "Лид всё равно сохраняется; при конвертации вы выберете существующую запись или подтвердите новую.", "Лід усе одно зберігається; під час конвертації ви оберете наявний запис або підтвердите новий.", "يُحفظ العميل المحتمل؛ عند التحويل تختار السجل الموجود أو تؤكد جديدًا."))}</small></div>}
    <Err e={err} />
    <button className="btn" data-cap-save disabled={busy} style={{ minHeight: compact ? 48 : undefined }} onClick={async () => { setBusy(true); setErr("");
      try { const p: any = Object.fromEntries(Object.entries(f).filter(([, v]) => v)); const ow = (people || []).find((x: any) => x.id === p.owner_id); if (ow) p.owner = ow.full_name || ow.email;
        if (event?.id) { p.event_ref = event.id; p.source = p.source || "Event"; } if (src) p.captured_via = src === "model" ? "card photo" : "card text";
        const r = await crm.capture(p); setF({ ...blank, owner_id: f.owner_id, importance: f.importance, follow_up: f.follow_up }); setCard(""); setSrc(""); setDup([]); onDone(r); }
      catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}><Icon n="check" />{T(L("Save lead", "Сохранить лид", "Зберегти лід", "حفظ"))}</button>
  </div>;
}

function Leads({ cat, onOpen }: { cat: any; onOpen: (id: string) => void }) {
  const T = useT(); const { toast } = useApp();
  const [rows, setRows] = useState<any[] | null>(null); const [st, setSt] = useState(""); const [q, setQ] = useState(""); const [tick, setTick] = useState(0); const [add, setAdd] = useState(false); const [conv, setConv] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => { const t = setTimeout(() => crm.leads({ ...(st ? { status: st } : {}), ...(q ? { q } : {}) }, 300).then(setRows).catch((e) => setErr(e.message)), q ? 250 : 0); return () => clearTimeout(t); }, [st, q, tick]);
  return <>
    <Err e={err} />
    <section className="card"><div className="card-h" style={{ flexWrap: "wrap", gap: 8 }}><h2><Icon n="target" />{T(L("Leads", "Лиды", "Ліди", "العملاء المحتملون"))}</h2>
      <input data-lead-q style={{ marginInlineStart: "auto", maxWidth: 220 }} placeholder={T(L("Find", "Найти", "Знайти", "بحث"))} value={q} onChange={(e) => setQ(e.target.value)} />
      <select data-lead-status value={st} onChange={(e) => setSt(e.target.value)}><option value="">{T(L("All open", "Все открытые", "Усі відкриті", "كل المفتوحة"))}</option>{["New", "Reviewing", "Qualified", "Converted", "Disqualified"].map((x) => <option key={x}>{x}</option>)}</select>
      <button className="btn sm" data-lead-add onClick={() => setAdd(!add)}><Icon n="plus" />{T(L("Add lead", "Добавить лид", "Додати лід", "إضافة"))}</button></div>
      {add && <div style={{ padding: 12 }}><CaptureForm cat={cat} onDone={() => { toast(T(L("Lead saved", "Лид сохранён", "Лід збережено", "حُفظ"))); setAdd(false); setTick((t) => t + 1); }} /></div>}
      <div className="feed">{!rows ? <div className="empty">…</div> : rows.length ? rows.map((r) => <div key={r.id} className="row" data-lead={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--line, #eee)" }}>
        <span style={{ minWidth: 0 }}><a href={recHref("marketing.leads", r.id)}><b style={{ overflowWrap: "anywhere" }}>{r.title}</b></a> <span className="chip">{r.status}</span>{r.importance ? <span className={`chip ${r.importance === "Hot" ? "c-bad" : ""}`}>{r.importance}</span> : null}<br />
          <small className="muted">{[r.organization, r.email, r.phone, r.event, r.owner, r.follow_up ? `${T(L("follow up", "контакт", "контакт", "متابعة"))} ${day(r.follow_up)}` : null].filter(Boolean).join(" · ")}</small></span>
        <span>{r.opportunity_ref ? <button className="btn ghost sm" onClick={() => onOpen(r.opportunity_ref)}>{T(L("Opportunity", "Возможность", "Можливість", "الفرصة"))}</button>
          : !["Converted", "Disqualified"].includes(r.status) ? <button className="btn sm" data-convert={r.id} onClick={() => setConv(r)}>{T(L("Convert", "Конвертировать", "Конвертувати", "تحويل"))}</button> : null}</span></div>)
        : <div className="empty" style={{ padding: 16 }}>—</div>}</div></section>
    {conv && <Convert lead={conv} cat={cat} onClose={() => setConv(null)} onDone={(r) => { setConv(null); setTick((t) => t + 1); toast(T(L("Converted: {n}", "Конвертировано: {n}", "Конвертовано: {n}", "حُوّل: {n}"), { n: r.number || "" })); if (r.opportunity) onOpen(r.opportunity); }} />}
  </>;
}

function Convert({ lead, cat, onClose, onDone }: { lead: any; cat: any; onClose: () => void; onDone: (r: any) => void }) {
  const T = useT();
  const [orgs, setOrgs] = useState<any[]>([]); const [cons, setCons] = useState<any[]>([]); const [org, setOrg] = useState<string>(""); const [con, setCon] = useState<string>(""); const [reason, setReason] = useState("");
  const [o, setO] = useState({ value: "", currency: "", product: lead.interest || "", expected_decision: "", next_action: "", next_action_due: D(5) }); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => {
    const a = lead.organization ? await crm.dupes("organization", { name: lead.organization, email: lead.email }).catch(() => []) : [];
    const b = lead.email || lead.phone ? await crm.dupes("contact", { email: lead.email, phone: lead.phone }).catch(() => []) : [];
    setOrgs(a || []); setCons(b || []); const sa = (a || []).filter((x: any) => x.strength === "strong"); if (sa.length === 1) setOrg(sa[0].id); else if (!lead.organization) setOrg("none"); else setOrg(sa.length ? "" : "new");
    const sb2 = (b || []).filter((x: any) => x.strength === "strong"); setCon(sb2.length === 1 ? sb2[0].id : "new");
  })(); }, [lead]);
  const strongOrg = orgs.some((x) => x.strength === "strong"); const strongCon = cons.some((x) => x.strength === "strong");
  return <><div className="scrim" onClick={onClose} /><aside className="drawer" role="dialog" aria-modal="true" data-convert-dialog style={{ maxWidth: 640, width: "100%" }}>
    <div className="card-h"><h2 style={{ overflowWrap: "anywhere" }}><Icon n="handshake" />{T(L("Convert lead", "Конвертировать лид", "Конвертувати лід", "تحويل"))}: {lead.title}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={onClose}><Icon n="x" /></button></div>
    <div style={{ display: "grid", gap: 10, padding: 12 }}>
      <label className="fld"><span>{T(L("Organization", "Организация", "Організація", "الجهة"))}</span><select data-conv-org value={org} onChange={(e) => setOrg(e.target.value)}>
        <option value="">— {T(L("choose", "выберите", "оберіть", "اختر"))} —</option>{orgs.map((x) => <option key={x.id} value={x.id}>{T(L("Use", "Использовать", "Використати", "استخدم"))}: {x.title} ({(x.why || []).join(", ")})</option>)}
        {lead.organization && <option value="new">{T(L("New organization", "Новая организация", "Нова організація", "جهة جديدة"))}: {lead.organization}</option>}{!lead.organization && <option value="none">{T(L("No organization", "Без организации", "Без організації", "بلا جهة"))}</option>}</select></label>
      <label className="fld"><span>{T(L("Contact", "Контакт", "Контакт", "جهة الاتصال"))}</span><select data-conv-contact value={con} onChange={(e) => setCon(e.target.value)}>
        {cons.map((x) => <option key={x.id} value={x.id}>{T(L("Use", "Использовать", "Використати", "استخدم"))}: {x.title} ({(x.why || []).join(", ")})</option>)}<option value="new">{T(L("New contact from the lead", "Новый контакт из лида", "Новий контакт з ліда", "جهة اتصال جديدة"))}</option><option value="none">{T(L("No contact", "Без контакта", "Без контакту", "بلا جهة اتصال"))}</option></select></label>
      {((org === "new" && strongOrg) || (con === "new" && strongCon)) && <label className="fld"><span>{T(L("Why a new record although a similar one exists?", "Почему новая запись, хотя есть похожая?", "Чому новий запис, хоча є схожий?", "لماذا سجل جديد رغم وجود مشابه؟"))}</span><input data-conv-reason value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      <b>{T(L("New opportunity", "Новая возможность", "Нова можливість", "فرصة جديدة"))}</b>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 170px), 1fr))", gap: 8 }}>
        <label className="fld"><span>{T(L("Estimated value", "Оценка суммы", "Оцінка суми", "القيمة التقديرية"))}</span><input data-conv-value inputMode="decimal" value={o.value} onChange={(e) => setO({ ...o, value: e.target.value })} /></label>
        <label className="fld"><span>{T(L("Currency", "Валюта", "Валюта", "العملة"))}</span><select data-conv-currency value={o.currency} onChange={(e) => setO({ ...o, currency: e.target.value })}><option value="">—</option>{["USD", "AED", "EUR"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="fld"><span>{T(L("Product", "Продукт", "Продукт", "المنتج"))}</span><select value={o.product} onChange={(e) => setO({ ...o, product: e.target.value })}><option value="">—</option>{(cat?.products || []).map((x: string) => <option key={x}>{x}</option>)}</select></label>
        <label className="fld"><span>{T(L("Expected decision", "Ожидаемое решение", "Очікуване рішення", "القرار المتوقع"))}</span><input type="date" value={o.expected_decision} onChange={(e) => setO({ ...o, expected_decision: e.target.value })} /></label>
        <label className="fld"><span>{T(L("Next action", "Следующий шаг", "Наступний крок", "الخطوة التالية"))}</span><input data-conv-next value={o.next_action} onChange={(e) => setO({ ...o, next_action: e.target.value })} /></label>
        <label className="fld"><span>{T(L("Due", "Срок", "Термін", "الموعد"))}</span><input type="date" value={o.next_action_due} onChange={(e) => setO({ ...o, next_action_due: e.target.value })} /></label></div>
      {o.value && !o.currency && <small className="neg">{T(L("Choose the currency of the value.", "Укажите валюту суммы.", "Вкажіть валюту суми.", "اختر عملة القيمة."))}</small>}
      <Err e={err} />
      <button className="btn" data-conv-go disabled={busy || !org || (!!o.value && !o.currency)} onClick={async () => { setBusy(true); setErr("");
        try { const p: any = {}; if (!["new", "none", ""].includes(org)) p.party = { use: org }; if (org === "new") p.party = { new: { name: lead.organization, country: lead.country, relationship_types: ["Prospect"] }, ...(strongOrg ? { new_reason: reason } : {}) };
          if (con === "none") p.contact = null; else if (con !== "new") p.contact = { use: con }; else if (strongCon) p.contact = { new: { name: lead.contact || lead.title, email: lead.email, phone: lead.phone }, new_reason: reason };
          if (org === "none") delete p.party;
          const nw: any = Object.fromEntries(Object.entries(o).filter(([, v]) => v)); if (nw.value) nw.value = Number(String(nw.value).replace(/[\s,]/g, ""));
          p.opportunity = { new: nw }; onDone(await crm.convert(lead.id, p)); }
        catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>{T(L("Convert in one step", "Конвертировать за один шаг", "Конвертувати за один крок", "تحويل بخطوة واحدة"))}</button>
      <small className="faint">{T(L("Organisation, contact and opportunity are created (or reused) together, or not at all. The introduction, if any, travels with them.", "Организация, контакт и возможность создаются (или используются существующие) вместе — или не создаются вовсе. Представление, если есть, переходит вместе с ними.", "Організація, контакт і можливість створюються (або використовуються наявні) разом — або не створюються зовсім. Представлення, якщо є, переходить разом із ними.", "تُنشأ الجهة وجهة الاتصال والفرصة معًا أو لا تُنشأ."))}</small>
    </div></aside></>;
}

/* ------------------------------------------------ Event mode (B25, B26) ------------------------------------------------ */
function EventMode({ cat, onOpen }: { cat: any; onOpen: (id: string) => void }) {
  const T = useT(); const { toast, people, me } = useApp() as any;
  const [dv, setDv] = useState<any>(null); const [fu, setFu] = useState<any>(null); const [tick, setTick] = useState(0); const [err, setErr] = useState(""); const [view, setView] = useState<"capture" | "day" | "after">("capture");
  const [sel, setSel] = useState<string[]>([]); const [owner, setOwner] = useState(""); const [due, setDue] = useState(D(2)); const [last, setLast] = useState<any>(null);
  useEffect(() => { crm.eventDay().then(setDv).catch((e) => setErr(e.message)); crm.eventFollowup().then(setFu).catch(() => {}); }, [tick]);
  const ev = dv?.event;
  return <div style={{ display: "grid", gap: 12, minWidth: 0 }} data-event-mode>
    <Err e={err} />
    <div className="card" style={{ padding: 12 }}><b><Icon n="flag" />{ev ? `${ev.title}${ev.city ? " · " + ev.city : ""}` : T(L("No active event", "Нет активного мероприятия", "Немає активного заходу", "لا حدث نشط"))}</b>
      {!ev && <small className="faint" style={{ display: "block" }}>{T(L("A Commercial Admin chooses the active event in Settings; leads can still be captured without one.", "Активное мероприятие выбирает коммерческий администратор в настройках; лиды можно сохранять и без него.", "Активний захід обирає комерційний адміністратор у налаштуваннях; ліди можна зберігати й без нього.", "يختار المسؤول التجاري الحدث النشط في الإعدادات."))}</small>}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>{[["capture", L("Capture", "Сохранить контакт", "Зберегти контакт", "التقاط")], ["day", L("Today", "Сегодня", "Сьогодні", "اليوم")], ["after", L("After the event", "После выставки", "Після виставки", "بعد المعرض")]].map(([k, l]: any) =>
        <button key={k} className={`btn sm ${view === k ? "" : "ghost"}`} data-event-view={k} onClick={() => setView(k)}>{T(l)}</button>)}</div></div>
    {view === "capture" && <div className="card" style={{ padding: 12 }}><CaptureForm cat={cat} event={ev} compact onDone={(r) => { setLast(r); setTick((t) => t + 1); toast(T(L("Lead saved", "Лид сохранён", "Лід збережено", "حُفظ"))); }} />
      {last && <small className="muted" data-last-capture>{T(L("Saved", "Сохранено", "Збережено", "حُفظ"))}: {last.title || last.id}{last.duplicates?.length ? ` · ${T(L("possible duplicates", "возможные дубли", "можливі дублі", "تكرارات محتملة"))}: ${last.duplicates.length}` : ""}</small>}</div>}
    {view === "day" && dv && <div style={{ display: "grid", gap: 10 }} data-event-day>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        <div className="card stat" style={{ padding: 10 }}><small>{T(L("Leads total", "Всего лидов", "Усього лідів", "إجمالي"))}</small><b className="mono" style={{ fontSize: 22, display: "block" }}>{dv.total_leads ?? 0}</b></div>
        {Object.entries(dv.pipeline || {}).map(([k, v]: any) => <div key={k} className="card stat" style={{ padding: 10 }}><small>{k}</small><b className="mono" style={{ fontSize: 22, display: "block" }}>{v}</b></div>)}</div>
      <section className="card"><div className="card-h"><h2><Icon n="users" />{T(L("Team today", "Команда сегодня", "Команда сьогодні", "الفريق اليوم"))}</h2></div>
        <div className="feed">{(dv.team || []).map((m: any) => <div key={m.id} style={{ padding: "6px 12px" }}><b>{m.name}</b> <small className="faint">{T(L("leads", "лидов", "лідів", "عملاء"))}: {m.leads_owned} · {T(L("follow-ups", "контактов", "контактів", "متابعات"))}: {m.follow_ups}</small>
          {(m.meetings || []).map((x: any) => <div key={x.meeting}><small>{x.time || ""} <a href={recHref("company.meetings", x.meeting)}>{x.with || "—"}</a></small></div>)}</div>)}</div></section>
      {[["meetings", L("Meetings today", "Встречи сегодня", "Зустрічі сьогодні", "اجتماعات اليوم")], ["new_leads", L("Captured today", "Сохранено сегодня", "Збережено сьогодні", "التُقط اليوم")], ["hot_leads", L("Hot leads", "Горячие лиды", "Гарячі ліди", "عملاء ساخنون")],
        ["follow_ups_due", L("Follow-ups due", "Пора связаться", "Час зв'язатися", "متابعات مستحقة")], ["waiting_for_response", L("No response yet (24 h+)", "Без ответа (24 ч+)", "Без відповіді (24 год+)", "بلا رد (24 ساعة+)")]]
        .map(([k, l]: any) => (dv.today?.[k] || []).length ? <section key={k} className="card" data-day={k}><div className="card-h"><h2>{T(l)} <span className="chip mono">{dv.today[k].length}</span></h2></div>
          <div className="feed">{dv.today[k].slice(0, 50).map((x: any) => <div key={x.id} style={{ padding: "6px 12px" }}><a href={recHref(k === "meetings" ? "company.meetings" : "marketing.leads", x.id)} style={{ overflowWrap: "anywhere" }}>{x.title}</a> <small className="faint">{[x.time, x.organization, x.importance, x.owner, x.phone].filter(Boolean).join(" · ")}</small></div>)}</div></section> : null)}
    </div>}
    {view === "after" && fu && <div style={{ display: "grid", gap: 10 }} data-event-after>
      {[["hot", L("Hot leads", "Горячие лиды", "Гарячі ліди", "عملاء ساخنون")], ["no_owner", L("Without owner", "Без ответственного", "Без відповідального", "بلا مسؤول")], ["no_follow_up", L("Without follow-up date", "Без даты контакта", "Без дати контакту", "بلا موعد متابعة")], ["unanswered", L("Follow-up date passed", "Дата контакта прошла", "Дата контакту минула", "فات موعد المتابعة")],
        ["not_qualified", L("Not yet qualified", "Ещё не квалифицированы", "Ще не кваліфіковані", "غير مؤهلين بعد")], ["meetings_without_notes", L("Meetings without notes", "Встречи без записей", "Зустрічі без записів", "اجتماعات بلا ملاحظات")], ["converted", L("Converted", "Конвертированы", "Конвертовані", "محوّلة")]]
        .map(([k, l]: any) => (fu[k] || []).length ? <section key={k} className="card" data-after={k}><div className="card-h"><h2>{T(l)} <span className="chip mono">{fu[k].length}</span></h2></div>
          <div className="feed">{fu[k].map((x: any) => <label key={x.id} style={{ display: "flex", gap: 8, padding: "6px 12px", alignItems: "center" }}>{!["converted", "meetings_without_notes"].includes(k) && <input type="checkbox" data-pick={x.id} checked={sel.includes(x.id)} onChange={(e) => setSel(e.target.checked ? [...sel, x.id] : sel.filter((y) => y !== x.id))} />}
            <span style={{ minWidth: 0 }}><a href={recHref(k === "meetings_without_notes" ? "company.meetings" : "marketing.leads", x.id)} style={{ overflowWrap: "anywhere" }}>{x.title}</a> <small className="faint">{[x.importance, x.owner, x.organizer, x.date, x.phone, x.email].filter(Boolean).join(" · ")}</small></span>
            {x.opportunity_ref && <button className="btn ghost sm" onClick={() => onOpen(x.opportunity_ref)}>{T(L("Opportunity", "Возможность", "Можливість", "الفرصة"))}</button>}</label>)}</div></section> : null)}
      {sel.length > 0 && <div className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }} data-bulk>
        <small>{T(L("Selected: {n}", "Выбрано: {n}", "Обрано: {n}", "المحدد: {n}"), { n: sel.length })}</small>
        <select data-bulk-owner value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">{T(L("Owner", "Ответственный", "Відповідальний", "المسؤول"))}</option>{(people || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn sm" data-bulk-go disabled={!owner} onClick={() => crm.bulkAssign(sel, owner, due).then((r) => { toast(T(L("Assigned: {n}", "Назначено: {n}", "Призначено: {n}", "أُسند: {n}"), { n: r?.assigned ?? sel.length })); setSel([]); setTick((t) => t + 1); }).catch((e) => setErr(e.message))}>{T(L("Assign and set follow-up", "Назначить и поставить контакт", "Призначити й поставити контакт", "إسناد وتحديد المتابعة"))}</button>
        <small className="faint" style={{ flexBasis: "100%" }}>{T(L("No e-mail is sent to the leads. Each owner gets one notice.", "Лидам ничего не отправляется. Каждый ответственный получает одно уведомление.", "Лідам нічого не надсилається. Кожен відповідальний отримує одне сповіщення.", "لا تُرسل رسائل للعملاء."))}</small></div>}
      {me && null}
    </div>}
  </div>;
}

/* ------------------------------------------------ Commercial review (B14, B15, B32) ------------------------------------------------ */
function Review({ onOpen }: { onOpen: (id: string) => void }) {
  const T = useT(); const [w, setW] = useState<any>(null); const [wa, setWa] = useState<any[] | null>(null); const [fu, setFu] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => { crm.weekly().then(setW).catch((e) => setErr(e.message)); crm.waiting().then(setWa).catch(() => setWa([])); crm.followups("mine").then(setFu).catch(() => {}); }, []);
  const block = (k: string, l: T4) => (w?.[k] || []).length ? <section key={k} className="card" data-review={k}><div className="card-h"><h2>{T(l)} <span className="chip mono">{w[k].length}</span></h2></div>
    <div className="feed">{w[k].map((r: any) => r.title && r.id && (r.stage || r.number) ? <OppRow key={r.id + k} r={r} onOpen={onOpen} /> : <div key={(r.id || "") + k + (r.title || "")} style={{ padding: "6px 12px" }}><small>{r.title || r.text || JSON.stringify(r)}</small></div>)}</div></section> : null;
  return <div style={{ display: "grid", gap: 12 }}>
    <Err e={err} />
    {fu && <section className="card" data-my-followups><div className="card-h"><h2><Icon n="clock" />{T(L("My follow-ups", "Мои контакты", "Мої контакти", "متابعاتي"))}</h2></div>
      <div className="feed">{[...(fu.opportunities || []).map((r: any) => <OppRow key={r.id} r={r} onOpen={onOpen} />), ...(fu.leads || []).map((x: any) => <div key={x.id} style={{ padding: "6px 12px" }}><a href={recHref("marketing.leads", x.id)}>{x.title}</a> <small className="faint">{day(x.follow_up)}</small></div>)]}
        {!(fu.opportunities || []).length && !(fu.leads || []).length && <div className="empty" style={{ padding: 12 }}>—</div>}</div></section>}
    <section className="card" data-waiting><div className="card-h"><h2><Icon n="clock" />{T(L("Waiting for customers and partners", "Ждём от клиентов и партнёров", "Чекаємо від клієнтів і партнерів", "بانتظار العملاء والشركاء"))}</h2></div>
      <div className="feed">{!wa ? <div className="empty">…</div> : wa.length ? wa.map((x) => <div key={x.id} style={{ padding: "6px 12px" }}><a href={x.link}>{x.waiting_for}</a> <small className="faint">{[x.number, x.party, x.responsible, x.next_follow_up ? `${T(L("next", "след.", "наст.", "التالي"))} ${day(x.next_follow_up)}` : null, `${x.age} ${T(L("days", "дн.", "дн.", "يوم"))}`].filter(Boolean).join(" · ")}</small>
        {x.opp_id && <button className="btn ghost sm" onClick={() => onOpen(x.opp_id)}>{T(L("Open", "Открыть", "Відкрити", "فتح"))}</button>}</div>) : <div className="empty" style={{ padding: 12 }}>—</div>}</div></section>
    {w && <div className="card" style={{ padding: 12 }}><b>{day(w.from)} — {day(w.to)}</b><br /><small className="faint">{w.note}</small></div>}
    {w && Object.keys(w).filter((k) => Array.isArray(w[k])).map((k) => block(k, (CRM_KIND as any)[k] || L(k.replace(/_/g, " "), k.replace(/_/g, " "), k.replace(/_/g, " "), k.replace(/_/g, " "))))}
  </div>;
}

/* ------------------------------------------------ Import / export (B34) ------------------------------------------------ */
function ImportExport({ caps }: { caps: Record<string, boolean> }) {
  const T = useT(); const { toast } = useApp();
  const [kind, setKind] = useState("organizations"); const [rows, setRows] = useState<any[]>([]); const [file, setFile] = useState(""); const [pv, setPv] = useState<any>(null); const [dec, setDec] = useState<Record<string, string>>({}); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [list, setList] = useState<any[]>([]); const [tick, setTick] = useState(0);
  const [ek, setEk] = useState("opportunities");
  useEffect(() => { crm.imports().then((x) => setList(x || [])).catch(() => {}); }, [tick]);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setErr(""); try { return await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <div style={{ display: "grid", gap: 12 }}>
    <Err e={err} />
    <section className="card" data-import><div className="card-h"><h2><Icon n="upload" />{T(L("Import from CSV", "Импорт из CSV", "Імпорт із CSV", "استيراد CSV"))}</h2></div>
      <div style={{ display: "grid", gap: 8, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><select data-import-kind value={kind} onChange={(e) => { setKind(e.target.value); setPv(null); }}>{["organizations", "contacts", "leads"].map((x) => <option key={x}>{x}</option>)}</select>
          <input type="file" accept=".csv,text/csv" data-import-file onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f.name); const r = parseCsv(await f.text()); setRows(r); setPv(null); setDec({}); if (r.length) run(async () => setPv(await crm.importPreview(kind, r))); }} /></div>
        <small className="faint">{T(L("Columns: name, country, website, email, phone, relationship_types (separate with ;), first_name, last_name, title, organization, follow_up (YYYY-MM-DD), importance (Hot/Warm/Cold).", "Колонки: name, country, website, email, phone, relationship_types (через ;), first_name, last_name, title, organization, follow_up (ГГГГ-ММ-ДД), importance (Hot/Warm/Cold).", "Колонки: name, country, website, email, phone, relationship_types (через ;), first_name, last_name, title, organization, follow_up (РРРР-ММ-ДД), importance (Hot/Warm/Cold).", "الأعمدة: name, country, website, email, phone…"))}</small>
        {pv && <div data-import-preview><b>{T(L("Rows: {t} · ready: {r} · need a decision: {d} · with errors: {e}", "Строк: {t} · готово: {r} · нужно решение: {d} · с ошибками: {e}", "Рядків: {t} · готово: {r} · потрібне рішення: {d} · з помилками: {e}", "الصفوف: {t}"), { t: pv.total, r: pv.ready, d: pv.decide, e: pv.errors })}</b><br /><small className="faint">{pv.note}</small>
          <div style={{ maxHeight: 360, overflow: "auto", marginTop: 6 }}>{(pv.rows || []).map((r: any) => <div key={r.row} data-import-row={r.row} data-action={r.action} style={{ padding: "4px 0", borderBottom: "1px solid var(--line, #eee)" }}>
            <small className="mono">{r.row}.</small> <b>{r.name || "—"}</b> <span className={`chip ${r.action === "fix" ? "c-bad" : r.action === "decide" ? "c-warn" : "c-ok"}`}>{r.action}</span>
            {(r.errors || []).map((x: string, i: number) => <small key={i} className="neg"> {x}</small>)}{(r.warnings || []).map((x: string, i: number) => <small key={i} className="faint"> · {x}</small>)}
            {r.action === "decide" && <select data-decide={r.row} value={dec[r.row] || ""} onChange={(e) => setDec({ ...dec, [r.row]: e.target.value })} style={{ marginInlineStart: 8 }}><option value="">— {T(L("decide", "решите", "вирішіть", "قرر"))} —</option><option value="skip">{T(L("Skip", "Пропустить", "Пропустити", "تخطٍ"))}</option>
              {(r.duplicates || []).map((x: any) => <option key={x.id} value={`use:${x.id}`}>{T(L("Use existing", "Использовать существующую", "Використати наявну", "استخدم الموجود"))}: {x.title}</option>)}<option value="create">{T(L("Create new anyway", "Всё равно создать новую", "Однаково створити нову", "أنشئ جديدًا"))}</option></select>}</div>)}</div>
          <button className="btn" data-import-go style={{ marginTop: 8 }} disabled={busy || (pv.rows || []).some((r: any) => r.action === "decide" && !dec[r.row])} onClick={() => run(async () => { const r = await crm.importCommit(kind, rows, dec, file); toast(T(L("Imported: {c} new, {l} existing used, {s} skipped", "Импортировано: новых {c}, существующих {l}, пропущено {s}", "Імпортовано: нових {c}, наявних {l}, пропущено {s}", "استيراد: {c}"), { c: r.created, l: r.existing_used, s: r.skipped })); setPv(null); setRows([]); setTick((t) => t + 1); })}>{T(L("Import", "Импортировать", "Імпортувати", "استيراد"))}</button></div>}
      </div></section>
    <section className="card" data-imports><div className="card-h"><h2><Icon n="clock" />{T(L("Imports", "Импорты", "Імпорти", "عمليات الاستيراد"))}</h2></div>
      <div className="feed">{list.length ? list.map((b) => <div key={b.id} style={{ padding: "6px 12px" }} data-batch={b.id}><small className="mono">{day(b.at)}</small> {b.kind} · {b.file || "—"} · {T(L("created", "создано", "створено", "أُنشئ"))} {b.created} · {b.by} <span className="chip">{b.status}</span>
        {b.status !== "Rolled back" && <button className="btn ghost sm" data-batch-rollback={b.id} onClick={() => { if (confirm(T(L("Remove the records this import created (if nothing else uses them)?", "Удалить записи, созданные этим импортом (если их ничего не использует)?", "Видалити записи, створені цим імпортом (якщо їх ніщо не використовує)?", "إزالة سجلات هذا الاستيراد؟")))) run(async () => { const r = await crm.importRollback(b.id); toast(`${r.removed ?? 0} / ${r.kept ?? 0}`); setTick((t) => t + 1); }); }}>{T(L("Roll back", "Откатить", "Відкотити", "تراجع"))}</button>}</div>) : <div className="empty" style={{ padding: 12 }}>—</div>}</div></section>
    <section className="card" data-export><div className="card-h"><h2><Icon n="download" />{T(L("Export", "Экспорт", "Експорт", "تصدير"))}</h2></div>
      {caps.export_commercial ? <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap" }}><select data-export-kind value={ek} onChange={(e) => setEk(e.target.value)}>{["opportunities", "pipeline", "organizations", "contacts", "leads"].map((x) => <option key={x}>{x}</option>)}</select>
        <button className="btn sm" data-export-go disabled={busy} onClick={() => run(async () => { const r = await crm.exportRows(ek); const blob = new Blob([toCsv(r.rows || [])], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `agron-${ek}-${D(0)}.csv`; a.click(); toast(T(L("Exported {n} rows (recorded in the audit)", "Выгружено строк: {n} (записано в аудит)", "Вивантажено рядків: {n} (записано в аудит)", "صُدّر {n}"), { n: r.count })); })}>{T(L("Download CSV", "Скачать CSV", "Завантажити CSV", "تنزيل CSV"))}</button>
        <small className="faint" style={{ flexBasis: "100%" }}>{T(L("Only records you may open; US-persons-only records and excluded fields are left out unless policy allows. Every export is audited.", "Только доступные вам записи; записи «только для US Persons» и исключённые поля не выгружаются, если политика не разрешает. Каждая выгрузка записывается.", "Лише доступні вам записи; записи «лише для US Persons» і виключені поля не вивантажуються, якщо політика не дозволяє. Кожне вивантаження записується.", "فقط السجلات المتاحة لك؛ كل تصدير مُدقق."))}</small></div>
        : <div className="empty" style={{ padding: 12 }}>{T(L("Exporting commercial data needs the Export Commercial Data authority (given by the Owner).", "Для выгрузки коммерческих данных нужно полномочие «Экспорт коммерческих данных» (выдаёт Владелец).", "Для вивантаження комерційних даних потрібне повноваження «Експорт комерційних даних» (надає Власник).", "التصدير يحتاج صلاحية تصدير البيانات التجارية."))}</div>}</section>
  </div>;
}

/* ------------------------------------------------ Settings (B11, B19, B20, B38) ------------------------------------------------ */
const CAPS: [string, T4][] = [["commercial_admin", L("Commercial Admin", "Коммерческий администратор", "Комерційний адміністратор", "مسؤول تجاري")], ["workflow_admin", L("Workflow Admin", "Администратор процессов", "Адміністратор процесів", "مسؤول العمليات")],
  ["proposal_approver", L("Proposal approver", "Согласующий КП", "Погоджувач КП", "معتمد العروض")], ["pricing_approver", L("Pricing approver", "Согласующий цены", "Погоджувач цін", "معتمد الأسعار")], ["export_commercial", L("Export commercial data", "Экспорт коммерческих данных", "Експорт комерційних даних", "تصدير البيانات التجارية")]];
function Settings({ caps }: { caps: Record<string, boolean> }) {
  const T = useT(); const { toast, me, people } = useApp() as any;
  const [s, setS] = useState<any>(null); const [txt, setTxt] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [cl, setCl] = useState<any[]>([]); const [tick, setTick] = useState(0);
  const [who, setWho] = useState(""); const [cap, setCap] = useState("proposal_approver");
  useEffect(() => { crm.settings().then((x) => { setS(x); setTxt(JSON.stringify(x?.value || {}, null, 1)); }).catch((e) => setErr(e.message)); crm.capsList().then((x) => setCl(x || [])).catch(() => {}); }, [tick]);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setErr(""); try { const r = await fn(); toast(T(L("Saved", "Сохранено", "Збережено", "حُفظ"))); setTick((t) => t + 1); return r; } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const v = s?.value || {};
  const setStage = (i: number, k: string, val: any) => { const p = [...(v.pipeline || [])]; p[i] = { ...p[i], [k]: val }; run(() => crm.saveSettings({ pipeline: p }, s.version)); };
  return <div style={{ display: "grid", gap: 12 }}>
    <Err e={err} />
    {s && <section className="card" data-crm-pipeline-settings><div className="card-h"><h2><Icon n="funnel" />{T(L("Pipeline stages", "Этапы воронки", "Етапи воронки", "مراحل المسار"))}</h2></div>
      <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>{T(L("Stage", "Этап", "Етап", "المرحلة"))}</th><th>{T(L("Kind", "Тип", "Тип", "النوع"))}</th><th>{T(L("Default probability %", "Вероятность по умолчанию %", "Ймовірність за замовчуванням %", "الاحتمال %"))}</th><th>{T(L("Required fields", "Обязательные поля", "Обов'язкові поля", "حقول مطلوبة"))}</th></tr></thead>
        <tbody>{(v.pipeline || []).map((p: any, i: number) => <tr key={p.stage} data-stage-row={p.stage}><td>{p.stage}</td><td>{p.kind}</td>
          <td><input data-prob={p.stage} type="number" min={0} max={100} defaultValue={p.probability ?? ""} disabled={!s.caps?.commercial_admin || busy} onBlur={(e) => { const n = e.target.value === "" ? null : Number(e.target.value); if (n !== (p.probability ?? null)) setStage(i, "probability", n); }} style={{ width: 80 }} /></td>
          <td><small className="mono">{(p.required || []).join(", ") || "—"}</small></td></tr>)}</tbody></table></div>
      <small className="faint" style={{ display: "block", padding: "0 12px 12px" }}>{T(L("Probabilities are management estimates. Changing a default does not overwrite a manual estimate on an opportunity.", "Вероятности — управленческие оценки. Изменение значения по умолчанию не перезаписывает ручную оценку в возможности.", "Ймовірності — управлінські оцінки. Зміна значення за замовчуванням не перезаписує ручну оцінку в можливості.", "الاحتمالات تقديرات إدارية."))}</small></section>}
    {s && <section className="card" data-crm-settings-json><div className="card-h"><h2><Icon n="gear" />{T(L("Catalogs and follow-up periods", "Справочники и сроки контактов", "Довідники та терміни контактів", "القوائم ومهل المتابعة"))}</h2><small className="faint mono" style={{ marginInlineStart: "auto" }}>v{s.version}</small></div>
      <div style={{ padding: 12, display: "grid", gap: 8 }}><textarea rows={12} style={{ fontFamily: "monospace", width: "100%" }} value={txt} onChange={(e) => setTxt(e.target.value)} disabled={!s.caps?.commercial_admin} />
        {s.caps?.commercial_admin ? <button className="btn sm" data-crm-settings-save disabled={busy} onClick={() => run(async () => crm.saveSettings(JSON.parse(txt), s.version))}>{T(L("Save settings", "Сохранить настройки", "Зберегти налаштування", "حفظ"))}</button>
          : <small className="faint">{T(L("Only a Commercial Admin (or the Owner) changes these. A System Administrator is not a Commercial Admin by role.", "Это меняет только коммерческий администратор (или Владелец). Системный администратор не является коммерческим администратором по роли.", "Це змінює лише комерційний адміністратор (або Власник). Системний адміністратор не є комерційним адміністратором за роллю.", "يغيرها المسؤول التجاري أو المالك فقط."))}</small>}
        {(s.history || []).length > 0 && <details><summary>{T(L("History", "История", "Історія", "السجل"))}</summary><ul>{s.history.map((h: any, i: number) => <li key={i}><small className="mono">v{h.version} · {day(h.at)} · {h.by}</small></li>)}</ul></details>}</div></section>}
    <section className="card" data-crm-caps><div className="card-h"><h2><Icon n="key" />{T(L("Commercial authorities", "Коммерческие полномочия", "Комерційні повноваження", "الصلاحيات التجارية"))}</h2></div>
      <div style={{ padding: 12, display: "grid", gap: 8 }}>
        <small className="muted">{T(L("Your authorities", "Ваши полномочия", "Ваші повноваження", "صلاحياتك"))}: {CAPS.filter(([k]) => caps[k]).map(([, l]) => T(l)).join(", ") || "—"}</small>
        {cl.length > 0 && <ul style={{ margin: 0, paddingInlineStart: 18 }}>{cl.map((x: any, i: number) => <li key={i} data-cap-row={`${x.user_id}:${x.cap}`}><small>{x.name || x.user_id} — {T((CAPS.find(([k]) => k === x.cap) || [x.cap, L(x.cap, x.cap, x.cap, x.cap)])[1])}{x.by ? <span className="faint"> · {x.by} · {day(x.at)}</span> : null}</small>
          {me.role === "owner" && <button className="btn ghost sm" onClick={() => run(() => crm.setCap(x.user_id, x.cap, false))}><Icon n="x" /></button>}</li>)}</ul>}
        {me.role === "owner" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><select data-cap-user value={who} onChange={(e) => setWho(e.target.value)}><option value="">—</option>{(people || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
          <select data-cap-cap value={cap} onChange={(e) => setCap(e.target.value)}>{CAPS.map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select>
          <button className="btn sm" data-cap-grant disabled={!who || busy} onClick={() => run(() => crm.setCap(who, cap, true))}>{T(L("Grant", "Выдать", "Надати", "منح"))}</button></div>}
        <small className="faint">{T(L("Only the Owner grants these. Management holds the authorities listed in the commercial settings (management_caps). Approval policies are approved under Requests & processes → Process builder.", "Выдаёт только Владелец. Руководство имеет полномочия, перечисленные в коммерческих настройках (management_caps). Политики согласования утверждаются в «Заявки и процессы → Конструктор процессов».", "Надає лише Власник. Керівництво має повноваження, перелічені в комерційних налаштуваннях (management_caps). Політики погодження затверджуються в «Заявки та процеси → Конструктор процесів».", "يمنحها المالك فقط."))} <Link href="/ops?tab=builder">/ops</Link></small></div></section>
  </div>;
}
