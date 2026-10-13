// Marketing studio: the AI buttons shown inside marketing records, and where each result is saved.
type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

export type MktAction = "write" | "pitch" | "prep" | "brief" | "check" | "repurpose";
export type MktButton = { action: MktAction; label: T4; hint: T4; icon: string; field?: string };

const WRITE = (field: string, en: string, ru: string, uk: string, ar: string, hint: T4): MktButton => ({ action: "write", field, icon: "pen", label: L(en, ru, uk, ar), hint });
const CHECK: MktButton = { action: "check", icon: "shield", label: L("Compliance check", "Проверить комплаенс", "Перевірити комплаєнс", "فحص الامتثال"),
  hint: L("Finds controlled technical data, unapproved claims, prices and banned words before anything goes public.", "Находит контролируемые техданные, неутверждённые заявления, цены и запрещённые слова до публикации.", "Знаходить контрольовані техдані, незатверджені заяви, ціни та заборонені слова до публікації.", "يكتشف البيانات التقنية الخاضعة للرقابة والادعاءات غير المعتمدة والأسعار والكلمات المحظورة قبل النشر.") };
const REPURPOSE: MktButton = { action: "repurpose", icon: "share", label: L("Make social posts", "Сделать посты для соцсетей", "Зробити дописи для соцмереж", "إنشاء منشورات"),
  hint: L("Turns this material into ready drafts for LinkedIn, X and Instagram in Social media.", "Превращает материал в готовые черновики для LinkedIn, X и Instagram в разделе «Соцсети».", "Перетворює матеріал на чернетки для LinkedIn, X та Instagram у розділі «Соцмережі».", "يحوّل المادة إلى مسودات جاهزة لـ LinkedIn وX وInstagram.") };

export const MKT_BUTTONS: Record<string, MktButton[]> = {
  "marketing.social": [WRITE("text", "Write the post", "Написать пост", "Написати допис", "اكتب المنشور", L("Text for the chosen channel and audience, with hashtags.", "Текст под выбранный канал и аудиторию, с хэштегами.", "Текст під канал і аудиторію, з хештегами.", "نص مناسب للقناة والجمهور مع الوسوم.")), CHECK],
  "marketing.press": [
    { action: "pitch", field: "pitch", icon: "send", label: L("Write the pitch", "Написать питч", "Написати пітч", "اكتب العرض"), hint: L("A short email to the editor offering the story.", "Короткое письмо редактору с предложением материала.", "Короткий лист редактору з пропозицією матеріалу.", "رسالة قصيرة للمحرر تعرض القصة.") },
    WRITE("text", "Write the article", "Написать материал", "Написати матеріал", "اكتب المقال", L("Article or press release in the chosen format.", "Статья или пресс-релиз в выбранном формате.", "Стаття або прес-реліз у вибраному форматі.", "مقال أو بيان صحفي بالصيغة المختارة.")), CHECK, REPURPOSE],
  "marketing.interviews": [
    { action: "pitch", field: "pitch", icon: "send", label: L("Write the guest pitch", "Написать заявку", "Написати заявку", "اكتب طلب المشاركة"), hint: L("Why our speaker fits this show, three topic ideas.", "Почему наш спикер подходит шоу, три идеи тем.", "Чому наш спікер підходить шоу, три ідеї тем.", "لماذا يناسب متحدثنا البرنامج، وثلاث أفكار.") },
    { action: "prep", field: "prep", icon: "mic", label: L("Prepare for the interview", "Подготовить к интервью", "Підготувати до інтерв'ю", "التحضير للمقابلة"), hint: L("Likely questions, approved answers, key messages and topics to avoid.", "Вероятные вопросы, одобренные ответы, ключевые тезисы и темы, которых избегать.", "Ймовірні питання, схвалені відповіді, ключові тези та теми, яких уникати.", "أسئلة محتملة وأجوبة معتمدة ورسائل رئيسية ومواضيع يجب تجنبها.") },
    CHECK, REPURPOSE],
  "marketing.video": [
    { action: "brief", field: "brief", icon: "video", label: L("Brief and script", "Бриф и сценарий", "Бриф і сценарій", "الموجز والسيناريو"), hint: L("Goal, audience, key message, then a scene-by-scene script with timing.", "Цель, аудитория, главная мысль, затем сценарий по сценам с хронометражем.", "Мета, аудиторія, головна думка, далі сценарій по сценах з хронометражем.", "الهدف والجمهور والرسالة، ثم سيناريو مشهداً بمشهد مع التوقيت.") },
    CHECK, REPURPOSE],
  "marketing.media": [WRITE("content", "Draft the content", "Подготовить содержание", "Підготувати зміст", "صياغة المحتوى", L("Slide-by-slide outline for a presentation, or the text of a one-pager.", "Структура презентации по слайдам или текст одностраничника.", "Структура презентації по слайдах або текст односторінкового матеріалу.", "هيكل العرض شريحة بشريحة أو نص الصفحة الواحدة.")), CHECK],
  "marketing.campaigns": [WRITE("copy", "Write the copy", "Написать текст", "Написати текст", "اكتب النص", L("Email: subject, preview and body. Ads: headlines and descriptions.", "Письмо: тема, превью и текст. Реклама: заголовки и описания.", "Лист: тема, прев'ю і текст. Реклама: заголовки та описи.", "البريد: الموضوع والمعاينة والنص. الإعلانات: العناوين والأوصاف.")), CHECK],
  "marketing.events": [WRITE("abstract", "Write the abstract", "Написать тезисы", "Написати тези", "اكتب الملخص", L("Talk abstract and speaker bio, or the booth message.", "Тезисы доклада и биография спикера, или идея стенда.", "Тези доповіді та біографія спікера, або ідея стенду.", "ملخص الكلمة وسيرة المتحدث أو رسالة الجناح."))],
  "marketing.brand": [WRITE("text", "Draft this element", "Подготовить текст", "Підготувати текст", "صياغة العنصر", L("Company description, key message or tone rule in the AGRON voice.", "Описание компании, ключевой тезис или правило тона в стиле AGRON.", "Опис компанії, ключова теза або правило тону в стилі AGRON.", "وصف الشركة أو رسالة رئيسية أو قاعدة أسلوب بصوت AGRON."))],
};

/** Text fields read by the compliance check, per section. */
export const CHECK_FIELDS: Record<string, string[]> = {
  "marketing.social": ["text", "hashtags"], "marketing.press": ["topic", "pitch", "text"], "marketing.interviews": ["pitch", "topics", "prep"],
  "marketing.video": ["brief", "script"], "marketing.media": ["content", "notes"], "marketing.campaigns": ["copy", "template"],
};
/** The main text a corrected version replaces. */
export const MAIN_FIELD: Record<string, string> = {
  "marketing.social": "text", "marketing.press": "text", "marketing.interviews": "prep", "marketing.video": "script", "marketing.media": "content", "marketing.campaigns": "copy",
};

/** Words that never appear in AGRON materials (brand rule). */
export const BANNED = [/\bstar\s?wall\b/i, /\bpatent(s|ed)?\b/i];
export const bannedHits = (text: string) => BANNED.filter((r) => r.test(text)).map((r) => (text.match(r) || [""])[0]);

/** Fingerprint of the checked text: when the text changes after a passed check, the check is reset. */
export function textHash(section: string, title: string, data: Record<string, any>) {
  const s = [title, ...(CHECK_FIELDS[section] || []).map((k) => String(data?.[k] || ""))].join("\u0001");
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
