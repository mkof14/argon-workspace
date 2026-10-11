"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { DESKS } from "@/config/legal";
import { l2 } from "@/config/learn";
import { t, tx } from "@/lib/i18n";
import { Rec, store } from "@/lib/store";
import catalog from "@/config/legal-catalog.json";
import { TEMPLATES } from "@/config/templates";

const RISKS = ["Prohibited", "Restricted", "High", "Medium", "Low"];
const RC: Record<string, string> = { Prohibited: "#B4232F", Restricted: "#E5484D", High: "#F59E0B", Medium: "#2F7DF6", Low: "#12A06B" };
const RULES = [
  { en: "AGRON Inc. is the U.S. project company", ru: "AGRON Inc. — проектная компания в США" },
  { en: "StarDome is the containerized system", ru: "StarDome — контейнерная система" },
  { en: "AGRON 1 is the monitoring and operator-assistance software", ru: "AGRON 1 — ПО мониторинга и помощи оператору" },
  { en: "Prefer U.S. manufacturers where feasible", ru: "По возможности — производители из США" },
  { en: "Final assembly in the US or the UAE", ru: "Финальная сборка в США или ОАЭ" },
  { en: "Pilot: passive detection, monitoring, lawful communications", ru: "Пилот: пассивное обнаружение, мониторинг, законная связь" },
  { en: "Active countermeasures need separate legal review", ru: "Активные средства противодействия — отдельная юр. проверка" },
  { en: "UAV flight authorization ≠ permission to intercept", ru: "Разрешение на полёт БПЛА ≠ разрешение на перехват" },
  { en: "Import authorization ≠ permission to install or operate", ru: "Разрешение на ввоз ≠ разрешение на установку и работу" },
  { en: "Nothing is cleared without model-specific review", ru: "Без проверки конкретной модели ничего не считается разрешённым" },
  { en: "Conclusions need current official sources", ru: "Выводы — только по действующим официальным источникам" },
  { en: "Unverified classifications stay Pending", ru: "Непроверенные классификации — Pending" },
  { en: "Always cover both US and UAE requirements", ru: "Всегда учитывать требования США и ОАЭ" },
  { en: "Maritime: vessel, flag-state and port review", ru: "Море: проверка судна, флага и порта" },
  { en: "Every substitution needs a new compliance review", ru: "Любая замена оборудования — новая проверка" },
];

export default function LegalHub() {
  const { lang, access, openAi, tick } = useApp();
  const [m, setM] = useState<Rec[]>([]);
  const [other, setOther] = useState<Rec[]>([]);
  useEffect(() => {
    if (access.read.has("legal.matrix")) store.list("legal.matrix").then(setM).catch(() => {});
    store.listMany(["legal.requests", "legal.obligations", "legal.licences", "legal.hse", "legal.desks", "legal.board", "legal.governance", "legal.authority", "legal.registers"].filter((s) => access.read.has(s))).then(setOther).catch(() => {});
  }, [access, tick]);

  const days = (d?: string) => (d ? Math.round((new Date(d).getTime() - Date.now()) / 864e5) : 999);
  const of = (s: string) => other.filter((r) => r.section === s);
  const kpis = [
    { l: t("k_restricted", lang), v: m.filter((r) => ["Restricted", "Prohibited"].includes(r.data?.risk)).length, c: "#E5484D", href: "/legal/matrix" },
    { l: t("k_pending", lang), v: m.filter((r) => r.status === "Pending review").length, c: "#F59E0B", href: "/legal/matrix" },
    { l: t("k_confirmed", lang), v: m.filter((r) => r.status === "Counsel approved").length, c: "#12A06B", href: "/legal/matrix" },
    { l: t("k_requests", lang), v: of("legal.requests").filter((r) => !["Answered", "Closed"].includes(r.status || "")).length, c: "#8B5CF6", href: "/legal/requests" },
    { l: t("k_obligations", lang), v: of("legal.obligations").filter((r) => r.status !== "Done" && r.status !== "Not applicable" && days(r.data?.due) <= 60).length, c: "#2F7DF6", href: "/legal/obligations" },
    { l: t("k_permits", lang), v: [...of("legal.licences"), ...of("legal.hse")].filter((r) => days(r.data?.expires) <= 90).length, c: "#0FA3A3", href: "/legal/licences" },
  ];
  const cats: { code: string; name: string }[] = (catalog as any).categories;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" }}>{kpis.map((k) => (
        <Link key={k.l} href={k.href} className="kpi" style={{ textDecoration: "none", color: "inherit", ["--dc" as any]: k.c }}><span className="stripe" /><div className="eyebrow" style={{ paddingInlineEnd: 0 }}>{k.l}</div><div className="v">{k.v}</div></Link>))}</section>

      {access.read.has("legal.board") && (() => {
        const today = new Date().toISOString().slice(0, 10);
        const next = of("legal.board").filter((r) => (r.data?.due || "") >= today && !["Minutes signed"].includes(r.status || "")).sort((a, b) => a.data.due.localeCompare(b.data.due))[0];
        const toSign = [...of("legal.governance").filter((r) => ["Draft", "Circulated"].includes(r.status || "")), ...of("legal.board").filter((r) => r.status === "Minutes drafted")];
        const poa = of("legal.authority").filter((r) => r.status !== "Revoked" && days(r.data?.expires) <= 60);
        const dirs = of("legal.registers").filter((r) => r.status === "Active" && r.data?.role === "Director");
        const tiles = [
          { l: t("next_board", lang), v: next ? next.data.due : "—", sub: next?.title, href: next ? `/legal/board?r=${next.id}` : "/legal/board" },
          { l: t("to_sign", lang), v: String(toSign.length), sub: toSign[0]?.title, href: "/legal/governance" },
          { l: t("poa_expiring", lang), v: String(poa.length), sub: poa[0]?.title, href: "/legal/authority" },
          { l: t("directors", lang), v: String(dirs.length), sub: dirs.map((d) => d.title).slice(0, 3).join(", "), href: "/legal/registers" },
        ];
        return <section className="card" style={{ ["--dc" as any]: "#5B6CF0" }}>
          <div className="card-h"><h2><Icon n="users" />{t("board_gov", lang)}</h2></div>
          <div className="card-b" style={{ display: "grid", gap: 14 }}>
            <div className="gov-tiles">{tiles.map((x) => <Link key={x.l} href={x.href} className="gov-tile"><span>{x.l}</span><b>{x.v}</b>{x.sub ? <small>{x.sub}</small> : null}</Link>)}</div>
            <div className="toolbar">{[["board_notice", "calendar"], ["board_minutes", "file"], ["written_consent", "stamp"], ["officer_appointment", "userplus"], ["stockholder_consent", "users"], ["poa", "key"], ["counsel_brief", "headset"], ["nda", "lock"], ["end_user", "flag"]].map(([id, ic]) => <Link key={id} href={`/templates?t=${id}`} className="btn ghost sm"><Icon n={ic} />{l2(TEMPLATES.find((x) => x.id === id)!.name, lang)}</Link>)}
              <Link href="/templates?dept=legal" className="btn sm"><Icon n="file" />{t("all_templates", lang)}</Link></div>
          </div>
        </section>;
      })()}

      <section><div className="lhead"><span className="ic" style={{ ["--dc" as any]: "#C9971C" }}><Icon n="spark" /></span><h2>{t("desks_title", lang)}</h2></div>
        <p className="faint" style={{ margin: "4px 0 12px", fontSize: 14.5 }}>{t("desks_sub", lang)}</p>
        <div className="desks">{DESKS.map((d) => (
          <div key={d.id} className="desk" style={{ ["--dc" as any]: d.color }}>
            <h3><span className="ic"><Icon n={d.icon} /></span>{l2(d.name, lang)}</h3>
            <p>{l2(d.scope, lang)}</p>
            <div className="chips">{d.laws.map((x) => <span key={x} className="chip">{x}</span>)}</div>
            <div className="chips">{d.authorities.map((x) => <span key={x} className="chip" style={{ color: d.color, borderColor: "transparent", background: `color-mix(in srgb,${d.color} 12%,var(--surface))` }}>{x}</span>)}</div>
            <div style={{ display: "grid", gap: 6 }}>{d.prompts.map((p, i) => <button key={i} className="ask" onClick={() => openAi({ title: l2(d.name, lang), section: "legal.desks", desk: d.id, ask: l2(p, lang) })}>{l2(p, lang)}</button>)}</div>
            <div className="toolbar">
              <button className="btn sm" style={{ background: d.color, borderColor: d.color, color: "#fff" }} onClick={() => openAi({ title: l2(d.name, lang), section: "legal.desks", desk: d.id })}><Icon n="spark" />{t("ask_desk", lang)}</button>
              {d.sections.filter((s) => access.read.has(s)).map((s) => { const sec = findSection(s); return sec ? <Link key={s} href={`/${s.replace(".", "/")}`} className="btn ghost sm"><Icon n={sec.icon} />{tx(sec.label, lang)}</Link> : null; })}
            </div>
          </div>))}</div>
      </section>

      {m.length > 0 && <section className="card" style={{ ["--dc" as any]: "#C9971C" }}>
        <div className="card-h"><h2><Icon n="grid" />{t("risk_map", lang)}</h2><span className="faint" style={{ fontSize: 13.5 }}>{m.length} · {t("risk_map_sub", lang)}</span></div>
        <div className="card-b tablewrap"><table className="riskmap"><thead><tr><th>{t("category", lang)}</th>{RISKS.map((r) => <th key={r} style={{ color: RC[r] }}>{r}</th>)}<th>{t("total", lang)}</th></tr></thead>
          <tbody>{cats.map((c) => { const rows = m.filter((r) => String(r.data?.category || "").startsWith(c.code + " ")); if (!rows.length) return null; return (
            <tr key={c.code}><td><Link href={`/legal/matrix?q=${encodeURIComponent(c.code + " " + c.name)}`} style={{ color: "inherit", fontWeight: 600 }}>{c.code} · {c.name}</Link></td>
              {RISKS.map((r) => { const n = rows.filter((x) => x.data?.risk === r).length; return <td key={r} style={{ background: n ? `color-mix(in srgb,${RC[r]} ${Math.min(14 + n * 4, 70)}%,var(--surface))` : "var(--surface-2)", color: n ? (n > 10 ? "#fff" : RC[r]) : "var(--ink-3)" }}>{n || "·"}</td>; })}
              <td className="faint">{rows.length}</td></tr>); })}</tbody></table></div>
      </section>}

      <section className="card" style={{ ["--dc" as any]: "#C9971C" }}>
        <div className="card-h"><h2><Icon n="clipboard" />{t("project_rules", lang)}</h2><span className="faint" style={{ fontSize: 13.5 }}>Master Equipment List · §24</span></div>
        <div className="card-b"><ol className="rules">{RULES.map((r, i) => <li key={i}>{l2(r, lang)}</li>)}</ol>
          <div className="banner" style={{ marginTop: 14 }}><Icon n="info" /><span>{t("legal_mandatory", lang)}</span></div></div>
      </section>
      <div className="eyebrow">{t("memos", lang)}</div>
    </div>
  );
}
