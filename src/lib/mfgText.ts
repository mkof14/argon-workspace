// Phase 8 — manufacturing and build control: words for the screens (EN/RU/UK/AR) and the Assistant's manufacturing
// questions (allow-listed intents answered by the database for the signed-in person). Pure functions only.
import { L, type T4 } from "./crmText";
export { L, type T4 };

/** A build unit, BOM, work order, item or serial reference inside a question ("C20-0001", "AGR-C40-0004", "AGR-WO-2026-00012"). */
const UNIT_REF = /\b((?:[A-Z]{2,5}-)?[A-Z]{1,4}\d{0,3}-\d{3,5})\b/i;
const unitArg = (q: string) => { const m = q.match(UNIT_REF); return m ? m[1].toUpperCase() : undefined; };
const productArg = (q: string) => { const m = q.match(/\b(C\d{2}|SPR|Sprinter)\b/i); return m ? m[1] : undefined; };

/** The Assistant's manufacturing questions (B55) → one allow-listed intent of mfg_assistant (+ argument). */
export function mfgIntent(q: string, context?: { unit?: string }): { intent: string; arg?: string } | null {
  const s = q.toLowerCase().replace(/\s+/g, " ").trim();
  const ref = unitArg(q) || context?.unit || productArg(q);
  const unitWord = /(unit|build|this one|юнит|издели|сборк|одиниц|виріб|збірк|الوحدة|وحدة)/;
  if (/(what are we building|what is being built|что (мы )?(сейчас )?собираем|что в сборке|що (ми )?збираємо|ماذا نبني)/.test(s)) return { intent: "building" };
  if (/(manufacturing risk|production risk|build risk|риск\w* (производств|сборк)|ризик\w* (виробництв|збірк)|مخاطر التصنيع)/.test(s)) return { intent: "risks" };
  if (/(bom|спецификац|специфікац|قائمة المواد)/.test(s) && /(revision|rev\.?|ревизи|редакц|ревізі|مراجعة)\s*[a-z]{1,2}\s*(to|→|->|-|на|до|إلى)\s*[a-z]{1,2}\b/i.test(s)) return { intent: "bom_diff", arg: q.replace(/[?؟.!]+$/, "").trim() };
  if (/(different from the (approved )?bom|bom vs\.? as.?built|planned vs\.? built|отлича\w* от (утвержд\w* )?(спецификац|bom)|відрізня\w* від (затвердж\w* )?(специфікац|bom)|يختلف عن)/.test(s)) return { intent: "diff_bom", arg: ref };
  if (/(inspection|инспекц|контрол\w* качеств|інспекц|فحص)/.test(s) && /(fail|не прошл|провал|не пройш|فشل)/.test(s)) return { intent: "failed_inspections" };
  if (/(test|тест|испытан|випробуван|اختبار)/.test(s) && /(fail|не прошл|провал|не пройш|فشل)/.test(s)) return { intent: "failed_tests" };
  if (/(purchase order|\bpo\b|\bpos\b|заказ\w* поставщик|закупк|замовлен\w* постачальник|أوامر الشراء)/.test(s) && /(late|overdue|опазд|просроч|запізн|простроч|متأخر)/.test(s)) return { intent: "late_pos", arg: ref };
  if (/(not arrived|has not arrived|haven't arrived|не пришл|не поступил|не прибул|не надійшл|لم يصل)/.test(s)) return { intent: "not_arrived", arg: ref };
  if (/(missing|short(age)?|не хватает|нехватк|дефицит|бракує|нестач|ناقص|نقص)/.test(s) && /(material|part|component|материал|детал|комплект|матеріал|детал|مواد|قطع)/.test(s)) return { intent: "missing", arg: ref };
  if (/(serial|серийн|серійн|الرقم التسلسلي)/.test(s)) return { intent: "serials", arg: ref };
  if (/(software|firmware|прошивк|программн|програмн|برنامج|البرمجيات)/.test(s) && /(version|верси|версі|إصدار|on|на)/.test(s)) return { intent: "software", arg: ref };
  if (/(installed|установлен|встановлен|مثبت)/.test(s)) return { intent: "installed", arg: ref };
  if (/(ready for acceptance|готов\w*.{0,40}к при[её]мк|готов\w*.{0,40}до приймання|جاهز للقبول)/.test(s)) return { intent: "ready_acceptance", arg: ref };
  if (/(ready for (shipment|shipping)|готов\w*.{0,40}к отгрузк|готов\w*.{0,40}до відвантаж|جاهز للشحن)/.test(s)) return { intent: "ready_shipment", arg: ref };
  if (/(what is blocking|what blocks|blocked|что блокирует|что мешает|що блокує|ما الذي يعيق)/.test(s) && (ref || unitWord.test(s))) return { intent: "blocking", arg: ref };
  if (/(status of|состояни|статус|стан |حالة)/.test(s) && ref && UNIT_REF.test(q)) return { intent: "status", arg: ref };
  return null;
}

/** Build unit lifecycle words (the statuses themselves come from the database settings). */
export const STATUS_T: Record<string, T4> = {
  Planned: L("Planned", "Запланирован", "Заплановано", "مخطط"), Engineering: L("Engineering", "Инженерия", "Інженерія", "هندسة"),
  "Material Planning": L("Material planning", "Планирование материалов", "Планування матеріалів", "تخطيط المواد"), Procurement: L("Procurement", "Закупка", "Закупівля", "المشتريات"),
  "Ready for Build": L("Ready for build", "Готов к сборке", "Готово до збірки", "جاهز للبناء"), Assembly: L("Assembly", "Сборка", "Збирання", "التجميع"),
  Integration: L("Integration", "Интеграция", "Інтеграція", "التكامل"), Inspection: L("Inspection", "Инспекция", "Інспекція", "الفحص"), Testing: L("Testing", "Испытания", "Випробування", "الاختبار"),
  Rework: L("Rework", "Доработка", "Доопрацювання", "إعادة العمل"), Acceptance: L("Acceptance", "Приёмка", "Приймання", "القبول"),
  "Ready for Shipment": L("Ready for shipment", "Готов к отгрузке", "Готово до відвантаження", "جاهز للشحن"), Shipped: L("Shipped", "Отгружен", "Відвантажено", "تم الشحن"),
  Delivered: L("Delivered", "Доставлен", "Доставлено", "تم التسليم"), Hold: L("Hold", "Пауза", "Пауза", "معلق"), Cancelled: L("Cancelled", "Отменён", "Скасовано", "ملغى"),
};

export const W = {
  title: L("Manufacturing", "Производство", "Виробництво", "التصنيع"),
  shop: L("Shop floor", "Цех", "Цех", "أرضية المصنع"),
  dashboard: L("Dashboard", "Обзор", "Огляд", "لوحة"), units: L("Build units", "Изделия", "Вироби", "وحدات البناء"),
  products: L("Products", "Продукты", "Продукти", "المنتجات"), boms: L("BOMs", "Спецификации", "Специфікації", "قوائم المواد"),
  materials: L("Materials", "Материалы", "Матеріали", "المواد"), inventory: L("Inventory", "Склад", "Склад", "المخزون"),
  quality: L("Quality", "Качество", "Якість", "الجودة"), tests: L("Tests", "Испытания", "Випробування", "الاختبارات"),
  changes: L("Changes", "Изменения", "Зміни", "التغييرات"), review: L("Weekly review", "Недельный обзор", "Тижневий огляд", "المراجعة الأسبوعية"),
  labels: L("Labels & import", "Этикетки и импорт", "Етикетки та імпорт", "الملصقات والاستيراد"), settings: L("Settings", "Настройки", "Налаштування", "الإعدادات"),
  find: L("Find", "Найти", "Знайти", "بحث"), none: L("Nothing here", "Здесь пусто", "Тут порожньо", "لا شيء هنا"),
  open: L("Open", "Открыть", "Відкрити", "فتح"), close: L("Close", "Закрыть", "Закрити", "إغلاق"), save: L("Save", "Сохранить", "Зберегти", "حفظ"),
  confirm: L("Confirm", "Подтвердить", "Підтвердити", "تأكيد"), cancel: L("Cancel", "Отмена", "Скасувати", "إلغاء"),
  reason: L("Reason", "Причина", "Причина", "السبب"), notes: L("Notes", "Заметки", "Нотатки", "ملاحظات"),
  status: L("Status", "Статус", "Статус", "الحالة"), product: L("Product", "Продукт", "Продукт", "المنتج"), config: L("Configuration", "Конфигурация", "Конфігурація", "التهيئة"),
  bom: L("BOM", "Спецификация", "Специфікація", "قائمة المواد"), target: L("Target date", "Целевая дата", "Цільова дата", "التاريخ المستهدف"),
  owner: L("Owner", "Ответственный", "Відповідальний", "المسؤول"), blockers: L("Blockers", "Блокеры", "Блокери", "العوائق"),
  readiness: L("Readiness", "Готовность", "Готовність", "الجاهزية"), build: L("Build", "Сборка", "Збірка", "البناء"), acceptance: L("Acceptance", "Приёмка", "Приймання", "القبول"),
  shipment: L("Shipment", "Отгрузка", "Відвантаження", "الشحن"), qty: L("Qty", "Кол-во", "К-сть", "الكمية"), item: L("Item", "Позиция", "Позиція", "الصنف"),
  location: L("Location", "Место", "Місце", "الموقع"), state: L("State", "Состояние", "Стан", "الحالة"), serial: L("Serial", "Серийный №", "Серійний №", "الرقم التسلسلي"), lot: L("Lot", "Партия", "Партія", "الدفعة"),
  newUnit: L("New build unit", "Новое изделие", "Новий виріб", "وحدة بناء جديدة"), release: L("Release (pin configuration and BOM)", "Выпустить (закрепить конфигурацию и спецификацию)", "Випустити (закріпити конфігурацію та специфікацію)", "إصدار (تثبيت التهيئة وقائمة المواد)"),
  generateWork: L("Generate work orders from the routing", "Создать наряды по маршруту", "Створити наряди за маршрутом", "إنشاء أوامر العمل من المسار"),
  asbuiltGen: L("Record As-Built", "Зафиксировать As-Built", "Зафіксувати As-Built", "تسجيل الحالة كما بُنيت"),
  accept: L("Accept the unit", "Принять изделие", "Прийняти виріб", "قبول الوحدة"), shipRelease: L("Release shipment", "Разрешить отгрузку", "Дозволити відвантаження", "الإفراج عن الشحنة"),
  print: L("Print", "Печать", "Друк", "طباعة"), label: L("Label", "Этикетка", "Етикетка", "ملصق"), scan: L("Scan or type a code", "Сканировать или ввести код", "Сканувати або ввести код", "امسح أو اكتب رمزًا"),
  start: L("Start", "Начать", "Почати", "ابدأ"), complete: L("Complete", "Завершить", "Завершити", "أكمل"), block: L("Blocked", "Заблокировано", "Заблоковано", "معطل"), unblock: L("Unblock", "Разблокировать", "Розблокувати", "إلغاء التعطيل"),
  issue: L("Report an issue", "Сообщить о проблеме", "Повідомити про проблему", "الإبلاغ عن مشكلة"), evidence: L("Photos and files", "Фото и файлы", "Фото та файли", "الصور والملفات"),
  costLabel: L("Operational build cost — not accounting cost", "Операционная себестоимость сборки — не бухгалтерская", "Операційна собівартість збірки — не бухгалтерська", "تكلفة البناء التشغيلية — ليست تكلفة محاسبية"),
  noAccess: L("Manufacturing records are not open to you", "Производственные записи вам не открыты", "Виробничі записи вам не відкриті", "سجلات التصنيع غير متاحة لك"),
  confirmNote: L("Workspace records this with your name and time; it cannot be undone silently.", "Workspace запишет это с вашим именем и временем; незаметно отменить нельзя.", "Workspace запише це з вашим ім'ям і часом; непомітно скасувати не можна.", "يسجل Workspace هذا باسمك ووقتك؛ لا يمكن التراجع عنه بصمت."),
};

export const TABS: [string, T4][] = [
  ["overview", L("Overview", "Обзор", "Огляд", "نظرة عامة")], ["bom", L("BOM", "Спецификация", "Специфікація", "قائمة المواد")], ["materials", L("Materials", "Материалы", "Матеріали", "المواد")],
  ["work", L("Work orders", "Наряды", "Наряди", "أوامر العمل")], ["installed", L("Installed", "Установлено", "Встановлено", "المثبت")], ["inspections", L("Inspections", "Инспекции", "Інспекції", "الفحوص")],
  ["tests", L("Tests", "Испытания", "Випробування", "الاختبارات")], ["software", L("Software", "ПО", "ПЗ", "البرمجيات")], ["issues", L("Issues", "Проблемы", "Проблеми", "المشكلات")],
  ["changes", L("Changes", "Изменения", "Зміни", "التغييرات")], ["asbuilt", L("As-Built", "As-Built", "As-Built", "كما بُني")], ["documents", L("Documents & shipping", "Документы и отгрузка", "Документи та відвантаження", "المستندات والشحن")],
  ["cost", L("Cost", "Затраты", "Витрати", "التكلفة")], ["history", L("History", "История", "Історія", "السجل")],
];

/** Dashboard blocks: [overview key, list kind, words]. Every number opens the list behind it. */
export const DASH: [string, string, T4][] = [
  ["units", "units", L("Active units", "Активные изделия", "Активні вироби", "الوحدات النشطة")], ["ready_for_build", "ready_for_build", L("Ready for build", "Готовы к сборке", "Готові до збірки", "جاهزة للبناء")],
  ["in_assembly", "in_assembly", L("In build", "В сборке", "У збиранні", "قيد البناء")], ["blocked", "blocked", L("Blocked", "Заблокированы", "Заблоковані", "معطلة")],
  ["shortages", "shortages", L("Material shortage", "Нехватка материалов", "Нестача матеріалів", "نقص المواد")], ["late_purchases", "late_purchases", L("Late purchases", "Опаздывающие закупки", "Запізнілі закупівлі", "مشتريات متأخرة")],
  ["inspections_required", "inspections_required", L("Inspections due", "Инспекции к проведению", "Інспекції до проведення", "فحوص مستحقة")], ["nonconformances", "nonconformances", L("Open nonconformances", "Открытые несоответствия", "Відкриті невідповідності", "حالات عدم مطابقة مفتوحة")],
  ["failed_tests", "failed_tests", L("Failed tests", "Проваленные испытания", "Провалені випробування", "اختبارات فاشلة")], ["ready_acceptance", "ready_acceptance", L("Ready for acceptance", "Готовы к приёмке", "Готові до приймання", "جاهزة للقبول")],
  ["ready_shipment", "ready_shipment", L("Ready for shipment", "Готовы к отгрузке", "Готові до відвантаження", "جاهزة للشحن")], ["late", "late", L("Late units", "Опаздывающие изделия", "Запізнілі вироби", "وحدات متأخرة")],
];
