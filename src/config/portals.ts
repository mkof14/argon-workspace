// Official portals and tools each department uses, opened from its overview. Public addresses only; no logins are stored.
type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
export type Portal = { name: string; url: string; what: T4 };
const p = (name: string, url: string, what: T4): Portal => ({ name, url, what });

export const PORTALS: Record<string, Portal[]> = {
  security: [
    p("OFAC Sanctions List Search", "https://sanctionssearch.ofac.treas.gov/", L("US Treasury sanctions (SDN and other lists)", "Санкции Минфина США (SDN и другие списки)", "Санкції Мінфіну США (SDN та інші списки)", "عقوبات وزارة الخزانة الأمريكية")),
    p("Consolidated Screening List", "https://www.trade.gov/data-visualization/csl-search", L("All US export restricted-party lists in one search", "Все списки ограничений экспорта США в одном поиске", "Усі списки обмежень експорту США в одному пошуку", "كل قوائم الأطراف المقيدة الأمريكية في بحث واحد")),
    p("EU Sanctions Map", "https://www.sanctionsmap.eu/", L("EU restrictive measures by country", "Санкции ЕС по странам", "Санкції ЄС за країнами", "تدابير الاتحاد الأوروبي حسب الدولة")),
    p("UN Security Council sanctions list", "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", L("UN consolidated list (applied in the UAE)", "Сводный список ООН (применяется в ОАЭ)", "Зведений список ООН (застосовується в ОАЕ)", "القائمة الموحدة للأمم المتحدة")),
    p("Equasis", "https://www.equasis.org/", L("Vessel, owner and manager details by IMO number", "Данные судна, владельца и оператора по номеру IMO", "Дані судна, власника та оператора за номером IMO", "بيانات السفينة والمالك برقم IMO")),
    p("Google Admin — security", "https://admin.google.com/ac/security", L("Two-step verification, alerts and sign-in rules for company email", "Двухэтапная проверка, оповещения и правила входа для почты компании", "Двоетапна перевірка, сповіщення та правила входу для пошти компанії", "التحقق بخطوتين والتنبيهات لبريد الشركة")),
    p("CISA Known Exploited Vulnerabilities", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", L("Vulnerabilities attacked in the wild: patch first", "Уязвимости, которые уже атакуют: патчить в первую очередь", "Вразливості, які вже атакують: патчити першими", "ثغرات مستغلة فعلياً: تُرقّع أولاً")),
    p("UAE Cyber Security Council", "https://csc.gov.ae/", L("UAE national cyber authority and guidance", "Национальный киберрегулятор ОАЭ и рекомендации", "Національний кіберрегулятор ОАЕ та рекомендації", "مجلس الأمن السيبراني الإماراتي")),
  ],
  finance: [
    p("IRS — business", "https://www.irs.gov/businesses", L("US federal tax, forms and payments", "Федеральные налоги США, формы и платежи", "Федеральні податки США, форми та платежі", "الضرائب الفيدرالية الأمريكية")),
    p("Delaware franchise tax", "https://corp.delaware.gov/paytaxes/", L("Annual report and franchise tax for AGRON Inc. (due 1 March)", "Годовой отчёт и франшизный налог AGRON Inc. (до 1 марта)", "Річний звіт і франшизний податок AGRON Inc. (до 1 березня)", "التقرير السنوي وضريبة الامتياز في ديلاوير")),
    p("UAE EmaraTax (FTA)", "https://eservices.tax.gov.ae/", L("UAE corporate tax and VAT filings", "Корпоративный налог и НДС ОАЭ", "Корпоративний податок і ПДВ ОАЕ", "ضريبة الشركات وضريبة القيمة المضافة")),
    p("FinCEN — BOI reporting", "https://www.fincen.gov/boi", L("Beneficial ownership reporting rules", "Правила раскрытия бенефициаров", "Правила розкриття бенефіціарів", "الإبلاغ عن الملكية النفعية")),
    p("SBA — financing", "https://www.sba.gov/funding-programs", L("US small business loans and programs", "Кредиты и программы для малого бизнеса США", "Кредити та програми для малого бізнесу США", "قروض وبرامج الأعمال الصغيرة")),
    p("EXIM Bank", "https://www.exim.gov/", L("US export credit insurance and financing for foreign buyers", "Страхование экспортных кредитов и финансирование покупателей", "Страхування експортних кредитів і фінансування покупців", "تمويل وتأمين ائتمان الصادرات")),
  ],
  sales: [
    p("SAM.gov", "https://sam.gov/", L("US federal tenders and entity registration", "Федеральные тендеры США и регистрация компании", "Федеральні тендери США та реєстрація компанії", "مناقصات الحكومة الفيدرالية الأمريكية")),
    p("Dubai eSupply", "https://esupply.dubai.gov.ae/", L("Dubai government tenders", "Тендеры правительства Дубая", "Тендери уряду Дубая", "مناقصات حكومة دبي")),
    p("Abu Dhabi procurement (ADGPG)", "https://www.adgpg.gov.ae/", L("Abu Dhabi government procurement", "Госзакупки Абу-Даби", "Держзакупівлі Абу-Дабі", "مشتريات حكومة أبوظبي")),
    p("Consolidated Screening List", "https://www.trade.gov/data-visualization/csl-search", L("Screen a client before a proposal", "Проверить клиента до коммерческого предложения", "Перевірити клієнта до комерційної пропозиції", "افحص العميل قبل العرض")),
    p("Equasis", "https://www.equasis.org/", L("Check a vessel and its owner by IMO", "Проверить судно и владельца по IMO", "Перевірити судно й власника за IMO", "تحقق من السفينة ومالكها")),
    p("trade.gov — UAE market guide", "https://www.trade.gov/country-commercial-guides/united-arab-emirates-market-overview", L("US Commercial Service guide to selling in the UAE", "Руководство Минторга США по продажам в ОАЭ", "Посібник Мінторгу США з продажів в ОАЕ", "دليل البيع في الإمارات")),
  ],
  operations: [
    p("Dubai Trade", "https://www.dubaitrade.ae/", L("Port, customs and shipping services in Dubai", "Порт, таможня и логистика в Дубае", "Порт, митниця та логістика в Дубаї", "خدمات الموانئ والجمارك في دبي")),
    p("Dubai Customs", "https://www.dubaicustoms.gov.ae/", L("Import declarations and controlled items", "Импортные декларации и контролируемые товары", "Імпортні декларації та контрольовані товари", "البيانات الجمركية والسلع المقيدة")),
    p("US CBP — ACE", "https://www.cbp.gov/trade/automated", L("US customs filings and export data", "Таможенные декларации США и данные экспорта", "Митні декларації США та дані експорту", "الإقرارات الجمركية الأمريكية")),
    p("AESDirect (EEI filing)", "https://www.census.gov/foreign-trade/aes/index.html", L("Electronic Export Information for US shipments", "Электронная экспортная информация (EEI)", "Електронна експортна інформація (EEI)", "معلومات التصدير الإلكترونية")),
    p("Maersk tracking", "https://www.maersk.com/tracking/", L("Container tracking", "Отслеживание контейнеров", "Відстеження контейнерів", "تتبع الحاويات")),
    p("DHL tracking", "https://www.dhl.com/global-en/home/tracking.html", L("Parcel and express tracking", "Отслеживание посылок и экспресс-доставки", "Відстеження посилок і експрес-доставки", "تتبع الطرود")),
  ],
  hr: [
    p("E-Verify", "https://www.e-verify.gov/", L("Confirm US work authorization after Form I-9", "Проверка права на работу в США после формы I-9", "Перевірка права на роботу в США після форми I-9", "التحقق من أهلية العمل الأمريكية")),
    p("USCIS — Form I-9", "https://www.uscis.gov/i-9", L("Employment eligibility form and rules", "Форма и правила подтверждения права на работу", "Форма та правила підтвердження права на роботу", "نموذج I-9 وقواعده")),
    p("UAE MOHRE", "https://www.mohre.gov.ae/", L("UAE work permits and labour contracts", "Разрешения на работу и трудовые договоры ОАЭ", "Дозволи на роботу та трудові договори ОАЕ", "تصاريح العمل وعقود العمل")),
    p("US Department of Labor", "https://www.dol.gov/agencies/whd", L("Wage, hour and leave rules", "Правила оплаты, рабочего времени и отпусков", "Правила оплати, робочого часу та відпусток", "قواعد الأجور والإجازات")),
    p("EEOC", "https://www.eeoc.gov/employers", L("Equal employment rules for employers", "Правила равных возможностей для работодателей", "Правила рівних можливостей для роботодавців", "قواعد تكافؤ فرص العمل")),
    p("DDTC — deemed exports", "https://www.pmddtc.state.gov/", L("Foreign-national access to ITAR technical data", "Доступ иностранцев к техданным ITAR", "Доступ іноземців до техданих ITAR", "وصول الأجانب لبيانات ITAR")),
  ],
  legal: [
    p("eCFR — EAR (15 CFR 730-774)", "https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C", L("Export Administration Regulations, current text", "Правила экспортного контроля EAR, актуальный текст", "Правила експортного контролю EAR, актуальний текст", "لوائح إدارة التصدير")),
    p("eCFR — ITAR (22 CFR 120-130)", "https://www.ecfr.gov/current/title-22/chapter-I/subchapter-M", L("International Traffic in Arms Regulations, current text", "Правила ITAR, актуальный текст", "Правила ITAR, актуальний текст", "لوائح ITAR")),
    p("BIS SNAP-R", "https://snapr.bis.doc.gov/", L("Export licence and classification requests to BIS", "Заявки на лицензии и классификацию в BIS", "Заявки на ліцензії та класифікацію в BIS", "طلبات الترخيص والتصنيف")),
    p("DDTC DECCS", "https://deccs.pmddtc.state.gov/", L("ITAR registration and licences", "Регистрация и лицензии ITAR", "Реєстрація та ліцензії ITAR", "تسجيل وتراخيص ITAR")),
    p("USPTO Trademark Center", "https://www.uspto.gov/trademarks", L("File and check US trademarks", "Подача и проверка товарных знаков США", "Подання та перевірка торговельних марок США", "العلامات التجارية الأمريكية")),
    p("Delaware Division of Corporations", "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx", L("Entity status and filings for AGRON Inc.", "Статус и документы AGRON Inc.", "Статус і документи AGRON Inc.", "حالة الشركة وإيداعاتها")),
    p("UAE TDRA — type approval", "https://tdra.gov.ae/", L("Radio and telecom equipment approval in the UAE", "Сертификация радио- и телеком-оборудования в ОАЭ", "Сертифікація радіо- та телеком-обладнання в ОАЕ", "اعتماد معدات الاتصالات")),
    p("UAE GCAA", "https://www.gcaa.gov.ae/", L("UAE civil aviation rules for drones", "Правила гражданской авиации ОАЭ для дронов", "Правила цивільної авіації ОАЕ для дронів", "قواعد الطيران المدني للطائرات المسيّرة")),
  ],
  technical: [
    p("FCC equipment authorization", "https://www.fcc.gov/oet/ea", L("US radio equipment approval and FCC ID search", "Сертификация радиооборудования США и поиск FCC ID", "Сертифікація радіообладнання США та пошук FCC ID", "اعتماد معدات الراديو الأمريكية")),
    p("UAE TDRA — type approval", "https://tdra.gov.ae/", L("UAE radio equipment approval", "Сертификация радиооборудования ОАЭ", "Сертифікація радіообладнання ОАЕ", "اعتماد معدات الراديو الإماراتية")),
    p("NVD — vulnerabilities", "https://nvd.nist.gov/vuln/search", L("Check device firmware and software for known vulnerabilities", "Проверка прошивок и ПО на известные уязвимости", "Перевірка прошивок і ПЗ на відомі вразливості", "ثغرات البرمجيات المعروفة")),
    p("IEC webstore", "https://webstore.iec.ch/", L("IEC standards (laser, EMC, environmental)", "Стандарты IEC (лазер, ЭМС, климатика)", "Стандарти IEC (лазер, ЕМС, кліматика)", "معايير IEC")),
  ],
  marketing: [
    p("Meta Business Suite", "https://business.facebook.com/", L("Facebook and Instagram pages, posts and insights", "Страницы, посты и статистика Facebook и Instagram", "Сторінки, дописи та статистика Facebook і Instagram", "صفحات ومنشورات وتحليلات فيسبوك وإنستغرام")),
    p("LinkedIn Campaign Manager", "https://www.linkedin.com/campaignmanager/", L("LinkedIn ads", "Реклама LinkedIn", "Реклама LinkedIn", "إعلانات لينكدإن")),
    p("Google Ads", "https://ads.google.com/", L("Search and YouTube ads", "Поисковая реклама и YouTube", "Пошукова реклама та YouTube", "إعلانات البحث ويوتيوب")),
    p("FTC — advertising rules", "https://www.ftc.gov/business-guidance/advertising-marketing", L("US rules for claims and endorsements", "Правила США для рекламных заявлений", "Правила США для рекламних заяв", "قواعد الإعلان الأمريكية")),
    p("UAE Media Council", "https://uaemc.gov.ae/", L("UAE media and advertising rules", "Правила медиа и рекламы ОАЭ", "Правила медіа та реклами ОАЕ", "قواعد الإعلام والإعلان")),
  ],
  company: [
    p("agron1.com", "https://www.agron1.com/", L("Company website", "Сайт компании", "Сайт компанії", "موقع الشركة")),
    p("stardome.life", "https://stardome.life/", L("StarDome product website", "Сайт продукта StarDome", "Сайт продукту StarDome", "موقع StarDome")),
    p("Google Workspace", "https://workspace.google.com/dashboard", L("Company email, calendar and drive", "Почта, календарь и диск компании", "Пошта, календар і диск компанії", "البريد والتقويم والملفات")),
    p("Microsoft Teams", "https://teams.microsoft.com/", L("Chat and calls", "Чат и звонки", "Чат і дзвінки", "الدردشة والمكالمات")),
  ],
};
