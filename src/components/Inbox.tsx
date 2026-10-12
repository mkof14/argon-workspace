"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection, SECTIONS } from "./App";
import { t, tx } from "@/lib/i18n";
import { Rec, store } from "@/lib/store";
import { DueItem, dueItems, isMine } from "@/lib/insights";
import { DEMO, sb } from "@/lib/sb";

const SEEN = "agronws.inbox.seen";
type Mention = Awaited<ReturnType<typeof store.mentions>>[number];

// One shared load for the bell and the footer (same tick → same request)
type Appr = { id: string; record_id: string; section: string; created_at: string; title?: string };
const cache: { k: string; recs?: Promise<Rec[]>; men?: Promise<Mention[]>; appr?: Promise<Appr[]> } = { k: "" };
/** Loads everything the bell needs once per app reload. */
export function useInbox() {
  const { me, access, tick } = useApp();
  const [recs, setRecs] = useState<Rec[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [approvals, setApprovals] = useState<Appr[]>([]);
  useEffect(() => {
    const secs = SECTIONS.filter((s) => access.read.has(s.id) && s.id !== "legal.matrix" && s.view !== "mail").map((s) => s.id);
    const k = `${tick}|${secs.length}|${me.id}`;
    if (cache.k !== k) { cache.k = k; cache.recs = store.listMany(secs); cache.men = store.mentions(me.full_name || "");
      cache.appr = DEMO ? Promise.resolve([]) : (async () => { const { data } = await sb().from("approvals").select("id,record_id,section,created_at").eq("approver_id", me.id).eq("status", "pending").order("created_at"); const ids = (data || []).map((x: any) => x.record_id); if (!ids.length) return []; const { data: rs } = await sb().from("records").select("id,title").in("id", ids); return (data || []).map((x: any) => ({ ...x, title: rs?.find((r: any) => r.id === x.record_id)?.title })); })(); }
    cache.recs!.then(setRecs).catch(() => {});
    cache.men!.then(setMentions).catch(() => {});
    cache.appr!.then(setApprovals).catch(() => {});
  }, [tick, access, me.full_name]);
  const due = useMemo(() => dueItems(recs, 14), [recs]);
  const mine = useMemo(() => due.filter((x) => isMine(x.r, me)), [due, me]);
  const lead = ["owner", "admin", "management"].includes(me.role);
  const company = lead ? due.filter((x) => x.d < 0 && !isMine(x.r, me)) : [];
  let seen = ""; try { seen = localStorage.getItem(SEEN) || ""; } catch {}
  const newMentions = mentions.filter((m) => m.created_at > seen);
  const count = approvals.length + mine.filter((x) => x.d <= 1).length + newMentions.length + Math.min(company.length, 9);
  return { recs, due, mine, company, mentions, newMentions, approvals, count };
}

export default function Inbox({ data, onClose }: { data: ReturnType<typeof useInbox>; onClose: () => void }) {
  const { lang, me, access, toast, reload, people } = useApp();
  const [tab, setTab] = useState<"mine" | "company" | "mentions">("mine");
  const [title, setTitle] = useState(""); const [who, setWho] = useState(me.full_name || me.email); const [when, setWhen] = useState(new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  useEffect(() => { try { localStorage.setItem(SEEN, new Date().toISOString()); } catch {} }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const add = async () => {
    if (!title.trim()) return;
    try { await store.save({ section: "company.tasks", title: title.trim(), status: "Open", data: { assignee: who, due: when, priority: "Medium" } }); setTitle(""); toast(t("reminder_set", lang)); reload(); }
    catch (e: any) { toast(e.message || "Error", true); }
  };
  const row = ({ r, k, d }: DueItem) => { const s = findSection(r.section); return (
    <Link key={r.id + k} href={`/${r.section.replace(".", "/")}?r=${r.id}`} className="deadline" onClick={onClose} style={{ ["--dc" as any]: s?.color }}>
      <span className="dic"><Icon n={s?.icon || "clock"} /></span>
      <span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{r.title}</b><br /><span className="faint" style={{ fontSize: 13 }}>{s ? tx(s.label, lang) : ""} · {tx(s?.fields.find((f: any) => f.key === k)?.label, lang)}</span></span>
      <span className={`chip ${d < 0 ? "c-bad" : d <= 2 ? "c-warn" : "c-info"}`}>{d < 0 ? t("days_late", lang).replace("{n}", String(-d)) : d === 0 ? t("today", lang) : t("in_days", lang).replace("{n}", String(d))}</span>
    </Link>); };
  const tabs: [typeof tab, string, number][] = [["mine", t("for_me", lang), data.mine.length], ...(data.company.length || ["owner", "admin", "management"].includes(me.role) ? [["company", t("overdue_company", lang), data.company.length]] as any : []), ["mentions", t("mentions", lang), data.mentions.length]];

  return (
    <>
      <div className="scrim" style={{ background: "transparent" }} onClick={onClose} />
      <div className="inbox" role="dialog" aria-label={t("notifications", lang)}>
        <div className="inbox-h"><b>{t("notifications", lang)}</b><Link href="/reports" className="btn ghost sm" onClick={onClose}><Icon n="pie" />{t("reports", lang)}</Link></div>
        <nav className="seg" style={{ margin: "0 14px" }}>{tabs.map(([k, l, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l} <b className="mono">{n}</b></button>)}</nav>
        <div className="feed inbox-b">
          {tab === "mine" && data.approvals.length > 0 && <div className="inbox-appr"><b><Icon n="check" /> {t("appr_for_you", lang)}</b>
            {data.approvals.map((x) => { const s = findSection(x.section); return <Link key={x.id} href={`/${x.section.replace(".", "/")}?r=${x.record_id}`} className="deadline" onClick={onClose} style={{ ["--dc" as any]: s?.color }}>
              <span className="dic"><Icon n={s?.icon || "check"} /></span><span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{x.title || "—"}</b><br /><span className="faint" style={{ fontSize: 13 }}>{s ? tx(s.label, lang) : ""} · {x.created_at.slice(0, 10)}</span></span>
              <span className="chip c-warn">{t("appr_pending", lang)}</span></Link>; })}</div>}
          {tab === "mine" && (data.mine.length || data.approvals.length ? data.mine.map(row) : <div className="empty">{t("nothing_for_you", lang)}</div>)}
          {tab === "company" && (data.company.length ? data.company.slice(0, 40).map(row) : <div className="empty">{t("no_overdue", lang)}</div>)}
          {tab === "mentions" && (data.mentions.length ? data.mentions.map((m) => (
            <Link key={m.id} href={m.section ? `/${m.section.replace(".", "/")}?r=${m.record_id}` : "#"} onClick={onClose} className="feed-row" style={{ display: "grid", textDecoration: "none", color: "inherit" }}>
              <span className="faint" style={{ fontSize: 12.5 }}>{(m.created_at || "").slice(0, 16).replace("T", " ")} · {m.title}</span>
              <span>{m.body}</span></Link>)) : <div className="empty">{t("no_mentions", lang)}</div>)}
        </div>
        {access.write.has("company.tasks") && <form className="inbox-f" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <b style={{ fontSize: 14 }}><Icon n="bell" /> {t("new_reminder", lang)}</b>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("reminder_what", lang)} aria-label={t("reminder_what", lang)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px auto", gap: 8 }}>
            <input className="input" list="inbox-people" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("for_whom", lang)} />
            <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={t("date", lang)} />
            <button className="btn primary sm" disabled={!title.trim()}>{t("add", lang)}</button>
          </div>
          <datalist id="inbox-people">{people.map((p) => <option key={p.id} value={p.full_name || p.email} />)}</datalist>
        </form>}
      </div>
    </>
  );
}

/** Bell button with a counter; opens the notifications panel. */
export function Bell() {
  const { lang } = useApp();
  const data = useInbox();
  const [open, setOpen] = useState(false);
  return <>
    <button className="iconbtn bell" onClick={() => setOpen(!open)} title={t("notifications", lang)} aria-label={`${t("notifications", lang)}${data.count ? ` (${data.count})` : ""}`}>
      <Icon n="bell" />{data.count > 0 && <span className="badge">{data.count > 9 ? "9+" : data.count}</span>}
    </button>
    {open && <Inbox data={data} onClose={() => setOpen(false)} />}
  </>;
}
