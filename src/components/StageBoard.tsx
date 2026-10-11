"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx } from "@/lib/i18n";
import type { Rec } from "@/lib/store";
import { dayDiff } from "@/lib/insights";

// Typical win probability per pipeline stage, used for the weighted forecast
const WIN: Record<string, number> = { Lead: 0.1, Qualified: 0.25, Proposal: 0.5, Negotiation: 0.75, Won: 1, Lost: 0 };

/** Stages of one section as a proportional bar plus stage cards; click a stage to see its records. */
export default function StageBoard({ sec, rows, value, sub }: { sec: string; rows: Rec[]; value?: (r: Rec) => number; sub: (r: Rec) => string }) {
  const { lang, access } = useApp();
  const s = findSection(sec);
  const [open, setOpen] = useState<string>("");
  if (!s) return null;
  const href = `/${sec.replace(".", "/")}`;
  const money = (n: number) => n.toLocaleString(lang === "ar" ? "ar-AE" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const stages = s.statuses.map((st: string, i: number) => {
    const list = rows.filter((r) => r.status === st);
    return { st, i, list, n: list.length, v: value ? list.reduce((a, r) => a + value(r), 0) : 0 };
  });
  const total = rows.length;
  const totalV = value ? rows.reduce((a, r) => a + value(r), 0) : 0;
  const pipeline = sec === "sales.pipeline";
  const openDeals = pipeline ? rows.filter((r) => r.status !== "Won" && r.status !== "Lost") : [];
  const weighted = pipeline && value ? rows.reduce((a, r) => a + value(r) * (WIN[r.status || ""] ?? 0), 0) : 0;
  const shade = (i: number) => `color-mix(in srgb, ${s.color} ${Math.round(28 + (i / Math.max(1, s.statuses.length - 1)) * 72)}%, var(--surface))`;
  const cur = stages.find((x: any) => x.st === open);

  return (
    <div className="card stageboard" style={{ ["--dc" as any]: s.color }}>
      <div className="card-h">
        <h2><Icon n={s.icon} />{tx(s.label, lang)}</h2>
        <div className="sb-sum">
          <span><b className="mono">{total}</b> {t("sb_total", lang)}</span>
          {pipeline && <span><b className="mono">{money(openDeals.reduce((a, r) => a + (value ? value(r) : 0), 0))}</b> {t("sb_open_value", lang)}</span>}
          {pipeline && <span title={t("sb_weighted_hint", lang)}><b className="mono">{money(weighted)}</b> {t("sb_weighted", lang)}</span>}
          {!pipeline && total > 0 && <span><b className="mono">{stages[stages.length - 1].n}</b> {t("sb_done", lang)}</span>}
        </div>
        <Link className="btn ghost sm" style={{ marginInlineStart: "auto" }} href={href}>{t("open", lang)}</Link>
      </div>
      <div className="card-b" style={{ display: "grid", gap: 14 }}>
        {total === 0 ? (
          <div className="sb-empty"><span>{t("sb_empty", lang)}</span>
            {access.write.has(sec) && <Link href={`${href}?new=1`} className="btn primary sm"><Icon n="plus" />{t("new", lang)}</Link>}</div>
        ) : <>
          <div className="sb-bar" role="img" aria-label={stages.map((x: any) => `${x.st}: ${x.n}`).join(", ")}>
            {stages.filter((x: any) => x.n).map((x: any) => <button key={x.st} style={{ flexGrow: x.n, background: shade(x.i) }} title={`${x.st}: ${x.n}`} onClick={() => setOpen(open === x.st ? "" : x.st)} />)}
          </div>
          <div className="sb-stages">{stages.map((x: any) => (
            <button key={x.st} className={`sb-stage ${x.n ? "has" : ""} ${open === x.st ? "on" : ""}`} onClick={() => setOpen(open === x.st ? "" : x.st)} aria-expanded={open === x.st}>
              <span className="sb-dot" style={{ background: shade(x.i) }} />
              <b>{x.n}</b>
              <span className="sb-name">{x.st}</span>
              <small>{total ? Math.round((x.n / total) * 100) : 0}%{value && x.v ? ` · ${money(x.v)}` : ""}</small>
            </button>))}
          </div>
        </>}
        {cur && <div className="sb-detail">
          <div className="sb-detail-h"><b>{cur.st}</b><span className="faint">· {cur.n}{value && cur.v ? ` · ${money(cur.v)}` : ""}</span>
            <Link href={`${href}?st=${encodeURIComponent(cur.st)}`} className="btn ghost sm" style={{ marginInlineStart: "auto" }}>{t("sb_all_in_stage", lang)}</Link></div>
          {cur.list.length ? cur.list.slice(0, 12).map((r: Rec) => {
            const age = r.updated_at ? -dayDiff(r.updated_at) : 0;
            const due = r.data?.due ? dayDiff(r.data.due) : null;
            return <Link key={r.id} href={`${href}?r=${r.id}`} className="sb-row">
              <span style={{ minWidth: 0 }}><b>{r.title}</b><small>{sub(r)}</small></span>
              {value && value(r) ? <span className="mono">{money(value(r))}</span> : <span />}
              <span className={`chip ${due !== null && due < 0 ? "c-bad" : ""}`}>{due !== null ? (due < 0 ? t("days_late", lang).replace("{n}", String(-due)) : t("in_days", lang).replace("{n}", String(due))) : t("sb_updated_ago", lang).replace("{n}", String(age))}</span>
            </Link>; }) : <div className="faint" style={{ padding: "6px 2px" }}>{t("sb_none_here", lang)}</div>}
        </div>}
      </div>
    </div>
  );
}
