"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { FullExport } from "./DataTools";
import BackupCenter from "./BackupCenter";
import Automation, { useAuto, L } from "./Automation";
import SysSettings from "./SysSettings";
import Quality from "./Quality";
import { tx, type Lang } from "@/lib/i18n";

const TABS = [
  { k: "health", icon: "pulse", t: L("Health", "Состояние", "Стан", "الحالة") },
  { k: "auto", icon: "cpu", t: L("Automation", "Автоматизация", "Автоматизація", "الأتمتة") },
  { k: "quality", icon: "check", t: L("Data quality & audit", "Качество данных и аудит", "Якість даних і аудит", "جودة البيانات والتدقيق") },
  { k: "settings", icon: "gear", t: L("Settings", "Настройки", "Налаштування", "الإعدادات") },
  { k: "backup", icon: "server", t: L("Backup", "Резервные копии", "Резервні копії", "النسخ الاحتياطي") },
];

/** Administration → System, in tabs. The tab is kept in the address (?tab=…), so email links open the right place. */
export default function System() {
  const { lang, me } = useApp();
  const [tab, setTab] = useState("health");
  const a = useAuto();
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("tab"); if (q && TABS.some((x) => x.k === q)) setTab(q); }, []);
  const go = (k: string) => { setTab(k); try { const u = new URL(window.location.href); u.searchParams.set("tab", k); window.history.replaceState(window.history.state, "", u.toString()); } catch {} };
  const pending = a.s?.queue.filter((q) => q.status === "pending").length || 0;
  const isOwnerOrAdmin = ["owner", "admin"].includes(me.role);
  return (<div style={{ display: "grid", gap: 16 }}>
    <div className="tabs card" role="tablist" style={{ ["--dc" as any]: "#5B6CF0" }}>{TABS.filter((x) => x.k !== "backup" || isOwnerOrAdmin).map((x) => (
      <button key={x.k} role="tab" aria-selected={tab === x.k} className={tab === x.k ? "on" : ""} onClick={() => go(x.k)}><Icon n={x.icon} />{tx(x.t, lang as Lang)}{x.k === "auto" && pending > 0 && <span className="chip c-warn" style={{ padding: "0 7px" }}>{pending}</span>}</button>))}</div>
    {tab === "health" && <Health />}
    {tab === "auto" && <Automation a={a} />}
    {tab === "quality" && <Quality a={a} />}
    {tab === "settings" && <SysSettings a={a} />}
    {tab === "backup" && <div style={{ display: "grid", gap: 16 }}>{isOwnerOrAdmin && <BackupCenter />}{me.role === "owner" && <FullExport />}</div>}
  </div>);
}

type Health = { ok: boolean; checks: Record<string, boolean>; ms: number; at: string };
type Err = { id: number; created_at: string; user_id: string | null; source: string; message: string; stack: string | null; url: string | null; agent: string | null; version: string | null; resolved: boolean };

/** Live health of the services and the error log. */
function Health() {
  const { lang, toast, people } = useApp();
  const [h, setH] = useState<Health | null>(null);
  const [errs, setErrs] = useState<Err[]>([]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [mt, setMt] = useState<{ ok: boolean; code: string; message: string } | null>(null);
  const [mtBusy, setMtBusy] = useState(false);
  const testMail = async () => {
    setMtBusy(true); setMt(null);
    try { const r = await fetch("/api/mail/test", { method: "POST" }); setMt(r.ok ? await r.json() : { ok: false, code: "http", message: await r.text() }); }
    catch (e: any) { setMt({ ok: false, code: "net", message: e.message || "Error" }); } finally { setMtBusy(false); }
  };

  const loadHealth = () => fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then(setH).catch(() => setH({ ok: false, checks: { app: false }, ms: 0, at: new Date().toISOString() }));
  const loadErrs = async () => {
    if (DEMO) return;
    let q = sb().from("app_errors").select("*").order("created_at", { ascending: false }).limit(100);
    if (!all) q = q.eq("resolved", false);
    const { data, error } = await q; if (error) toast(error.message, true); else setErrs(data as Err[]);
  };
  useEffect(() => { loadHealth(); }, []);
  useEffect(() => { loadErrs(); }, [all]); // eslint-disable-line

  const resolve = async (ids: number[]) => {
    const { error } = await sb().from("app_errors").update({ resolved: true }).in("id", ids);
    if (error) toast(error.message, true); else { toast(t("saved", lang)); loadErrs(); }
  };
  const who = (id: string | null) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : "—"; };
  const names: Record<string, string> = { app: t("sys_app", lang), db: t("sys_db", lang), auth: t("sys_auth", lang), mail: t("sys_mail", lang), ai: t("sys_ai", lang) };
  const hints: Record<string, string> = { mail: t("sys_mail_hint", lang) };
  const open7 = errs.filter((e) => !e.resolved && Date.now() - Date.parse(e.created_at) < 7 * 864e5).length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="card">
        <div className="card-h toolbar"><h2><Icon n="pulse" />{t("sys_health", lang)}</h2>
          {h && <span className={`chip ${h.ok ? "c-ok" : "c-bad"}`} style={{ marginInlineStart: "auto" }}>{h.ok ? t("sys_ok", lang) : t("sys_down", lang)} · {h.ms} ms</span>}
          <button className="btn ghost sm" onClick={loadHealth}><Icon n="refresh" />{t("sys_check", lang)}</button></div>
        <div className="card-b sys-grid">
          {h ? Object.entries(h.checks).map(([k, v]) => (
            <div key={k} className={`sys-tile ${v ? "ok" : ["mail", "ai"].includes(k) ? "warn" : "bad"}`}>
              <span className="sys-dot" aria-hidden="true" /><b>{names[k] || k}</b>
              <span className="faint">{v ? t("sys_on", lang) : hints[k] || t("sys_off", lang)}</span>
            </div>)) : <div className="faint">…</div>}
        </div>
        <div className="card-b" style={{ paddingTop: 0, display: "grid", gap: 10 }}>
          <div className="toolbar"><button className="btn sm" disabled={mtBusy} onClick={testMail}><Icon n="mail" />{mtBusy ? "…" : t("sys_mail_test", lang)}</button>
            <span className="faint" style={{ fontSize: 13.5 }}>{t("sys_mail_test_p", lang)}</span></div>
          {mt && <div className={`sys-msg ${mt.ok ? "ok" : "bad"}`} role="status"><b>{mt.ok ? t("sys_on", lang) : t("sys_mail_fail", lang)}</b> {mt.message}</div>}
        </div>
        <p className="faint" style={{ margin: "0 20px 16px", fontSize: 13.5 }}>{t("sys_uptime_note", lang)}</p>
      </section>

      <section className="card">
        <div className="card-h toolbar"><h2><Icon n="alert" />{t("sys_errors", lang)}</h2>
          <span className={`chip ${open7 ? "c-warn" : "c-ok"}`}>{open7} · 7 {t("sys_days", lang)}</span>
          <label className="toolbar" style={{ gap: 6, marginInlineStart: "auto", fontSize: 14 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t("sys_show_resolved", lang)}</label>
          {errs.some((e) => !e.resolved) && <button className="btn ghost sm" onClick={() => resolve(errs.filter((e) => !e.resolved).map((e) => e.id))}><Icon n="check" />{t("sys_resolve_all", lang)}</button>}
        </div>
        {errs.length ? <div className="feed">{errs.map((e) => (
          <div key={e.id} className="feed-row" style={{ display: "grid", gap: 4, opacity: e.resolved ? 0.55 : 1 }}>
            <div className="toolbar" style={{ gap: 8 }}>
              <span className={`chip ${e.resolved ? "" : "c-bad"}`}>{e.source}</span>
              <span className="faint mono" style={{ fontSize: 12.5 }}>{e.created_at.slice(0, 16).replace("T", " ")} · {e.url || ""} · {who(e.user_id)}{e.version ? ` · v${e.version}` : ""}</span>
              <span style={{ marginInlineStart: "auto" }} />
              {e.stack && <button className="linkbtn" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t("sys_hide", lang) : t("sys_details", lang)}</button>}
              {!e.resolved && <button className="btn ghost sm" onClick={() => resolve([e.id])}><Icon n="check" />{t("sys_resolve", lang)}</button>}
            </div>
            <b style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{e.message}</b>
            {open === e.id && <pre className="mono sys-stack">{e.stack}{"\n\n"}{e.agent}</pre>}
          </div>))}</div> : <div className="empty">{t("sys_no_errors", lang)}</div>}
      </section>

    </div>
  );
}
