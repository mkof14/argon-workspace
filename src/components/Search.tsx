"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { useApp, findSection, SECTIONS } from "./App";
import { DEPARTMENTS } from "@/config/workspace.config.mjs";
import { GLOSSARY, GUIDES, HELP, l2 } from "@/config/learn";
import { TEMPLATES } from "@/config/templates";
import { t, tx } from "@/lib/i18n";
import { Faq, Rec, store, isExternal, type CorpHit, type MessageHit } from "@/lib/store";
import { messageLink } from "./Discussion";
import { commentText, deptLabel, isEmployee, personName } from "./PeopleFields";

type Hit = { id: string; group: string; icon: string; color?: string; title: string; sub?: string; go: () => void };
const SPEECH: Record<string, string> = { en: "en-US", ru: "ru-RU", uk: "uk-UA", ar: "ar-AE" };
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** Every word of the query must appear somewhere in the text. */
const match = (q: string, ...texts: (string | undefined)[]) => { const hay = norm(texts.filter(Boolean).join(" ")); return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w)); };

export default function Search({ onClose, initial = "", voice = false }: { onClose: () => void; initial?: string; voice?: boolean }) {
  const { lang, access, me, openAi, openMail, toast, people } = useApp();
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [faq, setFaq] = useState<Faq[]>([]);
  const [cmts, setCmts] = useState<MessageHit[]>([]); const [corp, setCorp] = useState<CorpHit[]>([]);
  const [mf, setMf] = useState<{ author: string; from: string; to: string; mentions: boolean; decisions: boolean }>({ author: "", from: "", to: "", mentions: false, decisions: false });
  // what to look for: everything, or one kind of information; and optionally one project
  const [kind, setKind] = useState<"all" | "task" | "project" | "document" | "person" | "decision" | "discussion" | "knowledge">("all");
  const [proj, setProj] = useState(""); const [projects, setProjects] = useState<Rec[]>([]);
  useEffect(() => { if (access.read.has("company.projects")) store.list("company.projects").then(setProjects).catch(() => {}); }, []); // eslint-disable-line
  const [sel, setSel] = useState(0);
  const [listening, setListening] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const rec = useRef<any>(null);
  const go = (href: string) => { onClose(); router.push(href); };

  useEffect(() => { inp.current?.focus(); if (voice) listen(); return () => rec.current?.abort?.(); }, []); // eslint-disable-line
  useEffect(() => { // records and FAQ from the server, debounced
    setSel(0);
    if (q.trim().length < 2) { setRecs([]); setFaq([]); setCmts([]); setCorp([]); return; }
    const h = setTimeout(() => { store.searchRecords(q.trim(), 40).then(setRecs).catch(() => {}); store.faqSearch(q.trim(), lang, 4).then(setFaq).catch(() => {});
      // inside stored documents and the knowledge base — the database search with the same access rules
      if (["all", "document", "knowledge"].includes(kind)) store.corpSearch(q.trim(), { types: kind === "knowledge" ? ["knowledge"] : kind === "document" ? ["document", "document_text"] : ["document_text", "knowledge"], project: proj || undefined }, 20).then(setCorp).catch(() => setCorp([]));
      store.searchMessages(q.trim(), { project: proj || undefined, author: mf.author || undefined, from: mf.from || undefined, to: mf.to || undefined, mentions: mf.mentions, decisions: mf.decisions }, kind === "discussion" ? 40 : 12).then(setCmts).catch(() => setCmts([])); }, 220);
    return () => clearTimeout(h);
  }, [q, lang, proj, kind, mf.author, mf.from, mf.to, mf.mentions, mf.decisions]);

  const listen = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast(t("voice_unsupported", lang), true); return; }
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); rec.current = r; r.lang = SPEECH[lang] || "en-US"; r.interimResults = true; r.continuous = false;
    r.onresult = (e: any) => { const txt = Array.from(e.results).map((x: any) => x[0].transcript).join(" "); setQ(txt); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    setListening(true); r.start();
  };

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim(); const out: Hit[] = [];
    const pages: [string, string, string, string][] = [["/", "stardome", t("overview", lang), ""], ["/reports", "pie", t("reports", lang), t("reports_sub", lang)], ["/templates", "file", t("templates", lang), t("tpl_sub", lang)], ["/guide", "book", tx({ en: "User guide", ru: "Руководство пользователя", uk: "Посібник користувача", ar: "دليل المستخدم" }, lang), ""], ["/decide", "check", tx({ en: "Decisions", ru: "Решения", uk: "Рішення", ar: "القرارات" }, lang), ""], ["/projects", "layers", tx({ en: "Projects", ru: "Проекты", uk: "Проєкти", ar: "المشاريع" }, lang), ""], ["/learn", "lifebuoy", t("learn", lang), ""], ["/me", "user", t("my_profile", lang), ""]];
    if (!isExternal(me.role)) pages.unshift(["/inow", "spark", "1inow · " + tx({ en: "My Day", ru: "Мой день", uk: "Мій день", ar: "يومي" }, lang), tx({ en: "What needs you now, and why", ru: "Что нужно вам сейчас и почему", uk: "Що потрібно вам зараз і чому", ar: "ما يحتاجك الآن ولماذا" }, lang)]);
    if (["owner", "admin"].includes(me.role)) pages.push(["/admin/users", "users", t("users", lang), ""], ["/admin/roles", "key", t("roles", lang), ""]);
    const acts: Hit[] = [];
    if (access.write.has("company.tasks")) acts.push({ id: "a-task", group: "act", icon: "bell", title: t("new_reminder", lang), sub: s || undefined, go: () => go(`/company/tasks?new=1`) });
    if (access.read.has("mail.templates")) acts.push({ id: "a-mail", group: "act", icon: "mail", title: t("write_email", lang), go: () => { onClose(); openMail({}); } });
    if (!isExternal(me.role)) acts.push({ id: "a-inow", group: "act", icon: "spark", title: tx({ en: "Ask 1inow", ru: "Спросить 1inow", uk: "Запитати 1inow", ar: "اسأل 1inow" }, lang), sub: s || undefined, go: () => { try { if (s) sessionStorage.setItem("inow_ask", s); } catch {} go("/inow"); } });
    acts.push({ id: "a-brief", group: "act", icon: "trend", title: t("exec_brief", lang), go: () => go("/reports") });
    if (!s) {
      pages.forEach(([h, i, l, sub]) => out.push({ id: h, group: "page", icon: i, title: l, sub, go: () => go(h) }));
      out.push(...acts);
      return out;
    }
    // AI answer is always one Enter away
    out.push({ id: "ai", group: "ai", icon: "spark", title: `${t("ask_ai", lang)}: “${s}”`, go: () => { onClose(); openAi({ title: s, ask: s }); } });
    pages.forEach(([h, i, l, sub]) => match(s, l, sub) && out.push({ id: h, group: "page", icon: i, title: l, sub, go: () => go(h) }));
    // Sections whose name matches come before sections that only mention the words in their help text
    for (const pass of [1, 2]) for (const sec of SECTIONS) {
      if (!access.read.has(sec.id)) continue;
      const dl = DEPARTMENTS.find((d: any) => d.key === sec.dept)?.label;
      const byName = match(s, tx(sec.label, lang), sec.label.en, tx(dl, lang));
      if (pass === 1 ? !byName : byName || !match(s, HELP[sec.id]?.en, HELP[sec.id]?.ru)) continue;
      out.push({ id: sec.id, group: "page", icon: sec.icon, color: sec.color, title: tx(sec.label, lang), sub: tx(dl, lang), go: () => go(`/${sec.dept}/${sec.key}`) });
      if (pass === 1 && access.write.has(sec.id) && sec.view !== "mail" && sec.view !== "desks") out.push({ id: "n-" + sec.id, group: "act", icon: "plus", color: sec.color, title: `${t("new", lang)}: ${tx(sec.label, lang)}`, go: () => go(`/${sec.dept}/${sec.key}?new=1`) });
    }
    out.push(...acts.filter((a) => match(s, a.title)));
    for (const tp of TEMPLATES) if (match(s, tp.name.en, tp.name.ru, tp.desc.en, tp.desc.ru)) out.push({ id: "t-" + tp.id, group: "tpl", icon: tp.icon, title: l2(tp.name, lang), sub: l2(tp.desc, lang), go: () => go(`/templates?t=${tp.id}`) });
    const KSEC: Record<string, string[]> = { task: ["company.tasks"], project: ["company.projects", "company.milestones"], document: ["company.documents"], decision: ["company.decisions"] };
    const inProj = (r: Rec) => !proj || r.id === proj || r.data?.project_ref === proj;
    if (kind !== "all") out.length = out.findIndex((h) => h.group === "ai") + 1; // one kind only: keep the AI line, drop pages and actions
    for (const p of kind === "all" || kind === "person" ? people : []) if (isEmployee(p) && !isExternal(me.role) && match(s, p.full_name, p.email, p.title || "", deptLabel(p.department, lang))) out.push({ id: "p-" + p.id, group: "person", icon: "user", title: personName(p), sub: [p.title, deptLabel(p.department, lang), p.email].filter(Boolean).join(" · "), go: () => go(`/people?q=${encodeURIComponent(personName(p))}`) });
    for (const c of kind === "all" || kind === "discussion" || kind === "decision" ? cmts : []) {
      if (kind === "decision" && c.flag !== "decision") continue;
      const sec = findSection(c.section); const au = people.find((p) => p.id === c.author);
      const typ = c.flag === "decision" ? tx({ en: "Decision", ru: "Решение", uk: "Рішення", ar: "قرار" }, lang) : c.kind === "review" ? tx({ en: "Review note", ru: "Замечание", uk: "Зауваження", ar: "ملاحظة مراجعة" }, lang) : sec ? tx(sec.label, lang) : "";
      out.push({ id: "c-" + c.id, group: "talk", icon: c.flag === "decision" ? "stamp" : "send", color: sec?.color, title: c.title || "—", sub: `${typ}${au ? ` · ${au.full_name || au.email}` : ""} · ${c.created_at.slice(0, 10)} — ${commentText(c.excerpt).slice(0, 140)}`, go: () => go(messageLink({ id: c.record_id, section: c.section }, c.id)) });
    }
    for (const r of recs) { const sec = findSection(r.section); if (!sec) continue; if (kind === "person" || kind === "discussion" || (kind !== "all" && !KSEC[kind]?.includes(r.section)) || !inProj(r)) continue; out.push({ id: "r-" + r.id, group: "rec", icon: sec.icon, color: sec.color, title: r.title, sub: `${tx(sec.label, lang)}${r.status ? " · " + r.status : ""}`, go: () => go(r.section === "company.projects" ? `/projects/${r.id}` : `/${r.section.replace(".", "/")}?r=${r.id}`) }); }
    for (const h of corp) { if (h.kind === "person" || h.kind === "discussion") continue; if (h.kind === "document" && recs.some((r) => r.id === h.id)) continue;
      out.push({ id: `x-${h.kind}-${h.id}-${h.link}`, group: h.kind === "knowledge" ? "kb" : "doc", icon: h.kind === "knowledge" ? "book" : "file", title: h.title,
        sub: `${h.kind === "document_text" ? tx({ en: "Inside the document", ru: "В тексте документа", uk: "У тексті документа", ar: "داخل المستند" }, lang) : h.kind === "knowledge" ? tx({ en: "Knowledge", ru: "Знания", uk: "Знання", ar: "المعرفة" }, lang) : tx({ en: "Document", ru: "Документ", uk: "Документ", ar: "مستند" }, lang)}${h.version ? ` · v${h.version}` : ""} — ${String(h.excerpt || "").replace(/[«»]/g, "").slice(0, 140)}`, go: () => go(h.link) }); }
    if (kind === "all") for (const f of faq) out.push({ id: "f-" + f.id, group: "faq", icon: "lifebuoy", title: f.question, sub: f.answer.replace(/[#*_`>]/g, "").slice(0, 110), go: () => go(`/learn?tab=faq&q=${encodeURIComponent(f.question)}`) });
    if (kind === "all") for (const [dept, terms] of Object.entries(GLOSSARY)) for (const [term, def] of terms) if (match(s, term, def.en, def.ru)) out.push({ id: "g-" + dept + term, group: "term", icon: "book", title: term, sub: l2(def, lang), go: () => go(`/learn?tab=terms&q=${encodeURIComponent(term)}`) });
    if (kind === "all") for (const g of GUIDES) if (match(s, g.title.en, g.title.ru, g.body.en, g.body.ru)) out.push({ id: "gd-" + g.id, group: "term", icon: g.icon, title: l2(g.title, lang), sub: l2(g.body, lang).slice(0, 110), go: () => go(`/learn`) });
    return out;
  }, [q, recs, faq, cmts, corp, kind, proj, people, lang, access, me.role]); // eslint-disable-line

  const order = ["ai", "rec", "doc", "kb", "person", "talk", "page", "act", "tpl", "faq", "term"];
  const sorted = [...hits].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  // Put records first when there are any, but keep AI on top
  const groups = order.filter((g) => sorted.some((h) => h.group === g));
  const flat = groups.flatMap((g) => sorted.filter((h) => h.group === g)).slice(0, 60);
  const gl: Record<string, string> = { doc: tx({ en: "Inside documents", ru: "В документах", uk: "У документах", ar: "داخل المستندات" }, lang), kb: tx({ en: "Knowledge", ru: "Знания", uk: "Знання", ar: "المعرفة" }, lang), person: tx({ en: "People", ru: "Сотрудники", uk: "Співробітники", ar: "الموظفون" }, lang), talk: tx({ en: "Discussions", ru: "Обсуждения", uk: "Обговорення", ar: "النقاشات" }, lang), ai: t("s_ai", lang), rec: t("s_records", lang), page: t("s_pages", lang), act: t("s_actions", lang), tpl: t("templates", lang), faq: "FAQ", term: t("s_terms", lang) };

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((x) => Math.min(x + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); flat[sel]?.go(); }
    else if (e.key === "Escape") onClose();
  };
  useEffect(() => { document.getElementById(`sh-${sel}`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  let i = -1;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="gsearch" role="dialog" aria-modal="true" aria-label={t("search_all", lang)}>
        <div className="search-in">
          <Icon n="search" />
          <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder={t("search_ph", lang)} aria-label={t("search_all", lang)} role="combobox" aria-expanded="true" aria-controls="search-list" aria-activedescendant={`sh-${sel}`} />
          <button className={`iconbtn mic ${listening ? "on" : ""}`} onClick={listen} title={t("voice", lang)} aria-label={t("voice", lang)} aria-pressed={listening}><Icon n="mic" /></button>
          <kbd>Esc</kbd>
        </div>
        <div className="search-kinds" role="group" aria-label={tx({ en: "Look in", ru: "Искать в", uk: "Шукати в", ar: "ابحث في" }, lang)}>
          {([["all", { en: "All", ru: "Всё", uk: "Усе", ar: "الكل" }], ["task", { en: "Tasks", ru: "Задачи", uk: "Задачі", ar: "المهام" }], ["project", { en: "Projects", ru: "Проекты", uk: "Проєкти", ar: "المشاريع" }], ["document", { en: "Documents", ru: "Документы", uk: "Документи", ar: "المستندات" }], ["person", { en: "People", ru: "Сотрудники", uk: "Співробітники", ar: "الموظفون" }], ["decision", { en: "Decisions", ru: "Решения", uk: "Рішення", ar: "القرارات" }], ["discussion", { en: "Discussions", ru: "Обсуждения", uk: "Обговорення", ar: "النقاشات" }], ["knowledge", { en: "Knowledge", ru: "Знания", uk: "Знання", ar: "المعرفة" }]] as [typeof kind, any][]).filter(([k]) => !isExternal(me.role) || k === "all" || k === "discussion").map(([k, l]) => <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => { setKind(k); inp.current?.focus(); }} aria-pressed={kind === k}>{tx(l, lang)}</button>)}
          {kind === "discussion" && <span className="msg-filters">
            <select className="input" value={mf.author} onChange={(e) => setMf({ ...mf, author: e.target.value })} aria-label={tx({ en: "Person", ru: "Автор", uk: "Автор", ar: "الشخص" }, lang)} style={{ width: "auto", padding: "3px 8px" }}><option value="">{tx({ en: "Anyone", ru: "Любой автор", uk: "Будь-хто", ar: "أي شخص" }, lang)}</option>{people.filter((p) => !p.disabled).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
            <input className="input" type="date" value={mf.from} onChange={(e) => setMf({ ...mf, from: e.target.value })} aria-label={tx({ en: "From", ru: "С", uk: "З", ar: "من" }, lang)} style={{ width: "auto", padding: "3px 8px" }} />
            <input className="input" type="date" value={mf.to} onChange={(e) => setMf({ ...mf, to: e.target.value })} aria-label={tx({ en: "To", ru: "По", uk: "По", ar: "إلى" }, lang)} style={{ width: "auto", padding: "3px 8px" }} />
            <button className={`chip ${mf.mentions ? "on" : ""}`} aria-pressed={mf.mentions} onClick={() => setMf({ ...mf, mentions: !mf.mentions })}>@ {tx({ en: "Mentions me", ru: "Упомянули меня", uk: "Згадали мене", ar: "يذكرني" }, lang)}</button>
            <button className={`chip ${mf.decisions ? "on" : ""}`} aria-pressed={mf.decisions} onClick={() => setMf({ ...mf, decisions: !mf.decisions })}>{tx({ en: "Decisions only", ru: "Только решения", uk: "Лише рішення", ar: "القرارات فقط" }, lang)}</button></span>}
          {projects.length > 0 && <select className="input" value={proj} onChange={(e) => setProj(e.target.value)} aria-label={tx({ en: "Project", ru: "Проект", uk: "Проєкт", ar: "المشروع" }, lang)} style={{ width: "auto", padding: "3px 8px" }}><option value="">{tx({ en: "Any project", ru: "Любой проект", uk: "Будь-який проєкт", ar: "أي مشروع" }, lang)}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>}
        </div>
        {listening && <div className="search-listen"><span className="pulse" />{t("listening", lang)}</div>}
        <div className="search-list" id="search-list" role="listbox">
          {groups.map((g) => <div key={g}><div className="search-g">{gl[g]}</div>
            {flat.filter((h) => h.group === g).map((h) => { i++; const idx = i; return (
              <button key={h.id} id={`sh-${idx}`} role="option" aria-selected={sel === idx} className={`search-hit ${sel === idx ? "on" : ""}`} onMouseEnter={() => setSel(idx)} onClick={h.go} style={{ ["--dc" as any]: h.color || "var(--accent)" }}>
                <span className="dic"><Icon n={h.icon} /></span><span style={{ minWidth: 0 }}><b>{h.title}</b>{h.sub && <small>{h.sub}</small>}</span>
              </button>); })}</div>)}
          {q.trim().length >= 2 && hits.length <= 1 && <div className="empty">{t("nothing_found", lang)}{kind !== "all" ? <> · <button className="linkbtn" onClick={() => setKind("all")}>{tx({ en: "search everywhere", ru: "искать везде", uk: "шукати всюди", ar: "ابحث في كل مكان" }, lang)}</button></> : null}</div>}
          {q.trim().length < 2 && <div className="faint" style={{ padding: "8px 14px", fontSize: 13 }}>{tx({ en: "Type at least two letters — in English or Russian. Results include only what you may open.", ru: "Введите хотя бы две буквы — по-русски или по-английски. В результатах только то, что вам можно открыть.", uk: "Введіть щонайменше дві літери — українською, російською чи англійською. У результатах лише те, що вам можна відкрити.", ar: "اكتب حرفين على الأقل — بالإنجليزية أو الروسية. تظهر فقط النتائج التي يمكنك فتحها." }, lang)}</div>}
        </div>
        <div className="search-foot faint"><span><kbd>↑</kbd><kbd>↓</kbd> {t("s_move", lang)}</span><span><kbd>Enter</kbd> {t("s_open", lang)}</span><span><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> {t("s_anywhere", lang)}</span></div>
      </div>
    </>
  );
}
