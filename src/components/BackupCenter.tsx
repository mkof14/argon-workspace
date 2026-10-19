"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/store";
import { saveBlob } from "@/lib/format";
import { makeZip, readZip } from "@/lib/zip";
import { decryptBytes, encryptBytes, gunzip, isEncrypted, isGzip, isZip } from "@/lib/backupCrypto";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Status = { backup: any; monitor: any; reports: any; drill: any; backups: { name: string; bytes: number; created_at: string; verified?: boolean; files?: number; offsite?: boolean }[]; passphrase: boolean; offsite: boolean; target: string; csl: boolean; youtube: boolean };
const kb = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (s?: string) => (s ? s.slice(0, 16).replace("T", " ") + " UTC" : "—");

/** Administration → System: automatic backups, local copy with files, opening and restoring a backup, monitoring and monthly reports. */
export default function BackupCenter() {
  const { lang, me, toast } = useApp();
  const T = (x: T4) => tx(x, lang as Lang);
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [files, setFiles] = useState(true); const [pw, setPw] = useState(""); const [prog, setProg] = useState("");
  const [opened, setOpened] = useState<{ name: string; data: any; files: number } | null>(null); const [opw, setOpw] = useState(""); const [needPw, setNeedPw] = useState(false);
  const pick = useRef<HTMLInputElement>(null); const pending = useRef<Uint8Array | null>(null); const pendingName = useRef("");
  const owner = me.role === "owner";
  const api = async (body: any) => { const r = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r; };
  const load = () => { if (!DEMO) api({ action: "status" }).then((r) => r.json()).then(setSt).catch(() => {}); };
  useEffect(load, []); // eslint-disable-line
  const run = async (action: string, extra: any = {}, done?: (j: any) => string) => {
    if (DEMO) { toast(T(L("Works on the live site.", "Работает на живом сайте.", "Працює на живому сайті.", "يعمل على الموقع الحي.")), true); return; }
    setBusy(action); try { const j = await (await api({ action, ...extra })).json(); toast(done ? done(j) : "OK"); load(); } catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };

  // Local copy: data from the server + every file downloaded in the browser, packed into one ZIP, optionally encrypted
  const localCopy = async () => {
    if (DEMO) { toast(T(L("Works on the live site.", "Работает на живом сайте.", "Працює на живому сайті.", "يعمل على الموقع الحي.")), true); return; }
    if (pw && pw.length < 8) { toast(T(L("Password: at least 8 characters", "Пароль: не меньше 8 символов", "Пароль: щонайменше 8 символів", "كلمة المرور: 8 أحرف على الأقل")), true); return; }
    setBusy("local");
    try {
      setProg(T(L("Collecting data…", "Собираю данные…", "Збираю дані…", "جمع البيانات…")));
      const gz = new Uint8Array(await (await api({ action: "data" })).arrayBuffer());
      const json = await gunzip(gz); const data = JSON.parse(new TextDecoder().decode(json));
      const entries: { name: string; data: Uint8Array }[] = [{ name: "data.json", data: json }];
      let fileCount = 0, failed = 0;
      if (files) {
        const list: { path: string; size: number; url: string }[] = await (await api({ action: "files" })).json();
        for (let i = 0; i < list.length; i++) {
          setProg(`${T(L("Files", "Файлы", "Файли", "الملفات"))} ${i + 1} / ${list.length}`);
          try { const b = await fetch(list[i].url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())); entries.push({ name: `files/${list[i].path}`, data: new Uint8Array(b) }); fileCount++; } catch { failed++; }
        }
      }
      const readme = `AGRON Workspace backup\nCreated: ${data.created_at}\nRecords: ${data.counts?.records} · Comments: ${data.counts?.comments} · People: ${data.counts?.profiles}\nFiles: ${fileCount}${failed ? ` (${failed} could not be downloaded)` : ""}\nExport-controlled records included: ${data.controlled_included ? "yes — US persons only, keep on a protected device" : "no"}\n\ndata.json — all Workspace data (records, comments, activity, FAQ, access rules, approvals, people).\nfiles/<section>/<record id>/<file> — attached files.\nOpen or restore: Workspace → Administration → System → Backup → Open a backup.\n`;
      entries.unshift({ name: "README.txt", data: new TextEncoder().encode(readme) });
      setProg(T(L("Packing…", "Упаковываю…", "Пакую…", "جارٍ الحزم…")));
      let out = makeZip(entries); const day = new Date().toISOString().slice(0, 10);
      if (pw) out = await encryptBytes(out, pw);
      saveBlob(`AGRON_Workspace_backup_${day}${pw ? ".agronbackup" : ".zip"}`, out as BlobPart, "application/octet-stream");
      toast(`${T(L("Backup saved", "Копия сохранена", "Копію збережено", "حُفظت النسخة"))}: ${data.counts?.records} / ${fileCount} · ${kb(out.length)}`);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(""); setProg(""); }
  };

  // Opening a backup: .zip, .agronbackup (zip or gzip inside), .json.gz or the older .json export
  const openBytes = async (b: Uint8Array, name: string, password?: string) => {
    let x = b;
    if (isEncrypted(x)) { if (!password) { pending.current = b; pendingName.current = name; setOpened(null); setOpw(""); setNeedPw(true); toast(T(L("Enter the backup password", "Введите пароль копии", "Введіть пароль копії", "أدخل كلمة مرور النسخة"))); return; } x = await decryptBytes(x, password); }
    let data: any; let nFiles = 0;
    if (isZip(x)) { const z = readZip(x); data = JSON.parse(new TextDecoder().decode(z["data.json"])); nFiles = Object.keys(z).filter((k) => k.startsWith("files/")).length; }
    else data = JSON.parse(new TextDecoder().decode(isGzip(x) ? await gunzip(x) : x));
    if (!Array.isArray(data?.records)) throw new Error(T(L("This file has no Workspace records", "В файле нет записей Workspace", "У файлі немає записів Workspace", "لا سجلات في الملف")));
    pending.current = null; setNeedPw(false); setOpened({ name, data, files: nFiles });
  };
  const onFile = async (f: File) => { try { await openBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e: any) { toast(e.message, true); } };
  const restore = async () => {
    if (!opened) return; setBusy("restore");
    try {
      const recs = opened.data.records as any[]; const cms = (opened.data.comments || []) as any[]; let added = 0, addedC = 0;
      for (let i = 0; i < recs.length; i += 400) { const j = await (await api({ action: "restore", records: recs.slice(i, i + 400), comments: [] })).json(); added += j.added; }
      for (let i = 0; i < cms.length; i += 1500) { const j = await (await api({ action: "restore", records: [], comments: cms.slice(i, i + 1500) })).json(); addedC += j.comments; }
      toast(`${T(L("Restored", "Восстановлено", "Відновлено", "استُعيد"))}: ${added} ${T(L("records", "записей", "записів", "سجلات"))}, ${addedC} ${T(L("comments", "комментариев", "коментарів", "تعليقات"))}`);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };
  const bySection = opened ? Object.entries((opened.data.records as any[]).reduce((a: any, r) => { const d = r.section.split(".")[0]; a[d] = (a[d] || 0) + 1; return a; }, {})).sort((a: any, b: any) => b[1] - a[1]) : [];

  return (
    <section className="card">
      <div className="card-h"><h2><Icon n="download" />{T(L("Backups, monitoring and monthly reports", "Резервные копии, мониторинг и ежемесячные отчёты", "Резервні копії, моніторинг і щомісячні звіти", "النسخ الاحتياطي والمراقبة والتقارير الشهرية"))}</h2></div>
      <div className="card-b bk">
        {/* Automatic */}
        <div className="bk-box">
          <b>{T(L("Automatic backup — every day", "Автоматическая копия — каждый день", "Автоматична копія — щодня", "نسخ تلقائي — يومياً"))}</b>
          <p className="faint">{T(L("Every day at 09:00 UTC all data and every attached file are encrypted with the backup password and stored outside Workspace. Each copy is read back and checked before it counts. Kept: 14 daily, 8 weekly, 12 monthly copies. Without the backup password nothing is written.", "Каждый день в 09:00 UTC все данные и все вложенные файлы шифруются паролем копий и сохраняются вне Workspace. Каждая копия читается обратно и проверяется. Хранятся: 14 ежедневных, 8 недельных, 12 месячных копий. Без пароля копий ничего не записывается.", "Щодня о 09:00 UTC усі дані та всі вкладені файли шифруються паролем копій і зберігаються поза Workspace. Кожна копія зчитується назад і перевіряється. Зберігаються: 14 щоденних, 8 тижневих, 12 місячних копій. Без пароля копій нічого не записується.", "يومياً في 09:00 UTC تُشفَّر كل البيانات والملفات بكلمة مرور النسخ وتُحفظ خارج مساحة العمل. تُقرأ كل نسخة وتُفحص. تُحفظ 14 يومية و8 أسبوعية و12 شهرية. بلا كلمة مرور لا يُكتب شيء."))}</p>
          {st && <div className="toolbar">
            <span className={`chip ${st.passphrase ? "c-ok" : "c-bad"}`}>{st.passphrase ? T(L("Encrypted", "Шифруется", "Шифрується", "مشفّرة")) : T(L("Off: no backup password", "Выключено: нет пароля копий", "Вимкнено: немає пароля копій", "متوقف: لا كلمة مرور"))}</span>
            <span className={`chip ${st.offsite ? "c-ok" : "c-warn"}`}>{st.offsite ? T(L("Off-site store", "Вне проекта", "Поза проєктом", "خارج المشروع")) : T(L("Not off-site yet", "Пока не вне проекта", "Поки не поза проєктом", "ليست خارج المشروع بعد"))}</span>
            <span className="faint" style={{ fontSize: 13 }}>{T(L("Last", "Последняя", "Остання", "الأخيرة"))}: {when(st.backup?.at)}{st.backup ? ` · ${st.backup.counts?.records} ${T(L("records", "записей", "записів", "سجلات"))} · ${st.backup.files ?? 0} ${T(L("files", "файлов", "файлів", "ملفات"))}${st.backup.verified ? ` · ${T(L("checked", "проверена", "перевірена", "مفحوصة"))}` : ""}` : ""}</span></div>}
          {st?.drill && <small className="faint">{T(L("Last restore drill", "Последняя проверка восстановления", "Остання перевірка відновлення", "آخر اختبار استعادة"))}: {when(st.drill.at)} · {Math.round((st.drill.ms || 0) / 1000)} s</small>}
          {st?.backups?.length ? <div className="feed">{st.backups.map((b) => <div key={b.name} className="hub-row"><span className="mono" style={{ fontSize: 13 }}>{b.name.replace(/^db\//, "")}</span>
            <span className="toolbar">{b.verified && <Icon n="check" />}<small className="faint">{kb(b.bytes)}{b.files ? ` · ${b.files} ${T(L("files", "файлов", "файлів", "ملفات"))}` : ""}</small>{owner && <button className="btn ghost sm" aria-label="Download" onClick={async () => { try { const j = await (await api({ action: "link", name: b.name })).json(); window.open(j.url, "_blank", "noopener"); } catch (e: any) { toast(e.message, true); } }}><Icon n="download" /></button>}</span></div>)}</div> : null}
          {owner && <div className="toolbar"><button className="btn sm" disabled={!!busy} onClick={() => run("backup", {}, (j) => j.status === "completed" ? `${String(j.result?.name || "").replace(/^db\//, "")} · ${kb(j.result?.bytes || 0)}` : j.status === "partial" ? T(L("Files are still being copied — continues on the next run", "Файлы ещё копируются — продолжится при следующем запуске", "Файли ще копіюються — продовжиться під час наступного запуску", "ما زالت الملفات تُنسخ — يُستكمل لاحقاً")) : `${j.status}: ${j.error || j.reason || ""}`)}><Icon n="refresh" />{busy === "backup" ? "…" : T(L("Back up now", "Сделать копию сейчас", "Зробити копію зараз", "انسخ الآن"))}</button></div>}
        </div>

        {/* Local copy */}
        {owner && <div className="bk-box">
          <b>{T(L("Local copy on this computer", "Локальная копия на этот компьютер", "Локальна копія на цей комп'ютер", "نسخة محلية على هذا الحاسوب"))}</b>
          <p className="faint">{T(L("One ZIP file with all data and, if chosen, every attached file. With a password the file is encrypted (.agronbackup) — keep the password separately; without it the copy cannot be opened.", "Один ZIP-файл со всеми данными и, если отмечено, всеми вложенными файлами. С паролем файл шифруется (.agronbackup) — храните пароль отдельно: без него копию не открыть.", "Один ZIP-файл з усіма даними та, якщо позначено, усіма вкладеними файлами. З паролем файл шифрується (.agronbackup) — зберігайте пароль окремо: без нього копію не відкрити.", "ملف ZIP واحد بكل البيانات والملفات المرفقة اختيارياً. مع كلمة مرور يُشفّر الملف — احفظ كلمة المرور منفصلة."))}</p>
          <label className="check"><input type="checkbox" checked={files} onChange={(e) => setFiles(e.target.checked)} />{T(L("Include attached files", "Включить вложенные файлы", "Включити вкладені файли", "تضمين الملفات المرفقة"))}</label>
          <input className="input" type="password" autoComplete="new-password" placeholder={T(L("Password to encrypt (optional, 8+ characters)", "Пароль для шифрования (необязательно, от 8 символов)", "Пароль для шифрування (необов'язково, від 8 символів)", "كلمة مرور للتشفير (اختياري)"))} value={pw} onChange={(e) => setPw(e.target.value)} />
          <div className="toolbar"><button className="btn primary sm" disabled={!!busy} onClick={localCopy}><Icon n="download" />{busy === "local" ? prog || "…" : T(L("Download the copy", "Скачать копию", "Завантажити копію", "نزّل النسخة"))}</button></div>
          {me.us_person && <small className="faint">{T(L("Includes export-controlled records: store it only on a protected device that US persons use.", "Включает записи под экспортным контролем: храните только на защищённом устройстве, которым пользуются US persons.", "Містить записи під експортним контролем: зберігайте лише на захищеному пристрої, яким користуються US persons.", "تتضمن سجلات خاضعة للرقابة: احفظها على جهاز محمي فقط."))}</small>}
        </div>}

        {/* Open / restore */}
        {owner && <div className="bk-box">
          <b>{T(L("Open or restore a backup", "Открыть или восстановить копию", "Відкрити або відновити копію", "فتح نسخة أو استعادتها"))}</b>
          <p className="faint">{T(L("Choose a .zip, .agronbackup or .json.gz file. Restore puts back only records and comments that no longer exist; nothing is overwritten.", "Выберите файл .zip, .agronbackup или .json.gz. Восстановление возвращает только записи и комментарии, которых больше нет; ничего не перезаписывается.", "Виберіть файл .zip, .agronbackup або .json.gz. Відновлення повертає лише записи й коментарі, яких більше немає; нічого не перезаписується.", "اختر ملف النسخة. الاستعادة تعيد السجلات المحذوفة فقط دون الكتابة فوق شيء."))}</p>
          <input ref={pick} type="file" hidden accept=".zip,.agronbackup,.gz,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <div className="toolbar"><button className="btn sm" onClick={() => pick.current?.click()}><Icon n="upload" />{T(L("Choose file", "Выбрать файл", "Вибрати файл", "اختر ملفاً"))}</button></div>
          {needPw && !opened && <div className="toolbar" style={{ flexWrap: "nowrap" }}><input className="input" type="password" value={opw} onChange={(e) => setOpw(e.target.value)} placeholder={T(L("Backup password", "Пароль копии", "Пароль копії", "كلمة مرور النسخة"))} />
            <button className="btn primary sm" onClick={async () => { try { await openBytes(pending.current!, pendingName.current, opw); } catch (e: any) { toast(e.message, true); } }}>{T(L("Open", "Открыть", "Відкрити", "فتح"))}</button></div>}
          {opened && <div className="mkt-res">
            <b>{opened.name} · {when(opened.data.created_at)}</b>
            <small className="faint">{opened.data.records.length} {T(L("records", "записей", "записів", "سجلات"))} · {(opened.data.comments || []).length} {T(L("comments", "комментариев", "коментарів", "تعليقات"))} · {opened.files} {T(L("files", "файлов", "файлів", "ملفات"))}</small>
            <div className="toolbar">{bySection.map(([d, n]) => <span key={d} className="chip">{d} {n as number}</span>)}</div>
            <div className="toolbar"><button className="btn primary sm" disabled={!!busy} onClick={restore}><Icon n="refresh" />{busy === "restore" ? "…" : T(L("Restore missing records", "Восстановить недостающие записи", "Відновити відсутні записи", "استعد السجلات الناقصة"))}</button>
              <button className="btn ghost sm" onClick={() => setOpened(null)}>{T(L("Close", "Закрыть", "Закрити", "إغلاق"))}</button></div>
          </div>}
        </div>}

        {/* Monitoring and reports */}
        <div className="bk-box">
          <b>{T(L("Monitoring — every day", "Мониторинг — каждый день", "Моніторинг — щодня", "المراقبة — يومياً"))}</b>
          <p className="faint">{T(L("At 10:00 UTC all systems and the domains agron1.com, stardome.life and workspace.agron1.com are checked. Owners, administrators and security get an email only when something breaks or changes.", "В 10:00 UTC проверяются все системы и домены agron1.com, stardome.life и workspace.agron1.com. Владельцы, администраторы и безопасность получают письмо только когда что-то сломалось или изменилось.", "О 10:00 UTC перевіряються всі системи та домени agron1.com, stardome.life і workspace.agron1.com. Власники, адміністратори й безпека отримують лист лише коли щось зламалося або змінилося.", "في 10:00 UTC تُفحص كل الأنظمة والنطاقات. يصل بريد فقط عند حدوث مشكلة أو تغيير."))}</p>
          {st?.monitor && <><span className={`chip ${st.monitor.problems?.length ? "c-warn" : "c-ok"}`}>{st.monitor.problems?.length ? `${st.monitor.problems.length} ${T(L("issues", "проблем", "проблем", "مشكلات"))}` : T(L("All fine", "Всё в порядке", "Усе гаразд", "كل شيء جيد"))} · {when(st.monitor.at)}</span>
            {st.monitor.problems?.length ? <ul className="bk-list">{st.monitor.problems.slice(0, 8).map((p: any, i: number) => <li key={i}><b>{p.what}</b> — {p.detail}</li>)}</ul> : null}</>}
          {owner && <div className="toolbar"><button className="btn sm" disabled={!!busy} onClick={() => run("monitor", { email: true }, (j) => `${j.result?.problems ?? j.status} · email ${j.result?.emailed ?? 0}`)}><Icon n="pulse" />{busy === "monitor" ? "…" : T(L("Check now and email me", "Проверить сейчас и прислать письмо", "Перевірити зараз і надіслати лист", "افحص الآن وأرسل بريداً"))}</button></div>}
          <b style={{ marginTop: 8 }}>{T(L("Monthly reports — on the 1st", "Ежемесячные отчёты — 1-го числа", "Щомісячні звіти — 1-го числа", "التقارير الشهرية — يوم 1"))}</b>
          <p className="faint">{T(L("Owners, administrators and management get one email with every department's report for the past month (records not under export control).", "Владельцы, администраторы и руководство получают одно письмо с отчётами всех департаментов за прошлый месяц (без записей под экспортным контролем).", "Власники, адміністратори та керівництво отримують один лист зі звітами всіх департаментів за минулий місяць (без записів під експортним контролем).", "يتلقى المالكون والإدارة بريداً واحداً بتقارير كل الأقسام للشهر الماضي."))}</p>
          {st?.reports && <small className="faint">{T(L("Last sent", "Последний раз", "Останній раз", "آخر إرسال"))}: {st.reports.period} · {when(st.reports.at)} · {st.reports.sent}</small>}
          {owner && <div className="toolbar"><button className="btn sm" disabled={!!busy} onClick={() => run("reports", {}, (j) => `${j.result?.period ?? j.status} · ${j.result?.sent ?? ""}`)}><Icon n="mail" />{busy === "reports" ? "…" : T(L("Send last month's report now", "Отправить отчёт за прошлый месяц сейчас", "Надіслати звіт за минулий місяць зараз", "أرسل تقرير الشهر الماضي الآن"))}</button></div>}
        </div>
      </div>
    </section>
  );
}
