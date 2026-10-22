// Phase 5 — words for the management engines (v22). The database computes every number, level and reason from
// the viewer's own records; this file only turns those codes into sentences in EN / RU / UK / AR, builds the CSV
// exports and assembles the Weekly Management Review from the same rows. Nothing here scores or decides anything.
import { opsWeeklyText } from "./opsText";
import type { Lang } from "@/lib/i18n";

export type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const fill = (s: string, v: Record<string, any>) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null && v[k] !== "" ? String(v[k]) : "—"));
export const say = (t: T4 | undefined, lang: Lang | string, v: Record<string, any> = {}) => (t ? fill((t as any)[lang] || t.en, v) : "");

export type Level = "healthy" | "attention" | "risk" | "critical" | "closed";
export const LEVELS: Record<Level, T4> = {
  healthy: L("Healthy", "В норме", "У нормі", "سليم"), attention: L("Attention", "Внимание", "Увага", "يحتاج انتباه"),
  risk: L("Risk", "Риск", "Ризик", "خطر"), critical: L("Critical", "Критично", "Критично", "حرج"), closed: L("Closed", "Закрыт", "Закритий", "مغلق"),
};
export const LEVEL_TONE: Record<string, string> = { healthy: "ok", attention: "warn", risk: "bad", critical: "bad", closed: "" };

/** One line per health reason; {n} = how many, {days}, {title}, {due}, {target}, {max}, {open} come from the row. */
export const HEALTH_REASON: Record<string, T4> = {
  no_owner: L("No project owner", "Нет руководителя проекта", "Немає керівника проєкту", "لا يوجد مالك للمشروع"),
  overdue_tasks: L("{n} overdue tasks", "Просроченных задач: {n}", "Прострочених задач: {n}", "{n} مهام متأخرة"),
  blocked_tasks: L("{n} blocked tasks", "Заблокированных задач: {n}", "Заблокованих задач: {n}", "{n} مهام معطلة"),
  overdue_share: L("{n}% of open work is overdue", "Просрочено {n}% открытой работы", "Прострочено {n}% відкритої роботи", "{n}% من العمل المفتوح متأخر"),
  critical_tasks: L("{n} critical tasks overdue or blocked", "Критичных задач просрочено или заблокировано: {n}", "Критичних задач прострочено або заблоковано: {n}", "{n} مهام حرجة متأخرة أو معطلة"),
  milestone_overdue: L("{n} milestones overdue or missed", "Вех просрочено или пропущено: {n}", "Віх прострочено або пропущено: {n}", "{n} مراحل متأخرة أو فائتة"),
  milestone_soon: L("Next milestone “{title}” due in {n} days", "Следующая веха «{title}» через {n} дн.", "Наступна віха «{title}» через {n} дн.", "المرحلة التالية «{title}» بعد {n} أيام"),
  milestone_no_owner: L("{n} milestones without an owner", "Вех без ответственного: {n}", "Віх без відповідального: {n}", "{n} مراحل بلا مسؤول"),
  deadline_passed: L("Project deadline passed {n} days ago ({target})", "Срок проекта прошёл {n} дн. назад ({target})", "Термін проєкту минув {n} дн. тому ({target})", "انقضى موعد المشروع قبل {n} أيام ({target})"),
  deadline_soon: L("Project deadline in {n} days ({target})", "Срок проекта через {n} дн. ({target})", "Термін проєкту через {n} дн. ({target})", "موعد المشروع بعد {n} أيام ({target})"),
  stale: L("No activity for {n} days", "Нет активности {n} дн.", "Немає активності {n} дн.", "لا نشاط منذ {n} أيام"),
  no_open_tasks: L("Active project with no open tasks", "Активный проект без открытых задач", "Активний проєкт без відкритих задач", "مشروع نشط بلا مهام مفتوحة"),
  unassigned_tasks: L("{n} open tasks without a responsible person", "Открытых задач без исполнителя: {n}", "Відкритих задач без виконавця: {n}", "{n} مهام مفتوحة بلا مسؤول"),
  approvals_waiting: L("{n} approvals waiting more than {days} days (longest {max})", "Согласований ждут дольше {days} дн.: {n} (дольше всего {max})", "Погоджень чекають довше {days} дн.: {n} (найдовше {max})", "{n} موافقات تنتظر أكثر من {days} أيام (الأطول {max})"),
  decisions_waiting: L("{n} decisions pending more than {days} days", "Решений ждут дольше {days} дн.: {n}", "Рішень чекають довше {days} дн.: {n}", "{n} قرارات معلقة أكثر من {days} أيام"),
  documents_in_review: L("{n} documents awaiting review", "Документов на проверке: {n}", "Документів на перевірці: {n}", "{n} مستندات بانتظار المراجعة"),
  on_hold: L("Project is on hold", "Проект приостановлен", "Проєкт призупинено", "المشروع معلق"),
};
export const healthReason = (r: any, lang: Lang | string) => say(HEALTH_REASON[r?.code], lang, r || {}) || String(r?.code || "");

export const LOOP_KIND: Record<string, T4> = {
  task_no_owner: L("Task without owner", "Задача без исполнителя", "Задача без виконавця", "مهمة بلا مسؤول"),
  task_no_due: L("Task without due date", "Задача без срока", "Задача без терміну", "مهمة بلا موعد"),
  task_overdue: L("Overdue task ({days} days)", "Просроченная задача ({days} дн.)", "Прострочена задача ({days} дн.)", "مهمة متأخرة ({days} أيام)"),
  task_blocked: L("Blocked task", "Заблокированная задача", "Заблокована задача", "مهمة معطلة"),
  task_review: L("Task waiting for review", "Задача ждёт проверки", "Задача чекає перевірки", "مهمة بانتظار المراجعة"),
  task_stale: L("Task unchanged for {days} days", "Задача без изменений {days} дн.", "Задача без змін {days} дн.", "مهمة بلا تغيير منذ {days} أيام"),
  project_no_owner: L("Project without owner", "Проект без руководителя", "Проєкт без керівника", "مشروع بلا مالك"),
  project_no_milestone: L("Project without next milestone", "Проект без следующей вехи", "Проєкт без наступної віхи", "مشروع بلا مرحلة تالية"),
  project_stale: L("Active project with no activity for {days} days", "Активный проект без активности {days} дн.", "Активний проєкт без активності {days} дн.", "مشروع نشط بلا نشاط منذ {days} أيام"),
  project_deadline_passed: L("Project deadline passed ({days} days)", "Срок проекта прошёл ({days} дн.)", "Термін проєкту минув ({days} дн.)", "انقضى موعد المشروع ({days} أيام)"),
  project_deadline_risk: L("Deadline in {days} days, {progress}% complete", "До срока {days} дн., выполнено {progress}%", "До терміну {days} дн., виконано {progress}%", "الموعد بعد {days} أيام، المنجز {progress}%"),
  project_blocked: L("Project with {n} blocked tasks", "В проекте заблокированных задач: {n}", "У проєкті заблокованих задач: {n}", "مشروع به {n} مهام معطلة"),
  project_no_next_action: L("Project with no next action", "Нет следующего шага по проекту", "Немає наступного кроку з проєкту", "مشروع بلا إجراء تالٍ"),
  decision_pending: L("Decision pending", "Решение ожидает", "Рішення очікує", "قرار معلق"),
  decision_review_long: L("Decision in review for {days} days", "Решение на рассмотрении {days} дн.", "Рішення на розгляді {days} дн.", "قرار قيد المراجعة منذ {days} أيام"),
  decision_deferred_due: L("Deferred decision due for reconsideration ({reconsider})", "Отложенное решение пора пересмотреть ({reconsider})", "Відкладене рішення час переглянути ({reconsider})", "قرار مؤجل حان وقت مراجعته ({reconsider})"),
  approval_waiting: L("Approval waiting {days} days", "Согласование ждёт {days} дн.", "Погодження чекає {days} дн.", "موافقة تنتظر منذ {days} أيام"),
  approval_approver_inactive: L("Approver is not active", "Согласующий неактивен", "Погоджувач неактивний", "المعتمِد غير نشط"),
  approval_chain_blocked: L("Approval chain stopped at step {step} ({waiting} waiting)", "Цепочка согласования стоит на шаге {step} (ждут: {waiting})", "Ланцюжок погодження стоїть на кроці {step} (чекають: {waiting})", "سلسلة الموافقة متوقفة عند الخطوة {step} ({waiting} بالانتظار)"),
  document_review: L("Document awaiting review", "Документ ждёт проверки", "Документ чекає перевірки", "مستند بانتظار المراجعة"),
  document_approval: L("Document awaiting approval", "Документ ждёт утверждения", "Документ чекає затвердження", "مستند بانتظار الاعتماد"),
  document_expiring: L("Document expiring or due for review", "Документ истекает или пора пересмотреть", "Документ спливає або час переглянути", "مستند ينتهي أو حان وقت مراجعته"),
  meeting_decision_no_followup: L("Meeting decision not logged", "Решение встречи не внесено в журнал", "Рішення зустрічі не внесено до журналу", "قرار اجتماع غير مسجل"),
  meeting_action_no_task: L("Meeting action without a task", "Пункт встречи без задачи", "Пункт зустрічі без задачі", "بند اجتماع بلا مهمة"),
  meeting_task_no_owner: L("Meeting task without owner", "Задача встречи без исполнителя", "Задача зустрічі без виконавця", "مهمة اجتماع بلا مسؤول"),
};
export const loopText = (l: { kind: string; reason?: any; age_days?: number }, lang: Lang | string) => say(LOOP_KIND[l.kind], lang, { ...(l.reason || {}), days: l.reason?.days ?? l.age_days }) || l.kind;
export const LOOP_CATS: Record<string, T4> = { task: L("Tasks", "Задачи", "Задачі", "المهام"), project: L("Projects", "Проекты", "Проєкти", "المشاريع"), decision: L("Decisions", "Решения", "Рішення", "القرارات"),
  approval: L("Approvals", "Согласования", "Погодження", "الموافقات"), document: L("Documents", "Документы", "Документи", "المستندات"), meeting: L("Meetings", "Встречи", "Зустрічі", "الاجتماعات") };
export const SEVERITY: Record<string, T4> = { critical: L("Critical", "Критично", "Критично", "حرج"), high: L("High", "Высокий", "Високий", "مرتفع"), medium: L("Medium", "Средний", "Середній", "متوسط"), low: L("Low", "Низкий", "Низький", "منخفض") };

/** Next Action — a recommendation; `act` is the safe Workspace action the button opens (never done silently). */
export const NEXT_ACTION: Record<string, T4> = {
  assign_owner: L("Assign an owner", "Назначить ответственного", "Призначити відповідального", "تعيين مسؤول"),
  set_due_date: L("Set a due date", "Поставить срок", "Встановити термін", "تحديد موعد"),
  follow_up: L("Follow up", "Напомнить исполнителю", "Нагадати виконавцю", "متابعة"),
  resolve_blocker: L("Resolve the blocker", "Снять блокировку", "Зняти блокування", "حل العائق"),
  review: L("Review the work", "Проверить работу", "Перевірити роботу", "مراجعة العمل"),
  update_status: L("Update the status", "Обновить статус", "Оновити статус", "تحديث الحالة"),
  plan_milestone: L("Plan the next milestone", "Запланировать веху", "Запланувати віху", "تخطيط المرحلة التالية"),
  update_project: L("Update the project", "Обновить проект", "Оновити проєкт", "تحديث المشروع"),
  replan_deadline: L("Re-plan the deadline", "Пересмотреть срок", "Переглянути термін", "إعادة تخطيط الموعد"),
  review_readiness: L("Review milestone readiness", "Проверить готовность к вехе", "Перевірити готовність до віхи", "مراجعة جاهزية المرحلة"),
  define_next_action: L("Define the next action", "Определить следующий шаг", "Визначити наступний крок", "تحديد الإجراء التالي"),
  decide: L("Make the decision", "Принять решение", "Ухвалити рішення", "اتخاذ القرار"),
  finish_review: L("Finish the review", "Завершить рассмотрение", "Завершити розгляд", "إنهاء المراجعة"),
  revisit: L("Reconsider the decision", "Пересмотреть решение", "Переглянути рішення", "إعادة النظر في القرار"),
  review_approval: L("Review the approval", "Рассмотреть согласование", "Розглянути погодження", "مراجعة الموافقة"),
  reassign_approver: L("Reassign the approver", "Сменить согласующего", "Змінити погоджувача", "تغيير المعتمِد"),
  review_document: L("Review the document", "Проверить документ", "Перевірити документ", "مراجعة المستند"),
  complete_approval: L("Complete document approval", "Завершить утверждение документа", "Завершити затвердження документа", "إكمال اعتماد المستند"),
  renew_document: L("Renew or review the document", "Обновить или пересмотреть документ", "Оновити або переглянути документ", "تجديد المستند أو مراجعته"),
  log_decisions: L("Log the meeting decisions", "Внести решения встречи", "Внести рішення зустрічі", "تسجيل قرارات الاجتماع"),
  create_task: L("Create the task", "Создать задачу", "Створити задачу", "إنشاء المهمة"),
  review_milestone: L("Review milestone readiness", "Проверить готовность к вехе", "Перевірити готовність до віхи", "مراجعة جاهزية المرحلة"),
  review_project: L("Review the project", "Разобрать проект", "Розібрати проєкт", "مراجعة المشروع"),
};
/** Where the safe action happens: an approval goes to the approval screen, the rest open the record itself. */
export const actionHref = (next: string, link: string) => (["review_approval", "complete_approval"].includes(next) ? "/decide" : link);

export const ATTENTION_PART: Record<string, T4> = {
  severity: L("severity", "серьёзность", "серйозність", "الخطورة"),
  deadline: L("deadline {n} days", "срок {n} дн.", "термін {n} дн.", "الموعد {n} أيام"),
  priority: L("high priority", "высокий приоритет", "високий пріоритет", "أولوية عالية"),
  downstream: L("blocks {n} other tasks", "блокирует ещё {n} задач", "блокує ще {n} задач", "يعطل {n} مهام أخرى"),
  affected: L("{n} affected tasks", "затронуто задач: {n}", "зачеплено задач: {n}", "{n} مهام متأثرة"),
  executive: L("needs an executive decision", "нужно решение руководства", "потрібне рішення керівництва", "يتطلب قرارًا تنفيذيًا"),
  aging: L("waiting {n} days", "ждёт {n} дн.", "чекає {n} дн.", "ينتظر {n} أيام"),
  critical_project: L("project at risk", "проект под риском", "проєкт під ризиком", "المشروع في خطر"),
  dependency: L("depends on another task", "зависит от другой задачи", "залежить від іншої задачі", "يعتمد على مهمة أخرى"),
};
export const attentionWhy = (a: { kind: string; why: any }, lang: Lang | string): string[] => {
  const r = a.why?.reason || {}; const head = a.kind === "project_health" ? [say(LEVELS[(r.code || "").replace("project_", "") as Level], lang) + (r.score != null ? ` · ${r.score}` : ""), ...(r.reasons || []).slice(0, 3).map((x: any) => healthReason(x, lang))] : [loopText({ kind: a.kind, reason: r }, lang)];
  const parts = (a.why?.parts || []).filter((p: any) => p.code !== "severity").map((p: any) => say(ATTENTION_PART[p.code], lang, { n: p.code === "deadline" && p.n < 0 ? -p.n : p.n }) + (p.code === "deadline" && p.n < 0 ? (lang === "ru" ? " назад" : lang === "uk" ? " тому" : lang === "ar" ? " مضت" : " ago") : ""));
  return [...head, ...parts].filter(Boolean);
};
/** HIGH ≥ 60, MEDIUM ≥ 40, else LOW — the label shown next to an attention score (the score itself is the database's). */
export const attentionLabel = (score: number) => (score >= 60 ? "high" : score >= 40 ? "medium" : "low");

export const CHANGE_KIND: Record<string, T4> = {
  project_status: L("Status {from} → {to}", "Статус {from} → {to}", "Статус {from} → {to}", "الحالة {from} ← {to}"),
  milestone_completed: L("Milestone completed", "Веха достигнута", "Віху досягнуто", "اكتملت المرحلة"),
  milestone_delayed: L("Milestone delayed", "Веха сдвинулась или просрочена", "Віха зсунулася або прострочена", "تأخرت المرحلة"),
  blocker_new: L("New blocker", "Новая блокировка", "Нове блокування", "عائق جديد"),
  blocker_resolved: L("Blocker resolved", "Блокировка снята", "Блокування знято", "تم حل العائق"),
  tasks_completed: L("{n} tasks completed", "Выполнено задач: {n}", "Виконано задач: {n}", "اكتملت {n} مهام"),
  decision_made: L("Decision {to}", "Решение: {to}", "Рішення: {to}", "القرار: {to}"),
  document_approved: L("Document {to}", "Документ: {to}", "Документ: {to}", "المستند: {to}"),
  deadline_changed: L("Deadline {from} → {to}", "Срок {from} → {to}", "Термін {from} → {to}", "الموعد {from} ← {to}"),
  owner_changed: L("Owner changed", "Сменился ответственный", "Змінився відповідальний", "تغير المسؤول"),
  approval_completed: L("Approval {status}", "Согласование: {status}", "Погодження: {status}", "الموافقة: {status}"),
  task_overdue: L("Important task became overdue ({due})", "Важная задача просрочена ({due})", "Важлива задача прострочена ({due})", "مهمة مهمة أصبحت متأخرة ({due})"),
  health_changed: L("Health {from} → {to}", "Состояние {from} → {to}", "Стан {from} → {to}", "الحالة الصحية {from} ← {to}"),
};
export const changeText = (c: { kind: string; detail: any }, lang: Lang | string) => {
  const d = { ...(c.detail || {}) };
  if (c.kind === "health_changed") { d.from = say(LEVELS[d.from as Level], lang) || d.from; d.to = say(LEVELS[d.to as Level], lang) || d.to; }
  return say(CHANGE_KIND[c.kind], lang, d) || c.kind;
};

export const WAIT_BUCKET: Record<string, T4> = { me: L("Waiting for me", "Ждут от меня", "Чекають від мене", "ينتظرونني"), team: L("Waiting for my team", "Ждём от моей команды", "Чекаємо від моєї команди", "بانتظار فريقي"),
  others: L("Waiting for others", "Жду от других", "Чекаю від інших", "بانتظار الآخرين"), external: L("Waiting for an outside party", "Ждём от внешней стороны", "Чекаємо від зовнішньої сторони", "بانتظار طرف خارجي") };
export const ESCALATION: Record<string, T4> = { none: L("On track", "В срок", "У строк", "في الموعد"), aging: L("Aging", "Долго ждёт", "Довго чекає", "متقادم"), due_soon: L("Due soon", "Скоро срок", "Скоро термін", "قريب الموعد"),
  overdue: L("Overdue", "Просрочено", "Прострочено", "متأخر"), escalated: L("Escalated", "Эскалировано", "Ескальовано", "تم التصعيد") };
export const WAIT_KIND: Record<string, T4> = { task: L("Task", "Задача", "Задача", "مهمة"), approval: L("Approval", "Согласование", "Погодження", "موافقة"), review: L("Review", "Проверка", "Перевірка", "مراجعة"), decision: L("Decision", "Решение", "Рішення", "قرار") };

export const AVAILABILITY: Record<string, T4> = { available: L("Available", "На связи", "На зв'язку", "متاح"), busy: L("Busy", "Занят", "Зайнятий", "مشغول"), away: L("Away", "Отошёл", "Відійшов", "بعيد"),
  out_of_office: L("Out of office", "Нет в офисе", "Немає в офісі", "خارج المكتب"), off: L("Off", "Не работает", "Не працює", "خارج العمل") };
export const DEADLINE_KIND: Record<string, T4> = { task: L("Task", "Задача", "Задача", "مهمة"), milestone: L("Milestone", "Веха", "Віха", "مرحلة"), project: L("Project deadline", "Срок проекта", "Термін проєкту", "موعد المشروع"),
  decision: L("Decision due", "Срок решения", "Термін рішення", "موعد القرار"), document: L("Document", "Документ", "Документ", "مستند") };

/** Local time of a person in their own time zone (null when the zone is unknown). */
export function localTime(tz: string | null | undefined, at = new Date()) {
  if (!tz) return null;
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short" }).format(at); } catch { return null; }
}

/* ------------------------------------ exports and the review packet ------------------------------------ */
const cell = (v: any) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (head: string[], rows: any[][]) => [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");

export function portfolioCsv(rows: any[], names: (id?: string | null) => string, lang: Lang | string) {
  return toCsv(["Portfolio", "Project", "Owner", "Status", "Health", "Score", "Progress %", "Progress basis", "Next milestone", "Milestone due", "Deadline", "Blocked", "Overdue", "Major issue", "Link"],
    rows.map((h) => [h.portfolio_name || "", h.title, names(h.manager_id), h.status, say(LEVELS[h.level as Level], lang), h.score ?? "", h.progress ?? "", h.progress_basis, h.next_milestone?.title || "", h.next_milestone?.due || "", h.target || "", h.blocked, h.overdue, h.reasons?.[0] ? healthReason(h.reasons[0], lang) : "", h.link || `/projects/${h.project_id}`]));
}
export function workloadCsv(rows: any[]) {
  return toCsv(["Person", "Department", "Active tasks", "Overdue", "Blocked", "Projects", "Upcoming deadlines (14 days)"],
    rows.map((p) => [p.name, p.department || "", p.open_tasks, p.overdue_tasks, p.blocked_tasks, (p.projects || []).map((x: any) => x.title).join("; "), p.upcoming_14 ?? 0]));
}
export function deadlinesCsv(rows: any[], lang: Lang | string) {
  return toCsv(["Group", "Kind", "Title", "Project", "Due", "Days", "Status", "Priority", "Link"],
    rows.map((d) => [d.days < 0 ? "Overdue" : d.days <= 7 ? "Next 7 days" : "Next 30 days", say(DEADLINE_KIND[d.kind], lang), d.title, d.project_title || "", d.due, d.days, d.status || "", d.priority || "", d.link]));
}
export function decisionsCsv(rows: any[]) {
  return toCsv(["Number", "Decision", "Status", "Group", "Project", "Date", "Age (days)", "Due", "Reconsider", "Link"],
    rows.map((d) => [d.number || "", d.title, d.status, ["Proposed", "In review"].includes(d.status) ? "Pending" : d.status === "Deferred" ? "Deferred" : "Decided", d.project_title || "", d.date, d.age_days, d.due || "", d.reconsider || "", d.link]));
}

export type Review = { sections: { key: string; title: string; lines: { text: string; link?: string }[] }[] };
export const REVIEW_TITLES: Record<string, T4> = {
  summary: L("1. Executive summary", "1. Краткое резюме", "1. Коротке резюме", "1. الملخص التنفيذي"), health: L("2. Portfolio health", "2. Состояние портфеля", "2. Стан портфеля", "2. صحة المحفظة"),
  critical: L("3. Critical issues", "3. Критичные вопросы", "3. Критичні питання", "3. القضايا الحرجة"), decisions: L("4. Decisions required", "4. Нужные решения", "4. Потрібні рішення", "4. القرارات المطلوبة"),
  waiting: L("5. Waiting for", "5. Чего ждём", "5. На що чекаємо", "5. بانتظار"), deadlines: L("6. Major deadlines", "6. Главные сроки", "6. Головні терміни", "6. المواعيد الرئيسية"),
  changes: L("7. Changes since the previous review", "7. Изменения с прошлого обзора", "7. Зміни з попереднього огляду", "7. التغييرات منذ المراجعة السابقة"),
  completed: L("8. Completed work", "8. Выполненная работа", "8. Виконана робота", "8. العمل المنجز"), next: L("9. Next week", "9. Следующая неделя", "9. Наступний тиждень", "9. الأسبوع القادم"),
  operations: L("10. Operations", "10. Операции", "10. Операції", "10. العمليات"),
  commercial: L("11. Commercial", "11. Коммерция", "11. Комерція", "11. التجاري"),
  manufacturing: L("12. Manufacturing", "12. Производство", "12. Виробництво", "12. التصنيع"),
};
/** The Weekly Management Review, assembled only from rows the database returned for this viewer. */
export function weeklyReview(o: { overview: any; health: any[]; attention: any[]; loops: any[]; waiting: any[]; deadlines: any[]; changes: any[]; sinceLabel: string; operations?: any; commercial?: any; manufacturing?: any }, lang: Lang | string): Review {
  const ind = o.overview?.indicators || {}; const lv = (k: Level) => o.health.filter((h) => h.level === k).length;
  const S = (k: string, lines: { text: string; link?: string }[]) => ({ key: k, title: say(REVIEW_TITLES[k], lang), lines });
  const none = say(L("Nothing.", "Нет.", "Немає.", "لا شيء."), lang);
  const ln = (a: { text: string; link?: string }[]) => (a.length ? a : [{ text: none }]);
  const completed = o.changes.filter((c) => ["tasks_completed", "milestone_completed", "decision_made", "document_approved", "approval_completed", "blocker_resolved"].includes(c.kind));
  return { sections: [
    S("summary", [{ text: say(L("{a} active projects: {h} healthy, {at} attention, {r} at risk, {c} critical.", "Активных проектов: {a} — в норме {h}, внимание {at}, риск {r}, критично {c}.", "Активних проєктів: {a} — у нормі {h}, увага {at}, ризик {r}, критично {c}.", "{a} مشاريع نشطة: {h} سليمة، {at} تحتاج انتباه، {r} في خطر، {c} حرجة."), lang, { a: ind.active_projects ?? o.health.filter((h) => h.level !== "closed").length, h: lv("healthy"), at: lv("attention"), r: lv("risk"), c: lv("critical") }) },
      { text: say(L("Overdue work {o} · blocked {b} · pending decisions {d} · pending approvals {p} · open loops {l}.", "Просрочено {o} · заблокировано {b} · решений ждут {d} · согласований ждут {p} · открытых вопросов {l}.", "Прострочено {o} · заблоковано {b} · рішень чекають {d} · погоджень чекають {p} · відкритих питань {l}.", "عمل متأخر {o} · معطل {b} · قرارات معلقة {d} · موافقات معلقة {p} · حلقات مفتوحة {l}."), lang, { o: ind.overdue_work ?? 0, b: ind.blocked_work ?? 0, d: ind.pending_decisions ?? 0, p: ind.pending_approvals ?? 0, l: ind.open_loops ?? o.loops.length }) }]),
    S("health", ln(o.health.filter((h) => h.level !== "closed").map((h) => ({ text: `${h.title} — ${say(LEVELS[h.level as Level], lang)} ${h.score ?? ""}${h.reasons?.length ? ": " + h.reasons.slice(0, 3).map((r: any) => healthReason(r, lang)).join("; ") : ""}`, link: `/projects/${h.project_id}` })))),
    S("critical", ln(o.attention.filter((a) => a.severity === "critical" || a.attention_score >= 60).slice(0, 12).map((a) => ({ text: `${a.title}${a.project_title && a.project_title !== a.title ? ` (${a.project_title})` : ""} — ${attentionWhy(a, lang).slice(0, 3).join("; ")}`, link: a.link })))),
    S("decisions", ln(o.loops.filter((l) => l.category === "decision").map((l) => ({ text: `${l.title} — ${loopText(l, lang)}`, link: l.link })))),
    S("waiting", ln(o.waiting.filter((w) => w.bucket !== "me").slice(0, 15).map((w) => ({ text: `${w.party_name || "—"}: ${w.title}${w.project_title ? ` (${w.project_title})` : ""} — ${say(ESCALATION[w.escalation], lang)}, ${w.age_days} d`, link: w.link })))),
    S("deadlines", ln(o.deadlines.filter((d) => d.days <= 14 && (d.kind !== "task" || ["High", "Critical"].includes(d.priority))).slice(0, 20).map((d) => ({ text: `${d.due} · ${say(DEADLINE_KIND[d.kind], lang)}: ${d.title}${d.project_title ? ` (${d.project_title})` : ""}`, link: d.link })))),
    S("changes", ln(o.changes.filter((c) => !completed.includes(c)).slice(0, 25).map((c) => ({ text: `${c.project_title || c.title}: ${changeText(c, lang)}${c.project_title && c.title !== c.project_title ? ` — ${c.title}` : ""}`, link: c.link })))),
    S("completed", ln(completed.slice(0, 25).map((c) => ({ text: `${c.project_title || c.title}: ${changeText(c, lang)}${c.kind !== "tasks_completed" && c.title !== c.project_title ? ` — ${c.title}` : ""}`, link: c.link })))),
    S("next", ln(o.deadlines.filter((d) => d.days >= 0 && d.days <= 7).slice(0, 20).map((d) => ({ text: `${d.due} · ${d.title}${d.project_title ? ` (${d.project_title})` : ""}`, link: d.link })))),
    // Phase 6: OPERATIONS — the same numbers as the operations dashboard (ops_weekly, the viewer's records only)
    ...(o.operations ? [S("operations", opsWeeklyText(o.operations, lang).split("\n").slice(1).map((t) => ({ text: t.replace(/^- /, ""), link: "/ops?tab=dashboard" })))] : []),
    // Phase 7: COMMERCIAL — crm_weekly for the viewer's opportunities only; weighted values are estimates, not revenue
    ...(o.commercial ? [S("commercial", crmWeeklyLines(o.commercial, lang))] : []),
    ...(o.manufacturing ? [S("manufacturing", mfgWeeklyLines(o.manufacturing, lang))] : []),
  ], } as Review & { since?: string };
}
export const reviewText = (r: Review, head: string) => [head, "", ...r.sections.flatMap((s) => [s.title, ...s.lines.map((l) => `- ${l.text}`), ""])].join("\n");

/** Phase 7: the commercial lines of the weekly review — each line names its record; values per currency, never added across */
export function crmWeeklyLines(w: any, lang: Lang | string): { text: string; link?: string }[] {
  const p = (x: any, v: any = {}) => say(x, lang as any, v); const sm = w?.summary || {};
  const val = (r: any) => { const v = r.final ?? r.negotiated ?? r.quoted ?? r.value; return v == null ? "" : ` · ${Number(v).toLocaleString("en-US")} ${r.currency || "(no currency)"}`; };
  const one = (r: any) => ({ text: `${r.number ? r.number + " · " : ""}${r.title}${r.party ? ` (${r.party})` : ""}${val(r)}`, link: r.id ? `/crm?opp=${r.id}` : "/crm" });
  const out: { text: string; link?: string }[] = [{ text: p(L("Active {a} · new this week {n} · won {w} · lost {l} · stalled {s} · at risk {r} · proposals outstanding {po}", "Активных {a} · новых за неделю {n} · выиграно {w} · проиграно {l} · застряло {s} · под риском {r} · КП без ответа {po}", "Активних {a} · нових за тиждень {n} · виграно {w} · програно {l} · застрягло {s} · під ризиком {r} · КП без відповіді {po}", "نشطة {a} · جديدة {n} · مكسوبة {w} · خاسرة {l} · متوقفة {s} · معرضة {r} · عروض معلقة {po}"),
    { a: sm.active ?? 0, n: sm.new ?? 0, w: sm.won ?? 0, l: sm.lost ?? 0, s: sm.stalled ?? 0, r: sm.risk ?? 0, po: sm.proposals_outstanding ?? 0 }), link: "/crm?tab=review" }];
  const add = (k: string, l: any) => { const rs = (w?.[k] || []).slice(0, 8); if (rs.length) { out.push({ text: p(l) + ":" }); rs.forEach((r: any) => out.push(one(r))); } };
  add("wins", L("Won", "Выиграно", "Виграно", "مكسوبة")); add("losses", L("Lost", "Проиграно", "Програно", "خاسرة")); add("stalled", L("Stalled", "Застряли", "Застрягли", "متوقفة"));
  add("decisions_expected", L("Decisions expected", "Ожидаются решения", "Очікуються рішення", "قرارات متوقعة")); add("major", L("Major opportunities", "Крупные возможности", "Великі можливості", "فرص كبرى"));
  out.push({ text: p(L("Weighted pipeline is a management estimate, not revenue.", "Взвешенная воронка — управленческая оценка, не выручка.", "Зважена воронка — управлінська оцінка, не виручка.", "المسار المرجح تقدير إداري وليس إيرادًا.")) });
  return out;
}

/** Phase 8: the manufacturing lines of the weekly review (twelve parts, B61) — each line names its unit or record; costs per currency, operational only */
export const MFG_REVIEW_PARTS: [string, T4][] = [["active", L("Active units", "Активные изделия", "Активні вироби", "الوحدات النشطة")], ["progress", L("Build progress", "Ход сборки", "Хід збирання", "تقدم البناء")],
  ["blockers", L("Blockers", "Блокеры", "Блокери", "العوائق")], ["shortages", L("Material shortages", "Нехватка материалов", "Нестача матеріалів", "نقص المواد")], ["procurement_risk", L("Procurement risk", "Риски закупок", "Ризики закупівель", "مخاطر المشتريات")],
  ["nonconformance", L("Nonconformances", "Несоответствия", "Невідповідності", "عدم المطابقة")], ["testing", L("Testing", "Испытания", "Випробування", "الاختبار")], ["engineering_changes", L("Engineering changes", "Инженерные изменения", "Інженерні зміни", "التغييرات الهندسية")],
  ["acceptance", L("Acceptance", "Приёмка", "Приймання", "القبول")], ["shipment", L("Shipment", "Отгрузка", "Відвантаження", "الشحن")], ["cost_variance", L("Operational cost variance", "Операционное отклонение затрат", "Операційне відхилення витрат", "فرق التكلفة التشغيلية")],
  ["next_actions", L("Next actions", "Следующие шаги", "Наступні кроки", "الخطوات التالية")]];
export function mfgWeeklyParts(w: any, lang: Lang | string): { key: string; title: string; lines: { text: string; link?: string }[] }[] {
  const p = (x: any, v: any = {}) => say(x, lang as any, v); const none = p(L("Nothing.", "Нет.", "Немає.", "لا شيء."));
  const unit = (r: any) => (r.id ? `/mfg?unit=${r.id}` : "/mfg?tab=units");
  const kv = (o: any) => Object.entries(o || {}).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ");
  const lines = (k: string): { text: string; link?: string }[] => {
    const x = w?.[k];
    if (k === "active") return (x || []).map((r: any) => ({ text: `${r.number} · ${r.product || ""} · ${r.status}${r.target ? ` · ${p(L("target", "срок", "строк", "الموعد"))} ${r.target}` : ""}`, link: unit(r) }));
    if (k === "progress") return (x || []).filter((r: any) => r.total).map((r: any) => ({ text: `${r.unit}: ${r.completed}/${r.total} ${p(L("work orders", "нарядов", "нарядів", "أوامر عمل"))} (+${r.completed_this_week})`, link: unit(r) }));
    if (k === "blockers" || k === "shortages") return (x || []).map((r: any) => ({ text: `${r.unit}: ${(r.reasons || r.items || []).slice(0, 3).join("; ")}`, link: unit(r) }));
    if (k === "procurement_risk") return (x || []).filter(Boolean).map((r: any) => ({ text: `${r.number || ""} ${r.title || ""} ${r.eta ? `ETA ${r.eta}` : ""} ${r.unit || ""}`.trim() }));
    if (k === "engineering_changes") return (x || []).map((r: any) => ({ text: `${r.number} · ${r.title} · ${r.status}`, link: "/mfg?tab=changes" }));
    if (k === "cost_variance") return (x || []).map((r: any) => ({ text: `${r.unit}: ${(r.by_currency || []).map((c: any) => `${c.currency} ${p(L("variance", "отклонение", "відхилення", "الفرق"))} ${c.variance}`).join(" · ")}` }));
    if (k === "next_actions") return (x || []).slice(0, 15).map((r: any) => ({ text: `${r.unit}: ${r.action}${r.owner ? ` — ${r.owner}` : ""}` }));
    return x && typeof x === "object" && !Array.isArray(x) ? [{ text: kv(x) }] : [];
  };
  return MFG_REVIEW_PARTS.map(([k, l]) => { const ls = lines(k); return { key: k, title: p(l), lines: ls.length ? ls.slice(0, 20) : [{ text: none }] }; });
}
export function mfgWeeklyLines(w: any, lang: Lang | string): { text: string; link?: string }[] {
  const parts = mfgWeeklyParts(w, lang);
  return [...parts.flatMap((s) => [{ text: `${s.title}:` }, ...s.lines.slice(0, 6)]), { text: say(L("Costs are operational build costs, not accounting cost; acceptance is internal, not certification.", "Затраты — операционные, не бухгалтерские; приёмка — внутренняя, не сертификация.", "Витрати — операційні, не бухгалтерські; приймання — внутрішнє, не сертифікація.", "التكاليف تشغيلية وليست محاسبية."), lang as any) }];
}
