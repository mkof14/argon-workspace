"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { DEPARTMENTS, DEPT_COLORS, ROLES, allSections } from "@/config/workspace.config.mjs";
import { LANGS, Lang, t, tx } from "@/lib/i18n";
import { DEMO, Profile, Rule, accessFor, isExternal, store, Access } from "@/lib/store";
import Dashboard from "./Dashboard";
import SectionView from "./SectionView";
import Admin from "./Admin";
import Roles from "./Roles";
import MyProfile from "./MyProfile";
import Learn from "./Learn";
import { ComposerModal, MailInit } from "./Mail";
import AiPanel, { AiContext } from "./AiPanel";

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
  const special: Record<string, [string, string]> = { "admin/users": [t("admin", lang), t("users", lang)], "admin/roles": [t("admin", lang), t("roles", lang)], me: [t("workspace", lang), t("my_profile", lang)], learn: [t("workspace", lang), t("learn", lang)] };
  const crumbGroup = section ? tx(dept.label, lang) : special[route]?.[0] || t("workspace", lang);
  const crumbTitle = section ? tx(section.label, lang) : special[route]?.[1] || t("overview", lang);
  const curLang = LANGS.find((l) => l.code === lang)!;
  const goBack = () => { if (navStack.current.length > 1) router.back(); else router.push("/"); };

  let body: React.ReactNode;
  if (!route) body = <Dashboard depts={depts} />;
  else if (route === "admin/users") body = isAdmin ? <Admin /> : <div className="empty">{t("no_access", lang)}</div>;
  else if (route === "admin/roles") body = isAdmin ? <Roles /> : <div className="empty">{t("no_access", lang)}</div>;
  else if (route === "me") body = <MyProfile />;
  else if (route === "learn") body = <Learn />;
  else if (section && access.read.has(section.id)) body = <SectionView key={section.id} section={section} />;
  else body = <div className="card empty">{t("no_access", lang)}</div>;

  return (
    <AppCtx.Provider value={{ lang, me, access, toast, openAi: setAi, reload, tick, openMail: setMail, people, rules, setRules }}>
      <div className="app" onClick={(e) => { if (langOpen && !(e.target as HTMLElement).closest(".dd")) setLangOpen(false); }}>
        <aside className={`rail ${railOpen ? "open" : ""}`} aria-label={t("menu", lang)}>
          <div className="rail-brand"><img src="/logo-full.webp" alt="AGRON — Aerial-Ground Robotics Operations Network" width={640} height={187} />
            <div className="prod"><i />{t("workspace", lang)}</div></div>
          <nav>
            <Link href="/" className={`nav-item top ${!route ? "active" : ""}`} style={{ ["--dc" as any]: "#FF6A2B" }}><Icon n="home" /><span>{t("overview", lang)}</span></Link>
            <Link href="/learn" className={`nav-item top ${route === "learn" ? "active" : ""}`} style={{ ["--dc" as any]: "#14B8A6" }}><Icon n="grad" /><span>{t("learn", lang)}</span></Link>
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
            <footer className="footer"><b>© 2026 AGRON Inc.</b><span>{t("foot_conf", lang)}</span><span>AGRON™ · StarDome™ · StarWall™ · AGRON 1™</span><a href="https://www.agron1.com" target="_blank" rel="noopener">agron1.com</a></footer>
          </div>
        </div>
      </div>
      {ai && <AiPanel ctx={ai} onClose={() => setAi(null)} />}
      {mail && <ComposerModal init={mail} onClose={() => setMail(null)} />}
      <div className="toasts" aria-live="polite">{toasts.map((x) => <div key={x.id} className={`toast ${x.err ? "err" : ""}`}>{x.m}</div>)}</div>
    </AppCtx.Provider>
  );
}
