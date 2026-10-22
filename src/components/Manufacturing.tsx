"use client";
// MANUFACTURING (Phase 8): products, configurations, BOM revisions, build units, materials, inventory, work, quality,
// tests, engineering changes and the weekly review — on the same records as the rest of Workspace (procurement,
// documents, issues, approvals, suppliers and projects are reused, never duplicated). Every list and number comes from
// a v25 database function for the signed-in person only; every rule is checked by the database.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import MfgUnit from "./MfgUnit";
import { mfg, money, qty } from "@/lib/mfgApi";
import { parseCsv, toCsv } from "@/lib/crmApi";
import { saveBlob } from "@/lib/format";
import { DASH, L, W, type T4 } from "@/lib/mfgText";
import { mfgWeeklyParts } from "@/lib/mgmt";
import { Act, Err, LabelCard, Reasons, StatusChip, Tbl, Wait, day, printLabels, useT, when } from "./MfgUi";

type Tab = "dashboard" | "units" | "products" | "boms" | "materials" | "inventory" | "quality" | "tests" | "changes" | "review" | "labels" | "settings";

export default function Manufacturing() {
  const T = useT();
  const q = typeof window !== "undefined" ? new URLSearchParams(location.search) : null;
  const [tab, setTab] = useState<Tab>(((q?.get("tab") as Tab) || (q?.get("list") ? "units" : "dashboard")));
  const [unit, setUnit] = useState<string | null>(q?.get("unit") || null);
  const [caps, setCaps] = useState<Record<string, boolean> | null>(null); const [err, setErr] = useState("");
  useEffect(() => { mfg.caps().then((c) => setCaps(c || {})).catch((e) => { setErr(e.message); setCaps({}); }); }, []);
  const go = (t: Tab) => { setTab(t); setUnit(null); try { history.replaceState(null, "", `/mfg?tab=${t}`); } catch {} };
  const openUnit = (id: string) => { setUnit(id); try { history.replaceState(null, "", `/mfg?unit=${id}`); } catch {} window.scrollTo?.({ top: 0 }); };
  const c = caps || {};
  const tabs: [Tab, string, T4][] = [
    ["dashboard", "grid", W.dashboard], ["units", "factory", W.units], ["products", "box", W.products], ["boms", "layers", W.boms], ["materials", "cart", W.materials],
    ["inventory", "store", W.inventory], ["quality", "shield", W.quality], ["tests", "flask", W.tests], ["changes", "git", W.changes], ["review", "clipboard", W.review], ["labels", "tag", W.labels],
    ...((c.manufacturing_admin || c.workflow_admin) ? [["settings", "gear", W.settings] as [Tab, string, T4]] : []),
  ];
  return <div className="mfg" style={{ display: "grid", gap: 16, minWidth: 0 }}>
    <nav className="dtabs" style={{ ["--dc" as any]: "#0F766E", overflowX: "auto" }} aria-label={T(W.title)}>
      {tabs.map(([k, ic, l]) => <button key={k} className={tab === k && !unit ? "on" : ""} data-tab={k} onClick={() => go(k)}><Icon n={ic} />{T(l)}</button>)}
      <Link href="/build" data-nav-build><Icon n="cpu" />{T(W.shop)}</Link>
    </nav>
    <Err e={err} />
    {unit ? <MfgUnit id={unit} onClose={() => go(tab)} /> : <>
      {tab === "dashboard" && <Dash onOpen={openUnit} />}
      {tab === "units" && <Units caps={c} onOpen={openUnit} initial={q?.get("list") || "all"} />}
      {tab === "products" && <Products onOpen={openUnit} />}
      {tab === "boms" && <Boms caps={c} initial={q?.get("bom")} />}
      {tab === "materials" && <Materials onOpen={openUnit} />}
      {tab === "inventory" && <Inventory caps={c} item={q?.get("item")} serial={q?.get("serial")} />}
      {tab === "quality" && <Quality caps={c} onOpen={openUnit} insp={q?.get("insp")} />}
      {tab === "tests" && <Tests onOpen={openUnit} />}
      {tab === "changes" && <Changes caps={c} onOpen={openUnit} />}
      {tab === "review" && <Review onOpen={openUnit} />}
      {tab === "labels" && <Labels caps={c} />}
      {tab === "settings" && <Settings caps={c} />}
    </>}
  </div>;
}

/* ------------------------------------------------ rows ------------------------------------------------ */
function UnitRow({ r, onOpen }: { r: any; onOpen: (id: string) => void }) {
  const T = useT();
  return <button className="row" data-unit={r.id} onClick={() => onOpen(r.id)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, textAlign: "start", width: "100%", padding: "8px 12px", borderBottom: "1px solid var(--line, #eee)" }}>
    <span style={{ minWidth: 0 }}><b style={{ overflowWrap: "anywhere" }}><span className="mono">{r.number}</span> {r.title && r.title !== r.number ? `· ${String(r.title).replace(`${r.number} · `, "")}` : ""}</b><br />
      <small className="muted">{[r.product, r.config, r.owner, r.target && `${T(W.target)} ${day(r.target)}`].filter(Boolean).join(" · ")}</small>
      {(r.reasons || []).length ? <><br /><small className="faint" data-reasons style={{ overflowWrap: "anywhere" }}>{(r.reasons || []).slice(0, 3).map((x: any) => (typeof x === "string" ? x : x.text)).join(" · ")}</small></> : null}</span>
    <span style={{ textAlign: "end" }}><StatusChip s={r.status} />{r.blocks ? <><br /><small className="neg mono">{r.blocks} ⛔</small></> : null}</span>
  </button>;
}
const RecRow = ({ r }: { r: any }) => <div className="row" data-rec={r.id} style={{ padding: "8px 12px", borderBottom: "1px solid var(--line, #eee)", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6 }}>
  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><span className="mono">{r.number}</span> {r.title}<br /><small className="muted">{[r.unit, r.kind, r.severity, day(r.date || r.created_at)].filter(Boolean).join(" · ")}</small></span>
  <span><StatusChip s={r.result || r.outcome || r.status} /></span></div>;

/* ------------------------------------------------ dashboard (B59): every number opens the list behind it ------------------------------------------------ */
function Dash({ onOpen }: { onOpen: (id: string) => void }) {
  const T = useT(); const [ov, setOv] = useState<any>(null); const [err, setErr] = useState(""); const [drill, setDrill] = useState<[string, T4] | null>(null); const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { mfg.overview().then(setOv).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (!drill) return; setRows(null); mfg.list(drill[0]).then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, [drill]);
  if (err && !ov) return <Err e={err} />;
  if (!ov) return <Wait />;
  const recKinds = ["inspections_required", "nonconformances", "failed_tests"];
  return <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
      {DASH.map(([k, kind, l]) => { const n = ov[k] ?? 0;
        return <button key={k} className="card stat" data-block={k} style={{ textAlign: "start", padding: 12 }} onClick={() => setDrill([kind, l])}>
          <small>{T(l)}</small><div><b className={`mono ${["blocked", "shortages", "late", "late_purchases", "failed_tests", "nonconformances"].includes(k) && n ? "neg" : ""}`} style={{ fontSize: 22 }}>{n}</b></div></button>; })}
    </div>
    {(ov.by_product || []).length ? <section className="card" data-by-product><div className="card-h"><h2><Icon n="box" />{T(W.products)}</h2></div>
      <Tbl rows={ov.by_product} cols={[["product", W.product], ["active", L("Active", "Активные", "Активні", "نشطة")], ["blocked", L("Blocked", "Заблокированы", "Заблоковані", "معطلة"), (r) => <b className={r.blocked ? "neg" : ""}>{r.blocked}</b>], ["done", L("Completed", "Завершены", "Завершені", "مكتملة")]]} /></section> : null}
    {drill && <section className="card" data-drill={drill[0]}><div className="card-h"><h2><Icon n="funnel" />{T(drill[1])}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setDrill(null)}>{T(W.close)}</button></div>
      <div className="feed">{!rows ? <div className="empty">…</div> : rows.length ? rows.map((r) => recKinds.includes(drill[0]) ? <RecRow key={r.id} r={r} /> : <UnitRow key={r.id} r={r} onOpen={onOpen} />) : <div className="empty" style={{ padding: 16 }}>{T(W.none)}</div>}</div></section>}
    <small className="faint">{T(L("Counts include only the units and records you may open.", "Учитываются только изделия и записи, доступные вам.", "Враховуються лише вироби та записи, доступні вам.", "تشمل الأعداد فقط ما يمكنك فتحه."))}</small>
  </>;
}

/* ------------------------------------------------ build units ------------------------------------------------ */
const LISTS: [string, T4][] = [["all", L("All", "Все", "Усі", "الكل")], ["units", L("Active", "Активные", "Активні", "نشطة")], ["blocked", L("Blocked", "Заблокированы", "Заблоковані", "معطلة")], ["ready_for_build", L("Ready for build", "Готовы к сборке", "Готові до збірки", "جاهزة للبناء")],
  ["in_assembly", L("In build", "В сборке", "У збиранні", "قيد البناء")], ["shortages", L("Shortage", "Нехватка", "Нестача", "نقص")], ["late", L("Late", "Опаздывают", "Запізнюються", "متأخرة")], ["ready_acceptance", L("Ready for acceptance", "К приёмке", "До приймання", "للقبول")],
  ["ready_shipment", L("Ready for shipment", "К отгрузке", "До відвантаження", "للشحن")], ["hold", L("Hold", "Пауза", "Пауза", "معلق")], ["done", L("Completed", "Завершены", "Завершені", "مكتملة")]];
function Units({ caps, onOpen, initial }: { caps: any; onOpen: (id: string) => void; initial: string }) {
  const T = useT(); const [kind, setKind] = useState(LISTS.some(([k]) => k === initial) ? initial : "all"); const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [tick, setTick] = useState(0);
  useEffect(() => { setRows(null); mfg.list(kind).then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, [kind, tick]);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return !s ? rows : (rows || []).filter((r) => [r.number, r.title, r.product, r.config, r.owner, r.status].join(" ").toLowerCase().includes(s)); }, [rows, q]);
  return <>
    <Err e={err} />
    <div className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label className="fld"><span>{T(L("List", "Список", "Список", "القائمة"))}</span><select data-units-list value={kind} onChange={(e) => setKind(e.target.value)}>{LISTS.map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select></label>
      <input data-units-q style={{ flex: 1, minWidth: 160 }} placeholder={T(W.find)} value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
    <section className="card feed" data-units={kind}>{!shown ? <div className="empty">…</div> : shown.length ? shown.map((r) => <UnitRow key={r.id} r={r} onOpen={onOpen} />) : <div className="empty" style={{ padding: 16 }}>{T(W.none)}</div>}</section>
    {caps.build_manager && <NewUnit onDone={(id) => { setTick((t) => t + 1); if (id) onOpen(id); }} />}
  </>;
}

function NewUnit({ onDone }: { onDone: (id?: string) => void }) {
  const T = useT(); const [prods, setProds] = useState<any[]>([]); const [cfgs, setCfgs] = useState<any[]>([]); const [f, setF] = useState<any>({ product: "", config: "", title: "", target: "", destination: "", priority: "Medium" });
  useEffect(() => { mfg.products().then(setProds).catch(() => {}); mfg.records("technical.configurations").then(setCfgs).catch(() => {}); }, []);
  const okCfgs = cfgs.filter((c) => c.status === "Approved" && (!f.product || c.data?.product_ref === f.product));
  return <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-new-unit><b>{T(W.newUnit)}</b>
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
      <label className="fld"><span>{T(W.product)} *</span><select data-nu-product value={f.product} onChange={(e) => setF({ ...f, product: e.target.value, config: "" })}><option value="">—</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
      <label className="fld"><span>{T(W.config)} ({T(L("approved", "утверждённая", "затверджена", "معتمدة"))}) *</span><select data-nu-config value={f.config} onChange={(e) => setF({ ...f, config: e.target.value })}><option value="">—</option>{okCfgs.map((c) => <option key={c.id} value={c.id}>{c.data?.code} v{c.data?.version} · {c.title}</option>)}</select></label>
      <label className="fld"><span>{T(L("Title", "Название", "Назва", "العنوان"))}</span><input data-nu-title value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="fld"><span>{T(W.target)}</span><input type="date" data-nu-target value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
      <label className="fld"><span>{T(L("Destination", "Назначение", "Призначення", "الوجهة"))}</span><input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></label>
      <label className="fld"><span>{T(L("Priority", "Приоритет", "Пріоритет", "الأولوية"))}</span><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{["Low", "Medium", "High", "Critical"].map((x) => <option key={x}>{x}</option>)}</select></label>
    </div>
    {f.product && f.config && <Act data="unit-create" label={L("Create and release the unit", "Создать и выпустить изделие", "Створити та випустити виріб", "إنشاء الوحدة وإصدارها")} what={L("Workspace gives the next unit number of the product and pins the approved configuration and its BOM revision.", "Workspace присвоит следующий номер изделия и закрепит утверждённую конфигурацию и ревизию спецификации.", "Workspace призначить наступний номер виробу та закріпить затверджену конфігурацію і ревізію специфікації.", "يعطي Workspace رقم الوحدة التالي ويثبت التهيئة.")}
      run={() => mfg.createUnit({ product: f.product, config: f.config, title: f.title || null, target: f.target || null, destination: f.destination || null, priority: f.priority })} done={(r) => onDone(r?.id)} />}
  </section>;
}

/* ------------------------------------------------ products and configurations ------------------------------------------------ */
function Products({ onOpen }: { onOpen: (id: string) => void }) {
  const T = useT(); const [rows, setRows] = useState<any[] | null>(null); const [sel, setSel] = useState<string | null>(null); const [pv, setPv] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => { mfg.products().then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, []);
  useEffect(() => { if (!sel) return; setPv(null); mfg.product(sel).then(setPv).catch((e) => setErr(e.message)); }, [sel]);
  return <>
    <Err e={err} />
    <section className="card" data-products><Tbl rows={rows} cols={[["code", L("Code", "Код", "Код", "الرمز"), (r) => <button className="btn ghost sm mono" data-product={r.code} onClick={() => setSel(r.id)}>{r.code}</button>], ["name", L("Name", "Название", "Назва", "الاسم")], ["family", L("Family", "Семейство", "Сімейство", "العائلة")], ["status", W.status, (r) => <StatusChip s={r.status} />], ["configs", L("Configurations", "Конфигурации", "Конфігурації", "التهيئات")], ["units", W.units], ["current_config", L("Current configuration", "Текущая конфигурация", "Поточна конфігурація", "التهيئة الحالية")]]} /></section>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Link className="btn ghost sm" href="/technical/products"><Icon n="box" />{T(L("Edit products", "Редактировать продукты", "Редагувати продукти", "تحرير المنتجات"))}</Link>
      <Link className="btn ghost sm" href="/technical/configurations"><Icon n="layers" />{T(L("Configurations", "Конфигурации", "Конфігурації", "التهيئات"))}</Link>
      <Link className="btn ghost sm" href="/technical/items"><Icon n="tag" />{T(L("Item master", "Номенклатура", "Номенклатура", "سجل الأصناف"))}</Link>
      <Link className="btn ghost sm" href="/technical/test_procedures"><Icon n="flask" />{T(L("Test procedures", "Методики испытаний", "Методики випробувань", "إجراءات الاختبار"))}</Link></div>
    {sel && <section className="card" data-product-view={sel} style={{ padding: 12, display: "grid", gap: 10 }}>{!pv ? <Wait /> : <>
      <h2 style={{ margin: 0 }}>{pv.product?.code} · {pv.product?.name} <StatusChip s={pv.product?.status} /></h2>
      {pv.product?.description && <small className="muted">{pv.product.description}</small>}
      <b>{T(L("Configurations", "Конфигурации", "Конфігурації", "التهيئات"))}</b><Tbl rows={pv.configurations} cols={[["code", L("Code", "Код", "Код", "الرمز")], ["name", L("Name", "Название", "Назва", "الاسم")], ["version", "v"], ["status", W.status, (r) => <StatusChip s={r.status} />]]} />
      <b>{T(W.units)}</b><div className="feed">{(pv.units || []).map((u: any) => <UnitRow key={u.id} r={u} onOpen={onOpen} />)}{!(pv.units || []).length && <div className="empty">{T(W.none)}</div>}</div>
      {(pv.shortages || []).length ? <><b>{T(L("Shortages", "Нехватки", "Нестачі", "النواقص"))}</b><Tbl rows={pv.shortages} cols={[["item_number", W.item], ["item_title", ""], ["shortage", L("Short", "Не хватает", "Бракує", "نقص"), (r) => qty(r.shortage)], ["unit_number", L("Unit", "Изделие", "Виріб", "الوحدة")]]} /></> : null}
      {(pv.issues || []).length ? <><b>{T(L("Open issues", "Открытые проблемы", "Відкриті проблеми", "مشكلات مفتوحة"))}</b><div className="feed">{pv.issues.map((r: any) => <RecRow key={r.id} r={r} />)}</div></> : null}
      {(pv.open_changes || []).length ? <><b>{T(L("Open engineering changes", "Открытые изменения", "Відкриті зміни", "تغييرات مفتوحة"))}</b><div className="feed">{pv.open_changes.map((r: any) => <RecRow key={r.id} r={r} />)}</div></> : null}
      {(pv.cost || []).length ? <><b>{T(W.costLabel)}</b><Tbl rows={pv.cost} cols={[["currency", L("Currency", "Валюта", "Валюта", "العملة")], ["planned", L("Planned", "План", "План", "المخطط"), (r) => money(r.planned)], ["consumed", L("Consumed", "Израсходовано", "Використано", "المستهلك"), (r) => money(r.consumed)]]} /></> : null}
    </>}</section>}
  </>;
}

/* ------------------------------------------------ BOMs: list, editor, approval, comparison ------------------------------------------------ */
function Boms({ caps, initial }: { caps: any; initial?: string | null }) {
  const T = useT(); const [rows, setRows] = useState<any[] | null>(null); const [sel, setSel] = useState<string | null>(initial || null); const [cfgs, setCfgs] = useState<any[]>([]); const [cfg, setCfg] = useState(""); const [err, setErr] = useState(""); const [tick, setTick] = useState(0);
  const [cmpA, setCmpA] = useState(""); const [cmpB, setCmpB] = useState(""); const [cmp, setCmp] = useState<any>(null);
  useEffect(() => { mfg.records("technical.boms").then(setRows).catch((e) => { setErr(e.message); setRows([]); }); mfg.records("technical.configurations").then(setCfgs).catch(() => {}); }, [tick]);
  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => `${a.data?.number}${a.data?.revision}`.localeCompare(`${b.data?.number}${b.data?.revision}`)), [rows]);
  return <>
    <Err e={err} />
    <section className="card" data-boms><Tbl rows={rows ? sorted : null} cols={[["number", "#", (r) => <button className="btn ghost sm mono" data-bom={r.data?.number + "-" + r.data?.revision} onClick={() => setSel(r.id)}>{r.data?.number} rev {r.data?.revision}</button>], ["title", L("Title", "Название", "Назва", "العنوان")], ["config", W.config, (r) => r.data?.config_ref_title || r.data?.config_code], ["status", W.status, (r) => <StatusChip s={r.status} />], ["updated_at", L("Updated", "Изменено", "Змінено", "حُدّث"), (r) => day(r.updated_at)]]} /></section>
    {caps.bom_editor && <section className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label className="fld" style={{ minWidth: 220 }}><span>{T(L("New BOM draft for configuration", "Новый черновик спецификации для конфигурации", "Нова чернетка специфікації для конфігурації", "مسودة قائمة مواد جديدة"))}</span><select data-bom-config value={cfg} onChange={(e) => setCfg(e.target.value)}><option value="">—</option>{cfgs.map((c) => <option key={c.id} value={c.id}>{c.data?.code} v{c.data?.version} · {c.title} ({c.status})</option>)}</select></label>
      {cfg && <Act data="bom-create" label={L("Create BOM draft", "Создать черновик", "Створити чернетку", "إنشاء مسودة")} what={cfgs.find((c) => c.id === cfg)?.title || ""} run={() => mfg.bomCreate(cfg)} done={(r) => { setTick((t) => t + 1); if (r?.id) setSel(r.id); }} />}
    </section>}
    {sel && <BomEditor key={sel + tick} id={sel} caps={caps} onChanged={(id) => { setTick((t) => t + 1); if (id) setSel(id); }} />}
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-bom-compare><b>{T(L("Compare two BOM revisions", "Сравнить две ревизии", "Порівняти дві ревізії", "مقارنة مراجعتين"))}</b>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{[[cmpA, setCmpA], [cmpB, setCmpB]].map(([v, s]: any, i) => <select key={i} data-cmp={i} value={v} onChange={(e) => s(e.target.value)}><option value="">—</option>{sorted.map((r) => <option key={r.id} value={r.id}>{r.data?.number} rev {r.data?.revision} ({r.status})</option>)}</select>)}
        <button className="btn sm" disabled={!cmpA || !cmpB} onClick={() => mfg.bomCompare(cmpA, cmpB).then(setCmp).catch((e) => setErr(e.message))}>{T(L("Compare", "Сравнить", "Порівняти", "قارن"))}</button></div>
      {cmp && <><small className="faint mono">{cmp.a?.number} rev {cmp.a?.revision} → rev {cmp.b?.revision} · {T(L("unchanged", "без изменений", "без змін", "دون تغيير"))}: {cmp.unchanged}</small>
        <Tbl rows={(["added", "removed", "quantity", "substituted", "moved", "alternates"] as const).flatMap((k) => (cmp[k] || []).map((r: any) => ({ ...r, kind: k })))} empty={L("No differences", "Отличий нет", "Відмінностей немає", "لا اختلافات")} cols={[["kind", L("Change", "Изменение", "Зміна", "التغيير"), (r) => <b data-change={r.kind}>{r.kind}</b>], ["item", W.item, (r) => <span className="mono">{r.item?.number || r.to_item?.number || r.number}</span>], ["from", L("From", "Было", "Було", "من"), (r) => (r.from == null ? (r.from_item?.number || "—") : typeof r.from === "object" ? r.from.number || JSON.stringify(r.from) : String(r.from))], ["to", L("To", "Стало", "Стало", "إلى"), (r) => (r.to == null ? (r.to_item?.number || "—") : typeof r.to === "object" ? r.to.number || JSON.stringify(r.to) : String(r.to))]]} />
        <small className="faint">{cmp.method}</small></>}
    </section>
  </>;
}

function BomEditor({ id, caps, onChanged }: { id: string; caps: any; onChanged: (id?: string) => void }) {
  const T = useT(); const [b, setB] = useState<any>(null); const [lines, setLines] = useState<any[]>([]); const [items, setItems] = useState<any[]>([]); const [err, setErr] = useState(""); const [why, setWhy] = useState("");
  useEffect(() => { mfg.bom(id).then((x) => { setB(x); setLines((x.lines || []).map((l: any) => ({ key: String(l.line), parent: l.parent ? String((x.lines || []).find((p: any) => p.id === l.parent)?.line || "") : "", item: l.item?.id, qty: l.qty, uom: l.uom || "ea", position: l.position || "", alt_group: l.alt_group || "", optional: !l.required, notes: l.notes || "" }))); }).catch((e) => setErr(e.message));
    mfg.records("technical.items", 1000).then(setItems).catch(() => {}); }, [id]);
  if (err && !b) return <Err e={err} />;
  if (!b) return <Wait />;
  const edit = b.can_edit && caps.bom_editor;
  const set = (i: number, k: string, v: any) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const out = () => lines.filter((l) => l.item).map((l) => ({ key: l.key, parent: l.parent || null, item: l.item, qty: Number(l.qty), uom: l.uom || null, position: l.position || null, alt_group: l.alt_group || null, optional: !!l.optional, notes: l.notes || null }));
  return <section className="card" data-bom-editor={id} style={{ padding: 12, display: "grid", gap: 10, minWidth: 0 }}>
    <h2 style={{ margin: 0 }}>{b.number} rev {b.revision} <StatusChip s={b.status} /></h2>
    <small className="muted">{b.config}{b.locked ? ` · ${T(L("locked", "заблокирована", "заблокована", "مقفلة"))}: ${b.locked}` : ""}{b.lines_hash ? ` · hash ${String(b.lines_hash).slice(0, 10)}` : ""}</small>
    <Err e={err} />
    <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>#</th><th>{T(L("Parent #", "Родитель #", "Батьківський #", "الأصل #"))}</th><th>{T(W.item)}</th><th>{T(W.qty)}</th><th>UoM</th><th>{T(L("Position", "Позиция", "Позиція", "الموضع"))}</th><th>{T(L("Alt group", "Группа замен", "Група замін", "مجموعة بديلة"))}</th><th>{T(L("Optional", "Необязательно", "Необов'язково", "اختياري"))}</th>{edit && <th />}</tr></thead>
      <tbody>{lines.map((l, i) => <tr key={i} data-bom-line={l.key}>
        <td><input disabled={!edit} style={{ width: 50 }} value={l.key} onChange={(e) => set(i, "key", e.target.value)} /></td>
        <td><input disabled={!edit} style={{ width: 50 }} value={l.parent} onChange={(e) => set(i, "parent", e.target.value)} /></td>
        <td><select disabled={!edit} data-line-item value={l.item || ""} onChange={(e) => set(i, "item", e.target.value)} style={{ maxWidth: 260 }}><option value="">—</option>{items.filter((x) => x.status !== "Obsolete" || x.id === l.item).map((x) => <option key={x.id} value={x.id}>{x.data?.number} · {x.title}</option>)}</select></td>
        <td><input disabled={!edit} inputMode="decimal" data-line-qty style={{ width: 70 }} value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} /></td>
        <td><input disabled={!edit} style={{ width: 55 }} value={l.uom} onChange={(e) => set(i, "uom", e.target.value)} /></td>
        <td><input disabled={!edit} style={{ width: 100 }} value={l.position} onChange={(e) => set(i, "position", e.target.value)} /></td>
        <td><input disabled={!edit} style={{ width: 70 }} value={l.alt_group} onChange={(e) => set(i, "alt_group", e.target.value)} /></td>
        <td><input disabled={!edit} type="checkbox" checked={!!l.optional} onChange={(e) => set(i, "optional", e.target.checked)} /></td>
        {edit && <td><button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="remove">✕</button></td>}</tr>)}</tbody></table></div>
    {edit && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn ghost sm" data-line-add onClick={() => setLines([...lines, { key: String(Math.max(0, ...lines.map((l) => Number(l.key) || 0)) + 1), parent: "", item: "", qty: 1, uom: "ea", position: "", alt_group: "", optional: false, notes: "" }])}>+ {T(L("Line", "Строка", "Рядок", "سطر"))}</button>
      <Act data="bom-save" label={W.save} what={T(L("{n} line(s). The database checks cycles, parents and items.", "{n} строк(и). База проверяет циклы, родителей и позиции.", "{n} рядк(ів). База перевіряє цикли, батьків і позиції.", "{n} سطر."), { n: out().length })} run={() => mfg.bomSave(id, out())} done={() => onChanged(id)} />
      <Act data="bom-submit" label={L("Submit for approval", "Отправить на утверждение", "Надіслати на затвердження", "إرسال للاعتماد")} what={L("The approval is for this exact revision and its line hash; any later edit needs a new revision.", "Утверждается именно эта ревизия и её хэш строк; любое изменение потом — только новой ревизией.", "Затверджується саме ця ревізія та її хеш рядків; будь-яка зміна потім — лише новою ревізією.", "يُعتمد هذا الإصدار بالضبط.")} run={() => mfg.submit(id)} done={() => onChanged(id)} />
    </div>}
    {!edit && caps.bom_editor && ["Approved", "Released"].includes(b.status) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label className="fld" style={{ flex: 1, minWidth: 200 }}><span>{T(W.reason)}</span><input data-newrev-reason value={why} onChange={(e) => setWhy(e.target.value)} /></label>
      {why.trim().length > 3 && <Act data="bom-new-revision" label={L("New revision", "Новая ревизия", "Нова ревізія", "مراجعة جديدة")} what={L("Copies this approved revision into a new draft. The approved one never changes.", "Копирует утверждённую ревизию в новый черновик. Утверждённая не меняется.", "Копіює затверджену ревізію в нову чернетку. Затверджена не змінюється.", "ينسخ المراجعة المعتمدة إلى مسودة جديدة.")} run={() => mfg.newVersion(id, why.trim())} done={(r) => onChanged(r?.id)} />}
    </div>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn ghost sm" onClick={async () => { try { const x = await mfg.export("bom", id); saveBlob(`${b.number}-rev${b.revision}.csv`, toCsv(x.rows.map((r: any) => ({ line: r.line, level: r.level, item: r.item?.number, title: r.item?.title, qty: r.qty, uom: r.uom, position: r.position, alt_group: r.alt_group, required: r.required }))), "text/csv"); } catch (e: any) { setErr(e.message); } }}><Icon n="download" />CSV</button>
      <Link className="btn ghost sm" href={`/technical/boms?r=${id}`}><Icon n="ext" />{T(L("Record, approval and discussion", "Запись, согласование и обсуждение", "Запис, погодження та обговорення", "السجل والاعتماد"))}</Link></div>
  </section>;
}

/* ------------------------------------------------ materials plan (B23) ------------------------------------------------ */
function Materials({ onOpen }: { onOpen: (id: string) => void }) {
  const T = useT(); const [p, setP] = useState<any>(null); const [err, setErr] = useState(""); const [only, setOnly] = useState(true);
  useEffect(() => { mfg.plan({}).then(setP).catch((e) => setErr(e.message)); }, []);
  if (err && !p) return <Err e={err} />;
  if (!p) return <Wait />;
  const rows = (p.rows || []).filter((r: any) => !only || Number(r.shortage) > 0);
  return <>
    <section className="card" style={{ padding: 12, display: "grid", gap: 6 }} data-plan-summary>
      <small className="mono">{Object.entries(p.summary || {}).map(([k, x]) => `${k}: ${x}`).join(" · ")}</small><small className="faint">{p.rule}</small>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />{T(L("Only shortages", "Только нехватки", "Лише нестачі", "النواقص فقط"))}</label>
      <button className="btn ghost sm" style={{ justifySelf: "start" }} onClick={async () => { try { const x = await mfg.export("shortages"); saveBlob("shortages.csv", toCsv(x.rows), "text/csv"); } catch (e: any) { setErr(e.message); } }}><Icon n="download" />CSV</button></section>
    <Err e={err} />
    <section className="card" data-plan><Tbl rows={rows} cols={[["unit_number", L("Unit", "Изделие", "Виріб", "الوحدة"), (r) => <button className="btn ghost sm mono" onClick={() => onOpen(r.unit)}>{r.unit_number}</button>], ["item_number", W.item, (r) => <><span className="mono">{r.item_number}</span> {r.item_title}</>], ["required", L("Required", "Нужно", "Потрібно", "مطلوب"), (r) => qty(r.required)], ["allocated", L("Allocated", "В резерве", "У резерві", "مخصص"), (r) => qty(r.allocated)], ["ordered", L("Ordered", "Заказано", "Замовлено", "مطلوب"), (r) => qty(r.ordered)], ["shortage", L("Shortage", "Нехватка", "Нестача", "نقص"), (r) => <b className={Number(r.shortage) > 0 ? "neg" : ""}>{qty(r.shortage)}</b>], ["late", L("Late", "Опаздывает", "Запізнюється", "متأخر"), (r) => (r.late ? "⚠" : "")]]} /></section>
    <small className="faint">{T(L("A shortage never creates an order by itself: open the unit's Materials tab to raise a purchase request, which goes through the normal approval.", "Нехватка сама не создаёт заказ: в разделе «Материалы» изделия создайте заявку — она проходит обычное согласование.", "Нестача сама не створює замовлення: у розділі «Матеріали» виробу створіть заявку — вона проходить звичайне погодження.", "النقص لا ينشئ أمر شراء تلقائيًا."))}</small>
  </>;
}

/* ------------------------------------------------ inventory (B26–B31) ------------------------------------------------ */
function Inventory({ caps, item, serial }: { caps: any; item?: string | null; serial?: string | null }) {
  const T = useT(); const [q, setQ] = useState(""); const [state, setState] = useState(""); const [rows, setRows] = useState<any[] | null>(null); const [locs, setLocs] = useState<any[]>([]); const [val, setVal] = useState<any>(null); const [err, setErr] = useState(""); const [tick, setTick] = useState(0);
  const [sq, setSq] = useState(""); const [ser, setSer] = useState<any[] | null>(null); const [one, setOne] = useState<any>(null); const [it, setIt] = useState<any>(null);
  useEffect(() => { const t = setTimeout(() => mfg.inventory(q || null, null, null, state || null).then(setRows).catch((e) => { setErr(e.message); setRows([]); }), q ? 250 : 0); return () => clearTimeout(t); }, [q, state, tick]);
  useEffect(() => { mfg.locations().then(setLocs).catch(() => {}); mfg.value().then(setVal).catch(() => setVal(null)); if (item) mfg.itemStock(item).then(setIt).catch((e) => setErr(e.message)); if (serial) mfg.serial(serial).then(setOne).catch((e) => setErr(e.message)); }, [tick, item, serial]);
  return <>
    <Err e={err} />
    {it && <section className="card" style={{ padding: 12 }} data-item-stock><b className="mono">{it.item?.number}</b> {it.item?.title} · {it.item?.type}{it.item?.serialized ? " · ⓢ" : ""}<Tbl rows={it.stock} cols={[["location", W.location], ["state", W.state], ["qty", W.qty, (r) => qty(r.qty)]]} /></section>}
    {one && <section className="card" style={{ padding: 12 }} data-serial-view><b className="mono">{one.serial}</b> · {one.item?.number} {one.item?.title} · {one.state} · {one.location || "—"}
      <Tbl rows={one.installs} cols={[["unit", L("Unit", "Изделие", "Виріб", "الوحدة")], ["installed_at", L("Installed", "Установлен", "Встановлено", "ثُبّت"), (r) => when(r.installed_at)], ["removed_at", L("Removed", "Снят", "Знято", "أزيل"), (r) => when(r.removed_at)]]} empty={L("Never installed", "Не устанавливался", "Не встановлювався", "لم يُثبت")} />
      <Tbl rows={one.ledger} cols={[["at", L("When", "Когда", "Коли", "متى"), (r) => when(r.at)], ["kind", L("What", "Что", "Що", "ماذا")], ["to_state", W.state], ["by", L("By", "Кто", "Хто", "بواسطة")], ["reason", W.reason]]} /></section>}
    <section className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <input data-inv-q style={{ flex: 1, minWidth: 160 }} placeholder={T(L("Item number, title, MPN or location", "Номер, название, MPN или место", "Номер, назва, MPN або місце", "رقم الصنف أو الاسم"))} value={q} onChange={(e) => setQ(e.target.value)} />
      <select data-inv-state value={state} onChange={(e) => setState(e.target.value)}><option value="">{T(W.state)}: —</option>{["Available", "Allocated", "Quarantine", "Inspection", "Rejected"].map((s) => <option key={s}>{s}</option>)}</select>
      {rows && <button className="btn ghost sm" onClick={() => saveBlob("inventory.csv", toCsv(rows), "text/csv")}><Icon n="download" />CSV</button>}</section>
    <section className="card" data-inventory><Tbl rows={rows} cols={[["item_number", W.item, (r) => <Link className="mono" href={`/mfg?tab=inventory&item=${r.item}`}>{r.item_number}</Link>], ["item_title", ""], ["location", W.location], ["state", W.state, (r) => <StatusChip s={r.state} />], ["qty", W.qty, (r) => `${qty(r.qty)} ${r.uom || ""}`], ["lot", W.lot], ["value", L("Reference value", "Справочная стоимость", "Довідкова вартість", "القيمة المرجعية"), (r) => (r.value == null ? "" : money(r.value, r.currency))]]} /></section>
    {caps.inventory_manager && <StockActions locs={locs} onDone={() => setTick((t) => t + 1)} />}
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-serials><b>{T(L("Find a serial number", "Найти серийный номер", "Знайти серійний номер", "ابحث عن رقم تسلسلي"))}</b>
      <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); mfg.serials(sq).then(setSer).catch((x) => setErr(x.message)); }}><input data-serial-q style={{ flex: 1, minWidth: 0 }} value={sq} onChange={(e) => setSq(e.target.value)} /><button className="btn sm"><Icon n="search" /></button></form>
      {ser && <Tbl rows={ser} cols={[["serial", W.serial, (r) => <Link className="mono" href={`/mfg?tab=inventory&serial=${r.id}`}>{r.serial}</Link>], ["item_number", W.item], ["state", W.state], ["location", W.location], ["unit", L("Installed in", "Установлен в", "Встановлено в", "مثبت في")]]} />}</section>
    <section className="card" style={{ padding: 12 }} data-locations><b>{T(L("Locations", "Места хранения", "Місця зберігання", "المواقع"))}</b><Tbl rows={locs} cols={[["path", L("Path", "Путь", "Шлях", "المسار")], ["name", L("Name", "Название", "Назва", "الاسم")], ["kind", L("Kind", "Вид", "Вид", "النوع")], ["purpose", L("Purpose", "Назначение", "Призначення", "الغرض")], ["lines", L("Stock lines", "Строк остатков", "Рядків залишків", "أسطر المخزون")]]} />
      {caps.inventory_manager && <LocationNew locs={locs} onDone={() => setTick((t) => t + 1)} />}</section>
    {val && <section className="card" style={{ padding: 12 }} data-inv-value><b>{val.label}</b><Tbl rows={val.by_currency} cols={[["currency", L("Currency", "Валюта", "Валюта", "العملة")], ["reference_value", L("Reference value", "Справочная стоимость", "Довідкова вартість", "القيمة المرجعية"), (r) => money(r.reference_value)], ["purchase_value", L("At purchase price", "По цене закупки", "За ціною закупівлі", "بسعر الشراء"), (r) => money(r.purchase_value)], ["quantity", W.qty, (r) => qty(r.quantity)], ["items_without_reference_cost", L("Items without cost", "Позиций без цены", "Позицій без ціни", "أصناف بلا تكلفة")]]} /></section>}
  </>;
}

function StockActions({ locs, onDone }: { locs: any[]; onDone: () => void }) {
  const T = useT(); const [items, setItems] = useState<any[]>([]); const [mode, setMode] = useState("adjust"); const [f, setF] = useState<any>({ item: "", location: "", to: "", state: "Available", to_state: "Quarantine", qty: "", reason: "" });
  useEffect(() => { mfg.records("technical.items", 1000).then(setItems).catch(() => {}); }, []);
  const ready = f.item && f.location && f.qty !== "" && (mode !== "move" || f.to) && f.reason.trim().length > 2;
  return <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-stock-actions>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{[["adjust", L("Count / opening balance", "Подсчёт / начальный остаток", "Підрахунок / початковий залишок", "جرد / رصيد افتتاحي")], ["move", L("Move", "Переместить", "Перемістити", "نقل")], ["state", L("Change state", "Сменить состояние", "Змінити стан", "تغيير الحالة")]].map(([k, l]: any) => <button key={k} className={`btn sm ${mode === k ? "" : "ghost"}`} data-stock-mode={k} onClick={() => setMode(k)}>{T(l)}</button>)}</div>
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      <label className="fld"><span>{T(W.item)}</span><select data-stock-item value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}><option value="">—</option>{items.map((x) => <option key={x.id} value={x.id}>{x.data?.number} · {x.title}</option>)}</select></label>
      <label className="fld"><span>{T(W.location)}</span><select data-stock-location value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}><option value="">—</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>
      {mode === "move" && <label className="fld"><span>{T(L("To", "Куда", "Куди", "إلى"))}</span><select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">—</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>}
      <label className="fld"><span>{T(W.state)}</span><select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>{["Available", "Quarantine", "Inspection", "Rejected"].map((s) => <option key={s}>{s}</option>)}</select></label>
      {mode === "state" && <label className="fld"><span>{T(L("New state", "Новое состояние", "Новий стан", "الحالة الجديدة"))}</span><select value={f.to_state} onChange={(e) => setF({ ...f, to_state: e.target.value })}>{["Available", "Quarantine", "Inspection", "Rejected"].map((s) => <option key={s}>{s}</option>)}</select></label>}
      <label className="fld"><span>{mode === "adjust" ? T(L("Counted quantity", "Посчитано", "Пораховано", "الكمية المعدودة")) : T(W.qty)}</span><input inputMode="decimal" data-stock-qty value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
      <label className="fld"><span>{T(W.reason)} *</span><input data-stock-reason value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
    </div>
    {ready && <Act data={`stock-${mode}`} label={W.confirm} what={T(L("Every change is a ledger line with your name and reason; stock never goes below zero.", "Каждое изменение — строка журнала с вашим именем и причиной; остаток не уходит ниже нуля.", "Кожна зміна — рядок журналу з вашим ім'ям і причиною; залишок не йде нижче нуля.", "كل تغيير يُسجل باسمك وسببك."))}
      run={() => mode === "adjust" ? mfg.adjust(f.item, f.location, f.state, Number(f.qty), f.reason.trim()) : mode === "move" ? mfg.move(f.item, f.location, f.to, Number(f.qty), null, null, f.state) : mfg.setState(f.item, f.location, f.state, f.to_state, Number(f.qty), null, null, f.reason.trim())}
      done={() => { setF({ ...f, qty: "", reason: "" }); onDone(); }} />}
  </section>;
}

function LocationNew({ locs, onDone }: { locs: any[]; onDone: () => void }) {
  const T = useT(); const [f, setF] = useState({ code: "", name: "", kind: "Shelf", parent: "", purpose: "Storage" });
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 8 }}>
    <input placeholder={T(L("Code", "Код", "Код", "الرمز"))} data-loc-code style={{ width: 100 }} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
    <input placeholder={T(L("Name", "Название", "Назва", "الاسم"))} style={{ flex: 1, minWidth: 120 }} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
    <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["Facility", "Area", "Room", "Rack", "Shelf", "Bin"].map((k) => <option key={k}>{k}</option>)}</select>
    <select value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}><option value="">{T(L("Parent", "Родитель", "Батьківське", "الأصل"))}: —</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
    {f.code.length > 1 && f.name.length > 1 && <Act data="loc-save" label={L("Add location", "Добавить место", "Додати місце", "إضافة موقع")} what={`${f.code} · ${f.name}`} run={() => mfg.locationSave({ ...f, parent: f.parent || null })} done={() => { setF({ ...f, code: "", name: "" }); onDone(); }} />}
  </div>;
}

/* ------------------------------------------------ quality ------------------------------------------------ */
function Quality({ caps, onOpen, insp }: { caps: any; onOpen: (id: string) => void; insp?: string | null }) {
  const T = useT(); const [due, setDue] = useState<any[] | null>(null); const [nc, setNc] = useState<any[] | null>(null); const [tick, setTick] = useState(0); const [sel, setSel] = useState<string | null>(insp || null);
  useEffect(() => { mfg.list("inspections_required").then(setDue).catch(() => setDue([])); mfg.list("nonconformances").then(setNc).catch(() => setNc([])); }, [tick]);
  return <>
    <section className="card" data-insp-due><div className="card-h"><h2><Icon n="shield" />{T(L("Inspections due", "Инспекции к проведению", "Інспекції до проведення", "فحوص مستحقة"))}</h2></div>
      <div className="feed">{!due ? <div className="empty">…</div> : due.length ? due.map((r) => <button key={r.id} className="row" data-insp={r.id} style={{ width: "100%", textAlign: "start", background: "none", border: 0, padding: 0 }} onClick={() => setSel(r.id)}><RecRow r={r} /></button>) : <div className="empty" style={{ padding: 12 }}>{T(W.none)}</div>}</div></section>
    {sel && <InspectionRecord id={sel} caps={caps} onDone={() => { setSel(null); setTick((t) => t + 1); }} />}
    <section className="card" data-nc-list><div className="card-h"><h2><Icon n="alert" />{T(L("Open nonconformances", "Открытые несоответствия", "Відкриті невідповідності", "حالات عدم مطابقة مفتوحة"))}</h2></div>
      <div className="feed">{!nc ? <div className="empty">…</div> : nc.length ? nc.map((r) => <div key={r.id}><RecRow r={r} />{r.unit_id && <button className="btn ghost sm" style={{ margin: "0 12px 8px" }} onClick={() => onOpen(r.unit_id)}>{T(W.open)} {r.unit}</button>}</div>) : <div className="empty" style={{ padding: 12 }}>{T(W.none)}</div>}</div></section>
  </>;
}

function InspectionRecord({ id, caps, onDone }: { id: string; caps: any; onDone: () => void }) {
  const T = useT(); const [r, setR] = useState<any>(null); const [res, setRes] = useState(""); const [notes, setNotes] = useState(""); const [chk, setChk] = useState<Record<string, boolean>>({}); const [qf, setQf] = useState(""); const [sev, setSev] = useState("Medium");
  useEffect(() => { mfg.record(id).then(setR).catch(() => setR(false)); }, [id]);
  if (r === null) return <Wait />;
  if (!r) return <Err e={T(W.noAccess)} />;
  const d = r.data || {}; const recorded = !!d.result;
  return <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-insp-record={id}>
    <b>{d.number} · {r.title} <StatusChip s={d.result || r.status} /></b>
    <small className="muted">{[d.inspection_kind, d.build_ref_title, d.item_ref_title, d.qty != null && `${T(W.qty)} ${qty(d.qty)}`].filter(Boolean).join(" · ")}</small>
    {d.instructions && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.instructions}</p>}
    {recorded ? <small>{d.result} · {d.inspector || ""} · {day(d.date)} · {d.notes || ""}</small> : caps.quality_inspector ? <>
      {(d.checklist || []).map((c: any) => <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" data-insp-check={c.key} checked={!!chk[c.key]} onChange={(e) => setChk({ ...chk, [c.key]: e.target.checked })} />{c.text}</label>)}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <label className="fld"><span>{T(L("Result", "Результат", "Результат", "النتيجة"))}</span><select data-insp-result value={res} onChange={(e) => setRes(e.target.value)}><option value="">—</option>{["Pass", "Fail", "Conditional", "Not Applicable"].map((x) => <option key={x}>{x}</option>)}</select></label>
        {res === "Fail" && <label className="fld"><span>{T(L("Quantity failed", "Не прошло", "Не пройшло", "الكمية الفاشلة"))}</span><input inputMode="decimal" value={qf} onChange={(e) => setQf(e.target.value)} /></label>}
        {res === "Fail" && <label className="fld"><span>{T(L("Severity", "Серьёзность", "Серйозність", "الخطورة"))}</span><select value={sev} onChange={(e) => setSev(e.target.value)}>{["Low", "Medium", "High", "Critical"].map((x) => <option key={x}>{x}</option>)}</select></label>}
      </div>
      <label className="fld"><span>{T(L("What was found", "Что обнаружено", "Що виявлено", "ما وُجد"))}</span><textarea rows={2} data-insp-notes value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {res && <Act data="insp-save" label={L("Record the result", "Записать результат", "Записати результат", "تسجيل النتيجة")} what={`${d.number}: ${res}${res === "Fail" ? " → " + T(L("a nonconformance issue is opened", "открывается несоответствие", "відкривається невідповідність", "تُفتح حالة عدم مطابقة")) : ""}`}
        run={() => mfg.inspectionRecord(id, { result: res, notes: notes || null, checklist: Object.entries(chk).map(([key, ok]) => ({ key, ok })), ...(res === "Fail" ? { qty_fail: qf ? Number(qf) : null, severity: sev } : {}) })} done={onDone} />}
    </> : <small className="faint">{T(L("Recording needs the Quality Inspector capability.", "Запись требует права «Инспектор качества».", "Запис потребує права «Інспектор якості».", "التسجيل يتطلب صلاحية مفتش الجودة."))}</small>}
  </section>;
}

/* ------------------------------------------------ tests ------------------------------------------------ */
function Tests({ onOpen }: { onOpen: (id: string) => void }) {
  const T = useT(); const [failed, setFailed] = useState<any[] | null>(null); const [procs, setProcs] = useState<any[] | null>(null);
  useEffect(() => { mfg.list("failed_tests").then(setFailed).catch(() => setFailed([])); mfg.records("technical.test_procedures").then(setProcs).catch(() => setProcs([])); }, []);
  return <>
    <section className="card" data-failed-tests><div className="card-h"><h2><Icon n="flask" />{T(L("Failed tests", "Проваленные испытания", "Провалені випробування", "اختبارات فاشلة"))}</h2></div>
      <div className="feed">{!failed ? <div className="empty">…</div> : failed.length ? failed.map((r) => <div key={r.id}><RecRow r={r} />{r.unit_id && <button className="btn ghost sm" style={{ margin: "0 12px 8px" }} onClick={() => onOpen(r.unit_id)}>{T(W.open)} {r.unit}</button>}</div>) : <div className="empty" style={{ padding: 12 }}>{T(W.none)}</div>}</div></section>
    <section className="card" data-procedures><div className="card-h"><h2><Icon n="clipboard" />{T(L("Test procedures", "Методики испытаний", "Методики випробувань", "إجراءات الاختبار"))}</h2><Link className="btn ghost sm" style={{ marginInlineStart: "auto" }} href="/technical/test_procedures">{T(W.open)}</Link></div>
      <Tbl rows={procs} cols={[["code", L("Code", "Код", "Код", "الرمز"), (r) => <span className="mono">{r.data?.code}</span>], ["version", "v", (r) => r.data?.version], ["title", L("Title", "Название", "Назва", "العنوان")], ["status", W.status, (r) => <StatusChip s={r.status} />], ["fields", L("Fields", "Поля", "Поля", "الحقول"), (r) => (r.data?.fields || []).length]]} /></section>
    <small className="faint">{T(L("Pass or fail is the operator's recorded decision, checked against the procedure's limits; it is never inferred from missing failures, and a passing run still needs a Test Approver.", "«Пройдено» или «не пройдено» — записанное решение оператора, проверенное по пределам методики; оно не выводится из отсутствия ошибок, и успешный прогон утверждает отдельный утверждающий.", "«Пройдено» чи «не пройдено» — записане рішення оператора, перевірене за межами методики; воно не виводиться з відсутності помилок, і успішний прогін затверджує окремий затверджувач.", "النتيجة قرار المشغل المسجل."))}</small>
  </>;
}

/* ------------------------------------------------ engineering changes, alternates (B42–B46, B12) ------------------------------------------------ */
function Changes({ caps, onOpen }: { caps: any; onOpen: (id: string) => void }) {
  const T = useT(); const [ecrs, setEcrs] = useState<any[] | null>(null); const [sel, setSel] = useState(""); const [cand, setCand] = useState<any>(null); const [pick, setPick] = useState<Record<string, boolean>>({}); const [imp, setImp] = useState<any>(null); const [alts, setAlts] = useState<any[] | null>(null); const [err, setErr] = useState(""); const [tick, setTick] = useState(0);
  useEffect(() => { mfg.records("technical.changes").then(setEcrs).catch(() => setEcrs([])); mfg.alternates().then(setAlts).catch(() => setAlts([])); }, [tick]);
  useEffect(() => { if (!sel) return; setCand(null); setImp(null); mfg.ecrCandidates(sel).then((c) => { setCand(c); setPick({}); }).catch((e) => setErr(e.message)); mfg.impact(sel).then(setImp).catch(() => {}); }, [sel, tick]);
  const objs = cand ? (["bom", "item", "unit", "document", "test_procedure", "configuration"] as const).flatMap((k) => (cand[k] || []).map((o: any) => ({ kind: k, ...o }))) : [];
  return <>
    <Err e={err} />
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-ecr>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label className="fld" style={{ flex: 1, minWidth: 220 }}><span>{T(L("Engineering change (ECR)", "Инженерное изменение (ECR)", "Інженерна зміна (ECR)", "طلب تغيير هندسي"))}</span><select data-ecr-pick value={sel} onChange={(e) => setSel(e.target.value)}><option value="">—</option>{(ecrs || []).map((r) => <option key={r.id} value={r.id}>{r.data?.number} · {r.title} ({r.status})</option>)}</select></label>
        <Link className="btn ghost sm" href="/ops?new=change"><Icon n="git" />{T(L("New change request", "Новый запрос на изменение", "Новий запит на зміну", "طلب تغيير جديد"))}</Link></div>
      {cand && <><small className="faint">{cand.note}</small>
        {objs.map((o) => <label key={o.kind + o.id} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" data-ecr-obj={o.kind} checked={!!pick[o.kind + ":" + o.id]} onChange={(e) => setPick({ ...pick, [o.kind + ":" + o.id]: e.target.checked })} /><span className="chip">{o.kind}</span><span style={{ overflowWrap: "anywhere" }}>{o.title}</span>{o.status ? <StatusChip s={o.status} /> : null}</label>)}
        {Object.values(pick).some(Boolean) && <Act data="ecr-confirm" label={L("Confirm affected objects", "Подтвердить затронутые объекты", "Підтвердити зачеплені об'єкти", "تأكيد العناصر المتأثرة")} what={T(L("{n} object(s). Suggestions are never applied without this confirmation.", "{n} объект(ов). Предложения не применяются без этого подтверждения.", "{n} об'єкт(ів). Пропозиції не застосовуються без цього підтвердження.", "{n} عنصر."), { n: Object.values(pick).filter(Boolean).length })} disabled={!caps.engineering_change_approver && !caps.bom_editor}
          run={() => mfg.ecrConfirm(sel, Object.entries(pick).filter(([, x]) => x).map(([k]) => { const [kind, id] = k.split(":"); return { kind, id }; }))} done={() => setTick((t) => t + 1)} />}</>}
      {imp && <section data-impact style={{ display: "grid", gap: 6 }}><b>{T(L("Change impact", "Влияние изменения", "Вплив зміни", "أثر التغيير"))} · {imp.ecr?.number}</b>
        {(imp.affected_builds || []).length ? <Tbl rows={imp.affected_builds} cols={[["number", L("Unit", "Изделие", "Виріб", "الوحدة"), (r) => <button className="btn ghost sm mono" onClick={() => onOpen(r.unit)}>{r.number}</button>], ["status", W.status, (r) => <StatusChip s={r.status} />], ["pinned", L("Pinned revision", "Закреплённая ревизия", "Закріплена ревізія", "المراجعة المثبتة")], ["state", L("Effect", "Эффект", "Ефект", "الأثر")]]} /> : null}
        {imp.asbuilt_impact ? <small>{imp.asbuilt_impact}</small> : null}
        {(imp.revisions || []).length ? <small>{T(L("Revisions", "Ревизии", "Ревізії", "المراجعات"))}: {imp.revisions.map((x: any) => `${x.number} rev ${x.revision} (${x.status})`).join(", ")}</small> : null}
        {(imp.inventory || []).length ? <small>{T(L("Inventory affected", "Затронутые остатки", "Зачеплені залишки", "المخزون المتأثر"))}: {imp.inventory.map((x: any) => `${x.number || x.item} ${qty(x.qty)}`).join(", ")}</small> : null}
        {(imp.documents || []).length ? <small>{T(L("Documents", "Документы", "Документи", "المستندات"))}: {imp.documents.map((x: any) => x.title).join(", ")}</small> : null}
        <small className="faint">{T(L("Completed units keep their configuration; nothing is retrofitted automatically.", "Завершённые изделия сохраняют конфигурацию; автоматической доработки нет.", "Завершені вироби зберігають конфігурацію; автоматичного доопрацювання немає.", "تحتفظ الوحدات المكتملة بتهيئتها."))}</small></section>}
    </section>
    <section className="card" data-alternates><div className="card-h"><h2><Icon n="dup" />{T(L("Alternates and substitutions", "Замены и аналоги", "Заміни та аналоги", "البدائل"))}</h2></div>
      <Tbl rows={alts} cols={[["item", W.item, (r) => <span className="mono">{r.item?.number}</span>], ["substitute", L("Substitute", "Замена", "Заміна", "البديل"), (r) => <span className="mono">{r.substitute?.number}</span>], ["scope", L("Scope", "Область", "Область", "النطاق")], ["reason", W.reason], ["status", W.status, (r) => <StatusChip s={r.status} />], ["decided_by", L("Decided by", "Решил", "Вирішив", "قرره")],
        ["act", "", (r) => r.status === "Proposed" && (caps.engineering_change_approver || caps.bom_approver) ? <span style={{ display: "flex", gap: 6 }}><Act data="alt-approve" label={L("Approve", "Утвердить", "Затвердити", "اعتماد")} what={`${r.item?.number} → ${r.substitute?.number}`} reason="optional" run={(why) => mfg.altDecide(r.id, "Approved", why || null)} done={() => setTick((t) => t + 1)} /><Act data="alt-reject" danger label={L("Reject", "Отклонить", "Відхилити", "رفض")} what={`${r.item?.number} → ${r.substitute?.number}`} reason="required" run={(why) => mfg.altDecide(r.id, "Rejected", why)} done={() => setTick((t) => t + 1)} /></span> : null]]} />
      <small className="faint" style={{ display: "block", padding: "0 12px 10px" }}>{T(L("Procurement may propose a substitute; only an engineering authority (BOM Approver or Engineering Change Approver) approves it.", "Закупки могут предложить замену; утверждает только инженерный уполномоченный (утверждающий спецификации или изменений).", "Закупівлі можуть запропонувати заміну; затверджує лише інженерний уповноважений.", "يمكن للمشتريات اقتراح بديل؛ يعتمده المهندس المخول فقط."))}</small></section>
  </>;
}

/* ------------------------------------------------ weekly review (B61): twelve parts, each line names its record ------------------------------------------------ */
function Review({ onOpen }: { onOpen: (id: string) => void }) {
  const T = useT(); const { lang } = useApp(); const [w, setW] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => { mfg.weekly().then(setW).catch((e) => setErr(e.message)); }, []);
  if (err && !w) return <Err e={err} />;
  if (!w) return <Wait />;
  const parts = mfgWeeklyParts(w, lang);
  return <>
    <small className="muted" data-review-period>{w.from} → {w.to}</small>
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      {parts.map((s, i) => <section key={s.key} className="card" style={{ padding: 12, minWidth: 0 }} data-review-part={s.key}><b>{i + 1}. {s.title}</b>
        <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>{s.lines.map((l, k) => <li key={k} style={{ overflowWrap: "anywhere" }}>{l.link?.startsWith("/mfg?unit=") ? <button className="btn ghost sm" style={{ padding: 0, textAlign: "start" }} onClick={() => onOpen(l.link!.slice(10))}>{l.text}</button> : l.link ? <Link href={l.link}>{l.text}</Link> : l.text}</li>)}</ul></section>)}
    </div>
    <small className="faint">{T(L("Costs are operational build costs, not accounting cost; acceptance is internal, not certification.", "Затраты — операционные, не бухгалтерские; приёмка — внутренняя, не сертификация.", "Витрати — операційні, не бухгалтерські; приймання — внутрішнє, не сертифікація.", "التكاليف تشغيلية وليست محاسبية."))}</small>
  </>;
}

/* ------------------------------------------------ labels, QR, import / export (B58, B60, B65) ------------------------------------------------ */
function Labels({ caps }: { caps: any }) {
  const T = useT(); const [code, setCode] = useState(""); const [labels, setLabels] = useState<any[]>([]); const [err, setErr] = useState("");
  const [kind, setKind] = useState("items"); const [csv, setCsv] = useState<any[] | null>(null); const [pv, setPv] = useState<any>(null); const [file, setFile] = useState("");
  const add = async () => { setErr(""); try { const r = await mfg.resolve(code.trim()); if (!r?.found) { setErr(T(L("Nothing you can open matches this code", "По этому коду нет записей, доступных вам", "За цим кодом немає записів, доступних вам", "لا يوجد ما يمكنك فتحه"))); return; }
    const k = ({ build: "unit", unit: "unit", work_order: "work_order", item: "item", serial: "serial", location: "location", lot: "lot" } as any)[r.kind] || r.kind; setLabels([...labels, await mfg.label(k, r.id)]); setCode(""); } catch (e: any) { setErr(e.message); } };
  return <>
    <Err e={err} />
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-labels><b>{T(L("Labels", "Этикетки", "Етикетки", "الملصقات"))}</b>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); add(); }}><input data-label-code style={{ flex: 1, minWidth: 160 }} placeholder={T(L("Unit, item, work order, serial or LOC:CODE", "Изделие, позиция, наряд, серийный № или LOC:КОД", "Виріб, позиція, наряд, серійний № або LOC:КОД", "وحدة أو صنف أو رقم تسلسلي"))} value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn sm"><Icon n="tag" />{T(L("Add label", "Добавить", "Додати", "إضافة"))}</button></form>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{labels.map((l, i) => <LabelCard key={i} l={l} />)}</div>
      {labels.length ? <div style={{ display: "flex", gap: 8 }}><button className="btn sm" data-labels-print onClick={() => printLabels(labels)}><Icon n="print" />{T(W.print)}</button><button className="btn ghost sm" onClick={() => setLabels([])}>{T(W.cancel)}</button></div> : null}
      <small className="faint">{T(L("A code opens a record only for people who may see it; it carries no data itself. These are internal labels, not regulatory or certification marks.", "Код открывает запись только тем, кому она доступна; данных в нём нет. Это внутренние этикетки, не регуляторные и не сертификационные знаки.", "Код відкриває запис лише тим, кому він доступний; даних у ньому немає. Це внутрішні етикетки, не регуляторні й не сертифікаційні знаки.", "الرمز لا يحمل بيانات. ملصقات داخلية."))}</small></section>
    {(caps.inventory_manager || caps.bom_editor || caps.manufacturing_admin) && <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-import><b>{T(L("Import (preview first)", "Импорт (сначала просмотр)", "Імпорт (спершу перегляд)", "استيراد (معاينة أولًا)"))}</b>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select data-import-kind value={kind} onChange={(e) => { setKind(e.target.value); setPv(null); }}>{["items", "inventory", "supplier_parts"].map((k) => <option key={k}>{k}</option>)}</select>
        <input type="file" accept=".csv,text/csv" data-import-file onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f.name); setPv(null); try { setCsv(parseCsv(await f.text())); } catch (x: any) { setErr(x.message); } }} />
        {csv && <button className="btn sm" data-import-preview onClick={() => mfg.importPreview(kind, csv).then(setPv).catch((x) => setErr(x.message))}>{T(L("Preview", "Просмотр", "Перегляд", "معاينة"))} ({csv.length})</button>}</div>
      {pv && <><small className="mono" data-import-summary>{Object.entries(pv.summary || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}</small>
        <Tbl rows={(pv.rows || []).slice(0, 200)} cols={[["row", "#"], ["status", W.status], ["message", L("Check", "Проверка", "Перевірка", "التحقق"), (r) => (r.errors || []).join("; ") || r.message || r.match || ""]]} />
        <Act data="import-commit" label={L("Import the valid rows", "Импортировать корректные строки", "Імпортувати коректні рядки", "استيراد الصفوف الصالحة")} what={T(L("Rows with errors are skipped; the batch can be rolled back if nothing uses its records.", "Строки с ошибками пропускаются; пакет можно откатить, если его записи не используются.", "Рядки з помилками пропускаються; пакет можна відкотити, якщо його записи не використовуються.", "تُتخطى الصفوف ذات الأخطاء."))} run={() => mfg.importCommit(kind, csv || [], {}, file || null)} done={() => { setPv(null); setCsv(null); }} /></>}
    </section>}
    <section className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }} data-export><b style={{ width: "100%" }}>{T(L("Export", "Экспорт", "Експорт", "تصدير"))}</b>
      {["units", "inventory", "shortages"].map((k) => <button key={k} className="btn ghost sm" data-export-kind={k} onClick={async () => { try { const x = await mfg.export(k); saveBlob(`${k}.csv`, toCsv(x.rows), "text/csv"); } catch (e: any) { setErr(e.message); } }}><Icon n="download" />{k}</button>)}
      <small className="faint" style={{ width: "100%" }}>{T(L("Only what you may open; every export is recorded in the audit log.", "Только то, что вам доступно; каждый экспорт записывается в журнал аудита.", "Лише те, що вам доступно; кожен експорт записується в журнал аудиту.", "فقط ما يمكنك فتحه؛ كل تصدير يُسجل."))}</small></section>
  </>;
}

/* ------------------------------------------------ settings and capabilities (B62) ------------------------------------------------ */
function Settings({ caps }: { caps: any }) {
  const T = useT(); const { people } = useApp() as any; const [s, setS] = useState<any>(null); const [txt, setTxt] = useState(""); const [cl, setCl] = useState<any>(null); const [err, setErr] = useState(""); const [tick, setTick] = useState(0); const [who, setWho] = useState(""); const [cap, setCap] = useState("");
  useEffect(() => { mfg.settings().then((x) => { setS(x); setTxt(JSON.stringify(x.value, null, 2)); }).catch((e) => setErr(e.message)); mfg.capsList().then(setCl).catch(() => {}); }, [tick]);
  if (err && !s) return <Err e={err} />;
  if (!s) return <Wait />;
  const mfgCaps: string[] = (cl?.caps || []).filter((c: string) => !["commercial_admin", "pricing_approver", "proposal_approver", "export_commercial"].includes(c));
  let parsed: any = null; try { parsed = JSON.parse(txt); } catch {}
  return <>
    <Err e={err} />
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-mfg-settings><b>{T(L("Manufacturing settings", "Настройки производства", "Налаштування виробництва", "إعدادات التصنيع"))} <small className="faint mono">v{s.version}</small></b>
      <small className="faint">{T(L("Statuses and their prerequisites, catalogues, receiving state, required inspections, test approval, shipping documents and the cost policy. Business logic is configured here, not written into the code.", "Статусы и их условия, справочники, состояние приёмки, обязательные инспекции, утверждение испытаний, документы отгрузки и политика затрат. Логика настраивается здесь, а не в коде.", "Статуси та їхні умови, довідники, стан приймання, обов'язкові інспекції, затвердження випробувань, документи відвантаження та політика витрат. Логіка налаштовується тут, а не в коді.", "الحالات وشروطها والفهارس وسياسة التكلفة."))}</small>
      <textarea data-settings-json rows={18} className="mono" style={{ width: "100%", fontSize: 12 }} value={txt} onChange={(e) => setTxt(e.target.value)} disabled={!caps.manufacturing_admin} />
      {!parsed && <small className="neg">JSON?</small>}
      {caps.manufacturing_admin && parsed && <Act data="settings-save" label={W.save} what={L("Saves a new settings version; the change is audited.", "Сохраняет новую версию настроек; изменение записывается в аудит.", "Зберігає нову версію налаштувань; зміна записується в аудит.", "يحفظ نسخة جديدة من الإعدادات.")} run={() => mfg.saveSettings(parsed, s.version)} done={() => setTick((t) => t + 1)} />}
    </section>
    {cl && <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-caps><b>{T(L("Manufacturing capabilities", "Производственные права", "Виробничі права", "صلاحيات التصنيع"))}</b>
      <small className="faint">{T(L("Capabilities are given to named people; an administrator role alone gives no manufacturing authority.", "Права выдаются конкретным людям; роль администратора сама по себе не даёт производственных полномочий.", "Права надаються конкретним людям; роль адміністратора сама по собі не дає виробничих повноважень.", "تُمنح الصلاحيات لأشخاص محددين."))}</small>
      <Tbl rows={(cl.grants || []).filter((g: any) => mfgCaps.includes(g.cap) && !g.revoked_at)} cols={[["name", L("Person", "Сотрудник", "Співробітник", "الشخص"), (r) => r.name || r.user_id], ["cap", L("Capability", "Право", "Право", "الصلاحية")], ["act", "", (r) => <Act data="cap-revoke" danger label={L("Remove", "Снять", "Зняти", "إزالة")} what={`${r.name} · ${r.cap}`} run={() => mfg.setCap(r.user_id, r.cap, false)} done={() => setTick((t) => t + 1)} />]]} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <select data-cap-user value={who} onChange={(e) => setWho(e.target.value)}><option value="">—</option>{(people || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
        <select data-cap-name value={cap} onChange={(e) => setCap(e.target.value)}><option value="">—</option>{mfgCaps.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        {who && cap && <Act data="cap-grant" label={L("Grant", "Выдать", "Надати", "منح")} what={`${(people || []).find((p: any) => p.id === who)?.full_name || who} · ${cap}`} run={() => mfg.setCap(who, cap, true)} done={() => setTick((t) => t + 1)} />}</div>
    </section>}
  </>;
}

