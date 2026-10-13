"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, Rec, store } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const S = {
  title: L("Systems and monitoring", "Системы и мониторинг", "Системи та моніторинг", "الأنظمة والمراقبة"),
  sub: L("Every system the company runs on: open it or its console in one click; Check now opens each health link from our server and records status and response time.", "Все системы компании: откройте систему или её консоль одним нажатием; «Проверить сейчас» открывает адрес проверки каждой системы с нашего сервера и записывает статус и время ответа.", "Усі системи компанії: відкрийте систему або її консоль одним натисканням; «Перевірити зараз» відкриває адресу перевірки кожної системи з нашого сервера й записує статус і час відповіді.", "كل أنظمة الشركة: افتح النظام أو لوحته بنقرة؛ «افحص الآن» يفتح رابط الفحص من خادمنا ويسجل الحالة وزمن الاستجابة."),
  check: L("Check now", "Проверить сейчас", "Перевірити зараз", "افحص الآن"), open: L("Open", "Открыть", "Відкрити", "فتح"), console: L("Console", "Консоль", "Консоль", "اللوحة"),
  add: L("Add system", "Добавить систему", "Додати систему", "إضافة نظام"), none: L("No systems yet.", "Систем пока нет.", "Систем поки немає.", "لا أنظمة بعد."),
  ok: L("operational", "работают", "працюють", "تعمل"), down: L("need attention", "требуют внимания", "потребують уваги", "تحتاج انتباهاً"),
  commit: L("Last commit", "Последний коммит", "Останній коміт", "آخر تعديل"), ci: L("Tests (CI)", "Тесты (CI)", "Тести (CI)", "الاختبارات"), issues: L("Open issues / pull requests", "Открытые задачи / запросы", "Відкриті задачі / запити", "المشكلات / الطلبات المفتوحة"),
  metrics: L("Engineering metrics", "Инженерные метрики", "Інженерні метрики", "المقاييس الهندسية"),
};
const DOT: Record<string, string> = { Operational: "var(--ok)", Degraded: "var(--warn)", Down: "var(--bad)", Unknown: "var(--ink-3)" };
type Gh = { name: string; url: string; branch: string; open_issues: number; open_prs: number; last_commit: { date: string; message: string; author: string } | null; ci: { status: string; conclusion: string | null; date: string; url: string } | null };

export default function SystemsBoard({ compact = false }: { compact?: boolean }) {
  const { lang, access, toast, tick } = useApp();
  const T = (x: T4) => tx(x, lang as Lang);
  const [rows, setRows] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [gh, setGh] = useState<Record<string, Gh | string>>({});
  const load = () => store.list("technical.systems").then((r) => setRows(r.filter((x) => x.status !== "Retired"))).catch(() => setRows([]));
  useEffect(() => { load(); }, [tick]); // eslint-disable-line
  // Repository facts for every GitHub system (public API; private repos need GITHUB_TOKEN in Vercel)
  useEffect(() => {
    if (DEMO || !rows) return;
    for (const r of rows.filter((x) => /github\.com\//i.test(x.data?.url || "")).slice(0, 4)) {
      if (gh[r.id]) continue;
      fetch("/api/systems", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "github", repo: r.data.url }) })
        .then(async (x) => (x.ok ? x.json() : x.text())).then((v) => setGh((g) => ({ ...g, [r.id]: v }))).catch(() => {});
    }
  }, [rows]); // eslint-disable-line
  if (!rows) return null;

  const check = async () => {
    if (DEMO) { toast(tx(L("Checks run on the live site.", "Проверка работает на живом сайте.", "Перевірка працює на живому сайті.", "يعمل الفحص على الموقع الحي."), lang as Lang)); return; }
    setBusy(true);
    try { const r = await fetch("/api/systems", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"check"}' }); if (!r.ok) throw new Error(await r.text()); const res = await r.json();
      setRows((rs) => (rs || []).map((x) => { const v = res.find((y: any) => y.id === x.id && !y.skipped); return v ? { ...x, status: v.status, data: { ...x.data, last_check: v.last_check, latency: v.ms } } : x; })); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const ok = rows.filter((r) => r.status === "Operational").length, bad = rows.filter((r) => ["Degraded", "Down"].includes(r.status || "")).length;
  const ago = (iso?: string) => { if (!iso) return ""; const d = Math.round((Date.now() - Date.parse(iso)) / 36e5); return d < 1 ? "<1 h" : d < 48 ? `${d} h` : `${Math.round(d / 24)} d`; };

  return (
    <section className={`card hub-card ${compact ? "wide" : ""} sys`}>
      <div className="card-h"><h2><Icon n="pulse" />{T(S.title)}</h2>
        <span className="faint" style={{ fontSize: 13.5 }}><b style={{ color: "var(--ok)" }}>{ok}</b> {T(S.ok)}{bad ? <> · <b style={{ color: "var(--bad)" }}>{bad}</b> {T(S.down)}</> : null}</span>
        <span className="toolbar" style={{ marginInlineStart: "auto" }}>
          <button className="btn sm" disabled={busy} onClick={check}><Icon n="refresh" />{busy ? "…" : T(S.check)}</button>
          {access.write.has("technical.systems") && <Link href="/technical/systems?new=1" className="btn ghost sm"><Icon n="plus" />{T(S.add)}</Link>}</span></div>
      {!compact && <p className="faint chan-p">{T(S.sub)}</p>}
      <div className="card-b sys-grid">
        {!rows.length && <div className="empty" style={{ gridColumn: "1/-1" }}>{T(S.none)}</div>}
        {rows.map((r) => { const g = gh[r.id]; return (
          <div key={r.id} className="sys-card">
            <div className="sys-top"><i className="sys-dot" style={{ background: DOT[r.status || "Unknown"] || DOT.Unknown }} title={r.status || ""} />
              <span style={{ minWidth: 0 }}><b>{r.title}</b><small>{[r.data?.type, r.data?.environment, r.data?.provider, r.data?.tier].filter(Boolean).join(" · ")}</small></span>
              <span className={`chip ${r.status === "Operational" ? "c-ok" : r.status === "Down" ? "c-bad" : r.status === "Degraded" ? "c-warn" : ""}`}>{r.status}</span></div>
            <div className="sys-meta faint">{r.data?.latency ? <span className="mono">{r.data.latency} ms</span> : null}{r.data?.last_check ? <span>{r.data.last_check}</span> : null}</div>
            {g && typeof g === "object" && <div className="sys-gh">
              {g.last_commit && <div><span className="faint">{T(S.commit)} · {ago(g.last_commit.date)}</span><span>{g.last_commit.message}</span></div>}
              {g.ci && <div><span className="faint">{T(S.ci)}</span><a href={g.ci.url} target="_blank" rel="noopener" className={`chip ${g.ci.conclusion === "success" ? "c-ok" : g.ci.conclusion === "failure" ? "c-bad" : "c-info"}`}>{g.ci.conclusion || g.ci.status}</a></div>}
              <div><span className="faint">{T(S.issues)}</span><span className="mono">{g.open_issues} / {g.open_prs}</span></div></div>}
            {typeof g === "string" && <small className="faint">{g}</small>}
            <div className="chan-act">
              {r.data?.url && <a className="btn sm" href={r.data.url} target="_blank" rel="noopener"><Icon n="ext" />{T(S.open)}</a>}
              {r.data?.console_url && <a className="btn ghost sm" href={r.data.console_url} target="_blank" rel="noopener"><Icon n="gear" />{T(S.console)}</a>}
              <Link className="btn ghost sm" href={`/technical/systems?r=${r.id}`} aria-label={r.title}><Icon n="edit" /></Link>
            </div>
          </div>); })}
      </div>
    </section>
  );
}
