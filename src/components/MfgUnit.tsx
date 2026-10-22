"use client";
// Phase 8 — the Build Unit view: one physical unit, fourteen tabs, every number and status from the database for the
// signed-in person (mfg_unit_view / mfg_unit_tab). Actions appear only when the person holds the capability, and each
// one is confirmed in words before it is sent; the database checks the authority and the prerequisites again.
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { mfg, money, qty } from "@/lib/mfgApi";
import { INSPECTION_KINDS } from "@/config/workspace.config.mjs";
import { L, TABS, W, type T4 } from "@/lib/mfgText";
import { Act, Err, LabelCard, Reasons, StatusChip, Tbl, Wait, day, printLabels, useT, when } from "./MfgUi";

export default function MfgUnit({ id, onClose }: { id: string; onClose: () => void }) {
  const T = useT();
  const q = typeof window !== "undefined" ? new URLSearchParams(location.search) : null;
  const [v, setV] = useState<any>(null); const [err, setErr] = useState(""); const [tab, setTab] = useState(q?.get("utab") || "overview"); const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => { mfg.unit(id).then(setV).catch((e) => setErr(e.message)); }, [id, tick]);
  const go = (t: string) => { setTab(t); try { history.replaceState(null, "", `/mfg?unit=${id}&utab=${t}`); } catch {} };
  if (err && !v) return <section className="card" data-unit-view><Err e={err} /><button className="btn ghost sm" onClick={onClose}>{T(W.close)}</button></section>;
  if (!v) return <Wait />;
  const h = v.header || {}; const caps = v.caps || {};
  const tabs = TABS.filter(([k]) => k === "overview" || v.tabs?.[k]);
  return <section className="card" data-unit-view={id} style={{ display: "grid", gap: 12, padding: 14, minWidth: 0 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow">{T(L("Build unit", "Изделие", "Виріб", "وحدة بناء"))}{h.controlled ? <span className="chip" style={{ marginInlineStart: 6 }}><Icon n="lock" />{T(L("Restricted", "Ограниченный доступ", "Обмежений доступ", "مقيد"))}</span> : null}</div>
        <h2 style={{ margin: 0, overflowWrap: "anywhere" }} data-unit-number>{h.number} <StatusChip s={h.status} /></h2>
        <small className="muted" style={{ overflowWrap: "anywhere" }}>{[h.product, h.config, h.bom, h.owner && `${T(W.owner)}: ${h.owner}`, h.target && `${T(W.target)}: ${day(h.target)}`, h.destination].filter(Boolean).join(" · ")}</small>
      </div>
      <button className="btn ghost sm" data-unit-label onClick={async () => { try { printLabels([await mfg.label("unit", id)]); } catch (e: any) { setErr(e.message); } }}><Icon n="print" />{T(W.label)}</button>
      <button className="btn ghost sm" onClick={onClose} aria-label={T(W.close)}><Icon n="back" />{T(W.close)}</button>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
      <Ready t={L("Build readiness", "Готовность к сборке", "Готовність до збірки", "جاهزية البناء")} r={v.readiness?.build} k="build" />
      <Ready t={L("Acceptance readiness", "Готовность к приёмке", "Готовність до приймання", "جاهزية القبول")} r={v.readiness?.acceptance} k="acceptance" />
      <div className="card stat" style={{ padding: 10 }}><small>{T(L("Work orders open / done", "Наряды открыто / готово", "Наряди відкрито / виконано", "أوامر العمل مفتوحة / منجزة"))}</small><div><b className="mono">{v.counts?.work_open ?? 0} / {v.counts?.work_done ?? 0}</b></div></div>
      <div className="card stat" style={{ padding: 10 }}><small>{T(L("Open issues", "Открытые проблемы", "Відкриті проблеми", "مشكلات مفتوحة"))}</small><div><b className={`mono ${v.counts?.issues_open ? "neg" : ""}`}>{v.counts?.issues_open ?? 0}</b></div></div>
    </div>
    <nav className="dtabs" style={{ ["--dc" as any]: "#0F766E", overflowX: "auto" }} aria-label={T(L("Build unit", "Изделие", "Виріб", "وحدة بناء"))}>
      {tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} data-utab={k} onClick={() => go(k)}>{T(l)}</button>)}
    </nav>
    <Err e={err} />
    {tab === "overview" ? <Overview v={v} id={id} caps={caps} refresh={refresh} /> : <TabBody key={`${tab}-${tick}`} id={id} tab={tab} v={v} caps={caps} refresh={refresh} />}
  </section>;
}

function Ready({ t, r, k }: { t: T4; r: any; k: string }) {
  const T = useT(); const ok = r?.status === "Ready";
  return <div className="card stat" data-ready={k} data-ready-status={r?.status} style={{ padding: 10 }}><small>{T(t)}</small><div><b className={ok ? "" : "neg"}>{r?.status || "—"}</b></div>
    {!ok && r?.reasons?.length ? <small className="faint">{r.reasons.length} {T(L("reason(s)", "причин(ы)", "причин(и)", "سبب"))}</small> : null}</div>;
}

/* ------------------------------------------------ overview: blockers, lifecycle, release ------------------------------------------------ */
function Overview({ v, id, caps, refresh }: { v: any; id: string; caps: any; refresh: () => void }) {
  const T = useT(); const h = v.header || {};
  const [to, setTo] = useState(""); const [exc, setExc] = useState("");
  const pinned = !!h.bom_ref && !!h.released_at;
  return <div style={{ display: "grid", gap: 12 }}>
    <section className="card" style={{ padding: 12 }} data-blockers><div className="card-h"><h2 style={{ fontSize: 15 }}><Icon n="alert" />{T(W.blockers)} <span className="chip mono">{(v.blockers || []).length}</span></h2></div>
      <Reasons list={v.blockers} />
      {(v.blockers || []).filter((b: any) => b.kind === "ecr_impact" && b.ref).map((b: any) => <div key={b.ref} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Act data="incorporate" label={L("Incorporate the change", "Включить изменение", "Включити зміну", "دمج التغيير")} what={b.text} reason="required" disabled={!caps.engineering_change_approver} run={(r) => mfg.disposition(b.ref, id, "Incorporate", r)} done={refresh} />
        <Act data="keep" label={L("Keep current revision", "Оставить текущую ревизию", "Залишити поточну ревізію", "الإبقاء على المراجعة الحالية")} what={b.text} reason="required" disabled={!caps.engineering_change_approver} run={(r) => mfg.disposition(b.ref, id, "Keep current", r)} done={refresh} />
      </div>)}
    </section>
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }}><div className="card-h"><h2 style={{ fontSize: 15 }}><Icon n="git" />{T(L("Lifecycle", "Жизненный цикл", "Життєвий цикл", "دورة الحياة"))}</h2></div>
      {!pinned && <Act data="release" label={W.release} icon="stamp" what={L("Pins the approved configuration and the BOM revision that applies to this unit. Later revisions do not change it silently.", "Закрепляет утверждённую конфигурацию и ревизию спецификации для этого изделия. Последующие ревизии не меняют её незаметно.", "Закріплює затверджену конфігурацію та ревізію специфікації для цього виробу. Наступні ревізії не змінюють її непомітно.", "يثبّت التهيئة المعتمدة ومراجعة قائمة المواد لهذه الوحدة.")} disabled={!caps.build_manager} run={() => mfg.release(id)} done={refresh} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label className="fld"><span>{T(L("Move to", "Перевести в", "Перевести в", "نقل إلى"))}</span><select data-status-to value={to} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{(v.statuses || []).filter((s: string) => s !== h.status).map((s: string) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="fld" style={{ minWidth: 200, flex: 1 }}><span>{T(L("Authorized exception (only if a prerequisite is not met)", "Разрешённое исключение (только если условие не выполнено)", "Дозволений виняток (лише якщо умову не виконано)", "استثناء مصرح به"))}</span><input data-status-exception value={exc} onChange={(e) => setExc(e.target.value)} /></label>
      </div>
      {to && <Act data="status" label={L("Change status", "Сменить статус", "Змінити статус", "تغيير الحالة")} what={`${h.status} → ${to}`} reason="optional" disabled={!caps.build_manager} run={(r) => mfg.status(id, to, r || null, exc || null)} done={() => { setTo(""); setExc(""); refresh(); }} />}
      {pinned && <Act data="wo-generate" label={W.generateWork} icon="clipboard" what={L("Creates the work orders of the configuration's routing for this unit, each pinned to the current approved work instruction.", "Создаёт наряды по маршруту конфигурации, каждый — с закреплённой текущей утверждённой инструкцией.", "Створює наряди за маршрутом конфігурації, кожен — із закріпленою поточною затвердженою інструкцією.", "ينشئ أوامر العمل من مسار التهيئة.")} disabled={!caps.work_order_manager && !caps.build_manager} run={() => mfg.woGenerate(id)} done={refresh} />}
    </section>
    <small className="faint">{T(L("Released", "Выпущен", "Випущено", "أُصدر"))}: {when(h.released_at)} · {T(L("Accepted", "Принят", "Прийнято", "قُبل"))}: {when(h.accepted_at)} · As-Built rev {h.asbuilt_revision ?? "—"} · {T(L("Export check", "Экспортная проверка", "Експортна перевірка", "فحص التصدير"))}: {h.export_check || "—"}</small>
  </div>;
}

/* ------------------------------------------------ the other thirteen tabs ------------------------------------------------ */
function TabBody({ id, tab, v, caps, refresh }: { id: string; tab: string; v: any; caps: any; refresh: () => void }) {
  const T = useT(); const [d, setD] = useState<any>(null); const [err, setErr] = useState(""); const [extra, setExtra] = useState<any>(null);
  useEffect(() => {
    mfg.tab(id, tab).then(setD).catch((e) => setErr(e.message));
    if (tab === "asbuilt") mfg.compare(id).then(setExtra).catch(() => {});
    if (tab === "tests") mfg.records("technical.test_procedures", 200).then((x) => setExtra(x.filter((p) => p.status === "Approved"))).catch(() => setExtra([]));
  }, [id, tab]);
  if (err) return <Err e={err} />;
  if (d == null) return <Wait />;
  if (tab === "bom") return <div data-tab-body="bom"><p className="muted" style={{ margin: "0 0 8px" }}>{d.number} rev {d.revision} · <StatusChip s={d.status} /> · {d.config}</p>
    <Tbl rows={d.lines} cols={[["line", "#"], ["item", W.item, (r) => <span style={{ paddingInlineStart: (r.level - 1) * 14 }}><span className="mono">{r.item?.number}</span> {r.item?.title}{r.item?.serialized ? " ⓢ" : ""}</span>], ["qty", W.qty, (r) => `${qty(r.qty)} ${r.uom || ""}`], ["ext_qty", L("Total", "Всего", "Всього", "الإجمالي"), (r) => qty(r.ext_qty)], ["position", L("Position", "Позиция", "Позиція", "الموضع")], ["alt_group", L("Alternate group", "Группа замен", "Група замін", "مجموعة البدائل")], ["required", L("Required", "Обязательно", "Обов'язково", "مطلوب"), (r) => (r.required ? "✓" : "—")]]} /></div>;
  if (tab === "materials") return <div data-tab-body="materials" style={{ display: "grid", gap: 10 }}>
    <small className="faint">{d.rule}</small>
    <Tbl rows={d.rows} cols={[["item_number", W.item, (r) => <><span className="mono">{r.item_number}</span> {r.item_title}</>], ["required", L("Required", "Нужно", "Потрібно", "مطلوب"), (r) => qty(r.required)], ["consumed", L("Used", "Израсходовано", "Використано", "مستخدم"), (r) => qty(r.consumed)],
      ["allocated", L("Allocated", "Зарезервировано", "Зарезервовано", "مخصص"), (r) => qty(r.allocated)], ["available", L("Free stock offered", "Свободный остаток", "Вільний залишок", "مخزون حر"), (r) => qty(r.allocate ?? r.available)], ["ordered", L("Ordered", "Заказано", "Замовлено", "مطلوب شراؤه"), (r) => qty(r.ordered)],
      ["shortage", L("Shortage", "Нехватка", "Нестача", "نقص"), (r) => <b className={Number(r.shortage) > 0 ? "neg" : ""}>{qty(r.shortage)}</b>],
      ["act", "", (r) => Number(r.purchase_required) > 0 ? <Act data={`shortage-${r.item_number}`} label={L("Purchase request", "Заявка на закупку", "Заявка на закупівлю", "طلب شراء")} what={T(L("Creates a purchase request (not an order) for {n} × {i} through the normal approval process.", "Создаёт заявку на закупку (не заказ) на {n} × {i} через обычное согласование.", "Створює заявку на закупівлю (не замовлення) на {n} × {i} через звичайне погодження.", "ينشئ طلب شراء (وليس أمرًا) لـ {n} × {i}."), { n: qty(r.purchase_required), i: r.item_number })} reason="optional" run={(why) => mfg.shortageRequest(id, r.item, Number(r.purchase_required), null, why || null)} done={refresh} /> : null]]} />
    {(d.purchases || []).length ? <><b>{T(L("Purchases for this unit", "Закупки для изделия", "Закупівлі для виробу", "مشتريات هذه الوحدة"))}</b><Tbl rows={d.purchases} cols={[["number", "#"], ["title", L("Title", "Название", "Назва", "العنوان")], ["status", W.status, (r) => <StatusChip s={r.po_status || r.status} />], ["eta", "ETA", (r) => day(r.eta)], ["qty", W.qty]]} /></> : null}
    {(d.allocations || []).length ? <><b>{T(L("Allocated to this unit", "Зарезервировано", "Зарезервовано", "المخصص"))}</b><Tbl rows={d.allocations} cols={[["number", W.item], ["qty", W.qty, (r) => qty(r.qty)], ["serial", W.serial], ["act", "", (r) => caps.inventory_manager && r.id ? <Act data="alloc-release" label={L("Release", "Снять резерв", "Зняти резерв", "تحرير")} what={`${r.number} × ${qty(r.qty)}`} reason="required" run={(why) => mfg.releaseAlloc(r.id, why)} done={refresh} /> : null]]} /></> : null}
  </div>;
  if (tab === "work") return <WorkTab id={id} d={d} caps={caps} refresh={refresh} />;
  if (tab === "installed") return <div data-tab-body="installed" style={{ display: "grid", gap: 10 }}>
    <Tbl rows={d.installed} cols={[["item", W.item, (r) => <><span className="mono">{r.item}</span> {r.title}</>], ["serial", W.serial, (r) => <span className="mono">{r.serial || "—"}</span>], ["qty", W.qty, (r) => qty(r.qty)], ["position", L("Position", "Позиция", "Позиція", "الموضع")], ["work_order", L("Work order", "Наряд", "Наряд", "أمر العمل")], ["installed_by", L("By", "Кто", "Хто", "بواسطة")], ["installed_at", L("When", "Когда", "Коли", "متى"), (r) => when(r.installed_at)],
      ["act", "", (r) => caps.build_manager ? <Act data="remove" danger label={L("Remove", "Снять", "Зняти", "إزالة")} what={T(L("Removes {i} {s} from the unit and puts it into Quarantine. The removal stays in the history.", "Снимает {i} {s} с изделия и помещает в карантин. Снятие остаётся в истории.", "Знімає {i} {s} з виробу та поміщає в карантин. Зняття лишається в історії.", "يزيل {i} {s} ويضعه في الحجر."), { i: r.item, s: r.serial || "" })} reason="required" run={(why) => mfg.removeInstall(r.id, why)} done={refresh} /> : null]]} />
    {(d.consumed || []).length ? <><b>{T(L("Consumed", "Израсходовано", "Використано", "المستهلك"))}</b><Tbl rows={d.consumed} cols={[["item", W.item], ["title", ""], ["qty", W.qty, (r) => qty(r.qty)], ["lot", W.lot], ["work_order", L("Work order", "Наряд", "Наряд", "أمر العمل")]]} /></> : null}
    {(d.removed || []).length ? <><b>{T(L("Removed", "Снято", "Знято", "أزيل"))}</b><Tbl rows={d.removed} cols={[["item", W.item], ["serial", W.serial], ["reason", W.reason], ["removed_at", L("When", "Когда", "Коли", "متى"), (r) => when(r.removed_at)]]} /></> : null}
  </div>;
  if (tab === "inspections") return <div data-tab-body="inspections" style={{ display: "grid", gap: 10 }}>
    <Tbl rows={d} cols={[["number", "#"], ["kind", L("Kind", "Вид", "Вид", "النوع")], ["result", L("Result", "Результат", "Результат", "النتيجة"), (r) => <StatusChip s={r.result || r.status} />], ["inspector", L("Inspector", "Инспектор", "Інспектор", "المفتش")], ["date", L("Date", "Дата", "Дата", "التاريخ"), (r) => day(r.date)], ["open", "", (r) => <Link href={`/mfg?tab=quality&insp=${r.id}`} className="btn ghost sm">{T(W.open)}</Link>]]} />
    <InspectionNew unit={id} caps={caps} refresh={refresh} />
  </div>;
  if (tab === "tests") return <div data-tab-body="tests" style={{ display: "grid", gap: 10 }}>
    {(d.required || []).length ? <small>{T(L("Required by the configuration", "Требуются конфигурацией", "Потрібні конфігурацією", "مطلوب بحسب التهيئة"))}: {(d.required || []).map((x: any) => (typeof x === "string" ? x : x.code || x.procedure)).join(", ")}</small> : null}
    <Tbl rows={d.runs} cols={[["number", "#"], ["procedure", L("Procedure", "Процедура", "Процедура", "الإجراء"), (r) => `${r.procedure || ""} v${r.version || ""}`], ["outcome", L("Outcome", "Итог", "Підсумок", "النتيجة"), (r) => <StatusChip s={r.outcome || r.status} />], ["check", L("Limit check", "Проверка пределов", "Перевірка меж", "فحص الحدود")], ["operator", L("Operator", "Оператор", "Оператор", "المشغل")], ["approved_by", L("Approved by", "Утвердил", "Затвердив", "اعتمد")],
      ["act", "", (r) => <TestActs r={r} caps={caps} refresh={refresh} />]]} />
    {caps.test_operator && <TestNew unit={id} procs={extra || []} refresh={refresh} />}
  </div>;
  if (tab === "software") return <div data-tab-body="software" style={{ display: "grid", gap: 10 }}><Tbl rows={d} cols={[["component", L("Component", "Компонент", "Компонент", "المكوّن")], ["version", L("Version", "Версия", "Версія", "الإصدار")], ["current", L("Current", "Текущая", "Поточна", "الحالي"), (r) => (r.current ? "✓" : "")], ["installer", L("By", "Кто", "Хто", "بواسطة")], ["installed_at", L("When", "Когда", "Коли", "متى"), (r) => when(r.installed_at)]]} />
    <small className="faint">{T(L("Configuration references only — credentials and secrets are never stored here.", "Только ссылки на конфигурацию — пароли и секреты здесь не хранятся.", "Лише посилання на конфігурацію — паролі та секрети тут не зберігаються.", "مراجع التهيئة فقط — لا تُخزن بيانات الاعتماد هنا."))}</small></div>;
  if (tab === "issues") return <div data-tab-body="issues" style={{ display: "grid", gap: 10 }}>
    <Tbl rows={d} cols={[["number", "#"], ["title", L("Title", "Название", "Назва", "العنوان")], ["type", L("Type", "Тип", "Тип", "النوع")], ["severity", L("Severity", "Серьёзность", "Серйозність", "الخطورة")], ["status", W.status, (r) => <StatusChip s={r.status} />], ["disposition", L("Disposition", "Решение", "Рішення", "القرار")],
      ["act", "", (r) => r.type === "Nonconformance" ? <NcActs r={r} caps={caps} refresh={refresh} /> : <Link className="btn ghost sm" href={`/company/issues?r=${r.id}`}>{T(W.open)}</Link>]]} />
    <NcNew unit={id} refresh={refresh} />
  </div>;
  if (tab === "changes") return <div data-tab-body="changes" style={{ display: "grid", gap: 10 }}>
    <b>{T(L("Waiting for a decision", "Ждут решения", "Чекають рішення", "بانتظار القرار"))}</b><Reasons list={(d.pending || []).map((x: any) => (typeof x === "string" ? { text: x, level: "block" } : x))} />
    <b>{T(L("Decisions", "Решения", "Рішення", "القرارات"))}</b><Tbl rows={d.dispositions} cols={[["decision", L("Decision", "Решение", "Рішення", "القرار")], ["bom", W.bom], ["note", W.notes], ["by", L("By", "Кто", "Хто", "بواسطة")], ["at", L("When", "Когда", "Коли", "متى"), (r) => when(r.at)]]} />
    <b>{T(L("Pinned revisions", "Закреплённые ревизии", "Закріплені ревізії", "المراجعات المثبتة"))}</b><Tbl rows={d.pin_history} cols={[["revision", "Rev"], ["why", W.reason], ["at", L("When", "Когда", "Коли", "متى"), (r) => when(r.at)]]} />
  </div>;
  if (tab === "asbuilt") return <AsBuilt id={id} d={d} cmp={extra} caps={caps} refresh={refresh} />;
  if (tab === "documents") return <Shipping id={id} d={d} v={v} caps={caps} refresh={refresh} />;
  if (tab === "cost") return <div data-tab-body="cost" style={{ display: "grid", gap: 8 }}><b>{d.label}</b>
    <Tbl rows={d.by_currency} cols={[["currency", L("Currency", "Валюта", "Валюта", "العملة")], ["planned", L("Planned", "План", "План", "المخطط"), (r) => money(r.planned)], ["committed", L("Committed", "Обязательства", "Зобов'язання", "الملتزم"), (r) => money(r.committed)], ["received", L("Received", "Получено", "Отримано", "المستلم"), (r) => money(r.received)], ["consumed", L("Consumed", "Израсходовано", "Використано", "المستهلك"), (r) => money(r.consumed)], ["variance", L("Variance", "Отклонение", "Відхилення", "الفرق"), (r) => money(r.variance)]]} />
    <small className="faint">{d.rules}</small></div>;
  if (tab === "history") return <div data-tab-body="history"><Tbl rows={d} cols={[["at", L("When", "Когда", "Коли", "متى"), (r) => when(r.at)], ["by", L("By", "Кто", "Хто", "بواسطة")], ["kind", L("What", "Что", "Що", "ماذا")], ["detail", "", (r) => <small className="mono faint">{Object.entries(r.detail || {}).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join(" · ")}</small>]]} /></div>;
  return <pre className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(d, null, 2)}</pre>;
}

function WorkTab({ id, d, caps, refresh }: { id: string; d: any; caps: any; refresh: () => void }) {
  const T = useT(); const { people } = useApp() as any; const [name, setName] = useState(""); const [who, setWho] = useState("");
  return <div data-tab-body="work" style={{ display: "grid", gap: 10 }}>
    <small className="muted">{T(L("Routing", "Маршрут", "Маршрут", "المسار"))}: {(d.routing || []).map((r: any) => `${r.seq}. ${r.name}`).join(" → ") || "—"}</small>
    <Tbl rows={d.work_orders} cols={[["number", "#", (r) => <Link href={`/build?wo=${r.id}`} className="mono">{r.number}</Link>], ["operation", L("Operation", "Операция", "Операція", "العملية")], ["status", W.status, (r) => <StatusChip s={r.status} />], ["assignee", L("Assigned", "Исполнитель", "Виконавець", "المكلف")], ["completed_by", L("Completed by", "Выполнил", "Виконав", "أنجزه")], ["completed_at", L("When", "Когда", "Коли", "متى"), (r) => when(r.completed_at)]]} />
    {(caps.work_order_manager || caps.build_manager) && <div className="card" style={{ padding: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label className="fld" style={{ flex: 1, minWidth: 160 }}><span>{T(L("Extra work order", "Дополнительный наряд", "Додатковий наряд", "أمر عمل إضافي"))}</span><input data-wo-name value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="fld" style={{ minWidth: 160 }}><span>{T(L("Assign to", "Назначить", "Призначити", "تكليف"))}</span><select data-wo-assignee value={who} onChange={(e) => setWho(e.target.value)}><option value="">—</option>{(people || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></label>
      {name.trim().length > 2 && <Act data="wo-create" label={L("Create work order", "Создать наряд", "Створити наряд", "إنشاء أمر عمل")} what={name} run={() => mfg.woCreate(id, { name: name.trim(), assignee_id: who || null })} done={() => { setName(""); refresh(); }} />}
    </div>}
  </div>;
}

const KINDS: string[] = [...INSPECTION_KINDS].sort((a, b) => (a.startsWith("In-") ? -1 : b.startsWith("In-") ? 1 : 0));
function InspectionNew({ unit, caps, refresh }: { unit: string; caps: any; refresh: () => void }) {
  const T = useT(); const [kind, setKind] = useState(KINDS[0]);
  if (!caps.quality_inspector && !caps.build_manager) return null;
  return <div className="card" style={{ padding: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
    <label className="fld"><span>{T(L("New inspection", "Новая инспекция", "Нова інспекція", "فحص جديد"))}</span><select data-insp-kind value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
    <Act data="insp-create" label={L("Create inspection", "Создать инспекцию", "Створити інспекцію", "إنشاء فحص")} what={kind} run={() => mfg.inspectionCreate({ unit, kind })} done={refresh} />
  </div>;
}

function TestNew({ unit, procs, refresh }: { unit: string; procs: any[]; refresh: () => void }) {
  const T = useT(); const [p, setP] = useState("");
  return <div className="card" style={{ padding: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
    <label className="fld" style={{ minWidth: 200 }}><span>{T(L("Schedule a test (approved procedures)", "Назначить испытание (утверждённые процедуры)", "Призначити випробування (затверджені процедури)", "جدولة اختبار"))}</span><select data-test-proc value={p} onChange={(e) => setP(e.target.value)}><option value="">—</option>{procs.map((x) => <option key={x.id} value={x.id}>{x.data?.code || ""} v{x.data?.version || ""} · {x.title}</option>)}</select></label>
    {p && <Act data="test-create" label={L("Create test run", "Создать прогон", "Створити прогін", "إنشاء تشغيل اختبار")} what={procs.find((x) => x.id === p)?.title || ""} run={() => mfg.testCreate(unit, p, {})} done={refresh} />}
  </div>;
}

/** Record a test run: one value per field of the pinned procedure version; the database checks the limits, never infers Pass. */
function TestActs({ r, caps, refresh }: { r: any; caps: any; refresh: () => void }) {
  const T = useT(); const [open, setOpen] = useState(false); const [rec, setRec] = useState<any>(null); const [vals, setVals] = useState<Record<string, any>>({}); const [outcome, setOutcome] = useState(""); const [notes, setNotes] = useState("");
  const recorded = !!r.outcome;
  if (recorded) return caps.test_approver && !r.approved_by && r.outcome === "Pass" ? <Act data="test-approve" label={L("Approve result", "Утвердить результат", "Затвердити результат", "اعتماد النتيجة")} what={`${r.number} · ${r.procedure} · Pass`} reason="optional" run={(why) => mfg.testApprove(r.id, why || null)} done={refresh} /> : null;
  if (!caps.test_operator) return null;
  if (!open) return <button className="btn ghost sm" data-test-record={r.id} onClick={async () => { setOpen(true); setRec(await mfg.record(r.id).catch(() => null)); }}>{T(L("Record values", "Внести значения", "Внести значення", "تسجيل القيم"))}</button>;
  const fields: any[] = rec?.data?.fields || [];
  return <div style={{ display: "grid", gap: 6, minWidth: 220 }} data-test-form={r.id}>
    {fields.map((f) => <label key={f.key} className="fld"><span>{f.name || f.key}{f.unit ? ` (${f.unit})` : ""}{f.min != null || f.max != null ? ` [${f.min ?? "…"}–${f.max ?? "…"}]` : ""}</span>
      {f.type === "boolean" ? <select data-field={f.key} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value === "" ? undefined : e.target.value === "true" })}><option value="">—</option><option value="true">✓</option><option value="false">✗</option></select>
        : <input data-field={f.key} inputMode={f.type === "number" ? "decimal" : undefined} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: f.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value })} />}</label>)}
    <label className="fld"><span>{T(L("Outcome (your decision — never inferred)", "Итог (ваше решение — не выводится автоматически)", "Підсумок (ваше рішення — не виводиться автоматично)", "النتيجة (قرارك)"))}</span><select data-outcome value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">—</option>{["Pass", "Fail", "Conditional", "Aborted"].map((o) => <option key={o}>{o}</option>)}</select></label>
    <label className="fld"><span>{T(W.notes)}</span><textarea rows={2} data-test-notes value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    {outcome && <Act data="test-save" label={L("Save the result", "Сохранить результат", "Зберегти результат", "حفظ النتيجة")} what={`${r.number} · ${outcome}`} run={() => mfg.testRecord(r.id, { values: vals, outcome, notes: notes || null })} done={() => { setOpen(false); refresh(); }} />}
  </div>;
}

function NcNew({ unit, refresh }: { unit: string; refresh: () => void }) {
  const T = useT(); const [t, setT] = useState(""); const [sev, setSev] = useState("Medium");
  return <div className="card" style={{ padding: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
    <label className="fld" style={{ flex: 1, minWidth: 200 }}><span>{T(L("Report a nonconformance", "Сообщить о несоответствии", "Повідомити про невідповідність", "الإبلاغ عن عدم مطابقة"))}</span><input data-nc-title value={t} onChange={(e) => setT(e.target.value)} /></label>
    <label className="fld"><span>{T(L("Severity", "Серьёзность", "Серйозність", "الخطورة"))}</span><select value={sev} onChange={(e) => setSev(e.target.value)}>{["Low", "Medium", "High", "Critical"].map((s) => <option key={s}>{s}</option>)}</select></label>
    {t.trim().length > 4 && <Act data="nc-create" label={L("Create issue", "Создать проблему", "Створити проблему", "إنشاء مشكلة")} what={t} run={() => mfg.ncCreate({ unit, title: t.trim(), description: t.trim(), severity: sev })} done={() => { setT(""); refresh(); }} />}
  </div>;
}

function NcActs({ r, caps, refresh }: { r: any; caps: any; refresh: () => void }) {
  const [d, setD] = useState("Rework");
  if (r.status === "Closed") return null;
  if (!r.disposition) return <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    <select data-nc-disp value={d} onChange={(e) => setD(e.target.value)}>{["Rework", "Replace", "Scrap", "Return to Vendor", "Use As Is"].map((x) => <option key={x}>{x}</option>)}</select>
    <Act data="nc-disposition" label={L("Decide", "Решить", "Вирішити", "قرّر")} what={`${r.number}: ${d}${d === "Use As Is" ? " — needs a Quality Approver" : ""}`} reason="required" disabled={!caps.quality_inspector && !caps.quality_approver} run={(why) => mfg.ncDisposition(r.id, d, why)} done={refresh} /></span>;
  return <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {["Rework", "Replace"].includes(r.disposition) && <Act data="nc-rework" label={L("Rework order", "Наряд на доработку", "Наряд на доопрацювання", "أمر إعادة العمل")} what={r.number} run={() => mfg.rework(r.id, {})} done={refresh} disabled={!caps.work_order_manager && !caps.build_manager} />}
    <Act data="nc-close" label={L("Close", "Закрыть", "Закрити", "إغلاق")} what={r.number} reason="required" disabled={!caps.quality_approver && !caps.quality_inspector} run={(why) => mfg.ncClose(r.id, why)} done={refresh} /></span>;
}

function AsBuilt({ id, d, cmp, caps, refresh }: { id: string; d: any; cmp: any; caps: any; refresh: () => void }) {
  const T = useT(); const a = d?.asbuilt; const s = a?.snapshot || {};
  return <div data-tab-body="asbuilt" style={{ display: "grid", gap: 10 }}>
    {a ? <small className="muted">As-Built rev <b className="mono">{a.revision}</b> · hash <span className="mono">{String(a.hash || "").slice(0, 12)}</span>{a.stale ? <b className="neg"> · {T(L("Out of date — the unit changed after this record", "Устарело — изделие изменилось после записи", "Застаріло — виріб змінився після запису", "قديم"))}</b> : null}</small>
      : <small className="muted">{T(L("No As-Built record yet.", "As-Built ещё не записан.", "As-Built ще не записано.", "لا يوجد سجل بعد."))}</small>}
    {s.note && <small className="faint">{s.note}</small>}
    {(caps.build_manager || caps.quality_inspector) && <Act data="asbuilt-generate" label={W.asbuiltGen} icon="stamp" what={L("Records a new As-Built revision from what was actually installed, consumed, inspected and tested.", "Записывает новую ревизию As-Built по фактически установленному, израсходованному, проверенному и испытанному.", "Записує нову ревізію As-Built за фактично встановленим, використаним, перевіреним і випробуваним.", "يسجل مراجعة جديدة مما ثُبّت فعلًا.")} run={() => mfg.asbuiltGenerate(id)} done={refresh} />}
    {(s.installed || []).length ? <Tbl rows={s.installed} cols={[["number", W.item, (r) => <span className="mono">{r.number || r.item}</span>], ["title", ""], ["serial", W.serial], ["qty", W.qty, (r) => qty(r.qty)], ["position", L("Position", "Позиция", "Позиція", "الموضع")]]} /> : null}
    {cmp && <section className="card" style={{ padding: 10 }} data-compare><b>{T(L("Approved BOM vs As-Built", "Утверждённая спецификация и As-Built", "Затверджена специфікація та As-Built", "قائمة المواد المعتمدة مقابل الفعلي"))}</b>
      <Tbl rows={[...(cmp.rows || []), ...(cmp.extra || []).map((x: any) => ({ status: "not in BOM", expected: x.item, installed_qty: x.qty }))]} empty={L("No differences", "Отличий нет", "Відмінностей немає", "لا اختلافات")} cols={[["status", L("Difference", "Отличие", "Відмінність", "الاختلاف"), (r) => <b className={r.status === "match" ? "" : "neg"} data-diff={r.status}>{r.status}</b>], ["expected", W.item, (r) => <><span className="mono">{r.expected?.number}</span> {r.expected?.title}</>], ["expected_qty", L("Planned", "План", "План", "المخطط"), (r) => qty(r.expected_qty)], ["installed_qty", L("Built", "Факт", "Факт", "الفعلي"), (r) => qty(r.installed_qty)], ["substitutes", L("Substitutes", "Замены", "Заміни", "البدائل"), (r) => (r.substitutes || []).map((x: any) => `${x.item?.number} × ${qty(x.qty)}`).join(", ")]]} />
      {cmp.summary ? <small className="faint mono">{Object.entries(cmp.summary).map(([k, x]) => `${k}: ${x}`).join(" · ")}</small> : null}</section>}
  </div>;
}

function Shipping({ id, d, v, caps, refresh }: { id: string; d: any; v: any; caps: any; refresh: () => void }) {
  const T = useT(); const sh = d.shipping || {}; const cur = sh.shipping || {};
  const [f, setF] = useState<any>({ packing: cur.packing || "", carrier: "", reference: "", ship_date: "" });
  const [docs, setDocs] = useState<Record<string, boolean>>(cur.documents || {});
  const acc = v.readiness?.acceptance; const accepted = !!v.header?.accepted_at;
  return <div data-tab-body="documents" style={{ display: "grid", gap: 12 }}>
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-acceptance><b>{T(W.acceptance)}: {accepted ? `${T(L("accepted", "принят", "прийнято", "مقبول"))} ${when(v.header.accepted_at)}` : acc?.status}</b>
      {!accepted && <Reasons list={acc?.reasons} />}
      {!accepted && <Act data="accept" label={W.accept} icon="stamp" what={L("Records internal acceptance of this unit against its As-Built record. This is not an external certification.", "Фиксирует внутреннюю приёмку изделия по записи As-Built. Это не внешняя сертификация.", "Фіксує внутрішнє приймання виробу за записом As-Built. Це не зовнішня сертифікація.", "يسجل القبول الداخلي. ليس شهادة خارجية.")} reason="optional" disabled={!caps.unit_acceptance_approver || acc?.status !== "Ready"} run={(why) => mfg.accept(id, { note: why || null })} done={refresh} />}
    </section>
    <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-shipping><b>{T(W.shipment)}: {sh.released ? `${T(L("released", "разрешена", "дозволено", "مُفرج"))} ${day(sh.released.ship_date)} · ${sh.released.carrier || ""} ${sh.released.reference || ""}` : sh.status}</b>
      {!sh.released && <Reasons list={sh.reasons} />}
      {!sh.released && caps.build_manager && <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label className="fld"><span>{T(L("Packing", "Упаковка", "Пакування", "التغليف"))}</span><select data-ship-packing value={f.packing} onChange={(e) => setF({ ...f, packing: e.target.value })}><option value="">—</option>{["Not started", "In progress", "Packed"].map((x) => <option key={x}>{x}</option>)}</select></label>
        {Object.keys({ ...(cur.documents || {}), "Packing list": false, "Commercial invoice": false, "As-Built configuration": false }).map((k) => <label key={k} className="fld" style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" data-ship-doc={k} checked={!!docs[k]} onChange={(e) => setDocs({ ...docs, [k]: e.target.checked })} /><span>{k}</span></label>)}
      </div>}
      {!sh.released && caps.build_manager && <Act data="ship-save" label={L("Save shipping preparation", "Сохранить подготовку отгрузки", "Зберегти підготовку відвантаження", "حفظ تجهيز الشحن")} what={`${f.packing || "—"} · ${Object.entries(docs).filter(([, x]) => x).map(([k]) => k).join(", ") || "—"}`} run={() => mfg.shipping(id, { packing: f.packing || null, documents: docs })} done={refresh} />}
      {!sh.released && <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label className="fld"><span>{T(L("Carrier", "Перевозчик", "Перевізник", "الناقل"))}</span><input data-ship-carrier value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} /></label>
        <label className="fld"><span>{T(L("Reference", "Номер", "Номер", "المرجع"))}</span><input data-ship-ref value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        <label className="fld"><span>{T(L("Ship date", "Дата отгрузки", "Дата відвантаження", "تاريخ الشحن"))}</span><input type="date" data-ship-date value={f.ship_date} onChange={(e) => setF({ ...f, ship_date: e.target.value })} /></label></div>}
      {!sh.released && <Act data="ship-release" label={W.shipRelease} icon="truck" what={L("Releases the shipment after the checks pass. Carrier booking stays outside Workspace.", "Разрешает отгрузку после проверок. Бронирование перевозчика — вне Workspace.", "Дозволяє відвантаження після перевірок. Бронювання перевізника — поза Workspace.", "يفرج عن الشحنة بعد اجتياز الفحوص.")} disabled={!caps.shipment_release_approver || sh.status !== "Ready"} run={() => mfg.shipRelease(id, { carrier: f.carrier || null, reference: f.reference || null, ship_date: f.ship_date || null })} done={refresh} />}
    </section>
    <small className="muted">{T(W.evidence)}: <b className="mono">{d.evidence ?? 0}</b></small>
    {(d.used_in_work || []).length ? <Tbl rows={d.used_in_work} cols={[["number", L("Document", "Документ", "Документ", "المستند")], ["title", ""], ["version", L("Version", "Версия", "Версія", "الإصدار")]]} /> : null}
  </div>;
}

export function UnitLabelPreview({ id }: { id: string }) {
  const [l, setL] = useState<any>(null); useEffect(() => { mfg.label("unit", id).then(setL).catch(() => {}); }, [id]);
  return <LabelCard l={l} />;
}
