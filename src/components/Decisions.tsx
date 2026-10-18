"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, SECTIONS } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { store, type Rec } from "@/lib/store";
import { APPROVALS } from "@/config/approvals";
import { decision, ordered, type Decision, type Kind } from "@/lib/decisions";
import { readyToSend } from "@/lib/milestones";
import { portfolio } from "@/lib/portfolio";
import { projectMoney } from "@/lib/margin";
import { shortages } from "@/lib/parts";
import { shipMissing } from "@/lib/shipgate";
import { useTr } from "@/lib/useTr";
import { AGENT_INFO } from "./Automation";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const KIND: Record<Kind, { t: T4; cls: string; icon: string }> = {
  approval: { t: L("Approval", "Согласование", "Погодження", "موافقة"), cls: "c-warn", icon: "check" },
  agent: { t: L("Agent proposal", "Предложение агента", "Пропозиція агента", "اقتراح وكيل"), cls: "c-info", icon: "spark" },
  invoice: { t: L("Invoice to send", "Счёт к отправке", "Рахунок до надсилання", "فاتورة للإرسال"), cls: "c-ok", icon: "coins" },
  project: { t: L("Project at risk", "Проект под угрозой", "Проєкт під загрозою", "مشروع معرض للخطر"), cls: "c-bad", icon: "layers" },
};
const LEADS = ["owner", "admin", "management"];
const href = (section?: string, id?: string) => (section && id ? `/${section.replace(".", "/")}?r=${id}` : "#");
const money = (v: number, cur = "USD") => `${cur} ${Math.round(v).toLocaleString("en-US")}`;

/** Decision centre: approvals, agent proposals, invoices ready to send and projects at risk — each with its context and a one-tap answer. */
export default function Decisions() {
  const { lang, me, access, people, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [items, setItems] = useState<Decision[] | null>(null); const [busy, setBusy] = useState(""); const [note, setNote] = useState<Record<string, string>>({}); const [only, setOnly] = useState<Kind | "">("");
  const today = new Date().toISOString().slice(0, 10);
  const person = (id?: string) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : ""; };

  const load = async () => {
    const out: Decision[] = [];
    // 1. Approvals waiting for me (demo: records in a waiting status)
    if (DEMO) {
      const secs = Object.keys(APPROVALS).filter((s) => access.read.has(s));
      for (const r of (await store.listMany(secs)).filter((r) => APPROVALS[r.section].wait.includes(r.status || "")).slice(0, 25))
        out.push(decision("approval", { id: `demo:${r.id}`, title: r.title, section: r.section, recordId: r.id, at: r.updated_at, data: { ...store.original(r).data, _status: r.status } }, today));
    } else {
      const { data: ap } = await sb().from("approvals").select("id,record_id,section,requested_by,note,created_at").eq("approver_id", me.id).eq("status", "pending").order("created_at").limit(50);
      const ids = (ap || []).map((a: any) => a.record_id);
      const { data: rs } = ids.length ? await sb().from("records").select("id,section,title,status,data").in("id", ids) : { data: [] as any[] };
      for (const a of ap || []) { const r: any = (rs || []).find((x: any) => x.id === a.record_id); if (r) out.push(decision("approval", { id: a.id, title: r.title, section: r.section, recordId: r.id, at: a.created_at, data: { ...r.data, _status: r.status, _note: a.note, _by: a.requested_by } }, today)); }
    }
    // 2. Agent proposals (owners and administrators)
    if (!DEMO && ["owner", "admin"].includes(me.role)) {
      const q = await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue" }) }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      for (const x of q) out.push(decision("agent", { id: x.id, title: x.title, section: x.section, recordId: x.record_id, at: x.at, data: { _agent: x.agent, _detail: x.detail, _action: x.action, _hidden: x.hidden } }, today));
    }
    // 3. Milestone invoices ready to send, 4. projects at risk (leaders and finance)
    if (access.read.has("finance.invoices") && (LEADS.includes(me.role) || me.role === "finance")) {
      const inv = (await store.list("finance.invoices")).map((r) => ({ ...store.original(r), updated_at: r.updated_at }) as Rec);
      for (const r of readyToSend(inv as any) as any[]) out.push(decision("invoice", { id: `inv:${r.id}`, title: r.title, section: r.section, recordId: r.id, at: r.data?.ready_on, data: r.data }, today));
    }
    if (LEADS.includes(me.role)) {
      const secs = SECTIONS.map((s) => s.id).filter((id: string) => access.read.has(id) && !id.endsWith(".metrics"));
      const all = (await store.listMany(secs)).map((r) => store.original(r) as Rec);
      for (const p of portfolio(all as any, today, { money: projectMoney as any, parts: shortages as any, ship: (b: any) => shipMissing("operations.builds", "Shipping", b.data, null, all as any) }).filter((p) => p.health === "red"))
        out.push(decision("project", { id: `prj:${p.deal.id}`, title: p.deal.title, section: "sales.pipeline", recordId: p.deal.id, at: p.next ? String(p.nextDate) : today, data: { _reasons: p.reasons, _next: p.next?.title, _nextDate: p.nextDate, _money: p.money } }, today));
    }
    setItems(ordered(out));
  };
  useEffect(() => { load().catch(() => setItems([])); }, []); // eslint-disable-line

  const titles = useTr((items || []).map((d) => d.title), lang);
  const tmap: Record<string, string> = Object.fromEntries((items || []).map((d, i) => [d.id, titles[i]]));
  const drop = (id: string) => setItems((xs) => (xs || []).filter((x) => x.id !== id));
  const act = async (d: Decision, yes: boolean) => {
    setBusy(d.id);
    try {
      if (d.kind === "approval") {
        const rule = APPROVALS[d.section!];
        if (d.id.startsWith("demo:")) { const r = (await store.listMany([d.section!])).find((x) => x.id === d.recordId); const to = yes ? rule.ok : rule.no; if (r && to) await store.save({ ...store.original(r), status: to }); }
        else { const r = await fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", id: d.id, decision: yes ? "approved" : "rejected", comment: note[d.id] || "" }) }); if (!r.ok) throw new Error(await r.text()); }
      } else if (d.kind === "agent") {
        const r = await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", id: d.id, approve: yes }) }); if (!r.ok) throw new Error(await r.text());
      } else if (d.kind === "invoice" && yes) {
        const r = (await store.list("finance.invoices")).find((x) => x.id === d.recordId); if (r) await store.save({ ...store.original(r), status: "Sent" });
      }
      toast(yes ? T(L("Done", "Готово", "Готово", "تم")) : T(L("Returned", "Возвращено", "Повернуто", "أُعيد"))); drop(d.id);
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };

  const facts = (d: Decision): [string, string][] => {
    const sec = SECTIONS.find((s) => s.id === d.section); const keys = d.kind === "approval" ? APPROVALS[d.section!]?.key || [] : [];
    return keys.filter((k: string) => !["amount", "value", "currency"].includes(k)).map((k: string) => { const f = sec?.fields?.find((x: any) => x.key === k); const v = d.data?.[k]; return [f ? tx(f.label, lang as Lang) : k, v === undefined || v === null || v === "" ? "" : typeof v === "number" ? v.toLocaleString("en-US") : String(v).slice(0, 140)] as [string, string]; })
      .filter(([, v]: [string, string]) => !!v).slice(0, 6);
  };
  const actionText = (a: any) => !a ? "" : a.type === "email" ? `${T(L("Email to", "Письмо на", "Лист на", "بريد إلى"))} ${a.to || a.to_field}: ${a.subject || ""}`
    : a.type === "set" ? `${T(L("Will set", "Установит", "Встановить", "سيضبط"))} ${a.field} = ${a.value}` : a.type === "create" ? `${T(L("Will create", "Создаст", "Створить", "سينشئ"))} «${a.title || ""}» · ${tx(SECTIONS.find((s) => s.id === a.section)?.label, lang as Lang) || a.section}` : a.type;
  const reason = (r: any) => ({ late: L(`${r.n} step(s) late`, `просрочено шагов: ${r.n}`, `прострочено кроків: ${r.n}`, `خطوات متأخرة: ${r.n}`), overdue: L(`client invoice ${r.n} d overdue`, `счёт клиента просрочен на ${r.n} дн.`, `рахунок клієнта прострочено на ${r.n} дн.`, `فاتورة العميل متأخرة ${r.n} يوماً`), margin: L("margin under target", "маржа ниже цели", "маржа нижча за ціль", "الهامش أقل من الهدف"), cost: L("costs above plan", "затраты выше плана", "витрати вищі за план", "التكاليف أعلى من الخطة"), compliance: L("compliance missing before shipping", "нет комплаенса перед отгрузкой", "немає комплаєнсу перед відвантаженням", "امتثال ناقص قبل الشحن"), parts: L("parts short", "не хватает комплектующих", "бракує комплектуючих", "قطع ناقصة") } as Record<string, T4>)[r.k];

  const shown = useMemo(() => (items || []).filter((d) => !only || d.kind === only), [items, only]);
  const sum = (items || []).filter((d) => d.kind === "approval").reduce((a, d) => a + d.usd, 0);
  if (!items) return <div className="card" style={{ padding: 24 }}>…</div>;
  return <div style={{ display: "grid", gap: 14 }}>
    <div className="card dc-top">
      <div><b className="dc-n">{items.length}</b><small className="faint">{T(L("waiting for your answer", "ждут вашего ответа", "чекають вашої відповіді", "بانتظار ردك"))}</small></div>
      {sum > 0 && <div><b className="dc-n">{money(sum)}</b><small className="faint">{T(L("in approvals", "на согласовании", "на погодженні", "قيد الموافقة"))}</small></div>}
      <div className="toolbar" style={{ gap: 6 }}>{(Object.keys(KIND) as Kind[]).map((k) => { const n = items.filter((d) => d.kind === k).length; return n ? <button key={k} className={`chip ${KIND[k].cls}`} style={{ cursor: "pointer", outline: only === k ? "2px solid currentColor" : "none" }} onClick={() => setOnly(only === k ? "" : k)}>{T(KIND[k].t)} · {n}</button> : null; })}</div>
    </div>
    {!shown.length && <div className="card" style={{ padding: 24 }}><small className="faint">{T(L("Nothing waits for you. New approvals, agent proposals, invoices ready to send and projects at risk appear here.", "Вас ничего не ждёт. Здесь появятся новые согласования, предложения агентов, готовые к отправке счета и проекты под угрозой.", "На вас нічого не чекає. Тут з'являться нові погодження, пропозиції агентів, готові до надсилання рахунки та проєкти під загрозою.", "لا شيء بانتظارك. ستظهر هنا الموافقات الجديدة واقتراحات الوكلاء والفواتير الجاهزة والمشاريع المعرضة للخطر."))}</small></div>}
    {shown.map((d) => { const k = KIND[d.kind]; const rule = d.kind === "approval" ? APPROVALS[d.section!] : null; const a = d.data?._action;
      return <div key={d.id} className={`card dc k-${d.kind}`}>
        <div className="dc-h"><span className={`chip ${k.cls}`}><Icon n={k.icon} className="lockico" /> {T(k.t)}</span>
          <small className="faint">{d.kind === "agent" ? T(AGENT_INFO[d.data?._agent as keyof typeof AGENT_INFO]?.name || L("Agent", "Агент", "Агент", "وكيل")) : tx(SECTIONS.find((s) => s.id === d.section)?.label, lang as Lang)}</small>
          <small className="faint" style={{ marginInlineStart: "auto" }}>{d.age ? T(L(`waiting ${d.age} d`, `ждёт ${d.age} дн.`, `чекає ${d.age} дн.`, `ينتظر ${d.age} يوم`)) : T(L("today", "сегодня", "сьогодні", "اليوم"))}</small></div>
        <div className="dc-t"><Link href={href(d.section, d.recordId)}>{tmap[d.id] || d.title}</Link>{d.amount ? <b className="mono">{money(d.amount, d.currency)}</b> : null}</div>
        {d.kind === "approval" && <>
          {facts(d).length > 0 && <div className="dc-f">{facts(d).map(([l, v]) => <span key={l}><small className="faint">{l}</small>{v}</span>)}</div>}
          {(d.data?._note || d.data?._by) && <small>{person(d.data?._by)}{d.data?._note ? `: «${d.data._note}»` : ""}</small>}
          {rule && <small className="faint">{T(L("Approve →", "Одобрить →", "Схвалити →", "موافقة ←"))} {rule.ok}{rule.no ? ` · ${T(L("Return →", "Вернуть →", "Повернути →", "إعادة ←"))} ${rule.no}` : ""}</small>}
          {!d.id.startsWith("demo:") && <input className="input" placeholder={T(L("Comment (optional)", "Комментарий (необязательно)", "Коментар (необов'язково)", "تعليق (اختياري)"))} value={note[d.id] || ""} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} />}
        </>}
        {d.kind === "agent" && <>{d.data?._detail && <small>{d.data._detail}</small>}<small className="faint">{actionText(a)}</small>
          {a?.type === "email" && a.body && <details><summary className="faint" style={{ cursor: "pointer" }}>{T(L("Letter text", "Текст письма", "Текст листа", "نص الرسالة"))}</summary><pre className="dc-mail">{a.body}</pre></details>}</>}
        {d.kind === "invoice" && <small className="faint">{T(L(`Ready since ${d.data?.ready_on}. Send it to the client from your mail or accounting, then mark it sent here.`, `Готов с ${d.data?.ready_on}. Отправьте клиенту из почты или бухгалтерии и отметьте здесь как отправленный.`, `Готовий з ${d.data?.ready_on}. Надішліть клієнту з пошти чи бухгалтерії й позначте тут як надісланий.`, `جاهزة منذ ${d.data?.ready_on}. أرسلها إلى العميل من بريدك أو المحاسبة ثم علّمها هنا كمرسلة.`))}</small>}
        {d.kind === "project" && <><div className="toolbar" style={{ gap: 6 }}>{(d.data?._reasons || []).map((r: any) => <span key={r.k} className="chip">{T(reason(r))}</span>)}</div>
          {d.data?._next && <small className="faint">{T(L("Next step", "Следующий шаг", "Наступний крок", "الخطوة التالية"))}: {d.data._nextDate} · {d.data._next}</small>}</>}
        <div className="toolbar">
          {d.kind === "approval" && <><button className="btn primary sm" disabled={busy === d.id} onClick={() => act(d, true)}><Icon n="check" />{T(L("Approve", "Одобрить", "Схвалити", "موافقة"))}</button><button className="btn sm" disabled={busy === d.id} onClick={() => act(d, false)}>{T(L("Return", "Вернуть", "Повернути", "إعادة"))}</button></>}
          {d.kind === "agent" && !d.data?._hidden && <><button className="btn primary sm" disabled={busy === d.id} onClick={() => act(d, true)}><Icon n="check" />{a?.type === "email" ? T(L("Send", "Отправить", "Надіслати", "إرسال")) : T(L("Do it", "Выполнить", "Виконати", "نفّذ"))}</button><button className="btn sm" disabled={busy === d.id} onClick={() => act(d, false)}>{T(L("Decline", "Отклонить", "Відхилити", "رفض"))}</button>
            {a?.type === "email" && <Link className="btn ghost sm" href="/admin/system?tab=auto">{T(L("Edit first", "Сначала поправить", "Спершу виправити", "عدّل أولاً"))}</Link>}</>}
          {d.kind === "invoice" && <><Link className="btn sm" href={href(d.section, d.recordId)}><Icon n="file" />{T(L("Open invoice", "Открыть счёт", "Відкрити рахунок", "افتح الفاتورة"))}</Link><button className="btn primary sm" disabled={busy === d.id} onClick={() => act(d, true)}><Icon n="send" />{T(L("Mark as sent", "Отметить отправленным", "Позначити надісланим", "علّمها كمرسلة"))}</button></>}
          {d.kind === "project" && <Link className="btn sm" href={href(d.section, d.recordId)}><Icon n="layers" />{T(L("Open project", "Открыть проект", "Відкрити проєкт", "افتح المشروع"))}</Link>}
        </div>
      </div>; })}
  </div>;
}
