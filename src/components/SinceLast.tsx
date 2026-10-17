"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Activity, type Comment } from "@/lib/store";
import { city, localTime } from "@/lib/tz";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Item = { key: string; at: string; section: string; record: string; title: string; what: string; who: string | null };

/** My day: what colleagues and agents changed in your sections since your previous visit. */
export default function SinceLast() {
  const { lang, me, people } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [since, setSince] = useState<string>("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!me) return;
    const prev = me.prefs?.seen_at || new Date(Date.now() - 3 * 864e5).toISOString();
    setSince(prev);
    (async () => {
      const [acts, cmts] = await Promise.all([store.activity({ since: prev, limit: 150 }).catch(() => [] as Activity[]), store.commentsSince(prev, me.id).catch(() => [] as (Comment & { section?: string; title?: string })[])]);
      const list: Item[] = [
        ...acts.filter((a) => a.actor !== me.id && a.record_id).map((a) => ({ key: "a" + a.id, at: a.created_at, section: a.section, record: a.record_id!, title: a.detail?.title || "", who: a.actor,
          what: a.action === "status" ? `${a.detail?.from || "—"} → ${a.detail?.to || "—"}` : a.action })),
        ...cmts.filter((c) => c.section).map((c) => ({ key: "c" + c.id, at: c.created_at, section: c.section!, record: c.record_id, title: c.title || "", who: c.author, what: "comment:" + c.body.slice(0, 120) })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      const ok = await store.visibleIds(list.map((x) => x.record)).catch(() => new Set<string>());
      const vis = list.filter((x) => ok.has(x.record)); // only records this person may open now
      // One line per record and kind of change
      const seen = new Set<string>(); setItems(vis.filter((x) => { const k = x.record + (x.what.startsWith("comment:") ? "c" : x.what); if (seen.has(k)) return false; seen.add(k); return true; }));
      // This visit becomes the new "last visit" (shown on the next one)
      const prefs = { ...(me.prefs || {}), seen_at: new Date().toISOString() }; me.prefs = prefs;
      store.updateProfile(me.id, { prefs }).catch(() => {});
    })();
  }, [me?.id]); // eslint-disable-line
  if (!items || !items.length) return null;
  const name = (id: string | null) => { if (!id) return T(L("Automation", "Автоматизация", "Автоматизація", "الأتمتة")); const p = people.find((x) => x.id === id); return p ? (p.full_name || p.email).split(" ")[0] : "—"; };
  const verb = (w: string) => w === "created" ? T(L("created", "создал(а)", "створив(ла)", "أنشأ")) : w === "updated" ? T(L("changed", "изменил(а)", "змінив(ла)", "عدّل")) : w === "deleted" ? T(L("deleted", "удалил(а)", "видалив(ла)", "حذف")) : w === "restored" ? T(L("restored", "вернул(а)", "повернув(ла)", "استعاد")) : w;
  const shown = all ? items : items.slice(0, 8);
  return <section className="card">
    <div className="card-h toolbar"><h2><Icon n="refresh" />{T(L("Since your last visit", "С вашего прошлого визита", "З вашого минулого візиту", "منذ زيارتك الأخيرة"))}</h2>
      <span className="chip mono">{items.length}</span><span className="faint" style={{ fontSize: 13, marginInlineStart: "auto" }}>{since.slice(0, 16).replace("T", " ")}</span></div>
    <div className="feed">{shown.map((x) => { const s = findSection(x.section); const c = x.what.startsWith("comment:"); return (
      <Link key={x.key} href={`/${x.section.replace(".", "/")}?r=${x.record}`} className="feed-row" style={{ ["--dc" as any]: s?.color }}>
        <span className="flag"><Icon n={c ? "edit" : s?.icon || "file"} /></span>
        <span style={{ flex: 1, minWidth: 0 }}><b style={{ overflowWrap: "anywhere" }}>{x.title}</b>
          <small className="faint" style={{ display: "block" }}>{tx(s?.label, lang as Lang)} · {name(x.who)} {c ? `💬 ${x.what.slice(8)}` : verb(x.what)}</small></span>
        <span className="faint mono" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{x.at.slice(5, 16).replace("T", " ")}</span>
      </Link>); })}</div>
    {items.length > 8 && <div className="card-b"><button className="btn ghost sm" onClick={() => setAll(!all)}>{all ? T(L("Show less", "Свернуть", "Згорнути", "عرض أقل")) : `${T(L("Show all", "Показать все", "Показати все", "عرض الكل"))} (${items.length})`}</button></div>}
  </section>;
}

/** Team clock: local time in every city where colleagues work, so nobody calls at 2 a.m. */
export function TeamClock() {
  const { lang, people, me } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [, setNow] = useState(0);
  useEffect(() => { const h = setInterval(() => setNow((x) => x + 1), 60000); return () => clearInterval(h); }, []);
  const zones = new Map<string, string[]>();
  for (const p of people as any[]) if (p.timezone && p.role !== "pending") zones.set(p.timezone, [...(zones.get(p.timezone) || []), (p.full_name || p.email).split(" ")[0]]);
  if (zones.size < 2) return null;
  const d = new Date();
  return <div className="team-clock" aria-label={T(L("Team time", "Время команды", "Час команди", "توقيت الفريق"))}>
    <Icon n="clock" />{[...zones.entries()].sort((a, b) => localTime(d, a[0]).localeCompare(localTime(d, b[0]))).map(([z, names]) => {
      const h = Number(localTime(d, z).slice(0, 2)); const off = h < 8 || h >= 20;
      return <span key={z} className={`chip ${off ? "" : "c-ok"} ${z === me?.timezone ? "me" : ""}`} title={names.join(", ")}>{city(z)} <b className="mono">{localTime(d, z)}</b>{off ? " 🌙" : ""}</span>;
    })}</div>;
}
