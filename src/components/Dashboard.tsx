"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx } from "@/lib/i18n";
import { Activity, Rec, store } from "@/lib/store";
import { tone } from "@/lib/format";

const KEYS = ["operations.builds", "sales.pipeline", "legal.issues", "operations.procurement", "operations.comms"];

export default function Dashboard({ depts }: { depts: any[] }) {
  const { lang, me, access, tick } = useApp();
  const [recs, setRecs] = useState<Rec[]>([]);
  const [act, setAct] = useState<Activity[]>([]);
  useEffect(() => {
    store.listMany(KEYS.filter((k) => access.read.has(k))).then(setRecs).catch(() => {});
    store.activity({ limit: 12 }).then(setAct).catch(() => {});
  }, [tick, access]);

  const of = (s: string) => recs.filter((r) => r.section === s);
  const builds = of("operations.builds"), deals = of("sales.pipeline"), issues = of("legal.issues"), pos = of("operations.procurement");
  const news = of("operations.comms").filter((r) => r.status === "Published");
  const openDeals = deals.filter((d) => d.status !== "Won" && d.status !== "Lost");
  const money = (n: number) => n.toLocaleString(lang === "ar" ? "ar-AE" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const kpis = [
    access.read.has("operations.builds") && { k: "kpi_builds", v: builds.filter((b) => b.status !== "Installed").length, href: "/operations/builds", c: "var(--accent)" },
    access.read.has("sales.pipeline") && { k: "kpi_pipeline", v: openDeals.length, sub: money(openDeals.reduce((a, d) => a + (Number(d.data?.value) || 0), 0)), href: "/sales/pipeline", c: "var(--info)" },
    access.read.has("legal.issues") && { k: "kpi_legal", v: issues.filter((i) => i.status !== "Resolved").length, href: "/legal/issues", c: "var(--bad)" },
    access.read.has("operations.procurement") && { k: "kpi_po", v: pos.filter((p) => !["Received", "Cancelled"].includes(p.status || "")).length, href: "/operations/procurement", c: "var(--warn)" },
  ].filter(Boolean) as any[];

  const stages = (sec: string, list: Rec[], valueOf?: (r: Rec) => number) => {
    const s = findSection(sec); if (!s) return null;
    const vals = s.statuses.map((st: string) => { const l = list.filter((r) => r.status === st); return { st, n: valueOf ? l.reduce((a, r) => a + valueOf(r), 0) : l.length, c: l.length }; });
    const max = Math.max(1, ...vals.map((v: any) => v.n));
    return vals.map((v: any) => (
      <div key={v.st} className="stage-row"><span className={`chip dot ${tone(v.st)}`} style={{ justifySelf: "start" }}>{v.st}</span>
        <div className="bar"><span style={{ width: `${(v.n / max) * 100}%` }} /></div><span className="mono" style={{ textAlign: "end" }}>{valueOf ? v.c : v.n}</span></div>));
  };

  return (
    <>
      <section className="hero">
        <div className="eyebrow" style={{ color: "#8E9BA9" }}>AGRON Inc. · StarDome · AGRON 1</div>
        <h2>{me.full_name}</h2>
        <p>{depts.map((d) => tx(d.label, lang)).join(" · ")}</p>
      </section>
      {kpis.length > 0 && <section className="kpis">{kpis.map((k) => (
        <Link key={k.k} href={k.href} className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="stripe" style={{ background: k.c }} /><div className="eyebrow">{t(k.k, lang)}</div><div className="v">{k.v}</div>{k.sub && <div className="faint mono" style={{ fontSize: 12 }}>{k.sub}</div>}
        </Link>))}</section>}
      {(access.read.has("operations.builds") || access.read.has("sales.pipeline")) && <section className="grid2">
        {access.read.has("operations.builds") && <div className="card"><div className="card-h"><h2>{t("builds_by_stage", lang)}</h2><Link className="btn ghost sm" style={{ marginInlineStart: "auto" }} href="/operations/builds">{t("open", lang)}</Link></div><div className="card-b">{stages("operations.builds", builds)}</div></div>}
        {access.read.has("sales.pipeline") && <div className="card"><div className="card-h"><h2>{t("pipeline_by_stage", lang)}</h2><Link className="btn ghost sm" style={{ marginInlineStart: "auto" }} href="/sales/pipeline">{t("open", lang)}</Link></div><div className="card-b">{stages("sales.pipeline", deals, (r) => Number(r.data?.value) || 0)}</div></div>}
      </section>}
      <section className="grid2">
        <div className="card"><div className="card-h"><h2>{t("recent", lang)}</h2></div><div className="feed">
          {act.length ? act.map((a) => { const s = findSection(a.section); return (
            <div key={a.id} className="feed-row"><span className="mono faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{(a.created_at || "").slice(5, 16).replace("T", " ")}</span>
              <span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{a.detail?.title}</b> <span className="faint">· {s ? tx(s.label, lang) : a.section} · {a.action}{a.action === "status" ? ` → ${a.detail?.to}` : ""}</span></span></div>); })
            : <div className="empty">{t("empty", lang)}</div>}
        </div></div>
        <div className="card"><div className="card-h"><h2>{t("announcements", lang)}</h2></div><div className="feed">
          {news.length ? news.slice(0, 5).map((n) => <div key={n.id} className="feed-row" style={{ display: "grid" }}><b>{n.title}</b><span className="muted">{n.data?.body}</span></div>) : <div className="empty">{t("empty", lang)}</div>}
        </div></div>
      </section>
      <section><div className="eyebrow" style={{ marginBottom: 10 }}>{t("departments", lang)}</div>
        <div className="depts">{depts.map((d) => (
          <Link key={d.key} href={`/${d.key}/${d.secs[0].key}`} className="dept-tile"><Icon n={d.icon} /><b>{tx(d.label, lang)}</b><span>{d.secs.map((s: any) => tx(s.label, lang)).join(" · ")}</span></Link>))}</div></section>
    </>
  );
}
