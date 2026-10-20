"use client";
// MESSAGES: every discussion I can see, one line per record (project, task, document …), newest first.
// It is the comments of the records themselves — no separate chat — so a discussion always opens in its context.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store } from "@/lib/store";
import { CommentBody, personName } from "./PeopleFields";
import { useWork } from "./useWork";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type C = Awaited<ReturnType<typeof store.discussions>>[number];
type Thread = { record_id: string; section: string; title: string; last: C; count: number; unread: number; mentioned: boolean; items: C[] };

export default function Messages() {
  const { lang, me, people, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [list, setList] = useState<C[] | null>(null); const [reads, setReads] = useState<Record<string, string>>({});
  const [f, setF] = useState<"all" | "unread" | "mentions" | "company.projects" | "company.tasks" | "company.documents">("all"); const [q, setQ] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const w = useWork();
  useEffect(() => { store.discussions().then(setList).catch(() => setList([])); store.reads().then(setReads).catch(() => {}); }, [tick]);
  const threads = useMemo(() => {
    const m = new Map<string, Thread>();
    for (const c of list || []) {
      const t = m.get(c.record_id) || { record_id: c.record_id, section: c.section || "", title: c.title || "—", last: c, count: 0, unread: 0, mentioned: false, items: [] };
      t.count++; t.items.push(c);
      if (c.author !== me.id && (!reads[c.record_id] || c.created_at > reads[c.record_id])) { t.unread++; if (c.mentions?.includes(me.id)) t.mentioned = true; }
      m.set(c.record_id, t);
    }
    return [...m.values()];
  }, [list, reads, me.id]);
  const shown = threads.filter((t) => (f === "all" || (f === "unread" ? t.unread > 0 : f === "mentions" ? t.items.some((c) => c.mentions?.includes(me.id)) : t.section === f))
    && (!q || (t.title + " " + t.items.map((c) => c.body).join(" ")).toLowerCase().includes(q.toLowerCase())));
  const who = (id: string | null) => personName(people.find((p) => p.id === id)) || "—";
  const link = (t: Thread, cid?: string) => (t.section === "company.projects" ? `/projects/${t.record_id}?tab=discussion${cid ? `#c-${cid}` : ""}` : `/${t.section.replace(".", "/")}?r=${t.record_id}${cid ? `#c-${cid}` : ""}`);
  const filters: [typeof f, T4][] = [["all", L("All", "Все", "Усі", "الكل")], ["unread", L("Unread", "Непрочитанные", "Непрочитані", "غير مقروءة")], ["mentions", L("Mentions of me", "Упоминания меня", "Згадки про мене", "الإشارات إليّ")], ["company.projects", L("Projects", "Проекты", "Проєкти", "المشاريع")], ["company.tasks", L("Tasks", "Задачи", "Задачі", "المهام")], ["company.documents", L("Documents", "Документы", "Документи", "المستندات")]];
  const activeProjects = w.projects.filter((p) => !["Completed", "Cancelled"].includes(p.status || ""));
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#0EA5E9" }}>
    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="send" />{T(L("Messages", "Сообщения", "Повідомлення", "الرسائل"))}</h2>
        <span className="faint" style={{ fontSize: 13.5 }}>{T(L("Discussions on projects, tasks and documents. Type @ in any comment to mention a colleague.", "Обсуждения проектов, задач и документов. Наберите @ в комментарии, чтобы упомянуть коллегу.", "Обговорення проєктів, задач і документів. Наберіть @ у коментарі, щоб згадати колегу.", "نقاشات المشاريع والمهام والمستندات. اكتب @ في أي تعليق لذكر زميل."))}</span></div>
      <div className="filters">
        <div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T(L("Search discussions", "Поиск по обсуждениям", "Пошук в обговореннях", "ابحث في النقاشات"))} aria-label={T(L("Search discussions", "Поиск по обсуждениям", "Пошук в обговореннях", "ابحث في النقاشات"))} /></div>
        <nav className="seg">{filters.map(([k, l]) => <button key={k} className={f === k ? "on" : ""} onClick={() => setF(k)}>{T(l)}{k === "unread" && threads.some((t) => t.unread) ? <b className="mono"> {threads.filter((t) => t.unread).length}</b> : null}</button>)}</nav>
      </div>
      <div className="threads">{list === null ? <div className="empty">…</div> : !shown.length ? <div className="empty">{T(L("No discussions here yet. Open a project, task or document and write a comment.", "Обсуждений пока нет. Откройте проект, задачу или документ и напишите комментарий.", "Обговорень ще немає. Відкрийте проєкт, задачу чи документ і напишіть коментар.", "لا نقاشات بعد. افتح مشروعاً أو مهمة أو مستنداً واكتب تعليقاً."))}</div>
        : shown.map((t) => { const s = findSection(t.section); const on = open === t.record_id; return <div key={t.record_id} className={`thread-row ${t.unread ? "unread" : ""}`} style={{ ["--dc" as any]: s?.color }}>
          <button className="thread-head" aria-expanded={on} onClick={() => { setOpen(on ? null : t.record_id); if (!on && t.unread) { store.markRead(t.record_id).then(() => setReads((r) => ({ ...r, [t.record_id]: new Date().toISOString() }))).catch(() => {}); } }}>
            <span className="dic"><Icon n={s?.icon || "send"} /></span>
            <span style={{ minWidth: 0, flex: 1, textAlign: "start" }}><small>{tx(s?.label, lang as Lang)} · {who(t.last.author)} · {t.last.created_at.slice(0, 16).replace("T", " ")}</small><b>{t.title}</b><span className="faint nb"><CommentBody body={t.last.body.slice(0, 160)} /></span></span>
            {t.mentioned && <span className="chip c-warn">@</span>}{t.unread > 0 && <span className="chip c-info mono">{t.unread}</span>}<span className="chip mono">{t.count}</span>
          </button>
          {on && <div className="thread-body">{[...t.items].reverse().slice(-12).map((c) => <div key={c.id} className={`cmt ${c.internal ? "internal" : ""} ${c.mentions?.includes(me.id) ? "mentioned" : ""}`}><small><b>{who(c.author)}</b> · {c.created_at.slice(0, 16).replace("T", " ")}</small><CommentBody body={c.body} /></div>)}
            <Link className="btn sm" href={link(t)}><Icon n="ext" />{T(L("Open and reply", "Открыть и ответить", "Відкрити й відповісти", "افتح وردّ"))}</Link></div>}
        </div>; })}</div>
    </section>
    {activeProjects.length > 0 && <section className="card"><div className="card-h"><h2><Icon n="layers" />{T(L("Start a discussion in a project", "Начать обсуждение в проекте", "Почати обговорення в проєкті", "ابدأ نقاشاً في مشروع"))}</h2></div>
      <div className="toolbar" style={{ padding: "0 16px 16px" }}>{activeProjects.slice(0, 12).map((p) => <Link key={p.id} className="chip" href={`/projects/${p.id}?tab=discussion`}>{p.title}</Link>)}</div></section>}
  </div>;
}
