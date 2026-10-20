"use client";
// A meeting from start to finish: Schedule → Prepare → Meet → Record decisions → Create tasks. Action items are
// structured (title, responsible person, deadline); each one becomes a task exactly once (the database guarantees
// it), and decisions go into the company decision log linked to the meeting and its project.
import { useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { isEmployee, personName } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export type ActionItem = { id: string; title: string; description?: string; assignee_id?: string; due?: string; task_id?: string };
const nid = () => Math.random().toString(36).slice(2, 10);

/** Where the meeting is in its flow (pure, for the stepper and tests). */
export function meetingStage(d: Record<string, any>, today = new Date().toISOString().slice(0, 10)) {
  const items: ActionItem[] = Array.isArray(d.action_items) ? d.action_items : [];
  return [
    { k: "schedule", done: !!d.date },
    { k: "prepare", done: !!String(d.agenda || "").trim() },
    { k: "meet", done: !!String(d.notes || "").trim() || (!!d.date && d.date < today) },
    { k: "decide", done: !!String(d.decisions || "").trim() },
    { k: "tasks", done: items.length > 0 && items.every((i) => i.task_id) },
  ];
}
const STEPS: Record<string, T4> = { schedule: L("Schedule", "Назначить", "Призначити", "جدولة"), prepare: L("Prepare", "Подготовить", "Підготувати", "تحضير"), meet: L("Meet", "Провести", "Провести", "الاجتماع"), decide: L("Record decisions", "Записать решения", "Записати рішення", "تسجيل القرارات"), tasks: L("Create tasks", "Создать задачи", "Створити задачі", "إنشاء المهام") };

export default function MeetingPanel({ rec, data, setData, canWrite, onDone }: { rec: Rec | null; data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void; canWrite: boolean; onDone?: () => void }) {
  const { lang, people, me, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const items: ActionItem[] = Array.isArray(data.action_items) ? data.action_items : [];
  const saved: ActionItem[] = Array.isArray(rec?.data?.action_items) ? rec!.data.action_items : [];
  const [busy, setBusy] = useState<string | null>(null);
  const set = (next: ActionItem[]) => setData((d) => ({ ...d, action_items: next }));
  const owner = !!rec && (rec.created_by === me.id || data.organizer_id === me.id || ["owner", "admin", "management"].includes(me.role));
  const toTask = async (it: ActionItem) => {
    if (!rec) return; setBusy(it.id);
    try { const id = await store.meetingActionToTask(rec.id, it.id); set(items.map((x) => (x.id === it.id ? { ...x, task_id: id } : x))); toast(T(L("Task created", "Задача создана", "Задачу створено", "أُنشئت المهمة"))); onDone?.(); }
    catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(null); }
  };
  const decide = async () => {
    if (!rec) return; const lines = String(rec.data?.decisions || "").split(/\n+/).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
    if (!lines.length) { toast(T(L("Write the decisions first and save the meeting.", "Сначала запишите решения и сохраните встречу.", "Спочатку запишіть рішення і збережіть зустріч.", "اكتب القرارات أولاً واحفظ الاجتماع.")), true); return; }
    setBusy("dec"); try { for (const l of lines) await store.recordDecision(rec.id, l); toast(T(L("Decisions added to the decision log", "Решения добавлены в журнал решений", "Рішення додано до журналу рішень", "أُضيفت القرارات إلى السجل"))); } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(null); }
  };
  const st = meetingStage(data);
  const staff = people.filter(isEmployee);
  return <div className="thread meeting-panel">
    <ol className="flow" aria-label={T(L("Meeting progress", "Ход встречи", "Хід зустрічі", "مسار الاجتماع"))}>{st.map((s, i) => <li key={s.k} className={s.done ? "done" : st.findIndex((x) => !x.done) === i ? "cur" : ""}><span className="mono">{i + 1}</span>{T(STEPS[s.k])}</li>)}</ol>
    {data.meet_url && /^https:\/\//.test(String(data.meet_url)) && <a className="btn sm" href={String(data.meet_url)} target="_blank" rel="noopener noreferrer"><Icon n="video" />{T(L("Join the call", "Подключиться", "Підключитися", "الانضمام"))}</a>}
    <div className="eyebrow">{T(L("Action items", "Поручения", "Доручення", "بنود العمل"))}</div>
    {items.map((it, i) => { const isSaved = saved.some((x) => x.id === it.id); return <div key={it.id} className="action-item" data-item={it.id}>
      <input className="input" value={it.title} disabled={!canWrite || !!it.task_id} placeholder={T(L("What needs to be done", "Что сделать", "Що зробити", "ما المطلوب"))} aria-label={T(L("Action item", "Поручение", "Доручення", "بند عمل"))} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
      <select className="input" value={it.assignee_id || ""} disabled={!canWrite || !!it.task_id} aria-label={T(L("Responsible", "Ответственный", "Відповідальний", "المسؤول"))} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, assignee_id: e.target.value || undefined } : x)))}>
        <option value="">{T(L("Responsible…", "Ответственный…", "Відповідальний…", "المسؤول…"))}</option>{staff.map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}</select>
      <input className="input" type="date" value={it.due || ""} disabled={!canWrite || !!it.task_id} aria-label={T(L("Deadline", "Срок", "Термін", "الموعد"))} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, due: e.target.value || undefined } : x)))} />
      {it.task_id ? <Link className="chip c-ok" href={`/company/tasks?r=${it.task_id}`}><Icon n="check" />{T(L("Task", "Задача", "Задача", "مهمة"))}</Link>
        : owner && <button type="button" className="btn sm" disabled={!isSaved || busy === it.id || !it.title.trim()} title={!isSaved ? T(L("Save the meeting first", "Сначала сохраните встречу", "Спочатку збережіть зустріч", "احفظ الاجتماع أولاً")) : undefined} onClick={() => toTask(it)}><Icon n="plus" />{T(L("Create task", "Создать задачу", "Створити задачу", "إنشاء مهمة"))}</button>}
      {canWrite && !it.task_id && <button type="button" className="iconbtn" aria-label={T(L("Remove", "Убрать", "Прибрати", "إزالة"))} onClick={() => set(items.filter((_, j) => j !== i))}><Icon n="x" /></button>}
    </div>; })}
    {canWrite && <div className="toolbar"><button type="button" className="btn ghost sm" onClick={() => set([...items, { id: nid(), title: "" }])}><Icon n="plus" />{T(L("Add action item", "Добавить поручение", "Додати доручення", "إضافة بند"))}</button>
      {owner && <button type="button" className="btn ghost sm" disabled={busy === "dec"} onClick={decide}><Icon n="stamp" />{T(L("Send decisions to the decision log", "Отправить решения в журнал", "Надіслати рішення до журналу", "أرسل القرارات إلى السجل"))}</button>}</div>}
    {items.some((x) => !saved.some((y) => y.id === x.id)) && <small className="faint">{T(L("Save the meeting, then create tasks from the new items.", "Сохраните встречу, затем создайте задачи из новых поручений.", "Збережіть зустріч, потім створіть задачі з нових доручень.", "احفظ الاجتماع ثم أنشئ المهام من البنود الجديدة."))}</small>}
  </div>;
}
