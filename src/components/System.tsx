"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { FullExport } from "./DataTools";
import BackupCenter from "./BackupCenter";
import OpsCenter from "./OpsCenter";
import Automation, { useAuto, L } from "./Automation";
import SysSettings from "./SysSettings";
import Quality from "./Quality";
import AcceptanceEvidence from "./AcceptanceEvidence";
import { tx, type Lang } from "@/lib/i18n";

const TABS = [
  { k: "health", icon: "pulse", t: L("Health", "Состояние", "Стан", "الحالة") },
  { k: "ops", icon: "server", t: L("Operations", "Операции", "Операції", "العمليات") },
  { k: "auto", icon: "cpu", t: L("Automation", "Автоматизация", "Автоматизація", "الأتمتة") },
  { k: "quality", icon: "check", t: L("Data quality & audit", "Качество данных и аудит", "Якість даних і аудит", "جودة البيانات والتدقيق") },
  { k: "settings", icon: "gear", t: L("Settings", "Настройки", "Налаштування", "الإعدادات") },
  { k: "backup", icon: "server", t: L("Backup", "Резервные копии", "Резервні копії", "النسخ الاحتياطي") },
  { k: "acceptance", icon: "check", t: L("Acceptance Evidence", "Доказательства приёмки", "Докази приймання", "أدلة القبول") },
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
    <div className="tabs card" role="tablist" style={{ ["--dc" as any]: "#5B6CF0" }}>{TABS.filter((x) => !["backup", "ops", "acceptance"].includes(x.k) || isOwnerOrAdmin).map((x) => (
      <button key={x.k} role="tab" aria-selected={tab === x.k} className={tab === x.k ? "on" : ""} onClick={() => go(x.k)}><Icon n={x.icon} />{tx(x.t, lang as Lang)}{x.k === "auto" && pending > 0 && <span className="chip c-warn" style={{ padding: "0 7px" }}>{pending}</span>}</button>))}</div>
    {tab === "health" && <Health />}
    {tab === "ops" && isOwnerOrAdmin && <OpsCenter />}
    {tab === "auto" && <Automation a={a} />}
    {tab === "quality" && <Quality a={a} />}
    {tab === "settings" && <SysSettings a={a} />}
    {tab === "acceptance" && isOwnerOrAdmin && <AcceptanceEvidence />}
    {tab === "backup" && <div style={{ display: "grid", gap: 16 }}>{isOwnerOrAdmin && <BackupCenter />}{me.role === "owner" && <FullExport />}</div>}
  </div>);
}

type Health = { ok: boolean; checks: Record<string, boolean>; ms: number; at: string; env?: string; release?: any; storage?: any; scheduler?: any; operations?: any; integrations?: Record<string, boolean> };
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
        <div className="card-b" style={{ paddingTop: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
          <div className="toolbar"><button className="btn sm" disabled={mtBusy} onClick={testMail}><Icon n="mail" />{mtBusy ? "…" : t("sys_mail_test", lang)}</button>
            <span className="faint" style={{ fontSize: 13.5 }}>{t("sys_mail_test_p", lang)}</span></div>
          {mt && <div className={`sys-msg ${mt.ok ? "ok" : "bad"}`} role="status"><b>{mt.ok ? t("sys_on", lang) : t("sys_mail_fail", lang)}</b> {mt.message}</div>}
        </div>
        <p className="faint" style={{ margin: "0 20px 16px", fontSize: 13.5 }}>{t("sys_uptime_note", lang)}</p>
      </section>
      {h?.release && <Support h={h} />}

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

const Z = (en: string, ru: string, uk: string, ar: string) => ({ en, ru, uk, ar });
/** Support view (owners and administrators; the health answer carries it only for them): release, database, storage, jobs, backup, queues, integrations. No secrets. */
function Support({ h }: { h: Health }) {
  const { lang } = useApp(); const T = (x: any) => tx(x, lang as Lang);
  const r = h.release, o = h.operations || {}, jobs = Object.entries(h.scheduler || {}).filter(([k]) => k !== "error") as [string, any][];
  const stale = jobs.filter(([, j]) => !j.fresh).map(([k]) => k);
  const lastRun = jobs.map(([, j]) => j.last_started).filter(Boolean).sort().pop();
  const yes = (v: boolean) => (v ? T(Z("yes", "да", "так", "نعم")) : T(Z("no", "нет", "ні", "لا")));
  const rows: [any, string][] = [
    [Z("Environment", "Среда", "Середовище", "البيئة"), String(r.env || h.env || "").toUpperCase()],
    [Z("App version", "Версия приложения", "Версія застосунку", "إصدار التطبيق"), r.app],
    [Z("Release", "Выпуск", "Випуск", "الإصدار"), r.sha || "—"],
    [Z("Deployed", "Развёрнуто", "Розгорнуто", "تاريخ النشر"), r.deployed_at ? new Date(r.deployed_at).toLocaleString() : "—"],
    [Z("Database version", "Версия базы данных", "Версія бази даних", "إصدار قاعدة البيانات"), `${r.db ?? "?"} / ${r.db_expected}${r.db_matches ? "" : " ⚠"}`],
    [Z("Storage", "Хранилище файлов", "Сховище файлів", "التخزين"), h.storage?.ok ? `OK · ${h.storage.ms} ms` : "⚠"],
    [Z("Last scheduler run", "Последний запуск планировщика", "Останній запуск планувальника", "آخر تشغيل للمجدول"), lastRun ? new Date(lastRun).toLocaleString() : "—"],
    [Z("Jobs not fresh", "Задания без свежего запуска", "Завдання без свіжого запуску", "مهام غير محدّثة"), stale.length ? stale.join(", ") : "0"],
    [Z("Failed jobs (24 h)", "Сбои заданий (24 ч)", "Збої завдань (24 год)", "مهام فاشلة (24 س)"), String(o.jobs_failed_24h ?? "—")],
    [Z("Last backup", "Последняя копия", "Остання копія", "آخر نسخة احتياطية"), o.backup?.at ? `${new Date(o.backup.at).toLocaleString()}${o.backup.verified ? " · ✓" : ""}${o.backup.offsite ? " · off-site" : ""}` : T(Z("none", "нет", "немає", "لا يوجد"))],
    [Z("Queues", "Очереди", "Черги", "قوائم الانتظار"), `automation ${JSON.stringify(o.automation_queue || {})} · outbound ${JSON.stringify(o.outbound || {})} · notices ${o.notifications_pending ?? 0}`],
    [Z("Errors / refused sign-ins (24 h)", "Ошибки / отклонённые входы (24 ч)", "Помилки / відхилені входи (24 год)", "أخطاء / دخول مرفوض (24 س)"), `${o.errors_24h ?? 0} / ${o.auth_failures_24h ?? 0}`],
    [Z("Database connections", "Подключения к базе", "Підключення до бази", "اتصالات قاعدة البيانات"), String(o.connections ?? "—")],
    [Z("Integrations", "Интеграции", "Інтеграції", "التكاملات"), Object.entries(h.integrations || {}).map(([k, v]) => `${k}: ${yes(v)}`).join(" · ")],
  ];
  return (<section className="card" data-support>
    <div className="card-h"><h2><Icon n="info" />{T(Z("Release and operations", "Выпуск и работа системы", "Випуск і робота системи", "الإصدار والتشغيل"))}</h2></div>
    <div className="card-b"><table className="tbl"><tbody>{rows.map(([k, v], i) => <tr key={i}><th scope="row" style={{ textAlign: "start", fontWeight: 600 }}>{T(k)}</th><td>{v}</td></tr>)}</tbody></table>
      <p className="faint" style={{ fontSize: 13.5 }}>{T(Z("Shown only to owners and administrators. No keys, passwords or addresses of the services.", "Видно только владельцам и администраторам. Без ключей, паролей и адресов сервисов.", "Видно лише власникам і адміністраторам. Без ключів, паролів і адрес сервісів.", "يظهر للمالكين والمسؤولين فقط. دون مفاتيح أو كلمات مرور أو عناوين الخدمات."))}</p></div>
  </section>);
}
