// AGRON document templates: fill a short form, get a ready document.
// Documents are written in English (the working language with counsel, banks and authorities); the form is EN/RU.
// {{key}} = form field, {{today}} = today's date. `save` creates a record in the matching section.
import type { T2 } from "./learn";

export type TplField = { key: string; label: T2; type?: "text" | "long" | "date" | "number" | "select"; options?: string[]; def?: string; req?: boolean };
export type Tpl = {
  id: string; dept: string; icon: string; name: T2; desc: T2; counsel?: boolean; fields: TplField[]; body: string;
  save?: { section: string; title: string; status: string; data: Record<string, string> };
};

const F = (key: string, en: string, ru: string, type: TplField["type"] = "text", extra: Partial<TplField> = {}): TplField => ({ key, label: { en, ru }, type, ...extra });
const ENTITY = F("entity", "Company", "Компания", "select", { options: ["AGRON Inc., a Delaware corporation", "AGRON UAE"], def: "AGRON Inc., a Delaware corporation" });
const DATE = F("date", "Date", "Дата", "date", { req: true });
const SIGN = F("signer", "Signed by (name, title)", "Подписывает (имя, должность)", "text", { def: "Michael Kofman, Chief Executive Officer" });
const COUNSEL_NOTE = "\n\n---\n*Draft prepared in AGRON Workspace. Review by licensed counsel before signature.*";

export const TEMPLATES: Tpl[] = [
  /* ---------------- Board & governance ---------------- */
  { id: "board_notice", dept: "legal", icon: "calendar", counsel: true,
    name: { en: "Notice of board meeting", ru: "Уведомление о заседании совета" },
    desc: { en: "Formal notice to directors with date, place and agenda.", ru: "Официальное уведомление директорам: дата, место, повестка." },
    fields: [ENTITY, F("kind", "Meeting", "Заседание", "select", { options: ["Regular", "Special"], def: "Regular" }), F("due", "Meeting date", "Дата заседания", "date", { req: true }), F("time", "Time and time zone", "Время и часовой пояс", "text", { def: "10:00 a.m. Eastern Time" }), F("place", "Place / video link", "Место / видеосвязь"), F("agenda", "Agenda (one item per line)", "Повестка (пункт на строку)", "long", { req: true }), F("secretary", "Secretary", "Секретарь", "text")],
    body: "# Notice of {{kind}} Meeting of the Board of Directors\n**{{entity}}**\n\nDate of notice: {{today}}\n\nTo: each member of the Board of Directors\n\nNOTICE IS HEREBY GIVEN that a {{kind}} meeting of the Board of Directors will be held on **{{due}}** at **{{time}}**, at {{place}}. Directors may participate by any means of remote communication by which all participants can hear each other.\n\n## Agenda\n{{agenda}}\n\nMaterials will be circulated before the meeting. If you cannot attend, please inform the Secretary in advance.\n\n{{secretary}}\nSecretary" + COUNSEL_NOTE,
    save: { section: "legal.board", title: "{{kind}} board meeting · {{due}}", status: "Notice sent", data: { kind: "{{kind}} board meeting", due: "{{due}}", place: "{{place}}", agenda: "{{agenda}}", secretary: "{{secretary}}" } } },

  { id: "board_minutes", dept: "legal", icon: "file", counsel: true,
    name: { en: "Minutes of board meeting", ru: "Протокол заседания совета" },
    desc: { en: "Who attended, quorum, resolutions and action items.", ru: "Присутствующие, кворум, решения и поручения." },
    fields: [ENTITY, F("due", "Meeting date", "Дата заседания", "date", { req: true }), F("place", "Place / video link", "Место / видеосвязь"), F("chair", "Chair", "Председатель", "text", { def: "Michael Kofman" }), F("secretary", "Secretary", "Секретарь"), F("attendees", "Directors present", "Присутствующие директора", "long", { req: true }), F("others", "Also present", "Также присутствовали", "long"), F("resolutions", "Discussion and resolutions", "Обсуждение и решения", "long", { req: true }), F("actions", "Action items (who, by when)", "Поручения (кто, срок)", "long")],
    body: "# Minutes of a Meeting of the Board of Directors\n**{{entity}}**\n\n**Date:** {{due}}  \n**Place:** {{place}}  \n**Chair:** {{chair}}  \n**Secretary:** {{secretary}}\n\n**Directors present:** {{attendees}}  \n**Also present:** {{others}}\n\n## 1. Call to order and quorum\nThe Chair called the meeting to order. The Secretary confirmed that notice was duly given or waived and that a quorum of directors was present.\n\n## 2. Discussion and resolutions\n{{resolutions}}\n\n## 3. Action items\n{{actions}}\n\n## 4. Adjournment\nThere being no further business, the meeting was adjourned.\n\n_______________________  \n{{secretary}}, Secretary\n\n_______________________  \n{{chair}}, Chair" + COUNSEL_NOTE,
    save: { section: "legal.board", title: "Board meeting · {{due}}", status: "Minutes drafted", data: { kind: "Regular board meeting", due: "{{due}}", place: "{{place}}", attendees: "{{attendees}}", resolutions: "{{resolutions}}", actions: "{{actions}}", secretary: "{{secretary}}", quorum: "true" } } },

  { id: "written_consent", dept: "legal", icon: "stamp", counsel: true,
    name: { en: "Unanimous written consent of the board", ru: "Единогласное письменное согласие совета" },
    desc: { en: "Board decisions without a meeting (DGCL §141(f)).", ru: "Решения совета без заседания (DGCL §141(f))." },
    fields: [ENTITY, DATE, F("subject", "Subject", "Предмет", "text", { req: true }), F("whereas", "Background (WHEREAS)", "Обоснование (WHEREAS)", "long"), F("resolved", "Resolutions (RESOLVED, one per line)", "Решения (RESOLVED, по строке)", "long", { req: true }), F("directors", "Directors (one per line)", "Директора (по строке)", "long", { req: true, def: "Michael Kofman" })],
    body: "# Action by Unanimous Written Consent of the Board of Directors\n**{{entity}}**\n\nEffective date: {{date}}\n\nThe undersigned, being all of the members of the Board of Directors of the Company, acting pursuant to Section 141(f) of the Delaware General Corporation Law and the Bylaws of the Company, hereby waive any notice and adopt the following resolutions by unanimous written consent, with the same force and effect as if duly adopted at a meeting:\n\n## {{subject}}\n\nWHEREAS, {{whereas}}\n\nNOW, THEREFORE, BE IT RESOLVED:\n{{resolved}}\n\n**General authority.** RESOLVED FURTHER, that the officers of the Company are authorized to take all actions and sign all documents necessary to carry out the foregoing resolutions.\n\nThis consent may be signed in counterparts and by electronic signature and shall be filed with the minutes of the Board.\n\n**Directors:**\n{{directors}}\n\n_______________________ Date: ________" + COUNSEL_NOTE,
    save: { section: "legal.governance", title: "Board consent · {{subject}}", status: "Draft", data: { type: "Board consent", date: "{{date}}", summary: "{{resolved}}" } } },

  { id: "officer_appointment", dept: "legal", icon: "userplus", counsel: true,
    name: { en: "Appointment of officers", ru: "Назначение должностных лиц" },
    desc: { en: "Board consent electing the CEO, Secretary, Treasurer and others.", ru: "Согласие совета о назначении CEO, секретаря, казначея и др." },
    fields: [ENTITY, DATE, F("officers", "Officers (Name — Title, one per line)", "Должностные лица (Имя — должность, по строке)", "long", { req: true, def: "Michael Kofman — Chief Executive Officer and President" }), F("directors", "Directors (one per line)", "Директора (по строке)", "long", { def: "Michael Kofman" })],
    body: "# Unanimous Written Consent of the Board of Directors — Election of Officers\n**{{entity}}**\n\nEffective date: {{date}}\n\nRESOLVED, that the following persons are elected to the offices set forth opposite their names, to serve until their successors are duly elected and qualified, or until their earlier resignation or removal:\n\n{{officers}}\n\nRESOLVED FURTHER, that each officer shall have the powers and duties provided in the Bylaws and as the Board may determine from time to time.\n\n**Directors:**\n{{directors}}\n\n_______________________ Date: ________" + COUNSEL_NOTE,
    save: { section: "legal.governance", title: "Officer appointment · {{date}}", status: "Draft", data: { type: "Officer appointment", date: "{{date}}", summary: "{{officers}}" } } },

  { id: "stockholder_consent", dept: "legal", icon: "users", counsel: true,
    name: { en: "Stockholder written consent", ru: "Письменное согласие акционеров" },
    desc: { en: "Stockholder approval without a meeting (DGCL §228).", ru: "Решение акционеров без собрания (DGCL §228)." },
    fields: [ENTITY, DATE, F("subject", "Subject", "Предмет", "text", { req: true }), F("resolved", "Resolutions", "Решения", "long", { req: true }), F("holders", "Stockholders signing (name — shares)", "Подписывающие акционеры (имя — акции)", "long", { req: true })],
    body: "# Action by Written Consent of the Stockholders\n**{{entity}}**\n\nEffective date: {{date}}\n\nThe undersigned stockholders, holding not less than the minimum number of votes necessary to authorize the following action at a meeting at which all shares entitled to vote were present and voted, acting pursuant to Section 228 of the Delaware General Corporation Law, hereby consent to and adopt the following resolutions:\n\n## {{subject}}\n{{resolved}}\n\nPrompt notice of this action will be given to stockholders who have not consented in writing, as required by Section 228(e).\n\n**Stockholders:**\n{{holders}}\n\n_______________________ Date: ________" + COUNSEL_NOTE,
    save: { section: "legal.governance", title: "Stockholder consent · {{subject}}", status: "Draft", data: { type: "Shareholder consent", date: "{{date}}", summary: "{{resolved}}" } } },

  { id: "poa", dept: "legal", icon: "key", counsel: true,
    name: { en: "Limited power of attorney", ru: "Ограниченная доверенность" },
    desc: { en: "Authority for a person to act for AGRON in a defined matter.", ru: "Полномочия действовать от имени AGRON в конкретном вопросе." },
    fields: [ENTITY, DATE, F("holder", "Attorney-in-fact (name, ID/passport, address)", "Представитель (имя, паспорт, адрес)", "long", { req: true }), F("scope", "Powers granted (exactly what may be done)", "Полномочия (что именно можно делать)", "long", { req: true }), F("limit", "Monetary limit, if any", "Денежный лимит, если есть"), F("expires", "Valid until", "Действует до", "date", { req: true }), SIGN],
    body: "# Limited Power of Attorney\n\n**{{entity}}** (the \"Company\") hereby appoints:\n\n{{holder}}\n\nas its attorney-in-fact, with authority **only** to:\n\n{{scope}}\n\n**Limit:** {{limit}}\n\nThis power of attorney does not authorize the attorney-in-fact to borrow money, encumber assets, settle claims or delegate this authority, unless expressly stated above. It is effective from {{date}} and expires on **{{expires}}**, unless revoked earlier in writing.\n\nIn witness whereof, the Company has executed this power of attorney on {{date}}.\n\n_______________________  \n{{signer}}\n\n*Notarization / apostille / legalization as required in the place of use.*" + COUNSEL_NOTE,
    save: { section: "legal.authority", title: "POA · {{holder}}", status: "Draft", data: { holder: "{{holder}}", kind: "Power of attorney", scope: "{{scope}}", expires: "{{expires}}" } } },

  { id: "counsel_brief", dept: "legal", icon: "headset",
    name: { en: "Brief for outside counsel", ru: "Запрос внешнему юристу" },
    desc: { en: "Clear scoping memo: background, questions, deadline, documents.", ru: "Чёткое ТЗ юристу: контекст, вопросы, срок, документы." },
    fields: [F("topic", "Topic", "Тема", "text", { req: true }), F("jurisdiction", "Jurisdiction", "Юрисдикция", "select", { options: ["US", "UAE", "US + UAE", "Other"], def: "US + UAE" }), F("background", "Background (facts only)", "Контекст (только факты)", "long", { req: true }), F("questions", "Questions (numbered)", "Вопросы (по номерам)", "long", { req: true }), F("due", "Answer needed by", "Ответ нужен к", "date"), F("docs", "Documents attached", "Приложенные документы", "long"), F("budget", "Budget / fee cap", "Бюджет / лимит гонорара")],
    body: "# Request for Legal Advice — {{topic}}\n\n**From:** AGRON Inc.  \n**Date:** {{today}}  \n**Jurisdiction:** {{jurisdiction}}  \n**Answer needed by:** {{due}}  \n**Budget / fee cap:** {{budget}}\n\n## Background\n{{background}}\n\n## Questions\n{{questions}}\n\n## Documents provided\n{{docs}}\n\n## What we need back\n1. A short answer to each question (yes / no / depends, and on what).\n2. Required licences, filings or approvals, with the authority and typical timeline.\n3. Risks and recommended next step.\n\nPlease confirm scope and estimated fees before starting work. This request and your advice are confidential and privileged.",
    save: { section: "legal.requests", title: "Outside counsel · {{topic}}", status: "New", data: { request: "{{questions}}", due: "{{due}}", jurisdiction: "{{jurisdiction}}", priority: "Medium" } } },

  { id: "nda", dept: "legal", icon: "lock", counsel: true,
    name: { en: "Mutual NDA (short form)", ru: "Взаимное NDA (краткое)" },
    desc: { en: "Two-way confidentiality with export-control clause.", ru: "Взаимная конфиденциальность с пунктом об экспортном контроле." },
    fields: [ENTITY, DATE, F("counterparty", "Counterparty (name, country, address)", "Контрагент (название, страна, адрес)", "long", { req: true }), F("purpose", "Purpose", "Цель", "text", { def: "evaluating a potential StarDome project" }), F("term", "Term (years)", "Срок (лет)", "number", { def: "3" }), F("law", "Governing law", "Применимое право", "select", { options: ["State of Delaware", "State of New York", "DIFC (Dubai)", "ADGM (Abu Dhabi)"], def: "State of Delaware" })],
    body: "# Mutual Non-Disclosure Agreement\n\nThis Agreement is made on {{date}} between **{{entity}}** and **{{counterparty}}** (each a \"Party\").\n\n1. **Purpose.** The Parties will exchange Confidential Information solely for {{purpose}}.\n2. **Confidential Information** means non-public business, technical, financial and customer information disclosed in any form and marked or reasonably understood as confidential.\n3. **Obligations.** The receiving Party shall use Confidential Information only for the Purpose, protect it with at least reasonable care, and disclose it only to its employees and advisers who need to know and are bound by similar duties.\n4. **Exclusions.** Information that is public, already known, independently developed or lawfully received from a third party without restriction.\n5. **Export control.** Technical data may be subject to U.S. export control laws (EAR/ITAR) and UAE strategic-goods rules. The receiving Party shall not export, re-export or transfer it, or give access to foreign persons, except in compliance with those laws.\n6. **Term.** {{term}} years from the date above; trade secrets remain protected while they qualify as such.\n7. **Return.** On request, each Party returns or destroys Confidential Information.\n8. **No licence, no obligation.** Nothing grants rights in intellectual property or obliges either Party to enter into a transaction.\n9. **Governing law.** {{law}}.\n\n| {{entity}} | Counterparty |\n|---|---|\n| Signature: | Signature: |\n| Name / title: | Name / title: |" + COUNSEL_NOTE,
    save: { section: "legal.contracts", title: "NDA · {{counterparty}}", status: "Drafting", data: { type: "NDA", counterparty: "{{counterparty}}", jurisdiction: "{{law}}", end_user_clause: "true" } } },

  { id: "end_user", dept: "legal", icon: "flag", counsel: true,
    name: { en: "End-user & end-use statement", ru: "Заявление конечного пользователя" },
    desc: { en: "Customer statement for export screening before a StarDome sale.", ru: "Заявление клиента для экспортной проверки перед продажей StarDome." },
    fields: [F("customer", "Customer (legal name, address)", "Клиент (название, адрес)", "long", { req: true }), F("country", "Country of end use", "Страна использования", "text", { req: true }), F("site", "Site / vessel (name, IMO, flag)", "Объект / судно (название, IMO, флаг)", "text", { req: true }), F("product", "Product / configuration", "Продукт / конфигурация", "select", { options: ["StarDome C20 Base", "StarDome C20 Enhanced", "StarDome C40 Base", "StarDome C40 Advanced", "StarDome C40 HQ", "Custom"] }), F("use", "Intended end use", "Назначение", "long", { def: "Passive detection, monitoring and lawful communications for the protection of the site named above." })],
    body: "# End-User and End-Use Statement\n\nTo: AGRON Inc.  \nDate: {{today}}\n\nWe, **{{customer}}**, are the end user of the following items supplied by AGRON Inc.:\n\n**Product:** {{product}}  \n**Country of end use:** {{country}}  \n**Installation site / vessel:** {{site}}\n\n**End use:** {{use}}\n\nWe certify that:\n1. The items will not be used for any military end use, weapons of mass destruction, or by or for any military end user, unless authorized by the competent authorities.\n2. The items will not be re-exported, resold, leased or transferred to another party or country without the prior written consent of AGRON Inc. and any required government authorization.\n3. Neither we nor our owners, directors or the vessel are listed on any U.S., UN, EU, UK or UAE sanctions list.\n4. We will allow reasonable post-shipment verification on request.\n\n_______________________  \nName, title, company stamp" + COUNSEL_NOTE },

  /* ---------------- Executive ---------------- */
  { id: "decision_memo", dept: "company", icon: "check",
    name: { en: "Decision memo", ru: "Записка для решения" },
    desc: { en: "One page: context, options, recommendation, decision needed by.", ru: "Одна страница: контекст, варианты, рекомендация, срок решения." },
    fields: [F("topic", "Decision needed", "Какое решение нужно", "text", { req: true }), F("context", "Context", "Контекст", "long", { req: true }), F("options", "Options (A, B, C) with cost and risk", "Варианты (A, B, C) с ценой и риском", "long", { req: true }), F("recommendation", "Recommendation", "Рекомендация", "long", { req: true }), F("due", "Decide by", "Решить до", "date"), F("owner", "Prepared by", "Подготовил")],
    body: "# Decision memo — {{topic}}\n\n**Prepared by:** {{owner}} · **Date:** {{today}} · **Decide by:** {{due}}\n\n## Context\n{{context}}\n\n## Options\n{{options}}\n\n## Recommendation\n{{recommendation}}\n\n## Decision\n☐ Approved ☐ Approved with changes ☐ Rejected\n\nComments: _______________________",
    save: { section: "company.decisions", title: "{{topic}}", status: "Proposed", data: { date: "{{due}}", decision: "{{recommendation}}", rationale: "{{context}}", owner: "{{owner}}" } } },

  { id: "ceo_weekly", dept: "company", icon: "trend",
    name: { en: "Weekly executive update", ru: "Еженедельный отчёт руководителя" },
    desc: { en: "Wins, numbers, risks and decisions needed, in five minutes to read.", ru: "Успехи, цифры, риски и нужные решения — читается за 5 минут." },
    fields: [F("week", "Week of", "Неделя", "date", { req: true }), F("wins", "Wins", "Успехи", "long"), F("numbers", "Key numbers (pipeline, cash, builds)", "Ключевые цифры (воронка, деньги, сборки)", "long"), F("risks", "Risks and blockers", "Риски и блокеры", "long"), F("decisions", "Decisions needed", "Нужные решения", "long"), F("next", "Next week focus", "Фокус следующей недели", "long")],
    body: "# AGRON weekly update — week of {{week}}\n\n## Wins\n{{wins}}\n\n## Key numbers\n{{numbers}}\n\n## Risks and blockers\n{{risks}}\n\n## Decisions needed\n{{decisions}}\n\n## Next week\n{{next}}" },

  { id: "investor_update", dept: "finance", icon: "trend",
    name: { en: "Monthly investor update", ru: "Ежемесячный отчёт инвесторам" },
    desc: { en: "Highlights, metrics, cash runway, asks.", ru: "Главное, метрики, запас денег, просьбы." },
    fields: [F("month", "Month", "Месяц", "text", { req: true }), F("highlights", "Highlights", "Главное", "long", { req: true }), F("metrics", "Metrics (pipeline, orders, revenue)", "Метрики (воронка, заказы, выручка)", "long"), F("cash", "Cash and runway", "Деньги и запас (месяцев)"), F("lowlights", "Challenges", "Сложности", "long"), F("asks", "How investors can help", "Чем инвесторы могут помочь", "long")],
    body: "# AGRON Inc. — Investor update, {{month}}\n\n## Highlights\n{{highlights}}\n\n## Metrics\n{{metrics}}\n\n**Cash and runway:** {{cash}}\n\n## Challenges\n{{lowlights}}\n\n## Asks\n{{asks}}\n\n*Confidential. Forward-looking statements are estimates and may change.*" },

  { id: "meeting_agenda", dept: "company", icon: "calendar",
    name: { en: "Meeting agenda & notes", ru: "Повестка и протокол встречи" },
    desc: { en: "Agenda before, decisions and action items after.", ru: "Повестка до встречи, решения и задачи после." },
    fields: [DATE, F("participants", "Participants", "Участники", "text", { req: true }), F("agenda", "Agenda", "Повестка", "long", { req: true }), F("decisions", "Decisions", "Решения", "long"), F("actions", "Action items (who, by when)", "Задачи (кто, срок)", "long"), F("owner", "Organizer", "Организатор")],
    body: "# Meeting — {{date}}\n\n**Participants:** {{participants}}  \n**Organizer:** {{owner}}\n\n## Agenda\n{{agenda}}\n\n## Decisions\n{{decisions}}\n\n## Action items\n{{actions}}",
    save: { section: "company.meetings", title: "Meeting · {{date}}", status: "Done", data: { date: "{{date}}", participants: "{{participants}}", agenda: "{{agenda}}", decisions: "{{decisions}}", actions: "{{actions}}", owner: "{{owner}}" } } },

  /* ---------------- Finance ---------------- */
  { id: "payment_request", dept: "finance", icon: "receipt",
    name: { en: "Payment request", ru: "Заявка на оплату" },
    desc: { en: "What, to whom, how much, budget line and approval.", ru: "Что, кому, сколько, статья бюджета и согласование." },
    fields: [F("vendor", "Pay to", "Получатель", "text", { req: true }), F("amount", "Amount", "Сумма", "number", { req: true }), F("currency", "Currency", "Валюта", "select", { options: ["USD", "AED", "EUR"], def: "USD" }), F("category", "Category", "Категория", "select", { options: ["Equipment", "Travel", "Software", "Services", "Marketing", "Other"], def: "Services" }), F("purpose", "Purpose", "Назначение", "long", { req: true }), F("due", "Pay by", "Оплатить до", "date"), F("requester", "Requested by", "Запросил")],
    body: "# Payment request\n\n**Date:** {{today}}  \n**Requested by:** {{requester}}\n\n| Pay to | Amount | Category | Pay by |\n|---|---|---|---|\n| {{vendor}} | {{amount}} {{currency}} | {{category}} | {{due}} |\n\n**Purpose:** {{purpose}}\n\n**Checks:** ☐ Invoice attached ☐ Vendor screened (sanctions) ☐ Within budget\n\nApproved by: _______________________ Date: ________",
    save: { section: "finance.expenses", title: "{{vendor}} · {{amount}} {{currency}}", status: "Submitted", data: { requester: "{{requester}}", category: "{{category}}", amount: "{{amount}}", currency: "{{currency}}", notes: "{{purpose}}" } } },

  /* ---------------- Operations ---------------- */
  { id: "purchase_order", dept: "operations", icon: "cart",
    name: { en: "Purchase order", ru: "Заказ поставщику" },
    desc: { en: "PO with item, quantity, price, delivery and export terms.", ru: "Заказ: позиция, количество, цена, поставка и экспортные условия." },
    fields: [F("vendor", "Vendor (name, address)", "Поставщик (название, адрес)", "long", { req: true }), F("item", "Item / model", "Позиция / модель", "text", { req: true }), F("qty", "Quantity", "Количество", "number", { def: "1" }), F("amount", "Total price", "Сумма", "number", { req: true }), F("currency", "Currency", "Валюта", "select", { options: ["USD", "AED", "EUR"], def: "USD" }), F("eta", "Delivery date", "Дата поставки", "date"), F("ship_to", "Ship to", "Адрес доставки", "text"), F("build", "For build / project", "Для сборки / проекта")],
    body: "# Purchase Order\n\n**Buyer:** AGRON Inc. · info@agron1.com  \n**Date:** {{today}}  \n**Vendor:** {{vendor}}\n\n| Item | Qty | Total | Delivery |\n|---|---|---|---|\n| {{item}} | {{qty}} | {{amount}} {{currency}} | {{eta}} |\n\n**Ship to:** {{ship_to}}  \n**Project:** {{build}}\n\n**Terms.** Prices include packing. Please confirm the order, delivery date and the export classification (ECCN / USML or \"EAR99\") and HS code of each item, and provide the certificate of origin and datasheets with the shipment. Payment per agreed terms after receipt and acceptance.\n\nAuthorized by AGRON Inc.: _______________________",
    save: { section: "operations.procurement", title: "PO · {{item}}", status: "Draft", data: { vendor: "{{vendor}}", item: "{{item}}", qty: "{{qty}}", amount: "{{amount}}", currency: "{{currency}}", eta: "{{eta}}", build: "{{build}}" } } },

  { id: "acceptance", dept: "operations", icon: "anchor",
    name: { en: "Delivery & acceptance certificate", ru: "Акт сдачи-приёмки" },
    desc: { en: "StarDome handover: site, serials, tests passed, open items.", ru: "Передача StarDome: объект, серийные номера, тесты, замечания." },
    fields: [F("client", "Client", "Клиент", "text", { req: true }), F("site", "Site / vessel", "Объект / судно", "text", { req: true }), F("config", "Configuration", "Конфигурация", "select", { options: ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ", "Custom"] }), F("serials", "Serial numbers", "Серийные номера", "long"), F("tests", "Tests passed", "Пройденные тесты", "long", { def: "Power-up, sensor alignment, AGRON 1 connectivity, alarm chain, operator training" }), F("punch", "Open items (punch list)", "Замечания", "long"), DATE],
    body: "# Delivery and Acceptance Certificate\n\n**Client:** {{client}}  \n**Site / vessel:** {{site}}  \n**System:** StarDome {{config}}  \n**Date:** {{date}}\n\n**Serial numbers:**\n{{serials}}\n\n**Tests performed and passed:**\n{{tests}}\n\n**Open items (to be closed within 30 days unless agreed otherwise):**\n{{punch}}\n\nThe Client confirms delivery and acceptance of the system as described above. Warranty starts on the date of this certificate.\n\n| AGRON Inc. | Client |\n|---|---|\n| Name / signature: | Name / signature: |",
    save: { section: "operations.installation", title: "Acceptance · {{site}}", status: "Commissioned", data: { site: "{{site}}", notes: "{{punch}}", due: "{{date}}" } } },

  /* ---------------- Sales ---------------- */
  { id: "proposal_cover", dept: "sales", icon: "file",
    name: { en: "Proposal cover letter", ru: "Сопроводительное письмо к КП" },
    desc: { en: "One-page cover for a StarDome proposal.", ru: "Одна страница к коммерческому предложению StarDome." },
    fields: [F("client", "Client", "Клиент", "text", { req: true }), F("contact", "Contact person", "Контактное лицо"), F("site", "Site", "Объект", "text", { req: true }), F("config", "Configuration", "Конфигурация", "select", { options: ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ", "Custom"], def: "C20 Enhanced" }), F("value", "Total price, USD", "Цена, USD", "number"), F("valid", "Valid until", "Действует до", "date"), F("why", "Why this configuration", "Почему эта конфигурация", "long")],
    body: "# Proposal — StarDome {{config}} for {{site}}\n\nDear {{contact}},\n\nThank you for the opportunity to propose a security solution for {{site}}. We recommend **StarDome {{config}}**: a self-contained unit with sensors and the AGRON 1 monitoring software, built to order and installed in days.\n\n**Why this configuration:** {{why}}\n\n**Commercial terms:** total price USD {{value}}, valid until {{valid}}. Purchase, lease or financing are available. Delivery is subject to applicable export and import approvals.\n\nWe would be glad to walk you through the proposal.\n\nBest regards,  \nAGRON Inc. · info@agron1.com",
    save: { section: "sales.proposals", title: "{{client}} · StarDome {{config}}", status: "Draft", data: { client: "{{client}}", config: "{{config}}", value: "{{value}}", currency: "USD", valid_until: "{{valid}}" } } },

  { id: "call_report", dept: "sales", icon: "headset",
    name: { en: "Client call report", ru: "Отчёт о встрече с клиентом" },
    desc: { en: "What was discussed, what they need, next step.", ru: "Что обсудили, что нужно клиенту, следующий шаг." },
    fields: [F("client", "Client", "Клиент", "text", { req: true }), DATE, F("type", "Type", "Формат", "select", { options: ["Call", "Video call", "Meeting", "Demo", "Site visit"], def: "Call" }), F("outcome", "Discussed and learned", "Обсудили и узнали", "long", { req: true }), F("next_step", "Next step (who, when)", "Следующий шаг (кто, когда)", "text", { req: true }), F("owner", "Owner", "Ответственный")],
    body: "# Call report — {{client}}\n\n**Date:** {{date}} · **Type:** {{type}} · **Owner:** {{owner}}\n\n## Discussed\n{{outcome}}\n\n## Next step\n{{next_step}}",
    save: { section: "sales.activities", title: "{{type}} · {{client}}", status: "Done", data: { client: "{{client}}", type: "{{type}}", date: "{{date}}", outcome: "{{outcome}}", next_step: "{{next_step}}", owner: "{{owner}}" } } },

  /* ---------------- HR ---------------- */
  { id: "offer_letter", dept: "hr", icon: "userplus", counsel: true,
    name: { en: "Offer letter (US)", ru: "Оффер (США)" },
    desc: { en: "Position, pay, start date, at-will, confidentiality and export checks.", ru: "Должность, оплата, дата начала, at-will, конфиденциальность, экспортная проверка." },
    fields: [F("name", "Candidate", "Кандидат", "text", { req: true }), F("position", "Position", "Должность", "text", { req: true }), F("salary", "Annual salary, USD", "Годовая зарплата, USD", "number", { req: true }), F("start", "Start date", "Дата начала", "date", { req: true }), F("location", "Location", "Место работы", "text", { def: "Remote / North Carolina" }), F("manager", "Reports to", "Руководитель"), F("expires", "Offer expires", "Оффер действует до", "date")],
    body: "# Offer of Employment\n\n{{today}}\n\nDear {{name}},\n\nAGRON Inc. is pleased to offer you the position of **{{position}}**, reporting to {{manager}}, based in {{location}}, starting on **{{start}}**.\n\n**Compensation.** Annual base salary of USD {{salary}}, paid per the Company's payroll schedule, less applicable withholdings. You will be eligible for Company benefits as in effect from time to time.\n\n**At-will employment.** Your employment is at will: either you or the Company may end it at any time, with or without cause or notice.\n\n**Conditions.** This offer is conditional on (1) signing the Company's Confidential Information and Invention Assignment Agreement, (2) proof of eligibility to work in the United States, and (3) where the role involves controlled technology, confirmation of U.S.-person status or an export authorization before access.\n\nPlease sign and return by {{expires}}.\n\nBest regards,  \nAGRON Inc.\n\nAccepted: _______________________ Date: ________" + COUNSEL_NOTE,
    save: { section: "hr.hiring", title: "{{position}} · offer to {{name}}", status: "Offer", data: { owner: "{{manager}}", location: "{{location}}", notes: "Salary {{salary}} USD, start {{start}}" } } },

  { id: "onboarding", dept: "hr", icon: "rocket",
    name: { en: "Onboarding checklist", ru: "Чек-лист онбординга" },
    desc: { en: "Accounts, equipment, NDA, export briefing, first week.", ru: "Доступы, техника, NDA, экспортный инструктаж, первая неделя." },
    fields: [F("person", "New team member", "Новый сотрудник", "text", { req: true }), F("start", "Start date", "Дата начала", "date"), F("role", "Role", "Роль"), F("buddy", "Buddy", "Наставник")],
    body: "# Onboarding — {{person}}\n\n**Start:** {{start}} · **Role:** {{role}} · **Buddy:** {{buddy}}\n\n## Before day 1\n- ☐ Google Workspace account and AGRON Workspace invite (role set)\n- ☐ Laptop and equipment issued and logged\n- ☐ Confidentiality and IP assignment signed\n- ☐ US-person status confirmed for controlled data access\n\n## Week 1\n- ☐ Export-control and sanctions briefing\n- ☐ Security rules: devices, passwords, technical data\n- ☐ Product intro: StarDome configurations and AGRON 1\n- ☐ First goals agreed with the manager",
    save: { section: "hr.onboarding", title: "Onboarding · {{person}}", status: "To do", data: { person: "{{person}}", checklist: "Accounts · Equipment · NDA & IP · US-person check · Export briefing · Security rules · Product intro · Goals" } } },

  /* ---------------- Security ---------------- */
  { id: "incident_report", dept: "security", icon: "alert",
    name: { en: "Incident report", ru: "Отчёт об инциденте" },
    desc: { en: "What happened, impact, actions taken, follow-up.", ru: "Что случилось, последствия, принятые меры, дальнейшие шаги." },
    fields: [DATE, F("severity", "Severity", "Серьёзность", "select", { options: ["Low", "Medium", "High", "Critical"], def: "Medium" }), F("what", "What happened", "Что произошло", "long", { req: true }), F("impact", "Impact (people, data, systems, clients)", "Последствия (люди, данные, системы, клиенты)", "long"), F("actions", "Actions taken", "Принятые меры", "long"), F("followup", "Follow-up and prevention", "Дальнейшие шаги и профилактика", "long"), F("owner", "Reported by", "Сообщил")],
    body: "# Incident report\n\n**Date:** {{date}} · **Severity:** {{severity}} · **Reported by:** {{owner}}\n\n## What happened\n{{what}}\n\n## Impact\n{{impact}}\n\n## Actions taken\n{{actions}}\n\n## Follow-up\n{{followup}}\n\n**Notifications to check:** ☐ Client ☐ Insurer ☐ Authorities ☐ Data-protection duties ☐ Export-control (unauthorized access to technical data)",
    save: { section: "security.incidents", title: "Incident · {{date}}", status: "Reported", data: { severity: "{{severity}}", date: "{{date}}", description: "{{what}}", owner: "{{owner}}" } } },

  /* ---------------- Technical ---------------- */
  { id: "test_report", dept: "technical", icon: "check",
    name: { en: "Test report", ru: "Протокол испытаний" },
    desc: { en: "Setup, method, results against criteria, verdict.", ru: "Стенд, методика, результаты против критериев, вывод." },
    fields: [F("equipment", "Equipment / system", "Оборудование / система", "text", { req: true }), F("type", "Test type", "Вид испытаний", "select", { options: ["Lab", "Bench", "Field", "Sea trial", "EMC", "Environmental", "Cyber"], def: "Bench" }), F("config", "Configuration", "Конфигурация", "select", { options: ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ", "Custom"] }), DATE, F("criteria", "Acceptance criteria", "Критерии приёмки", "long"), F("result", "Results", "Результаты", "long", { req: true }), F("verdict", "Verdict", "Вывод", "select", { options: ["Passed", "Failed", "Blocked"], def: "Passed" }), F("owner", "Test engineer", "Инженер")],
    body: "# Test report — {{equipment}}\n\n**Type:** {{type}} · **Configuration:** {{config}} · **Date:** {{date}} · **Engineer:** {{owner}}\n\n## Acceptance criteria\n{{criteria}}\n\n## Results\n{{result}}\n\n## Verdict: **{{verdict}}**\n\n*Contains technical data: mark the record controlled if it includes performance parameters of controlled items.*",
    save: { section: "technical.testing", title: "{{type}} test · {{equipment}}", status: "{{verdict}}", data: { type: "{{type}}", config: "{{config}}", equipment: "{{equipment}}", date: "{{date}}", result: "{{result}}", owner: "{{owner}}" } } },

  { id: "ecr", dept: "technical", icon: "git",
    name: { en: "Engineering change request", ru: "Запрос на инженерное изменение" },
    desc: { en: "What changes, why, impact; triggers a new compliance review.", ru: "Что меняется, зачем, влияние; запускает новую проверку комплаенса." },
    fields: [F("change", "Change", "Изменение", "text", { req: true }), F("config", "Configuration", "Конфигурация", "select", { options: ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ", "Custom"] }), F("reason", "Reason", "Причина", "long", { req: true }), F("impact", "Main impact", "Основное влияние", "select", { options: ["Cost", "Schedule", "Compliance", "Safety", "Performance"], def: "Performance" }), F("due", "Needed by", "Нужно к", "date"), F("owner", "Requested by", "Запросил")],
    body: "# Engineering change request — {{change}}\n\n**Configuration:** {{config}} · **Requested by:** {{owner}} · **Needed by:** {{due}}\n\n## Reason\n{{reason}}\n\n## Impact\nMain impact: **{{impact}}**\n\n## Required reviews\n- ☐ Engineering approval\n- ☐ **Compliance re-review** (Project Rule 15: every substitution needs a new review) — update the Equipment compliance matrix\n- ☐ BOM and cost update\n- ☐ Documentation update",
    save: { section: "technical.changes", title: "ECR · {{change}}", status: "Requested", data: { config: "{{config}}", impact: "{{impact}}", reason: "{{reason}}", owner: "{{owner}}", due: "{{due}}", priority: "Medium" } } },
];

export const TPL_DEPTS = ["legal", "company", "finance", "operations", "sales", "hr", "security", "technical"];
export const fillTpl = (s: string, v: Record<string, string>) => {
  const doc = s.startsWith("#");
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (k === "today") return new Date().toISOString().slice(0, 10);
    const val = String(v[k] ?? "").trim();
    if (!val) return doc ? "[…]" : "";
    return doc ? val.replace(/\n/g, "  \n") : val; // keep line breaks in the document
  });
};
