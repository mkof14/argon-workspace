"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, SECTIONS } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { PROJECT_TEMPLATES, projectPlan } from "@/lib/projects";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const PLAN_SECS = Array.from(new Set(PROJECT_TEMPLATES.flatMap((t) => t.steps.map((s) => s.section))));
const ROLE: Record<string, T4> = { sales: L("Sales", "Продажи", "Продажі", "المبيعات"), security: L("Security", "Безопасность", "Безпека", "الأمن"), operations: L("Operations", "Операции", "Операції", "العمليات"), engineering: L("Engineering", "Инженеры", "Інженери", "الهندسة"), finance: L("Finance", "Финансы", "Фінанси", "المالية") };

/** Inside a won deal: unfold the whole project — build, purchases, checks, shipping, installation, acceptance, training, service. */
export default function ProjectPlanner({ deal, onDone }: { deal: Rec; onDone: () => void }) {
  const { lang, access, people, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<Rec[] | null>(null);
  const [tpl, setTpl] = useState(PROJECT_TEMPLATES[0].id);
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const readable = PLAN_SECS.filter((s) => access.read.has(s));
  const load = () => store.listMany(readable).then((r) => setExisting(r.filter((x) => x.data?.project === deal.id || (x.section === "operations.builds" && x.data?.deal_ref === deal.id)))).catch(() => setExisting([]));
  useEffect(() => { load(); }, [deal.id]); // eslint-disable-line
  useEffect(() => { // first person of each role is suggested as the owner
    const o: Record<string, string> = {}; for (const r of Object.keys(ROLE)) { const p = people.find((x) => x.role === r); if (p) o[r] = p.full_name || p.email; } setOwners((x) => ({ ...o, ...x }));
  }, [people.length]); // eslint-disable-line
  const t = PROJECT_TEMPLATES.find((x) => x.id === tpl)!;
  const orig = store.original(deal);
  const plan = useMemo(() => projectPlan(orig, t, start, (lang === "ar" ? "en" : lang) as any, owners), [orig, t, start, owners, lang]);
  const done = (existing || []).filter((x) => x.data?.project === deal.id);
  const build0 = (existing || []).find((x) => x.section === "operations.builds");
  const cannot = plan.filter((p) => !access.write.has(p.section));

  const create = async () => {
    setBusy(true); let n = 0;
    try {
      // The build first (or the one already made when the deal was won), the rest link to it
      let buildId = build0?.id;
      const b = plan.find((p) => p.key === "build")!;
      if (buildId && build0) { await store.save({ ...build0, data: { ...store.original(build0).data, ...b.data, deal_ref: deal.id } }); n++; }
      else if (access.write.has(b.section)) { buildId = (await store.save({ section: b.section, title: b.title, status: b.status, data: b.data, controlled: !!deal.controlled })).id; n++; }
      for (const p of plan) {
        if (p.key === "build" || !access.write.has(p.section) || done.some((x) => x.data?.project_step === p.key)) continue;
        const data = { ...p.data }; if (p.link === "build" && buildId) data.build_ref = buildId;
        await store.save({ section: p.section, title: p.title, status: p.status, data, controlled: !!deal.controlled }); n++;
      }
      toast(`${T(L("Project plan created", "План проекта создан", "План проєкту створено", "تم إنشاء خطة المشروع"))}: ${n}`);
      setOpen(false); await load(); onDone();
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); }
  };

  const sec = (id: string) => SECTIONS.find((s) => s.id === id);
  const head = <div className="appr-h"><Icon n="layers" /><b>{T(L("Project plan", "План проекта", "План проєкту", "خطة المشروع"))}</b>
    {done.length > 0 && <span className="chip c-ok" style={{ marginInlineStart: 8 }}>{done.length}</span>}
    {open && <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setOpen(false)}>{T(L("Close", "Закрыть", "Закрити", "إغلاق"))}</button>}</div>;
  if (!open) return <section className="appr">{head}
    {done.length > 0 && <div className="feed">{done.sort((a, b) => String(a.data?.due || a.data?.date || a.data?.eta || "").localeCompare(String(b.data?.due || b.data?.date || b.data?.eta || ""))).map((r) => <Link key={r.id} className="feed-row" href={`/${r.section.replace(".", "/")}?r=${r.id}`}>
      <span className="flag"><Icon n={sec(r.section)?.icon || "file"} /></span><span style={{ flex: 1, minWidth: 0 }}><b>{r.title}</b><small className="faint" style={{ display: "block" }}>{tx(sec(r.section)?.label, lang as Lang)} · {r.status}</small></span>
      <span className="mono faint" style={{ fontSize: 12.5 }}>{String(r.data?.due || r.data?.date || r.data?.eta || "").slice(0, 10)}</span></Link>)}</div>}
    <div className="toolbar"><button className="btn primary sm" onClick={() => setOpen(true)}><Icon n="layers" />{done.length ? T(L("Add missing steps", "Добавить недостающие шаги", "Додати відсутні кроки", "إضافة الخطوات الناقصة")) : T(L("Unfold the project", "Развернуть проект", "Розгорнути проєкт", "إنشاء المشروع"))}</button>
      {!done.length && <small className="faint">{T(L("Build, purchases, screening, shipping, installation, acceptance, training and service — with dates and owners", "Сборка, закупки, проверка, отгрузка, монтаж, приёмка, обучение и сервис — с датами и ответственными", "Збирання, закупівлі, перевірка, відвантаження, монтаж, приймання, навчання й сервіс — з датами та відповідальними", "التجميع والمشتريات والفحص والشحن والتركيب والقبول والتدريب والصيانة — بالتواريخ والمسؤولين"))}</small>}</div></section>;

  return <section className="appr">{head}
    <div className="fgrid">
      <div className="field"><label>{T(L("Template", "Шаблон", "Шаблон", "القالب"))}</label><select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)}>{PROJECT_TEMPLATES.map((x) => <option key={x.id} value={x.id}>{T(x.name)}</option>)}</select><span className="hint">{T(t.about)}</span></div>
      <div className="field"><label>{T(L("Start", "Старт", "Старт", "البداية"))}</label><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
      {Object.keys(ROLE).map((r) => <div key={r} className="field"><label>{T(ROLE[r])}</label><input className="input" list="people-list" value={owners[r] || ""} onChange={(e) => setOwners({ ...owners, [r]: e.target.value })} /></div>)}
    </div>
    <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Date", "Дата", "Дата", "التاريخ"))}</th><th>{T(L("Step", "Шаг", "Крок", "الخطوة"))}</th><th>{T(L("Section", "Раздел", "Розділ", "القسم"))}</th><th>{T(L("Owner", "Ответственный", "Відповідальний", "المسؤول"))}</th></tr></thead>
      <tbody>{plan.map((p) => { const has = done.some((x) => x.data?.project_step === p.key) || (p.key === "build" && !!build0); return <tr key={p.key} className={has ? "faint" : ""}>
        <td className="mono" style={{ whiteSpace: "nowrap" }}>{p.due}</td><td>{p.title}{has && <span className="chip c-ok" style={{ marginInlineStart: 6 }}>✓</span>}</td><td>{tx(sec(p.section)?.label, lang as Lang)}</td><td>{owners[p.role] || "—"}</td></tr>; })}</tbody></table></div>
    {cannot.length > 0 && <div className="hint">{T(L("Some steps are in sections you cannot change; they will be skipped:", "Некоторые шаги в разделах, которые вы не можете менять; они будут пропущены:", "Деякі кроки в розділах, які ви не можете змінювати; їх буде пропущено:", "بعض الخطوات في أقسام لا يمكنك تعديلها وستُتخطى:"))} {cannot.map((c) => tx(sec(c.section)?.label, lang as Lang)).join(", ")}</div>}
    <div className="toolbar"><button className="btn primary" disabled={busy} onClick={create}><Icon n="check" />{busy ? "…" : T(L("Create the plan", "Создать план", "Створити план", "إنشاء الخطة"))}</button></div>
  </section>;
}
