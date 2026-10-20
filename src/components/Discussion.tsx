"use client";
// The discussion of one record (project, task, document, meeting, approval, announcement). One model everywhere:
// messages with one level of replies, @mentions by account, files, links to tasks / documents / milestones, edits and
// withdrawal (the database keeps the earlier text as evidence), Important / Decision / Announcement marks and pins
// for the project manager or management, review notes tied to a document version, unread markers and a direct link
// to every message. Access always follows the record — the database decides who reads, who is suggested, who is told.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { MANAGERS, useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { isExternal, store, type Comment, type FileItem, type Profile, type Rec } from "@/lib/store";
import { CommentBody, MentionInput, personName } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const FLAGS: Record<string, T4> = { important: L("Important", "Важно", "Важливо", "مهم"), decision: L("Decision", "Решение", "Рішення", "قرار"), announcement: L("Announcement", "Объявление", "Оголошення", "إعلان") };
const FLAG_TONE: Record<string, string> = { important: "c-warn", decision: "c-ok", announcement: "c-info" };
export const messageLink = (r: { id: string; section: string }, cid: string) => (r.section === "company.projects" ? `/projects/${r.id}?tab=discussion#c-${cid}` : `/${r.section.replace(".", "/")}?r=${r.id}#c-${cid}`);
const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "?";
const when = (s?: string | null) => (s || "").slice(0, 16).replace("T", " ");

export default function Discussion({ rec, project, versions, linkables, title, onCount, textOf }: {
  rec: Rec; project?: Rec | null; versions?: FileItem[]; linkables?: Rec[]; title?: string; onCount?: (n: number) => void; textOf?: (c: Comment) => string;
}) {
  const { lang, people, me, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [all, setAll] = useState<Comment[]>([]); const [readAt, setReadAt] = useState<string | null>(null); const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState(""); const [replyTo, setReplyTo] = useState<Comment | null>(null); const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [internal, setInternal] = useState(false); const [review, setReview] = useState<string>(""); const [refs, setRefs] = useState<string[]>([]); const [files, setFiles] = useState<FileItem[]>([]);
  const [view, setView] = useState<"all" | "decisions" | "review">("all"); const [cands, setCands] = useState<Profile[]>([]); const [busy, setBusy] = useState(false);
  const [showTrail, setShowTrail] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const ext = isExternal(me.role);
  const shared = !!rec.company; // shared with a partner company: internal notes are possible
  const lead = MANAGERS.includes(me.role) || rec.data?.manager_id === me.id || project?.data?.manager_id === me.id || rec.data?.organizer_id === me.id;
  const who = (id?: string | null) => personName(people.find((p) => p.id === id)) || T(L("Former colleague", "Бывший сотрудник", "Колишній співробітник", "زميل سابق"));

  const load = async () => { try { const cs = await store.comments(rec.id); setAll(cs); onCount?.(cs.filter((c) => (c.kind || "message") !== "approval" && (c.kind || "message") !== "system" && !c.deleted_at).length); } catch {} finally { setLoaded(true); } };
  useEffect(() => { let on = true; (async () => { const r = await store.readAt(rec.id).catch(() => null); if (on) setReadAt(r); await load(); store.markRead(rec.id).catch(() => {}); })(); return () => { on = false; }; }, [rec.id]); // eslint-disable-line
  // suggestions come from the database: only people who may read this record (partners: only the people on it)
  const qRef = useRef<{ t?: any; q: string }>({ q: "" });
  const fetchCands = (q: string) => store.mentionCandidates(rec.id, q, internal).then((xs) => { if (qRef.current.q === q) setCands(xs.map((x) => ({ id: x.id, full_name: x.name, email: x.name, role: x.role, department: x.department } as any))); }).catch(() => setCands([]));
  useEffect(() => { qRef.current.q = ""; fetchCands(""); }, [rec.id, internal]); // eslint-disable-line
  const onQuery = (q: string) => { qRef.current.q = q; clearTimeout(qRef.current.t); qRef.current.t = setTimeout(() => fetchCands(q), 150); };
  // opened from a notification or a copied link: show that message
  useEffect(() => { if (!loaded) return; const h = typeof location !== "undefined" ? location.hash : ""; if (h.startsWith("#c-")) requestAnimationFrame(() => { const el = document.getElementById(h.slice(1)); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); } }); }, [loaded]);

  const talk = all.filter((c) => (c.kind || "message") === "message" || c.kind === "review");
  const trail = all.filter((c) => c.kind === "approval" || c.kind === "system");
  const replies = useMemo(() => { const m = new Map<string, Comment[]>(); for (const c of talk) if (c.parent_id) m.set(c.parent_id, [...(m.get(c.parent_id) || []), c]); return m; }, [all]); // eslint-disable-line
  const roots = talk.filter((c) => !c.parent_id || !talk.some((x) => x.id === c.parent_id))
    .filter((c) => view === "all" || (view === "decisions" ? c.flag === "decision" || (replies.get(c.id) || []).some((r) => r.flag === "decision") : c.kind === "review"))
    .sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0) || a.created_at.localeCompare(b.created_at));
  const unread = talk.filter((c) => c.author !== me.id && !c.deleted_at && (!readAt || c.created_at > readAt)).length;
  const lastAct = talk.reduce((m, c) => (c.created_at > m ? c.created_at : m), "");
  const byVersion = useMemo(() => { const m = new Map<string, number>(); for (const c of talk) if (c.file_path) m.set(c.file_path, (m.get(c.file_path) || 0) + 1); return m; }, [all]); // eslint-disable-line

  const send = async () => {
    const body = text.trim(); if (!body || busy) return; setBusy(true);
    try {
      if (editing) { await store.editComment(editing.id, body); setEditing(null); }
      else {
        const v = versions?.find((f) => f.path === review);
        await store.addComment(rec.id, body, { parent_id: replyTo?.id || null, internal: shared && internal, kind: v ? "review" : "message", file_path: v?.path || null, version_label: v ? versionName(v, versions!) : null, refs, files: files.map((f) => ({ path: f.path, name: f.name, size: f.size, type: f.type })) });
      }
      setText(""); setReplyTo(null); setRefs([]); setFiles([]); await load();
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); }
  };
  const act = async (f: () => Promise<any>, ok?: string) => { try { await f(); if (ok) toast(ok); await load(); } catch (e: any) { toast(e.message || "Error", true); } };
  const attach = async (fl: FileList | null) => { if (!fl?.length) return; try { const up: FileItem[] = []; for (const f of Array.from(fl).slice(0, 5)) up.push(await store.upload(`${rec.section}/${rec.id}`, f)); setFiles([...files, ...up]); } catch (e: any) { toast(e.message || "Error", true); } };
  const openFile = async (path: string, name?: string) => { try { window.open(await store.fileUrl(path, 600, name), "_blank", "noopener"); } catch (e: any) { toast(e.message || "Error", true); } };
  const copy = async (c: Comment) => { try { await navigator.clipboard.writeText(location.origin + messageLink(rec, c.id)); toast(T(L("Link copied", "Ссылка скопирована", "Посилання скопійовано", "نُسخ الرابط"))); } catch { toast(location.origin + messageLink(rec, c.id)); } };
  const refRec = (id: string) => linkables?.find((r) => r.id === id);

  const Msg = ({ c, reply }: { c: Comment; reply?: boolean }) => {
    const mine = c.author === me.id; const isNew = !mine && !c.deleted_at && (!readAt || c.created_at > readAt);
    const name = who(c.author);
    return <article id={`c-${c.id}`} className={`msg ${reply ? "reply" : ""} ${c.internal ? "internal" : ""} ${c.mentions?.includes(me.id) ? "mentioned" : ""} ${c.flag ? `flag-${c.flag}` : ""} ${c.pinned_at ? "pinned" : ""}`} data-msg={c.id}>
      <span className="av" aria-hidden="true">{initials(name)}</span>
      <div className="msg-main">
        <header><b>{name}</b><time className="faint" dateTime={c.created_at}>{when(c.created_at)}</time>
          {c.edited_at && !c.deleted_at && <span className="faint" title={when(c.edited_at)}>· {T(L("edited", "изменено", "змінено", "عُدّل"))}</span>}
          {isNew && <span className="chip c-info new-dot">{T(L("new", "новое", "нове", "جديد"))}</span>}
          {c.internal && <span className="chip"><Icon n="lock" />{T(L("internal", "внутреннее", "внутрішнє", "داخلي"))}</span>}
          {c.flag && <span className={`chip ${FLAG_TONE[c.flag]}`} data-flag={c.flag}>{T(FLAGS[c.flag])}</span>}
          {c.pinned_at && <span className="chip"><Icon n="flag" />{T(L("pinned", "закреплено", "закріплено", "مثبّت"))}</span>}
          {c.kind === "review" && <span className="chip c-warn" data-version={c.version_label || ""}><Icon n="file" />{T(L("Review", "Замечание", "Зауваження", "ملاحظة مراجعة"))}{c.version_label ? ` · ${c.version_label}` : ""}</span>}
        </header>
        {c.deleted_at ? <p className="faint withdrawn">{T(L("Message withdrawn by the author", "Сообщение отозвано автором", "Повідомлення відкликано автором", "سحب الكاتب الرسالة"))} · {when(c.deleted_at)}</p> : <CommentBody body={textOf ? textOf(c) : c.body} />}
        {!c.deleted_at && (c.refs?.length || c.files?.length) ? <div className="msg-att">
          {(c.refs || []).map((id) => { const r = refRec(id); return r ? <Link key={id} className="chip" href={`/${r.section.replace(".", "/")}?r=${r.id}`}><Icon n="link" />{r.title}</Link> : <span key={id} className="chip faint"><Icon n="link" />{T(L("linked record", "связанная запись", "пов'язаний запис", "سجل مرتبط"))}</span>; })}
          {(c.files || []).map((f) => <button key={f.path} type="button" className="chip" onClick={() => openFile(f.path, f.name)}><Icon n="clip" />{f.name || f.path.split("/").pop()}</button>)}
        </div> : null}
        {!c.deleted_at && <div className="msg-act">
          {!reply && <button type="button" className="btn ghost xs" onClick={() => { setReplyTo(c); setEditing(null); }}>{T(L("Reply", "Ответить", "Відповісти", "رد"))}</button>}
          {mine && <button type="button" className="btn ghost xs" onClick={() => { setEditing({ id: c.id, body: c.body }); setText(c.body); setReplyTo(null); }}>{T(L("Edit", "Изменить", "Змінити", "تعديل"))}</button>}
          {mine && <button type="button" className="btn ghost xs" onClick={() => { if (confirmWithdraw()) act(() => store.withdrawComment(c.id), T(L("Withdrawn", "Отозвано", "Відкликано", "سُحبت"))); }}>{T(L("Withdraw", "Отозвать", "Відкликати", "سحب"))}</button>}
          {lead && <select className="input xs" aria-label={T(L("Mark", "Отметка", "Позначка", "علامة"))} value={c.flag || ""} onChange={(e) => act(() => store.flagComment(c.id, (e.target.value || null) as any), e.target.value === "decision" ? T(L("Added to the decision log", "Добавлено в журнал решений", "Додано до журналу рішень", "أُضيف إلى سجل القرارات")) : undefined)}>
            <option value="">{T(L("No mark", "Без отметки", "Без позначки", "بلا علامة"))}</option>{Object.keys(FLAGS).map((k) => <option key={k} value={k}>{T(FLAGS[k])}</option>)}</select>}
          {lead && !reply && <button type="button" className="btn ghost xs" onClick={() => act(() => store.pinComment(c.id, !c.pinned_at))}>{c.pinned_at ? T(L("Unpin", "Открепить", "Відкріпити", "إلغاء التثبيت")) : T(L("Pin", "Закрепить", "Закріпити", "تثبيت"))}</button>}
          <button type="button" className="btn ghost xs" onClick={() => copy(c)} aria-label={T(L("Copy link to this message", "Скопировать ссылку на сообщение", "Скопіювати посилання на повідомлення", "انسخ رابط الرسالة"))}><Icon n="link" /></button>
          {!mine && <button type="button" className="btn ghost xs" onClick={() => { store.markUnread(rec.id, c.created_at).then(() => setReadAt(new Date(Date.parse(c.created_at) - 1000).toISOString())); }}>{T(L("Mark unread", "Непрочитано", "Непрочитане", "غير مقروء"))}</button>}
        </div>}
      </div>
    </article>;
  };
  const confirmWithdraw = () => typeof window === "undefined" || window.confirm(T(L("Withdraw this message? The text disappears from the discussion; the history keeps it.", "Отозвать сообщение? Текст исчезнет из обсуждения, история его сохранит.", "Відкликати повідомлення? Текст зникне з обговорення, історія його збереже.", "سحب الرسالة؟ يختفي النص من النقاش ويحتفظ به السجل.")));

  return <section className="discussion" aria-label={title || T(L("Discussion", "Обсуждение", "Обговорення", "النقاش"))}>
    <div className="disc-h">
      <div className="eyebrow">{title || T(L("Discussion", "Обсуждение", "Обговорення", "النقاش"))}</div>
      <span className="faint disc-meta">{talk.filter((c) => !c.deleted_at).length} {T(L("messages", "сообщ.", "повід.", "رسائل"))}{unread ? <> · <b className="unread-n">{unread} {T(L("new", "новых", "нових", "جديدة"))}</b></> : null}{lastAct ? ` · ${when(lastAct)}` : ""}</span>
      <div className="seg" role="tablist" style={{ marginInlineStart: "auto" }}>
        <button role="tab" aria-selected={view === "all"} className={view === "all" ? "on" : ""} onClick={() => setView("all")}>{T(L("All", "Все", "Усі", "الكل"))}</button>
        <button role="tab" aria-selected={view === "decisions"} className={view === "decisions" ? "on" : ""} onClick={() => setView("decisions")}>{T(L("Decisions", "Решения", "Рішення", "القرارات"))}</button>
        {versions && <button role="tab" aria-selected={view === "review"} className={view === "review" ? "on" : ""} onClick={() => setView("review")}>{T(L("Review notes", "Замечания", "Зауваження", "ملاحظات المراجعة"))}</button>}
      </div>
    </div>
    {versions && versions.length > 0 && <div className="ver-notes faint">{versions.map((v) => <span key={v.path} className="chip">{versionName(v, versions)} · {byVersion.get(v.path) || 0} {T(L("notes", "замеч.", "заув.", "ملاحظات"))}</span>)}</div>}
    <div className="msgs">
      {roots.map((c) => <div key={c.id} className="msg-thread"><Msg c={c} />
        {(replies.get(c.id) || []).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((r) => <Msg key={r.id} c={r} reply />)}
        {(replies.get(c.id) || []).length > 0 && <small className="faint thread-n">{(replies.get(c.id) || []).length} {T(L("replies", "ответов", "відповідей", "ردود"))}</small>}</div>)}
      {loaded && !roots.length && <div className="faint" style={{ fontSize: 13.5, padding: "6px 0" }}>{view === "all" ? T(L("No messages yet. Type @ to mention a colleague — they get a notification with a link to the message.", "Сообщений пока нет. Наберите @, чтобы упомянуть коллегу, — он получит уведомление со ссылкой на сообщение.", "Повідомлень ще немає. Наберіть @, щоб згадати колегу, — він отримає сповіщення з посиланням на повідомлення.", "لا رسائل بعد. اكتب @ لذكر زميل — يصله إشعار برابط إلى الرسالة.")) : T(L("Nothing here yet.", "Здесь пока пусто.", "Тут поки порожньо.", "لا شيء هنا بعد."))}</div>}
    </div>
    <div className="composer">
      {(replyTo || editing) && <div className="composer-ctx faint">{editing ? T(L("Editing your message", "Правка сообщения", "Редагування повідомлення", "تعديل رسالتك")) : `${T(L("Reply to", "Ответ", "Відповідь", "رد على"))} ${who(replyTo!.author)}`}
        <button type="button" className="iconbtn" aria-label={T(L("Cancel", "Отмена", "Скасувати", "إلغاء"))} onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setText(""); } }}><Icon n="x" /></button></div>}
      <div className="toolbar" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <MentionInput value={text} onChange={setText} onSubmit={send} label={T(L("Message", "Сообщение", "Повідомлення", "رسالة"))} placeholder={T(L("Write a message… (@ to mention)", "Напишите сообщение… (@ — упомянуть)", "Напишіть повідомлення… (@ — згадати)", "اكتب رسالة… (@ للذكر)"))} candidates={cands} onQuery={onQuery} />
        <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>{editing ? T(L("Save", "Сохранить", "Зберегти", "حفظ")) : T(L("Send", "Отправить", "Надіслати", "إرسال"))}</button>
      </div>
      {!editing && <div className="composer-opts">
        <button type="button" className="btn ghost xs" onClick={() => fileIn.current?.click()}><Icon n="clip" />{T(L("Attach", "Файл", "Файл", "إرفاق"))}</button>
        <input ref={fileIn} type="file" multiple hidden onChange={(e) => { attach(e.target.files); e.target.value = ""; }} aria-label={T(L("Attach a file", "Прикрепить файл", "Прикріпити файл", "إرفاق ملف"))} />
        {files.map((f) => <span key={f.path} className="chip"><Icon n="clip" />{f.name}<button type="button" className="iconbtn" aria-label="×" onClick={() => setFiles(files.filter((x) => x.path !== f.path))}><Icon n="x" /></button></span>)}
        {linkables && linkables.length > 0 && <select className="input xs" value="" aria-label={T(L("Link a task, document or milestone", "Связать задачу, документ или веху", "Пов'язати задачу, документ або віху", "اربط مهمة أو مستنداً أو مرحلة"))} onChange={(e) => { if (e.target.value && !refs.includes(e.target.value)) setRefs([...refs, e.target.value]); }}>
          <option value="">{T(L("Link…", "Связать…", "Пов'язати…", "ربط…"))}</option>{linkables.filter((r) => r.id !== rec.id).slice(0, 200).map((r) => <option key={r.id} value={r.id}>{sectionWord(r.section, lang as Lang)} · {r.title}</option>)}</select>}
        {refs.map((id) => <span key={id} className="chip"><Icon n="link" />{refRec(id)?.title || "—"}<button type="button" className="iconbtn" aria-label="×" onClick={() => setRefs(refs.filter((x) => x !== id))}><Icon n="x" /></button></span>)}
        {versions && versions.length > 0 && <select className="input xs" value={review} onChange={(e) => setReview(e.target.value)} aria-label={T(L("Review note for version", "Замечание к версии", "Зауваження до версії", "ملاحظة لنسخة"))}>
          <option value="">{T(L("General message", "Общее сообщение", "Загальне повідомлення", "رسالة عامة"))}</option>{versions.map((v) => <option key={v.path} value={v.path}>{T(L("Review note on", "Замечание к", "Зауваження до", "ملاحظة على"))} {versionName(v, versions)}</option>)}</select>}
        {shared && !ext && <label className="chk"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> <Icon n="lock" />{T(L("Internal note — partners never see it", "Внутренняя заметка — партнёры её не видят", "Внутрішня нотатка — партнери її не бачать", "ملاحظة داخلية — لا يراها الشركاء"))}</label>}
      </div>}
    </div>
    {trail.length > 0 && <div className="trail"><button type="button" className="btn ghost xs" onClick={() => setShowTrail(!showTrail)}><Icon n="stamp" />{T(L("Approval notes", "Записи согласования", "Записи погодження", "ملاحظات الموافقة"))} · {trail.length}</button>
      {showTrail && trail.map((c) => <div key={c.id} className="trail-row faint"><small>{when(c.created_at)} · {who(c.author)}</small> {c.body}</div>)}</div>}
  </section>;
}

/** V1, V2 … by upload order (oldest first), as on the document's file list. */
export function versionName(v: FileItem, all: FileItem[]) {
  const same = all.filter((f) => f.name === v.name).sort((a, b) => String(a.created_at || a.path).localeCompare(String(b.created_at || b.path)));
  const i = same.findIndex((f) => f.path === v.path); return `V${(i < 0 ? 0 : i) + 1}${all.some((f) => f.name !== v.name) ? ` ${v.name}` : ""}`;
}
const WORDS: Record<string, T4> = { "company.tasks": L("Task", "Задача", "Задача", "مهمة"), "company.documents": L("Document", "Документ", "Документ", "مستند"), "company.milestones": L("Milestone", "Веха", "Віха", "مرحلة"), "company.meetings": L("Meeting", "Встреча", "Зустріч", "اجتماع") };
const sectionWord = (s: string, l: Lang) => (WORDS[s] ? tx(WORDS[s], l) : s);
