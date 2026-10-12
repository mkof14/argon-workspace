"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t } from "@/lib/i18n";
import { DEMO } from "@/lib/sb";

type Feed = { url: string; scope: "mine" | "all"; last_fetch?: string | null } | null;
const api = (b: any) => fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Error"))));

/** My profile → Deadlines in my calendar: a private subscription link for Google, Apple or Outlook calendar. */
export default function CalendarLink() {
  const { lang, me, toast } = useApp();
  const [feed, setFeed] = useState<Feed | undefined>(undefined);
  const [how, setHow] = useState<"google" | "apple" | "outlook">("google");
  const lead = ["owner", "admin", "management"].includes(me.role);
  useEffect(() => { if (DEMO) { setFeed(null); return; } api({ action: "get" }).then(setFeed).catch(() => setFeed(null)); }, []);
  const create = async (scope = feed?.scope || "mine") => { try { setFeed(await api({ action: "create", scope })); toast(t("cal_ready", lang)); } catch { toast(DEMO ? t("ai_demo", lang) : "Error", true); } };
  const scope = async (s: "mine" | "all") => { setFeed((f) => (f ? { ...f, scope: s } : f)); await api({ action: "scope", scope: s }).catch(() => {}); };
  const copy = async () => { if (feed) { await navigator.clipboard.writeText(feed.url); toast(t("copied", lang)); } };
  const webcal = feed ? feed.url.replace(/^https:/, "webcal:") : "";
  const steps: Record<string, string[]> = {
    google: [t("cal_g1", lang), t("cal_g2", lang), t("cal_g3", lang)],
    apple: [t("cal_a1", lang), t("cal_a2", lang), t("cal_a3", lang)],
    outlook: [t("cal_o1", lang), t("cal_o2", lang), t("cal_o3", lang)],
  };

  return (
    <section className="card">
      <div className="card-h"><h2><Icon n="calendar" />{t("cal_t", lang)}</h2></div>
      <div className="card-b" style={{ display: "grid", gap: 14 }}>
        <p className="muted" style={{ margin: 0 }}>{t("cal_p", lang)}</p>
        {feed === undefined ? <div className="faint">…</div> : !feed ? (
          <div><button className="btn primary" onClick={() => create("mine")}><Icon n="calendar" />{t("cal_create", lang)}</button></div>
        ) : <>
          {lead && <nav className="seg" aria-label={t("cal_what", lang)}>
            <button className={feed.scope === "mine" ? "on" : ""} onClick={() => scope("mine")}>{t("cal_mine", lang)}</button>
            <button className={feed.scope === "all" ? "on" : ""} onClick={() => scope("all")}>{t("cal_all", lang)}</button></nav>}
          <div className="cal-link"><input className="input mono" readOnly value={feed.url} onFocus={(e) => e.target.select()} aria-label={t("cal_t", lang)} />
            <button className="btn primary sm" onClick={copy}><Icon n="copy" />{t("copy", lang)}</button></div>
          <div className="toolbar">
            <a className="btn sm" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener"><Icon n="calendar" />{t("cal_open_google", lang)}</a>
            <a className="btn sm" href={webcal}><Icon n="calendar" />{t("cal_open_apple", lang)}</a>
          </div>
          <div>
            <nav className="seg">{(["google", "apple", "outlook"] as const).map((k) => <button key={k} className={how === k ? "on" : ""} onClick={() => setHow(k)}>{k === "google" ? "Google" : k === "apple" ? "iPhone / Mac" : "Outlook"}</button>)}</nav>
            <ol className="cal-steps">{steps[how].map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
          <p className="faint" style={{ margin: 0, fontSize: 13.5 }}><Icon n="lock" className="lockico" /> {t("cal_private", lang)}{feed.last_fetch ? ` ${t("cal_last", lang).replace("{d}", new Date(feed.last_fetch).toLocaleString())}` : ""}</p>
          <div className="toolbar"><button className="linkbtn" onClick={() => create()}>{t("cal_reset", lang)}</button>
            <button className="linkbtn" onClick={async () => { await api({ action: "delete" }).catch(() => {}); setFeed(null); }}>{t("cal_off", lang)}</button></div>
        </>}
      </div>
    </section>
  );
}
