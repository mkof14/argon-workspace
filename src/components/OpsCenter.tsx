"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const when = (s?: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "—");
const api = async (b: any) => { const r = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const JOB: Record<string, T4> = {
  notify: L("Notifications by e-mail and phone", "Уведомления на почту и телефон", "Сповіщення поштою й на телефон", "الإشعارات بالبريد والهاتف"),
  due: L("Deadline reminders", "Напоминания о сроках", "Нагадування про терміни", "تذكيرات المواعيد"),
  retry: L("Automation retries and delivery checks", "Повторы автоматизации и проверка доставки", "Повтори автоматизації та перевірка доставки", "إعادة محاولات الأتمتة وفحص التسليم"),
  intake: L("E-mail intake", "Приём почты", "Приймання пошти", "استلام البريد"),
  sla: L("Service SLA alerts", "Сигналы SLA сервиса", "Сигнали SLA сервісу", "تنبيهات SLA"),
  calendar: L("Google Calendar sync", "Синхронизация Google Календаря", "Синхронізація Google Календаря", "مزامنة تقويم Google"),
  digest: L("Morning digest", "Утренняя сводка", "Ранкове зведення", "الملخص الصباحي"),
  translate: L("Translation of new texts", "Перевод новых текстов", "Переклад нових текстів", "ترجمة النصوص الجديدة"),
  backup: L("Encrypted backup", "Зашифрованная копия", "Зашифрована копія", "نسخة مشفرة"),
  agents: L("Agents", "Агенты", "Агенти", "الوكلاء"),
  monitor: L("Monitoring", "Мониторинг", "Моніторинг", "المراقبة"),
  trash: L("Recycle bin and housekeeping", "Корзина и уборка", "Кошик і прибирання", "سلة المحذوفات والتنظيف"),
  reports: L("Monthly reports", "Ежемесячные отчёты", "Щомісячні звіти", "التقارير الشهرية"),
};
const ST: Record<string, [T4, string]> = {
  completed: [L("Done", "Готово", "Готово", "تم"), "c-ok"], running: [L("Running", "Идёт", "Триває", "قيد التشغيل"), "c-info"], failed: [L("Failed", "Ошибка", "Помилка", "فشل"), "c-bad"],
  timeout: [L("Stopped", "Прервано", "Перервано", "توقف"), "c-bad"], dead: [L("Gave up", "Остановлено", "Зупинено", "توقف نهائياً"), "c-bad"],
};

/** Administration → System → Operations: every scheduled job, failed and stopped work, e-mails to check, backups — without server logs. */
export default function OpsCenter() {
  const { lang, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [d, setD] = useState<any>(null); const [busy, setBusy] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const load = () => { if (!DEMO) api({ action: "ops" }).then(setD).catch((e) => toast(e.message, true)); };
  useEffect(load, []); // eslint-disable-line
  const act = async (key: string, b: any, msg?: (j: any) => string) => { setBusy(key); try { const j = await api(b); toast(msg ? msg(j) : T(L("Done", "Готово", "Готово", "تم"))); load(); } catch (e: any) { toast(e.message, true); } finally { setBusy(""); } };
  if (DEMO) return <section className="card"><div className="card-b faint">{T(L("Works on the live site.", "Работает на живом сайте.", "Працює на живому сайті.", "يعمل على الموقع الحي."))}</div></section>;
  if (!d) return <section className="card"><div className="card-b faint">…</div></section>;
  const problems: any[] = d.problems || [];
  return <div style={{ display: "grid", gap: 16 }}>
    <section className="card">
      <div className="card-h toolbar"><h2><Icon n="pulse" />{T(L("Operations", "Операции", "Операції", "العمليات"))}</h2>
        <span className={`chip ${problems.some((p) => p.level === "fail") ? "c-bad" : problems.length ? "c-warn" : "c-ok"}`} style={{ marginInlineStart: "auto" }}>{problems.length ? `${problems.length} ${T(L("to look at", "требуют внимания", "потребують уваги", "تحتاج انتباهاً"))}` : T(L("All in order", "Всё в порядке", "Усе гаразд", "كل شيء سليم"))}</span>
        <button className="btn ghost sm" onClick={load}><Icon n="refresh" />{T(L("Refresh", "Обновить", "Оновити", "تحديث"))}</button></div>
      {problems.length > 0 && <ul className="bk-list" style={{ margin: "0 20px 14px" }}>{problems.map((p, i) => <li key={i}><b style={{ color: p.level === "fail" ? "var(--bad)" : "var(--warn)" }}>{p.what}</b> — {p.detail}</li>)}</ul>}
      {!d.frequent_trigger && <p className="faint" style={{ margin: "0 20px 14px", fontSize: 13.5 }}>{T(L("Frequent jobs run once a day until the 15-minute trigger is on (repository secret CRON_SECRET in GitHub).", "Частые задачи выполняются раз в день, пока не включён 15-минутный запуск (секрет CRON_SECRET в GitHub).", "Часті задачі виконуються раз на день, доки не ввімкнено 15-хвилинний запуск (секрет CRON_SECRET у GitHub).", "تعمل المهام المتكررة مرة يومياً حتى يُفعّل التشغيل كل 15 دقيقة (CRON_SECRET في GitHub)."))}</p>}
      <div className="tablewrap"><table className="tb"><thead><tr>
        <th>{T(L("Job", "Задача", "Задача", "المهمة"))}</th><th>{T(L("Last run", "Последний запуск", "Останній запуск", "آخر تشغيل"))}</th><th>{T(L("Last success", "Последний успех", "Останній успіх", "آخر نجاح"))}</th><th>{T(L("Failures 24 h", "Ошибок за 24 ч", "Помилок за 24 год", "إخفاقات 24 س"))}</th><th /></tr></thead>
        <tbody>{(d.jobs || []).map((j: any) => { const st = j.last ? ST[j.last.status] : null; return <tr key={j.job}>
          <td><b>{T(JOB[j.job] || L(j.label, j.label, j.label, j.label))}</b>{j.dead?.length ? <><br /><small style={{ color: "var(--bad)" }}>{T(L("Stopped trying", "Попытки прекращены", "Спроби припинено", "توقفت المحاولات"))}: {j.dead[0].slot}</small></> : null}</td>
          <td>{j.last ? <><span className={`chip ${st?.[1] || ""}`}>{st ? T(st[0]) : j.last.status}</span> <small className="faint">{when(j.last.started_at)}{j.last.duration_ms != null ? ` · ${(j.last.duration_ms / 1000).toFixed(1)} s` : ""}</small>
            {j.last.error && <><br /><button className="linkbtn" onClick={() => setOpen(open === j.job ? null : j.job)}>{open === j.job ? T(L("Hide", "Скрыть", "Сховати", "إخفاء")) : T(L("Error", "Ошибка", "Помилка", "الخطأ"))}</button>{open === j.job && <pre className="mono sys-stack">{j.last.error}</pre>}</>}</> : <span className="faint">{T(L("Not run yet", "Ещё не запускалась", "Ще не запускалася", "لم تعمل بعد"))}</span>}</td>
          <td><small>{when(j.last_ok)}</small></td>
          <td>{j.failures_24h ? <span className="chip c-warn">{j.failures_24h}</span> : <span className="faint">0</span>}</td>
          <td><div className="toolbar" style={{ justifyContent: "flex-end", gap: 6 }}>
            {j.dead?.length > 0 && <button className="btn ghost sm" disabled={!!busy} onClick={() => act(`v${j.job}`, { action: "revive", job: j.job, slot: j.dead[0].slot })}>{T(L("Allow again", "Разрешить снова", "Дозволити знову", "السماح مجدداً"))}</button>}
            <button className="btn sm" disabled={!!busy} onClick={() => act(`j${j.job}`, { action: "run", job: j.job }, (x) => `${T(JOB[j.job] || L(j.job, j.job, j.job, j.job))}: ${x.status}${x.error ? ` — ${x.error}` : x.reason ? ` (${x.reason})` : ""}`)}><Icon n="play" />{busy === `j${j.job}` ? "…" : T(L("Run now", "Запустить", "Запустити", "تشغيل الآن"))}</button>
          </div></td></tr>; })}</tbody></table></div>
    </section>

    <section className="card">
      <div className="card-h"><h2><Icon n="alert" />{T(L("Automatic actions that need you", "Автоматические действия, которым нужны вы", "Автоматичні дії, яким потрібні ви", "إجراءات تلقائية تحتاجك"))}</h2></div>
      <div className="card-b" style={{ display: "grid", gap: 10 }}>
        <p className="faint" style={{ margin: 0 }}>{T(L("A failed action is tried again up to 5 times with growing pauses (1, 4, 16, 64 minutes…). After that it stops here and waits for a person. Nothing is repeated twice: each action runs once even when retried.", "Неудачное действие повторяется до 5 раз с растущими паузами (1, 4, 16, 64 минуты…). Потом оно останавливается здесь и ждёт человека. Ничего не выполняется дважды: каждое действие срабатывает один раз даже при повторе.", "Невдала дія повторюється до 5 разів зі зростаючими паузами (1, 4, 16, 64 хвилини…). Потім вона зупиняється тут і чекає на людину. Нічого не виконується двічі.", "يُعاد الإجراء الفاشل حتى 5 مرات بفواصل متزايدة، ثم يتوقف هنا وينتظر شخصاً. لا يُنفذ شيء مرتين."))}</p>
        {(d.retrying || []).length > 0 && <div className="feed">{d.retrying.map((x: any) => <div key={x.id} className="hub-row"><span>{x.title}<br /><small className="faint">{x.status === "processing" ? T(L("Running now", "Выполняется", "Виконується", "قيد التنفيذ")) : `${T(L("Next try", "Следующая попытка", "Наступна спроба", "المحاولة التالية"))} ${when(x.next_attempt_at)} · ${x.attempts}/5`}{x.last_error ? ` · ${x.last_error}` : ""}</small></span></div>)}</div>}
        {(d.dead || []).length ? <div className="feed">{d.dead.map((x: any) => <div key={x.id} className="hub-row">
          <span><span className={`chip ${x.status === "dead" ? "c-bad" : "c-warn"}`}>{x.status === "dead" ? T(L("Gave up", "Остановлено", "Зупинено", "توقف")) : T(L("Failed", "Ошибка", "Помилка", "فشل"))}</span> {x.title}<br /><small className="faint">{when(x.updated_at)} · {x.attempts} {T(L("tries", "попыток", "спроб", "محاولات"))} · {x.last_error}</small></span>
          <button className="btn sm" disabled={!!busy} onClick={() => act(`q${x.id}`, { action: "requeue", id: x.id })}><Icon n="refresh" />{T(L("Try again", "Повторить", "Повторити", "أعد المحاولة"))}</button></div>)}</div>
          : <div className="empty">{T(L("Nothing waits for you.", "Ничего не ждёт вас.", "Ніщо не чекає на вас.", "لا شيء ينتظرك."))}</div>}
      </div>
    </section>

    <section className="card">
      <div className="card-h"><h2><Icon n="mail" />{T(L("E-mails to outside addresses — delivery to check", "Письма на внешние адреса — проверить доставку", "Листи на зовнішні адреси — перевірити доставку", "رسائل لعناوين خارجية — تحقق من التسليم"))}</h2></div>
      <div className="card-b" style={{ display: "grid", gap: 10 }}>
        <p className="faint" style={{ margin: 0 }}>{T(L("When the connection to the mail server broke after a message was handed over, Workspace cannot know whether it arrived and never sends it again by itself. Look in the Sent folder of info@agron1.com and say what happened.", "Если связь с почтовым сервером оборвалась после передачи письма, Workspace не может знать, дошло ли оно, и сам никогда не отправит его повторно. Посмотрите папку «Отправленные» info@agron1.com и отметьте, что произошло.", "Якщо зв'язок із поштовим сервером обірвався після передачі листа, Workspace не може знати, чи дійшов він, і сам ніколи не надішле його повторно. Перегляньте «Надіслані» info@agron1.com і позначте, що сталося.", "إذا انقطع الاتصال بعد تسليم الرسالة لا يعرف Workspace إن وصلت ولا يعيد إرسالها وحده. راجع مجلد المرسل في info@agron1.com وحدّد ما حدث."))}</p>
        {(d.deliveries || []).filter((x: any) => x.status === "uncertain").length ? <div className="feed">{d.deliveries.filter((x: any) => x.status === "uncertain").map((x: any) => <div key={x.id} className="hub-row">
          <span><b>{x.subject}</b><br /><small className="faint">{x.to_addr} · {when(x.updated_at)} · {x.last_error}</small></span>
          <span className="toolbar" style={{ gap: 6 }}><button className="btn sm" disabled={!!busy} onClick={() => act(`a${x.id}`, { action: "delivery", id: x.id, arrived: true })}><Icon n="check" />{T(L("It was sent", "Оно отправлено", "Його надіслано", "أُرسلت"))}</button>
            <button className="btn ghost sm" disabled={!!busy} onClick={() => { if (window.confirm(T(L("Not in the Sent folder? Send it once more?", "Нет в «Отправленных»? Отправить ещё раз?", "Немає в «Надісланих»? Надіслати ще раз?", "ليست في المرسل؟ أرسلها مرة أخرى؟")))) act(`n${x.id}`, { action: "delivery", id: x.id, arrived: false }); }}>{T(L("Not sent — send again", "Не отправлено — отправить снова", "Не надіслано — надіслати знову", "لم تُرسل — أعد الإرسال"))}</button></span></div>)}</div>
          : <div className="empty">{T(L("No deliveries to check.", "Нет писем для проверки.", "Немає листів для перевірки.", "لا رسائل للتحقق."))}</div>}
      </div>
    </section>
  </div>;
}
