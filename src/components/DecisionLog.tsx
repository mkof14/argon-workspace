"use client";
// DECISIONS: the company decision log (company.decisions records — no second database). Each decision with its
// number, date, who made it, project, where it came from (project discussion, meeting, approval, management entry),
// the related document and task, the responsible person and due date. Linked titles show only where the person may
// open the linked record.
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { tone } from "@/lib/format";
import { store } from "@/lib/store";
import { useWork } from "./useWork";
import { personName } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const SRC: Record<string, T4> = { approval: L("Approval", "Согласование", "Погодження", "موافقة"), discussion: L("Project discussion", "Обсуждение проекта", "Обговорення проєкту", "نقاش المشروع"),
  "company.meetings": L("Meeting", "Встреча", "Зустріч", "اجتماع"), "company.projects": L("Project discussion", "Обсуждение проекта", "Обговорення проєкту", "نقاش المشروع"), management: L("Management entry", "Запись руководства", "Запис керівництва", "إدخال الإدارة") };
const link = (s: string, id: string) => (s === "company.projects" ? `/projects/${id}` : s === "company.documents" ? `/documents?d=${id}` : `/${s.replace(".", "/")}?r=${id}`);

export default function DecisionLog() {
  const { lang, people, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang); const w = useWork();
  const [q, setQ] = useState(""); const [project, setProject] = useState(""); const [status, setStatus] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { const h = setTimeout(() => store.decisionLog({ q: q.trim() || undefined, project: project || undefined, status: status || undefined }).then(setRows).catch(() => setRows([])), 200); return () => clearTimeout(h); }, [q, project, status, tick]);
  const who = (id?: string) => personName(people.find((p) => p.id === id)) || "—";
  return <section className="card decision-log">
    <div className="card-h toolbar"><h2><Icon n="stamp" />{T(L("Decision log", "Журнал решений", "Журнал рішень", "سجل القرارات"))}</h2></div>
    <div className="filters"><div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T(L("Number or words", "Номер или слова", "Номер або слова", "الرقم أو الكلمات"))} aria-label={T(L("Search decisions", "Поиск решений", "Пошук рішень", "ابحث في القرارات"))} /></div>
      <select className="input" value={project} onChange={(e) => setProject(e.target.value)} aria-label={T(L("Project", "Проект", "Проєкт", "المشروع"))}><option value="">{T(L("All projects", "Все проекты", "Усі проєкти", "كل المشاريع"))}</option>{w.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={T(L("Status", "Статус", "Статус", "الحالة"))}><option value="">{T(L("Any status", "Любой статус", "Будь-який статус", "أي حالة"))}</option>{["Proposed", "Approved", "Rejected", "Superseded"].map((s) => <option key={s}>{s}</option>)}</select></div>
    {rows === null ? <div className="empty">…</div> : !rows.length ? <div className="empty">{T(L("No decisions yet. A message marked Decision, a meeting decision or an approved document adds one.", "Решений пока нет. Их добавляет сообщение с отметкой «Решение», решение встречи или согласованный документ.", "Рішень ще немає. Їх додає повідомлення з позначкою «Рішення», рішення зустрічі або погоджений документ.", "لا قرارات بعد. تضيفها رسالة معلّمة «قرار» أو قرار اجتماع أو مستند معتمد."))}</div>
      : <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("ID", "Номер", "Номер", "الرقم"))}</th><th>{T(L("Decision", "Решение", "Рішення", "القرار"))}</th><th>{T(L("Date", "Дата", "Дата", "التاريخ"))}</th><th>{T(L("Made by", "Кто принял", "Хто ухвалив", "صاحب القرار"))}</th><th>{T(L("Project", "Проект", "Проєкт", "المشروع"))}</th><th>{T(L("Source", "Источник", "Джерело", "المصدر"))}</th><th>{T(L("Document / task", "Документ / задача", "Документ / задача", "مستند / مهمة"))}</th><th>{T(L("Responsible · due", "Ответственный · срок", "Відповідальний · термін", "المسؤول · الموعد"))}</th><th>{T(L("Status", "Статус", "Статус", "الحالة"))}</th></tr></thead>
        <tbody>{rows.map((d) => <tr key={d.id} data-decision={d.id}><td className="mono"><Link href={`/company/decisions?r=${d.id}`}>{d.number || "—"}</Link></td>
          <td><b>{d.title}</b>{d.decision && <div className="faint" style={{ fontSize: 13, maxWidth: 420 }}>{String(d.decision).slice(0, 220)}</div>}</td><td className="mono">{d.date}</td><td>{who(d.made_by)}</td>
          <td>{d.project ? <Link href={`/projects/${d.project.id}`}>{d.project.title}</Link> : ""}</td>
          <td>{T(SRC[d.source?.section] || SRC[d.source_kind] || SRC.management)}{d.source ? <> · <Link href={link(d.source.section, d.source.id)}>{d.source.title}</Link></> : null}</td>
          <td>{d.document && <div><Link href={`/documents?d=${d.document.id}`}>{d.document.number ? `${d.document.number} · ` : ""}{d.document.title}</Link></div>}{d.task && <div><Link href={`/company/tasks?r=${d.task.id}`}>{d.task.title}</Link> <span className={`chip dot ${tone(d.task.status)}`}>{d.task.status}</span></div>}</td>
          <td>{d.responsible ? who(d.responsible) : "—"}{d.due ? ` · ${d.due}` : ""}</td><td><span className={`chip dot ${tone(d.status)}`}>{d.status}</span></td></tr>)}</tbody></table></div>}
  </section>;
}
