"use client";
// DOCUMENTS: the company register. Each entry is a record (type, project, department, owner, status, version) with its
// files attached — uploading the same file again adds a version, earlier versions stay. Access is checked by the
// database for every entry and every file (US-persons-only entries and their files stay closed to others).
import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { tone } from "@/lib/format";
import { DOC_TYPES } from "@/config/workspace.config.mjs";
import { useWork } from "./useWork";
import { deptLabel, personName } from "./PeopleFields";
import { ORG_DEPTS } from "@/config/workspace.config.mjs";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

export default function Documents() {
  const { lang, access, people, openIntake } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const w = useWork();
  const [q, setQ] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("q") || "" : ""));
  const [type, setType] = useState(""); const [proj, setProj] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("project") || "" : ""));
  const [dept, setDept] = useState(""); const [st, setSt] = useState("");
  const docs = useMemo(() => w.documents.filter((d) => (!type || d.data?.doc_type === type) && (!proj || d.data?.project_ref === proj) && (!dept || d.data?.department === dept) && (!st || d.status === st)
    && (!q || `${d.title} ${d.data?.description || ""} ${d.data?.doc_type || ""} ${d.data?.project_ref_title || ""} ${d.data?.owner || ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))), [w.documents, q, type, proj, dept, st]);
  const can = access.write.has("company.documents");
  const owner = (d: any) => personName(people.find((p) => p.id === d.data?.owner_id)) || d.data?.owner || "—";
  if (!access.read.has("company.documents")) return <div className="card empty">{T(L("No access to the document register.", "Нет доступа к реестру документов.", "Немає доступу до реєстру документів.", "لا وصول إلى سجل المستندات."))}</div>;
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#2F7DF6" }}>
    <section className="sec-hero"><span className="ic"><Icon n="file" /></span>
      <div style={{ minWidth: 0, position: "relative", zIndex: 1 }}><div className="eyebrow">{T(L("Company", "Компания", "Компанія", "الشركة"))}</div><h2>{T(L("Documents", "Документы", "Документи", "المستندات"))}</h2>
        <div className="sub"><b className="mono">{w.documents.length}</b> {T(L("documents in the register", "документов в реестре", "документів у реєстрі", "مستند في السجل"))}</div>
        <div className="sec-desc">{T(L("Contracts, NDAs, specifications, budgets, quotations, certificates, minutes and reports — find by name, project, department or type. Open a document to preview, download, see versions, send it for approval and discuss it.", "Договоры, NDA, спецификации, бюджеты, КП поставщиков, сертификаты, протоколы и отчёты — ищите по названию, проекту, отделу или типу. Откройте документ, чтобы посмотреть, скачать, увидеть версии, отправить на согласование и обсудить.", "Договори, NDA, специфікації, бюджети, пропозиції постачальників, сертифікати, протоколи й звіти — шукайте за назвою, проєктом, відділом або типом. Відкрийте документ, щоб переглянути, завантажити, побачити версії, надіслати на погодження й обговорити.", "العقود واتفاقيات السرية والمواصفات والميزانيات وعروض الموردين والشهادات والمحاضر والتقارير — ابحث بالاسم أو المشروع أو القسم أو النوع. افتح المستند للمعاينة والتنزيل ورؤية الإصدارات وإرساله للموافقة ومناقشته."))}</div></div></section>
    <div className="toolbar">{can && <Link className="btn primary" href={`/company/documents?new=1${proj ? `&project_ref=${proj}&project_ref_title=${encodeURIComponent(w.projects.find((p) => p.id === proj)?.title || "")}` : ""}`}><Icon n="upload" />{T(L("Add a document", "Добавить документ", "Додати документ", "إضافة مستند"))}</Link>}
      <button className="btn ghost sm" onClick={() => openIntake()}><Icon n="spark" />{T(L("Smart upload", "Умная загрузка", "Розумне завантаження", "رفع ذكي"))}</button>
      <Link className="btn ghost sm" href="/ask"><Icon n="search" />{T(L("Search inside documents", "Поиск по содержанию", "Пошук у змісті", "ابحث داخل المستندات"))}</Link></div>
    <section className="card">
      <div className="filters">
        <div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T(L("Document name", "Название документа", "Назва документа", "اسم المستند"))} aria-label={T(L("Search documents", "Поиск документов", "Пошук документів", "ابحث في المستندات"))} /></div>
        <select className="input" value={proj} onChange={(e) => setProj(e.target.value)} aria-label={T(L("Project", "Проект", "Проєкт", "المشروع"))}><option value="">{T(L("All projects", "Все проекты", "Усі проєкти", "كل المشاريع"))}</option>{w.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
        <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label={T(L("Department", "Отдел", "Відділ", "القسم"))}><option value="">{T(L("All departments", "Все отделы", "Усі відділи", "كل الأقسام"))}</option>{(ORG_DEPTS as any[]).map((d) => <option key={d.key} value={d.key}>{tx(d.label, lang as Lang)}</option>)}</select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label={T(L("Type", "Тип", "Тип", "النوع"))}><option value="">{T(L("All types", "Все типы", "Усі типи", "كل الأنواع"))}</option>{DOC_TYPES.map((x: string) => <option key={x}>{x}</option>)}</select>
        <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label={T(L("Status", "Статус", "Статус", "الحالة"))}><option value="">{T(L("Any status", "Любой статус", "Будь-який статус", "أي حالة"))}</option>{["Draft", "In review", "Approved", "Superseded", "Archived"].map((x) => <option key={x}>{x}</option>)}</select>
      </div>
      {w.loading ? <div className="empty">…</div> : !docs.length ? <div className="empty">{w.documents.length ? T(L("No document matches these filters.", "Под эти фильтры документов нет.", "Під ці фільтри документів немає.", "لا مستند يطابق هذه المرشحات.")) : T(L("The register is empty. Add the first document.", "Реестр пуст. Добавьте первый документ.", "Реєстр порожній. Додайте перший документ.", "السجل فارغ. أضف أول مستند."))}</div>
        : <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Document", "Документ", "Документ", "المستند"))}</th><th>{T(L("Type", "Тип", "Тип", "النوع"))}</th><th>{T(L("Project", "Проект", "Проєкт", "المشروع"))}</th><th>{T(L("Department", "Отдел", "Відділ", "القسم"))}</th><th>{T(L("Owner", "Владелец", "Власник", "المالك"))}</th><th>{T(L("Version", "Версия", "Версія", "الإصدار"))}</th><th>{T(L("Status", "Статус", "Статус", "الحالة"))}</th><th className="col-upd">{T(L("Updated", "Изменён", "Змінено", "حُدّث"))}</th></tr></thead>
          <tbody>{docs.map((d) => <tr key={d.id} className="row" tabIndex={0} onClick={() => (location.href = `/company/documents?r=${d.id}`)} onKeyDown={(e) => e.key === "Enter" && (location.href = `/company/documents?r=${d.id}`)}>
            <td style={{ fontWeight: 600 }}>{d.controlled && <Icon n="lock" className="lockico" />} <Link href={`/company/documents?r=${d.id}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>{d.title}</Link></td>
            <td>{d.data?.doc_type && <span className="chip">{d.data.doc_type}</span>}</td>
            <td>{d.data?.project_ref ? <Link href={`/projects/${d.data.project_ref}?tab=documents`} onClick={(e) => e.stopPropagation()}>{d.data.project_ref_title || "—"}</Link> : ""}</td>
            <td>{deptLabel(d.data?.department, lang as Lang)}</td><td>{owner(d)}</td><td className="mono">{d.data?.version || ""}</td>
            <td><span className={`chip dot ${tone(d.status)}`}>{d.status}</span></td><td className="faint mono col-upd" style={{ fontSize: 13 }}>{(d.updated_at || "").slice(0, 10)}</td></tr>)}</tbody></table></div>}
    </section>
    <style>{`.lockico{width:15px;height:15px;color:var(--warn);vertical-align:-2px}`}</style>
  </div>;
}
