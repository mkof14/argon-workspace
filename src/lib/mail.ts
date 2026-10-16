// AGRON branded email templates and renderer.
// Templates are written in English and Russian; Ukrainian and Arabic are produced with "Translate (AI)".
// Variables use {{name}}. Sender variables are filled from the user's profile.

export type ML = { en: string; ru: string; uk?: string; ar?: string };
export type MailTemplate = {
  id: string; cat: string; name: ML; subject: ML; pre?: ML; heading?: ML; body: ML;
  cta?: { label: ML; url: string }; system?: boolean; custom?: boolean;
};

export const SITE = "https://workspace.agron1.com";
export const LOGO = `${SITE}/email/logo.png`;

export const MAIL_CATS: Record<string, { label: ML; color: string; icon: string }> = {
  sales: { label: { en: "Sales & clients", ru: "Продажи и клиенты" }, color: "#8B5CF6", icon: "handshake" },
  projects: { label: { en: "Projects & delivery", ru: "Проекты и поставка" }, color: "#F26B1D", icon: "container" },
  service: { label: { en: "Service & support", ru: "Сервис и поддержка" }, color: "#0FA3A3", icon: "headset" },
  finance: { label: { en: "Finance", ru: "Финансы" }, color: "#12A06B", icon: "coins" },
  partners: { label: { en: "Partners & vendors", ru: "Партнёры и поставщики" }, color: "#2F7DF6", icon: "store" },
  compliance: { label: { en: "Compliance", ru: "Комплаенс" }, color: "#C9971C", icon: "scale" },
  investors: { label: { en: "Investors", ru: "Инвесторы" }, color: "#16A34A", icon: "trend" },
  marketing: { label: { en: "Marketing & events", ru: "Маркетинг и события" }, color: "#E0458B", icon: "megaphone" },
  hr: { label: { en: "People & HR", ru: "Команда и HR" }, color: "#0EA5E9", icon: "users" },
  general: { label: { en: "General", ru: "Общие" }, color: "#5B6CF0", icon: "mail" },
  system: { label: { en: "Sign-in emails (Supabase)", ru: "Письма входа (Supabase)" }, color: "#64748B", icon: "lock" },
  custom: { label: { en: "Saved templates", ru: "Сохранённые шаблоны" }, color: "#F59E0B", icon: "edit" },
};

const T = (o: Omit<MailTemplate, "cat">, cat: string): MailTemplate => ({ ...o, cat });

export const TEMPLATES: MailTemplate[] = [
  // ---------------- Sales & clients ----------------
  T({ id: "intro", name: { en: "First introduction", ru: "Первое знакомство" },
    subject: { en: "AGRON StarDome — security for {{site_type}}", ru: "AGRON StarDome — защита для {{site_type}}" },
    pre: { en: "A container-based security system, built to order and installed in days.", ru: "Контейнерная система безопасности, собирается под заказ и устанавливается за дни." },
    heading: { en: "Security that arrives ready to work", ru: "Безопасность, которая приезжает готовой к работе" },
    body: {
      en: "Dear {{client_name}},\n\nAGRON Inc. builds **StarDome** — self-contained security containers that combine radar, cameras, sensors and the **AGRON 1** monitoring software in one unit for {{site_type}}.\n\nWhy owners and operators choose StarDome:\n- One container, one contract: equipment, integration, installation and service\n- Five configurations, from C20 Base to C40 HQ, matched to the site\n- Purchase, leasing or subscription\n- Passive detection and monitoring designed around local regulations\n\nWould a 20-minute call next week be useful? We can show how StarDome would cover {{site_name}}.",
      ru: "Уважаемый(ая) {{client_name}},\n\nкомпания AGRON Inc. создаёт **StarDome** — автономные контейнеры безопасности: радар, камеры, датчики и программа мониторинга **AGRON 1** в одном модуле для {{site_type}}.\n\nПочему выбирают StarDome:\n- Один контейнер и один договор: оборудование, интеграция, монтаж и сервис\n- Пять конфигураций — от C20 Base до C40 HQ — под конкретный объект\n- Покупка, лизинг или подписка\n- Пассивное обнаружение и мониторинг с учётом местных правил\n\nУдобно ли созвониться на 20 минут на следующей неделе? Покажем, как StarDome закроет задачи {{site_name}}." },
    cta: { label: { en: "Book a call", ru: "Назначить звонок" }, url: "{{meeting_link}}" } }, "sales"),
  T({ id: "after_meeting", name: { en: "Thank you after meeting", ru: "Спасибо за встречу" },
    subject: { en: "Thank you for the meeting — next steps", ru: "Спасибо за встречу — следующие шаги" },
    body: {
      en: "Dear {{client_name}},\n\nThank you for your time today. Here is a short summary of what we agreed:\n- {{point_1}}\n- {{point_2}}\n- {{point_3}}\n\nNext step: {{next_step}} by {{date}}.\n\nI've attached the materials we discussed. Please let me know if anything should be added.",
      ru: "Уважаемый(ая) {{client_name}},\n\nблагодарю за уделённое время. Кратко о том, что мы согласовали:\n- {{point_1}}\n- {{point_2}}\n- {{point_3}}\n\nСледующий шаг: {{next_step}} до {{date}}.\n\nПрилагаю материалы, о которых мы говорили. Если что-то нужно добавить — напишите." } }, "sales"),
  T({ id: "proposal", name: { en: "Commercial proposal", ru: "Коммерческое предложение" },
    subject: { en: "Proposal {{proposal_no}} — StarDome {{config}} for {{site_name}}", ru: "Предложение {{proposal_no}} — StarDome {{config}} для {{site_name}}" },
    heading: { en: "Your StarDome proposal", ru: "Ваше предложение StarDome" },
    body: {
      en: "Dear {{client_name}},\n\nPlease find our proposal **{{proposal_no}}** for a StarDome **{{config}}** system at {{site_name}}.\n\n- Total: **{{amount}} {{currency}}**\n- Delivery: {{lead_time}} from order\n- Options: purchase, leasing or subscription\n- Valid until: {{valid_until}}\n\nThe final configuration is confirmed after a site survey and the required export and end-user checks.",
      ru: "Уважаемый(ая) {{client_name}},\n\nнаправляем предложение **{{proposal_no}}** на систему StarDome **{{config}}** для {{site_name}}.\n\n- Сумма: **{{amount}} {{currency}}**\n- Срок поставки: {{lead_time}} с момента заказа\n- Варианты: покупка, лизинг или подписка\n- Действует до: {{valid_until}}\n\nОкончательная конфигурация подтверждается после обследования объекта и обязательных экспортных проверок и проверки конечного пользователя." },
    cta: { label: { en: "Open the proposal", ru: "Открыть предложение" }, url: "{{proposal_link}}" } }, "sales"),
  T({ id: "followup", name: { en: "Proposal follow-up", ru: "Напоминание о предложении" },
    subject: { en: "Following up on proposal {{proposal_no}}", ru: "По предложению {{proposal_no}}" },
    body: {
      en: "Dear {{client_name}},\n\nI wanted to follow up on our proposal {{proposal_no}} sent on {{date}}. Do you have any questions about the configuration, timeline or financing options?\n\nIf it helps, we can arrange a short call with our engineer to walk through the site layout.",
      ru: "Уважаемый(ая) {{client_name}},\n\nхотел(а) уточнить по нашему предложению {{proposal_no}} от {{date}}. Остались ли вопросы по конфигурации, срокам или вариантам финансирования?\n\nМожем организовать короткий звонок с нашим инженером, чтобы разобрать схему объекта." } }, "sales"),
  T({ id: "leasing", name: { en: "Leasing & financing offer", ru: "Предложение лизинга" },
    subject: { en: "Financing options for StarDome {{config}}", ru: "Варианты финансирования StarDome {{config}}" },
    body: {
      en: "Dear {{client_name}},\n\nAs discussed, here are the ways to acquire StarDome {{config}}:\n- **Purchase:** {{amount}} {{currency}}\n- **Operating lease:** from {{monthly}} {{currency}} per month for {{term}} months, service included\n- **Subscription:** equipment, software and support as one monthly fee\n\nFinancing is provided with our partner {{financier}} and is subject to approval and standard compliance checks.",
      ru: "Уважаемый(ая) {{client_name}},\n\nкак договаривались, направляем варианты приобретения StarDome {{config}}:\n- **Покупка:** {{amount}} {{currency}}\n- **Операционный лизинг:** от {{monthly}} {{currency}} в месяц на {{term}} мес., сервис включён\n- **Подписка:** оборудование, ПО и поддержка за единый ежемесячный платёж\n\nФинансирование предоставляется с партнёром {{financier}} после одобрения и стандартных проверок комплаенса." } }, "sales"),

  // ---------------- Projects & delivery ----------------
  T({ id: "order_confirm", name: { en: "Order confirmation", ru: "Подтверждение заказа" },
    subject: { en: "Order confirmed — StarDome {{config}} ({{order_no}})", ru: "Заказ подтверждён — StarDome {{config}} ({{order_no}})" },
    heading: { en: "Welcome aboard", ru: "Добро пожаловать" },
    body: {
      en: "Dear {{client_name}},\n\nThank you for choosing AGRON. Your order **{{order_no}}** for StarDome **{{config}}** is confirmed.\n\nWhat happens next:\n- Project kick-off call: {{kickoff_date}}\n- Site survey and final design\n- Assembly, integration and factory acceptance test\n- Delivery and installation: target {{delivery_date}}\n\nYour project manager is {{pm_name}} ({{pm_email}}).",
      ru: "Уважаемый(ая) {{client_name}},\n\nблагодарим за выбор AGRON. Ваш заказ **{{order_no}}** на StarDome **{{config}}** подтверждён.\n\nДальнейшие шаги:\n- Стартовый звонок по проекту: {{kickoff_date}}\n- Обследование объекта и финальный проект\n- Сборка, интеграция и заводские испытания\n- Доставка и монтаж: ориентировочно {{delivery_date}}\n\nВаш руководитель проекта — {{pm_name}} ({{pm_email}})." } }, "projects"),
  T({ id: "progress", name: { en: "Build progress update", ru: "Отчёт о ходе сборки" },
    subject: { en: "Progress update — {{order_no}}: {{stage}}", ru: "Ход работ — {{order_no}}: {{stage}}" },
    body: {
      en: "Dear {{client_name}},\n\nYour StarDome is now at the **{{stage}}** stage.\n\nCompleted this period:\n- {{done_1}}\n- {{done_2}}\n\nNext: {{next_step}}. The delivery date remains **{{delivery_date}}**.",
      ru: "Уважаемый(ая) {{client_name}},\n\nваш StarDome сейчас на этапе **{{stage}}**.\n\nВыполнено за период:\n- {{done_1}}\n- {{done_2}}\n\nДалее: {{next_step}}. Срок поставки без изменений — **{{delivery_date}}**." } }, "projects"),
  T({ id: "shipment", name: { en: "Shipment notice", ru: "Уведомление об отгрузке" },
    subject: { en: "Your StarDome has shipped — {{order_no}}", ru: "Ваш StarDome отгружен — {{order_no}}" },
    body: {
      en: "Dear {{client_name}},\n\nYour StarDome **{{config}}** has left {{from}} for {{to}}.\n\n- Carrier: {{carrier}}\n- Tracking / B/L: {{tracking}}\n- Estimated arrival: **{{eta}}**\n- Incoterms: {{incoterms}}\n\nOur installation team will contact you to confirm site access and approvals.",
      ru: "Уважаемый(ая) {{client_name}},\n\nваш StarDome **{{config}}** отправлен из {{from}} в {{to}}.\n\n- Перевозчик: {{carrier}}\n- Трекинг / коносамент: {{tracking}}\n- Ожидаемое прибытие: **{{eta}}**\n- Инкотермс: {{incoterms}}\n\nНаша монтажная команда свяжется с вами, чтобы согласовать доступ на объект и разрешения." },
    cta: { label: { en: "Track shipment", ru: "Отследить груз" }, url: "{{tracking_link}}" } }, "projects"),
  T({ id: "handover", name: { en: "Commissioning & handover", ru: "Ввод в эксплуатацию" },
    subject: { en: "StarDome commissioned at {{site_name}}", ru: "StarDome введён в эксплуатацию на {{site_name}}" },
    heading: { en: "Your system is live", ru: "Система работает" },
    body: {
      en: "Dear {{client_name}},\n\nStarDome at **{{site_name}}** passed site acceptance on {{date}} and is now in service.\n\nYour handover pack includes:\n- Site acceptance report\n- Operator guide and AGRON 1 accounts\n- Warranty certificate (until {{warranty_end}})\n- Service plan: **{{sla}}**\n\nSupport: {{support_email}} · {{support_phone}}.",
      ru: "Уважаемый(ая) {{client_name}},\n\nStarDome на объекте **{{site_name}}** прошёл приёмку {{date}} и введён в эксплуатацию.\n\nВ пакет передачи входят:\n- Акт приёмки на объекте\n- Руководство оператора и учётные записи AGRON 1\n- Гарантийный сертификат (до {{warranty_end}})\n- Сервисный план: **{{sla}}**\n\nПоддержка: {{support_email}} · {{support_phone}}." } }, "projects"),

  // ---------------- Service ----------------
  T({ id: "ticket_open", name: { en: "Support request received", ru: "Заявка в поддержку принята" },
    subject: { en: "[Ticket {{ticket_no}}] We've received your request", ru: "[Заявка {{ticket_no}}] Мы получили ваш запрос" },
    body: {
      en: "Dear {{client_name}},\n\nWe've registered your request **{{ticket_no}}**: {{issue}}.\n\n- Priority: {{severity}}\n- Response within: {{response_time}}\n- Engineer: {{engineer}}\n\nReply to this email to add details or photos.",
      ru: "Уважаемый(ая) {{client_name}},\n\nмы зарегистрировали вашу заявку **{{ticket_no}}**: {{issue}}.\n\n- Приоритет: {{severity}}\n- Ответ в течение: {{response_time}}\n- Инженер: {{engineer}}\n\nОтветьте на это письмо, чтобы добавить подробности или фото." } }, "service"),
  T({ id: "ticket_done", name: { en: "Support request resolved", ru: "Заявка решена" },
    subject: { en: "[Ticket {{ticket_no}}] Resolved", ru: "[Заявка {{ticket_no}}] Решена" },
    body: {
      en: "Dear {{client_name}},\n\nYour request {{ticket_no}} has been resolved.\n\n**What we did:** {{resolution}}\n\nIf anything is still not right, just reply and we'll reopen it.",
      ru: "Уважаемый(ая) {{client_name}},\n\nваша заявка {{ticket_no}} решена.\n\n**Что сделано:** {{resolution}}\n\nЕсли что-то всё ещё не так — ответьте на письмо, и мы откроем заявку снова." } }, "service"),
  T({ id: "maintenance", name: { en: "Scheduled maintenance", ru: "Плановое обслуживание" },
    subject: { en: "Scheduled service visit — {{site_name}}, {{date}}", ru: "Плановое ТО — {{site_name}}, {{date}}" },
    body: {
      en: "Dear {{client_name}},\n\nUnder your {{sla}} service plan, our engineer will visit **{{site_name}}** on **{{date}}** ({{time_window}}).\n\nThe visit takes about {{duration}}. Monitoring stays active, with short sensor restarts. Please confirm access or propose another time.",
      ru: "Уважаемый(ая) {{client_name}},\n\nв рамках сервисного плана {{sla}} наш инженер посетит **{{site_name}}** **{{date}}** ({{time_window}}).\n\nРабота займёт около {{duration}}. Мониторинг продолжит работать, возможны кратковременные перезапуски датчиков. Подтвердите, пожалуйста, доступ или предложите другое время." } }, "service"),

  // ---------------- Finance ----------------
  T({ id: "invoice", name: { en: "Invoice issued", ru: "Выставлен счёт" },
    subject: { en: "Invoice {{invoice_no}} from AGRON Inc.", ru: "Счёт {{invoice_no}} от AGRON Inc." },
    body: {
      en: "Dear {{client_name}},\n\nPlease find invoice **{{invoice_no}}** for {{description}}.\n\n- Amount: **{{amount}} {{currency}}**\n- Due date: **{{due_date}}**\n- Bank details are on the invoice\n\nPlease quote the invoice number with your payment.",
      ru: "Уважаемый(ая) {{client_name}},\n\nнаправляем счёт **{{invoice_no}}** за {{description}}.\n\n- Сумма: **{{amount}} {{currency}}**\n- Срок оплаты: **{{due_date}}**\n- Банковские реквизиты указаны в счёте\n\nПросим указать номер счёта в назначении платежа." },
    cta: { label: { en: "View invoice", ru: "Открыть счёт" }, url: "{{invoice_link}}" } }, "finance"),
  T({ id: "reminder", name: { en: "Payment reminder", ru: "Напоминание об оплате" },
    subject: { en: "Reminder: invoice {{invoice_no}} due {{due_date}}", ru: "Напоминание: счёт {{invoice_no}}, срок {{due_date}}" },
    body: {
      en: "Dear {{client_name}},\n\nA friendly reminder that invoice {{invoice_no}} for **{{amount}} {{currency}}** is due on {{due_date}}.\n\nIf payment has already been sent, thank you, and please ignore this note.",
      ru: "Уважаемый(ая) {{client_name}},\n\nнапоминаем, что срок оплаты счёта {{invoice_no}} на **{{amount}} {{currency}}** — {{due_date}}.\n\nЕсли оплата уже отправлена — спасибо, просто не обращайте внимания на это письмо." } }, "finance"),
  T({ id: "paid", name: { en: "Payment received", ru: "Оплата получена" },
    subject: { en: "Payment received — thank you", ru: "Оплата получена — спасибо" },
    body: {
      en: "Dear {{client_name}},\n\nWe've received your payment of **{{amount}} {{currency}}** for invoice {{invoice_no}}. Thank you.\n\nA receipt is attached for your records.",
      ru: "Уважаемый(ая) {{client_name}},\n\nмы получили оплату **{{amount}} {{currency}}** по счёту {{invoice_no}}. Благодарим!\n\nКвитанция приложена." } }, "finance"),

  // ---------------- Partners & vendors ----------------
  T({ id: "rfq", name: { en: "Request for quotation (RFQ)", ru: "Запрос цены (RFQ)" },
    subject: { en: "RFQ {{rfq_no}} — {{item}}", ru: "Запрос цены {{rfq_no}} — {{item}}" },
    body: {
      en: "Dear {{contact_name}},\n\nAGRON Inc. requests a quotation for:\n- Item: **{{item}}** ({{model}})\n- Quantity: {{qty}}\n- Delivery to: {{delivery_place}}\n- Required by: {{date}}\n\nPlease include unit price, lead time, warranty, **ECCN / export classification**, country of origin and HS code. Quotes by {{reply_by}}, please.",
      ru: "Уважаемый(ая) {{contact_name}},\n\nAGRON Inc. просит предоставить коммерческое предложение:\n- Позиция: **{{item}}** ({{model}})\n- Количество: {{qty}}\n- Доставка: {{delivery_place}}\n- Нужно к: {{date}}\n\nУкажите, пожалуйста, цену за единицу, срок поставки, гарантию, **ECCN / экспортную классификацию**, страну происхождения и код HS. Ждём ответ до {{reply_by}}." } }, "partners"),
  T({ id: "po", name: { en: "Purchase order", ru: "Заказ поставщику" },
    subject: { en: "Purchase order {{po_no}} — AGRON Inc.", ru: "Заказ {{po_no}} — AGRON Inc." },
    body: {
      en: "Dear {{contact_name}},\n\nPlease find purchase order **{{po_no}}** attached.\n\n- {{item}} × {{qty}}\n- Total: {{amount}} {{currency}}\n- Delivery: {{delivery_place}} by {{date}}\n- Incoterms: {{incoterms}}\n\nPlease confirm acceptance and the shipping date within two business days.",
      ru: "Уважаемый(ая) {{contact_name}},\n\nво вложении заказ **{{po_no}}**.\n\n- {{item}} × {{qty}}\n- Сумма: {{amount}} {{currency}}\n- Доставка: {{delivery_place}} до {{date}}\n- Инкотермс: {{incoterms}}\n\nПросим подтвердить заказ и дату отгрузки в течение двух рабочих дней." } }, "partners"),
  T({ id: "nda", name: { en: "NDA request", ru: "Запрос на NDA" },
    subject: { en: "Mutual NDA — AGRON Inc. and {{company}}", ru: "Взаимное NDA — AGRON Inc. и {{company}}" },
    body: {
      en: "Dear {{contact_name}},\n\nBefore we share technical details, please review and sign the attached mutual NDA between AGRON Inc. and {{company}}.\n\nIt includes standard export-control language: technical data may be shared only with persons authorised under US export regulations.",
      ru: "Уважаемый(ая) {{contact_name}},\n\nпрежде чем обмениваться техническими деталями, просим ознакомиться и подписать взаимное NDA между AGRON Inc. и {{company}} (во вложении).\n\nВ нём есть стандартные положения об экспортном контроле: технические данные передаются только лицам, допущенным по экспортным правилам США." } }, "partners"),
  T({ id: "partner_welcome", name: { en: "Partner onboarding", ru: "Приветствие партнёра" },
    subject: { en: "Welcome to the AGRON partner network", ru: "Добро пожаловать в партнёрскую сеть AGRON" },
    heading: { en: "Welcome, partner", ru: "Добро пожаловать, партнёр" },
    body: {
      en: "Dear {{contact_name}},\n\nWe're glad to welcome **{{company}}** as an AGRON {{partner_type}} in {{region}}.\n\nYou now have access to the partner area of AGRON Workspace with:\n- Approved presentations, brochures and videos\n- Price list and proposal templates\n- Support requests for your clients\n\nQuestions: info@agron1.com.",
      ru: "Уважаемый(ая) {{contact_name}},\n\nрады приветствовать **{{company}}** в качестве {{partner_type}} AGRON в регионе {{region}}.\n\nВам открыт партнёрский раздел AGRON Workspace:\n- Утверждённые презентации, буклеты и видео\n- Прайс-лист и шаблоны предложений\n- Заявки в поддержку для ваших клиентов\n\nВопросы: info@agron1.com." },
    cta: { label: { en: "Open the workspace", ru: "Открыть кабинет" }, url: SITE } }, "partners"),

  // ---------------- Compliance ----------------
  T({ id: "kyc", name: { en: "End-user & KYC information", ru: "Данные конечного пользователя (KYC)" },
    subject: { en: "End-user information for order {{order_no}}", ru: "Данные конечного пользователя по заказу {{order_no}}" },
    body: {
      en: "Dear {{client_name}},\n\nUS and UAE export rules require us to confirm the end user before delivery. Please send:\n- Legal name and registration of the end user\n- Ultimate beneficial owners\n- Vessel name and IMO number, or site address\n- Intended use and location of operation\n- A signed end-user statement (template attached)\n\nThis is a standard step and does not delay your project if received by {{date}}.",
      ru: "Уважаемый(ая) {{client_name}},\n\nэкспортные правила США и ОАЭ требуют подтвердить конечного пользователя до поставки. Пожалуйста, пришлите:\n- Юридическое название и регистрационные данные конечного пользователя\n- Конечных бенефициаров\n- Название судна и номер IMO или адрес объекта\n- Назначение и место эксплуатации\n- Подписанное заявление конечного пользователя (шаблон во вложении)\n\nЭто стандартный шаг, и он не задержит проект, если данные придут до {{date}}." } }, "compliance"),

  // ---------------- Investors ----------------
  T({ id: "investor_update", name: { en: "Investor update", ru: "Отчёт для инвесторов" },
    subject: { en: "AGRON investor update — {{period}}", ru: "AGRON: отчёт для инвесторов — {{period}}" },
    heading: { en: "{{period}} at a glance", ru: "Итоги: {{period}}" },
    body: {
      en: "Dear {{investor_name}},\n\nHere is our update for {{period}}.\n\n**Highlights**\n- {{highlight_1}}\n- {{highlight_2}}\n- {{highlight_3}}\n\n**Numbers:** pipeline {{pipeline}}, containers in build {{builds}}, cash runway {{runway}} months.\n\n**Where you can help:** {{ask}}",
      ru: "Уважаемый(ая) {{investor_name}},\n\nнаш отчёт за {{period}}.\n\n**Главное**\n- {{highlight_1}}\n- {{highlight_2}}\n- {{highlight_3}}\n\n**Цифры:** воронка {{pipeline}}, контейнеров в сборке {{builds}}, запас денег на {{runway}} мес.\n\n**Чем вы можете помочь:** {{ask}}" } }, "investors"),
  T({ id: "meeting_request", name: { en: "Meeting request", ru: "Приглашение на встречу" },
    subject: { en: "Meeting request — {{topic}}", ru: "Приглашение на встречу — {{topic}}" },
    body: {
      en: "Dear {{contact_name}},\n\nI'd like to propose a meeting about **{{topic}}**.\n\n- Date: {{date}}\n- Time: {{time}} ({{timezone}})\n- Format: {{format}}\n\nIf this doesn't suit you, please suggest a time that works.",
      ru: "Уважаемый(ая) {{contact_name}},\n\nпредлагаю встретиться и обсудить **{{topic}}**.\n\n- Дата: {{date}}\n- Время: {{time}} ({{timezone}})\n- Формат: {{format}}\n\nЕсли время неудобно, предложите, пожалуйста, своё." },
    cta: { label: { en: "Join the meeting", ru: "Подключиться" }, url: "{{meeting_link}}" } }, "investors"),

  // ---------------- Marketing ----------------
  T({ id: "event_invite", name: { en: "Event invitation", ru: "Приглашение на выставку" },
    subject: { en: "Meet AGRON at {{event}} — {{city}}", ru: "Встретимся на {{event}} — {{city}}" },
    heading: { en: "See StarDome live", ru: "StarDome вживую" },
    body: {
      en: "Dear {{client_name}},\n\nAGRON will be at **{{event}}** in {{city}}, {{dates}}, stand **{{stand}}**.\n\nCome see StarDome and the AGRON 1 platform in action. Reply with a convenient time and we'll reserve a private demo for you.",
      ru: "Уважаемый(ая) {{client_name}},\n\nAGRON участвует в **{{event}}** в {{city}}, {{dates}}, стенд **{{stand}}**.\n\nПриходите посмотреть StarDome и платформу AGRON 1 в работе. Напишите удобное время, и мы забронируем для вас персональную демонстрацию." },
    cta: { label: { en: "Book a demo slot", ru: "Забронировать демо" }, url: "{{meeting_link}}" } }, "marketing"),
  T({ id: "materials", name: { en: "Sending materials", ru: "Отправка материалов" },
    subject: { en: "AGRON materials: {{material}}", ru: "Материалы AGRON: {{material}}" },
    body: {
      en: "Dear {{client_name}},\n\nAs promised, here is **{{material}}**.\n\n{{links}}\n\nThe links stay active for 7 days. Happy to walk you through it on a call.",
      ru: "Уважаемый(ая) {{client_name}},\n\nкак и обещали, направляем **{{material}}**.\n\n{{links}}\n\nСсылки действуют 7 дней. С удовольствием прокомментируем материалы на звонке." } }, "marketing"),
  T({ id: "newsletter", name: { en: "News & announcement", ru: "Новости и анонс" },
    subject: { en: "AGRON news: {{headline}}", ru: "Новости AGRON: {{headline}}" },
    heading: { en: "{{headline}}", ru: "{{headline}}" },
    body: {
      en: "{{intro}}\n\n- {{item_1}}\n- {{item_2}}\n- {{item_3}}\n\nThank you for being part of the AGRON story.",
      ru: "{{intro}}\n\n- {{item_1}}\n- {{item_2}}\n- {{item_3}}\n\nСпасибо, что вы с AGRON." },
    cta: { label: { en: "Read more", ru: "Подробнее" }, url: "https://www.agron1.com" } }, "marketing"),

  // ---------------- HR ----------------
  T({ id: "welcome_employee", name: { en: "Welcome new team member", ru: "Приветствие сотрудника" },
    subject: { en: "Welcome to AGRON, {{first_name}}!", ru: "Добро пожаловать в AGRON, {{first_name}}!" },
    heading: { en: "Welcome to the team", ru: "Добро пожаловать в команду" },
    body: {
      en: "Hi {{first_name}},\n\nWe're excited to have you join AGRON as **{{position}}** from {{start_date}}.\n\nYour first week:\n- Sign in to AGRON Workspace with this email address\n- Sign the NDA and complete the export-control briefing\n- Meet your team lead, {{manager}}\n\nAny questions — just reply.",
      ru: "Привет, {{first_name}}!\n\nРады, что ты присоединяешься к AGRON на позицию **{{position}}** с {{start_date}}.\n\nПервая неделя:\n- Войди в AGRON Workspace с этого адреса\n- Подпиши NDA и пройди инструктаж по экспортному контролю\n- Познакомься с руководителем — {{manager}}\n\nЕсли будут вопросы — просто ответь на письмо." },
    cta: { label: { en: "Sign in to Workspace", ru: "Войти в Workspace" }, url: SITE } }, "hr"),
  T({ id: "interview", name: { en: "Interview invitation", ru: "Приглашение на интервью" },
    subject: { en: "Interview invitation — {{position}} at AGRON", ru: "Приглашение на интервью — {{position}}, AGRON" },
    body: {
      en: "Dear {{candidate}},\n\nThank you for your interest in the **{{position}}** role. We'd like to invite you to an interview:\n- Date: {{date}}\n- Time: {{time}} ({{timezone}})\n- Format: {{format}}\n- With: {{interviewers}}\n\nPlease confirm or suggest another time.",
      ru: "Уважаемый(ая) {{candidate}},\n\nблагодарим за интерес к позиции **{{position}}**. Приглашаем вас на интервью:\n- Дата: {{date}}\n- Время: {{time}} ({{timezone}})\n- Формат: {{format}}\n- Участники: {{interviewers}}\n\nПодтвердите, пожалуйста, или предложите другое время." } }, "hr"),
  T({ id: "offer", name: { en: "Job offer", ru: "Предложение о работе" },
    subject: { en: "Your offer from AGRON Inc.", ru: "Ваше предложение от AGRON Inc." },
    body: {
      en: "Dear {{candidate}},\n\nWe're delighted to offer you the position of **{{position}}** at AGRON Inc. The offer letter with terms is attached.\n\nPlease review and reply by {{date}}. We look forward to working with you.",
      ru: "Уважаемый(ая) {{candidate}},\n\nрады предложить вам позицию **{{position}}** в AGRON Inc. Письмо-предложение с условиями во вложении.\n\nПросим ответить до {{date}}. Будем рады работать вместе." } }, "hr"),

  // ---------------- General ----------------
  T({ id: "blank", name: { en: "Blank branded letter", ru: "Пустое фирменное письмо" },
    subject: { en: "{{subject}}", ru: "{{subject}}" },
    body: { en: "Dear {{name}},\n\n{{message}}", ru: "Уважаемый(ая) {{name}},\n\n{{message}}" } }, "general"),
  T({ id: "thank_you", name: { en: "Thank you", ru: "Благодарность" },
    subject: { en: "Thank you, {{name}}", ru: "Спасибо, {{name}}" },
    body: { en: "Dear {{name}},\n\nThank you for {{reason}}. We truly appreciate it.", ru: "Уважаемый(ая) {{name}},\n\nблагодарим вас за {{reason}}. Мы это очень ценим." } }, "general"),

  // ---------------- Supabase sign-in emails ----------------
  T({ id: "sys_magic", system: true, name: { en: "Sign-in link (Magic Link)", ru: "Ссылка для входа (Magic Link)" },
    subject: { en: "Your AGRON Workspace sign-in link", ru: "Ссылка для входа в AGRON Workspace" },
    heading: { en: "Sign in to AGRON Workspace", ru: "Вход в AGRON Workspace" },
    body: { en: "Click the button below to sign in. The link works once and expires in 1 hour.\n\nIf you didn't request this, you can ignore this email.", ru: "Нажмите кнопку ниже, чтобы войти. Ссылка одноразовая и действует 1 час.\n\nЕсли вы не запрашивали вход, просто проигнорируйте письмо." },
    cta: { label: { en: "Sign in", ru: "Войти" }, url: "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email" } }, "system"),
  T({ id: "sys_invite", system: true, name: { en: "Invitation", ru: "Приглашение" },
    subject: { en: "You're invited to AGRON Workspace", ru: "Приглашение в AGRON Workspace" },
    heading: { en: "You're invited", ru: "Вас пригласили" },
    body: { en: "AGRON Inc. has invited you to its operating workspace: departments, documents, projects and the AGRON assistant in one place.\n\nYou don't need a password: click the button to accept.", ru: "AGRON Inc. приглашает вас в рабочее пространство компании: отделы, документы, проекты и ассистент AGRON в одном месте.\n\nПароль не нужен — нажмите кнопку, чтобы принять приглашение." },
    cta: { label: { en: "Accept invitation", ru: "Принять приглашение" }, url: "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite" } }, "system"),
  T({ id: "sys_confirm", system: true, name: { en: "Confirm sign-up", ru: "Подтверждение регистрации" },
    subject: { en: "Confirm your AGRON Workspace email", ru: "Подтвердите email для AGRON Workspace" },
    heading: { en: "Confirm your email", ru: "Подтвердите email" },
    body: { en: "Please confirm this email address to finish creating your AGRON Workspace access.", ru: "Подтвердите этот адрес, чтобы завершить создание доступа к AGRON Workspace." },
    cta: { label: { en: "Confirm email", ru: "Подтвердить" }, url: "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email" } }, "system"),
  T({ id: "sys_reset", system: true, name: { en: "Reset password", ru: "Сброс пароля" },
    subject: { en: "Set a new AGRON Workspace password", ru: "Новый пароль для AGRON Workspace" },
    heading: { en: "Set a new password", ru: "Задайте новый пароль" },
    body: { en: "We received a request to reset the password for this email. Click the button to set a new one. The link works once and expires in 1 hour.\n\nIf you didn't ask for this, ignore this email: your password stays the same.", ru: "Мы получили запрос на сброс пароля для этого адреса. Нажмите кнопку, чтобы задать новый. Ссылка одноразовая и действует 1 час.\n\nЕсли вы не запрашивали сброс, просто проигнорируйте письмо — пароль не изменится." },
    cta: { label: { en: "Set new password", ru: "Задать пароль" }, url: "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset" } }, "system"),
  T({ id: "sys_change", system: true, name: { en: "Change email", ru: "Смена email" },
    subject: { en: "Confirm your new email address", ru: "Подтвердите новый адрес" },
    heading: { en: "Confirm email change", ru: "Подтвердите смену email" },
    body: { en: "Click below to confirm the change of your AGRON Workspace email to {{ .NewEmail }}.", ru: "Нажмите кнопку, чтобы подтвердить смену email в AGRON Workspace на {{ .NewEmail }}." },
    cta: { label: { en: "Confirm change", ru: "Подтвердить" }, url: "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change" } }, "system"),
];

/* ---------------- Rendering ---------------- */
export const pick = (m: ML | undefined, lang: string) => (m ? (m as any)[lang] || m.en : "");

export function varsOf(...texts: string[]) {
  const set = new Set<string>();
  for (const s of texts) for (const m of (s || "").matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)) set.add(m[1]);
  return [...set].filter((v) => !v.startsWith("sender_"));
}
export const fill = (s: string, v: Record<string, string>, keep = true) =>
  (s || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (all, k) => (v[k] ? v[k] : keep ? all : ""));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string, draft = false) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0E141A">$1</strong>')
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#E2561A;text-decoration:underline">$1</a>')
  .replace(/\{\{[^}]+\}\}/g, (m) => (draft ? `<span style="background:#FFF3C4;border-radius:3px;padding:0 3px">${m}</span>` : m));

function bodyHtml(text: string, draft: boolean) {
  const out: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const bullets = lines.filter((l) => /^\s*-\s+/.test(l));
    const lead = lines.filter((l) => !/^\s*-\s+/.test(l));
    if (lead.length) out.push(`<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#2A3440">${lead.map((l) => inline(l, draft)).join("<br>")}</p>`);
    if (bullets.length) out.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;width:100%">${bullets.map((b) =>
      `<tr><td style="width:22px;vertical-align:top;padding:5px 0"><div style="width:8px;height:8px;border-radius:2px;background:#FF6A2B;margin-top:8px"></div></td><td style="padding:4px 0;font-size:16px;line-height:1.6;color:#2A3440">${inline(b.replace(/^\s*-\s+/, ""), draft)}</td></tr>`).join("")}</table>`);
  }
  return out.join("\n");
}

export type Sender = { name: string; title?: string | null; email?: string; phone?: string | null };
/** All emails are signed by the company, never by a person. */
export const COMPANY: Sender = { name: "AGRON Inc.", email: "info@agron1.com" };

export function renderEmail(o: { subject: string; pre?: string; heading?: string; body: string; html?: string; cta?: { label: string; url: string } | null; lang: string; sender?: Sender | null; accent?: string; draft?: boolean }) {
  const rtl = o.lang === "ar";
  const dir = rtl ? "rtl" : "ltr", align = rtl ? "right" : "left";
  const acc = o.accent || "#FF6A2B";
  const font = rtl ? "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif" : "'IBM Plex Sans','Segoe UI',Helvetica,Arial,sans-serif";
  const L = (en: string, ru: string, uk: string, ar: string) => ({ en, ru, uk, ar } as any)[o.lang] || en;
  const sig = o.sender ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:4px"><tr><td style="font-size:15px;line-height:1.55;color:#2A3440">
<div style="font-weight:700;color:#0E141A;font-size:16px">AGRON Inc.</div>
<div style="font-size:14px"><a href="mailto:info@agron1.com" style="color:#E2561A;text-decoration:none">info@agron1.com</a> &nbsp;·&nbsp; <a href="https://www.agron1.com" style="color:#E2561A;text-decoration:none">agron1.com</a></div>
</td></tr></table>` : "";
  const cta = o.cta && o.cta.url ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 26px"><tr><td style="border-radius:10px;background:${acc}">
<a href="${esc(o.cta.url)}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(o.cta.label)}</a></td></tr></table>` : "";
  return `<!doctype html>
<html lang="${o.lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F4;font-family:${font}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.pre || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F4;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(17,24,32,.08)" dir="${dir}">
<tr><td style="background:#121820;background-image:linear-gradient(135deg,#121820 0%,#1D2833 100%);padding:26px 36px" align="${align}">
<img src="${LOGO}" width="220" alt="AGRON™ — Aerial-Ground Robotics Operations Network" style="display:block;width:220px;max-width:66%;height:auto;border:0"></td></tr>
<tr><td style="height:4px;background:${acc};background-image:linear-gradient(90deg,${acc},#FFB15C);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:34px 36px 8px;text-align:${align}">
${o.heading ? `<h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;color:#0E141A;font-weight:700;letter-spacing:-.01em">${inline(o.heading, o.draft)}</h1>` : ""}
${o.html ?? bodyHtml(o.body, !!o.draft)}
${cta}
${o.sender ? `<p style="margin:8px 0 10px;font-size:16px;color:#2A3440">${L("Best regards,", "С уважением,", "З повагою,", "مع أطيب التحيات،")}</p>${sig}` : ""}
</td></tr>
<tr><td style="padding:26px 36px 30px"><div style="height:1px;background:#E3E8EE;margin-bottom:18px"></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:13px;line-height:1.6;color:#7A8796;text-align:${align}">
<strong style="color:#2A3440">AGRON Inc.</strong> · Aerial-Ground Robotics Operations Network<br>
<a href="https://www.agron1.com" style="color:#7A8796">agron1.com</a> · <a href="https://stardome.life" style="color:#7A8796">stardome.life</a><br>
<span style="font-size:12px">${L("This message may contain confidential information intended only for the recipient. AGRON™ is a trademark of AGRON Inc.",
  "Письмо может содержать конфиденциальную информацию, предназначенную только для адресата. AGRON™ — товарный знак AGRON Inc.",
  "Лист може містити конфіденційну інформацію, призначену лише для адресата. AGRON™ — торговельна марка AGRON Inc.",
  "قد تحتوي هذه الرسالة على معلومات سرية مخصصة للمستلم فقط. AGRON™ علامة تجارية لشركة AGRON Inc.")}</span>
</td></tr></table></td></tr>
</table>
<div style="font-size:12px;color:#9AA6B3;margin-top:14px">© ${new Date().getFullYear()} AGRON Inc.</div>
</td></tr></table></body></html>`;
}

/** Plain-text version for Gmail compose links and text/plain parts. */
export function plainText(o: { body: string; cta?: { label: string; url: string } | null; sender?: Sender | null; lang: string }) {
  const sign = { en: "Best regards,", ru: "С уважением,", uk: "З повагою,", ar: "مع أطيب التحيات،" } as any;
  let s = o.body.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*-\s+/gm, "• ");
  if (o.cta?.url) s += `\n\n${o.cta.label}: ${o.cta.url}`;
  if (o.sender) s += `\n\n${sign[o.lang] || sign.en}\nAGRON Inc.\ninfo@agron1.com · www.agron1.com`;
  return s;
}
