"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx } from "@/lib/i18n";
import { Rec, store } from "@/lib/store";
import { DONE, dayDiff, DUE_KEYS } from "@/lib/insights";

/** StarDome configurations: everything about one container model on one screen — readiness by area, what blocks it, shared documents. */
const CONFIGS = ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ"] as const;
type Cfg = (typeof CONFIGS)[number];
const ABOUT: Record<Cfg, { en: string; ru: string; uk: string; ar: string; size: string }> = {
  "C20 Base": { size: "20′", en: "Two operators, compute, power and external sensors; reserve bay.", ru: "Два оператора, вычисления, питание, внешние сенсоры; резервный отсек.", uk: "Два оператори, обчислення, живлення, зовнішні сенсори; резервний відсік.", ar: "مشغّلان، حوسبة، طاقة ومستشعرات خارجية؛ حجرة احتياطية." },
  "C20 Enhanced": { size: "20′", en: "Base plus a scout UAV module (up to 6, design) and extended communications.", ru: "Base плюс модуль разведывательных UAV (до 6, проектно) и расширенная связь.", uk: "Base плюс модуль розвідувальних UAV (до 6, проєктно) і розширений зв'язок.", ar: "النسخة الأساسية مع وحدة طائرات استطلاع (حتى 6، تصميمًا) واتصالات موسّعة." },
  "C40 Base": { size: "40′ HC", en: "Separate server and operator zones, service corridor, reserve for modules.", ru: "Отдельные серверная и операторская, сервисный проход, резерв под модули.", uk: "Окремі серверна й операторська, сервісний прохід, резерв під модулі.", ar: "منطقتا خوادم وتشغيل منفصلتان، ممر خدمة، واحتياطي للوحدات." },
  "C40 Advanced": { size: "40′ HC", en: "Up to 12 UAV (design), extended sensors and engineering reserve.", ru: "До 12 UAV (проектно), расширенные сенсоры и инженерный резерв.", uk: "До 12 UAV (проєктно), розширені сенсори й інженерний резерв.", ar: "حتى 12 طائرة (تصميمًا)، مستشعرات موسّعة واحتياطي هندسي." },
  "C40 HQ": { size: "40′ HC", en: "Command centre with reinforced redundancy and a larger service area.", ru: "Командный центр, усиленное резервирование, увеличенная зона обслуживания.", uk: "Командний центр, посилене резервування, збільшена зона обслуговування.", ar: "مركز قيادة بتكرار معزّز ومنطقة خدمة أكبر." },
};
// Area → section, which statuses count as done, and whether the section has a config field
const AREAS: { id: string; sec: string; done: RegExp; icon: string; perConfig: boolean }[] = [
  { id: "equipment", sec: "technical.equipment", done: /^selected$/i, icon: "cpu", perConfig: true },
  { id: "bom", sec: "technical.bom", done: /^approved$/i, icon: "layers", perConfig: true },
  { id: "docs", sec: "technical.docs", done: /^released$/i, icon: "file", perConfig: true },
  { id: "integration", sec: "technical.integration", done: /^integrated$/i, icon: "plug", perConfig: false },
  { id: "testing", sec: "technical.testing", done: /^passed$/i, icon: "flask", perConfig: true },
  { id: "certification", sec: "technical.certification", done: /^approved$/i, icon: "badge", perConfig: false },
  { id: "changes", sec: "technical.changes", done: /^(implemented|rejected)$/i, icon: "git", perConfig: true },
  { id: "costing", sec: "finance.costing", done: /^approved$/i, icon: "calc", perConfig: true },
  { id: "builds", sec: "operations.builds", done: /^installed$/i, icon: "container", perConfig: true },
  { id: "fleet", sec: "operations.fleet", done: /^active$/i, icon: "anchor", perConfig: true },
];
const KEY = "agronws.stardome.cfg";
const href = (r: Rec) => `/${r.section.replace(".", "/")}?r=${r.id}`;

export default function StarDome() {
  const { lang, access, tick } = useApp();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [cfg, setCfg] = useState<Cfg>(() => { try { return (localStorage.getItem(KEY) as Cfg) || "C40 HQ"; } catch { return "C40 HQ"; } });
  const areas = AREAS.filter((a) => access.read.has(a.sec));
  useEffect(() => { store.listMany(areas.map((a) => a.sec)).then(setRecs).catch(() => setRecs([])); }, [tick]); // eslint-disable-line
  const pick = (c: Cfg) => { setCfg(c); try { localStorage.setItem(KEY, c); } catch {} };
  const L = (o: any) => o?.[lang] || o?.en;

  const view = useMemo(() => {
    if (!recs) return null;
    const of = (c: string) => (r: Rec) => String(r.data?.config || "") === c;
    const shared = (r: Rec) => !CONFIGS.includes(String(r.data?.config || "") as Cfg);
    const rows = areas.map((a) => {
      const all = recs.filter((r) => r.section === a.sec);
      const own = a.perConfig ? all.filter(of(cfg)) : [];
      const common = a.perConfig ? all.filter(shared) : all;
      const scope = [...own, ...common];
      const done = scope.filter((r) => a.done.test(r.status || "")).length;
      let extra = "";
      if (a.id === "bom") { const sum = own.reduce((s, r) => s + (Number(r.data?.qty) || 1) * (Number(r.data?.unit_cost) || 0), 0); if (sum) extra = `$${Math.round(sum).toLocaleString("en-US")}`; }
      if (a.id === "costing") { const c = own.find((r) => r.data?.price); if (c) extra = `$${Number(c.data.price).toLocaleString("en-US")}`; }
      return { a, own, common, scope, done };
    });
    const counts = Object.fromEntries(CONFIGS.map((c) => [c, recs.filter(of(c)).length]));
    // What blocks this configuration
    const scopeAll = rows.flatMap((x) => x.scope);
    const blockers: { r: Rec; why: string; tone: string }[] = [];
    for (const r of scopeAll) {
      const st = r.status || "";
      if (r.section === "technical.testing" && /failed|blocked/i.test(st)) blockers.push({ r, why: t("sd_b_test", lang), tone: "c-bad" });
      else if (r.section === "technical.certification" && /rejected/i.test(st)) blockers.push({ r, why: t("sd_b_cert", lang), tone: "c-bad" });
      else if (r.section === "technical.changes" && !DONE.test(st) && /high|critical/i.test(r.data?.priority || "")) blockers.push({ r, why: t("sd_b_change", lang), tone: "c-warn" });
      else if (r.section === "operations.builds" && r.data?.export_check === "Flagged") blockers.push({ r, why: t("sd_b_export", lang), tone: "c-bad" });
      if (!DONE.test(st)) for (const k of DUE_KEYS) { const v = r.data?.[k]; if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) && dayDiff(v) < 0) { blockers.push({ r, why: t("sd_b_late", lang).replace("{n}", String(-dayDiff(v))), tone: "c-bad" }); break; } }
    }
    const filled = rows.filter((x) => x.scope.length);
    const readiness = filled.length ? Math.round((filled.reduce((s, x) => s + x.done / x.scope.length, 0) / filled.length) * 100) : 0;
    const docs = recs.filter((r) => r.section === "technical.docs" || r.section === "technical.equipment").filter((r) => of(cfg)(r) || shared(r));
    return { rows, counts, blockers: blockers.slice(0, 12), readiness, docs };
  }, [recs, cfg, lang]); // eslint-disable-line

  const asks = [t("sd_q1", lang), t("sd_q2", lang), t("sd_q3", lang)].map((q) => q.replace("{c}", cfg));

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#FF6A2B" }}>
      <div className="sd-brand"><img src="/brand/stardome-logo.webp" alt="StarDome" width={1200} height={222} /><p>{t("sd_intro", lang)}</p></div>
      <nav className="sd-cfgs" aria-label={t("sd_title", lang)}>
        {CONFIGS.map((c) => <button key={c} className={`sd-cfg ${cfg === c ? "on" : ""}`} onClick={() => pick(c)} aria-pressed={cfg === c}>
          <b>{c}</b><span className="faint">{ABOUT[c].size}</span>{view && <span className="chip mono">{view.counts[c]}</span>}</button>)}
      </nav>

      <section className="card sd-hero">
        <div className="card-b sd-hero-b">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>StarDome {cfg}</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>{L(ABOUT[cfg])}</p>
            <div className="toolbar" style={{ marginTop: 12 }}>{asks.map((q) => <Link key={q} href={`/ask?q=${encodeURIComponent(q)}`} className="btn ghost sm"><Icon n="spark" />{q}</Link>)}</div>
          </div>
          <div className="sd-ready" aria-label={t("sd_ready", lang)}>
            <b className="mono">{view ? view.readiness : "…"}%</b><span className="faint">{t("sd_ready", lang)}</span>
            <span className="bar" style={{ width: 140 }}><span style={{ width: `${view?.readiness || 0}%` }} /></span>
          </div>
        </div>
      </section>

      {!view ? <div className="empty">…</div> : <>
        <section className="card">
          <div className="card-h"><h2><Icon n="pie" />{t("sd_areas", lang)}</h2></div>
          <div className="sd-areas">
            {view.rows.map(({ a, own, common, scope, done }) => { const s = findSection(a.sec); return (
              <div key={a.id} className="sd-area" style={{ ["--dc" as any]: s?.color }}>
                <div className="sd-area-h"><span className="dic"><Icon n={s?.icon || a.icon} /></span>
                  <Link href={`/${a.sec.replace(".", "/")}`}><b>{tx(s?.label, lang)}</b></Link>
                  <span className="mono faint" style={{ marginInlineStart: "auto" }}>{done}/{scope.length}</span></div>
                <span className="bar"><span style={{ width: `${scope.length ? (done / scope.length) * 100 : 0}%` }} /></span>
                {scope.length ? <ul className="sd-list">{scope.slice(0, 4).map((r) => <li key={r.id}><Link href={href(r)}>{r.title}</Link><span className={`chip ${a.done.test(r.status || "") ? "c-ok" : ""}`}>{r.status}</span></li>)}
                  {scope.length > 4 && <li className="faint">+{scope.length - 4}</li>}</ul>
                  : <p className="faint" style={{ margin: 0, fontSize: 13.5 }}>{t("sd_empty_area", lang)}</p>}
                {a.perConfig && common.length > 0 && <span className="faint" style={{ fontSize: 12.5 }}>{t("sd_shared_n", lang).replace("{n}", String(common.length)).replace("{o}", String(own.length))}</span>}
              </div>); })}
          </div>
        </section>

        <div className="sd-two">
          <section className="card">
            <div className="card-h"><h2><Icon n="alert" />{t("sd_blockers", lang)}</h2></div>
            {view.blockers.length ? <div className="feed">{view.blockers.map(({ r, why, tone }, i) => { const s = findSection(r.section); return (
              <Link key={r.id + i} href={href(r)} className="deadline" style={{ ["--dc" as any]: s?.color }}>
                <span className="dic"><Icon n={s?.icon || "alert"} /></span><span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{r.title}</b><br /><span className="faint" style={{ fontSize: 13 }}>{tx(s?.label, lang)}</span></span>
                <span className={`chip ${tone}`}>{why}</span></Link>); })}</div>
              : <div className="empty">{t("sd_no_blockers", lang)}</div>}
          </section>
          <section className="card">
            <div className="card-h"><h2><Icon n="file" />{t("sd_docs", lang)}</h2></div>
            {view.docs.length ? <div className="feed">{view.docs.slice(0, 12).map((r) => { const s = findSection(r.section); return (
              <Link key={r.id} href={href(r)} className="deadline" style={{ ["--dc" as any]: s?.color }}>
                <span className="dic"><Icon n={s?.icon || "file"} /></span><span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{r.title}</b><br /><span className="faint" style={{ fontSize: 13 }}>{tx(s?.label, lang)} · {String(r.data?.config || "") === cfg ? cfg : t("sd_all_cfgs", lang)}</span></span>
                <span className="chip">{r.status}</span></Link>); })}</div>
              : <div className="empty">{t("sd_no_docs", lang)}</div>}
          </section>
        </div>
      </>}
      <p className="faint" style={{ margin: 0, fontSize: 13.5 }}>{t("sd_how", lang)}</p>
    </div>
  );
}
