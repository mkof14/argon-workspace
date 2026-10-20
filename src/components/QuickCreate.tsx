"use client";
// "+ New" in the top bar: the frequent actions in one place (only those the person may do).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

export default function QuickCreate() {
  const { lang, access, openIntake } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); document.addEventListener("mousedown", c); window.addEventListener("keydown", k); return () => { document.removeEventListener("mousedown", c); window.removeEventListener("keydown", k); }; }, [open]);
  const items: [string, string, T4, boolean][] = [
    ["/company/tasks?new=1", "bell", L("New task", "Новая задача", "Нова задача", "مهمة جديدة"), access.write.has("company.tasks")],
    ["/company/projects?new=1", "layers", L("New project", "Новый проект", "Новий проєкт", "مشروع جديد"), access.write.has("company.projects")],
    ["/company/documents?new=1", "upload", L("Upload document", "Загрузить документ", "Завантажити документ", "رفع مستند"), access.write.has("company.documents")],
    ["/company/meetings?new=1", "calendar", L("Create meeting", "Создать встречу", "Створити зустріч", "إنشاء اجتماع"), access.write.has("company.meetings")],
    ["/decide?submit=1", "check", L("Submit for approval", "Отправить на согласование", "Надіслати на погодження", "إرسال للموافقة"), true],
    ["/assistant", "spark", L("Ask Assistant", "Спросить ассистента", "Запитати асистента", "اسأل المساعد"), true],
  ];
  return <div className="dd qc" ref={ref}>
    <button className="btn sm primary qc-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={T(L("Create", "Создать", "Створити", "إنشاء"))}><Icon n="plus" /><span>{T(L("New", "Создать", "Створити", "جديد"))}</span></button>
    {open && <div className="dd-menu" role="menu" onClick={() => setOpen(false)}>
      {items.filter((x) => x[3]).map(([h, ic, l]) => <Link key={h} role="menuitem" href={h}><Icon n={ic} />{T(l)}</Link>)}
      <button role="menuitem" onClick={() => openIntake()}><Icon n="spark" />{T(L("Smart upload (AI files it)", "Умная загрузка (ИИ разложит)", "Розумне завантаження (ШІ розкладе)", "رفع ذكي (يصنّفه الذكاء الاصطناعي)"))}</button>
    </div>}
  </div>;
}
