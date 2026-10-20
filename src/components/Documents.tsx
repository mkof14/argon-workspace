"use client";
// DOCUMENT CENTER: the one place to find company documents without knowing where a file is stored. Views (all, mine,
// recent, shared with me, needs my review, needs my approval, controlled, archived), groupings by project, department
// and type, filters, sorting and search. The list comes from the database (document_center), which applies the same
// access rules as opening a document: restricted entries are not counted, filtered or found by anyone else.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { tone } from "@/lib/format";
import { CLASSIFICATIONS, DOC_STATUSES, DOC_TYPES } from "@/config/workspace.config.mjs";
import { store, type DocRow } from "@/lib/store";
import { useWork } from "./useWork";
import { deptLabel, personName, useDepartments } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const VIEWS: [string, string, T4][] = [
  ["all", "file", L("All documents", "Все документы", "Усі документи", "كل المستندات")], ["mine", "user", L("My documents", "Мои", "Мої", "مستنداتي")],
  ["recent", "clock", L("Recent", "Недавние", "Нещодавні", "الأحدث")], ["shared", "users", L("Shared with me", "Доступные мне", "Доступні мені", "مشترك معي")],
  ["review", "eye", L("Needs review", "Ждут проверки", "Чекають перевірки", "بانتظار المراجعة")], ["approval", "check", L("Needs approval", "Ждут согласования", "Чекають погодження", "بانتظار الموافقة")],
  ["by-project", "layers", L("Projects", "Проекты", "Проєкти", "المشاريع")], ["by-dept", "building", L("Departments", "Отделы", "Відділи", "الأقسام")], ["by-type", "tag", L("Document types", "Типы", "Типи", "الأنواع")],
  ["controlled", "lock", L("Controlled", "Контролируемые", "Контрольовані", "خاضعة للرقابة")], ["archived", "box", L("Archived", "Архив", "Архів", "المؤرشفة")],
];
const APPROVAL: Record<string, T4> = { none: L("—", "—", "—", "—"), pending: L("Waiting", "Ждёт", "Чекає", "بانتظار"), queued: L("Next step", "Следующий этап", "Наступний етап", "الخطوة التالية"), approved: L("Approved", "Согласовано", "Погоджено", "موافق عليه"), rejected: L("Rejected", "Отклонено", "Відхилено", "مرفوض"), changes_requested: L("Changes requested", "Нужны изменения", "Потрібні зміни", "تغييرات مطلوبة"), invalidated: L("Superseded by a new version", "Заменено новой версией", "Замінено новою версією", "حلت محلها نسخة جديدة") };
const qs = (k: string) => (typeof window !== "undefined" ? new URLSearchParams(location.search).get(k) || "" : "");

export default function Documents() {
  const { lang, access, people, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const w = useWork(); const depts = useDepartments();
  useEffect(() => { const d = qs("d"); if (d) location.replace(`/company/documents?r=${d}${qs("page") ? `&page=${qs("page")}` : ""}`); }, []);
  const [view, setView] = useState(() => qs("view") || "all");
  const [q, setQ] = useState(() => qs("q")); const [dq, setDq] = useState(q);
  const [f, setF] = useState({ project: qs("project"), department: "", owner: "", type: "", status: "", approval: "", classification: "", from: "", to: "", version: "" });
  const [sort, setSort] = useState("updated"); const [layout, setLayout] = useState<"table" | "list">(() => { try { return (localStorage.getItem("agron.docs.layout") as any) || "table"; } catch { return "table"; } });
  const [rows, setRows] = useState<DocRow[]>([]); const [total, setTotal] = useState(0); const [busy, setBusy] = useState(true); const [more, setMore] = useState(false); const [err, setErr] = useState("");
  const tmr = useRef<any>(null);
  useEffect(() => { clearTimeout(tmr.current); tmr.current = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(tmr.current); }, [q]);
  const grouped = view.startsWith("by-");
  const load = async (offset = 0) => {
    setBusy(true); setErr("");
    try {
      const r = await store.documentCenter({ view: grouped ? "all" : view, q: dq || undefined, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), sort, limit: grouped ? 200 : 50, offset });
      setRows(offset ? [...rows, ...r.rows] : r.rows); setTotal(r.total); setMore(offset + r.rows.length < r.total);
    } catch (e: any) { setErr(e.message || "Error"); } finally { setBusy(false); }
  };
  useEffect(() => { load(0); }, [view, dq, sort, tick, JSON.stringify(f)]); // eslint-disable-line
  useEffect(() => { try { localStorage.setItem("agron.docs.layout", layout); } catch {} }, [layout]);
  const go = (k: string) => { setView(k); try { const u = new URL(location.href); u.searchParams.set("view", k); history.replaceState(history.state, "", u.toString()); } catch {} };
  const owner = (d: DocRow) => personName(people.find((p) => p.id === d.owner_id)) || d.owner || "—";
  const proj = (id?: string) => w.projects.find((p) => p.id === id)?.title;
  const groups = useMemo(() => {
    if (!grouped) return null; const m = new Map<string, DocRow[]>();
    for (const d of rows) { const k = view === "by-project" ? proj(d.project_ref) || d.project || T(L("No project", "Без проекта", "Без проєкту", "بلا مشروع")) : view === "by-dept" ? deptLabel(d.department, lang as Lang) || T(L("No department", "Без отдела", "Без відділу", "بلا قسم")) : d.doc_type || "—"; m.set(k, [...(m.get(k) || []), d]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, view, lang, w.projects]); // eslint-disable-line
  const can = access.write.has("company.documents");
  const filtersOn = Object.values(f).some(Boolean) || !!dq;
  if (!access.read.has("company.documents")) return <div className="card empty">{T(L("No access to the document register.", "Нет доступа к реестру документов.", "Немає доступу до реєстру документів.", "لا وصول إلى سجل المستندات."))}</div>;
  const Item = ({ d }: { d: DocRow }) => <Link href={`/company/documents?r=${d.id}`} className="doc-item" data-doc={d.id}>
    <span className="doc-num mono">{d.doc_number || "—"}</span>
    <span className="doc-main"><b>{(d.controlled || d.classification === "Restricted") && <Icon n="lock" className="lockico" />} {d.title}</b>
      <small>{[d.doc_type, proj(d.project_ref) || d.project, deptLabel(d.department, lang as Lang), owner(d)].filter(Boolean).join(" · ")}</small></span>
    <span className="doc-meta"><span className="chip mono">v{d.version || "—"}</span><span className={`chip dot ${tone(d.status || "")}`}>{d.status}</span>
      {d.classification && d.classification !== "Internal" && <span className={`chip ${d.classification === "Confidential" ? "" : "c-warn"}`}>{d.classification}</span>}
      {d.approval !== "none" && <span className={`chip ${d.approval === "approved" ? "c-ok" : d.approval === "pending" || d.approval === "queued" ? "c-info" : "c-warn"}`}>{T(APPROVAL[d.approval] || APPROVAL.none)}</span>}
      <small className="faint mono">{String(d.updated_at).slice(0, 10)}</small></span></Link>;
  const Table = ({ list }: { list: DocRow[] }) => <div className="tablewrap"><table className="tb doc-table"><thead><tr>
    <th>{T(L("Number", "Номер", "Номер", "الرقم"))}</th><th>{T(L("Title", "Название", "Назва", "العنوان"))}</th><th>{T(L("Type", "Тип", "Тип", "النوع"))}</th><th>{T(L("Project", "Проект", "Проєкт", "المشروع"))}</th>
    <th className="col-dept">{T(L("Department", "Отдел", "Відділ", "القسم"))}</th><th>{T(L("Owner", "Владелец", "Власник", "المالك"))}</th><th>{T(L("Version", "Версия", "Версія", "الإصدار"))}</th>
    <th>{T(L("Status", "Статус", "Статус", "الحالة"))}</th><th>{T(L("Classification", "Гриф", "Гриф", "التصنيف"))}</th><th>{T(L("Approval", "Согласование", "Погодження", "الموافقة"))}</th><th className="col-upd">{T(L("Modified", "Изменён", "Змінено", "عُدّل"))}</th></tr></thead>
    <tbody>{list.map((d) => <tr key={d.id} className="row" tabIndex={0} data-doc={d.id} onClick={() => (location.href = `/company/documents?r=${d.id}`)} onKeyDown={(e) => e.key === "Enter" && (location.href = `/company/documents?r=${d.id}`)}>
      <td className="mono">{d.doc_number || "—"}</td>
      <td style={{ fontWeight: 600 }}>{(d.controlled || d.classification === "Restricted") && <Icon n="lock" className="lockico" />} <Link href={`/company/documents?r=${d.id}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>{d.title}</Link></td>
      <td>{d.doc_type}</td><td>{d.project_ref ? <Link href={`/projects/${d.project_ref}?tab=documents`} onClick={(e) => e.stopPropagation()}>{proj(d.project_ref) || d.project || "—"}</Link> : ""}</td>
      <td className="col-dept">{deptLabel(d.department, lang as Lang)}</td><td>{owner(d)}</td>
      <td className="mono">{d.version || "—"}{d.approved_version && d.approved_version !== d.version ? <small className="faint"> ({T(L("approved", "утв.", "погодж.", "معتمد"))} {d.approved_version})</small> : null}</td>
      <td><span className={`chip dot ${tone(d.status || "")}`}>{d.status}</span></td><td>{d.classification}</td><td>{T(APPROVAL[d.approval] || APPROVAL.none)}</td>
      <td className="faint mono col-upd" style={{ fontSize: 13 }}>{String(d.updated_at).slice(0, 10)}</td></tr>)}</tbody></table></div>;
  return <div className="doc-center" style={{ display: "grid", gap: 16, ["--dc" as any]: "#2F7DF6" }}>
    <section className="sec-hero"><span className="ic"><Icon n="file" /></span>
      <div style={{ minWidth: 0, position: "relative", zIndex: 1 }}><div className="eyebrow">{T(L("Company", "Компания", "Компанія", "الشركة"))}</div><h2>{T(L("Documents", "Документы", "Документи", "المستندات"))}</h2>
        <div className="sub"><b className="mono" data-total>{total}</b> {filtersOn || view !== "all" ? T(L("match", "найдено", "знайдено", "مطابقة")) : T(L("documents you can open", "документов, доступных вам", "документів, доступних вам", "مستند يمكنك فتحه"))}</div>
        <div className="sec-desc">{T(L("Every company document in one register: find it by number, name, project, department, type or owner — you never need to know where the file is stored. Open it for versions, review, approval and discussion.", "Все документы компании в одном реестре: ищите по номеру, названию, проекту, отделу, типу или владельцу — знать, где лежит файл, не нужно. Откройте документ, чтобы увидеть версии, проверку, согласование и обсуждение.", "Усі документи компанії в одному реєстрі: шукайте за номером, назвою, проєктом, відділом, типом або власником — знати, де лежить файл, не треба. Відкрийте документ, щоб побачити версії, перевірку, погодження й обговорення.", "كل مستندات الشركة في سجل واحد: ابحث بالرقم أو الاسم أو المشروع أو القسم أو النوع أو المالك — لا تحتاج إلى معرفة مكان الملف. افتح المستند لرؤية الإصدارات والمراجعة والموافقة والنقاش."))}</div></div></section>
    <div className="toolbar">{can && <Link className="btn primary" href={`/company/documents?new=1${f.project ? `&project_ref=${f.project}&project_ref_title=${encodeURIComponent(proj(f.project) || "")}` : ""}`}><Icon n="upload" />{T(L("New document", "Новый документ", "Новий документ", "مستند جديد"))}</Link>}
      <Link className="btn ghost sm" href="/ask"><Icon n="search" />{T(L("Search inside documents", "Поиск по содержанию", "Пошук у змісті", "ابحث داخل المستندات"))}</Link>
      <span style={{ flex: 1 }} /><div className="seg" role="group" aria-label={T(L("Layout", "Вид", "Вигляд", "العرض"))}><button className={layout === "table" ? "on" : ""} onClick={() => setLayout("table")}><Icon n="list" />{T(L("Table", "Таблица", "Таблиця", "جدول"))}</button><button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")}><Icon n="cols" />{T(L("List", "Список", "Список", "قائمة"))}</button></div></div>
    <nav className="tabs card doc-views" role="tablist">{VIEWS.map(([k, ic, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} data-view={k} onClick={() => go(k)}><Icon n={ic} />{T(l)}</button>)}</nav>
    <section className="card">
      <div className="filters doc-filters">
        <div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T(L("Number, title, description, tags", "Номер, название, описание, метки", "Номер, назва, опис, мітки", "الرقم أو العنوان أو الوصف أو الوسوم"))} aria-label={T(L("Search documents", "Поиск документов", "Пошук документів", "ابحث في المستندات"))} /></div>
        <select className="input" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} aria-label={T(L("Project", "Проект", "Проєкт", "المشروع"))}><option value="">{T(L("All projects", "Все проекты", "Усі проєкти", "كل المشاريع"))}</option>{w.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
        <select className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} aria-label={T(L("Department", "Отдел", "Відділ", "القسم"))}><option value="">{T(L("All departments", "Все отделы", "Усі відділи", "كل الأقسام"))}</option>{depts.map((d) => <option key={d.key} value={d.key}>{d.label?.[lang] || d.name}</option>)}</select>
        <select className="input" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} aria-label={T(L("Owner", "Владелец", "Власник", "المالك"))}><option value="">{T(L("Any owner", "Любой владелец", "Будь-який власник", "أي مالك"))}</option>{people.filter((p) => !p.disabled && !["partner", "vendor", "investor", "pending"].includes(p.role)).map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}</select>
        <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label={T(L("Type", "Тип", "Тип", "النوع"))}><option value="">{T(L("All types", "Все типы", "Усі типи", "كل الأنواع"))}</option>{DOC_TYPES.map((x: string) => <option key={x}>{x}</option>)}</select>
        <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label={T(L("Status", "Статус", "Статус", "الحالة"))}><option value="">{T(L("Any status", "Любой статус", "Будь-який статус", "أي حالة"))}</option>{DOC_STATUSES.map((x: string) => <option key={x}>{x}</option>)}</select>
        <select className="input" value={f.approval} onChange={(e) => setF({ ...f, approval: e.target.value })} aria-label={T(L("Approval", "Согласование", "Погодження", "الموافقة"))}><option value="">{T(L("Any approval state", "Любое согласование", "Будь-яке погодження", "أي حالة موافقة"))}</option>{Object.keys(APPROVAL).map((k) => <option key={k} value={k}>{T(APPROVAL[k])}</option>)}</select>
        <select className="input" value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value })} aria-label={T(L("Classification", "Гриф", "Гриф", "التصنيف"))}><option value="">{T(L("Any classification", "Любой гриф", "Будь-який гриф", "أي تصنيف"))}</option>{CLASSIFICATIONS.map((x: string) => <option key={x}>{x}</option>)}</select>
        <input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label={T(L("Modified from", "Изменён с", "Змінено з", "عُدّل من"))} />
        <input className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label={T(L("Modified to", "Изменён по", "Змінено по", "عُدّل حتى"))} />
        <input className="input" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value.trim() })} placeholder={T(L("Version", "Версия", "Версія", "الإصدار"))} aria-label={T(L("Version", "Версия", "Версія", "الإصدار"))} style={{ maxWidth: 90 }} />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={T(L("Sort", "Сортировка", "Сортування", "الترتيب"))}><option value="updated">{T(L("Newest first", "Сначала новые", "Спочатку нові", "الأحدث أولاً"))}</option><option value="number">{T(L("By number", "По номеру", "За номером", "حسب الرقم"))}</option><option value="title">{T(L("By title", "По названию", "За назвою", "حسب العنوان"))}</option></select>
        {filtersOn && <button className="btn ghost sm" onClick={() => { setF({ project: "", department: "", owner: "", type: "", status: "", approval: "", classification: "", from: "", to: "", version: "" }); setQ(""); }}><Icon n="x" />{T(L("Clear", "Сбросить", "Скинути", "مسح"))}</button>}
      </div>
      {err ? <div className="empty">{err}</div> : busy && !rows.length ? <div className="empty">…</div> : !rows.length ? <div className="empty">{filtersOn || view !== "all" ? T(L("No document matches.", "Подходящих документов нет.", "Відповідних документів немає.", "لا مستند مطابق.")) : T(L("The register is empty. Add the first document.", "Реестр пуст. Добавьте первый документ.", "Реєстр порожній. Додайте перший документ.", "السجل فارغ. أضف أول مستند."))}</div>
        : groups ? groups.map(([g, list]) => <details key={g} open className="doc-group"><summary><b>{g}</b> <span className="chip mono">{list.length}</span></summary>{layout === "table" ? <Table list={list} /> : <div className="doc-list">{list.map((d) => <Item key={d.id} d={d} />)}</div>}</details>)
        : layout === "table" ? <Table list={rows} /> : <div className="doc-list">{rows.map((d) => <Item key={d.id} d={d} />)}</div>}
      {more && !grouped && <div className="toolbar" style={{ padding: 12 }}><button className="btn sm" disabled={busy} onClick={() => load(rows.length)}>{T(L("Show more", "Показать ещё", "Показати ще", "عرض المزيد"))} ({total - rows.length})</button></div>}
    </section>
    <style>{`.lockico{width:15px;height:15px;color:var(--warn);vertical-align:-2px}`}</style>
  </div>;
}
