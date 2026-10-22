"use client";
// Company announcements: management publishes to the company, a department, a project or roles; the audience is
// computed by the database (outside it an announcement does not exist). "Read & Acknowledged" is stored per version —
// when the text changes materially, everyone has to acknowledge again. Management sees audience, read,
// acknowledged and who is outstanding.
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { MANAGERS, useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { mdHtml, useDepartments } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const PRIO: Record<string, string> = { Critical: "c-bad", Important: "c-warn", Normal: "c-info" };
const today = () => new Date().toISOString().slice(0, 10);
export const isLive = (r: Rec) => r.status === "Published" && String(r.data?.publish_at || "") <= today() && (!r.data?.expires || String(r.data.expires) >= today());

function Stats({ id }: { id: string }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [s, setS] = useState<Awaited<ReturnType<typeof store.announcementStats>>>(null); const [open, setOpen] = useState(false);
  useEffect(() => { store.announcementStats(id).then(setS).catch(() => {}); }, [id]);
  if (!s) return null;
  return <div className="ann-stats" data-stats={id}>
    <span className="chip mono">{T(L("Audience", "Аудитория", "Аудиторія", "الجمهور"))} {s.audience}</span>
    <span className="chip mono">{T(L("Read", "Прочитали", "Прочитали", "قرأ"))} {s.read}</span>
    <span className="chip mono c-ok">{T(L("Acknowledged", "Подтвердили", "Підтвердили", "أكّد"))} {s.acknowledged}{s.version > 1 ? ` · v${s.version}` : ""}</span>
    {s.outstanding.length > 0 && <button type="button" className="btn ghost xs" onClick={() => setOpen(!open)}>{T(L("Outstanding", "Не подтвердили", "Не підтвердили", "لم يؤكدوا"))} {s.outstanding.length}</button>}
    {open && <div className="faint ann-out">{s.outstanding.map((p) => p.name).join(", ")}</div>}
  </div>;
}

/** One announcement as people read it, with the acknowledgement button. */
export function AnnouncementCard({ r, acks, onAck }: { r: Rec; acks: Record<string, number[]>; onAck: () => void }) {
  const { lang, me, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const v = Number(r.data?.ann_version || 1); const mine = acks[r.id] || []; const done = mine.includes(v); const older = !done && mine.length > 0;
  const need = r.data?.ack_required === true || r.data?.ack_required === "true";
  const ack = async () => { try { await store.announcementAck(r.id); toast(T(L("Acknowledged", "Подтверждено", "Підтверджено", "تم التأكيد"))); onAck(); } catch (e: any) { toast(e.message || "Error", true); } };
  return <article className={`ann ${r.data?.priority === "Critical" ? "crit" : ""}`} data-ann={r.id}>
    <header><span className={`chip ${PRIO[r.data?.priority] || "c-info"}`}>{r.data?.priority || "Normal"}</span><b>{r.title}</b>
      <small className="faint">{r.data?.publish_at}{r.data?.expires ? ` → ${r.data.expires}` : ""}{v > 1 ? ` · v${v}` : ""}</small>
      <Link className="btn ghost xs" style={{ marginInlineStart: "auto" }} href={`/company/announcements?r=${r.id}`}>{T(L("Open", "Открыть", "Відкрити", "فتح"))}</Link></header>
    <div className="md" dangerouslySetInnerHTML={{ __html: mdHtml(r.data?.message || "") }} />
    {need && <div className="toolbar">{done ? <span className="chip c-ok"><Icon n="check" />{T(L("You acknowledged this version", "Вы подтвердили эту версию", "Ви підтвердили цю версію", "أكدت هذه النسخة"))}</span>
      : <><button className="btn primary sm" onClick={ack} data-ack={r.id}><Icon n="check" />{T(L("Read & Acknowledged", "Прочитано и принято", "Прочитано й прийнято", "قرأت وأوافق"))}</button>
        {older && <span className="chip c-warn">{T(L("The text changed since you acknowledged it", "Текст изменился после вашего подтверждения", "Текст змінився після вашого підтвердження", "تغيّر النص بعد تأكيدك"))}</span>}</>}</div>}
    {(MANAGERS.includes(me.role) || r.created_by === me.id) && <Stats id={r.id} />}
  </article>;
}

/** Current announcements for me (Today page and the top of the announcements section). */
export default function Announcements({ compact }: { compact?: boolean }) {
  const { lang, tick } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [list, setList] = useState<Rec[]>([]); const [acks, setAcks] = useState<Record<string, number[]>>({});
  const load = () => { store.list("company.announcements").then((l) => setList(l.filter(isLive).sort((a, b) => (b.data?.priority === "Critical" ? 1 : 0) - (a.data?.priority === "Critical" ? 1 : 0) || String(b.data?.publish_at).localeCompare(String(a.data?.publish_at))))).catch(() => setList([])); store.myAcks().then(setAcks).catch(() => {}); };
  useEffect(load, [tick]); // eslint-disable-line
  const open = list.filter((r) => (r.data?.ack_required === true || r.data?.ack_required === "true") && !(acks[r.id] || []).includes(Number(r.data?.ann_version || 1)));
  const shown = compact ? [...open, ...list.filter((r) => !open.includes(r) && r.data?.priority !== "Normal")].slice(0, 3) : list;
  if (!shown.length) return compact ? null : <div className="card empty">{T(L("No current announcements.", "Актуальных объявлений нет.", "Актуальних оголошень немає.", "لا إعلانات حالية."))}</div>;
  return <section className="card ann-list" style={{ padding: 16 }}><div className="eyebrow"><Icon n="megaphone" /> {T(L("Announcements", "Объявления", "Оголошення", "الإعلانات"))}{open.length ? ` · ${open.length} ${T(L("to acknowledge", "ждут подтверждения", "чекають підтвердження", "بانتظار التأكيد"))}` : ""}</div>
    {shown.map((r) => <AnnouncementCard key={r.id} r={r} acks={acks} onAck={load} />)}</section>;
}

/** Inside the announcement record: what the audience sees, plus the numbers for management. */
export function AnnouncementPanel({ rec }: { rec: Rec }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [acks, setAcks] = useState<Record<string, number[]>>({});
  useEffect(() => { store.myAcks().then(setAcks).catch(() => {}); }, [rec.id]);
  return <div className="thread"><div className="eyebrow">{isLive(rec) ? T(L("Published — as the audience sees it", "Опубликовано — так видит аудитория", "Опубліковано — так бачить аудиторія", "منشور — كما يراه الجمهور")) : T(L("Not visible to the audience yet (draft, scheduled or expired)", "Аудитория пока не видит (черновик, запланировано или истекло)", "Аудиторія поки не бачить (чернетка, заплановано або минуло)", "غير مرئي للجمهور بعد (مسودة أو مجدول أو منتهٍ)"))}</div>
    <AnnouncementCard r={rec} acks={acks} onAck={() => store.myAcks().then(setAcks)} /></div>;
}

/** Who the announcement is for: departments and roles are picked from lists (stored by id / role key), so a
 *  misspelt audience cannot happen; a project audience takes the project's id. */
export function AudienceField({ data, setData, ro }: { data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void; ro: boolean }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang); const depts = useDepartments();
  const type = data.audience_type || "company"; const vals = String(data.audience || "").split(",").map((x) => x.trim()).filter(Boolean);
  const set = (v: string[]) => setData((d) => ({ ...d, audience: v.join(",") }));
  if (type === "company") return null;
  const opts: { v: string; l: string }[] = type === "department" ? depts.filter((d) => d.active).map((d) => ({ v: d.id, l: d.label?.[lang] || d.label?.en || d.name }))
    : type === "roles" ? ["management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security", "procurement"].map((r) => ({ v: r, l: r })) : [];
  if (type === "project") return <div className="field wide"><label>{T(L("Project (id or exact name)", "Проект (id или точное название)", "Проєкт (id або точна назва)", "المشروع (المعرّف أو الاسم الدقيق)"))}</label><input className="input" value={data.audience || ""} readOnly={ro} onChange={(e) => setData((d) => ({ ...d, audience: e.target.value }))} /></div>;
  const legacy = vals.filter((v) => !opts.some((o) => o.v === v));
  return <div className="field wide"><label>{type === "department" ? T(L("Departments", "Отделы", "Відділи", "الأقسام")) : T(L("Roles", "Роли", "Ролі", "الأدوار"))}</label>
    <div className="people-chips" data-audience={type}>{opts.map((o) => <label key={o.v} className="chk"><input type="checkbox" disabled={ro} checked={vals.includes(o.v)} onChange={(e) => set(e.target.checked ? [...vals, o.v] : vals.filter((x) => x !== o.v))} />{o.l}</label>)}
      {legacy.map((v) => <span key={v} className="chip c-warn" title={T(L("Not in the department list — choose from the list", "Нет в списке отделов — выберите из списка", "Немає у списку відділів — виберіть зі списку", "ليس في قائمة الأقسام — اختر من القائمة"))}>{v}{!ro && <button type="button" className="iconbtn" aria-label="×" onClick={() => set(vals.filter((x) => x !== v))}>×</button>}</span>)}</div></div>;
}
