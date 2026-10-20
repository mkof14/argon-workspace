"use client";
// ASSISTANT: the existing AGRON Assistant in one place — a conversation about the work (it sees only what the
// person may read) and questions answered from the company's documents with the pages they came from.
import dynamic from "next/dynamic";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
const DocsAsk = dynamic(() => import("./DocsAsk"), { ssr: false });

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

export default function Assistant() {
  const { lang, openAi } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const asks: T4[] = [
    L("What should I do first today?", "Что мне сделать сегодня в первую очередь?", "Що мені зробити сьогодні насамперед?", "ما الذي يجب أن أبدأ به اليوم؟"),
    L("Which tasks are overdue in my projects?", "Какие задачи просрочены в моих проектах?", "Які задачі прострочені в моїх проєктах?", "ما المهام المتأخرة في مشاريعي؟"),
    L("Summarise this week's changes for the CEO", "Сводка изменений за неделю для CEO", "Зведення змін за тиждень для CEO", "لخّص تغييرات هذا الأسبوع للرئيس التنفيذي"),
    L("Draft a task list for the next exhibition", "Составь список задач к следующей выставке", "Склади список задач до наступної виставки", "أعدّ قائمة مهام للمعرض القادم"),
  ];
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#7C5CFF" }}>
    <section className="sec-hero"><span className="ic"><Icon n="spark" /></span>
      <div style={{ minWidth: 0, position: "relative", zIndex: 1 }}><div className="eyebrow">AGRON Assistant</div><h2>{T(L("Assistant", "Ассистент", "Асистент", "المساعد"))}</h2>
        <div className="sec-desc">{T(L("Ask about your work or the company's documents. The assistant sees only what you may open; it prepares changes and you confirm them.", "Спрашивайте о своей работе или документах компании. Ассистент видит только то, что можете открыть вы; изменения он готовит, а подтверждаете вы.", "Питайте про свою роботу або документи компанії. Асистент бачить лише те, що можете відкрити ви; зміни він готує, а підтверджуєте ви.", "اسأل عن عملك أو مستندات الشركة. لا يرى المساعد إلا ما يمكنك فتحه؛ يُعدّ التغييرات وأنت تؤكدها."))}</div></div></section>
    <section className="card"><div className="card-h"><h2><Icon n="send" />{T(L("Talk to the assistant", "Разговор с ассистентом", "Розмова з асистентом", "تحدث مع المساعد"))}</h2></div>
      <div className="toolbar" style={{ padding: "0 16px 16px" }}>
        <button className="btn primary" onClick={() => openAi({ title: T(L("Assistant", "Ассистент", "Асистент", "المساعد")) })}><Icon n="spark" />{T(L("Open the assistant", "Открыть ассистента", "Відкрити асистента", "افتح المساعد"))}</button>
        {asks.map((a, i) => <button key={i} className="chip" onClick={() => openAi({ title: T(L("Assistant", "Ассистент", "Асистент", "المساعد")), ask: T(a) })}>{T(a)}</button>)}
      </div></section>
    <DocsAsk />
  </div>;
}
