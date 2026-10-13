"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection, SECTIONS } from "./App";
import { DEPT_COLORS } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { Activity, Rec, store } from "@/lib/store";
import { tone } from "@/lib/format";
import { DUE_KEYS, dueItems } from "@/lib/insights";
import StageBoard from "./StageBoard";

const KEYS = ["operations.builds", "sales.pipeline", "legal.issues", "operations.procurement", "operations.comms", "sales.tenders", "operations.support"];
const dayDiff = (d: string) => Math.round((new Date(d).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);

export default function Dashboard({ depts }: { depts: any[] }) {
  const { lang, me, access, tick, openMail } = useApp();
  const [recs, setRecs] = useState<Rec[]>([]);
  const [due, setDue] = useState<{ r: Rec; k: string; d: number }[]>([]);
  const [act, setAct] = useState<Activity[]>([]);
  useEffect(() => {
    store.listMany(KEYS.filter((k) => access.read.has(k))).then(setRecs).catch(() => {});
    store.activity({ limit: 12 }).then(setAct).catch(() => {});
    // Deadlines across every section the user can open (except the large compliance matrix)
    const secs = SECTIONS.filter((s) => access.read.has(s.id) && s.id !== "legal.matrix" && s.fields.some((f: any) => DUE_KEYS.includes(f.key))).map((s) => s.id);
    store.listMany(secs).then((all) => {
      setDue(dueItems(all, 30).slice(0, 10));
    }).catch(() => {});
  }, [tick, access]);

  const of = (s: string) => recs.filter((r) => r.section === s);
  const builds = of("operations.builds"), deals = of("sales.pipeline"), issues = of("legal.issues"), pos = of("operations.procurement");
  const news = of("operations.comms").filter((r) => r.status === "Published");
  const openDeals = deals.filter((d) => d.status !== "Won" && d.status !== "Lost");
  const money = (n: number) => n.toLocaleString(lang === "ar" ? "ar-AE" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const hour = new Date().getHours();
  const hello = { en: hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening", ru: hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер", uk: hour < 12 ? "Доброго ранку" : hour < 18 ? "Добрий день" : "Добрий вечір", ar: hour < 12 ? "صباح الخير" : "مساء الخير" }[lang];

  const kpis = [
    access.read.has("operations.builds") && { k: "kpi_builds", v: builds.filter((b) => b.status !== "Installed").length, href: "/operations/builds", c: DEPT_COLORS.operations, i: "container" },
    access.read.has("sales.pipeline") && { k: "kpi_pipeline", v: openDeals.length, sub: money(openDeals.reduce((a, d) => a + (Number(d.data?.value) || 0), 0)), href: "/sales/pipeline", c: DEPT_COLORS.sales, i: "funnel" },
    access.read.has("legal.issues") && { k: "kpi_legal", v: issues.filter((i) => i.status !== "Resolved").length, href: "/legal/issues", c: DEPT_COLORS.legal, i: "scale" },
    access.read.has("operations.procurement") && { k: "kpi_po", v: pos.filter((p) => !["Received", "Cancelled"].includes(p.status || "")).length, href: "/operations/procurement", c: DEPT_COLORS.technical, i: "cart" },
  ].filter(Boolean) as any[];

  const quick = [
    access.write.has("sales.pipeline") && { l: tx(findSection("sales.pipeline")?.label, lang), href: "/sales/pipeline", i: "funnel", c: DEPT_COLORS.sales },
    access.write.has("finance.expenses") && { l: tx(findSection("finance.expenses")?.label, lang), href: "/finance/expenses", i: "receipt", c: DEPT_COLORS.finance },
    access.write.has("hr.leave") && { l: tx(findSection("hr.leave")?.label, lang), href: "/hr/leave", i: "sun", c: DEPT_COLORS.hr },
    access.write.has("security.incidents") && { l: tx(findSection("security.incidents")?.label, lang), href: "/security/incidents", i: "alert", c: DEPT_COLORS.security },
    access.read.has("marketing.media") && { l: tx(findSection("marketing.media")?.label, lang), href: "/marketing/media", i: "image", c: DEPT_COLORS.marketing },
  ].filter(Boolean) as any[];

  return (
    <>
      <section className="hero">
        <div className="eyebrow" style={{ color: "#8E9BA9" }}>AGRON Inc.</div>
        <h2>{hello}, {(me.full_name || "").split(" ")[0]}</h2>
        <p>{new Date().toLocaleDateString(lang === "ar" ? "ar-AE" : lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {depts.length} {t("departments", lang).toLowerCase()}</p>
        <div className="toolbar" style={{ marginTop: 14, position: "relative", zIndex: 1 }}>
          {!!access.read.has("mail.templates") && <button className="btn sm" style={{ background: "#FF6A2B", color: "#140A05", borderColor: "#FF6A2B" }} onClick={() => openMail({})}><Icon n="mail" />{t("write_email", lang)}</button>}
          <Link href="/reports" className="btn sm" style={{ background: "rgba(255,255,255,.06)", color: "#E9EEF3", borderColor: "rgba(255,255,255,.14)" }}><Icon n="pie" />{t("get_report", lang)}</Link>
          {quick.map((q) => <Link key={q.href} href={q.href} className="btn sm" style={{ background: "rgba(255,255,255,.06)", color: "#E9EEF3", borderColor: "rgba(255,255,255,.14)" }}><Icon n={q.i} />{q.l}</Link>)}
        </div>
      </section>
      {kpis.length > 0 && <section className="kpis">{kpis.map((k) => (
        <Link key={k.k} href={k.href} className="kpi" style={{ textDecoration: "none", color: "inherit", ["--dc" as any]: k.c }}>
          <span className="ic"><Icon n={k.i} /></span><div className="eyebrow">{t(k.k, lang)}</div><div className="v">{k.v}</div>{k.sub && <div className="faint mono" style={{ fontSize: 13 }}>{k.sub}</div>}
        </Link>))}</section>}
      <section className="grid2">
        <div className="card" style={{ ["--dc" as any]: "#E5484D" }}><div className="card-h"><h2><Icon n="clock" />{t("upcoming", lang)}</h2></div><div className="feed">
          {due.length ? due.map(({ r, k, d }) => { const s = findSection(r.section); return (
            <Link key={r.id + k} href={`/${r.section.replace(".", "/")}?r=${r.id}`} className="deadline" style={{ ["--dc" as any]: s?.color }}>
              <span className="dic"><Icon n={s?.icon || "clock"} /></span>
              <span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{r.title}</b><br /><span className="faint" style={{ fontSize: 13 }}>{s ? tx(s.label, lang) : ""} · {tx(s?.fields.find((f: any) => f.key === k)?.label, lang)}</span></span>
              <span className={`chip ${d < 0 ? "c-bad" : d <= 7 ? "c-warn" : "c-info"}`}>{d < 0 ? t("days_late", lang).replace("{n}", String(-d)) : d === 0 ? t("today", lang) : t("in_days", lang).replace("{n}", String(d))}</span>
            </Link>); }) : <div className="empty">{t("no_deadlines", lang)}</div>}
        </div></div>
        <div className="card" style={{ ["--dc" as any]: DEPT_COLORS.operations }}><div className="card-h"><h2><Icon n="megaphone" />{t("announcements", lang)}</h2></div><div className="feed">
          {news.length ? news.slice(0, 5).map((n) => <div key={n.id} className="feed-row" style={{ display: "grid" }}><b>{n.title}</b><span className="muted">{n.data?.body}</span></div>) : <div className="empty">{t("empty", lang)}</div>}
        </div></div>
      </section>
      {(access.read.has("operations.builds") || access.read.has("sales.pipeline")) && <section style={{ display: "grid", gap: 16 }}>
        {access.read.has("operations.builds") && <StageBoard sec="operations.builds" rows={builds} sub={(r) => [r.data?.client, r.data?.config && `StarDome ${r.data.config}`, r.data?.site, r.data?.owner].filter(Boolean).join(" · ")} />}
        {access.read.has("sales.pipeline") && <StageBoard sec="sales.pipeline" rows={deals} value={(r) => Number(r.data?.value) || 0} sub={(r) => [r.data?.client, r.data?.config && `StarDome ${r.data.config}`, r.data?.country, r.data?.owner].filter(Boolean).join(" · ")} />}
      </section>}
      <section><div className="eyebrow" style={{ marginBottom: 10 }}>{t("departments", lang)}</div>
        <div className="depts">{depts.map((d) => (
          <Link key={d.key} href={["technical", "operations", "finance", "sales", "marketing", "security", "legal", "hr", "company"].includes(d.key) ? `/${d.key}/overview` : `/${d.key}/${d.secs[0].key}`} className="dept-tile" style={{ ["--dc" as any]: (DEPT_COLORS as any)[d.key] }}>
            <span className="ic"><Icon n={d.icon} /></span><b>{tx(d.label, lang)}</b>
            <span>{d.secs.slice(0, 5).map((s: any) => tx(s.label, lang)).join(" · ")}{d.secs.length > 5 ? " …" : ""}</span>
            <span className="cnt">{d.secs.length} {t("sections_n", lang)}</span></Link>))}</div></section>
      <section className="card" style={{ ["--dc" as any]: "#5B6CF0" }}><div className="card-h"><h2><Icon n="clock" />{t("recent", lang)}</h2></div><div className="feed">
        {act.length ? act.map((a) => { const s = findSection(a.section); return (
          <div key={a.id} className="feed-row"><span className="mono faint" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{(a.created_at || "").slice(5, 16).replace("T", " ")}</span>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s?.color || "var(--line)", flex: "none", alignSelf: "center" }} />
            <span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{a.detail?.title}</b> <span className="faint">· {s ? tx(s.label, lang) : a.section} · {a.action}{a.action === "status" ? ` → ${a.detail?.to}` : ""}</span></span></div>); })
          : <div className="empty">{t("empty", lang)}</div>}
      </div></section>
    </>
  );
}
