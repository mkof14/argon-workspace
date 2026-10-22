"use client";
// REQUESTS & PROCESSES (Phase 6): one place to raise a request, see what needs you, follow every process, and see the
// operations picture. Every list and number comes from a v23 database function for the signed-in person only; every
// action is a database function that checks who may act, on which values, at which step. Nothing is decided here.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, SECTIONS, MANAGERS } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { ops } from "@/lib/opsApi";
import { DASH, EVENT, INSTANCE_STATUS, OUTCOME, REQUEST_FORM, REQUEST_TYPES, STEP_TYPE, TODO, href, money, say, type T4 } from "@/lib/opsText";
import { PersonField, DeptField } from "./PeopleFields";

const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Tab = "requests" | "mine" | "dashboard" | "budgets" | "parties" | "builder";
const when = (s?: string | null) => (s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") : "—");
const day = (s?: string | null) => (s ? String(s).slice(0, 10) : "—");
const secOf = (id: string) => SECTIONS.find((s: any) => s.id === id) as any;

export default function Processes() {
  const { lang, me } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const lead = MANAGERS.includes(me.role);
  const q = typeof window !== "undefined" ? new URLSearchParams(location.search) : null;
  const [tab, setTab] = useState<Tab>(((q?.get("tab") as Tab) || "mine"));
  const [open, setOpen] = useState<string | null>(q?.get("i") || null);
  const [tick, setTick] = useState(0);
  const go = (t: Tab) => { setTab(t); try { history.replaceState(null, "", `/ops?tab=${t}`); } catch {} };
  const tabs: [Tab, string, T4][] = [["mine", "bell", L("My processes", "Мои процессы", "Мої процеси", "عملياتي")], ["requests", "plus", L("New request", "Новая заявка", "Нова заявка", "طلب جديد")],
    ["dashboard", "grid", L("Operations", "Операции", "Операції", "العمليات")], ["budgets", "pie", L("Project budgets", "Бюджеты проектов", "Бюджети проєктів", "ميزانيات المشاريع")],
    ["parties", "building", L("Organisations", "Организации", "Організації", "الجهات")], ...(lead ? [["builder", "git", L("Process builder", "Конструктор процессов", "Конструктор процесів", "منشئ العمليات")] as [Tab, string, T4]] : [])];
  return (
    <div style={{ display: "grid", gap: 16 }} className="procs">
      <nav className="dtabs" style={{ ["--dc" as any]: "#F26B1D" }} aria-label={T(L("Requests and processes", "Заявки и процессы", "Заявки та процеси", "الطلبات والعمليات"))}>
        {tabs.map(([k, ic, l]) => <button key={k} className={tab === k ? "on" : ""} data-tab={k} onClick={() => go(k)}><Icon n={ic} />{T(l)}</button>)}
      </nav>
      {tab === "requests" && <RequestCenter onCreated={(i) => { setOpen(i); setTick((t) => t + 1); go("mine"); }} />}
      {tab === "mine" && <MyProcesses key={tick} onOpen={setOpen} />}
      {tab === "dashboard" && <OpsDashboard key={tick} onOpen={setOpen} />}
      {tab === "budgets" && <Budgets />}
      {tab === "parties" && <Parties />}
      {tab === "builder" && lead && <Builder />}
      {open && <InstanceView id={open} onClose={() => { setOpen(null); setTick((t) => t + 1); try { history.replaceState(null, "", `/ops?tab=${tab}`); } catch {} }} />}
    </div>
  );
}

/* ------------------------------------------------ Request Center (B20) ------------------------------------------------ */
function RefPicker({ section, value, onChange, id }: { section: string; value: string; onChange: (v: string, title: string) => void; id: string }) {
  const [rows, setRows] = useState<any[]>([]); const [q, setQ] = useState("");
  useEffect(() => { if (DEMO) return; let off = false; const t = setTimeout(async () => {
    let r = sb().from("records").select("id,title,data").eq("section", section).order("updated_at", { ascending: false }).limit(30);
    if (q.trim()) r = r.ilike("title", `%${q.trim()}%`);
    const { data } = await r; if (!off) setRows(data || []); }, 200); return () => { off = true; clearTimeout(t); }; }, [section, q]);
  return <div style={{ display: "grid", gap: 4 }}><input id={id + "-q"} placeholder="…" value={q} onChange={(e) => setQ(e.target.value)} />
    <select id={id} value={value} onChange={(e) => { const r = rows.find((x) => x.id === e.target.value); onChange(e.target.value, r ? r.data?.number || r.title : ""); }}>
      <option value="">—</option>{rows.map((r) => <option key={r.id} value={r.id}>{r.data?.number ? `${r.data.number} · ` : ""}{r.title}</option>)}</select></div>;
}

function FieldInput({ f, data, setData }: { f: any; data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void }) {
  const { lang } = useApp(); const id = `rq-${f.key}`; const v = data[f.key] ?? "";
  const set = (x: any) => setData((d) => ({ ...d, [f.key]: x }));
  let input: React.ReactNode;
  if (f.type === "person") return <PersonField f={f} data={data} setData={setData} ro={false} id={id} />;
  if (f.type === "dept") input = <DeptField f={f} value={v} set={set} ro={false} id={id} />;
  else if (f.type === "long" || f.type === "rich") input = <textarea id={id} rows={3} value={v} onChange={(e) => set(e.target.value)} />;
  else if (f.type === "select") input = <select id={id} value={v} onChange={(e) => set(e.target.value)}><option value="">—</option>{(f.options || []).map((o: string) => <option key={o}>{o}</option>)}</select>;
  else if (f.type === "ref") input = <RefPicker id={id} section={f.ref} value={v} onChange={(x) => set(x)} />;
  else input = <input id={id} type={f.type === "date" ? "date" : f.type === "number" || f.type === "money" ? "number" : "text"} step="any" value={v}
    onChange={(e) => set(f.type === "number" || f.type === "money" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />;
  return <label className="fld" htmlFor={id}><span>{tx(f.label, lang as Lang)}</span>{input}</label>;
}

function RequestCenter({ onCreated }: { onCreated: (instance: string) => void }) {
  const { lang, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [types, setTypes] = useState<any[] | null>(null); const [type, setType] = useState<any>(null);
  const [title, setTitle] = useState(""); const [data, setData] = useState<Record<string, any>>({ currency: "USD" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { ops.types().then(setTypes).catch((e) => { setTypes([]); setErr(e.message); }); }, []);
  if (!types) return <div className="card empty">…</div>;
  if (!type) return (
    <div className="card"><div className="card-h"><h2><Icon n="plus" />{T(L("What do you need?", "Что вам нужно?", "Що вам потрібно?", "ماذا تحتاج؟"))}</h2></div>
      <p className="muted" style={{ margin: "0 16px 12px" }}>{T(L("Choose the kind of request. It follows its process: you see who has it and what happens next, all the way to the end.", "Выберите вид заявки. Она пойдёт по своему процессу: вы видите, у кого она и что дальше — до самого конца.", "Оберіть вид заявки. Вона піде своїм процесом: ви бачите, у кого вона і що далі — до самого кінця.", "اختر نوع الطلب. سيتبع عمليته: ترى من يتولاه وما التالي حتى النهاية."))}</p>
      <div className="feed" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, padding: 16 }}>
        {types.length === 0 && <div className="empty">{err || T(L("No request types are available for your role.", "Для вашей роли нет доступных видов заявок.", "Для вашої ролі немає доступних видів заявок.", "لا توجد أنواع طلبات متاحة لدورك."))}</div>}
        {types.map((t: any) => { const m = REQUEST_TYPES[t.key] || { t: L(t.key, t.key, t.key, t.key), d: L("", "", "", ""), icon: "file" };
          return <button key={t.key} className="card" data-rtype={t.key} disabled={!t.available} style={{ textAlign: "start", padding: 14, display: "grid", gap: 6, cursor: t.available ? "pointer" : "not-allowed" }} onClick={() => { setType(t); setTitle(""); setData({ currency: "USD" }); }}>
            <b><Icon n={m.icon} /> {T(m.t)}</b><small className="muted">{T(m.d)}</small>{!t.available && <small className="neg">{T(L("Switched off", "Отключено", "Вимкнено", "متوقف"))}</small>}</button>; })}
      </div></div>);
  const sec = secOf(type.section); const keys = REQUEST_FORM[type.key] || [];
  const fields = keys.map((k) => sec?.fields.find((f: any) => f.key === k)).filter(Boolean);
  const submit = async (send: boolean) => {
    if (!title.trim()) { setErr(T(L("Give the request a short title", "Дайте заявке короткое название", "Дайте заявці коротку назву", "أعطِ الطلب عنوانًا قصيرًا"))); return; }
    setBusy(true); setErr("");
    try {
      const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "" && v != null));
      const r = await ops.create(type.key, title.trim(), clean, clean.priority || null);
      if (send) { const i = await ops.instance(r.instance); if (i?.current?.can_act) await ops.act(i.current.run_id, "submit"); }
      toast(`${r.number || ""} ${T(L("created", "создана", "створено", "أُنشئ"))}`); onCreated(r.instance);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card" data-form={type.key}><div className="card-h"><h2><Icon n={(REQUEST_TYPES[type.key] || {}).icon || "file"} />{T((REQUEST_TYPES[type.key] || {}).t || L(type.key, type.key, type.key, type.key))}</h2>
      <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setType(null)}><Icon n="x" />{T(L("Back", "Назад", "Назад", "رجوع"))}</button></div>
      <div style={{ display: "grid", gap: 10, padding: 16, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        <label className="fld" htmlFor="rq-title" style={{ gridColumn: "1 / -1" }}><span>{T(L("Title", "Название", "Назва", "العنوان"))}</span><input id="rq-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} /></label>
        {fields.map((f: any) => <FieldInput key={f.key} f={f} data={data} setData={setData} />)}
      </div>
      <p className="faint" style={{ margin: "0 16px" }}><small>{T(L("Do not enter bank details, card numbers or passwords: Workspace refuses them. Payments are made in the bank by Finance.", "Не вводите банковские реквизиты, номера карт и пароли: Workspace их не принимает. Платит бухгалтерия в банке.", "Не вводьте банківські реквізити, номери карток і паролі: Workspace їх не приймає. Платить бухгалтерія в банку.", "لا تُدخل بيانات بنكية أو أرقام بطاقات أو كلمات مرور: يرفضها Workspace. تدفع المالية من البنك."))}</small></p>
      {err && <div className="neg" role="alert" style={{ margin: "8px 16px" }}>{err}</div>}
      <div className="toolbar" style={{ padding: 16, gap: 8 }}>
        <button className="btn" disabled={busy} data-submit onClick={() => submit(true)}><Icon n="send" />{T(L("Submit request", "Отправить заявку", "Надіслати заявку", "إرسال الطلب"))}</button>
        <button className="btn ghost" disabled={busy} onClick={() => submit(false)}>{T(L("Save as draft step", "Сохранить, отправить позже", "Зберегти, надіслати пізніше", "حفظ والإرسال لاحقًا"))}</button>
      </div>
    </div>);
}

/* ------------------------------------------------ My Processes (B4) ------------------------------------------------ */
function Row({ r, onOpen, extra }: { r: any; onOpen: (id: string) => void; extra?: React.ReactNode }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const late = r.due && new Date(r.due).getTime() < Date.now();
  return <div className="feed-row" data-rec={r.record_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ flex: 1, minWidth: 0 }}><b style={{ overflowWrap: "anywhere" }}>{r.number ? <span className="mono faint">{r.number} · </span> : null}{r.title}</b>
      <div><small className="muted">{[r.process, r.step && `${T(L("step", "шаг", "крок", "الخطوة"))}: ${r.step}`, r.reason, r.blocker].filter(Boolean).join(" · ")}</small></div></div>
    {r.status && INSTANCE_STATUS[r.status] && <span className={`chip ${INSTANCE_STATUS[r.status].cls}`}>{T(INSTANCE_STATUS[r.status].t)}</span>}
    {r.due && <small className={late ? "neg" : "faint"}>{day(r.due)}</small>}
    {extra}
    {r.instance_id ? <button className="btn sm" onClick={() => onOpen(r.instance_id)}>{T(L("Open", "Открыть", "Відкрити", "فتح"))}</button> : <Link className="btn ghost sm" href={href(r.section, r.record_id)}>{T(L("Record", "Запись", "Запис", "السجل"))}</Link>}
  </div>;
}

function MyProcesses({ onOpen }: { onOpen: (id: string) => void }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(""); const [k, setK] = useState("needs_action");
  useEffect(() => { ops.mine().then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="card empty">{err}</div>;
  if (!d) return <div className="card empty">…</div>;
  const tabs: [string, T4][] = [["needs_action", L("Needs my action", "Нужно моё действие", "Потрібна моя дія", "يحتاج إجرائي")], ["requested", L("Requested by me", "Мои заявки", "Мої заявки", "طلباتي")],
    ["waiting", L("Waiting", "Ожидают", "Очікують", "بالانتظار")], ["blocked", L("Blocked", "Заблокированы", "Заблоковані", "معطّلة")], ["completed", L("Completed", "Завершены", "Завершені", "مكتملة")]];
  const rows: any[] = d[k] || [];
  return <div className="card"><nav className="seg" style={{ margin: 12 }} role="tablist">{tabs.map(([key, l]) => <button key={key} role="tab" data-mine={key} aria-selected={k === key} className={k === key ? "on" : ""} onClick={() => setK(key)}>{T(l)} <b className="mono">{(d[key] || []).length}</b></button>)}</nav>
    <div className="feed" data-list={k}>{rows.length ? rows.map((r, i) => <Row key={(r.run_id || r.instance_id || r.record_id) + ":" + i} r={r} onOpen={onOpen} />) : <div className="empty" style={{ padding: 16 }}>{T(L("Nothing here.", "Здесь ничего нет.", "Тут нічого немає.", "لا شيء هنا."))}</div>}</div></div>;
}

/* ------------------------------------------------ Operations dashboard (B30) ------------------------------------------------ */
function OpsDashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [ov, setOv] = useState<any>(null); const [err, setErr] = useState(""); const [drill, setDrill] = useState<{ kind: string; title: T4 } | null>(null); const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { ops.overview().then(setOv).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (!drill) return; setRows(null); ops.list(drill.kind, 500).then(setRows).catch(() => setRows([])); }, [drill]);
  if (err) return <div className="card empty">{err}</div>;
  if (!ov) return <div className="card empty">…</div>;
  const n = (k: string) => ov.items?.[k]?.count || 0;
  return <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
      {DASH.map((b) => <div key={b.key} className="card hub-card" data-block={b.key}><div className="card-h"><h2><Icon n={b.icon} />{T(b.title)}</h2></div>
        <div style={{ display: "grid", gap: 4, padding: "0 12px 12px" }}>{b.kinds.map(([k, l]) => {
          const am = ov.items?.[k]?.amounts || {}; const amt = Object.entries(am).map(([c, s]) => money(s, c)).join(" · ");
          return <button key={k} className="stat" data-kind={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }} onClick={() => setDrill({ kind: k, title: l })}>
            <small>{T(l)}{amt ? <span className="faint"> · {amt}</span> : null}</small><b className={`mono ${["po_overdue", "obl_overdue", "sla_overdue", "sla_escalated", "blocked", "wait_overdue", "iss_overdue"].includes(k) && n(k) ? "neg" : ""}`}>{n(k)}</b></button>; })}</div></div>)}
    </div>
    {drill && <section className="card" data-drill><div className="card-h"><h2><Icon n="funnel" />{T(drill.title)} <span className="chip mono">{n(drill.kind)}</span></h2>
      <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setDrill(null)}><Icon n="x" />{T(L("Close", "Закрыть", "Закрити", "إغلاق"))}</button></div>
      <div className="feed">{!rows ? <div className="empty">…</div> : rows.length ? rows.map((r, i) => <Row key={r.record_id + i} r={r} onOpen={onOpen} extra={r.amount != null ? <small className="mono">{money(r.amount, r.currency)}</small> : null} />) : <div className="empty" style={{ padding: 16 }}>—</div>}</div></section>}
    <small className="faint">{T(L("Counted only from records you may open. Workspace keeps no accounts and moves no money: “paid” means Finance recorded the payment.", "Считается только по записям, которые вам доступны. Workspace не ведёт бухгалтерию и не переводит деньги: «оплачено» — значит, бухгалтерия записала оплату.", "Рахується лише за записами, доступними вам. Workspace не веде бухгалтерію і не переказує гроші: «сплачено» — означає, що бухгалтерія записала оплату.", "يُحتسب فقط من السجلات المتاحة لك. لا يمسك Workspace حسابات ولا ينقل أموالًا: «مدفوع» يعني أن المالية سجّلت الدفع."))}</small>
  </>;
}

/* ------------------------------------------------ Budgets (B26/B27) ------------------------------------------------ */
function Budgets() {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [b, setB] = useState<any>(null); const [err, setErr] = useState(""); const [one, setOne] = useState<any>(null);
  useEffect(() => { ops.budget(null).then(setB).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="card empty">{err}</div>;
  if (!b) return <div className="card empty">…</div>;
  const cols: [string, T4][] = [["budget", L("Budget", "Бюджет", "Бюджет", "الميزانية")], ["requested", L("Requested (estimates)", "Запрошено (оценки)", "Запитано (оцінки)", "مطلوب (تقديرات)")], ["approved", L("Approved, not ordered", "Согласовано, не заказано", "Погоджено, не замовлено", "معتمد غير مطلوب")],
    ["committed", L("Committed (ordered)", "Обязательства (заказано)", "Зобов'язання (замовлено)", "ملتزم (مطلوب)")], ["paid", L("Paid (recorded)", "Оплачено (записано)", "Сплачено (записано)", "مدفوع (مسجّل)")], ["remaining", L("Remaining", "Остаток", "Залишок", "المتبقي")]];
  return <div className="card"><div className="card-h"><h2><Icon n="pie" />{T(L("Project budgets", "Бюджеты проектов", "Бюджети проєктів", "ميزانيات المشاريع"))}</h2></div>
    <p className="muted" style={{ margin: "0 16px 8px" }}><small>{T(L("Remaining = Budget − Committed − Approved (not yet ordered). Requested amounts are estimates and are not subtracted. Each currency is shown on its own; nothing is converted.", "Остаток = Бюджет − Обязательства − Согласовано (ещё не заказано). Запрошенные суммы — оценки, не вычитаются. Каждая валюта отдельно; ничего не пересчитывается.", "Залишок = Бюджет − Зобов'язання − Погоджено (ще не замовлено). Запитані суми — оцінки, не віднімаються. Кожна валюта окремо; нічого не перераховується.", "المتبقي = الميزانية − الملتزم − المعتمد (غير المطلوب بعد). المبالغ المطلوبة تقديرات ولا تُطرح. كل عملة على حدة؛ لا تحويل."))}</small></p>
    <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>{T(L("Project", "Проект", "Проєкт", "المشروع"))}</th><th>{T(L("Currency", "Валюта", "Валюта", "العملة"))}</th>{cols.map(([k, l]) => <th key={k}>{T(l)}</th>)}</tr></thead>
      <tbody>{(b.rows || []).map((r: any) => <tr key={r.project_id + r.currency} data-budget={r.project_id}><td><button className="btn ghost sm" onClick={() => ops.budget(r.project_id).then(setOne)}>{r.project || "—"}</button></td><td className="mono">{r.currency}</td>
        {cols.map(([k]) => <td key={k} className={`mono ${k === "remaining" && r[k] < 0 ? "neg" : ""}`}>{Number(r[k] || 0).toLocaleString("en-US")}</td>)}</tr>)}</tbody></table></div>
    {!b.rows?.length && <div className="empty" style={{ padding: 16 }}>{T(L("No project has budget lines or purchases yet.", "Ни у одного проекта ещё нет бюджета или закупок.", "Жоден проєкт ще не має бюджету чи закупівель.", "لا ميزانيات أو مشتريات للمشاريع بعد."))}</div>}
    {one && <div className="card" style={{ margin: 12 }} data-budget-detail><div className="card-h"><h2>{one.project?.title}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setOne(null)}><Icon n="x" /></button></div>
      {(one.rows || []).map((r: any) => <div key={r.currency} style={{ padding: "0 16px 12px" }}><b className="mono">{r.currency}</b>{cols.map(([k, l]) => <div key={k}><small>{T(l)}: <b className="mono">{Number(r[k] || 0).toLocaleString("en-US")}</b>{r.refs?.[k]?.length ? <span className="faint"> · {r.refs[k].length} {T(L("records", "записей", "записів", "سجلات"))}</span> : null}</small></div>)}</div>)}</div>}
  </div>;
}

/* ------------------------------------------------ Parties (B24) ------------------------------------------------ */
function Parties() {
  const { lang } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [rows, setRows] = useState<any[] | null>(null); const [q, setQ] = useState(""); const [one, setOne] = useState<any>(null);
  useEffect(() => { if (DEMO) { setRows([]); return; } let r = sb().from("records").select("id,title,status,data").eq("section", "company.parties").order("title").limit(200); if (q.trim()) r = r.ilike("title", `%${q.trim()}%`); r.then(({ data }) => setRows(data || [])); }, [q]);
  return <div className="card"><div className="card-h"><h2><Icon n="building" />{T(L("Organisations", "Организации", "Організації", "الجهات"))}</h2><input style={{ marginInlineStart: "auto", maxWidth: 240 }} placeholder="…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search" /></div>
    <p className="muted" style={{ margin: "0 16px 8px" }}><small>{T(L("One organisation can be a vendor, a client and a partner at once. You see only the relationships you may open. People at these organisations do not get Workspace accounts.", "Одна организация может быть одновременно поставщиком, клиентом и партнёром. Вы видите только доступные вам связи. Сотрудники этих организаций не получают учётных записей Workspace.", "Одна організація може бути водночас постачальником, клієнтом і партнером. Ви бачите лише доступні вам зв'язки. Працівники цих організацій не отримують облікових записів Workspace.", "يمكن لجهة واحدة أن تكون موردًا وعميلًا وشريكًا معًا. ترى فقط العلاقات المتاحة لك. لا يحصل موظفو هذه الجهات على حسابات Workspace."))}</small></p>
    <div className="feed">{!rows ? <div className="empty">…</div> : rows.map((r) => <div key={r.id} style={{ display: "flex", gap: 8, padding: "6px 12px", alignItems: "center" }}><b style={{ flex: 1 }}>{r.title}</b><small className="faint">{r.data?.country}</small><button className="btn ghost sm" onClick={() => ops.party(r.id).then(setOne)}>{T(L("Relationships", "Связи", "Зв'язки", "العلاقات"))}</button></div>)}</div>
    {one && <div className="card" style={{ margin: 12 }}><div className="card-h"><h2>{one.title}</h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setOne(null)}><Icon n="x" /></button></div>
      <div className="feed">{one.relationships.map((x: any) => <div key={x.id} style={{ display: "flex", gap: 8, padding: "4px 12px" }}><span className="chip">{x.type}</span><Link href={href(x.section, x.id)}>{x.title}</Link><small className="faint">{x.status}</small></div>)}
        {!one.relationships.length && <div className="empty" style={{ padding: 12 }}>—</div>}</div></div>}
  </div>;
}

/* ------------------------------------------------ One process (B1–B19) ------------------------------------------------ */
function InstanceView({ id, onClose }: { id: string; onClose: () => void }) {
  const { lang, me, people, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [tick, setTick] = useState(0);
  const [quotes, setQuotes] = useState<any>(null); const [reason, setReason] = useState(""); const [rcv, setRcv] = useState({ qty: 1, rejected: 0, condition: "Good" }); const [pay, setPay] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", ref: "" });
  const [purchases, setPurchases] = useState<any[]>([]); const [who, setWho] = useState(""); const [cands, setCands] = useState<any[] | null>(null); const [props, setProps] = useState<any[]>([]);
  useEffect(() => { setErr(""); ops.instance(id).then(setD).catch((e) => setErr(e.message)); }, [id, tick]);
  const r = d?.record; const cur = d?.current; const st = cur?.step || {};
  useEffect(() => { if (!r) return;
    if (r.section === "operations.requests") { ops.quotes(r.id).then(setQuotes).catch(() => setQuotes(null));
      if (!DEMO) sb().from("records").select("id,title,status,data").eq("section", "operations.procurement").eq("data->>request_ref", r.id).then(({ data }) => setPurchases(data || [])); }
    if (r.section === "technical.changes" && st.confirms_impact) ops.impactCandidates(r.id).then(setCands).catch(() => setCands([]));
    ops.proposals(r.id).then(setProps).catch(() => setProps([]));
  }, [r?.id, cur?.run_id]);
  const run = async (fn: () => Promise<any>, ok?: T4) => { setBusy(true); setErr(""); try { const x = await fn(); if (x && x.ok === false) throw new Error(x.error); if (ok) toast(T(ok)); setNote(""); setTick((t) => t + 1); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const myAps = (d?.approvals || []).filter((a: any) => a.mine && a.status === "pending");
  const name = (uid?: string) => { const p = people.find((x: any) => x.id === uid); return p ? p.full_name || p.email : ""; };
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={T(L("Process", "Процесс", "Процес", "العملية"))} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div className="card" data-instance={id} style={{ width: "min(880px, 100%)", height: "100%", overflowY: "auto", borderRadius: 0, display: "grid", alignContent: "start", gap: 12, padding: 16 }}>
        <div className="card-h" style={{ padding: 0 }}><h2 style={{ overflowWrap: "anywhere" }}><Icon n="git" />{d ? <>{r?.number && <span className="mono faint">{r.number} · </span>}{r?.title}</> : "…"}</h2>
          <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={onClose}><Icon n="x" />{T(L("Close", "Закрыть", "Закрити", "إغلاق"))}</button></div>
        {err && <div className="neg" role="alert" data-error>{err}</div>}
        {d && <>
          <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className={`chip ${INSTANCE_STATUS[d.status]?.cls || ""}`} data-status={d.status}>{T(INSTANCE_STATUS[d.status]?.t || L(d.status, d.status, d.status, d.status))}</span>
            <small className="muted">{d.definition.name} · v{d.definition.version}</small>
            <small className="muted">{T(L("Requested by", "Заявитель", "Заявник", "مقدم الطلب"))}: {d.requester_name || "—"}</small>
            <small className="muted">{T(L("Record status", "Статус записи", "Статус запису", "حالة السجل"))}: {r.status}</small>
            {r.controlled && <span className="chip c-bad">US Persons Only</span>}
            <Link className="btn ghost sm" href={href(r.section, r.id)} style={{ marginInlineStart: "auto" }}><Icon n="file" />{T(L("Open the record", "Открыть запись", "Відкрити запис", "فتح السجل"))}</Link>
          </div>
          {cur && <section className="card" data-current={cur.step_id} style={{ padding: 12, borderInlineStart: "4px solid #F26B1D" }}>
            <b>{say(TODO[cur.type] || L("{name}", "{name}", "{name}", "{name}"), lang, { name: cur.name })}</b>
            <div><small className="muted">{T(STEP_TYPE[cur.type] || L(cur.type, cur.type, cur.type, cur.type))} · {T(L("Responsible", "Ответственный", "Відповідальний", "المسؤول"))}: {cur.assignee_name || (cur.assignee_role ? `${T(L("any", "любой", "будь-хто", "أي"))} ${cur.assignee_role}` : cur.type === "APPROVAL" ? T(L("approvers below", "согласующие ниже", "погоджувачі нижче", "المعتمدون أدناه")) : "—")} · {T(L("Due", "Срок", "Термін", "الموعد"))}: {cur.paused ? T(L("paused while waiting outside", "на паузе, пока ждём извне", "на паузі, поки чекаємо ззовні", "متوقف أثناء الانتظار")) : when(cur.due_at)}</small></div>
            {st.instructions && <p style={{ margin: "6px 0" }}>{st.instructions}</p>}
            {cur.blocked_reason && <div className="neg" data-blocked>{cur.blocked_reason}</div>}
            {cur.can_act && <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {cur.type !== "APPROVAL" && <textarea rows={2} placeholder={T(L("Note (required to reject or ask for changes)", "Комментарий (нужен для отказа или доработки)", "Коментар (потрібен для відмови чи доопрацювання)", "ملاحظة (مطلوبة للرفض أو طلب التعديل)"))} value={note} onChange={(e) => setNote(e.target.value)} aria-label="note" />}
              <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
                {(cur.type === "TASK") && <button className="btn" disabled={busy} data-act="done" onClick={() => run(() => ops.act(cur.run_id, "done", note), L("Done", "Готово", "Готово", "تم"))}><Icon n="check" />{T(L("Mark done", "Выполнено", "Виконано", "تم الإنجاز"))}</button>}
                {(cur.type === "WAIT") && <button className="btn" disabled={busy} data-act="received" onClick={() => run(() => ops.act(cur.run_id, "received", note))}><Icon n="check" />{T(L("It has arrived", "Получено", "Отримано", "وصل"))}</button>}
                {(cur.type === "DATA" || cur.type === "DOCUMENT") && !st.selects_quote && <button className="btn" disabled={busy} data-act="submit" onClick={() => run(() => ops.act(cur.run_id, "submit", note))}><Icon n="send" />{T(L("Submit", "Отправить", "Надіслати", "إرسال"))}</button>}
                {st.receives && <button className="btn ghost" disabled={busy || !note.trim()} data-act="accept_partial" onClick={() => run(() => ops.act(cur.run_id, "accept_partial", note))}>{T(L("Accept partial delivery", "Принять частичную поставку", "Прийняти часткову поставку", "قبول تسليم جزئي"))}</button>}
                {cur.type === "REVIEW" && !cur.is_requester && <>
                  <button className="btn" disabled={busy} data-act="approved" onClick={() => run(() => ops.act(cur.run_id, "approved", note))}><Icon n="check" />{T(L("Approve", "Одобрить", "Схвалити", "موافقة"))}</button>
                  <button className="btn ghost" disabled={busy || !note.trim()} data-act="changes" onClick={() => run(() => ops.act(cur.run_id, "changes_requested", note))}>{T(L("Ask for changes", "На доработку", "На доопрацювання", "طلب تعديلات"))}</button>
                  <button className="btn ghost neg" disabled={busy || !note.trim()} data-act="reject" onClick={() => run(() => ops.act(cur.run_id, "rejected", note))}>{T(L("Reject", "Отклонить", "Відхилити", "رفض"))}</button></>}
                {cur.type === "DECISION" && (st.options || []).map((o: any) => <button key={o.key} className="btn" disabled={busy} onClick={() => run(() => ops.act(cur.run_id, o.key, note))}>{o.label}</button>)}
                {cur.type === "CHECK" && <button className="btn" disabled={busy} onClick={() => run(() => ops.act(cur.run_id, "recheck", note))}>{T(L("Check again", "Проверить снова", "Перевірити знову", "أعد الفحص"))}</button>}
              </div></div>}
            {cur.can_retry && d.status === "blocked" && <button className="btn ghost sm" style={{ marginTop: 8 }} disabled={busy} data-act="retry" onClick={() => run(() => ops.act(cur.run_id, "retry", note))}><Icon n="refresh" />{T(L("Retry this step", "Повторить шаг", "Повторити крок", "إعادة الخطوة"))}</button>}
            {cur.can_manage && !["APPROVAL", "AUTOMATION", "CHECK"].includes(cur.type) && <div className="toolbar" style={{ gap: 6, marginTop: 8 }}>
              <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="reassign"><option value="">{T(L("Hand over to…", "Передать…", "Передати…", "تسليم إلى…"))}</option>{people.filter((p: any) => !p.disabled && !["partner", "vendor", "investor", "pending"].includes(p.role)).map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
              <button className="btn ghost sm" disabled={!who || busy} onClick={() => run(() => ops.reassign(cur.run_id, who, note))}>{T(L("Hand over", "Передать", "Передати", "تسليم"))}</button></div>}
          </section>}

          {myAps.length > 0 && <section className="card" style={{ padding: 12 }} data-my-approval><b>{T(L("Your approval", "Ваше согласование", "Ваше погодження", "موافقتك"))}</b>
            {myAps.map((a: any) => <div key={a.id} style={{ display: "grid", gap: 6, marginTop: 6 }}><small className="muted">{a.note} · {T(L("level", "уровень", "рівень", "المستوى"))} {a.level}</small>
              <small>{T(L("You approve these exact values", "Вы согласуете именно эти значения", "Ви погоджуєте саме ці значення", "أنت توافق على هذه القيم بالضبط"))}: <span className="mono">{Object.entries(a.basis || {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}</span></small>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={T(L("Comment (required to reject or ask for changes)", "Комментарий (нужен для отказа или доработки)", "Коментар (потрібен для відмови чи доопрацювання)", "تعليق (مطلوب للرفض أو التعديل)"))} aria-label="comment" />
              <div className="toolbar" style={{ gap: 8 }}>
                <button className="btn" disabled={busy} data-decide="approved" onClick={() => run(() => ops.decide(a.id, "approved", note), L("Approved", "Согласовано", "Погоджено", "تمت الموافقة"))}><Icon n="check" />{T(L("Approve", "Согласовать", "Погодити", "موافقة"))}</button>
                <button className="btn ghost" disabled={busy || !note.trim()} data-decide="changes" onClick={() => run(() => ops.decide(a.id, "changes_requested", note))}>{T(L("Ask for changes", "На доработку", "На доопрацювання", "طلب تعديلات"))}</button>
                <button className="btn ghost neg" disabled={busy || !note.trim()} data-decide="rejected" onClick={() => run(() => ops.decide(a.id, "rejected", note))}>{T(L("Reject", "Отклонить", "Відхилити", "رفض"))}</button></div></div>)}</section>}

          {r.section === "operations.requests" && quotes && <section className="card" style={{ padding: 12 }} data-quotes><b>{T(L("Quotations side by side", "Предложения рядом", "Пропозиції поруч", "العروض جنبًا إلى جنب"))}</b>
            <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>{T(L("Vendor", "Поставщик", "Постачальник", "المورد"))}</th><th>{T(L("Vendor status", "Статус поставщика", "Статус постачальника", "حالة المورد"))}</th><th>{T(L("Amount", "Сумма", "Сума", "المبلغ"))}</th><th>{T(L("Lead time", "Срок", "Термін", "المدة"))}</th><th>{T(L("Valid until", "Действует до", "Дійсна до", "صالح حتى"))}</th><th>{T(L("Terms", "Условия", "Умови", "الشروط"))}</th><th /></tr></thead>
              <tbody>{quotes.quotes.map((x: any) => <tr key={x.id} className={x.selected ? "sel" : ""}><td>{x.vendor || "—"}</td><td>{x.vendor_status || "—"}</td><td className="mono">{money(x.amount, x.currency)}{x.lowest_in_currency ? <small className="faint"> · {T(L("lowest", "минимальная", "мінімальна", "الأدنى"))}</small> : null}</td>
                <td className="mono">{x.lead_time_days ?? "—"}{x.shortest_lead_time ? <small className="faint"> · {T(L("shortest", "кратчайший", "найкоротший", "الأقصر"))}</small> : null}</td><td className={x.expired ? "neg" : ""}>{day(x.valid_until)}</td><td><small>{[x.terms, x.incoterms].filter(Boolean).join(" · ")}</small></td>
                <td>{x.selected ? <span className="chip c-ok">{T(L("Selected", "Выбрано", "Обрано", "مختار"))}</span> : cur?.can_act && st.selects_quote ? <button className="btn sm" disabled={busy || reason.trim().length < 10} data-select={x.id} onClick={() => run(() => ops.selectQuote(r.id, x.id, reason))}>{T(L("Choose", "Выбрать", "Обрати", "اختيار"))}</button> : null}</td></tr>)}</tbody></table></div>
            {!quotes.quotes.length && <small className="faint">{T(L("No quotations yet: add them under Operations → Quotations, linked to this request.", "Предложений пока нет: добавьте их в Операции → Предложения поставщиков со ссылкой на эту заявку.", "Пропозицій ще немає: додайте їх в Операції → Пропозиції постачальників з посиланням на цю заявку.", "لا عروض بعد: أضفها في العمليات ← عروض الأسعار مرتبطة بهذا الطلب."))}</small>}
            {cur?.can_act && st.selects_quote && <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={T(L("Why this quotation (required) — Workspace does not choose for you", "Почему это предложение (обязательно) — Workspace не выбирает за вас", "Чому ця пропозиція (обов'язково) — Workspace не обирає за вас", "لماذا هذا العرض (مطلوب) — Workspace لا يختار نيابة عنك"))} aria-label="reason" />}
            <small className="faint">{quotes.note}</small>
            <div className="toolbar" style={{ gap: 6, marginTop: 6 }}><button className="btn ghost sm" disabled={busy} onClick={() => run(() => ops.extract(r.id, "quotation"), L("Proposals created — confirm them below", "Предложения созданы — подтвердите ниже", "Пропозиції створено — підтвердіть нижче", "أُنشئت المقترحات — أكدها أدناه"))}><Icon n="spark" />{T(L("Read quotation values from attached files", "Прочитать значения из файлов", "Прочитати значення з файлів", "قراءة القيم من الملفات"))}</button></div>
          </section>}

          {purchases.length > 0 && <section className="card" style={{ padding: 12 }} data-purchases><b>{T(L("Purchase record and receiving", "Закупка и приёмка", "Закупівля та приймання", "سجل الشراء والاستلام"))}</b>
            {purchases.map((p: any) => <div key={p.id} style={{ display: "grid", gap: 6, marginTop: 6 }}><div><Link href={href("operations.procurement", p.id)}><b className="mono">{p.data?.number}</b> · {p.title}</Link> · <span className="chip">{p.status}</span> · <small>{T(L("received", "принято", "прийнято", "مستلم"))} {p.data?.qty_received ?? 0} / {p.data?.qty ?? "?"}</small></div>
              {["Approved", "Ordered", "Partially delivered"].includes(p.status) && ["owner", "admin", "management", "operations", "procurement"].includes(me.role) && <div className="toolbar" style={{ gap: 6, flexWrap: "wrap" }}>
                <label className="fld" style={{ width: 110 }}><span>{T(L("Arrived", "Пришло", "Надійшло", "الواصل"))}</span><input type="number" min={1} value={rcv.qty} onChange={(e) => setRcv({ ...rcv, qty: Number(e.target.value) })} /></label>
                <label className="fld" style={{ width: 110 }}><span>{T(L("Refused", "Отклонено", "Відхилено", "المرفوض"))}</span><input type="number" min={0} value={rcv.rejected} onChange={(e) => setRcv({ ...rcv, rejected: Number(e.target.value) })} /></label>
                <label className="fld" style={{ width: 150 }}><span>{T(L("Condition", "Состояние", "Стан", "الحالة"))}</span><select value={rcv.condition} onChange={(e) => setRcv({ ...rcv, condition: e.target.value })}>{["Good", "Damaged", "Wrong item", "Short", "Other"].map((c) => <option key={c}>{c}</option>)}</select></label>
                <button className="btn sm" disabled={busy} data-receive={p.id} onClick={() => run(() => ops.receive(p.id, rcv.qty, rcv.rejected, rcv.condition, note), L("Receiving recorded", "Приёмка записана", "Приймання записано", "سُجل الاستلام"))}><Icon n="box" />{T(L("Receive goods", "Принять товар", "Прийняти товар", "استلام البضاعة"))}</button></div>}
            </div>)}<small className="faint">{T(L("A refusal or damage opens an issue and a follow-up task with the vendor. Workspace sends nothing to the vendor by itself.", "Отказ или повреждение открывают проблему и задачу связаться с поставщиком. Workspace ничего не отправляет поставщику сам.", "Відмова чи пошкодження відкривають проблему та завдання зв'язатися з постачальником. Workspace нічого не надсилає постачальнику сам.", "الرفض أو التلف يفتح مشكلة ومهمة متابعة مع المورد. لا يرسل Workspace شيئًا للمورد بنفسه."))}</small></section>}

          {r.section === "finance.payments" && st.records_payment && ["finance", "owner"].includes(me.role) && <section className="card" style={{ padding: 12 }} data-pay><b>{T(L("Record the payment made in the bank", "Записать оплату, проведённую в банке", "Записати оплату, проведену в банку", "سجّل الدفع المنفذ في البنك"))}</b>
            <div className="toolbar" style={{ gap: 6, flexWrap: "wrap" }}>
              <label className="fld"><span>{T(L("Paid on", "Дата оплаты", "Дата оплати", "تاريخ الدفع"))}</span><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></label>
              <label className="fld"><span>{T(L("Amount", "Сумма", "Сума", "المبلغ"))}</span><input type="number" step="any" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
              <label className="fld"><span>{T(L("Bank / system reference", "Ссылка банка / системы", "Посилання банку / системи", "مرجع البنك / النظام"))}</span><input value={pay.ref} maxLength={120} onChange={(e) => setPay({ ...pay, ref: e.target.value })} /></label>
              <button className="btn sm" disabled={busy || !pay.amount || !pay.ref.trim()} data-record-payment onClick={() => run(() => ops.recordPayment(r.id, pay.date, Number(pay.amount), pay.ref, note), L("Payment recorded", "Оплата записана", "Оплату записано", "سُجل الدفع"))}><Icon n="coins" />{T(L("Record payment", "Записать оплату", "Записати оплату", "تسجيل الدفع"))}</button></div>
            <small className="faint">{T(L("Workspace moves no money and keeps no bank details: write only the reference of the bank transfer.", "Workspace не переводит деньги и не хранит реквизиты: укажите только номер банковского перевода.", "Workspace не переказує гроші й не зберігає реквізити: вкажіть лише номер банківського переказу.", "لا ينقل Workspace أموالًا ولا يحفظ بيانات بنكية: اكتب مرجع التحويل فقط."))}</small></section>}

          {r.section === "technical.changes" && st.confirms_impact && cur?.can_act && <section className="card" style={{ padding: 12 }} data-impact><b>{T(L("Impact record", "Запись о влиянии", "Запис про вплив", "سجل الأثر"))}</b>
            <small className="muted">{T(L("Fill in the impact fields on the record (cost, schedule, configurations, documents, BOM, inventory, tests, certification notes), then confirm. Workspace infers no safety or certification consequence.", "Заполните поля влияния в записи (стоимость, сроки, конфигурации, документы, BOM, склад, испытания, заметки по сертификации), затем подтвердите. Workspace не делает выводов о безопасности и сертификации.", "Заповніть поля впливу в записі (вартість, терміни, конфігурації, документи, BOM, склад, випробування, нотатки щодо сертифікації), потім підтвердіть. Workspace не робить висновків щодо безпеки й сертифікації.", "املأ حقول الأثر في السجل ثم أكّد. لا يستنتج Workspace أي أثر على السلامة أو الشهادات."))}</small>
            {cands && cands.length > 0 && <div><small>{T(L("Records that share the configuration or project (for you to judge):", "Записи с той же конфигурацией или проектом (для вашей оценки):", "Записи з тією ж конфігурацією чи проєктом (для вашої оцінки):", "سجلات تشترك في التهيئة أو المشروع (لتقييمك):"))}</small>{cands.slice(0, 30).map((c: any) => <div key={c.id}><Link href={href(c.section, c.id)}>{c.title}</Link> <small className="faint">· {c.reason}</small></div>)}</div>}
            <button className="btn sm" disabled={busy} style={{ marginTop: 6 }} data-confirm-impact onClick={() => run(() => ops.confirmImpact(r.id, note), L("Impact confirmed", "Влияние подтверждено", "Вплив підтверджено", "تم تأكيد الأثر"))}><Icon n="check" />{T(L("Confirm the impact record", "Подтвердить запись о влиянии", "Підтвердити запис про вплив", "تأكيد سجل الأثر"))}</button></section>}

          {(r.section === "legal.contracts" || props.length > 0) && <section className="card" style={{ padding: 12 }} data-proposals><b>{T(L("Proposed from documents — confirm or reject", "Предложено из документов — подтвердите или отклоните", "Запропоновано з документів — підтвердіть або відхиліть", "مقترح من المستندات — أكّد أو ارفض"))}</b>
            {r.section === "legal.contracts" && <button className="btn ghost sm" disabled={busy} style={{ marginInlineStart: 8 }} onClick={() => run(() => ops.extract(r.id, "obligation"))}><Icon n="spark" />{T(L("Propose obligations from the contract text", "Предложить обязательства из текста договора", "Запропонувати зобов'язання з тексту договору", "اقترح الالتزامات من نص العقد"))}</button>}
            {props.filter((p: any) => p.status === "proposed").map((p: any) => <div key={p.id} style={{ display: "grid", gap: 4, marginTop: 6, padding: 8, border: "1px dashed var(--line)" }}>
              <small><span className="chip">{p.kind}</span> <span className="faint">{p.method === "model" ? T(L("read by the model", "прочитано моделью", "прочитано моделлю", "قرأه النموذج")) : T(L("pattern match", "по шаблону", "за шаблоном", "مطابقة نمط"))}</span></small>
              <span className="mono" style={{ overflowWrap: "anywhere" }}>{Object.entries(p.proposed || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}</span>
              {p.evidence && <small className="faint" style={{ overflowWrap: "anywhere" }}>«{Object.values(p.evidence).join(" … ")}»</small>}
              <div className="toolbar" style={{ gap: 6 }}><button className="btn sm" disabled={busy} onClick={() => run(() => ops.decideProposal(p.id, true, p.kind === "obligation" && !p.proposed.description ? { description: p.proposed.title } : null))}>{T(L("Confirm", "Подтвердить", "Підтвердити", "تأكيد"))}</button>
                <button className="btn ghost sm" disabled={busy} onClick={() => run(() => ops.decideProposal(p.id, false, null, note || null))}>{T(L("Reject", "Отклонить", "Відхилити", "رفض"))}</button></div></div>)}
            {!props.some((p: any) => p.status === "proposed") && <div><small className="faint">{T(L("Nothing waits for confirmation. Values read from documents never become records until a person confirms them.", "Ничего не ждёт подтверждения. Значения из документов не становятся записями, пока человек их не подтвердит.", "Нічого не чекає підтвердження. Значення з документів не стають записами, доки людина їх не підтвердить.", "لا شيء بانتظار التأكيد. لا تصبح القيم المقروءة سجلات حتى يؤكدها شخص."))}</small></div>}</section>}

          {(d.approvals || []).length > 0 && <section style={{ display: "grid", gap: 4 }} data-approvals><b>{T(L("Approvals", "Согласования", "Погодження", "الموافقات"))}</b>
            {d.approvals.filter((a: any) => !(a.status === "cancelled" && a.comment === "Decided by another approver")).map((a: any) => <small key={a.id}><span className={`chip ${a.status === "approved" ? "c-ok" : a.status === "invalidated" || a.status === "rejected" ? "c-bad" : a.status === "pending" ? "c-warn" : ""}`}>{a.status}</span> {T(L("level", "уровень", "рівень", "المستوى"))} {a.level} · {a.approver_name || name(a.approver)}{a.comment ? ` — ${a.comment}` : ""}{a.invalidated_reason ? ` — ${a.invalidated_reason}` : ""}</small>)}</section>}

          <section style={{ display: "grid", gap: 2 }} data-steps><b>{T(L("Steps", "Шаги", "Кроки", "الخطوات"))}</b>
            {(d.definition.steps || []).map((s: any) => { const runs = d.runs.filter((x: any) => x.step_id === s.id); const last = runs[runs.length - 1];
              return <div key={s.id} data-step={s.id} style={{ display: "flex", gap: 8, alignItems: "baseline", opacity: last ? 1 : 0.55 }}><Icon n={last?.status === "done" ? "check" : last?.status === "open" ? "clock" : "flag"} />
                <span style={{ flex: 1 }}>{s.name} <small className="faint">({T(STEP_TYPE[s.type] || L(s.type, s.type, s.type, s.type))})</small></span>
                {last && <small className="muted">{last.status === "open" ? T(L("now", "сейчас", "зараз", "الآن")) : `${T(OUTCOME[last.outcome] || L(last.outcome || last.status, last.outcome || last.status, last.outcome || last.status, last.outcome || last.status))} · ${last.completed_by_name || ""} · ${when(last.completed_at)}`}</small>}</div>; })}</section>

          <details data-history><summary><b>{T(L("History", "История", "Історія", "السجل"))}</b> <small className="faint">({d.events.length})</small></summary>
            <div style={{ display: "grid", gap: 2, marginTop: 6 }}>{d.events.map((e: any, i: number) => <small key={i}><span className="mono faint">{when(e.at)}</span> · {T(EVENT[e.kind] || L(e.kind, e.kind, e.kind, e.kind))}{e.step ? ` · ${e.step}` : ""}{e.actor_name ? ` · ${e.actor_name}` : ""}{e.detail?.reason ? ` · ${e.detail.reason}` : ""}{e.detail?.note ? ` · ${e.detail.note}` : ""}</small>)}</div></details>

          {d.links.length > 0 && <section style={{ display: "grid", gap: 2 }}><b>{T(L("Linked records", "Связанные записи", "Пов'язані записи", "سجلات مرتبطة"))}</b>{d.links.map((l: any) => <small key={l.record_id}><span className="chip">{l.kind}</span> <Link href={href(l.section, l.record_id)}>{l.number ? `${l.number} · ` : ""}{l.title}</Link> <span className="faint">{l.status}</span></small>)}</section>}

          {d.can_cancel && <div className="toolbar" style={{ gap: 6 }}><input placeholder={T(L("Why cancel (required)", "Почему отменить (обязательно)", "Чому скасувати (обов'язково)", "سبب الإلغاء (مطلوب)"))} value={note} onChange={(e) => setNote(e.target.value)} aria-label="cancel reason" />
            <button className="btn ghost neg sm" disabled={busy || !note.trim()} data-cancel onClick={() => run(() => ops.cancel(d.id, note))}>{T(L("Cancel the process", "Отменить процесс", "Скасувати процес", "إلغاء العملية"))}</button></div>}
        </>}
      </div>
    </div>);
}

/* ------------------------------------------------ Process builder (B3) ------------------------------------------------ */
const TYPES = ["TASK", "REVIEW", "APPROVAL", "DOCUMENT", "DECISION", "DATA", "WAIT", "AUTOMATION", "CHECK"];
function Builder() {
  const { lang, me, toast } = useApp(); const T = (x: T4, v?: any) => say(x, lang, v);
  const [defs, setDefs] = useState<any[] | null>(null); const [sel, setSel] = useState<any>(null); const [errs, setErrs] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [tick, setTick] = useState(0);
  const [cfg, setCfg] = useState<any>(null); const [cfgText, setCfgText] = useState("");
  useEffect(() => { ops.definitions().then(setDefs).catch((e) => setMsg(e.message)); ops.settings().then((c) => { setCfg(c); setCfgText(JSON.stringify(c?.value || {}, null, 1)); }).catch(() => {}); }, [tick]);
  const codes = useMemo(() => [...new Set((defs || []).map((d) => d.code))], [defs]);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setMsg(""); try { const r = await fn(); if (r?.errors) setErrs(r.errors); if (r?.ok === false) setMsg(T(L("Not published: fix the problems below.", "Не опубликовано: исправьте проблемы ниже.", "Не опубліковано: виправте проблеми нижче.", "لم يُنشر: أصلح المشكلات أدناه."))); setTick((t) => t + 1); return r; } catch (e: any) { setMsg(e.message); } finally { setBusy(false); } };
  if (!defs) return <div className="card empty">{msg || "…"}</div>;
  const draft = sel && sel.state === "draft";
  const setStep = (i: number, patch: any) => setSel((s: any) => ({ ...s, steps: s.steps.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) }));
  const move = (i: number, dir: number) => setSel((s: any) => { const a = [...s.steps]; const j = i + dir; if (j < 0 || j >= a.length) return s; [a[i], a[j]] = [a[j], a[i]]; return { ...s, steps: a }; });
  return <div style={{ display: "grid", gap: 12 }}>
    <div className="card"><div className="card-h"><h2><Icon n="git" />{T(L("Processes", "Процессы", "Процеси", "العمليات"))}</h2></div>
      <p className="muted" style={{ margin: "0 16px 8px" }}><small>{T(L("A process is an ordered list of steps. A published version never changes: make a new version; running processes keep the version they started on. Conditions are chosen from fields and operators — no code.", "Процесс — упорядоченный список шагов. Опубликованная версия не меняется: создайте новую; запущенные процессы остаются на своей версии. Условия выбираются из полей и операторов — без кода.", "Процес — впорядкований список кроків. Опублікована версія не змінюється: створіть нову; запущені процеси лишаються на своїй версії. Умови обираються з полів і операторів — без коду.", "العملية قائمة مرتبة من الخطوات. لا تتغير النسخة المنشورة: أنشئ نسخة جديدة؛ تبقى العمليات الجارية على نسختها. تُختار الشروط من الحقول والعوامل — بلا برمجة."))}</small></p>
      <div className="feed">{codes.map((c) => { const vs = defs.filter((d) => d.code === c); const top = vs[0];
        return <div key={c} data-def={c} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", flexWrap: "wrap" }}><b className="mono">{c}</b><span style={{ flex: 1 }}>{top.name}</span>
          {vs.map((v) => <button key={v.id} className={`chip ${v.state === "published" ? "c-ok" : v.state === "draft" ? "c-warn" : ""}`} onClick={() => { setSel(JSON.parse(JSON.stringify(v))); setErrs([]); }}>v{v.version} {v.state}{v.running ? ` · ${v.running}` : ""}</button>)}
          {!vs.some((v) => v.state === "draft") && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => ops.newVersion(c))}>{T(L("New version", "Новая версия", "Нова версія", "نسخة جديدة"))}</button>}
          {vs.some((v) => v.state === "published") && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => ops.enable(c, false))}>{T(L("Switch off", "Отключить", "Вимкнути", "إيقاف"))}</button>}
          {vs.some((v) => v.state === "disabled") && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => ops.enable(c, true))}>{T(L("Switch on", "Включить", "Увімкнути", "تشغيل"))}</button>}</div>; })}</div></div>
    {msg && <div className="neg" role="alert">{msg}</div>}
    {sel && <div className="card" data-editor={sel.code}><div className="card-h"><h2>{sel.code} · v{sel.version} <span className="chip">{sel.state}</span></h2><button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setSel(null)}><Icon n="x" /></button></div>
      <div style={{ display: "grid", gap: 8, padding: 16 }}>
        <label className="fld"><span>{T(L("Name", "Название", "Назва", "الاسم"))}</span><input disabled={!draft} value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} /></label>
        {sel.steps.map((s: any, i: number) => <div key={i} className="card" data-edit-step={s.id} style={{ padding: 8, display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          <label className="fld"><span>id</span><input disabled={!draft} value={s.id} onChange={(e) => setStep(i, { id: e.target.value })} /></label>
          <label className="fld"><span>{T(L("Name", "Название", "Назва", "الاسم"))}</span><input disabled={!draft} value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} /></label>
          <label className="fld"><span>{T(L("Type", "Тип", "Тип", "النوع"))}</span><select disabled={!draft} value={s.type} onChange={(e) => setStep(i, { type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{T(STEP_TYPE[t])}</option>)}</select></label>
          <label className="fld"><span>{T(L("Responsible", "Ответственный", "Відповідальний", "المسؤول"))}</span><select disabled={!draft} value={s.responsible?.kind || ""} onChange={(e) => setStep(i, { responsible: e.target.value ? { ...(s.responsible || {}), kind: e.target.value } : undefined })}>
            <option value="">—</option>{["requester", "role", "department_lead", "project_manager", "workflow_owner", "field"].map((k) => <option key={k}>{k}</option>)}</select></label>
          {s.responsible?.kind === "role" && <label className="fld"><span>role</span><input disabled={!draft} value={s.responsible.role || ""} onChange={(e) => setStep(i, { responsible: { ...s.responsible, role: e.target.value } })} /></label>}
          <label className="fld"><span>SLA</span><span style={{ display: "flex", gap: 4 }}><input disabled={!draft} type="number" style={{ width: 70 }} value={s.sla?.amount ?? ""} onChange={(e) => setStep(i, { sla: e.target.value ? { unit: s.sla?.unit || "business_days", amount: Number(e.target.value) } : undefined })} />
            <select disabled={!draft} value={s.sla?.unit || "business_days"} onChange={(e) => setStep(i, { sla: { amount: s.sla?.amount || 1, unit: e.target.value } })}><option value="hours">hours</option><option value="business_days">business days</option><option value="calendar_days">calendar days</option></select></span></label>
          <label className="fld"><span>{T(L("Record status", "Статус записи", "Статус запису", "حالة السجل"))}</span><input disabled={!draft} value={s.record_status || ""} onChange={(e) => setStep(i, { record_status: e.target.value || undefined })} /></label>
          <details style={{ gridColumn: "1 / -1" }}><summary><small>{T(L("Transitions, rules and settings (JSON)", "Переходы, правила и настройки (JSON)", "Переходи, правила та налаштування (JSON)", "الانتقالات والقواعد والإعدادات (JSON)"))}</small></summary>
            <textarea disabled={!draft} rows={5} style={{ width: "100%", fontFamily: "monospace" }} defaultValue={JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => !["id", "name", "type", "responsible", "sla", "record_status"].includes(k))), null, 1)}
              onBlur={(e) => { try { const extra = JSON.parse(e.target.value || "{}"); setStep(i, { ...Object.fromEntries(Object.keys(s).filter((k) => !["id", "name", "type", "responsible", "sla", "record_status"].includes(k)).map((k) => [k, undefined])), ...extra }); } catch { setMsg("JSON?"); } }} /></details>
          {draft && <div className="toolbar" style={{ gap: 4, gridColumn: "1 / -1" }}><button className="btn ghost sm" onClick={() => move(i, -1)}>↑</button><button className="btn ghost sm" onClick={() => move(i, 1)}>↓</button>
            <button className="btn ghost sm neg" onClick={() => setSel((x: any) => ({ ...x, steps: x.steps.filter((_: any, j: number) => j !== i) }))}><Icon n="x" /></button></div>}
        </div>)}
        {draft && <button className="btn ghost sm" onClick={() => setSel((x: any) => ({ ...x, steps: [...x.steps, { id: `step${x.steps.length + 1}`, name: "New step", type: "TASK", responsible: { kind: "requester" } }] }))}><Icon n="plus" />{T(L("Add step", "Добавить шаг", "Додати крок", "إضافة خطوة"))}</button>}
        {errs.length > 0 && <ul className="neg" data-errors>{errs.map((e, i) => <li key={i}>{e.message}</li>)}</ul>}
        {draft && <div className="toolbar" style={{ gap: 8 }}>
          <button className="btn ghost" disabled={busy} data-validate onClick={async () => { const e = await ops.validate({ ...sel, steps: sel.steps.map((s: any) => JSON.parse(JSON.stringify(s))) }).catch((x) => [{ message: x.message }]); setErrs(e || []); if (!e?.length) toast(T(L("No problems found", "Проблем нет", "Проблем немає", "لا مشكلات"))); }}>{T(L("Validate", "Проверить", "Перевірити", "تحقق"))}</button>
          <button className="btn ghost" disabled={busy} onClick={() => run(() => ops.saveDefinition({ id: sel.id, name: sel.name, steps: sel.steps }))}>{T(L("Save draft", "Сохранить черновик", "Зберегти чернетку", "حفظ المسودة"))}</button>
          <button className="btn" disabled={busy} data-publish onClick={async () => { await ops.saveDefinition({ id: sel.id, name: sel.name, steps: sel.steps }).catch(() => null); const r = await run(() => ops.publish(sel.id)); if (r?.ok) { toast(T(L("Published", "Опубликовано", "Опубліковано", "نُشر"))); setSel(null); } }}>{T(L("Publish", "Опубликовать", "Опублікувати", "نشر"))}</button></div>}
      </div></div>}
    {cfg && <div className="card"><div className="card-h"><h2><Icon n="key" />{T(L("Approval authority and operations settings", "Полномочия согласования и настройки операций", "Повноваження погодження та налаштування операцій", "صلاحيات الموافقة وإعدادات العمليات"))}</h2></div>
      <div style={{ display: "grid", gap: 8, padding: 16 }}>
        {(cfg.policies || []).map((p: any) => <details key={p.code}><summary><b className="mono">{p.code}</b> {p.name} · v{p.version} {p.active ? "" : "(off)"}</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{p.tiers.map((t: any) => `${t.label || ""} [${t.mode || "sequential"}]: ${(t.steps || []).map((s: any) => s.label || s.role || s.kind).join(" → ")}${t.when ? `  (when ${JSON.stringify(t.when)})` : ""}`).join("\n")}</pre></details>)}
        {cfg.can_edit && <><label className="fld"><span>{T(L("Settings (JSON): numbering types, material fields, SLA calendar, desks, request types", "Настройки (JSON): типы нумерации, существенные поля, календарь сроков, отделы, виды заявок", "Налаштування (JSON): типи нумерації, суттєві поля, календар термінів, відділи, види заявок", "الإعدادات (JSON)"))}</span>
          <textarea rows={8} style={{ fontFamily: "monospace" }} value={cfgText} onChange={(e) => setCfgText(e.target.value)} /></label>
          <button className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const v = JSON.parse(cfgText); return ops.saveSettings(v, cfg.version); })}>{T(L("Save settings", "Сохранить настройки", "Зберегти налаштування", "حفظ الإعدادات"))}</button></>}
        {!cfg.can_edit && <small className="faint">{T(L("Owners and administrators change approval authority and settings; every change is kept in history.", "Полномочия и настройки меняют владельцы и администраторы; каждое изменение сохраняется в истории.", "Повноваження й налаштування змінюють власники та адміністратори; кожна зміна зберігається в історії.", "يغير المالكون والمسؤولون الصلاحيات والإعدادات؛ تُحفظ كل التغييرات."))}</small>}
        {me && null}
      </div></div>}
  </div>;
}
