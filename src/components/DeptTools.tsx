"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { t, tx, type Lang } from "@/lib/i18n";
import { DEMO, Rec, store } from "@/lib/store";
import { PORTALS } from "@/config/portals";
import { METRIC_KPIS, DEPARTMENTS } from "@/config/workspace.config.mjs";
const DEPTS: Record<string, any> = Object.fromEntries((DEPARTMENTS as any[]).map((d) => [d.key, d.label]));
import { delta } from "@/lib/channels";
import { trackUrl, usptoUrl } from "@/lib/links";
import { collectMonth, type Auto } from "@/lib/kpiAuto";
import { thisMonth, prevMonth } from "@/lib/channels";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const useT = () => { const { lang } = useApp(); return (x: T4) => tx(x, lang as Lang); };
const n = (v: any) => Number(v) || 0;
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const post = async (url: string, body: any) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };

/* ---------------- Official portals ---------------- */
export function PortalsCard({ dept }: { dept: string }) {
  const T = useT(); const list = PORTALS[dept] || [];
  if (!list.length) return null;
  return (
    <div className="card hub-card wide">
      <div className="card-h"><h2><Icon n="globe" />{T(L("Portals and official tools", "Порталы и официальные сервисы", "Портали та офіційні сервіси", "البوابات والأدوات الرسمية"))}</h2>
        <span className="faint" style={{ fontSize: 13 }}>{T(L("Open in a new tab; logins stay in your browser, never in Workspace", "Открываются в новой вкладке; логины остаются в вашем браузере, не в Workspace", "Відкриваються в новій вкладці; логіни залишаються у вашому браузері, не у Workspace", "تُفتح في علامة تبويب جديدة؛ بيانات الدخول تبقى في متصفحك"))}</span></div>
      <div className="card-b portal-grid">{list.map((p) => (
        <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer" className="portal"><b>{p.name}<Icon n="ext" /></b><small>{T(p.what)}</small></a>))}</div>
    </div>
  );
}

/* ---------------- Monthly KPIs ---------------- */
const EXTRA: Record<string, string[]> = { sales: ["marketing.leads"], technical: ["security.incidents"] };
export function MetricsCard({ dept, recs }: { dept: string; recs: Rec[] }) {
  const T = useT(); const { lang, access, toast, reload } = useApp();
  const [col, setCol] = useState<{ period: string; auto: Auto } | null>(null); const [busy, setBusy] = useState(false);
  const kpis: any[] = (METRIC_KPIS as any)[dept] || []; const sec = `${dept}.metrics`;
  if (!kpis.length || !access.read.has(sec)) return null;
  const rows = recs.filter((r) => r.section === sec && /^\d{4}-\d{2}$/.test(r.data?.period || "")).sort((a, b) => a.data.period.localeCompare(b.data.period));
  const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
  const fmt = (k: any, v: number) => (k.type === "money" ? usd(v) : v.toLocaleString("en-US"));
  const collect = async (period: string) => {
    setBusy(true);
    try { const extra = (EXTRA[dept] || []).filter((x) => access.read.has(x)); const more = extra.length ? await store.listMany(extra) : []; setCol({ period, auto: collectMonth(dept, [...recs, ...more], period) }); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const saveCol = async () => {
    if (!col) return; setBusy(true);
    try {
      const ex = rows.find((r) => r.data?.period === col.period);
      await store.save({ id: ex?.id, section: sec, title: ex?.title || `${tx((DEPTS as any)[dept], "en" as Lang) || dept} · ${col.period}`, status: ex?.status || "Draft", data: { ...(ex?.data || {}), ...col.auto.values, period: col.period } });
      toast(t("saved", lang)); setCol(null); reload();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="card hub-card wide">
      <div className="card-h"><h2><Icon n="trend" />{T(L("Monthly KPIs", "Показатели за месяц", "Показники за місяць", "المؤشرات الشهرية"))}{cur ? <span className="chip mono" style={{ marginInlineStart: 8 }}>{cur.data.period}</span> : null}</h2>
        <span className="toolbar" style={{ marginInlineStart: "auto" }}>
          <Link href={`/${dept}/metrics`} className="btn ghost sm">{t("open", lang)}</Link>
          {access.write.has(sec) && <button className="btn sm" disabled={busy} onClick={() => collect(thisMonth())}><Icon n="spark" />{T(L("Collect the month", "Собрать месяц", "Зібрати місяць", "اجمع الشهر"))}</button>}
          {access.write.has(sec) && <Link href={`/${dept}/metrics?new=1`} className="btn ghost sm"><Icon n="plus" />{T(L("Add month", "Добавить месяц", "Додати місяць", "إضافة شهر"))}</Link>}</span></div>
      {col && <div className="card-b kpi-collect">
        <div className="toolbar"><b>{T(L("From Workspace records", "Из записей Workspace", "Із записів Workspace", "من سجلات مساحة العمل"))}</b>
          <div className="seg">{[thisMonth(), prevMonth(thisMonth())].map((p) => <button key={p} className={col.period === p ? "on" : ""} onClick={() => collect(p)}>{p}</button>)}</div></div>
        <table className="tb"><tbody>{kpis.filter((k) => col.auto.values[k.key] !== undefined).map((k) => <tr key={k.key}><td>{tx(k.label, lang as Lang)}</td><td className="mono" style={{ textAlign: "end" }}>{fmt(k, col.auto.values[k.key])}</td><td className="faint" style={{ fontSize: 12.5 }}>{col.auto.how[k.key]}</td></tr>)}</tbody></table>
        <small className="faint">{T(L("Other numbers (bank balance, phishing test, deploys…) are entered by hand in the month record. Saving keeps what is already there and updates these.", "Остальные цифры (остаток на счёте, фишинг-тест, выкатки…) вносятся вручную в запись месяца. При сохранении уже внесённое остаётся, эти цифры обновляются.", "Інші цифри (залишок на рахунку, фішинг-тест, викатки…) вносяться вручну в запис місяця. Під час збереження вже внесене залишається, ці цифри оновлюються.", "الأرقام الأخرى تُدخل يدوياً في سجل الشهر. الحفظ يُبقي الموجود ويحدّث هذه."))}</small>
        <div className="toolbar"><button className="btn primary sm" disabled={busy} onClick={saveCol}><Icon n="check" />{T(L("Save to the month", "Сохранить в месяц", "Зберегти в місяць", "احفظ في الشهر"))} {col.period}</button><button className="btn ghost sm" onClick={() => setCol(null)}>{t("cancel", lang)}</button></div>
      </div>}
      <div className="card-b kpi-grid">
        {!cur && <div className="empty" style={{ gridColumn: "1/-1" }}>{T(L("No months yet. Add this month's numbers once a month; trends and reports use them.", "Месяцев пока нет. Вносите цифры раз в месяц — по ним строятся тренды и отчёты.", "Місяців поки немає. Вносьте цифри раз на місяць — за ними будуються тренди та звіти.", "لا أشهر بعد. أدخل الأرقام شهرياً لتُبنى عليها الاتجاهات والتقارير."))}</div>}
        {cur && kpis.map((k) => { const v = cur.data?.[k.key]; if (v === undefined || v === "") return null; const pv = prev?.data?.[k.key];
          const d = pv !== undefined && pv !== "" ? delta(n(v), n(pv)) : ""; const better = d && d !== "new" ? (n(v) >= n(pv)) === (k.good === "up") : null;
          return <div key={k.key} className="kpi"><span>{tx(k.label, lang as Lang)}</span><b className="mono">{fmt(k, n(v))}</b>{d ? <small className={better === null ? "" : better ? "up" : "down"}>{d} {T(L("vs", "к", "до", "مقابل"))} {prev?.data?.period}</small> : null}</div>; })}
      </div>
    </div>
  );
}

/* ---------------- Exchange rates (finance) ---------------- */
export function FxCard() {
  const T = useT();
  const [fx, setFx] = useState<{ date: string | null; rates: Record<string, number | null>; source: string } | null>(null);
  const [amt, setAmt] = useState("100000"); const [cur, setCur] = useState("USD");
  useEffect(() => { if (DEMO) { setFx({ date: null, rates: { USD: 1, AED: 3.6725, EUR: 0.92, GBP: 0.79 }, source: "sample" }); return; } fetch("/api/fx").then((r) => r.json()).then(setFx).catch(() => {}); }, []);
  if (!fx) return null;
  const inUsd = n(amt) / (fx.rates[cur] || 1);
  return (
    <div className="card hub-card">
      <div className="card-h"><h2><Icon n="coins" />{T(L("Exchange rates and converter", "Курсы валют и конвертер", "Курси валют і конвертер", "أسعار الصرف والمحوّل"))}</h2></div>
      <div className="card-b" style={{ display: "grid", gap: 12 }}>
        <div className="kpi-grid">{Object.entries(fx.rates).filter(([k]) => k !== "USD").map(([k, v]) => <div key={k} className="kpi"><span>1 USD</span><b className="mono">{v ? `${v.toFixed(4)} ${k}` : "—"}</b></div>)}</div>
        <div className="toolbar"><input className="input mono" style={{ maxWidth: 160 }} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount" />
          <select className="input" style={{ maxWidth: 100 }} value={cur} onChange={(e) => setCur(e.target.value)} aria-label="Currency">{Object.keys(fx.rates).map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="feed">{Object.entries(fx.rates).filter(([k, v]) => k !== cur && v).map(([k, v]) => <div key={k} className="hub-row"><span>{k}</span><b className="mono">{(inUsd * (v as number)).toLocaleString("en-US", { maximumFractionDigits: 2 })}</b></div>)}</div>
        <small className="faint">{fx.source}{fx.date ? ` · ${fx.date}` : ""}</small>
      </div>
    </div>
  );
}

/* ---------------- Domain security scan ---------------- */
type Chk = { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string };
export function DomainScan() {
  const T = useT(); const { toast, access, lang } = useApp();
  const [domains, setDomains] = useState("agron1.com, stardome.life, workspace.agron1.com");
  const [res, setRes] = useState<{ domain: string; checks: Chk[] }[] | null>(null); const [busy, setBusy] = useState(false);
  const run = async () => {
    if (DEMO) { toast(T(L("The scan runs on the live site.", "Проверка работает на живом сайте.", "Перевірка працює на живому сайті.", "يعمل الفحص على الموقع الحي.")), true); return; }
    setBusy(true); try { setRes(await post("/api/security", { action: "scan", domains: domains.split(/[\s,]+/).filter(Boolean) })); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const toRisk = async (d: string, c: Chk) => {
    try { await store.save({ section: "security.cyber", title: `${d}: ${c.label}`, status: "Open", data: { risk: c.status === "fail" ? "High" : "Medium", asset: d, control: `${c.detail}\n\nFound by the Workspace domain security scan on ${new Date().toISOString().slice(0, 10)}.` } }); toast(T(L("Added to Cybersecurity risks", "Добавлено в киберриски", "Додано до кіберризиків", "أُضيف إلى المخاطر السيبرانية"))); }
    catch (e: any) { toast(e.message, true); }
  };
  const ico = { pass: "check", warn: "alert", fail: "x" } as const;
  return (
    <div className="card hub-card wide">
      <div className="card-h"><h2><Icon n="shield" />{T(L("Domain and website security", "Безопасность доменов и сайтов", "Безпека доменів і сайтів", "أمن النطاقات والمواقع"))}</h2>
        <span className="faint" style={{ fontSize: 13 }}>{T(L("Email spoofing protection, HTTPS certificate and browser security headers", "Защита почты от подделки, сертификат HTTPS и защитные заголовки сайта", "Захист пошти від підробки, сертифікат HTTPS і захисні заголовки сайту", "حماية البريد من الانتحال وشهادة HTTPS ورؤوس الأمان"))}</span></div>
      <div className="card-b" style={{ display: "grid", gap: 12 }}>
        <div className="toolbar" style={{ flexWrap: "nowrap" }}><input className="input" value={domains} onChange={(e) => setDomains(e.target.value)} aria-label="Domains" /><button className="btn primary" disabled={busy} onClick={run}><Icon n="search" />{busy ? "…" : T(L("Scan", "Проверить", "Перевірити", "افحص"))}</button></div>
        {res && <div className="scan-grid">{res.map((r) => { const bad = r.checks.filter((c) => c.status !== "pass").length; return (
          <div key={r.domain} className="scan">
            <div className="scan-h"><b>{r.domain}</b><span className={`chip ${bad ? (r.checks.some((c) => c.status === "fail") ? "c-bad" : "c-warn") : "c-ok"}`}>{bad ? `${bad} ${T(L("to fix", "исправить", "виправити", "للإصلاح"))}` : T(L("All good", "Всё в порядке", "Усе гаразд", "كل شيء جيد"))}</span></div>
            {r.checks.map((c) => <div key={c.id} className={`scan-row ${c.status}`}><Icon n={ico[c.status]} /><span><b>{c.label}</b><small>{c.detail}</small></span>
              {c.status !== "pass" && access.write.has("security.cyber") && <button className="btn ghost sm" onClick={() => toRisk(r.domain, c)}>{T(L("Add risk", "В риски", "До ризиків", "أضف خطراً"))}</button>}</div>)}
          </div>); })}</div>}
        {!res && <small className="faint">{T(L("Checks only public records and the public website; nothing is changed.", "Проверяются только публичные записи DNS и сайт; ничего не меняется.", "Перевіряються лише публічні записи DNS і сайт; нічого не змінюється.", "يفحص السجلات العامة والموقع فقط؛ لا يغيّر شيئاً."))}</small>}
      </div>
    </div>
  );
}

/* ---------------- Workspace access review (owner/admin) ---------------- */
type U = { email: string; name: string; role: string; us_person: boolean; company: string | null; last_sign_in: string | null; days: number | null; flags: string[] };
export function AccessReview() {
  const T = useT(); const { me, toast } = useApp();
  const [rows, setRows] = useState<U[] | null>(null); const [busy, setBusy] = useState(false);
  if (!["owner", "admin"].includes(me.role)) return null;
  const load = async () => { if (DEMO) { toast("Demo", true); return; } setBusy(true); try { setRows(await post("/api/security", { action: "users" })); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const record = async () => {
    if (!rows) return;
    const flagged = rows.filter((r) => r.flags.length);
    try {
      await store.save({ section: "security.access", title: `Workspace access review ${new Date().toISOString().slice(0, 10)}`, status: "Done",
        data: { system: "AGRON Workspace", owner: me.full_name || me.email, due: new Date().toISOString().slice(0, 10), notes: `${rows.length} accounts reviewed, ${flagged.length} with notes:\n${flagged.map((r) => `- ${r.email} (${r.role}): ${r.flags.join("; ")}`).join("\n")}` } });
      toast(T(L("Review saved in Access reviews", "Проверка сохранена в «Проверки доступов»", "Перевірку збережено в «Перевірки доступів»", "حُفظت المراجعة")));
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="card hub-card wide">
      <div className="card-h"><h2><Icon n="key" />{T(L("Workspace access review", "Проверка доступов к Workspace", "Перевірка доступів до Workspace", "مراجعة صلاحيات مساحة العمل"))}</h2>
        <span className="toolbar" style={{ marginInlineStart: "auto" }}><button className="btn sm" disabled={busy} onClick={load}><Icon n="refresh" />{busy ? "…" : T(L("Load accounts", "Загрузить аккаунты", "Завантажити акаунти", "تحميل الحسابات"))}</button>
          {rows && <button className="btn primary sm" onClick={record}><Icon n="check" />{T(L("Record the review", "Записать проверку", "Записати перевірку", "سجّل المراجعة"))}</button>}</span></div>
      <div className="card-b">{!rows ? <small className="faint">{T(L("Every account with role, US-person status and last sign-in. Flags: never signed in, inactive 60+ days, external, waiting for a role. Do it every quarter.", "Все аккаунты с ролью, статусом US person и последним входом. Отметки: не входил, неактивен 60+ дней, внешний, ждёт роль. Делайте раз в квартал.", "Усі акаунти з роллю, статусом US person і останнім входом. Позначки: не входив, неактивний 60+ днів, зовнішній, чекає на роль. Робіть раз на квартал.", "كل الحسابات مع الدور وحالة الشخص الأمريكي وآخر دخول. افعل ذلك كل ربع سنة."))}</small>
        : <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("Email", "Почта", "Пошта", "البريد"))}</th><th>{T(L("Role", "Роль", "Роль", "الدور"))}</th><th>US</th><th>{T(L("Last sign-in", "Последний вход", "Останній вхід", "آخر دخول"))}</th><th>{T(L("Notes", "Отметки", "Позначки", "ملاحظات"))}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.email}><td>{r.email}<br /><small className="faint">{r.name}{r.company ? ` · ${r.company}` : ""}</small></td><td>{r.role}</td><td>{r.us_person ? "✓" : "—"}</td><td className="mono">{r.last_sign_in ? r.last_sign_in.slice(0, 10) : "—"}</td>
            <td>{r.flags.map((f) => <span key={f} className="chip c-warn" style={{ margin: 2 }}>{f}</span>)}</td></tr>)}</tbody></table></div>}</div>
    </div>
  );
}

/* ---------------- Quick external actions inside a record ---------------- */
export function RecordTools({ section, data, setData, canWrite }: { section: any; data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void; canWrite: boolean }) {
  const T = useT(); const { toast } = useApp();
  const [scr, setScr] = useState<any>(null); const [busy, setBusy] = useState(false);
  const links: { href: string; label: string }[] = [];
  const tr = trackUrl(data.carrier, data.tracking); if (tr) links.push({ href: tr, label: T(L(`Track with ${data.carrier}`, `Отследить в ${data.carrier}`, `Відстежити в ${data.carrier}`, `تتبع عبر ${data.carrier}`)) });
  if (section.id === "legal.trademarks" && data.office === "USPTO" && usptoUrl(data.number)) links.push({ href: usptoUrl(data.number), label: T(L("Status at USPTO", "Статус в USPTO", "Статус в USPTO", "الحالة لدى USPTO")) });
  const imo = String(data.imo || "").replace(/\D/g, "");
  if (/^\d{7}$/.test(imo)) { links.push({ href: `https://www.marinetraffic.com/en/ais/details/ships/imo:${imo}`, label: "MarineTraffic" }); links.push({ href: "https://www.equasis.org/", label: "Equasis" }); }
  const isScreen = section.id === "security.screening";
  if (isScreen) links.push({ href: "https://sanctionssearch.ofac.treas.gov/", label: "OFAC" }, { href: "https://www.trade.gov/data-visualization/csl-search", label: "CSL" }, { href: "https://www.sanctionsmap.eu/", label: "EU" }, { href: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", label: "UN" });
  if (!links.length && !isScreen) return null;
  const screen = async () => {
    if (DEMO) { toast("Demo", true); return; }
    setBusy(true); try { setScr(await post("/api/security", { action: "screen", name: data.party || "", country: data.country || "" })); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const saveResult = () => {
    if (!scr?.configured) return;
    const lines = scr.hits.length ? scr.hits.map((h: any) => `- ${h.name} — ${h.source}${h.programs ? ` (${h.programs})` : ""}${h.countries ? `, ${h.countries}` : ""}${h.score != null ? `, score ${h.score}` : ""}`).join("\n") : "No matches.";
    setData((d) => ({ ...d, date: new Date().toISOString().slice(0, 10), lists: "US Consolidated Screening List (fuzzy name)", result: `${new Date().toISOString().slice(0, 10)} · CSL: ${scr.total} result(s) for “${data.party}”\n${lines}\n\nDecision by a person: Cleared only after reviewing every result.` }));
    toast(T(L("Result inserted — set the status and Save", "Результат вставлен — выберите статус и сохраните", "Результат вставлено — виберіть статус і збережіть", "أُدرجت النتيجة — اختر الحالة واحفظ")));
  };
  return (
    <section className="appr">
      <div className="appr-h"><Icon n={isScreen ? "search" : "ext"} /><b>{isScreen ? T(L("Screening", "Проверка по санкционным спискам", "Перевірка за санкційними списками", "الفحص")) : T(L("Quick links", "Быстрые ссылки", "Швидкі посилання", "روابط سريعة"))}</b></div>
      {isScreen && <div className="toolbar"><button className="btn primary sm" disabled={busy || !data.party} onClick={screen}><Icon n="search" />{busy ? "…" : T(L("Screen now (US lists)", "Проверить сейчас (списки США)", "Перевірити зараз (списки США)", "افحص الآن (قوائم أمريكية)"))}</button>
        {!data.party && <small className="faint">{T(L("Fill in the party name first", "Сначала укажите название стороны", "Спочатку вкажіть назву сторони", "أدخل اسم الطرف أولاً"))}</small>}</div>}
      {scr && !scr.configured && <p className="appr-p faint">{T(L("Automatic screening needs a free CSL key (developer.trade.gov) saved in Vercel as CSL_API_KEY. Until then use the official searches below and paste the result.", "Для автоматической проверки нужен бесплатный ключ CSL (developer.trade.gov) в Vercel как CSL_API_KEY. Пока — используйте официальные поиски ниже и вставьте результат.", "Для автоматичної перевірки потрібен безкоштовний ключ CSL (developer.trade.gov) у Vercel як CSL_API_KEY. Поки що — використовуйте офіційні пошуки нижче й вставте результат.", "يتطلب الفحص التلقائي مفتاح CSL مجانياً في Vercel باسم CSL_API_KEY. حتى ذلك استخدم البحث الرسمي أدناه."))}</p>}
      {scr?.configured && <div className="mkt-res" style={{ maxHeight: 280 }}>
        <b>{scr.total ? `${scr.total} ${T(L("possible matches — review each one", "возможных совпадений — проверьте каждое", "можливих збігів — перевірте кожен", "تطابقات محتملة — راجع كلاً منها"))}` : T(L("No matches on the US Consolidated Screening List", "Совпадений в сводном списке США нет", "Збігів у зведеному списку США немає", "لا تطابقات في القائمة الأمريكية الموحدة"))}</b>
        {scr.hits.map((h: any, i: number) => <div key={i} className="hub-row"><span><b>{h.name}</b><small>{h.source}{h.programs ? ` · ${h.programs}` : ""}{h.countries ? ` · ${h.countries}` : ""}</small></span>{h.score != null && <span className="chip">{h.score}</span>}</div>)}
        {canWrite && <div className="toolbar"><button className="btn sm" onClick={saveResult}><Icon n="check" />{T(L("Put the result into the record", "Вставить результат в запись", "Вставити результат у запис", "أدرج النتيجة في السجل"))}</button></div>}
      </div>}
      <div className="toolbar">{links.map((l) => <a key={l.href} className="btn ghost sm" href={l.href} target="_blank" rel="noopener noreferrer"><Icon n="ext" />{l.label}</a>)}</div>
    </section>
  );
}

/* ---------------- Access log for export-controlled data ---------------- */
export function AccessLog() {
  const T = useT(); const { access, me } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const can = ["owner", "admin"].includes(me.role) || access.read.has("security.tcp");
  useEffect(() => { if (can && !DEMO) store.activity({ log: true, limit: 60 }).then(setRows).catch(() => setRows([])); else setRows([]); }, []); // eslint-disable-line
  if (!can || !rows) return null;
  const people = new Set(rows.map((r) => r.actor)).size;
  return (
    <div className="card hub-card wide">
      <div className="card-h"><h2><Icon n="lock" />{T(L("Who opened export-controlled data", "Кто открывал данные под экспортным контролем", "Хто відкривав дані під експортним контролем", "من فتح البيانات الخاضعة للرقابة"))}</h2>
        <span className="faint" style={{ fontSize: 13 }}>{T(L("Technology control plan log: every view of a controlled record or file", "Журнал плана контроля технологий: каждый просмотр контролируемой записи или файла", "Журнал плану контролю технологій: кожен перегляд контрольованого запису або файлу", "سجل خطة الرقابة التقنية"))} · {rows.length} / {people}</span></div>
      <div className="card-b">{!rows.length ? <div className="empty" style={{ padding: 14 }}>{T(L("No views yet. Opening any record marked US persons only is logged here.", "Просмотров пока нет. Здесь записывается открытие любой записи с пометкой «только US persons».", "Переглядів поки немає. Тут записується відкриття будь-якого запису з позначкою «лише US persons».", "لا مشاهدات بعد."))}</div>
        : <div className="tablewrap"><table className="tb"><thead><tr><th>{T(L("When", "Когда", "Коли", "متى"))}</th><th>{T(L("Who", "Кто", "Хто", "من"))}</th><th>{T(L("What", "Что", "Що", "ماذا"))}</th><th>US</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="mono" style={{ whiteSpace: "nowrap" }}>{String(r.created_at).slice(0, 16).replace("T", " ")}</td><td>{r.detail?.name || r.detail?.email}<br /><small className="faint">{r.detail?.role}</small></td>
            <td><Link href={`/${String(r.detail?.section || "").replace(".", "/")}?r=${r.record_id}`}>{r.detail?.title}</Link>{r.detail?.file ? <><br /><small className="faint">{r.detail.file}</small></> : null}</td>
            <td>{r.detail?.us_person ? "✓" : <span className="chip c-bad">no</span>}</td></tr>)}</tbody></table></div>}</div>
    </div>
  );
}
