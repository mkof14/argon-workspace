"use client";
import { APP_VERSION } from "@/lib/version";
import { APP_ENV, RELEASE_SHA, envBanner } from "@/lib/env";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { DEPARTMENTS, DEPT_COLORS, ROLES, allSections } from "@/config/workspace.config.mjs";
import { LANGS, Lang, loadUiLang, t, tx } from "@/lib/i18n";
import { installErrorReporting } from "@/lib/errors";
import { loadLearnLang } from "@/config/l2";
import { DEMO, Profile, Rule, accessFor, isExternal, store, Access } from "@/lib/store";
import dynamic from "next/dynamic";
import Dashboard from "./Dashboard";
import { MfaGate } from "./MfaSetup";
import { ProfileMenu, UnreadDot } from "./NavBits";
import SectionView from "./SectionView";
import type { AiContext } from "./AiPanel";
import type { MailInit } from "./Mail";
// Screens that are not needed on first paint load on demand
const Admin = dynamic(() => import("./Admin"), { ssr: false });
const Roles = dynamic(() => import("./Roles"), { ssr: false });
const System = dynamic(() => import("./System"), { ssr: false });
const MyProfile = dynamic(() => import("./MyProfile"), { ssr: false });
const Learn = dynamic(() => import("./Learn"), { ssr: false });
const Trash = dynamic(() => import("./Trash"), { ssr: false });
const AiPanel = dynamic(() => import("./AiPanel"), { ssr: false });
const ComposerModal = dynamic(() => import("./Mail").then((m) => m.ComposerModal), { ssr: false });
const Reports = dynamic(() => import("./Reports"), { ssr: false });
const Templates = dynamic(() => import("./Templates"), { ssr: false });
const DeptHub = dynamic(() => import("./DeptHub"), { ssr: false });
const Today = dynamic(() => import("./Today"), { ssr: false });
const Search = dynamic(() => import("./Search"), { ssr: false });
const Footer = dynamic(() => import("./Footer"), { ssr: false });
const Bell = dynamic(() => import("./Notices").then((m) => m.Bell), { ssr: false });
const Intake = dynamic(() => import("./Intake"), { ssr: false });
const DocsAsk = dynamic(() => import("./DocsAsk"), { ssr: false });
const StarDome = dynamic(() => import("./StarDome"), { ssr: false });
const Projects = dynamic(() => import("./Projects"), { ssr: false });
const Decisions = dynamic(() => import("./Decisions"), { ssr: false });
const Processes = dynamic(() => import("./Processes"), { ssr: false });
const Commercial = dynamic(() => import("./Commercial"), { ssr: false });
const Manufacturing = dynamic(() => import("./Manufacturing"), { ssr: false });
const ShopFloor = dynamic(() => import("./ShopFloor"), { ssr: false });
const PhotoCapture = dynamic(() => import("./PhotoCapture"), { ssr: false });
const OfflineBar = dynamic(() => import("./OfflineBar"), { ssr: false });
const Guide = dynamic(() => import("./Guide"), { ssr: false });
const Messages = dynamic(() => import("./Messages"), { ssr: false });
const Documents = dynamic(() => import("./Documents"), { ssr: false });
const InfoSettings = dynamic(() => import("./InfoSettings"), { ssr: false });
const Knowledge = dynamic(() => import("./Knowledge"), { ssr: false });
const DecisionLog = dynamic(() => import("./DecisionLog"), { ssr: false });
const CalendarPage = dynamic(() => import("./CalendarPage"), { ssr: false });
const Assistant = dynamic(() => import("./Assistant"), { ssr: false });
const People = dynamic(() => import("./People"), { ssr: false });
const ProjectHome = dynamic(() => import("./ProjectHome"), { ssr: false });
const Management = dynamic(() => import("./Management"), { ssr: false });
const Portfolio = dynamic(() => import("./Portfolio"), { ssr: false });
const ExecControl = dynamic(() => import("./ExecControl"), { ssr: false });
const TeamStatus = dynamic(() => import("./TeamStatus"), { ssr: false });
const Notices = dynamic(() => import("./Notices"), { ssr: false });
const QuickCreate = dynamic(() => import("./QuickCreate"), { ssr: false });
export const VERSION = APP_VERSION;
/** Roles that see the management dashboard (also checked on the server for the export). */
export const MANAGERS = ["owner", "admin", "management"];

type Ctx = {
  lang: Lang; me: Profile; access: Access; toast: (m: string, err?: boolean) => void;
  openAi: (c: AiContext) => void; reload: () => void; tick: number;
  openMail: (m: MailInit) => void; people: Profile[]; rules: Rule[] | null; setRules: (r: Rule[]) => void;
  openIntake: (files?: File[]) => void;
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
  const navRef = useRef<HTMLElement>(null);
  const [focusDept, setFocusDept] = useState<{ k: string; n: number }>({ k: "", n: 0 });
  // Opening a department brings it to the top of the menu so its sections are in view
  useEffect(() => {
    if (!focusDept.k) return;
    const id = requestAnimationFrame(() => {
      const nav = navRef.current; const el = nav?.querySelector<HTMLElement>(`[data-dept="${focusDept.k}"]`); if (!nav || !el) return;
      const head = nav.querySelector<HTMLElement>(".nav-depts")?.offsetHeight || 0; // the sticky "Departments" heading stays above it
      const top = nav.scrollTop + el.getBoundingClientRect().top - nav.getBoundingClientRect().top - head - 6;
      nav.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [focusDept]);
  const [ai, setAi] = useState<AiContext | null>(null);
  const [tick, setTick] = useState(0);
  // Ukrainian and Arabic help texts arrive separately; redraw once they are here
  const [, setTexts] = useState(0);
  useEffect(() => { loadLearnLang(lang).then((loaded) => { if (loaded) setTexts((n) => n + 1); }).catch(() => {}); }, [lang]);
  const [mail, setMail] = useState<MailInit | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [sec, setSec] = useState<Awaited<ReturnType<typeof store.security>> | null>(null);
  const navStack = useRef<string[]>([]);
  const [search, setSearch] = useState<null | { voice?: boolean }>(null);
  const [intake, setIntake] = useState<null | { files?: File[] }>(null);
  const [photo, setPhoto] = useState(false);
  const [dragFiles, setDragFiles] = useState(false);
  useEffect(() => { // Ctrl/⌘+K or "/" opens search anywhere
    const k = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSearch({}); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setSearch({}); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  const route = slug.join("/");
  const HUBS = ["technical", "operations", "finance", "sales", "marketing", "security", "legal", "hr", "company"];
  const hubDept = slug.length === 2 && slug[1] === "overview" && HUBS.includes(slug[0]) ? slug[0] : "";
  const sectionId = slug.length === 2 && !hubDept && slug[0] !== "projects" ? `${slug[0]}.${slug[1]}` : "";
  const section = sectionId ? findSection(sectionId) : null;

  // language & theme
  useEffect(() => {
    try { const l = localStorage.getItem("agronws.lang") as Lang; if (l) { setLangState(l); store.setLang(l); } } catch {}
    const isDark = () => { const a = document.documentElement.getAttribute("data-theme"); return a ? a === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
    setDark(isDark());
    const mq = matchMedia("(prefers-color-scheme: dark)"); const fn = () => setDark(isDark()); mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  const setLang = async (l: Lang) => {
    await loadUiLang(l).catch(() => {});
    setLangState(l); setLangOpen(false); store.setLang(l); setTick((x) => x + 1); // records are shown again in the new language
    if (me && me.lang !== l && !DEMO) store.updateProfile(me.id, { lang: l }).then(() => setMe({ ...me, lang: l })).catch(() => {}); // e-mails follow the same language
    try { localStorage.setItem("agronws.lang", l); } catch {} document.documentElement.lang = l; document.documentElement.dir = l === "ar" ? "rtl" : "ltr"; };
  const toggleTheme = () => { const next = dark ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem("agronws.theme", next); } catch {} setDark(!dark); };

  const reload = useCallback(async () => {
    const p = await store.me();
    if (p && p.role !== "pending") { try { setRules(await store.rules()); } catch {} }
    // A new device: take the language from the profile
    try { if (p?.lang && !localStorage.getItem("agronws.lang") && ["en", "ru", "uk", "ar"].includes(p.lang)) { await loadUiLang(p.lang).catch(() => {}); setLangState(p.lang as Lang); store.setLang(p.lang); localStorage.setItem("agronws.lang", p.lang); document.documentElement.lang = p.lang; document.documentElement.dir = p.lang === "ar" ? "rtl" : "ltr"; } } catch {}
    try { const l = localStorage.getItem("agronws.lang"); if (p && l && p.lang !== l && !DEMO) { store.updateProfile(p.id, { lang: l }).catch(() => {}); p.lang = l; } } catch {}
    // First visit: remember the person's time zone (digest at 8:00 local, local time for colleagues)
    try { if (p && !p.timezone && !DEMO) { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (z) { store.updateProfile(p.id, { timezone: z }).catch(() => {}); p.timezone = z; } } } catch {}
    // Session facts: second factor, ended sessions (owners/administrators need the code once it is required)
    if (p && !DEMO) { const s0 = await store.security().catch(() => null); setSec(s0);
      if (s0 && (p as any).sessions_revoked_at && s0.iat && s0.iat <= Math.floor(Date.parse((p as any).sessions_revoked_at) / 1000)) { await store.signOut(); router.replace("/login?ended=1"); return; } }
    setMe(p); setLoaded(true); setTick((x) => x + 1);
    if (!p && !DEMO) router.replace("/login");
    if (p && !isExternal(p.role)) store.profiles().then((l) => { store.setPeople(l); setPeople(l); }).catch(() => {});
    if (p && ["owner", "admin", "management", "legal"].includes(p.role)) setTimeout(() => store.faqList().catch(() => {}), 8000); // tops up the starter FAQ after the page is ready
  }, [router]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { installErrorReporting(); if ("serviceWorker" in navigator && !DEMO) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  // Opened from the phone's share sheet (files kept by the service worker) or the Upload shortcut
  useEffect(() => {
    if (!me || me.role === "pending" || isExternal(me.role)) return;
    const q = new URLSearchParams(location.search);
    if (q.get("upload") === "1") { setIntake({}); history.replaceState(null, "", location.pathname); }
    if (q.get("share") === "1") {
      history.replaceState(null, "", location.pathname);
      (async () => {
        try {
          const c = await caches.open("agron-share"); const keys = await c.keys(); const files: File[] = [];
          for (const k of keys) { const r = await c.match(k); if (!r) continue; files.push(new File([await r.blob()], decodeURIComponent(r.headers.get("X-Name") || "file"), { type: r.headers.get("Content-Type") || "" })); await c.delete(k); }
          setIntake({ files });
        } catch { setIntake({}); }
      })();
    }
  }, [me?.id]); // eslint-disable-line
  useEffect(() => { const st = navStack.current; if (st.length > 1 && st[st.length - 2] === route) st.pop(); else if (st[st.length - 1] !== route) st.push(route); }, [route]);
  useEffect(() => { const dk = section?.dept || hubDept; if (dk) { setOpenDepts((o) => (o[dk] ? o : { [dk]: true })); setFocusDept((f) => (f.k === dk ? f : { k: dk, n: f.n + 1 })); } setRailOpen(false); }, [route]); // eslint-disable-line

  const toast = useCallback((m: string, err?: boolean) => {
    const id = Date.now() + Math.random(); setToasts((x) => [...x, { id, m, err }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), err ? 5200 : 3200);
  }, []);
  const access = useMemo(() => accessFor(me?.role || "pending", rules), [me?.role, rules]);

  if (!loaded || !me) return <div className="login"><div className="faint">…</div></div>;

  if ((me as any).disabled) return (
    <div className="login"><div className="box"><div className="brand"><img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} /></div>
      <h2 style={{ margin: 0 }}>{tx({ en: "This account is switched off", ru: "Эта учётная запись отключена", uk: "Цей обліковий запис вимкнено", ar: "هذا الحساب متوقف" }, lang)}</h2><p className="muted" style={{ margin: 0 }}>{tx({ en: "Ask an owner or administrator of AGRON Workspace.", ru: "Обратитесь к владельцу или администратору AGRON Workspace.", uk: "Зверніться до власника або адміністратора AGRON Workspace.", ar: "تواصل مع مالك أو مسؤول AGRON Workspace." }, lang)}</p>
      <button className="btn" onClick={async () => { await store.signOut(); router.replace("/login"); }}><Icon n="logout" />{t("sign_out", lang)}</button></div></div>
  );
  if (sec && ["owner", "admin"].includes(me.role) && sec.mfaRequired && sec.aal !== "aal2") return <MfaGate sec={sec} lang={lang} onDone={() => { setSec(null); reload(); }} onSignOut={async () => { await store.signOut(); router.replace("/login"); }} />;

  if (me.role === "pending") return (
    <div className="login"><div className="box"><div className="brand"><img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} /></div>
      <h2 style={{ margin: 0 }}>{t("pending_t", lang)}</h2><p className="muted" style={{ margin: 0 }}>{t("pending_p", lang)}</p>
      <button className="btn" onClick={async () => { await store.signOut(); router.replace("/login"); }}><Icon n="logout" />{t("sign_out", lang)}</button></div></div>
  );

  const depts = DEPARTMENTS.map((d: any) => ({ ...d, secs: SECTIONS.filter((s) => s.dept === d.key && access.read.has(s.id)) })).filter((d: any) => d.secs.length);
  const isAdmin = me.role === "owner" || me.role === "admin";
  const dept = section ? DEPARTMENTS.find((d: any) => d.key === section.dept) : null;
  const N = {
    today: tx({ en: "Today", ru: "Сегодня", uk: "Сьогодні", ar: "اليوم" }, lang), messages: tx({ en: "Messages", ru: "Сообщения", uk: "Повідомлення", ar: "الرسائل" }, lang),
    projects: tx({ en: "Projects", ru: "Проекты", uk: "Проєкти", ar: "المشاريع" }, lang), documents: tx({ en: "Documents", ru: "Документы", uk: "Документи", ar: "المستندات" }, lang),
    calendar: tx({ en: "Calendar", ru: "Календарь", uk: "Календар", ar: "التقويم" }, lang), assistant: tx({ en: "Assistant", ru: "Ассистент", uk: "Асистент", ar: "المساعد" }, lang),
    company: tx({ en: "Company", ru: "Компания", uk: "Компанія", ar: "الشركة" }, lang), people: tx({ en: "People", ru: "Сотрудники", uk: "Співробітники", ar: "الموظفون" }, lang),
    management: tx({ en: "Management dashboard", ru: "Панель руководства", uk: "Панель керівництва", ar: "لوحة الإدارة" }, lang), portfolio: tx({ en: "Portfolio", ru: "Портфель", uk: "Портфель", ar: "المحفظة" }, lang), tasks: tx({ en: "Tasks", ru: "Задачи", uk: "Задачі", ar: "المهام" }, lang),
    decide: tx({ en: "Approvals & decisions", ru: "Согласования и решения", uk: "Погодження та рішення", ar: "الموافقات والقرارات" }, lang), ops: tx({ en: "Requests & processes", ru: "Заявки и процессы", uk: "Заявки та процеси", ar: "الطلبات والعمليات" }, lang), crm: tx({ en: "Commercial", ru: "Коммерция", uk: "Комерція", ar: "التجاري" }, lang), mfg: tx({ en: "Manufacturing", ru: "Производство", uk: "Виробництво", ar: "التصنيع" }, lang), build: tx({ en: "Shop floor", ru: "Цех", uk: "Цех", ar: "أرضية المصنع" }, lang), help: tx({ en: "Help", ru: "Помощь", uk: "Допомога", ar: "المساعدة" }, lang),
    more: tx({ en: "More", ru: "Ещё", uk: "Ще", ar: "المزيد" }, lang),
  };
  const ext = isExternal(me.role);
  const PRIMARY: [string, string, string, string][] = ext ? [["/", "", "grid", t("overview", lang)], ["/messages", "messages", "send", N.messages], ["/reports", "reports", "pie", t("reports", lang)]]
    : [["/", "", "sun", N.today], ["/messages", "messages", "send", N.messages], ["/projects", "projects", "layers", N.projects], ["/portfolio", "portfolio", "grid", N.portfolio], ["/documents", "documents", "file", N.documents], ["/calendar", "calendar", "calendar", N.calendar], ["/assistant", "assistant", "spark", N.assistant]];
  const mfgOk = access.read.has("operations.builds");
  const shopOk = access.read.has("operations.work_orders");
  const crmOk = ["sales.pipeline", "marketing.leads", "company.parties", "company.contacts"].some((s) => access.read.has(s));
  const isOn = (r: string) => (r === "" ? !route || route === "today" : route === r || route.startsWith(r + "/"));
  const special: Record<string, [string, string]> = { trash: [t("workspace", lang), t("trash", lang)], today: [t("workspace", lang), tx({ en: "Today", ru: "Сегодня", uk: "Сьогодні", ar: "اليوم" }, lang)], stardome: [t("workspace", lang), t("sd_title", lang)], projects: [t("workspace", lang), tx({ en: "Projects", ru: "Проекты", uk: "Проєкти", ar: "المشاريع" }, lang)], decide: [t("workspace", lang), tx({ en: "Decisions", ru: "Решения", uk: "Рішення", ar: "القرارات" }, lang)], "admin/users": [t("admin", lang), t("users", lang)], "admin/roles": [t("admin", lang), t("roles", lang)], "admin/system": [t("admin", lang), t("sys_title", lang)], me: [t("workspace", lang), t("my_profile", lang)], learn: [t("workspace", lang), t("learn", lang)], guide: [t("workspace", lang), tx({ en: "User guide", ru: "Руководство", uk: "Посібник", ar: "دليل المستخدم" }, lang)], reports: [t("workspace", lang), t("reports", lang)], templates: [t("workspace", lang), t("templates", lang)], ask: [t("workspace", lang), t("ask_docs", lang)],
    messages: [t("workspace", lang), N.messages], documents: [t("workspace", lang), N.documents], calendar: [t("workspace", lang), N.calendar], assistant: [t("workspace", lang), N.assistant],
    portfolio: [t("workspace", lang), N.portfolio], ops: [N.company, N.ops], crm: [N.company, N.crm], mfg: [N.company, N.mfg], build: [N.mfg, N.build], control: [t("workspace", lang), tx({ en: "What needs attention", ru: "Что требует внимания", uk: "Що потребує уваги", ar: "ما يحتاج انتباهًا" }, lang)], team: [N.company, tx({ en: "Team status", ru: "Статус команды", uk: "Статус команди", ar: "حالة الفريق" }, lang)],
    people: [N.company, N.people], management: [N.company, N.management], "company-overview": [N.company, t("overview", lang)], knowledge: [N.company, tx({ en: "Knowledge", ru: "Знания", uk: "Знання", ar: "المعرفة" }, lang)], decisions: [N.company, tx({ en: "Decision log", ru: "Журнал решений", uk: "Журнал рішень", ar: "سجل القرارات" }, lang)], notifications: [t("workspace", lang), t("notifications", lang)] };
  if (route.startsWith("projects/")) special[route] = [tx({ en: "Projects", ru: "Проекты", uk: "Проєкти", ar: "المشاريع" }, lang), tx({ en: "Project", ru: "Проект", uk: "Проєкт", ar: "مشروع" }, lang)];
  const hubD = hubDept ? DEPARTMENTS.find((d: any) => d.key === hubDept) : null;
  const crumbGroup = hubD ? tx(hubD.label, lang) : section ? tx(dept.label, lang) : special[route]?.[0] || t("workspace", lang);
  const crumbTitle = hubD ? t("dept_overview", lang) : section ? tx(section.label, lang) : special[route]?.[1] || (!route && !isExternal(me.role) ? tx({ en: "Today", ru: "Сегодня", uk: "Сьогодні", ar: "اليوم" }, lang) : t("overview", lang));
  const curLang = LANGS.find((l) => l.code === lang)!;
  if (typeof document !== "undefined") document.title = `${crumbTitle} · AGRON Workspace`;
  if (typeof window !== "undefined") { try { // remember recently visited pages for the footer
    const href = "/" + route; const list = JSON.parse(localStorage.getItem("agronws.recent") || "[]").filter((x: any) => x.href !== href);
    if (list[0]?.href !== href) localStorage.setItem("agronws.recent", JSON.stringify([{ href, title: crumbTitle, group: crumbGroup }, ...list].slice(0, 10)));
  } catch {} }
  const goBack = () => { if (navStack.current.length > 1) router.back(); else router.push("/"); };

  let body: React.ReactNode;
  if (!route) body = ext ? <Dashboard depts={depts} /> : <Today />;
  else if (route === "company-overview" && !ext) body = <Dashboard depts={depts} />;
  else if (route === "messages") body = <Messages />;
  else if (route === "documents" && !ext) body = <Documents />;
  else if (route === "calendar" && !ext) body = <CalendarPage />;
  else if (route === "knowledge" && !ext) body = <Knowledge />;
  else if (route === "decisions" && !ext) body = <DecisionLog />;
  else if (route === "assistant" && !ext) body = <Assistant />;
  else if (route === "people" && !ext) body = <People />;
  else if (route === "portfolio" && !ext) body = <Portfolio />;
  else if (route === "control" && !ext) body = <ExecControl />;
  else if (route === "ops" && !ext) body = <Processes />;
  else if (route === "crm" && !ext) body = crmOk ? <Commercial /> : <div className="card empty">{t("no_access", lang)}</div>;
  else if (route === "mfg" && !ext) body = mfgOk ? <Manufacturing /> : <div className="card empty">{t("no_access", lang)}</div>;
  else if (route === "build" && !ext) body = shopOk ? <ShopFloor /> : <div className="card empty">{t("no_access", lang)}</div>;
  else if (route === "team" && !ext) body = <TeamStatus />;
  else if (route === "notifications") body = <Notices />;
  else if (route === "management") body = MANAGERS.includes(me.role) ? <Management /> : <div className="card empty">{t("no_access", lang)}</div>;
  else if (route.startsWith("projects/") && slug.length === 2 && !ext) body = <ProjectHome id={slug[1]} />;
  else if ((route === "admin/users" || route === "admin/roles" || route === "admin/system" || route === "admin/info") && isAdmin) body = <>
      <nav className="dtabs" style={{ ["--dc" as any]: "#5B6CF0" }}>
        <Link href="/admin/users" className={route === "admin/users" ? "on" : ""}><Icon n="users" />{t("users", lang)}</Link>
        <Link href="/admin/roles" className={route === "admin/roles" ? "on" : ""}><Icon n="key" />{t("roles", lang)}</Link>
        <Link href="/admin/system" className={route === "admin/system" ? "on" : ""}><Icon n="pulse" />{t("sys_title", lang)}</Link>
        <Link href="/admin/info" className={route === "admin/info" ? "on" : ""}><Icon n="building" />{tx({ en: "Departments & documents", ru: "Отделы и документы", uk: "Відділи та документи", ar: "الأقسام والمستندات" }, lang)}</Link>
      </nav>
      {route === "admin/users" ? <Admin /> : route === "admin/system" ? <System /> : route === "admin/info" ? <InfoSettings /> : <Roles />}
    </>;
  else if (route.startsWith("admin/")) body = <div className="empty">{t("no_access", lang)}</div>;
  else if (route === "today") body = <Today />;
  else if (route === "me") body = <MyProfile />;
  else if (route === "learn") body = <Learn />;
  else if (route === "guide" && !isExternal(me.role)) body = <Guide />;
  else if (route === "trash" && !isExternal(me.role)) body = <Trash />;
  else if (route === "ask") body = <DocsAsk />;
  else if (route === "stardome") body = <StarDome />;
  else if (route === "projects" && !isExternal(me.role)) body = <Projects />;
  else if (route === "decide" && !isExternal(me.role)) body = <Decisions />;
  else if (hubD && depts.some((d: any) => d.key === hubDept)) {
    const secs = SECTIONS.filter((x) => x.dept === hubDept && access.read.has(x.id));
    body = <>
      <nav className="dtabs" aria-label={tx(hubD.label, lang)} style={{ ["--dc" as any]: (DEPT_COLORS as any)[hubDept] }}>
        <Link href={`/${hubDept}/overview`} className="on" aria-current="page"><Icon n="grid" />{t("dept_overview", lang)}</Link>
        {secs.map((x) => <Link key={x.id} href={`/${x.dept}/${x.key}`}><Icon n={x.icon} />{tx(x.label, lang)}</Link>)}
      </nav>
      <DeptHub key={hubDept} dept={hubDept} />
    </>;
  }
  else if (route === "reports") body = <Reports />;
  else if (route === "templates") body = <Templates />;
  else if (section && access.read.has(section.id)) {
    const secs = SECTIONS.filter((x) => x.dept === section.dept && access.read.has(x.id));
    body = <>
      {secs.length > 1 && <nav className="dtabs" aria-label={tx(dept.label, lang)} style={{ ["--dc" as any]: section.color }}>
        {HUBS.includes(section.dept) && <Link href={`/${section.dept}/overview`}><Icon n="grid" />{t("dept_overview", lang)}</Link>}
        {secs.map((x) => <Link key={x.id} href={`/${x.dept}/${x.key}`} className={x.id === section.id ? "on" : ""} aria-current={x.id === section.id ? "page" : undefined}><Icon n={x.icon} />{tx(x.label, lang)}</Link>)}
      </nav>}
      <SectionView key={section.id} section={section} />
    </>;
  }
  else body = <div className="card empty">{t("no_access", lang)}</div>;

  return (
    <AppCtx.Provider value={{ lang, me, access, toast, openAi: setAi, reload, tick, openMail: setMail, people, rules, setRules, openIntake: (files?: File[]) => setIntake({ files }) }}>
      <div className={`app ${dragFiles ? "drag-files" : ""}`} onClick={(e) => { if (langOpen && !(e.target as HTMLElement).closest(".dd")) setLangOpen(false); }}
        onDragOver={(e) => { if (!isExternal(me.role) && e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!dragFiles) setDragFiles(true); } }}
        onDragLeave={(e) => { if (!e.relatedTarget) setDragFiles(false); }}
        onDrop={(e) => { setDragFiles(false); if (e.defaultPrevented || isExternal(me.role) || !e.dataTransfer.files.length) return; e.preventDefault(); setIntake({ files: [...e.dataTransfer.files] }); }}>
        <aside className={`rail ${railOpen ? "open" : ""}`} aria-label={t("menu", lang)}>
          <div className="rail-brand"><img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} />
            <div className="prod"><i />{t("workspace", lang)}</div></div>
          <nav ref={navRef}>
            {PRIMARY.map(([h, k, ic, label]) => <Link key={h} href={h} className={`nav-item top primary ${isOn(k) ? "active" : ""}`} aria-current={isOn(k) ? "page" : undefined} style={{ ["--dc" as any]: "#FF6A2B" }}><Icon n={ic} /><span>{label}</span>{k === "messages" && <UnreadDot />}</Link>)}
            {!ext && <><div className="nav-label"><span>{N.company}</span></div>
              {access.read.has("company.tasks") && <Link href="/company/tasks" className={`nav-item top ${route === "company/tasks" ? "active" : ""}`} style={{ ["--dc" as any]: "#5B6CF0" }}><Icon n="bell" /><span>{N.tasks}</span></Link>}
              <Link href="/decide" className={`nav-item top ${route === "decide" ? "active" : ""}`} style={{ ["--dc" as any]: "#D9480F" }}><Icon n="check" /><span>{N.decide}</span></Link>
              <Link href="/ops" data-nav="ops" className={`nav-item top ${route === "ops" ? "active" : ""}`} style={{ ["--dc" as any]: "#F26B1D" }}><Icon n="git" /><span>{N.ops}</span></Link>
              {crmOk && <Link href="/crm" data-nav="crm" className={`nav-item top ${route === "crm" ? "active" : ""}`} style={{ ["--dc" as any]: "#1D7AF2" }}><Icon n="handshake" /><span>{N.crm}</span></Link>}
              {mfgOk && <Link href="/mfg" data-nav="mfg" className={`nav-item top ${route === "mfg" ? "active" : ""}`} style={{ ["--dc" as any]: "#0F766E" }}><Icon n="factory" /><span>{N.mfg}</span></Link>}
              {shopOk && <Link href="/build" data-nav="build" className={`nav-item top ${route === "build" ? "active" : ""}`} style={{ ["--dc" as any]: "#0F766E" }}><Icon n="cpu" /><span>{N.build}</span></Link>}
              <Link href="/people" className={`nav-item top ${route === "people" ? "active" : ""}`} style={{ ["--dc" as any]: "#0EA5E9" }}><Icon n="users" /><span>{N.people}</span></Link>
              <Link href="/knowledge" className={`nav-item top ${route === "knowledge" ? "active" : ""}`} style={{ ["--dc" as any]: "#0E9F6E" }}><Icon n="book" /><span>{tx({ en: "Knowledge", ru: "Знания", uk: "Знання", ar: "المعرفة" }, lang)}</span></Link>
              <Link href="/decisions" className={`nav-item top ${route === "decisions" ? "active" : ""}`} style={{ ["--dc" as any]: "#7C5CFF" }}><Icon n="stamp" /><span>{tx({ en: "Decision log", ru: "Журнал решений", uk: "Журнал рішень", ar: "سجل القرارات" }, lang)}</span></Link>
              {MANAGERS.includes(me.role) && <Link href="/management" className={`nav-item top ${route === "management" ? "active" : ""}`} style={{ ["--dc" as any]: "#E5484D" }}><Icon n="target" /><span>{N.management}</span></Link>}
              <Link href="/company-overview" className={`nav-item top ${route === "company-overview" ? "active" : ""}`} style={{ ["--dc" as any]: "#FF6A2B" }}><Icon n="stardome" /><span>{t("overview", lang)}</span></Link>
              <Link href="/stardome" className={`nav-item top ${route === "stardome" ? "active" : ""}`} style={{ ["--dc" as any]: "#FF6A2B" }}><Icon n="container" /><span>{t("sd_title", lang)}</span></Link>
              <Link href="/reports" className={`nav-item top ${route === "reports" ? "active" : ""}`} style={{ ["--dc" as any]: "#E5484D" }}><Icon n="pie" /><span>{t("reports", lang)}</span></Link>
              <Link href="/templates" className={`nav-item top ${route === "templates" ? "active" : ""}`} style={{ ["--dc" as any]: "#C9971C" }}><Icon n="file" /><span>{t("templates", lang)}</span></Link></>}
            <div className="nav-label nav-depts"><Icon n="layers" /><span>{t("departments", lang)}</span><b>{depts.length}</b></div>
            {depts.map((d: any) => {
              const open = !!openDepts[d.key];
              return (
                <div key={d.key} data-dept={d.key} className={`nav-dept ${open ? "open" : ""}`} style={{ ["--dc" as any]: (DEPT_COLORS as any)[d.key] }}>
                  <button className="nav-item" aria-expanded={open} onClick={() => { if (open) setOpenDepts((o) => ({ ...o, [d.key]: false })); else { setOpenDepts({ [d.key]: true }); setFocusDept((f) => ({ k: d.key, n: f.n + 1 })); } }}>
                    <Icon n={d.icon} /><span>{tx(d.label, lang)}</span><Icon n="chev" className="chev" />
                  </button>
                  {open && <div className="nav-sub">{HUBS.includes(d.key) && <Link href={`/${d.key}/overview`} className={`nav-item ${hubDept === d.key ? "active" : ""}`}><Icon n="grid" /><span>{t("dept_overview", lang)}</span></Link>}{d.secs.map((s: any) => (
                    <Link key={s.id} href={`/${d.key}/${s.key}`} className={`nav-item ${sectionId === s.id ? "active" : ""}`}><Icon n={s.icon} /><span>{tx(s.label, lang)}</span></Link>
                  ))}</div>}
                </div>
              );
            })}
            {isAdmin && <><div className="nav-label">{t("admin", lang)}</div>
              <Link href="/admin/users" className={`nav-item top ${route === "admin/users" ? "active" : ""}`} style={{ ["--dc" as any]: "#94A3B8" }}><Icon n="users" /><span>{t("users", lang)}</span></Link>
              <Link href="/admin/roles" className={`nav-item top ${route === "admin/roles" ? "active" : ""}`} style={{ ["--dc" as any]: "#94A3B8" }}><Icon n="key" /><span>{t("roles", lang)}</span></Link>
              <Link href="/admin/system" className={`nav-item top ${route === "admin/system" ? "active" : ""}`} style={{ ["--dc" as any]: "#94A3B8" }}><Icon n="pulse" /><span>{t("sys_title", lang)}</span></Link></>}
            <div className="nav-label">{N.help}</div>
            {!ext && <Link href="/guide" className={`nav-item top ${route === "guide" ? "active" : ""}`} style={{ ["--dc" as any]: "#0F766E" }}><Icon n="book" /><span>{tx({ en: "User guide", ru: "Руководство", uk: "Посібник", ar: "دليل المستخدم" }, lang)}</span></Link>}
            <Link href="/learn" className={`nav-item top ${route === "learn" ? "active" : ""}`} style={{ ["--dc" as any]: "#14B8A6" }}><Icon n="lifebuoy" /><span>{t("learn", lang)}</span></Link>
            {!ext && <Link href="/trash" className={`nav-item top ${route === "trash" ? "active" : ""}`} style={{ ["--dc" as any]: "#94A3B8" }}><Icon n="trash" /><span>{t("trash", lang)}</span></Link>}
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
              <button className="iconbtn mic-top" onClick={() => setSearch({ voice: true })} title={t("voice", lang)} aria-label={t("voice", lang)}><Icon n="mic" /></button>
              {!isExternal(me.role) && <button className="iconbtn photo-btn" onClick={() => setPhoto(true)} title={tx({ en: "Photo → record", ru: "Фото → запись", uk: "Фото → запис", ar: "صورة ← سجل" }, lang)} aria-label={tx({ en: "Photo → record", ru: "Фото → запись", uk: "Фото → запис", ar: "صورة ← سجل" }, lang)}><Icon n="image" /></button>}
              {!isExternal(me.role) && <button className="btn sm intake-btn" onClick={() => setIntake({})} title={t("intake_t", lang)} aria-label={t("intake_t", lang)}><Icon n="upload" /><span>{t("intake_btn", lang)}</span></button>}
              {!ext && <QuickCreate />}
              <Bell />
              <button className="btn sm askai" onClick={() => setAi({ title: crumbTitle, section: sectionId })} aria-label={t("ask_ai", lang)}><Icon n="spark" /><span>{t("ask_ai", lang)}</span></button>
              <div className="dd">
                <button className="dd-btn" aria-haspopup="menu" aria-expanded={langOpen} aria-label={t("language", lang)} onClick={() => setLangOpen(!langOpen)}>
                  <Icon n="globe" /><span>{curLang.short}</span><Icon n="down" />
                </button>
                {langOpen && <div className="dd-menu" role="menu">{LANGS.map((l) => (
                  <button key={l.code} role="menuitemradio" aria-checked={l.code === lang} className={l.code === lang ? "on" : ""} lang={l.code} onClick={() => setLang(l.code)}>
                    <span className="code">{l.short}</span>{l.name}</button>))}</div>}
              </div>
              <button className="iconbtn theme-top" onClick={toggleTheme} title={dark ? t("theme_light", lang) : t("theme_dark", lang)} aria-label={dark ? t("theme_light", lang) : t("theme_dark", lang)}><Icon n={dark ? "sun" : "moon"} /></button>
              <ProfileMenu name={me.full_name || me.email} role={tx((ROLES as any)[me.role]?.label, lang)} dark={dark} onTheme={toggleTheme} onSignOut={DEMO ? undefined : async () => { await store.signOut(); router.replace("/login"); }} />
            </div>
          </header>
          <div className="content">
            <main className="page">
              {envBanner() && <div className={`banner env-${APP_ENV}`} role="status"><Icon n="info" /><span>{(envBanner() as any)[lang] || envBanner()!.en}</span></div>}
              {DEMO && <div className="banner"><Icon n="info" /><span>{t("demo_banner", lang)}</span>
                <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => { store.resetDemo(); reload(); }}>{({ en: "Reset", ru: "Сбросить", uk: "Скинути", ar: "إعادة تعيين" } as any)[lang] || "Reset"}</button></div>}
              {body}
            </main>
            <Footer depts={depts} isAdmin={isAdmin} dark={dark} onTheme={toggleTheme} onLang={setLang} onSearch={(v) => setSearch({ voice: v })} hubs={HUBS} version={RELEASE_SHA ? `${VERSION} · ${RELEASE_SHA.slice(0, 7)}` : VERSION}
              onSignOut={DEMO ? undefined : async () => { await store.signOut(); router.replace("/login"); }} />
          </div>
        </div>
      </div>
      {ai && <AiPanel ctx={ai} onClose={() => setAi(null)} />}
      {mail && <ComposerModal init={mail} onClose={() => setMail(null)} />}
      {search && <Search voice={search.voice} onClose={() => setSearch(null)} />}
      {intake && <Intake initial={intake.files} onClose={() => setIntake(null)} />}
      {photo && <PhotoCapture onClose={() => setPhoto(false)} />}
      <nav className="tabbar" aria-label={tx({ en: "Main sections", ru: "Основные разделы", uk: "Основні розділи", ar: "الأقسام الرئيسية" }, lang)}>
        {PRIMARY.map(([h, k, ic, label]) => <Link key={h} href={h} className={isOn(k) ? "on" : ""} aria-current={isOn(k) ? "page" : undefined}><Icon n={ic} /><span>{label}</span></Link>)}
      </nav>
      <OfflineBar />
      <div className="toasts" aria-live="polite">{toasts.map((x) => <div key={x.id} className={`toast ${x.err ? "err" : ""}`}>{x.m}</div>)}</div>
    </AppCtx.Provider>
  );
}
