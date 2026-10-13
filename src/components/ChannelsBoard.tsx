"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { t, tx, type Lang } from "@/lib/i18n";
import { DEMO, Rec, store } from "@/lib/store";
import { parseCsv } from "@/lib/csv";
import { aggregateExport, delta, platform, prevMonth, thisMonth, type MonthStats } from "@/lib/channels";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const S = {
  title: L("Channels and statistics", "Каналы и статистика", "Канали та статистика", "القنوات والإحصاءات"),
  sub: L("Every account in one place: open the profile or its analytics, add this month's numbers by hand, from the platform's CSV export or straight from the API.", "Все аккаунты в одном месте: откройте профиль или аналитику, внесите цифры месяца вручную, из CSV-выгрузки платформы или напрямую по API.", "Усі акаунти в одному місці: відкрийте профіль або аналітику, внесіть цифри місяця вручну, з CSV-вивантаження платформи або напряму через API.", "كل الحسابات في مكان واحد: افتح الحساب أو تحليلاته، وأدخل أرقام الشهر يدوياً أو من ملف CSV أو عبر API."),
  open: L("Open", "Открыть", "Відкрити", "فتح"), analytics: L("Analytics", "Аналитика", "Аналітика", "التحليلات"),
  add: L("Add numbers", "Внести цифры", "Внести цифри", "إدخال الأرقام"), csv: L("Import CSV", "Импорт CSV", "Імпорт CSV", "استيراد CSV"),
  yt: L("Update from YouTube", "Обновить из YouTube", "Оновити з YouTube", "تحديث من YouTube"),
  followers: L("followers", "подписчиков", "підписників", "متابع"), month: L("this month", "в этом месяце", "цього місяця", "هذا الشهر"),
  impr: L("impressions", "показов", "показів", "مرة ظهور"), eng: L("engagements", "вовлечений", "залучень", "تفاعل"),
  none: L("No channels yet. Add LinkedIn, YouTube, Instagram, Facebook, X and the website once the accounts exist.", "Каналов пока нет. Добавьте LinkedIn, YouTube, Instagram, Facebook, X и сайт, когда аккаунты будут созданы.", "Каналів поки немає. Додайте LinkedIn, YouTube, Instagram, Facebook, X і сайт, коли акаунти буде створено.", "لا قنوات بعد. أضف LinkedIn وYouTube وInstagram وFacebook وX والموقع عند إنشاء الحسابات."),
  addCh: L("Add channel", "Добавить канал", "Додати канал", "إضافة قناة"), noLink: L("Add the profile link in the card", "Добавьте ссылку на профиль в карточке", "Додайте посилання на профіль у картці", "أضف رابط الحساب في البطاقة"),
  saved: L("Saved", "Сохранено", "Збережено", "تم الحفظ"), save: L("Save", "Сохранить", "Зберегти", "حفظ"),
  csvHow: L("How to export:", "Как выгрузить:", "Як вивантажити:", "طريقة التصدير:"), csvNone: L("No dates or known columns found in this file.", "В файле не найдены даты или знакомые колонки.", "У файлі не знайдено дат або відомих колонок.", "لم يُعثر على تواريخ أو أعمدة معروفة."),
  csvSave: L("Save {n} months", "Сохранить месяцев: {n}", "Зберегти місяців: {n}", "احفظ {n} أشهر"), found: L("Columns found", "Найдены колонки", "Знайдено колонки", "الأعمدة"),
  period: L("Month", "Месяц", "Місяць", "الشهر"), statsLink: L("All statistics", "Вся статистика", "Уся статистика", "كل الإحصاءات"),
};
const FIELDS: [string, T4][] = [
  ["followers", L("Followers (total)", "Подписчики (всего)", "Підписники (всього)", "المتابعون (الإجمالي)")], ["new_followers", L("New followers", "Новые подписчики", "Нові підписники", "متابعون جدد")],
  ["posts", L("Posts / videos", "Посты / видео", "Дописи / відео", "المنشورات")], ["impressions", L("Impressions", "Показы", "Покази", "الظهور")],
  ["reach", L("Reach", "Охват", "Охоплення", "الوصول")], ["engagements", L("Engagements", "Вовлечённость", "Залученість", "التفاعلات")],
  ["clicks", L("Clicks", "Клики", "Кліки", "النقرات")], ["video_views", L("Video views", "Просмотры видео", "Перегляди відео", "مشاهدات")],
  ["sessions", L("Website sessions", "Сессии на сайте", "Сесії на сайті", "جلسات الموقع")], ["leads", L("Leads", "Лиды", "Ліди", "عملاء")],
];
const n = (v: any) => Number(v) || 0;
const fmtN = (v: number) => v.toLocaleString("en-US");

export default function ChannelsBoard({ compact = false }: { compact?: boolean }) {
  const { lang, access, toast, tick } = useApp();
  const T = (x: T4) => tx(x, lang as Lang);
  const [chs, setChs] = useState<Rec[] | null>(null);
  const [mets, setMets] = useState<Rec[]>([]);
  const [yt, setYt] = useState(false);
  const [form, setForm] = useState<{ ch: Rec; period: string; vals: Record<string, string> } | null>(null);
  const [imp, setImp] = useState<{ ch: Rec; months: MonthStats[]; found: string[] } | null>(null);
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement>(null); const pick = useRef<Rec | null>(null);
  const canWrite = access.write.has("marketing.metrics");
  const load = () => Promise.all([store.list("marketing.channels"), store.list("marketing.metrics").catch(() => [])]).then(([c, m]) => { setChs(c.filter((x) => x.status !== "Paused" || !compact)); setMets(m); }).catch(() => setChs([]));
  useEffect(() => { load(); if (!DEMO) fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"status"}' }).then((r) => (r.ok ? r.json() : {})).then((j: any) => setYt(!!j.youtube)).catch(() => {}); }, [tick]); // eslint-disable-line
  if (!chs) return null;

  const cur = thisMonth(), prev = prevMonth(cur);
  // Statistics belong to one account (two websites share the platform "Website"); older rows without an account match by platform
  const metric = (ch: Rec, period: string) => mets.find((m) => m.data?.period === period && (m.data?.account ? m.data.account === ch.title : m.data?.channel === ch.data?.platform));
  const upsert = async (ch: Rec, period: string, vals: Record<string, any>, source: string) => {
    const p = ch.data?.platform; const ex = metric(ch, period);
    await store.save({ id: ex?.id, section: "marketing.metrics", title: `${ch.title} · ${period}`, status: ex?.status || (source === "Manual" ? "Draft" : "Final"), data: { ...(ex?.data || {}), ...vals, channel: p, account: ch.title, period, source } });
  };
  const saveForm = async () => {
    if (!form) return; setBusy("form");
    try {
      const vals: Record<string, any> = {}; for (const [k] of FIELDS) if (form.vals[k] !== undefined && form.vals[k] !== "") vals[k] = Number(form.vals[k]);
      await upsert(form.ch, form.period, vals, "Manual");
      if (vals.followers !== undefined && form.period >= (form.ch.data?.as_of || "").slice(0, 7)) await store.save({ ...form.ch, data: { ...form.ch.data, followers: vals.followers, as_of: new Date().toISOString().slice(0, 10) } });
      toast(T(S.saved)); setForm(null); load();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };
  const readCsv = async (f: File) => {
    const ch = pick.current; if (!ch) return;
    const { months, found } = aggregateExport(parseCsv(await f.text()));
    if (!months.length) { toast(T(S.csvNone), true); return; }
    setImp({ ch, months, found });
  };
  const saveCsv = async () => {
    if (!imp) return; setBusy("csv");
    try {
      for (const m of imp.months) { const { period, days, ...v } = m; const vals: Record<string, number> = {}; for (const [k, x] of Object.entries(v)) if (x) vals[k] = x as number; await upsert(imp.ch, period, vals, "CSV export"); }
      toast(T(S.saved)); setImp(null); load();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };
  const fromYoutube = async (ch: Rec) => {
    setBusy(ch.id);
    try { const r = await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "youtube", id: ch.id }) }); if (!r.ok) throw new Error(await r.text()); const j = await r.json(); toast(`${j.title}: ${fmtN(j.subscribers)} · ${fmtN(j.views)} views`); load(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };

  return (
    <section className={`card hub-card ${compact ? "wide" : ""} chan`}>
      <div className="card-h"><h2><Icon n="link" />{T(S.title)}</h2>
        <span className="toolbar" style={{ marginInlineStart: "auto" }}>
          <Link href="/marketing/metrics" className="btn ghost sm"><Icon n="trend" />{T(S.statsLink)}</Link>
          {access.write.has("marketing.channels") && <Link href="/marketing/channels?new=1" className="btn sm"><Icon n="plus" />{T(S.addCh)}</Link>}</span></div>
      {!compact && <p className="faint chan-p">{T(S.sub)}</p>}
      <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readCsv(f); e.target.value = ""; }} />
      <div className="card-b chan-grid">
        {!chs.length && <div className="empty" style={{ gridColumn: "1/-1" }}>{T(S.none)}</div>}
        {chs.map((ch) => {
          const p = platform(ch.data?.platform); const now = metric(ch, cur), before = metric(ch, prev);
          const fol = n(now?.data?.followers) || n(ch.data?.followers); const folBefore = n(before?.data?.followers);
          const openUrl = ch.data?.url || ""; const anUrl = ch.data?.admin_url || p.analytics;
          return (
            <div key={ch.id} className="chan-card" style={{ ["--pc" as any]: p.c }}>
              <div className="chan-top"><span className="chan-mono">{p.short}</span>
                <span style={{ minWidth: 0 }}><b>{ch.data?.platform || ch.title}</b><small>{ch.data?.handle || ch.title}</small></span>
                <span className={`chip ${ch.status === "Active" ? "c-ok" : ch.status === "Planned" ? "c-info" : ""}`}>{ch.status}</span></div>
              <div className="chan-num"><b className="mono">{fol ? fmtN(fol) : "—"}</b><span>{T(S.followers)}{folBefore && fol ? <em className={fol >= folBefore ? "up" : "down"}> {delta(fol, folBefore)}</em> : null}</span></div>
              <div className="chan-mini faint">{T(S.month)}: {fmtN(n(now?.data?.impressions))} {T(S.impr)} · {fmtN(n(now?.data?.engagements))} {T(S.eng)}{ch.data?.connection ? ` · ${ch.data.connection}` : ""}</div>
              <div className="chan-act">
                {openUrl ? <a className="btn sm" href={openUrl} target="_blank" rel="noopener"><Icon n="ext" />{T(S.open)}</a> : <Link className="btn ghost sm" href={`/marketing/channels?r=${ch.id}`} title={T(S.noLink)}><Icon n="edit" />{T(S.open)}</Link>}
                {anUrl && <a className="btn ghost sm" href={anUrl} target="_blank" rel="noopener"><Icon n="trend" />{T(S.analytics)}</a>}
                {canWrite && <button className="btn ghost sm" onClick={() => setForm({ ch, period: cur, vals: Object.fromEntries(FIELDS.map(([k]) => [k, now?.data?.[k] !== undefined ? String(now.data[k]) : ""])) })}><Icon n="plus" />{T(S.add)}</button>}
                {canWrite && <button className="btn ghost sm" title={`${T(S.csvHow)} ${p.csv}`} onClick={() => { pick.current = ch; file.current?.click(); }}><Icon n="upload" />{T(S.csv)}</button>}
                {canWrite && p.api === "youtube" && yt && <button className="btn ghost sm" disabled={busy === ch.id} onClick={() => fromYoutube(ch)}><Icon n="refresh" />{busy === ch.id ? "…" : T(S.yt)}</button>}
              </div>
              {form?.ch.id === ch.id && <div className="chan-form">
                <label className="field"><span>{T(S.period)}</span><input className="input mono" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value.slice(0, 7) })} placeholder="2026-10" /></label>
                {FIELDS.map(([k, l]) => <label key={k} className="field"><span>{T(l)}</span><input className="input mono" inputMode="numeric" value={form.vals[k]} onChange={(e) => setForm({ ...form, vals: { ...form.vals, [k]: e.target.value.replace(/[^\d.]/g, "") } })} /></label>)}
                <div className="toolbar" style={{ gridColumn: "1/-1" }}><button className="btn primary sm" disabled={busy === "form" || !/^\d{4}-\d{2}$/.test(form.period)} onClick={saveForm}>{T(S.save)}</button><button className="btn ghost sm" onClick={() => setForm(null)}>{t("cancel", lang)}</button></div>
              </div>}
              {imp?.ch.id === ch.id && <div className="chan-imp">
                <small className="faint">{T(S.found)}: {imp.found.join(", ")}</small>
                <table className="tb"><thead><tr><th>{T(S.period)}</th><th>{T(FIELDS[3][1])}</th><th>{T(FIELDS[5][1])}</th><th>{T(FIELDS[6][1])}</th><th>{T(FIELDS[1][1])}</th></tr></thead>
                  <tbody>{imp.months.map((m) => <tr key={m.period}><td className="mono">{m.period}</td><td className="mono">{fmtN(m.impressions)}</td><td className="mono">{fmtN(m.engagements)}</td><td className="mono">{fmtN(m.clicks)}</td><td className="mono">{fmtN(m.new_followers)}</td></tr>)}</tbody></table>
                <div className="toolbar"><button className="btn primary sm" disabled={busy === "csv"} onClick={saveCsv}>{T(S.csvSave).replace("{n}", String(imp.months.length))}</button><button className="btn ghost sm" onClick={() => setImp(null)}>{t("cancel", lang)}</button></div>
              </div>}
            </div>);
        })}
      </div>
    </section>
  );
}
