"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { financeFindings, type Finding } from "@/lib/deptAgents";
import { DEFAULT_SETTINGS } from "@/lib/automation";
import { AGENT_INFO, L } from "./Automation";

type T4 = { en: string; ru: string; uk: string; ar: string };
/** Department → its agent's checks (the same functions the daily agent runs on the server). */
export const DEPT_FINDERS: Record<string, { agent: keyof typeof AGENT_INFO; run: (all: any[], today: string, th: any) => Finding[]; extra: string[] }> = {
  finance: { agent: "finance", run: financeFindings, extra: ["sales.pipeline", "sales.clients", "marketing.leads"] },
};
const TONE = { bad: "c-bad", warn: "c-warn", info: "c-info" };

/** “What the agent sees now” on a department overview, computed live from the records this person can see. */
export default function AgentCard({ dept, recs }: { dept: string; recs: Rec[] }) {
  const { lang, me, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const f = DEPT_FINDERS[dept];
  // Other departments' records the checks look at (only those this person may read)
  const [extra, setExtra] = useState<Rec[]>([]);
  useEffect(() => { const ids = (f?.extra || []).filter((id) => access.read.has(id)); if (ids.length) store.listMany(ids).then(setExtra).catch(() => {}); }, [dept, access]); // eslint-disable-line
  const all = useMemo(() => [...recs, ...extra.filter((x) => !recs.some((r) => r.id === x.id))], [recs, extra]);
  const items = useMemo(() => (f ? f.run(all as any, new Date().toISOString().slice(0, 10), DEFAULT_SETTINGS.thresholds) : []), [all, f]);
  if (!f) return null;
  const info = AGENT_INFO[f.agent];
  const order = { bad: 0, warn: 1, info: 2 };
  const list = [...items].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="card hub-card">
      <div className="card-h"><h2><Icon n={info.icon} />{T(info.name)}: {T(L("needs attention", "требует внимания", "потребує уваги", "يحتاج انتباهاً"))}</h2>
        <span className={`chip ${list.some((x) => x.level === "bad") ? "c-bad" : list.length ? "c-warn" : "c-ok"}`} style={{ marginInlineStart: "auto" }}>{list.length}</span></div>
      <div className="feed">{list.length ? list.slice(0, 10).map((x, i) => (
        <Link key={x.key + i} href={`/${x.rec.section.replace(".", "/")}?r=${x.rec.id}`} className="hub-row">
          <span><b style={{ fontWeight: 500 }}>{x.text}</b>{x.action && <small>{T(L("Agent prepares", "Агент готовит", "Агент готує", "يجهّز الوكيل"))}: {x.action.type === "set" ? `${x.action.field} → ${x.action.value}` : x.action.type === "email" ? T(L("reminder email (after approval)", "письмо-напоминание (после одобрения)", "лист-нагадування (після схвалення)", "رسالة تذكير (بعد الموافقة)")) : x.action.type}</small>}</span>
          <span className={`chip ${TONE[x.level]}`}>{x.level === "bad" ? "!" : x.level === "warn" ? "•" : "i"}</span></Link>))
        : <div className="empty" style={{ padding: 16 }}>{T(L("All clear — nothing for the agent to raise.", "Всё чисто — агенту нечего поднимать.", "Усе чисто — агентові нічого піднімати.", "كل شيء سليم — لا شيء ينبّه إليه الوكيل."))}</div>}</div>
      <p className="faint" style={{ margin: "8px 18px 14px", fontSize: 12.5 }}>{T(L("Every working day the agent emails these to the right people and prepares the changes.", "Каждый рабочий день агент пишет об этом нужным людям и готовит изменения.", "Щоробочого дня агент пише про це потрібним людям і готує зміни.", "كل يوم عمل يراسل الوكيل الأشخاص المعنيين ويجهّز التغييرات."))}{["owner", "admin"].includes(me.role) && <> <Link href="/admin/system?tab=auto">{T(L("Automation settings", "Настройки автоматизации", "Налаштування автоматизації", "إعدادات الأتمتة"))}</Link></>}</p>
    </div>);
}
