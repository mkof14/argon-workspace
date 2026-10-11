"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { DEPARTMENTS, DEPT_COLORS, ROLES, allSections } from "@/config/workspace.config.mjs";
import { LANGS, Lang, t, tx } from "@/lib/i18n";
import { DEMO, Profile, Rule, accessFor, isExternal, store, Access } from "@/lib/store";
import dynamic from "next/dynamic";
import Dashboard from "./Dashboard";
import SectionView from "./SectionView";
import type { AiContext } from "./AiPanel";
import type { MailInit } from "./Mail";
// Screens that are not needed on first paint load on demand
const Admin = dynamic(() => import("./Admin"), { ssr: false });
const Roles = dynamic(() => import("./Roles"), { ssr: false });
const MyProfile = dynamic(() => import("./MyProfile"), { ssr: false });
const Learn = dynamic(() => import("./Learn"), { ssr: false });
const AiPanel = dynamic(() => import("./AiPanel"), { ssr: false });
const ComposerModal = dynamic(() => import("./Mail").then((m) => m.ComposerModal), { ssr: false });
const Reports = dynamic(() => import("./Reports"), { ssr: false });
const Templates = dynamic(() => import("./Templates"), { ssr: false });
const Search = dynamic(() => import("./Search"), { ssr: false });
const Bell = dynamic(() => import("./Inbox").then((m) => m.Bell), { ssr: false });
export const VERSION = "0.7";

type Ctx = {
  lang: Lang; me: Profile; access: Access; toast: (m: string, err?: boolean) => void;
  openAi: (c: AiContext) => void; reload: () => void; tick: number;
  openMail: (m: MailInit) => void; people: Profile[]; rules: Rule[] | null; setRules: (r: Rule[]) => void;
};
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export const SECTIONS: any[] = allSections() as any[];
export const findSection = (id: string) => SECTIONS.find((s) => s.id === id);

export default function App({ slug }: { slug: string[] }) {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>("en");
  const [dark, setDark] = useState(false);
  const [me, setMe] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; m: string; err?: boolean }[]>([]);
  const [railOpen, setRailOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const [ai, setAi] = useState<AiContext | null>(null);
  const [tick, setTick] = useState(0);
  const [mail, setMail] = useState<MailInit | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const navStack = useRef<string[]>([]);
  const [search, setSearch] = useState<null | { voice?: boolean }>(null);
  useEffect(() => { // Ctrl/⌘+K or "/" opens search anywhere
    const k = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSearch({}); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setSearch({}); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  const route = slug.join("/");
  const sectionId = slug.length === 2 ? `${slug[0]}.${slug[1]}` : "";
  const section = sectionId ? findSection(sectionId) : null;

  // language & theme
  useEffect(() => {
    try { const l = localStorage.getItem("agronws.lang") as Lang; if (l) setLangState(l); } catch {}
    const isDark = () => { const a = document.documentElement.getAttribute("data-theme"); return a ? a === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
    setDark(isDark());
    const mq = matchMedia("(prefers-color-scheme: dark)"); const fn = () => setDark(isDark()); mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  const setLang = (l: Lang) => { setLangState(l); setLangOpen(false); try { localStorage.setItem("agronws.lang", l); } catch {} document.documentElement.lang = l; document.documentElement.dir = l === "ar" ? "rtl" : "ltr"; };
  const toggleTheme = () => { const next = dark ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem("agronws.theme", next); } catch {} setDark(!dark); };

  const reload = useCallback(async () => {
    const p = await store.me();
    if (p && p.role !== "pending") { try { setRules(await store.rules()); } catch {} }
    setMe(p); setLoaded(true); setTick((x) => x + 1);
    if (!p && !DEMO) router.replace("/login");
    if (p && !isExternal(p.role)) store.profiles().then(setPeople).catch(() => {});
    if (p && ["owner", "admin", "management", "legal"].includes(p.role)) store.faqList().catch(() => {}); // loads the starter FAQ once
  }, [router]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { const st = navStack.current; if (st.length > 1 && st[st.length - 2] === route) st.pop(); else if (st[st.length - 1] !== route) st.push(route); }, [route]);
  useEffect(() => { if (section) setOpenDepts((o) => ({ ...o, [section.dept]: true })); setRailOpen(false); }, [route]); // eslint-disable-line

  const toast = useCallback((m: string, err?: boolean) => {
    const id = Date.now() + Math.random(); setToasts((x) => [...x, { id, m, err }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), err ? 5200 : 3200);
  }, []);
  const access = useMemo(() => accessFor(me?.role || "pending", rules), [me?.role, rules]);

  if (!loaded || !me) return <div className="login"><div className="faint">…</div></div>;

  if (me.role === "pending") return (
    <div className="login"><div className="box"><div className="brand"><img src="/logo-full.webp" alt="AGRON" /></div>
      <h2 style={{ margin: 0 }}>{t("pending_t", lang)}</h2><p className="muted" style={{ margin: 0 }}>{t("pending_p", lang)}</p>
      <button className="btn" onClick={async () => { await store.signOut(); router.replace("/login"); }}><Icon n="logout" />{t("sign_out", lang)}</button></div></div>
  );

  const depts = DEPARTMENTS.map((d: any) => ({ ...d, secs: SECTIONS.filter((s) => s.dept === d.key && access.read.has(s.id)) })).filter((d: any) => d.secs.length);
  const isAdmin = me.role === "owner" || me.role === "admin";
  const dept = section ? DEPARTMENTS.find((d: any) => d.key === section.dept) : null;
  const special: Record<string, [string, string]> = { "admin/users": [t("admin", lang), t("users", lang)], "admin/roles": [t("admin", lang), t("roles", lang)], me: [t("workspace", lang), t("my_profile", lang)], learn: [t("workspace", lang), t("learn", lang)], reports: [t("workspace", lang), t("reports", lang)], templates: [t("workspace", lang), t("templates", lang)] };
  const crumbGroup = section ? tx(dept.label, lang) : special[route]?.[0] || t("workspace", lang);
  const crumbTitle = section ? tx(section.label, lang) : special[route]?.[1] || t("overview", lang);
  const curLang = LANGS.find((l) => l.code === lang)!;
  if (typeof document !== "undefined") document.title = `${crumbTitle} · AGRON Workspace`;
  const goBack = () => { if (navStack.current.length > 1) router.back(); else router.push("/"); };

  let body: React.ReactNode;
  if (!route) body = <Dashboard depts={depts} />;
  else if ((route === "admin/users" || route === "admin/roles") && isAdmin) body = <>
      <nav className="dtabs" style={{ ["--dc" as any]: "#5B6CF0" }}>
        <Link href="/admin/users" className={route === "admin/users" ? "on" : ""}><Icon n="users" />{t("users", lang)}</Link>
        <Link href="/admin/roles" className={route === "admin/roles" ? "on" : ""}><Icon n="key" />{t("roles", lang)}</Link>
      </nav>
      {route === "admin/users" ? <Admin /> : <Roles />}
    </>;
  else if (route.startsWith("admin/")) body = <div className="empty">{t("no_access", lang)}</div>;
  else if (route === "me") body = <MyProfile />;
  else if (route === "learn") body = <Learn />;
  else if (route === "reports") body = <Reports />;
  else if (route === "templates") body = <Templates />;
  else if (section && access.read.has(section.id)) {
    const secs = SECTIONS.filter((x) => x.dept === section.dept && access.read.has(x.id));
    body = <>
      {secs.length > 1 && <nav className="dtabs" aria-label={tx(dept.label, lang)} style={{ ["--dc" as any]: section.color }}>
        {secs.map((x) => <Link key={x.id} href={`/${x.dept}/${x.key}`} className={x.id === section.id ? "on" : ""} aria-current={x.id === section.id ? "page" : undefined}><Icon n={x.icon} />{tx(x.label, lang)}</Link>)}
      </nav>}
      <SectionView key={section.id} section={section} />
    </>;
  }
  else body = <div className="card empty">{t("no_access", lang)}</div>;

  return (
    <AppCtx.Provider value={{ lang, me, access, toast, openAi: setAi, reload, tick, openMail: setMail, people, rules, setRules }}>
      <div className="app" onClick={(e) => { if (langOpen && !(e.target as HTMLElement).closest(".dd")) setLangOpen(false); }}>
        <aside className={`rail ${railOpen ? "open" : ""}`} aria-label={t("menu", lang)}>
          <div className="rail-brand"><img src="/logo-full.webp" alt="AGRON — Aerial-Ground Robotics Operations Network" width={640} height={187} />
            <div className="prod"><i />{t("workspace", lang)}</div></div>
          <nav>
            <Link href="/" className={`nav-item top ${!route ? "active" : ""}`} style={{ ["--dc" as any]: "#FF6A2B" }}><Icon n="stardome" /><span>{t("overview", lang)}</span></Link>
            <Link href="/reports" className={`nav-item top ${route === "reports" ? "active" : ""}`} style={{ ["--dc" as any]: "#E5484D" }}><Icon n="pie" /><span>{t("reports", lang)}</span></Link>
            <Link href="/templates" className={`nav-item top ${route === "templates" ? "active" : ""}`} style={{ ["--dc" as any]: "#C9971C" }}><Icon n="file" /><span>{t("templates", lang)}</span></Link>
            {access.read.has("company.tasks") && <Link href="/company/tasks" className={`nav-item top ${route === "company/tasks" ? "active" : ""}`} style={{ ["--dc" as any]: "#5B6CF0" }}><Icon n="bell" /><span>{tx(findSection("company.tasks")?.label, lang)}</span></Link>}
            <Link href="/learn" className={`nav-item top ${route === "learn" ? "active" : ""}`} style={{ ["--dc" as any]: "#14B8A6" }}><Icon n="lifebuoy" /><span>{t("learn", lang)}</span></Link>
            <div className="nav-label">{t("departments", lang)}</div>
            {depts.map((d: any) => {
              const open = !!openDepts[d.key];
              return (
                <div key={d.key} className={`nav-dept ${open ? "open" : ""}`} style={{ ["--dc" as any]: (DEPT_COLORS as any)[d.key] }}>
                  <button className="nav-item" aria-expanded={open} onClick={() => setOpenDepts((o) => ({ ...o, [d.key]: !open }))}>
                    <Icon n={d.icon} /><span>{tx(d.label, lang)}</span><Icon n="chev" className="chev" />
                  </button>
                  {open && <div className="nav-sub">{d.secs.map((s: any) => (
                    <Link key={s.id} href={`/${d.key}/${s.key}`} className={`nav-item ${sectionId === s.id ? "active" : ""}`}><Icon n={s.icon} /><span>{tx(s.label, lang)}</span></Link>
                  ))}</div>}
                </div>
              );
            })}
            {isAdmin && <><div className="nav-label">{t("admin", lang)}</div>
              <Link href="/admin/users" className={`nav-item top ${route === "admin/users" ? "active" : ""}`} style={{ ["--dc" as any]: "#94A3B8" }}><Icon n="users" /><span>{t("users", lang)}</span></Link>
              <Link href="/admin/roles" className={`nav-item top ${route === "admin/roles" ? "active" : ""}`} style={{ ["--dc" as any]: "#94A3B8" }}><Icon n="key" /><span>{t("roles", lang)}</span></Link></>}
          </nav>
          <div className="rail-foot">
            <Link href="/me" className="me" style={{ textDecoration: "none", color: "inherit" }}><span className="avatar">{(me.full_name || me.email || "?").slice(0, 1).toUpperCase()}</span>
              <div style={{ minWidth: 0 }}><b>{me.full_name}</b>{tx((ROLES as any)[me.role]?.label, lang)}{me.company ? ` · ${me.company}` : ""}</div></Link>
            {DEMO ? (
              <label className="field" style={{ color: "var(--rail-dim)" }}><span style={{ fontSize: 11 }}>{t("demo", lang)} · {t("view_as", lang)}</span>
                <select className="input" style={{ background: "var(--rail-2)", borderColor: "var(--rail-line)", color: "var(--rail-ink)", padding: "5px 8px" }} value={me.role}
                  onChange={(e) => { store.setDemoRole(e.target.value); reload(); }}>
                  {["owner", "engineering", "operations", "finance", "sales", "partner", "vendor"].map((r) => <option key={r} value={r}>{tx((ROLES as any)[r].label, lang)}</option>)}
                </select></label>
            ) : (
              <button className="btn ghost sm" style={{ color: "var(--rail-dim)", justifyContent: "flex-start" }} onClick={async () => { await store.signOut(); router.replace("/login"); }}><Icon n="logout" />{t("sign_out", lang)}</button>
            )}
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="iconbtn burger" aria-label={t("menu", lang)} onClick={() => setRailOpen(!railOpen)}><Icon n="menu" /></button>
            {route && <button className="iconbtn backbtn" title={t("back", lang)} aria-label={t("back", lang)} onClick={goBack}><Icon n="back" /></button>}
            <div className="crumb"><small>{crumbGroup}</small><h1>{crumbTitle}</h1></div>
            <div className="tb-right">
              <button className="searchbtn" onClick={() => setSearch({})} aria-label={t("search_all", lang)}><Icon n="search" /><span>{t("search_short", lang)}</span><kbd>⌘K</kbd></button>
              <button className="iconbtn" onClick={() => setSearch({ voice: true })} title={t("voice", lang)} aria-label={t("voice", lang)}><Icon n="mic" /></button>
              <Bell />
              <button className="btn sm" onClick={() => setAi({ title: crumbTitle, section: sectionId })}><Icon n="spark" />{t("ask_ai", lang)}</button>
              <div className="dd">
                <button className="dd-btn" aria-haspopup="menu" aria-expanded={langOpen} aria-label={t("language", lang)} onClick={() => setLangOpen(!langOpen)}>
                  <Icon n="globe" /><span>{curLang.short}</span><Icon n="down" />
                </button>
                {langOpen && <div className="dd-menu" role="menu">{LANGS.map((l) => (
                  <button key={l.code} role="menuitemradio" aria-checked={l.code === lang} className={l.code === lang ? "on" : ""} lang={l.code} onClick={() => setLang(l.code)}>
                    <span className="code">{l.short}</span>{l.name}</button>))}</div>}
              </div>
              <button className="iconbtn" onClick={toggleTheme} title={dark ? t("theme_light", lang) : t("theme_dark", lang)} aria-label={dark ? t("theme_light", lang) : t("theme_dark", lang)}><Icon n={dark ? "sun" : "moon"} /></button>
            </div>
          </header>
          <div className="content">
            <main className="page">
              {DEMO && <div className="banner"><Icon n="info" /><span>{t("demo_banner", lang)}</span>
                <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => { store.resetDemo(); reload(); }}>Reset</button></div>}
              {body}
            </main>
            <footer className="foot">
              <div className="foot-grid">
                <div className="foot-brand">
                  <img src="/logo-full.webp" alt="AGRON" width={640} height={187} />
                  <p>{t("foot_about", lang)}</p>
                  <div className="foot-me"><span className="avatar">{(me.full_name || me.email || "?").slice(0, 1).toUpperCase()}</span><span><b>{me.full_name || me.email}</b><br /><small>{tx((ROLES as any)[me.role]?.label, lang)}{me.us_person ? " · US person" : ""}</small></span></div>
                  <div className="toolbar">
                    <button className="btn ghost sm" onClick={() => setSearch({})}><Icon n="search" />{t("search_short", lang)}</button>
                    <button className="btn ghost sm" onClick={() => setSearch({ voice: true })}><Icon n="mic" />{t("voice", lang)}</button>
                    <button className="btn ghost sm" onClick={toggleTheme}><Icon n={dark ? "sun" : "moon"} />{dark ? t("theme_light", lang) : t("theme_dark", lang)}</button>
                  </div>
                </div>
                <nav aria-label={t("workspace", lang)}><h3>{t("workspace", lang)}</h3>
                  <Link href="/">{t("overview", lang)}</Link><Link href="/reports">{t("reports", lang)}</Link><Link href="/templates">{t("templates", lang)}</Link>
                  {access.read.has("company.tasks") && <Link href="/company/tasks">{tx(findSection("company.tasks")?.label, lang)}</Link>}
                  {access.read.has("mail.templates") && <button className="linkish" onClick={() => setMail({})}>{t("write_email", lang)}</button>}
                  <button className="linkish" onClick={() => setAi({ title: crumbTitle, section: sectionId })}>{t("ask_ai", lang)}</button>
                  <Link href="/learn">{t("learn", lang)}</Link></nav>
                <nav aria-label={t("departments", lang)}><h3>{t("departments", lang)}</h3>
                  {depts.map((d: any) => <Link key={d.key} href={`/${d.key}/${d.secs[0].key}`}>{tx(d.label, lang)}</Link>)}</nav>
                <nav aria-label={t("management", lang)}><h3>{t("management", lang)}</h3>
                  {access.read.has("legal.board") && <Link href="/legal/board">{tx(findSection("legal.board")?.label, lang)}</Link>}
                  {access.read.has("legal.governance") && <Link href="/legal/governance">{tx(findSection("legal.governance")?.label, lang)}</Link>}
                  {access.read.has("company.decisions") && <Link href="/company/decisions">{tx(findSection("company.decisions")?.label, lang)}</Link>}
                  {isAdmin && <><Link href="/admin/users">{t("users", lang)}</Link><Link href="/admin/roles">{t("roles", lang)}</Link></>}
                  <Link href="/me">{t("my_profile", lang)}</Link>
                  {!DEMO && <button className="linkish" onClick={async () => { await store.signOut(); router.replace("/login"); }}>{t("sign_out", lang)}</button>}</nav>
                <nav aria-label="AGRON Inc."><h3>AGRON Inc.</h3>
                  <a href="https://www.agron1.com" target="_blank" rel="noopener">agron1.com</a>
                  <a href="https://stardome.life" target="_blank" rel="noopener">stardome.life</a>
                  <a href="mailto:info@agron1.com">info@agron1.com</a>
                  <a href="mailto:info@agron1.com?subject=AGRON%20Workspace%20support">{t("support", lang)}</a></nav>
              </div>
              <div className="foot-bar">
                <span>© 2026 AGRON Inc.</span><span>{t("foot_tm", lang)}</span><span>{t("foot_conf", lang)}</span>
                <span className="foot-keys"><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> {t("search_short", lang)} · <kbd>/</kbd></span><span className="mono">v{VERSION}</span>
              </div>
            </footer>
          </div>
        </div>
      </div>
      {ai && <AiPanel ctx={ai} onClose={() => setAi(null)} />}
      {mail && <ComposerModal init={mail} onClose={() => setMail(null)} />}
      {search && <Search voice={search.voice} onClose={() => setSearch(null)} />}
      <div className="toasts" aria-live="polite">{toasts.map((x) => <div key={x.id} className={`toast ${x.err ? "err" : ""}`}>{x.m}</div>)}</div>
    </AppCtx.Provider>
  );
}
