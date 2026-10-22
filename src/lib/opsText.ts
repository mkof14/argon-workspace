// Phase 6 — the words of the operations screens, in plain language, EN / RU / UK / AR. Pure.
export type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export const say = (x: T4 | undefined, lang: string, v: Record<string, any> = {}) => {
  const s = (x ? (x as any)[lang] || x.en : "") as string; return s.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? "").toString());
};

export const REQUEST_TYPES: Record<string, { t: T4; d: T4; icon: string }> = {
  purchase: { t: L("Purchase", "Закупка", "Закупівля", "شراء"), d: L("Something to buy: goods, equipment, services.", "Что-то купить: товары, оборудование, услуги.", "Щось купити: товари, обладнання, послуги.", "شيء للشراء: سلع أو معدات أو خدمات."), icon: "cart" },
  payment: { t: L("Payment", "Оплата", "Оплата", "دفع"), d: L("A bill or an invoice to pay. Finance pays it in the bank and records it.", "Счёт к оплате. Бухгалтерия платит в банке и записывает оплату.", "Рахунок до сплати. Бухгалтерія платить у банку та записує оплату.", "فاتورة للدفع. تدفعها المالية في البنك وتسجلها."), icon: "coins" },
  contract: { t: L("Contract", "Договор", "Договір", "عقد"), d: L("A new contract or a change to one. Legal drafts it; it is approved as one exact version.", "Новый договор или изменение. Юристы готовят; согласуется конкретная версия.", "Новий договір або зміна. Юристи готують; погоджується конкретна версія.", "عقد جديد أو تعديل. تعدّه القانونية؛ يُعتمد كنسخة محددة."), icon: "pen" },
  change: { t: L("Engineering change", "Инженерное изменение", "Інженерна зміна", "تغيير هندسي"), d: L("A change to a product, design or configuration (ECR).", "Изменение изделия, конструкции или конфигурации (ECR).", "Зміна виробу, конструкції чи конфігурації (ECR).", "تغيير في منتج أو تصميم أو تهيئة."), icon: "git" },
  travel: { t: L("Travel or event", "Поездка или мероприятие", "Поїздка або захід", "سفر أو فعالية"), d: L("A trip or an event to attend. Book through the usual channels, record it here.", "Поездка или мероприятие. Бронируйте как обычно, записывайте здесь.", "Поїздка або захід. Бронюйте як зазвичай, записуйте тут.", "رحلة أو فعالية. احجز كالمعتاد وسجّلها هنا."), icon: "map" },
  general: { t: L("Other request", "Другая заявка", "Інша заявка", "طلب آخر"), d: L("Anything else that someone has to do for you.", "Всё остальное, что кто-то должен для вас сделать.", "Усе інше, що хтось має для вас зробити.", "أي شيء آخر يجب أن يفعله أحد لك."), icon: "headset" },
};

/** The fields a request form asks for, by type (keys of the section's fields; the server keeps only allowed ones). */
export const REQUEST_FORM: Record<string, string[]> = {
  purchase: ["item", "qty", "est_amount", "currency", "needed_by", "justification", "project_ref", "technical_reviewer"],
  payment: ["payee", "amount", "currency", "due", "purpose", "purchase_ref", "project_ref"],
  contract: ["counterparty", "type", "amount", "currency", "jurisdiction", "project_ref"],
  change: ["reason", "config", "priority", "project_ref"],
  travel: ["destination", "purpose", "starts", "ends", "est_cost", "currency", "event_ref", "project_ref"],
  general: ["description", "handler", "department", "due", "project_ref"],
};

export const INSTANCE_STATUS: Record<string, { t: T4; cls: string }> = {
  draft: { t: L("Draft", "Черновик", "Чернетка", "مسودة"), cls: "" },
  active: { t: L("In progress", "В работе", "У роботі", "قيد التنفيذ"), cls: "c-info" },
  waiting: { t: L("Waiting outside", "Ждём извне", "Чекаємо ззовні", "بانتظار جهة خارجية"), cls: "c-warn" },
  blocked: { t: L("Blocked", "Заблокировано", "Заблоковано", "معطّل"), cls: "c-bad" },
  completed: { t: L("Completed", "Завершено", "Завершено", "مكتمل"), cls: "c-ok" },
  cancelled: { t: L("Cancelled", "Отменено", "Скасовано", "ملغى"), cls: "" },
};

export const STEP_TYPE: Record<string, T4> = {
  TASK: L("Task", "Задача", "Завдання", "مهمة"), REVIEW: L("Review", "Проверка", "Перевірка", "مراجعة"), APPROVAL: L("Approval", "Согласование", "Погодження", "موافقة"),
  DOCUMENT: L("Documents", "Документы", "Документи", "مستندات"), DECISION: L("Decision", "Решение", "Рішення", "قرار"), DATA: L("Details", "Данные", "Дані", "بيانات"),
  WAIT: L("Waiting", "Ожидание", "Очікування", "انتظار"), AUTOMATION: L("Automatic", "Автоматически", "Автоматично", "تلقائي"), CHECK: L("Check", "Проверка условия", "Перевірка умови", "فحص"),
};

/** "What you need to do", from the step type (the database says the same in English) */
export const TODO: Record<string, T4> = {
  TASK: L("Do the task: {name}", "Выполните задачу: {name}", "Виконайте завдання: {name}", "نفّذ المهمة: {name}"),
  REVIEW: L("Review — approve, ask for changes or reject: {name}", "Проверьте — одобрите, верните на доработку или отклоните: {name}", "Перевірте — схваліть, поверніть на доопрацювання або відхиліть: {name}", "راجع — وافق أو اطلب تعديلات أو ارفض: {name}"),
  APPROVAL: L("Approve or reject: {name}", "Согласуйте или отклоните: {name}", "Погодьте або відхиліть: {name}", "وافق أو ارفض: {name}"),
  DOCUMENT: L("Attach the required documents: {name}", "Приложите нужные документы: {name}", "Додайте потрібні документи: {name}", "أرفق المستندات المطلوبة: {name}"),
  DECISION: L("Choose how to continue: {name}", "Выберите, как продолжить: {name}", "Оберіть, як продовжити: {name}", "اختر كيف تستمر: {name}"),
  DATA: L("Fill in the details and submit: {name}", "Заполните данные и отправьте: {name}", "Заповніть дані та надішліть: {name}", "املأ البيانات وأرسل: {name}"),
  WAIT: L("Record when it has arrived: {name}", "Отметьте, когда пришло: {name}", "Позначте, коли надійшло: {name}", "سجّل عند الوصول: {name}"),
  CHECK: L("The check failed — fix the record and check again: {name}", "Проверка не пройдена — исправьте запись и проверьте снова: {name}", "Перевірку не пройдено — виправте запис і перевірте знову: {name}", "فشل الفحص — صحّح السجل وأعد الفحص: {name}"),
  AUTOMATION: L("Automatic step: {name}", "Автоматический шаг: {name}", "Автоматичний крок: {name}", "خطوة تلقائية: {name}"),
};

export const OUTCOME: Record<string, T4> = {
  success: L("done", "выполнено", "виконано", "تم"), approved: L("approved", "одобрено", "схвалено", "معتمد"), rejected: L("rejected", "отклонено", "відхилено", "مرفوض"),
  changes_requested: L("changes requested", "на доработку", "на доопрацювання", "طلب تعديلات"), cancelled: L("cancelled", "отменено", "скасовано", "ملغى"), timed_out: L("time ran out", "время вышло", "час вийшов", "انتهى الوقت"),
};

export const EVENT: Record<string, T4> = {
  started: L("Process started", "Процесс запущен", "Процес запущено", "بدأت العملية"), step_entered: L("Step started", "Шаг начат", "Крок розпочато", "بدأت الخطوة"),
  step_completed: L("Step finished", "Шаг завершён", "Крок завершено", "انتهت الخطوة"), approval_requested: L("Approval requested", "Запрошено согласование", "Запитано погодження", "طُلبت الموافقة"),
  approval_decided: L("Approval decided", "Решение по согласованию", "Рішення щодо погодження", "قرار الموافقة"), approval_invalidated: L("Approval no longer valid (values changed)", "Согласование больше не действует (изменились данные)", "Погодження більше не діє (змінилися дані)", "لم تعد الموافقة صالحة (تغيرت القيم)"),
  vendor_selected: L("Vendor selected", "Поставщик выбран", "Постачальника обрано", "تم اختيار المورد"), purchase_created: L("Purchase record created", "Создана закупка", "Створено закупівлю", "أُنشئ سجل الشراء"),
  purchase_amend_needed: L("Order to be amended by a person", "Заказ должен изменить человек", "Замовлення має змінити людина", "يجب تعديل الطلب يدويًا"), received: L("Goods received", "Товар принят", "Товар прийнято", "تم الاستلام"),
  payment_recorded: L("Payment recorded by Finance", "Оплата записана бухгалтерией", "Оплату записала бухгалтерія", "سجلت المالية الدفع"), impact_confirmed: L("Impact record confirmed", "Влияние подтверждено", "Вплив підтверджено", "تم تأكيد الأثر"),
  automation_done: L("Automatic step done", "Автоматический шаг выполнен", "Автоматичний крок виконано", "تمت الخطوة التلقائية"), automation_failed: L("Automatic step failed — will retry", "Автоматический шаг не выполнен — повтор", "Автоматичний крок не виконано — повтор", "فشلت الخطوة التلقائية — ستُعاد"),
  blocked: L("Blocked", "Заблокировано", "Заблоковано", "معطّل"), reassigned: L("Handed over", "Передано", "Передано", "تم التسليم"), retried: L("Retried", "Повторено", "Повторено", "أُعيدت المحاولة"),
  overdue: L("Overdue", "Просрочено", "Прострочено", "متأخر"), escalated: L("Escalated", "Эскалировано", "Ескальовано", "تم التصعيد"), completed: L("Completed", "Завершено", "Завершено", "اكتمل"),
  rejected: L("Rejected", "Отклонено", "Відхилено", "رُفض"), cancelled: L("Cancelled", "Отменено", "Скасовано", "أُلغي"), migrated: L("Moved to another version", "Перенесено на другую версию", "Перенесено на іншу версію", "نُقل إلى نسخة أخرى"),
  quote_revised: L("Quotation revised by the vendor", "Поставщик изменил предложение", "Постачальник змінив пропозицію", "عدّل المورد العرض"),
};

/** The dashboard blocks (B30): each kind is one exact list the number opens */
export const DASH: { key: string; title: T4; icon: string; kinds: [string, T4][] }[] = [
  { key: "needs", title: L("NEEDS ACTION", "НУЖНО ДЕЙСТВИЕ", "ПОТРІБНА ДІЯ", "يحتاج إجراء"), icon: "bell", kinds: [["needs_action", L("Waiting for me", "Ждёт меня", "Чекає на мене", "بانتظاري")]] },
  { key: "purchases", title: L("PURCHASES", "ЗАКУПКИ", "ЗАКУПІВЛІ", "المشتريات"), icon: "cart", kinds: [["pr_open", L("Open requests", "Открытые заявки", "Відкриті заявки", "طلبات مفتوحة")], ["pr_approval", L("Awaiting approval", "Ждут согласования", "Чекають погодження", "بانتظار الموافقة")], ["po_awaiting_delivery", L("Awaiting delivery", "Ждут поставки", "Чекають поставки", "بانتظار التسليم")], ["po_overdue", L("Late deliveries", "Поставки с опозданием", "Поставки із запізненням", "تسليمات متأخرة")], ["received_30d", L("Received, 30 days", "Принято за 30 дней", "Прийнято за 30 днів", "مستلم خلال 30 يومًا")]] },
  { key: "payments", title: L("PAYMENTS", "ПЛАТЕЖИ", "ПЛАТЕЖІ", "المدفوعات"), icon: "coins", kinds: [["pay_approval", L("Awaiting approval", "Ждут согласования", "Чекають погодження", "بانتظار الموافقة")], ["pay_unpaid", L("Approved, not paid", "Согласовано, не оплачено", "Погоджено, не сплачено", "معتمد غير مدفوع")], ["pay_ready", L("Ready for payment", "Готово к оплате", "Готово до оплати", "جاهز للدفع")], ["paid_30d", L("Paid, 30 days", "Оплачено за 30 дней", "Сплачено за 30 днів", "مدفوع خلال 30 يومًا")]] },
  { key: "contracts", title: L("CONTRACTS", "ДОГОВОРЫ", "ДОГОВОРИ", "العقود"), icon: "pen", kinds: [["ctr_review", L("In preparation / review", "В подготовке / проверке", "У підготовці / перевірці", "قيد الإعداد / المراجعة")], ["ctr_signature", L("Awaiting signature", "Ждут подписи", "Чекають підпису", "بانتظار التوقيع")], ["ctr_expiring", L("Ending in 60 days", "Заканчиваются за 60 дней", "Закінчуються за 60 днів", "تنتهي خلال 60 يومًا")], ["obl_due_soon", L("Obligations due soon", "Скоро обязательства", "Незабаром зобов'язання", "التزامات قريبة")], ["obl_overdue", L("Obligations overdue", "Просроченные обязательства", "Прострочені зобов'язання", "التزامات متأخرة")]] },
  { key: "changes", title: L("ENGINEERING CHANGES", "ИНЖЕНЕРНЫЕ ИЗМЕНЕНИЯ", "ІНЖЕНЕРНІ ЗМІНИ", "التغييرات الهندسية"), icon: "git", kinds: [["ecr_open", L("Open", "Открытые", "Відкриті", "مفتوحة")], ["ecr_approval", L("Awaiting approval", "Ждут согласования", "Чекають погодження", "بانتظار الموافقة")], ["ecr_impact_missing", L("Impact not confirmed", "Влияние не подтверждено", "Вплив не підтверджено", "الأثر غير مؤكد")]] },
  { key: "issues", title: L("ISSUES", "ПРОБЛЕМЫ", "ПРОБЛЕМИ", "المشكلات"), icon: "alert", kinds: [["iss_open", L("Open", "Открытые", "Відкриті", "مفتوحة")], ["iss_overdue", L("Overdue", "Просроченные", "Прострочені", "متأخرة")]] },
  { key: "external", title: L("EXTERNAL WAITING", "ЖДЁМ ИЗВНЕ", "ЧЕКАЄМО ЗЗОВНІ", "انتظار خارجي"), icon: "truck", kinds: [["wait_open", L("Waiting", "Ждём", "Чекаємо", "بانتظار")], ["wait_overdue", L("Waiting too long", "Ждём слишком долго", "Чекаємо надто довго", "انتظار طويل")]] },
  { key: "sla", title: L("PROCESS SLA", "СРОКИ ПРОЦЕССОВ", "ТЕРМІНИ ПРОЦЕСІВ", "مهل العمليات"), icon: "clock", kinds: [["sla_due_soon", L("Due soon", "Скоро срок", "Незабаром термін", "قريب الاستحقاق")], ["sla_overdue", L("Overdue steps", "Просроченные шаги", "Прострочені кроки", "خطوات متأخرة")], ["sla_escalated", L("Escalated", "Эскалированы", "Ескальовані", "مصعّدة")], ["blocked", L("Blocked", "Заблокированы", "Заблоковані", "معطّلة")]] },
];

export const href = (section?: string, id?: string) => (section && id ? `/${section.replace(".", "/")}?r=${id}` : "#");
export const money = (v: any, cur?: string | null) => (v == null || v === "" || !isFinite(Number(v)) ? "—" : `${cur || "USD"} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** A plain-text OPERATIONS section for the weekly review (Phase 5 weeklyReview appends it) */
export function opsWeeklyText(w: any, lang: string): string {
  if (!w) return "";
  const p = (x: T4, v: any = {}) => say(x, lang, v);
  const paid = Object.entries(w.payments_recorded || {}).map(([c, s]) => money(s, c)).join(", ") || "—";
  return [p(L("OPERATIONS", "ОПЕРАЦИИ", "ОПЕРАЦІЇ", "العمليات")),
    p(L("- Processes started: {a}, completed: {b}, rejected: {c}", "- Процессов начато: {a}, завершено: {b}, отклонено: {c}", "- Процесів розпочато: {a}, завершено: {b}, відхилено: {c}", "- عمليات بدأت: {a}، اكتملت: {b}، رُفضت: {c}"), { a: w.started, b: w.completed, c: w.rejected }),
    p(L("- Approvals decided: {a}; approvals made stale by a change: {b}", "- Решений по согласованиям: {a}; согласований устарело из-за изменений: {b}", "- Рішень щодо погоджень: {a}; погоджень застаріло через зміни: {b}", "- قرارات موافقة: {a}؛ موافقات أُبطلت بسبب تغيير: {b}"), { a: w.approvals_decided, b: w.approvals_invalidated }),
    p(L("- Purchase records created: {a}; deliveries received: {b}", "- Создано закупок: {a}; принято поставок: {b}", "- Створено закупівель: {a}; прийнято поставок: {b}", "- سجلات شراء أُنشئت: {a}؛ تسليمات مستلمة: {b}"), { a: w.purchases_created, b: w.receipts }),
    p(L("- Payments recorded by Finance: {a}", "- Оплаты, записанные бухгалтерией: {a}", "- Оплати, записані бухгалтерією: {a}", "- مدفوعات سجلتها المالية: {a}"), { a: paid }),
    p(L("- Issues opened: {a}; escalations: {b}", "- Открыто проблем: {a}; эскалаций: {b}", "- Відкрито проблем: {a}; ескалацій: {b}", "- مشكلات فُتحت: {a}؛ تصعيدات: {b}"), { a: w.issues_opened, b: w.escalations }),
    p(L("- Now: {a} overdue steps, {b} blocked, {c} late deliveries, {d} waiting outside, {e} approved but unpaid, {f} obligations overdue", "- Сейчас: {a} просроченных шагов, {b} заблокировано, {c} опоздавших поставок, {d} ждём извне, {e} согласовано без оплаты, {f} просроченных обязательств", "- Зараз: {a} прострочених кроків, {b} заблоковано, {c} запізнілих поставок, {d} чекаємо ззовні, {e} погоджено без оплати, {f} прострочених зобов'язань", "- الآن: {a} خطوات متأخرة، {b} معطّلة، {c} تسليمات متأخرة، {d} بانتظار جهات خارجية، {e} معتمدة غير مدفوعة، {f} التزامات متأخرة"),
      { a: w.now?.overdue_steps ?? 0, b: w.now?.blocked ?? 0, c: w.now?.overdue_deliveries ?? 0, d: w.now?.waiting_external ?? 0, e: w.now?.unpaid_approved ?? 0, f: w.now?.obligations_overdue ?? 0 })].join("\n");
}

/** The Assistant: operations questions → one allow-listed intent of ops_assistant (never free text to the database) */
export function opsIntent(q: string): { intent: string; arg?: string } | null {
  const s = q.toLowerCase();
  if (/(approv|соглас|погод|اعتماد|موافق)/.test(s) && /(purchas|закуп|закупів|شراء|payment|оплат|платеж|need my|ждут мо|чекають мо|بانتظاري|my )/.test(s)) return { intent: "my_approvals", arg: /(payment|оплат|платеж|دفع)/.test(s) ? "finance.payments" : /(purchas|закуп|шراء|شراء)/.test(s) ? "operations.requests" : undefined };
  if (/\b(pr|po|pay|ctr|ecr|iss|trv|req)-\d{4}-\d{3,}/i.test(q)) { const m = q.match(/[A-Z]{2,4}-(PR|PO|PAY|CTR|ECR|ISS|TRV|REQ|EVT)-\d{4}-\d{3,}/i); if (m) return { intent: "process", arg: m[0].toUpperCase() }; }
  if (/(late deliver|overdue deliver|просроч\w* постав|запізн\w* постав|تسليم متأخر)/.test(s)) return { intent: "deliveries_overdue" };
  if (/(awaiting deliver|ждут постав|чекають постав|بانتظار التسليم)/.test(s)) return { intent: "deliveries_open" };
  if (/(unpaid|not paid|не оплач|не сплач|غير مدفوع)/.test(s)) return { intent: "payments_unpaid" };
  if (/(contract|договор|договір|عقد)/.test(s) && /(expir|end|заканч|закінч|تنتهي)/.test(s)) return { intent: "contracts_expiring" };
  if (/(obligation|обязательств|зобов'язан|التزام)/.test(s)) return { intent: "obligations_due" };
  if (/(engineering change|ecr|инженерн\w* изменен|інженерн\w* змін|تغيير هندسي)/.test(s)) return { intent: "changes_open" };
  if (/(issue|problem|проблем|مشكل)/.test(s)) return { intent: "issues_open" };
  if (/(waiting for|ждём|ждем|чекаємо|بانتظار)/.test(s) && /(vendor|supplier|поставщик|постачальник|outside|извне|ззовні|مورد|خارج)/.test(s)) return { intent: "waiting_external" };
  if (/(budget|бюджет|ميزانية)/.test(s)) { const m = q.match(/(?:budget|бюджет\w*|ميزانية)\s+(?:of|for|по|проекта|проєкту|для)?\s*([^?.,]{2,60})/i); return { intent: "budget", arg: m ? m[1].trim() : "" }; }
  if (/(purchase|закупк|закупівл|شراء)/.test(s)) return { intent: "purchases_open" };
  if (/(overdue step|sla|просроченн\w* шаг|прострочен\w* крок|خطوات متأخرة)/.test(s)) return { intent: "sla_overdue" };
  return null;
}
