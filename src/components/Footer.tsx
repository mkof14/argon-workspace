"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { useInbox } from "./Inbox";
import { ROLES } from "@/config/workspace.config.mjs";
import { LANGS, Lang, t, tx } from "@/lib/i18n";

export const RECENT = "agronws.recent";
type Recent = { href: string; title: string; group: string };

/** Working footer: quick actions, my work, recent pages, departments, settings. */
export default function Footer({ depts, isAdmin, dark, onTheme, onLang, onSearch, onSignOut, version, hubs }: {
  depts: any[]; isAdmin: boolean; dark: boolean; onTheme: () => void; onLang: (l: Lang) => void; onSearch: (voice?: boolean) => void; onSignOut?: () => void; version: string; hubs: string[];
}) {
  const { lang, me, access, openMail, openAi, openIntake } = useApp();
  const inbox = useInbox();
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => { try { setRecent(JSON.parse(localStorage.getItem(RECENT) || "[]")); } catch {} }, [inbox.recs]);

  const quick = [
    ["company.tasks", "bell", t("new_reminder", lang)],
    ["sales.pipeline", "funnel", t("q_deal", lang)],
    ["finance.expenses", "receipt", t("q_expense", lang)],
    ["hr.leave", "sun", t("q_leave", lang)],
    ["legal.requests", "scale", t("q_legal", lang)],
    ["security.incidents", "alert", t("q_incident", lang)],
  ].filter(([s]) => access.write.has(s));
  const overdueMine = inbox.mine.filter((x) => x.d < 0).length;

  return (
    <footer className="foot">
      <div className="foot-quick">
        <b>{t("quick_actions", lang)}</b>
        {!["partner", "vendor", "investor"].includes(me.role) && <button className="btn primary sm" onClick={() => openIntake()}><Icon n="upload" />{t("intake_t", lang)}</button>}
        {quick.map(([s, i, l]) => { const sec = findSection(s); return <Link key={s} href={`/${sec.dept}/${sec.key}?new=1`} className="btn ghost sm"><Icon n={i} />{l}</Link>; })}
        <Link href="/reports" className="btn ghost sm"><Icon n="pie" />{t("get_report", lang)}</Link>
        <Link href="/templates" className="btn ghost sm"><Icon n="file" />{t("templates", lang)}</Link>
        {access.read.has("mail.templates") && <button className="btn ghost sm" onClick={() => openMail({})}><Icon n="mail" />{t("write_email", lang)}</button>}
        <button className="btn ghost sm" onClick={() => openAi({ title: t("ask_ai", lang) })}><Icon n="spark" />{t("ask_ai", lang)}</button>
      </div>
      <div className="foot-grid">
        <div className="foot-brand">
          <a href="https://www.agron1.com" target="_blank" rel="noopener" className="foot-logo" aria-label={t("main_site", lang)}>
            <img src="/logo-full.webp" alt="AGRON — Aerial-Ground Robotics Operations Network" width={640} height={187} loading="lazy" />
          </a>
          <p>{t("foot_about", lang)}</p>
          <a href="https://www.agron1.com" target="_blank" rel="noopener" className="btn sm foot-site"><Icon n="globe" />{t("main_site", lang)}<Icon n="ext" /></a>
        </div>
        <nav aria-label={t("my_work", lang)}><h3>{t("my_work", lang)}</h3>
          <Link href="/reports#attention" className="foot-stat"><span>{t("for_me", lang)}</span><b className={overdueMine ? "bad" : ""}>{inbox.mine.length}</b></Link>
          {["owner", "admin", "management"].includes(me.role) && <Link href="/reports#attention" className="foot-stat"><span>{t("overdue_company", lang)}</span><b className={inbox.company.length ? "bad" : ""}>{inbox.company.length}</b></Link>}
          <Link href="/company/tasks" className="foot-stat"><span>{t("mentions", lang)}</span><b>{inbox.mentions.length}</b></Link>
          <button className="linkish" onClick={() => onSearch()}><Icon n="search" /> {t("search_short", lang)} <kbd>⌘K</kbd></button>
          <button className="linkish" onClick={() => onSearch(true)}><Icon n="mic" /> {t("voice", lang)}</button>
        </nav>
        <nav aria-label={t("recent_pages", lang)}><h3>{t("recent_pages", lang)}</h3>
          {recent.length ? recent.slice(0, 7).map((r) => <Link key={r.href} href={r.href} title={r.group}>{r.title}<small>{r.group}</small></Link>) : <span className="faint">{t("recent_empty", lang)}</span>}
        </nav>
        <nav aria-label={t("departments", lang)}><h3>{t("departments", lang)}</h3>
          {depts.map((d: any) => <Link key={d.key} href={hubs.includes(d.key) ? `/${d.key}/overview` : `/${d.key}/${d.secs[0].key}`}>{tx(d.label, lang)}</Link>)}</nav>
        <nav aria-label={t("management", lang)}><h3>{t("management", lang)}</h3>
          {access.read.has("legal.board") && <Link href="/legal/board">{tx(findSection("legal.board")?.label, lang)}</Link>}
          {access.read.has("legal.governance") && <Link href="/legal/governance">{tx(findSection("legal.governance")?.label, lang)}</Link>}
          {access.read.has("company.decisions") && <Link href="/company/decisions">{tx(findSection("company.decisions")?.label, lang)}</Link>}
          <Link href="/reports">{t("reports", lang)}</Link>
          {isAdmin && <><Link href="/admin/users">{t("users", lang)}</Link><Link href="/admin/roles">{t("roles", lang)}</Link></>}
          <Link href="/learn">{t("learn", lang)}</Link></nav>
        <nav aria-label="AGRON Inc."><h3>AGRON Inc.</h3>
          <a href="https://www.agron1.com" target="_blank" rel="noopener">agron1.com</a>
          <a href="https://stardome.life" target="_blank" rel="noopener">stardome.life</a>
          <a href="mailto:info@agron1.com">info@agron1.com</a>
          <a href="mailto:info@agron1.com?subject=AGRON%20Workspace%20support">{t("support", lang)}</a></nav>
      </div>
      <div className="foot-bar">
        <Link href="/me" className="foot-me"><span className="avatar">{(me.full_name || me.email || "?").slice(0, 1).toUpperCase()}</span><span><b>{me.full_name || me.email}</b> · {tx((ROLES as any)[me.role]?.label, lang)}{me.us_person ? " · US person" : ""}</span></Link>
        <select className="input foot-sel" value={lang} onChange={(e) => onLang(e.target.value as Lang)} aria-label={t("language", lang)}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
        <button className="btn ghost sm" onClick={onTheme}><Icon n={dark ? "sun" : "moon"} />{dark ? t("theme_light", lang) : t("theme_dark", lang)}</button>
        {onSignOut && <button className="btn ghost sm" onClick={onSignOut}><Icon n="logout" />{t("sign_out", lang)}</button>}
        <span className="foot-right"><a href="https://www.agron1.com" target="_blank" rel="noopener">© 2026 AGRON Inc.</a> · {t("foot_conf", lang)} · <span className="mono">v{version}</span></span>
      </div>
    </footer>
  );
}
